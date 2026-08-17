<?php

declare(strict_types=1);

const PANEL_CONFIG_FILE = '/var/lib/seskia/config.json';
const PANEL_STATE_DIR = '/var/lib/seskia';
const PANEL_APK_LIVE = '/var/www/seskia/app.apk';
const PANEL_APK_STAGE = '/var/www/.seskia-apk-stage';
const PANEL_APK_BACKUPS = '/var/lib/seskia/backups';
const PANEL_APK_METADATA = '/var/lib/seskia/apk-last-deployment.json';
const PANEL_AUDIT_LOG = '/var/lib/seskia/admin-audit.jsonl';
const PANEL_LOGIN_RATE = '/var/lib/seskia/admin-login-rate.json';
const PANEL_PUBLIC_URL = 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk';
const PANEL_WEBHOOK_URL = 'https://seskia.online/telegram.php';
const PANEL_MAX_APK_BYTES = 209715200;
const PANEL_BACKUP_LIMIT = 10;
const PANEL_AOSP_TEST_CERT = 'a40da80a59d170caa950cf15c18c454d47a39b26989d8b640ecd745ba71bf5dc';

function panel_boot(): void
{
    if (PHP_SAPI === 'cli') {
        return;
    }
    if (!isset($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off') {
        http_response_code(400);
        exit('HTTPS required');
    }
    session_name('seskia_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    header('Cache-Control: no-store, private, max-age=0');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    $nonce = panel_nonce();
    header("Content-Security-Policy: default-src 'none'; style-src 'nonce-{$nonce}'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

function panel_nonce(): string
{
    static $nonce = null;
    if ($nonce === null) {
        $nonce = base64_encode(random_bytes(18));
    }
    return $nonce;
}

function panel_config(): array
{
    if (!is_file(PANEL_CONFIG_FILE) || is_link(PANEL_CONFIG_FILE)) {
        throw new RuntimeException('فایل تنظیمات Seskia پیدا نشد.');
    }
    $raw = file_get_contents(PANEL_CONFIG_FILE);
    if ($raw === false) {
        throw new RuntimeException('خواندن تنظیمات ممکن نیست.');
    }
    $config = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($config)) {
        throw new RuntimeException('ساختار تنظیمات معتبر نیست.');
    }
    foreach (['chat_ids', 'admin_chat_ids', 'apk_channel_ids'] as $key) {
        if (!isset($config[$key]) || !is_array($config[$key])) {
            $config[$key] = [];
        }
        $config[$key] = array_values(array_unique(array_map('strval', $config[$key])));
    }
    $config['bot_token'] = (string) ($config['bot_token'] ?? '');
    $config['admin_password_hash'] = (string) ($config['admin_password_hash'] ?? '');
    $config['webhook_secret'] = (string) ($config['webhook_secret'] ?? '');
    $config['apk_name'] = (string) ($config['apk_name'] ?? 'hamkare.apk');
    $config['apk_filename_regex'] = (string) ($config['apk_filename_regex'] ?? '/\.apk$/i');
    $config['apk_signer_sha256'] = strtolower((string) ($config['apk_signer_sha256'] ?? ''));
    return $config;
}

function panel_write_json(string $path, array $value, int $mode = 0600): void
{
    $directory = dirname($path);
    if (!is_dir($directory) || is_link($directory) || !is_writable($directory)) {
        throw new RuntimeException('پوشه تنظیمات قابل نوشتن نیست.');
    }
    $temporary = tempnam($directory, '.panel-');
    if ($temporary === false) {
        throw new RuntimeException('ساخت فایل موقت ناموفق بود.');
    }
    try {
        $json = json_encode(
            $value,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        ) . "\n";
        if (file_put_contents($temporary, $json, LOCK_EX) === false) {
            throw new RuntimeException('نوشتن فایل موقت ناموفق بود.');
        }
        chmod($temporary, $mode);
        $handle = fopen($temporary, 'rb');
        if ($handle !== false) {
            if (function_exists('fsync')) {
                fsync($handle);
            }
            fclose($handle);
        }
        if (!rename($temporary, $path)) {
            throw new RuntimeException('جایگزینی اتمیک تنظیمات ناموفق بود.');
        }
    } finally {
        if (is_file($temporary)) {
            @unlink($temporary);
        }
    }
}

function panel_write_config(array $config): void
{
    panel_write_json(PANEL_CONFIG_FILE, $config, 0600);
}

function panel_config_lock()
{
    $path = PANEL_STATE_DIR . '/admin-config.lock';
    if (is_link($path)) {
        throw new RuntimeException('قفل تنظیمات معتبر نیست.');
    }
    $handle = fopen($path, 'c+b');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        throw new RuntimeException('قفل تنظیمات در دسترس نیست.');
    }
    @chmod($path, 0600);
    return $handle;
}

function panel_release_config_lock($handle): void
{
    if (is_resource($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function panel_mask_token(string $token): string
{
    if ($token === '') {
        return 'تنظیم نشده';
    }
    $suffix = substr($token, -6);
    return '••••••••••' . $suffix;
}

function panel_parse_ids(string $input, string $label): array
{
    $items = preg_split('/[\s,،;]+/u', trim($input), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $result = [];
    foreach ($items as $item) {
        $item = trim((string) $item);
        if (!preg_match('/^-?\d{3,30}$/D', $item)) {
            throw new InvalidArgumentException("{$label} شامل شناسه نامعتبر است.");
        }
        $result[] = $item;
    }
    return array_values(array_unique($result));
}

function panel_csrf(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf'];
}

function panel_require_csrf(): void
{
    $sent = (string) ($_POST['csrf'] ?? '');
    if ($sent === '' || !hash_equals(panel_csrf(), $sent)) {
        throw new RuntimeException('نشست منقضی شده است؛ صفحه را تازه‌سازی کنید.');
    }
}

function panel_is_authenticated(): bool
{
    $active = !empty($_SESSION['admin_authenticated'])
        && !empty($_SESSION['admin_last_seen'])
        && (time() - (int) $_SESSION['admin_last_seen']) <= 1800;
    if (!$active || empty($_SESSION['admin_auth_version'])) {
        return false;
    }
    try {
        $config = panel_config();
        $expected = hash('sha256', (string) $config['admin_password_hash']);
        return hash_equals($expected, (string) $_SESSION['admin_auth_version']);
    } catch (Throwable) {
        return false;
    }
}

function panel_touch_auth(): void
{
    $_SESSION['admin_last_seen'] = time();
}

function panel_client_key(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return hash('sha256', $ip);
}

function panel_login_state(): array
{
    if (!is_file(PANEL_LOGIN_RATE)) {
        return [];
    }
    $raw = file_get_contents(PANEL_LOGIN_RATE);
    if ($raw === false) {
        return [];
    }
    $state = json_decode($raw, true);
    return is_array($state) ? $state : [];
}

function panel_login(string $password): bool
{
    $lock = fopen(PANEL_STATE_DIR . '/admin-login-rate.lock', 'c+b');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        throw new RuntimeException('کنترل امنیت ورود موقتاً در دسترس نیست.');
    }
    try {
        $state = panel_login_state();
        $key = panel_client_key();
        $entry = $state[$key] ?? ['attempts' => 0, 'first_at' => time(), 'blocked_until' => 0];
        if ((int) ($entry['blocked_until'] ?? 0) > time()) {
            throw new RuntimeException('ورود موقتاً قفل شده است؛ ۱۵ دقیقه بعد تلاش کنید.');
        }
        $config = panel_config();
        $hash = (string) $config['admin_password_hash'];
        $valid = $hash !== '' && password_verify($password, $hash);
        if ($valid) {
            unset($state[$key]);
        } else {
            if (time() - (int) ($entry['first_at'] ?? 0) > 900) {
                $entry = ['attempts' => 0, 'first_at' => time(), 'blocked_until' => 0];
            }
            $entry['attempts'] = (int) ($entry['attempts'] ?? 0) + 1;
            if ($entry['attempts'] >= 5) {
                $entry['blocked_until'] = time() + 900;
            }
            $state[$key] = $entry;
        }
        foreach ($state as $stateKey => $stateEntry) {
            if (time() - (int) ($stateEntry['first_at'] ?? 0) > 86400) {
                unset($state[$stateKey]);
            }
        }
        panel_write_json(PANEL_LOGIN_RATE, $state, 0600);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    if (!$valid) {
        return false;
    }
    session_regenerate_id(true);
    $_SESSION['admin_authenticated'] = true;
    $_SESSION['admin_last_seen'] = time();
    $_SESSION['admin_auth_version'] = hash('sha256', $hash);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return true;
}

function panel_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], '', true, true);
    }
    session_destroy();
}

function panel_flash(string $type, string $message): void
{
    $_SESSION['flash'] = ['type' => $type, 'message' => $message];
}

function panel_take_flash(): ?array
{
    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return is_array($flash) ? $flash : null;
}

function panel_audit(string $action, array $detail = []): void
{
    $record = [
        'time' => gmdate('c'),
        'action' => preg_replace('/[^a-z0-9_.-]/i', '', $action),
        'actor' => panel_client_key(),
        'detail' => $detail,
    ];
    $line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
    $handle = fopen(PANEL_AUDIT_LOG, 'c+b');
    if ($handle !== false) {
        if (flock($handle, LOCK_EX)) {
            $stat = fstat($handle);
            if (is_array($stat) && (int) ($stat['size'] ?? 0) > 2097152) {
                ftruncate($handle, 0);
            }
            fseek($handle, 0, SEEK_END);
            fwrite($handle, $line);
            fflush($handle);
            flock($handle, LOCK_UN);
        }
        fclose($handle);
        @chmod(PANEL_AUDIT_LOG, 0600);
    }
}

function panel_telegram_call(string $token, string $method, array $payload = []): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('افزونه cURL روی سرور نصب نیست.');
    }
    $curl = curl_init('https://api.telegram.org/bot' . $token . '/' . $method);
    if ($curl === false) {
        throw new RuntimeException('آغاز ارتباط تلگرام ناموفق بود.');
    }
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if (!is_string($body) || $status !== 200) {
        throw new RuntimeException('ارتباط با Telegram Bot API ناموفق بود.', $status);
    }
    $decoded = json_decode($body, true);
    if (!is_array($decoded) || empty($decoded['ok'])) {
        throw new RuntimeException('تلگرام توکن یا درخواست را نپذیرفت.', $status);
    }
    return $decoded;
}

