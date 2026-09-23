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
            return ['ok' => true, 'name' => '@' . ($bot['username'] ?? ($bot['first_name'] ?? 'bot')), 'error' => null];
        }
        return ['ok' => false, 'name' => '', 'error' => (string) ($res['description'] ?? 'unknown error')];
    }

    public function send(string $secret, string $externalId, string $text): array
    {
        $res = $this->call($secret, 'sendMessage', ['chat_id' => $externalId, 'text' => $text]);
        if (!empty($res['ok'])) {
            return ['ok' => true, 'error' => null, 'retry_after' => 0, 'unreachable' => false];
        }
        $code = (int) ($res['error_code'] ?? 0);
        return [
            'ok' => false,
            'error' => (string) ($res['description'] ?? 'send failed'),
            'retry_after' => (int) ($res['parameters']['retry_after'] ?? ($code === 429 ? 5 : 0)),
            // 403: user blocked the bot; 400 chat not found: user never started it.
            'unreachable' => $code === 403 || ($code === 400 && stripos((string) ($res['description'] ?? ''), 'chat not found') !== false),
        ];
    }

    public function setWebhook(string $secret, string $url, string $key): array
    {
        $params = ['url' => $url, 'allowed_updates' => ['message']];
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
        $res = $this->call($secret, 'getUpdates', ['offset' => $offset + 1, 'timeout' => 0, 'limit' => 100]);
        return !empty($res['ok']) && is_array($res['result'] ?? null) ? $res['result'] : [];
    }

    public function parseUpdate(array $update): ?array
    {
        $msg = $update['message'] ?? null;
        if (!is_array($msg) || ($msg['chat']['type'] ?? '') !== 'private') {
            return null;
        }
        $from = $msg['from'] ?? [];
        return [
            'update_id' => (int) ($update['update_id'] ?? 0),
            'external_id' => (string) $msg['chat']['id'],
            'username' => isset($from['username']) ? (string) $from['username'] : null,
            'name' => trim(($from['first_name'] ?? '') . ' ' . ($from['last_name'] ?? '')),
            'text' => trim((string) ($msg['text'] ?? '')),
        ];
    }
}
