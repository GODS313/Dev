<?php
declare(strict_types=1);
const FALLBACK_URL = 'https://seskia.online/est/download';
$configFile = '/var/lib/hamkare-admin/config.json';
$target = FALLBACK_URL;
if (is_file($configFile) && !is_link($configFile)) {
    try {
        $cfg = json_decode((string)file_get_contents($configFile), true, 16, JSON_THROW_ON_ERROR);
        if (is_array($cfg) && isset($cfg['download_source']) && is_string($cfg['download_source'])) {
            $candidate = filter_var($cfg['download_source'], FILTER_VALIDATE_URL);
            $parts = $candidate ? parse_url($candidate) : false;
            if ($parts && ($parts['scheme'] ?? '') === 'https' && in_array(strtolower((string)($parts['host'] ?? '')), ['seskia.online','www.seskia.online'], true)) {
                $target = $candidate;
            }
        }
    } catch (Throwable $e) {}
}
$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 300,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_USERAGENT => 'HamkareDownloadGateway/1.0',
    CURLOPT_HEADERFUNCTION => static function ($curl, string $line): int {
        $length = strlen($line);
        if (stripos($line, 'Content-Length:') === 0) header(trim($line));
        if (stripos($line, 'ETag:') === 0) header(trim($line));
        if (stripos($line, 'Last-Modified:') === 0) header(trim($line));
        return $length;
    },
    CURLOPT_WRITEFUNCTION => static function ($curl, string $data): int { echo $data; flush(); return strlen($data); },
]);
header('Content-Type: application/vnd.android.package-archive');
header('Content-Disposition: attachment; filename="hamkare.apk"');
header('Cache-Control: public, max-age=300');
header('X-Content-Type-Options: nosniff');
curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$error = curl_error($ch);
curl_close($ch);
if ($status < 200 || $status >= 400) {
    http_response_code(502);
    if (!headers_sent()) header('Content-Type: text/plain; charset=utf-8');
    exit('Download source is temporarily unavailable.');
}