function panel_set_webhook(string $token, string $secret): void
{
    $webhook = PANEL_WEBHOOK_URL . '?secret=' . rawurlencode($secret);
    panel_telegram_call($token, 'setWebhook', [
        'url' => $webhook,
        'secret_token' => $secret,
        'allowed_updates' => json_encode([
            'message',
            'channel_post',
            'edited_channel_post',
            'callback_query',
        ], JSON_THROW_ON_ERROR),
        'drop_pending_updates' => 'false',
    ]);
}

function panel_update_telegram(array $input): string
{
    $configLock = panel_config_lock();
    try {
        $oldConfig = panel_config();
        $config = $oldConfig;
        $newToken = trim((string) ($input['bot_token'] ?? ''));
        if ($newToken === '') {
            $newToken = (string) $oldConfig['bot_token'];
        }
        if (!preg_match('/^\d{6,15}:[A-Za-z0-9_-]{30,100}$/D', $newToken)) {
            throw new InvalidArgumentException('توکن بات تلگرام معتبر نیست.');
        }
        $identity = panel_telegram_call($newToken, 'getMe');
        $adminIds = panel_parse_ids((string) ($input['admin_chat_ids'] ?? ''), 'شناسه مدیر آپلود');
        $reportIds = panel_parse_ids((string) ($input['chat_ids'] ?? ''), 'چت‌آیدی گزارش');
        $channelIds = panel_parse_ids((string) ($input['apk_channel_ids'] ?? ''), 'شناسه کانال APK');
        if (!$adminIds) {
            throw new InvalidArgumentException('حداقل یک شناسه عددی مدیر آپلود لازم است.');
        }
        if (!$reportIds) {
            throw new InvalidArgumentException('حداقل یک چت‌آیدی گزارش لازم است.');
        }
        foreach ($adminIds as $adminId) {
            if (str_starts_with($adminId, '-')) {
                throw new InvalidArgumentException('شناسه مدیر آپلود باید شناسه مثبت حساب کاربری باشد.');
            }
        }
        foreach ($channelIds as $channelId) {
            if (!str_starts_with($channelId, '-100')) {
                throw new InvalidArgumentException('شناسه کانال APK باید با ‎-100 شروع شود.');
            }
        }
        foreach ($reportIds as $reportId) {
            try {
                panel_telegram_call($newToken, 'getChat', ['chat_id' => $reportId]);
            } catch (Throwable) {
                throw new InvalidArgumentException("چت گزارش {$reportId} برای این بات قابل دسترسی نیست.");
            }
        }
        foreach ($channelIds as $channelId) {
            try {
                panel_telegram_call($newToken, 'getChat', ['chat_id' => $channelId]);
            } catch (Throwable) {
                throw new InvalidArgumentException("کانال APK {$channelId} برای این بات قابل دسترسی نیست.");
            }
        }
        $secret = (string) $oldConfig['webhook_secret'];
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $secret)) {
            $secret = bin2hex(random_bytes(24));
        }
        $config['bot_token'] = $newToken;
        $config['admin_chat_ids'] = $adminIds;
        $config['chat_ids'] = $reportIds;
        $config['apk_channel_ids'] = $channelIds;
        $config['webhook_secret'] = $secret;
        $config['apk_filename_regex'] = '/\.apk$/i';
        $config['apk_name'] = 'hamkare.apk';
        $oldToken = (string) $oldConfig['bot_token'];
        $tokenChanged = !hash_equals($oldToken, $newToken);
        $oldWebhookInactive = false;
        $newWebhookSet = false;
        try {
            if ($tokenChanged && $oldToken !== '') {
                try {
                    panel_telegram_call($oldToken, 'deleteWebhook', ['drop_pending_updates' => 'false']);
                    $oldWebhookInactive = true;
                } catch (RuntimeException $deleteError) {
                    if ($deleteError->getCode() !== 401) {
                        throw $deleteError;
                    }
                    // A revoked token cannot deliver updates; it is already inactive.
                    $oldWebhookInactive = true;
                }
            }
            panel_set_webhook($newToken, $secret);
            $newWebhookSet = true;
            panel_write_config($config);
        } catch (Throwable $error) {
            if ($newWebhookSet && $tokenChanged) {
                try {
                    panel_telegram_call($newToken, 'deleteWebhook', ['drop_pending_updates' => 'false']);
                } catch (Throwable) {
                    // Continue restoring the previous receiver and preserve the original failure.
                }
            }
            $oldRestored = false;
            $oldSecret = (string) $oldConfig['webhook_secret'];
            if (($oldWebhookInactive || !$tokenChanged) && $oldToken !== ''
                && preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $oldSecret)) {
                try {
                    panel_set_webhook($oldToken, $oldSecret);
                    $oldRestored = true;
                } catch (Throwable) {
                    // Audit records the failed transaction; an operator can retry from the panel.
                }
            }
            if ($newWebhookSet && !$tokenChanged && !$oldRestored) {
                try {
                    panel_telegram_call($newToken, 'deleteWebhook', ['drop_pending_updates' => 'false']);
                } catch (Throwable) {
                    // Preserve the original failure; the audit flags the incomplete transaction.
                }
            }
            panel_write_config($oldConfig);
            panel_audit('telegram_config_update_failed', [
                'new_webhook_set' => $newWebhookSet,
                'old_webhook_inactive' => $oldWebhookInactive,
                'token_changed' => $tokenChanged,
            ]);
            throw $error;
        }
        $username = (string) ($identity['result']['username'] ?? 'بدون نام کاربری');
        panel_audit('telegram_config_updated', [
            'bot_username' => $username,
            'admin_count' => count($adminIds),
            'report_count' => count($reportIds),
            'channel_count' => count($channelIds),
        ]);
        panel_notify("✅ تنظیمات بات آپلود APK از پنل مدیریت به‌روزرسانی شد.\nبات: @{$username}");
        return $username;
    } finally {
        panel_release_config_lock($configLock);
    }
}

