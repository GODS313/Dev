<?php

declare(strict_types=1);

const HAMKARE_APK_PATH = '/var/www/adlisho/app.apk';
const HAMKARE_APK_MAX_BYTES = 209715200;

function download_fail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    exit($message);
}

$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
if (!in_array($method, ['GET', 'HEAD'], true)) {
    header('Allow: GET, HEAD');
    download_fail(405, 'روش درخواست مجاز نیست.');
}
if (!is_file(HAMKARE_APK_PATH) || is_link(HAMKARE_APK_PATH)) {
    download_fail(503, 'دانلود موقتاً در دسترس نیست.');
}
$fileStat = stat(HAMKARE_APK_PATH);
$size = is_array($fileStat) ? (int) ($fileStat['size'] ?? 0) : 0;
$modified = is_array($fileStat) ? (int) ($fileStat['mtime'] ?? 0) : 0;
$inode = is_array($fileStat) ? (int) ($fileStat['ino'] ?? 0) : 0;
if ($size < 1024 || $size > HAMKARE_APK_MAX_BYTES || $modified <= 0 || $inode <= 0) {
    download_fail(503, 'فایل اپلیکیشن معتبر نیست.');
}

$etag = '"' . hash('sha256', $inode . ':' . $size . ':' . $modified) . '"';
$lastModified = gmdate('D, d M Y H:i:s', $modified) . ' GMT';
$cache = 'public, max-age=300, s-maxage=300, stale-while-revalidate=60';
header('Content-Type: application/vnd.android.package-archive');
header('Content-Disposition: attachment; filename="hamkare.apk"; filename*=UTF-8\'\'hamkare.apk');
header('Content-Transfer-Encoding: binary');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Accept-Ranges: bytes');
header('Cache-Control: ' . $cache);
header('CDN-Cache-Control: ' . $cache);
header('ETag: ' . $etag);
header('Last-Modified: ' . $lastModified);

$ifNoneMatch = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($ifNoneMatch !== '' && hash_equals($etag, $ifNoneMatch)) {
    http_response_code(304);
    exit;
}

$start = 0;
$end = $size - 1;
$range = trim((string) ($_SERVER['HTTP_RANGE'] ?? ''));
$ifRange = trim((string) ($_SERVER['HTTP_IF_RANGE'] ?? ''));
if ($range !== '' && ($ifRange === '' || hash_equals($etag, $ifRange) || hash_equals($lastModified, $ifRange))) {
    if (!preg_match('/^bytes=(\d*)-(\d*)$/D', $range, $matches)) {
        header("Content-Range: bytes */{$size}");
        download_fail(416, 'بازه دانلود معتبر نیست.');
    }
    $startText = $matches[1];
    $endText = $matches[2];
    if ($startText === '' && $endText === '') {
        header("Content-Range: bytes */{$size}");
        download_fail(416, 'بازه دانلود معتبر نیست.');
    }
    if (strlen($startText) > 18 || strlen($endText) > 18) {
        header("Content-Range: bytes */{$size}");
        download_fail(416, 'بازه دانلود معتبر نیست.');
    }
    if ($startText === '') {
        $suffix = (int) $endText;
        if ($suffix <= 0) {
            header("Content-Range: bytes */{$size}");
            download_fail(416, 'بازه دانلود معتبر نیست.');
        }
        $start = max(0, $size - $suffix);
    } else {
        $start = (int) $startText;
        $end = $endText === '' ? $size - 1 : (int) $endText;
    }
    if ($start < 0 || $start >= $size || $end < $start) {
        header("Content-Range: bytes */{$size}");
        download_fail(416, 'بازه دانلود معتبر نیست.');
    }
    $end = min($end, $size - 1);
    http_response_code(206);
    header("Content-Range: bytes {$start}-{$end}/{$size}");
}

$length = $end - $start + 1;
header('Content-Length: ' . $length);
if ($method === 'HEAD') {
    exit;
}

$handle = fopen(HAMKARE_APK_PATH, 'rb');
if ($handle === false || fseek($handle, $start) !== 0) {
    if (is_resource($handle)) {
        fclose($handle);
    }
    download_fail(503, 'خواندن فایل اپلیکیشن ممکن نیست.');
}
$remaining = $length;
while ($remaining > 0 && !feof($handle) && !connection_aborted()) {
    $chunk = fread($handle, min(1048576, $remaining));
    if ($chunk === false || $chunk === '') {
        break;
    }
    echo $chunk;
    $remaining -= strlen($chunk);
    flush();
}
fclose($handle);
