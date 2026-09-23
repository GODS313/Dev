<?php
declare(strict_types=1);

namespace App\Core;

/** Server-side, revocable sessions; only a SHA-256 of each token is stored. */
final class Sessions
{
    public static function create(string $subjectType, int $subjectId, ?int $deviceId, int $ttlSeconds, ?string $ip = null, ?string $userAgent = null): string
    {
        $token = Crypto::token();
        Database::insert(
            'INSERT INTO sessions (subject_type, subject_id, device_id, token_hash, ip, user_agent, expires_at) VALUES (?,?,?,?,?,?,?)',
            [$subjectType, $subjectId, $deviceId, hash('sha256', $token), $ip, $userAgent ? substr($userAgent, 0, 255) : null, gmdate('Y-m-d H:i:s', time() + $ttlSeconds)]
        );
        return $token;
    }

    public static function validate(string $token, string $subjectType): ?array
    {
        if ($token === '') {
            return null;
        }
        $row = Database::one(
            'SELECT * FROM sessions WHERE token_hash = ? AND subject_type = ? AND revoked_at IS NULL AND expires_at > ?',
            [hash('sha256', $token), $subjectType, gmdate('Y-m-d H:i:s')]
        );
        if ($row !== null && strtotime($row['last_seen_at'] . ' UTC') < time() - 60) {
            Database::run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [gmdate('Y-m-d H:i:s'), $row['id']]);
        }
        return $row;
    }

    public static function revokeToken(string $token): void
    {
        Database::run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [gmdate('Y-m-d H:i:s'), hash('sha256', $token)]);
    }

    public static function revoke(int $id): void
    {
        Database::run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [gmdate('Y-m-d H:i:s'), $id]);
    }

    public static function active(): array
    {
        return Database::all(
            'SELECT s.*, a.username AS admin_name, d.device_uid, d.platform
             FROM sessions s
             LEFT JOIN admins a ON s.subject_type = \'admin\' AND a.id = s.subject_id
             LEFT JOIN devices d ON d.id = s.device_id
             WHERE s.revoked_at IS NULL AND s.expires_at > ?
             ORDER BY s.last_seen_at DESC LIMIT 500',
            [gmdate('Y-m-d H:i:s')]
        );
    }
}
