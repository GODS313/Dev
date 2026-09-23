<?php
declare(strict_types=1);

namespace App\Core;

use App\Connectors\Connector;
use App\Connectors\Registry;

/** Configured connector instances (one per bot/account) and their inbound traffic. */
final class Channels
{
    public static function create(string $type, string $name, string $secret): array
    {
        $connector = Registry::get($type);
        $check = $connector->verify($secret);
        if (!$check['ok']) {
            return ['ok' => false, 'error' => $check['error']];
        }
        $id = Database::insert(
            'INSERT INTO connectors (type, name, secret_enc, webhook_key) VALUES (?,?,?,?)',
            [$type, $name !== '' ? $name : $check['name'], Crypto::encrypt($secret), Crypto::token(24)]
        );
        return ['ok' => true, 'id' => $id, 'bot' => $check['name']];
    }

    public static function find(int $id): ?array
    {
        return Database::one('SELECT * FROM connectors WHERE id = ?', [$id]);
    }

    public static function all(): array
    {
        return Database::all(
            'SELECT c.*, (SELECT COUNT(*) FROM identities i WHERE i.connector_id = c.id AND i.subscribed = 1) AS subscribers
             FROM connectors c ORDER BY c.id'
        );
    }

    public static function secret(array $row): string
    {
        return Crypto::decrypt($row['secret_enc']);
    }

    public static function driver(array $row): Connector
    {
        return Registry::get($row['type']);
    }

    public static function webhookUrl(array $row, string $baseUrl): string
    {
        return rtrim($baseUrl, '/') . '/hook/' . $row['id'] . '/' . $row['webhook_key'];
    }

    public static function enableWebhook(array $row, string $baseUrl): array
    {
        $res = self::driver($row)->setWebhook(self::secret($row), self::webhookUrl($row, $baseUrl), $row['webhook_key']);
        if (!empty($res['ok'])) {
            Database::run('UPDATE connectors SET webhook_active = 1 WHERE id = ?', [$row['id']]);
        }
        return $res;
    }

    public static function disableWebhook(array $row): array
    {
        $res = self::driver($row)->deleteWebhook(self::secret($row));
        Database::run('UPDATE connectors SET webhook_active = 0 WHERE id = ?', [$row['id']]);
        return $res;
    }

    /** Handles one inbound update: registers the sender and processes opt-in/opt-out commands. */
    public static function handleUpdate(array $row, array $update): void
    {
        $driver = self::driver($row);
        $msg = $driver->parseUpdate($update);
        if ($msg === null) {
            return;
        }
        if ($msg['update_id'] > (int) $row['last_update_id']) {
            Database::run('UPDATE connectors SET last_update_id = ? WHERE id = ? AND last_update_id < ?', [$msg['update_id'], $row['id'], $msg['update_id']]);
        }
        $identity = Audience::upsertIdentity((int) $row['id'], $msg['external_id'], $msg['username'], $msg['name']);
        $command = strtolower(strtok($msg['text'], " @") ?: '');
        $reply = null;
        if ($command === '/start') {
            Audience::setSubscribed((int) $identity['id'], true);
            $reply = Config::get('WELCOME_TEXT', "سلام 👋\nعضویت شما فعال شد و اطلاع‌رسانی‌ها را از همین‌جا دریافت می‌کنید.\nبرای لغو عضویت هر زمان /stop را بفرستید.");
        } elseif ($command === '/stop') {
            Audience::setSubscribed((int) $identity['id'], false);
            $reply = Config::get('GOODBYE_TEXT', 'عضویت شما لغو شد و دیگر پیام تبلیغاتی دریافت نمی‌کنید. برای عضویت دوباره /start را بفرستید.');
        }
        if ($reply !== null) {
            $driver->send(self::secret($row), $msg['external_id'], $reply);
        }
    }

    /** Polling fallback for connectors without an active webhook (used by the cron worker). */
    public static function poll(array $row): int
    {
        if ((int) $row['webhook_active'] === 1 || (int) $row['enabled'] !== 1) {
            return 0;
        }
        $updates = self::driver($row)->fetchUpdates(self::secret($row), (int) $row['last_update_id']);
        foreach ($updates as $update) {
            self::handleUpdate($row, $update);
            $row['last_update_id'] = max((int) $row['last_update_id'], (int) ($update['update_id'] ?? 0));
            Database::run('UPDATE connectors SET last_update_id = ? WHERE id = ? AND last_update_id < ?', [$row['last_update_id'], $row['id'], $row['last_update_id']]);
        }
        return count($updates);
    }
}
