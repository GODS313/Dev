<?php
declare(strict_types=1);
$base = dirname(__DIR__);
$configFile = $base . '/storage/config.php';
if (!is_file($configFile)) { header('Location: /install/'); exit; }
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path === '/webhook' || str_ends_with($path, '/webhook')) { require $base.'/src/bot.php'; exit; }
if ($path === '/admin' || str_ends_with($path, '/admin')) { require $base.'/src/admin.php'; exit; }
header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>Telegram Bot</title><style>body{font-family:tahoma;background:#f5f6fa;padding:50px}.box{max-width:650px;margin:auto;background:#fff;padding:30px;border-radius:18px}a{display:inline-block;background:#222;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none}</style><div class="box"><h1>ربات تلگرام</h1><p>سیستم فعال است.</p><a href="/admin">پنل مدیریت</a></div>';
