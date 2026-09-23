<?php
declare(strict_types=1);

namespace App\Core;

/** Panel operator authentication with brute-force throttling. */
final class Auth
{
    public const COOKIE = 'mp_session';
    private const TTL = 43200; // 12h
    private const MAX_ATTEMPTS = 8;
    private const WINDOW = 900; // 15 min

    /** Creates the first operator from ADMIN_USER / ADMIN_PASSWORD in the server config. */
    public static function seedAdmin(): void
    {
        $user = Config::get('ADMIN_USER');
        $pass = Config::get('ADMIN_PASSWORD');
        if (!$user || !$pass || (int) Database::scalar('SELECT COUNT(*) FROM admins') > 0) {
            return;
        }
        self::createAdmin($user, $pass);
    }

    public static function createAdmin(string $username, string $password): int
    {
        if (strlen($password) < 10) {
            throw new \InvalidArgumentException('password must be at least 10 characters');
        }
        return Database::insert('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [$username, password_hash($password, PASSWORD_DEFAULT)]);
    }

    public static function setPassword(int $adminId, string $password): void
    {
        if (strlen($password) < 10) {
            throw new \InvalidArgumentException('password must be at least 10 characters');
        }
        Database::run('UPDATE admins SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $adminId]);
        Database::run('UPDATE sessions SET revoked_at = ? WHERE subject_type = \'admin\' AND subject_id = ? AND revoked_at IS NULL', [gmdate('Y-m-d H:i:s'), $adminId]);
    }

    public static function throttled(string $ip): bool
    {
        Database::run('DELETE FROM login_attempts WHERE attempted_at < ?', [time() - self::WINDOW]);
        return (int) Database::scalar('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$ip]) >= self::MAX_ATTEMPTS;
    }

    /** Returns a session token on success, null on failure. */
    public static function attempt(string $username, string $password, string $ip, string $userAgent): ?string
    {
        if (self::throttled($ip)) {
            return null;
        }
        $admin = Database::one('SELECT * FROM admins WHERE username = ?', [$username]);
        if ($admin === null || !password_verify($password, $admin['password_hash'])) {
            Database::run('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)', [$ip, time()]);
            Audit::log('anonymous', 'login_failed', $username, $ip);
            return null;
        }
        if (password_needs_rehash($admin['password_hash'], PASSWORD_DEFAULT)) {
            Database::run('UPDATE admins SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $admin['id']]);
        }
        Database::run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
        Audit::log($admin['username'], 'login', null, $ip);
        return Sessions::create('admin', (int) $admin['id'], null, self::TTL, $ip, $userAgent);
    }

    public static function current(string $token): ?array
    {
        $session = Sessions::validate($token, 'admin');
        if ($session === null) {
            return null;
        }
        $admin = Database::one('SELECT id, username FROM admins WHERE id = ?', [$session['subject_id']]);
        return $admin === null ? null : $admin + ['session_id' => (int) $session['id']];
    }

    public static function csrf(string $token): string
    {
        return hash_hmac('sha256', 'csrf|' . $token, Crypto::key());
    }

    public static function ttl(): int
    {
        return self::TTL;
    }
}
