<?php
declare(strict_types=1);

namespace App\Core;

/** Minimal HTTP client used by task modules. Test code can replace the transport. */
final class Http
{
    /** @var callable|null test hook: fn(string $method, string $url, array $opts): array */
    public static $transport = null;

    /**
     * @param array{headers?:array<string,string>, body?:string, timeout?:int, max_bytes?:int} $opts
     * @return array{ok:bool, status:int, body:string, headers:array<string,string>, error:?string}
     */
    public static function request(string $method, string $url, array $opts = []): array
    {
        if (self::$transport !== null) {
            return (self::$transport)($method, $url, $opts);
        }
        $ch = curl_init($url);
        $headers = [];
        foreach ($opts['headers'] ?? [] as $k => $v) {
            $headers[] = $k . ': ' . $v;
        }
        $maxBytes = $opts['max_bytes'] ?? 60 * 1024 * 1024;
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 4,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => $opts['timeout'] ?? 120,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => static function ($ch, $dlTotal, $dlNow) use ($maxBytes) {
                return $dlNow > $maxBytes ? 1 : 0; // abort oversized downloads
            },
        ]);
        if (isset($opts['body'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['body']);
        }
        $raw = curl_exec($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        if (!is_string($raw)) {
            return ['ok' => false, 'status' => $status, 'body' => '', 'headers' => [], 'error' => $error ?: 'request failed'];
        }
        $rawHeaders = substr($raw, 0, $headerSize);
        $body = substr($raw, $headerSize);
        $parsed = [];
        foreach (explode("\r\n", $rawHeaders) as $line) {
            if (str_contains($line, ':')) {
                [$k, $v] = explode(':', $line, 2);
                $parsed[strtolower(trim($k))] = trim($v);
            }
        }
        return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => $body, 'headers' => $parsed, 'error' => null];
    }
}
