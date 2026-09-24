<?php
declare(strict_types=1);

namespace Mlr;

require_once __DIR__ . '/Core.php';
require_once __DIR__ . '/Schema.php';
require_once __DIR__ . '/Telegram.php';
require_once __DIR__ . '/I18n.php';
require_once __DIR__ . '/App.php';
require_once __DIR__ . '/Api.php';
require_once __DIR__ . '/Bot.php';
require_once __DIR__ . '/Kernel.php';

/** Builds the app from a root dir laid out as: config/app.env, data/ (sqlite + secrets), src/. */
function boot(string $root, ?TelegramApi $tg = null): App
{
    $cfg = Config::load($root);
    $db = new Db($root . '/data/millerenos.sqlite');
    return new App($db, $cfg, $tg ?? ($cfg->botToken ? new HttpTelegramApi($cfg->botToken) : new NullTelegramApi()));
}
