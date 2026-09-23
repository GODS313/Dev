<?php
declare(strict_types=1);

if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) {
    return false; // local dev server: serve static assets directly
}

// Front controller. The application lives outside the web root: in ../platform on
// the cPanel host (public_html + platform side by side) or in .. inside the repo.
$root = dirname(__DIR__);
foreach ([__DIR__ . '/../platform', __DIR__ . '/../../platform'] as $candidate) {
    if (is_file($candidate . '/app/bootstrap.php')) {
        $root = $candidate;
        break;
    }
}
require $root . '/app/bootstrap.php';

$request = App\Web\Request::fromGlobals();
(new App\Web\App())->handle($request)->send($request->secure);

// Fallback scheduler for hosts without a cron job: after the response has been
// flushed, run a short worker tick if none ran in the last minute.
if ($request->path !== '/cron' && App\Core\Worker::due(60)) {
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    }
    ignore_user_abort(true);
    try {
        App\Core\Worker::tick(20);
    } catch (Throwable $e) {
        error_log('[platform] worker: ' . $e->getMessage());
    }
}
