<?php
declare(strict_types=1);

namespace Mlr;

interface TelegramApi
{
    /** Calls a Bot API method; returns `result` or throws. */
    public function call(string $method, array $params = []): mixed;
}

final class HttpTelegramApi implements TelegramApi
{
    public function __construct(private string $token)
    {
    }

    public function call(string $method, array $params = []): mixed
    {
        $ch = curl_init("https://api.telegram.org/bot{$this->token}/{$method}");
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($params, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        $res = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($res) || empty($res['ok'])) {
            throw new \RuntimeException(scrub("Telegram {$method} failed: " . ($res['description'] ?? $err)));
        }
        return $res['result'];
    }
}

final class NullTelegramApi implements TelegramApi
{
    public function call(string $method, array $params = []): mixed
    {
        throw new AppError('not_configured', 'Telegram bot is not configured');
    }
}

final class TelegramAuth
{
    /** Server-side validation of Mini App init data (never trust client identity). */
    public static function validateInitData(string $initData, string $botToken, int $maxAge = 3600, ?int $now = null): array
    {
        if ($initData === '' || strlen($initData) > 4096) throw new AppError('unauthorized', 'Invalid init data');
        parse_str($initData, $params);
        $hash = $params['hash'] ?? '';
        if (!is_string($hash) || !preg_match('/^[a-f0-9]{64}$/', $hash)) throw new AppError('unauthorized', 'Invalid init data');
        unset($params['hash']);
        $pairs = [];
        foreach ($params as $k => $v) {
            if (!is_string($v)) throw new AppError('unauthorized', 'Invalid init data');
            $pairs[] = "{$k}={$v}";
        }
        sort($pairs, SORT_STRING);
        $secret = hash_hmac('sha256', $botToken, 'WebAppData', true);
        $expected = hash_hmac('sha256', implode("\n", $pairs), $secret);
        if (!hash_equals($expected, $hash)) throw new AppError('unauthorized', 'Invalid init data signature');
        $age = ($now ?? time()) - (int) ($params['auth_date'] ?? 0);
        if ($age > $maxAge || $age < -60) throw new AppError('unauthorized', 'Init data expired');
        $user = json_decode((string) ($params['user'] ?? ''), true);
        if (!is_array($user) || !isset($user['id']) || !is_int($user['id']) || $user['id'] <= 0) throw new AppError('unauthorized', 'Invalid init data');
        if (!empty($user['is_bot'])) throw new AppError('forbidden', 'Bots cannot sign in');
        return ['user' => $user, 'start_param' => $params['start_param'] ?? null];
    }

    public static function signInitData(array $fields, string $botToken): string
    {
        $pairs = [];
        foreach ($fields as $k => $v) $pairs[] = "{$k}={$v}";
        sort($pairs, SORT_STRING);
        $secret = hash_hmac('sha256', $botToken, 'WebAppData', true);
        $fields['hash'] = hash_hmac('sha256', implode("\n", $pairs), $secret);
        return http_build_query($fields, '', '&', PHP_QUERY_RFC3986);
    }
}
