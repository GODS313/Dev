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
            'INSERT INTO connectors (type, name, secret_enc, webhook_key, bot_username) VALUES (?,?,?,?,?)',
            [$type, $name !== '' ? $name : $check['name'], Crypto::encrypt($secret), Crypto::token(24), $check['username'] ?? null]
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
            "SELECT c.*,
                    (SELECT COUNT(*) FROM identities i WHERE i.connector_id = c.id AND i.subscribed = 1 AND i.kind = 'private') AS subscribers,
                    (SELECT COUNT(*) FROM identities i WHERE i.connector_id = c.id AND i.subscribed = 1 AND i.kind <> 'private') AS chats
             FROM connectors c ORDER BY c.id"
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

    /** Handles one inbound update: opt-in/opt-out, group/channel membership, business replies. */
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

        if ($msg['event'] === 'membership') {
            $present = in_array($msg['text'], ['member', 'administrator', 'creator', 'restricted'], true);
            Audience::registerChat((int) $row['id'], $msg['external_id'], $msg['kind'], $msg['title'], $present);
            return;
        }

        if ($msg['event'] === 'business') {
            self::autoReplyBusiness($row, $msg);
            return;
        }

        // Group/channel message: keep the chat on the reachable list, nothing else.
        if ($msg['kind'] !== 'private') {
            Audience::registerChat((int) $row['id'], $msg['external_id'], $msg['kind'], $msg['title'], true);
            return;
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

    /** Replies once per customer per day from a Business-connected account. */
    private static function autoReplyBusiness(array $row, array $msg): void
    {
        $text = trim((string) ($row['business_reply'] ?? ''));
        if ($text === '' || ($msg['business_connection_id'] ?? '') === '') {
            return;
        }
        $today = gmdate('Y-m-d');
        $already = Database::scalar(
            'SELECT replied_on FROM business_replies WHERE connector_id = ? AND chat_id = ?',
            [$row['id'], $msg['external_id']]
        );
        if ($already === $today) {
            return;
        }
        $res = self::driver($row)->send(self::secret($row), $msg['external_id'], $text, ['business_connection_id' => $msg['business_connection_id']]);
        if (!empty($res['ok'])) {
            Database::run(
                'INSERT INTO business_replies (connector_id, chat_id, replied_on) VALUES (?,?,?)
                 ON CONFLICT(connector_id, chat_id) DO UPDATE SET replied_on = excluded.replied_on',
                [$row['id'], $msg['external_id'], $today]
            );
        }
    }

    /** Link a customer opens to start the bot in a private chat and opt in. */
    public static function joinUrl(array $row): ?string
    {
        if (empty($row['bot_username'])) {
            return null;
        }
        $prefix = $row['type'] === 'bale' ? 'https://ble.ir/' : 'https://t.me/';
        return $prefix . $row['bot_username'] . '?start=join';
    }

    /** Posts a message carrying a "join" button into every group/channel the bot belongs to. */
    public static function postJoinButton(array $row, string $text, string $buttonText): array
    {
        $url = self::joinUrl($row);
        if ($url === null) {
            return ['ok' => false, 'error' => 'bot username unknown', 'sent' => 0];
        }
        $driver = self::driver($row);
        $secret = self::secret($row);
        $sent = 0;
        foreach (Database::all("SELECT external_id FROM identities WHERE connector_id = ? AND kind <> 'private' AND subscribed = 1", [$row['id']]) as $chat) {
            $res = $driver->send($secret, $chat['external_id'], $text, ['button' => ['text' => $buttonText, 'url' => $url]]);
            if (!empty($res['ok'])) {
                $sent++;
            }
        }
        return ['ok' => true, 'sent' => $sent, 'error' => null];
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