function panel_notify(string $message): void
{
    try {
        $config = panel_config();
        $token = (string) $config['bot_token'];
        if ($token === '') {
            return;
        }
        foreach ($config['chat_ids'] as $chatId) {
            try {
                panel_telegram_call($token, 'sendMessage', [
                    'chat_id' => (string) $chatId,
                    'text' => $message,
                    'disable_web_page_preview' => 'true',
                ]);
            } catch (Throwable) {
                // A report failure must not undo a valid configuration or APK publication.
            }
        }
    } catch (Throwable) {
        // Notifications are best effort and never contain secrets.
    }
}

function panel_run(array $arguments): array
{
    if (!function_exists('exec')) {
        throw new RuntimeException('اجرای ابزار اعتبارسنجی روی PHP غیرفعال است.');
    }
    $command = implode(' ', array_map('escapeshellarg', $arguments)) . ' 2>&1';
    $lines = [];
    $code = 0;
    exec($command, $lines, $code);
    return [$code, implode("\n", $lines)];
}

function panel_validate_apk(string $path): array
{
    if (!is_file($path) || is_link($path)) {
        throw new InvalidArgumentException('فایل APK معتبر پیدا نشد.');
    }
    $size = filesize($path);
    if ($size === false || $size < 1024 || $size > PANEL_MAX_APK_BYTES) {
        throw new InvalidArgumentException('اندازه APK باید بین ۱ کیلوبایت و ۲۰۰ مگابایت باشد.');
    }
    $handle = fopen($path, 'rb');
    if ($handle === false || fread($handle, 4) !== "PK\x03\x04") {
        if (is_resource($handle)) {
            fclose($handle);
        }
        throw new InvalidArgumentException('ساختار اولیه APK معتبر نیست.');
    }
    fclose($handle);
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('افزونه PHP ZipArchive نصب نیست.');
    }
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::RDONLY) !== true) {
        throw new InvalidArgumentException('بازکردن آرشیو APK ناموفق بود.');
    }
    $hasManifest = $zip->locateName('AndroidManifest.xml', ZipArchive::FL_NOCASE) !== false;
    $hasDex = $zip->locateName('classes.dex', ZipArchive::FL_NOCASE) !== false;
    $zip->close();
    if (!$hasManifest || !$hasDex) {
        throw new InvalidArgumentException('APK فاقد Manifest یا classes.dex است.');
    }
    [$zipCode] = panel_run(['/usr/bin/unzip', '-tqq', $path]);
    if ($zipCode !== 0) {
        throw new InvalidArgumentException('آرشیو APK خراب یا دارای ورودی رمزگذاری‌شده است.');
    }
    [$signCode, $signOutput] = panel_run([
        '/usr/bin/apksigner',
        'verify',
        '--verbose',
        '--print-certs',
        $path,
    ]);
    if ($signCode !== 0) {
        throw new InvalidArgumentException('امضای دیجیتال APK معتبر نیست.');
    }
    preg_match_all('/certificate SHA-256 digest:\s*([0-9a-f]{64})/i', $signOutput, $matches);
    $certificates = array_map('strtolower', $matches[1] ?? []);
    if (!$certificates) {
        throw new InvalidArgumentException('گواهی امضاکننده APK قابل تشخیص نیست.');
    }
    if (in_array(PANEL_AOSP_TEST_CERT, $certificates, true)) {
        throw new InvalidArgumentException('APK با کلید عمومی تست Android امضا شده و قابل انتشار نیست.');
    }
    $trustedSigner = (string) panel_config()['apk_signer_sha256'];
    if (!preg_match('/^[0-9a-f]{64}$/D', $trustedSigner)) {
        throw new RuntimeException('گواهی امضای مورد اعتماد APK در config تنظیم نشده است.');
    }
    if (!in_array($trustedSigner, $certificates, true)) {
        throw new InvalidArgumentException('گواهی امضای APK با نسخه رسمی فعلی یکسان نیست.');
    }
    $digest = hash_file('sha256', $path);
    if (!is_string($digest)) {
        throw new RuntimeException('محاسبه SHA-256 ناموفق بود.');
    }
    return [
        'size' => (int) $size,
        'sha256' => $digest,
        'certificate_sha256' => $certificates[0],
    ];
}

