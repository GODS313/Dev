<?php
declare(strict_types=1);

namespace App\Connectors;

/** Shared implementation for messengers exposing a Telegram-compatible Bot API. */
abstract class BotApiConnector implements Connector
{
    /** @var callable|null test hook: fn(string $url, array $params): array */
    public static $transport = null;

    abstract protected function baseUrl(): string;

    protected function supportsSecretHeader(): bool
    {
        return false;
    }

    public function call(string $secret, string $method, array $params = []): array
    {
        $url = $this->baseUrl() . 'bot' . $secret . '/' . $method;
        if (self::$transport !== null) {
            return (self::$transport)($url, $params);
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($params, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 25,
        ]);
        $body = curl_exec($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $json = is_string($body) ? json_decode($body, true) : null;
        if (!is_array($json)) {
            return ['ok' => false, 'error_code' => $status, 'description' => $error ?: 'invalid response (HTTP ' . $status . ')'];
        }
        return $json;
    }

    public function verify(string $secret): array
    {
        $res = $this->call($secret, 'getMe');
        if (!empty($res['ok'])) {
            $bot = $res['result'] ?? [];
            $username = isset($bot['username']) ? (string) $bot['username'] : null;
            return ['ok' => true, 'name' => '@' . ($username ?? ($bot['first_name'] ?? 'bot')), 'username' => $username, 'error' => null];
        }
        return ['ok' => false, 'name' => '', 'username' => null, 'error' => (string) ($res['description'] ?? 'unknown error')];
    }

    public function send(string $secret, string $externalId, string $text, array $options = []): array
    {
        $params = ['chat_id' => $externalId, 'text' => $text];
        if (!empty($options['button']['url']) && !empty($options['button']['text'])) {
            $params['reply_markup'] = ['inline_keyboard' => [[['text' => $options['button']['text'], 'url' => $options['button']['url']]]]];
        }
        if (!empty($options['business_connection_id'])) {
            $params['business_connection_id'] = $options['business_connection_id'];
        }
        $res = $this->call($secret, 'sendMessage', $params);
        if (!empty($res['ok'])) {
            return ['ok' => true, 'error' => null, 'retry_after' => 0, 'unreachable' => false];
        }
        $code = (int) ($res['error_code'] ?? 0);
        $desc = (string) ($res['description'] ?? 'send failed');
        return [
            'ok' => false,
            'error' => $desc,
            'retry_after' => (int) ($res['parameters']['retry_after'] ?? ($code === 429 ? 5 : 0)),
            // 403: blocked/kicked; 400 chat not found: user never started it / bot removed.
            'unreachable' => $code === 403 || ($code === 400 && stripos($desc, 'chat not found') !== false),
        ];
    }

    public function setWebhook(string $secret, string $url, string $key): array
    {
        $params = [
            'url' => $url,
            'allowed_updates' => ['message', 'channel_post', 'my_chat_member', 'business_connection', 'business_message'],
        ];
        if ($this->supportsSecretHeader()) {
            $params['secret_token'] = $key;
        }
        return $this->call($secret, 'setWebhook', $params);
    }

    public function deleteWebhook(string $secret): array
    {
        return $this->call($secret, 'deleteWebhook');
    }

    public function fetchUpdates(string $secret, int $offset): array
    {
        $res = $this->call($secret, 'getUpdates', [
            'offset' => $offset + 1,
            'timeout' => 0,
            'limit' => 100,
            'allowed_updates' => ['message', 'channel_post', 'my_chat_member', 'business_connection', 'business_message'],
        ]);
        return !empty($res['ok']) && is_array($res['result'] ?? null) ? $res['result'] : [];
    }

    private static function chatKind(string $type): string
    {
        return match ($type) {
            'group', 'supergroup' => 'group',
            'channel' => 'channel',
            default => 'private',
        };
    }

    public function parseUpdate(array $update): ?array
    {
        $base = ['update_id' => (int) ($update['update_id'] ?? 0), 'username' => null, 'name' => '', 'title' => null, 'text' => '', 'business_connection_id' => null];

        // A customer's message to a Business-connected account: reply is allowed, no opt-in list.
        if (isset($update['business_message']['chat'])) {
            $msg = $update['business_message'];
            if (($msg['chat']['type'] ?? '') !== 'private') {
                return null;
            }
            $from = $msg['from'] ?? [];
            return [
                'event' => 'business',
                'kind' => 'private',
                'external_id' => (string) $msg['chat']['id'],
                'username' => isset($from['username']) ? (string) $from['username'] : null,
                'name' => trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? '')),
                'text' => trim((string) ($msg['text'] ?? '')),
                'business_connection_id' => (string) ($msg['business_connection_id'] ?? ''),
            ] + $base;
        }

        // Bot added to / removed from a group or channel.
        if (isset($update['my_chat_member']['chat'])) {
            $chat = $update['my_chat_member']['chat'];
            $status = $update['my_chat_member']['new_chat_member']['status'] ?? '';
            return [
                'event' => 'membership',
                'kind' => self::chatKind((string) ($chat['type'] ?? '')),
                'external_id' => (string) $chat['id'],
                'title' => isset($chat['title']) ? (string) $chat['title'] : null,
                'text' => (string) $status, // member/administrator/creator vs left/kicked
            ] + $base;
        }

        $msg = $update['message'] ?? $update['channel_post'] ?? null;
        if (!is_array($msg) || !isset($msg['chat'])) {
            return null;
        }
        $chat = $msg['chat'];
        $kind = self::chatKind((string) ($chat['type'] ?? ''));
        $from = $msg['from'] ?? [];
        return [
            'event' => 'message',
            'kind' => $kind,
            'external_id' => (string) $chat['id'],
            'username' => isset($from['username']) ? (string) $from['username'] : null,
            'name' => $kind === 'private' ? trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? '')) : '',
            'title' => isset($chat['title']) ? (string) $chat['title'] : null,
            'text' => trim((string) ($msg['text'] ?? $msg['caption'] ?? '')),
        ] + $base;
    }
}
