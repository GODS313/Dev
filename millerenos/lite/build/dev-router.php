<?php
// Local-only router for `php -S` that emulates public/.htaccess (not used in production).
$root = getenv('MLR_PUBLIC');
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (!str_starts_with($uri, '/God')) { http_response_code(404); return true; }
$rel = substr($uri, 4) ?: '/';
if (preg_match('#^/(en|fa)/status$#', $rel)) { require $root . '/index.php'; return true; }
$candidates = [$rel, rtrim($rel, '/') . '/index.html', $rel . '.html'];
foreach ($candidates as $c) {
    $f = $root . $c;
    if ($c !== '/' && is_file($f) && !str_ends_with($f, '.php')) {
        $types = ['html' => 'text/html; charset=utf-8', 'css' => 'text/css', 'js' => 'text/javascript', 'svg' => 'image/svg+xml', 'xml' => 'application/xml', 'txt' => 'text/plain'];
        header('Content-Type: ' . ($types[pathinfo($f, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
        readfile($f);
        return true;
    }
}
if ($rel === '/') { readfile($root . '/index.html'); return true; }
require $root . '/index.php';
return true;
