<?php
declare(strict_types=1);

// Serves the latest APK published by publish.php. Point the public download
// button at this file to always hand out the newest release. This does not
// touch the site's existing download.php.

$meta = @file_get_contents(__DIR__ . '/releases/latest.json');
$data = $meta ? json_decode($meta, true) : null;
$file = is_array($data) ? __DIR__ . '/' . ($data['file'] ?? '') : '';

if (!is_array($data) || !is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'هنوز نسخه‌ای منتشر نشده است.';
    exit;
}

$download = preg_replace('/[^A-Za-z0-9._-]+/', '-', ($data['name'] ?? 'app') . '-' . ($data['version'] ?? '')) . '.apk';
header('Content-Type: application/vnd.android.package-archive');
header('Content-Disposition: attachment; filename="' . $download . '"');
header('Content-Length: ' . filesize($file));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
readfile($file);
