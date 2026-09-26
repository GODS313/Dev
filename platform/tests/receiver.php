<?php
declare(strict_types=1);

// Real HTTP + real HMAC against an isolated copy of the production receiver.
// Never publishes fixtures to the customer's live download site.
$receiverRoot = $tmp . '/receiver';
mkdir($receiverRoot . '/public_html/x', 0700, true);
mkdir($receiverRoot . '/platform/config', 0700, true);
mkdir($receiverRoot . '/platform/storage', 0700, true);
$receiverSecret = bin2hex(random_bytes(32));
file_put_contents($receiverRoot . '/platform/config/app.env', 'XBUILD_SECRET=' . $receiverSecret);
foreach (['publish.php', 'dl.php'] as $receiverFile) {
    copy(dirname(__DIR__) . '/xsite/' . $receiverFile, $receiverRoot . '/public_html/x/' . $receiverFile);
}
$socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
if ($socket === false) {
    throw new RuntimeException('Cannot allocate receiver test port');
}
$address = stream_socket_get_name($socket, false);
fclose($socket);
$process = proc_open([PHP_BINARY, '-S', $address, '-t', $receiverRoot . '/public_html'],
    [0 => ['pipe', 'r'], 1 => ['file', $receiverRoot . '/server.log', 'a'], 2 => ['file', $receiverRoot . '/server.log', 'a']], $pipes);
if (!is_resource($process)) {
    throw new RuntimeException('Cannot start receiver test server');
}
fclose($pipes[0]);
$receiverRequest = static function (string $path, ?string $body = null, array $headers = []) use ($address): array {
    $curl = curl_init('http://' . $address . '/x/' . $path);
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_HTTPHEADER => $headers]);
    if ($body !== null) {
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body]);
    }
    $out = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    return [$status, $out];
};
try {
    for ($attempt = 0; $attempt < 40; $attempt++) {
        [$status] = $receiverRequest('publish.php');
        if ($status !== 0) {
            break;
        }
        usleep(50000);
    }
    check($status === 405, 'real receiver rejects GET');
    check($receiverRequest('dl.php')[0] === 404, 'empty receiver has no download');
    $fixture = 'PK' . str_repeat('signed-fixture', 100);
    $signedHeaders = static function (string $body, int $timestamp, string $key) : array {
        $hash = hash('sha256', $body);
        $signature = hash_hmac('sha256', $timestamp . "\niLiveX\n1.0\n" . $hash, $key);
        return ['Content-Type: application/vnd.android.package-archive', 'X-App-Name: iLiveX', 'X-App-Version: 1.0',
            'X-Timestamp: ' . $timestamp, 'X-Content-Sha256: ' . $hash, 'X-Signature: ' . $signature];
    };
    $timestamp = time();
    $headers = $signedHeaders($fixture, $timestamp, $receiverSecret);
    check($receiverRequest('publish.php', $fixture, $signedHeaders($fixture, $timestamp, 'incorrect'))[0] === 401, 'real receiver rejects bad HMAC');
    check($receiverRequest('publish.php', $fixture, $signedHeaders($fixture, $timestamp - 600, $receiverSecret))[0] === 401, 'real receiver rejects expired HMAC');
    [$status, $body] = $receiverRequest('publish.php', $fixture, $headers);
    $publishedMeta = json_decode((string) $body, true);
    check($status === 200 && !empty($publishedMeta['ok']), 'real signed receiver publication succeeds');
    check(str_ends_with($publishedMeta['url'] ?? '', '/x/dl.php'), 'receiver returns stable download URL');
    check($receiverRequest('publish.php', $fixture, $headers)[0] === 409, 'receiver blocks exact replay');
    [$status, $body] = $receiverRequest('publish.php', $fixture, $signedHeaders($fixture, $timestamp + 1, $receiverSecret));
    check($status === 200 && !empty(json_decode((string) $body, true)['duplicate']), 'fresh signed retry deduplicates APK');
    check(count(glob($receiverRoot . '/public_html/x/releases/*.apk')) === 1, 'duplicate publication keeps one APK');
    [$status, $body] = $receiverRequest('dl.php');
    check($status === 200 && $body === $fixture, 'real download serves exact published bytes');
} finally {
    proc_terminate($process);
    proc_close($process);
}