function panel_assert_apk_paths(): void
{
    foreach ([PANEL_APK_STAGE, PANEL_APK_BACKUPS] as $directory) {
        if (!is_dir($directory) || is_link($directory) || !is_writable($directory)) {
            throw new RuntimeException('یکی از مسیرهای محافظت‌شده APK معتبر نیست.');
        }
    }
    if (is_link(PANEL_APK_LIVE)) {
        throw new RuntimeException('فایل فعال APK نباید symbolic link باشد.');
    }
}

function panel_apk_lock()
{
    panel_assert_apk_paths();
    $handle = fopen(PANEL_APK_STAGE . '/publish.lock', 'c+b');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        throw new RuntimeException('قفل انتشار APK در دسترس نیست.');
    }
    @chmod(PANEL_APK_STAGE . '/publish.lock', 0600);
    return $handle;
}

function panel_release_lock($handle): void
{
    if (is_resource($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function panel_unique_stage(string $prefix): string
{
    return PANEL_APK_STAGE . '/' . $prefix . '-' . bin2hex(random_bytes(16)) . '.tmp';
}

function panel_backup_live(string $digest): string
{
    panel_assert_apk_paths();
    $path = PANEL_APK_BACKUPS . '/app-' . gmdate('Ymd-His') . '-' . substr($digest, 0, 12) . '.apk';
    if (!copy(PANEL_APK_LIVE, $path)) {
        throw new RuntimeException('بکاپ نسخه جاری ساخته نشد.');
    }
    chmod($path, 0600);
    return $path;
}

function panel_prune_backups(): void
{
    $backups = glob(PANEL_APK_BACKUPS . '/app-*.apk') ?: [];
    usort($backups, static fn(string $a, string $b): int => filemtime($b) <=> filemtime($a));
    foreach (array_slice($backups, PANEL_BACKUP_LIMIT) as $old) {
        @unlink($old);
    }
}

function panel_public_apk_matches(string $expectedDigest): bool
{
    if (!function_exists('curl_init')) {
        return false;
    }
    $temporary = panel_unique_stage('public-verify');
    $handle = fopen($temporary, 'w+b');
    if ($handle === false) {
        return false;
    }
    $received = 0;
    $curl = curl_init(PANEL_PUBLIC_URL . '?verify=' . rawurlencode(substr($expectedDigest, 0, 16)));
    if ($curl === false) {
        fclose($handle);
        @unlink($temporary);
        return false;
    }
    curl_setopt_array($curl, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Cache-Control: no-cache', 'Accept: application/vnd.android.package-archive'],
        CURLOPT_WRITEFUNCTION => static function ($curlHandle, string $chunk) use ($handle, &$received): int {
            $received += strlen($chunk);
            if ($received > PANEL_MAX_APK_BYTES) {
                return 0;
            }
            $written = fwrite($handle, $chunk);
            return $written === false ? 0 : $written;
        },
    ]);
    $ok = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $type = strtolower((string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE));
    curl_close($curl);
    fflush($handle);
    fclose($handle);
    $digest = is_file($temporary) ? hash_file('sha256', $temporary) : false;
    @unlink($temporary);
    return $ok !== false
        && $status === 200
        && $received > 0
        && $received <= PANEL_MAX_APK_BYTES
        && !str_contains($type, 'text/html')
        && !str_contains($type, 'application/json')
        && is_string($digest)
        && hash_equals($expectedDigest, $digest);
}

function panel_restore_rejected(string $rejectedDigest, ?string $previousBackup): bool
{
    $lock = panel_apk_lock();
    $temporary = '';
    try {
        if (!is_file(PANEL_APK_LIVE)) {
            return false;
        }
        $liveDigest = hash_file('sha256', PANEL_APK_LIVE);
        if (!is_string($liveDigest) || !hash_equals($rejectedDigest, $liveDigest)) {
            return false;
        }
        if ($previousBackup === null) {
            return unlink(PANEL_APK_LIVE);
        }
        $temporary = panel_unique_stage('restore');
        if (!copy($previousBackup, $temporary)) {
            return false;
        }
        chmod($temporary, 0644);
        if (!rename($temporary, PANEL_APK_LIVE)) {
            return false;
        }
        $temporary = '';
        return true;
    } finally {
        if ($temporary !== '' && is_file($temporary)) {
            @unlink($temporary);
        }
        panel_release_lock($lock);
    }
}

function panel_publish_upload(array $upload): array
{
    panel_assert_apk_paths();
    if ((int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new InvalidArgumentException('آپلود فایل کامل انجام نشد.');
    }
    $name = (string) ($upload['name'] ?? '');
    $source = (string) ($upload['tmp_name'] ?? '');
    if (!preg_match('/\.apk$/iD', $name) || !is_uploaded_file($source)) {
        throw new InvalidArgumentException('فقط فایل APK ارسالی از فرم پذیرفته می‌شود.');
    }
    $declared = (int) ($upload['size'] ?? 0);
    if ($declared <= 0 || $declared > PANEL_MAX_APK_BYTES) {
        throw new InvalidArgumentException('اندازه فایل از محدوده ۲۰۰ مگابایت خارج است.');
    }
    $staged = panel_unique_stage('browser-upload');
    if (!move_uploaded_file($source, $staged)) {
        throw new RuntimeException('انتقال فایل به staging ناموفق بود.');
    }
    chmod($staged, 0600);
    $previousBackup = null;
    try {
        $validation = panel_validate_apk($staged);
        if ((int) $validation['size'] !== $declared) {
            throw new InvalidArgumentException('اندازه واقعی APK با فرم یکسان نیست.');
        }
        $lock = panel_apk_lock();
        try {
            $stagedDigest = hash_file('sha256', $staged);
            if (!is_string($stagedDigest) || !hash_equals($validation['sha256'], $stagedDigest)) {
                throw new RuntimeException('فایل staging پس از اعتبارسنجی تغییر کرده است.');
            }
            if (is_file(PANEL_APK_LIVE)) {
                $liveDigest = hash_file('sha256', PANEL_APK_LIVE);
                if (is_string($liveDigest) && hash_equals($stagedDigest, $liveDigest)) {
                    panel_audit('apk_duplicate', ['sha256' => $stagedDigest]);
                    return $validation + ['duplicate' => true];
                }
                if (!is_string($liveDigest)) {
                    throw new RuntimeException('خواندن نسخه جاری ناموفق بود.');
                }
                $previousBackup = panel_backup_live($liveDigest);
            }
            chmod($staged, 0644);
            if (!rename($staged, PANEL_APK_LIVE)) {
                throw new RuntimeException('انتشار اتمیک APK ناموفق بود.');
            }
            $staged = '';
            panel_prune_backups();
        } finally {
            panel_release_lock($lock);
        }
        if (!panel_public_apk_matches($validation['sha256'])) {
            $restored = panel_restore_rejected($validation['sha256'], $previousBackup);
            panel_audit('apk_public_verify_failed', [
                'sha256' => $validation['sha256'],
                'restored' => $restored,
            ]);
            if ($restored) {
                throw new RuntimeException('لینک عمومی فایل تازه را نشان نداد؛ نسخه قبلی خودکار بازگردانده شد.');
            }
            throw new RuntimeException('تطبیق لینک عمومی ناموفق بود؛ وضعیت سرور فوراً بررسی شود.');
        }
        try {
            panel_write_json(PANEL_APK_METADATA, [
                'source' => 'secure-admin-panel',
                'published_at' => gmdate('c'),
                'size' => $validation['size'],
                'sha256' => $validation['sha256'],
                'certificate_sha256' => $validation['certificate_sha256'],
            ], 0600);
        } catch (Throwable $metadataError) {
            $restored = panel_restore_rejected($validation['sha256'], $previousBackup);
            if ($restored) {
                throw new RuntimeException('ثبت وضعیت انتشار ناموفق بود؛ نسخه قبلی خودکار بازگردانده شد.', 0, $metadataError);
            }
            throw new RuntimeException('ثبت وضعیت انتشار و بازگردانی هر دو ناموفق شدند؛ سرور فوراً بررسی شود.', 0, $metadataError);
        }
        panel_audit('apk_published', [
            'sha256' => $validation['sha256'],
            'size' => $validation['size'],
        ]);
        panel_notify(
            "✅ APK همکاره از پنل وب منتشر شد.\n"
            . 'حجم: ' . number_format($validation['size'] / 1048576, 2) . " MB\n"
            . 'SHA-256: ' . substr($validation['sha256'], 0, 16) . "…\n"
            . PANEL_PUBLIC_URL
        );
        return $validation + ['duplicate' => false];
    } finally {
        if ($staged !== '' && is_file($staged)) {
            @unlink($staged);
        }
    }
}

function panel_latest_backup(): ?string
{
    $backups = glob(PANEL_APK_BACKUPS . '/app-*.apk') ?: [];
    usort($backups, static fn(string $a, string $b): int => filemtime($b) <=> filemtime($a));
    return $backups[0] ?? null;
}

function panel_rollback_latest(): array
{
    panel_assert_apk_paths();
    $backup = panel_latest_backup();
    if ($backup === null || !is_file($backup)) {
        throw new RuntimeException('نسخه پشتیبان برای بازگردانی وجود ندارد.');
    }
    $staged = panel_unique_stage('rollback');
    $currentBackup = null;
    try {
        if (!copy($backup, $staged)) {
            throw new RuntimeException('کپی نسخه پشتیبان ناموفق بود.');
        }
        chmod($staged, 0600);
        $validation = panel_validate_apk($staged);
        $lock = panel_apk_lock();
        try {
            if (is_file(PANEL_APK_LIVE)) {
                $currentDigest = hash_file('sha256', PANEL_APK_LIVE);
                if (!is_string($currentDigest)) {
                    throw new RuntimeException('خواندن نسخه جاری ناموفق بود.');
                }
                $currentBackup = panel_backup_live($currentDigest);
            }
            chmod($staged, 0644);
            if (!rename($staged, PANEL_APK_LIVE)) {
                throw new RuntimeException('بازگردانی اتمیک ناموفق بود.');
            }
            $staged = '';
            panel_prune_backups();
        } finally {
            panel_release_lock($lock);
        }
        if (!panel_public_apk_matches($validation['sha256'])) {
            $restored = panel_restore_rejected($validation['sha256'], $currentBackup);
            if ($restored) {
                throw new RuntimeException('لینک عمومی نسخه انتخاب‌شده را نشان نداد؛ نسخه جاری حفظ شد.');
            }
            throw new RuntimeException('تأیید عمومی rollback ناموفق بود؛ وضعیت سرور بررسی شود.');
        }
        try {
            panel_write_json(PANEL_APK_METADATA, [
                'source' => 'secure-admin-panel-rollback',
                'published_at' => gmdate('c'),
                'size' => $validation['size'],
                'sha256' => $validation['sha256'],
                'certificate_sha256' => $validation['certificate_sha256'],
            ], 0600);
        } catch (Throwable $metadataError) {
            $restored = panel_restore_rejected($validation['sha256'], $currentBackup);
            if ($restored) {
                throw new RuntimeException('ثبت وضعیت rollback ناموفق بود؛ نسخه قبلی خودکار حفظ شد.', 0, $metadataError);
            }
            throw new RuntimeException('ثبت وضعیت rollback و بازگردانی هر دو ناموفق شدند؛ سرور فوراً بررسی شود.', 0, $metadataError);
        }
        panel_audit('apk_rolled_back', ['sha256' => $validation['sha256']]);
        panel_notify(
            "↩️ نسخه قبلی APK از پنل وب بازگردانده شد.\n"
            . 'SHA-256: ' . substr($validation['sha256'], 0, 16) . '…'
        );
        return $validation;
    } finally {
        if ($staged !== '' && is_file($staged)) {
            @unlink($staged);
        }
    }
}

function panel_change_password(string $current, string $new, string $confirm): void
{
    $configLock = panel_config_lock();
    try {
        $config = panel_config();
        if (!password_verify($current, (string) $config['admin_password_hash'])) {
            throw new InvalidArgumentException('رمز فعلی صحیح نیست.');
        }
        $length = preg_match_all('/./us', $new, $characters);
        if ($new !== $confirm || $length === false || $length < 12 || $length > 200) {
            throw new InvalidArgumentException('رمز جدید باید یکسان و حداقل ۱۲ نویسه باشد.');
        }
        $newHash = password_hash($new, PASSWORD_DEFAULT);
        $config['admin_password_hash'] = $newHash;
        panel_write_config($config);
        panel_audit('admin_password_changed');
        session_regenerate_id(true);
        $_SESSION['admin_auth_version'] = hash('sha256', $newHash);
    } finally {
        panel_release_config_lock($configLock);
    }
}

function panel_status(): array
{
    $config = panel_config();
    $metadata = [];
    if (is_file(PANEL_APK_METADATA)) {
        $decoded = json_decode((string) file_get_contents(PANEL_APK_METADATA), true);
        if (is_array($decoded)) {
            $metadata = $decoded;
        }
    }
    $liveRegular = is_file(PANEL_APK_LIVE) && !is_link(PANEL_APK_LIVE);
    $liveSize = $liveRegular ? filesize(PANEL_APK_LIVE) : false;
    $liveDigest = $liveRegular ? hash_file('sha256', PANEL_APK_LIVE) : false;
    return [
        'token_masked' => panel_mask_token((string) $config['bot_token']),
        'admin_chat_ids' => $config['admin_chat_ids'],
        'chat_ids' => $config['chat_ids'],
        'apk_channel_ids' => $config['apk_channel_ids'],
        'apk_signer_masked' => $config['apk_signer_sha256'] !== ''
            ? substr($config['apk_signer_sha256'], 0, 12) . '…'
            : 'تنظیم نشده',
        'live_size' => is_int($liveSize) ? $liveSize : 0,
        'live_sha256' => is_string($liveDigest) ? $liveDigest : '',
        'metadata' => $metadata,
        'backup_count' => is_dir(PANEL_APK_BACKUPS) && !is_link(PANEL_APK_BACKUPS)
            ? count(glob(PANEL_APK_BACKUPS . '/app-*.apk') ?: [])
            : 0,
        'public_url' => PANEL_PUBLIC_URL,
    ];
}
