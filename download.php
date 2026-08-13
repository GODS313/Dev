<?php
declare(strict_types=1);

const DOWNLOAD_SOURCES = [
    'http://seskia.online/download.php?src=hamkare',
    'https://seskia.online/download.php?src=hamkare',
];

function fail_download(): never
{
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'دانلود موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    exit;
}

if (!function_exists('curl_init')) {
    fail_download();
}

ignore_user_abort(true);
set_time_limit(0);

foreach (DOWNLOAD_SOURCES as $source) {
    $started = false;
    $curl = curl_init($source);
    curl_setopt_array($curl, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4,
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_FAILONERROR => true,
        CURLOPT_USERAGENT => 'Hamkare-Download-Gateway/1.0',
        CURLOPT_HTTPHEADER => [
            'Accept: application/vnd.android.package-archive, application/octet-stream;q=0.9, */*;q=0.5',
        ],
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$started): int {
            $length = strlen($line);
            if (stripos($line, 'HTTP/') === 0) {
                $started = false;
                return $length;
            }
            if (!$started && trim($line) === '') {
                header('Content-Type: application/vnd.android.package-archive');
                header('Content-Disposition: attachment; filename="hamkare.apk"');
                header('Cache-Control: no-store');
                header('X-Content-Type-Options: nosniff');
                $started = true;
            }
            return $length;
        },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk): int {
            echo $chunk;
            flush();
            return strlen($chunk);
        },
    ]);

    $success = curl_exec($curl);
    $error = curl_errno($curl);
    curl_close($curl);

    if ($success !== false && $error === 0) {
        exit;
    }

    if ($started) {
        exit;
    }
}

fail_download();
