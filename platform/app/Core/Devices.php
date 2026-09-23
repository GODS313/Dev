<?php
declare(strict_types=1);

namespace App\Core;

/** App installs that register through the device API and hold a device session. */
final class Devices
{
    private const TTL = 7776000; // 90 days

    public static function apiKey(): string
    {
        $configured = Config::get('DEVICE_API_KEY');
        if ($configured) {
            return $configured;
        }
        $file = Config::storagePath('device_api.key');
        if (!is_file($file)) {
            file_put_contents($file, Crypto::token(24), LOCK_EX);
            @chmod($file, 0600);
        }
        return trim((string) file_get_contents($file));
    }

    /** @return array{device_id:int, token:string} */
    public static function register(array $input, string $ip, string $userAgent): array
    {
        $uid = substr(trim((string) ($input['device_uid'] ?? '')), 0, 128);
        if ($uid === '') {
            throw new \InvalidArgumentException('device_uid is required');
        }
        $fields = [
            'platform' => substr((string) ($input['platform'] ?? 'unknown'), 0, 32),
            'model' => substr((string) ($input['model'] ?? ''), 0, 128) ?: null,
            'app_version' => substr((string) ($input['app_version'] ?? ''), 0, 32) ?: null,
            'push_token' => substr((string) ($input['push_token'] ?? ''), 0, 512) ?: null,
        ];
        $now = gmdate('Y-m-d H:i:s');
        $device = Database::one('SELECT * FROM devices WHERE device_uid = ?', [$uid]);
        if ($device === null) {
            $id = Database::insert(
                'INSERT INTO devices (device_uid, platform, model, app_version, push_token, last_ip, last_seen_at) VALUES (?,?,?,?,?,?,?)',
                [$uid, $fields['platform'], $fields['model'], $fields['app_version'], $fields['push_token'], $ip, $now]
            );
        } else {
            $id = (int) $device['id'];
            Database::run(
                'UPDATE devices SET platform = ?, model = ?, app_version = ?, push_token = COALESCE(?, push_token), last_ip = ?, last_seen_at = ? WHERE id = ?',
                [$fields['platform'], $fields['model'], $fields['app_version'], $fields['push_token'], $ip, $now, $id]
            );
            // A re-registration replaces earlier device sessions.
            Database::run('UPDATE sessions SET revoked_at = ? WHERE subject_type = \'device\' AND device_id = ? AND revoked_at IS NULL', [$now, $id]);
        }
        $token = Sessions::create('device', $id, $id, self::TTL, $ip, $userAgent);
        return ['device_id' => $id, 'token' => $token];
    }

    public static function heartbeat(array $session, string $ip): void
    {
        Database::run('UPDATE devices SET last_ip = ?, last_seen_at = ? WHERE id = ?', [$ip, gmdate('Y-m-d H:i:s'), $session['device_id']]);
    }

    public static function all(): array
    {
        return Database::all('SELECT d.*, u.display_name FROM devices d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.last_seen_at DESC LIMIT 500');
    }
}
