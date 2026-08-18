<?php
declare(strict_types=1);

const APK_PATH = '/var/www/seskia/app.apk';

if (!is_file(APK_PATH) || is_link(APK_PATH) || !is_readable(APK_PATH)) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'فایل اپلیکیشن موقتاً در دسترس نیست.';
    exit;
}

$size = filesize(APK_PATH);
if ($size === false || $size <= 0 || $size > 20 * 1024 * 1024) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'فایل اپلیکیشن معتبر نیست.';
    exit;
}

header('Content-Type: application/vnd.android.package-archive');
header('Content-Disposition: attachment; filename="hamkare.apk"');
header('Content-Length: ' . $size);
header('Cache-Control: private, no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Content-Security-Policy: default-src \'none\'; sandbox');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}

$handle = fopen(APK_PATH, 'rb');
if ($handle === false) {
    http_response_code(503);
    exit;
}
fpassthru($handle);
fclose($handle);
