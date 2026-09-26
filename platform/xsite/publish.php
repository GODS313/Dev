<?php
declare(strict_types=1);

/**
 * Server-to-server publish endpoint for the download site (/x/).
 * The management panel POSTs a finished APK here, signed with a shared secret
 * kept in the panel's protected config (never in the web root). No secret is
 * stored in this directory and none is echoed back.
 *
 * Request: raw APK body, headers
 *   X-App-Name, X-App-Version (rawurlencoded), X-Timestamp, X-Content-Sha256, X-Signature
 * Signature = HMAC-SHA256( "<ts>\n<name>\n<version>\n<sha256(body)>", secret )
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function fail(int $code, string $msg): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail(405, 'method not allowed');
}

// Read the shared secret from the panel's env file (outside this web directory).
$secret = '';
$stateDir = '';
foreach ([dirname(__DIR__, 2) . '/platform/config/app.env', dirname(__DIR__) . '/platform/config/app.env'] as $envFile) {
    if (is_file($envFile)) {
        $stateDir = dirname($envFile, 2) . '/storage';
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            if (strncmp(ltrim($line), 'XBUILD_SECRET=', 14) === 0) {
                $secret = trim(trim(explode('=', $line, 2)[1]), "\"'");
            }
        }
        break;
    }
}
if ($secret === '') {
    fail(500, 'server not configured');
}

$h = static fn (string $k): string => (string) ($_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $k))] ?? '');
$name = rawurldecode($h('X-App-Name')) ?: 'app';
$version = rawurldecode($h('X-App-Version')) ?: gmdate('Ymd.Hi');
$ts = $h('X-Timestamp');
$claimedHash = $h('X-Content-Sha256');
$sig = $h('X-Signature');

if ($ts === '' || !ctype_digit($ts) || abs(time() - (int) $ts) > 300) {
    fail(401, 'stale or missing timestamp');
}

$maxBytes = 80 * 1024 * 1024;
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $maxBytes) {
    fail(413, 'apk too large');
}
$body = (string) file_get_contents('php://input', false, null, 0, $maxBytes + 1);
if (strlen($body) > $maxBytes) {
    fail(413, 'apk too large');
}
if (strlen($body) < 1000 || substr($body, 0, 2) !== 'PK') {
    fail(422, 'not an apk');
}
$actualHash = hash('sha256', $body);
if (!hash_equals($actualHash, $claimedHash)) {
    fail(422, 'content hash mismatch');
}
$expected = hash_hmac('sha256', $ts . "\n" . $name . "\n" . $version . "\n" . $actualHash, $secret);
if (!hash_equals($expected, $sig)) {
    fail(401, 'bad signature');
}

// Serialize publication and keep replay state outside the web root. A retry
// with a fresh timestamp is idempotent by content hash; an exact replay is not.
if (!is_dir($stateDir) && !@mkdir($stateDir, 0700, true)) {
    fail(500, 'cannot create private state');
}
$lock = fopen($stateDir . '/apk-publish.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX)) {
    fail(503, 'publication busy');
}
register_shutdown_function(static function () use ($lock): void {
    flock($lock, LOCK_UN);
    fclose($lock);
});
$replayFile = $stateDir . '/apk-replay.json';
$seen = is_file($replayFile) ? json_decode((string) file_get_contents($replayFile), true) : [];
if (!is_array($seen)) {
    fail(500, 'invalid replay state');
}
$seen = array_filter($seen, static fn ($expires): bool => (int) $expires >= time());
if (isset($seen[$sig])) {
    fail(409, 'request already used');
}
$seen[$sig] = (int) $ts + 300;
if (file_put_contents($replayFile, json_encode($seen), LOCK_EX) === false) {
    fail(500, 'cannot save replay state');
}
@chmod($replayFile, 0600);

$dir = __DIR__ . '/releases';
if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
    fail(500, 'cannot create releases directory');
}
$fileName = $actualHash . '.apk';
$duplicate = is_file($dir . '/' . $fileName);
if (!$duplicate && @file_put_contents($dir . '/' . $fileName . '.tmp', $body, LOCK_EX) !== strlen($body)) {
    fail(500, 'cannot store apk (disk space?)');
}
if (!$duplicate && !@rename($dir . '/' . $fileName . '.tmp', $dir . '/' . $fileName)) {
    fail(500, 'cannot finalize apk');
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$base = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/x/publish.php'), '/');
$meta = [
    'name' => $name,
    'version' => $version,
    'file' => 'releases/' . $fileName,
    'size' => strlen($body),
    'sha256' => $actualHash,
    'logo_url' => $h('X-Logo-Url'),
    'published_at' => gmdate('c'),
    'url' => $base . '/dl.php',
];
if (!$duplicate || !is_file($dir . '/latest.json')) {
    $encoded = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($encoded === false || file_put_contents($dir . '/latest.json.tmp', $encoded, LOCK_EX) !== strlen($encoded)
        || !rename($dir . '/latest.json.tmp', $dir . '/latest.json')) {
        fail(500, 'cannot update latest release');
    }
}

echo json_encode(['ok' => true, 'duplicate' => $duplicate] + $meta, JSON_UNESCAPED_UNICODE);
