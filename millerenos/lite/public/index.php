<?php
declare(strict_types=1);

// Front controller for Millerenos (shared-hosting edition). Code, config and data live OUTSIDE the web root:
// ~/millerenos/{src,config,data}; this file lives in ~/public_html/God/.
$root = getenv('MLR_ROOT') ?: dirname(__DIR__, 2) . '/millerenos';
require $root . '/src/bootstrap.php';

header_remove('X-Powered-By');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');

$app = Mlr\boot($root);
$uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$bp = $app->cfg->basePath;
$path = ($bp !== '' && str_starts_with($uri, $bp)) ? (substr($uri, strlen($bp)) ?: '/') : $uri;

$headers = [];
foreach ($_SERVER as $k => $v) {
    if (str_starts_with($k, 'HTTP_')) $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = (string) $v;
}
// Apache/LiteSpeed CGI setups may move Authorization; .htaccess passes it through.
$headers['authorization'] ??= (string) ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '');
$headers['content-type'] = (string) ($_SERVER['CONTENT_TYPE'] ?? '');

$body = (string) file_get_contents('php://input', false, null, 0, 256 * 1024);
$req = new Mlr\Request($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, $_GET, $headers, $body, (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
[$status, $h, $out] = (new Mlr\Kernel($app, __DIR__))->handle($req);
http_response_code($status);
foreach ($h as $k => $v) header("{$k}: {$v}");
echo $out;
