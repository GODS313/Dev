<?php
declare(strict_types=1);

if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) {
    return false; // local dev server: serve static assets directly
}

// Front controller. The application lives outside the web root: in ../platform on
// the cPanel host (public_html + platform side by side) or in .. inside the repo.
$root = is_file(__DIR__ . '/../platform/app/bootstrap.php') ? __DIR__ . '/../platform' : dirname(__DIR__);
require $root . '/app/bootstrap.php';

$request = App\Web\Request::fromGlobals();
(new App\Web\App())->handle($request)->send($request->secure);
