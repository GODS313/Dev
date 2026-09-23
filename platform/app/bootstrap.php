<?php
declare(strict_types=1);

// Shared entry point for the web front controller, the cron worker and tests.
define('APP_ROOT', dirname(__DIR__));

spl_autoload_register(static function (string $class): void {
    if (strncmp($class, 'App\\', 4) !== 0) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

App\Core\Config::load(APP_ROOT . '/config/app.env');
date_default_timezone_set(App\Core\Config::get('APP_TIMEZONE', 'Asia/Tehran'));
