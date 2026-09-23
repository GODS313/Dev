<?php
declare(strict_types=1);

namespace App\Tasks;

use App\Core\Channels;
use App\Core\Config;
use App\Core\Http;

/**
 * Task #1 — Build APK publishing.
 *
 * Fetches a finished, signed APK from a configured URL and publishes it to the
 * download site (/x/) over a signed server-to-server API, then delivers the
 * resulting link. It never drives another Telegram bot; that is impossible with
 * the official Bot API. Runs advance one resumable step at a time so a restart
 * continues instead of re-publishing.
 */
final class BuildApkTask implements Task
{
    public function key(): string
    {
        return 'build_apk';
    }

    public function label(): string
    {
        return 'ساخت و انتشار APK';
    }

    public function defaultSettings(): array
    {
        return [
            'app_name' => 'iLiveX',
            'logo_url' => '',
            'source_url' => '',
            'publish_url' => 'https://etebarami.net/x/publish.php',
            'version' => '',
            'delivery_connector_id' => '',
            'delivery_chat_id' => '',
        ];
    }

    public function fields(): array
    {
        return [
            'app_name' => ['label' => 'نام اپلیکیشن', 'type' => 'text', 'help' => 'پیش‌فرض: iLiveX'],
            'logo_url' => ['label' => 'آدرس لوگو (اختیاری)', 'type' => 'url'],
            'source_url' => ['label' => 'آدرس دریافت فایل APK ساخته‌شده', 'type' => 'url', 'help' => 'لینک مستقیم فایل نهایی و امضاشده'],
            'publish_url' => ['label' => 'آدرس نقطه انتشار روی سایت دانلود', 'type' => 'url', 'help' => 'مثلاً https://etebarami.net/x/publish.php'],
            'version' => ['label' => 'نسخه (اختیاری)', 'type' => 'text', 'help' => 'خالی = تاریخ‌وزمان خودکار'],
            'delivery_connector_id' => ['label' => 'کانکتور تحویل لینک (اختیاری)', 'type' => 'number', 'help' => 'شناسه کانکتور تلگرام/بله برای ارسال لینک به یک کانال/چت'],
            'delivery_chat_id' => ['label' => 'شناسه چت/کانال تحویل (اختیاری)', 'type' => 'text'],
            'publish_secret' => ['label' => 'کلید امن انتشار (بین پنل و سایت دانلود)', 'type' => 'text', 'secret' => true, 'help' => 'اگر خالی بماند مقدار پیش‌فرض سرور استفاده می‌شود'],
        ];
    }

    public function secretField(): ?string
    {
        return 'publish_secret';
    }

    private function secretOrDefault(?string $secret): string
    {
        return $secret ?: (string) Config::get('XBUILD_SECRET', '');
    }

    public function step(array $s, ?string $secret, array $run): array
    {
        return match ($run['status']) {
            'queued' => $this->fetch($s, $run),
            'publishing' => $this->publish($s, $this->secretOrDefault($secret), $run),
            'delivering' => $this->deliver($s, $run),
            default => ['status' => $run['status']],
        };
    }

    private function tmpPath(array $run): string
    {
        $dir = Config::storagePath('build');
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        return $dir . '/run-' . $run['id'] . '.apk';
    }

    /** Stages an operator-uploaded APK for a run so publishing can pick it up. */
    public function stageUpload(array $run, string $bytes): bool
    {
        return @file_put_contents($this->tmpPath($run), $bytes, LOCK_EX) !== false;
    }

    /** True if this exact file was already published successfully. */
    public static function alreadyPublished(string $sha): bool
    {
        return \App\Core\Database::scalar(
            "SELECT 1 FROM task_runs WHERE task_key = 'build_apk' AND status = 'done' AND ref = ? LIMIT 1",
            [$sha]
        ) ? true : false;
    }

    private function fetch(array $s, array $run): array
    {
        $url = trim((string) ($s['source_url'] ?? ''));
        if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
            return ['status' => 'failed', 'log' => ['آدرس دریافت APK تنظیم نشده یا نامعتبر است']];
        }
        $res = Http::request('GET', $url, ['timeout' => 180, 'max_bytes' => 80 * 1024 * 1024]);
        if (!$res['ok']) {
            return ['status' => 'failed', 'log' => ['دریافت ناموفق (HTTP ' . $res['status'] . ') ' . ($res['error'] ?? '')]];
        }
        $bytes = $res['body'];
        if (strlen($bytes) < 1000 || substr($bytes, 0, 2) !== 'PK') {
            return ['status' => 'failed', 'log' => ['فایل دریافتی یک APK معتبر نیست']];
        }
        $sha = hash('sha256', $bytes);
        // Skip if this exact file was already published successfully by this task.
        $lastRef = \App\Core\Database::scalar(
            "SELECT ref FROM task_runs WHERE task_key = 'build_apk' AND status = 'done' AND ref = ? LIMIT 1",
            [$sha]
        );
        if ($lastRef !== false && $lastRef !== null) {
            return ['status' => 'skipped', 'ref' => $sha, 'log' => ['همین فایل قبلاً منتشر شده؛ از انتشار تکراری صرف‌نظر شد']];
        }
        if (@file_put_contents($this->tmpPath($run), $bytes, LOCK_EX) === false) {
            return ['status' => 'failed', 'log' => ['نوشتن فایل موقت ممکن نشد (فضای دیسک؟)']];
        }
        return ['status' => 'publishing', 'ref' => $sha, 'log' => ['فایل دریافت شد (' . round(strlen($bytes) / 1048576, 2) . ' مگابایت)']];
    }

    private function publish(array $s, string $secret, array $run): array
    {
        $publishUrl = trim((string) ($s['publish_url'] ?? ''));
        if ($publishUrl === '' || $secret === '') {
            return ['status' => 'failed', 'log' => ['آدرس انتشار یا کلید امن تنظیم نشده']];
        }
        $file = $this->tmpPath($run);
        $bytes = is_file($file) ? (string) file_get_contents($file) : '';
        if ($bytes === '') {
            return ['status' => 'queued', 'log' => ['فایل موقت پیدا نشد؛ دریافت دوباره انجام می‌شود']];
        }
        $name = trim((string) ($s['app_name'] ?? 'iLiveX')) ?: 'iLiveX';
        $version = trim((string) ($s['version'] ?? '')) ?: gmdate('Ymd.Hi');
        $ts = (string) time();
        $bodyHash = hash('sha256', $bytes);
        $sig = hash_hmac('sha256', $ts . "\n" . $name . "\n" . $version . "\n" . $bodyHash, $secret);
        $res = Http::request('POST', $publishUrl, [
            'timeout' => 120,
            'body' => $bytes,
            'headers' => [
                'Content-Type' => 'application/vnd.android.package-archive',
                'X-App-Name' => rawurlencode($name),
                'X-App-Version' => rawurlencode($version),
                'X-Logo-Url' => (string) ($s['logo_url'] ?? ''),
                'X-Timestamp' => $ts,
                'X-Content-Sha256' => $bodyHash,
                'X-Signature' => $sig,
            ],
        ]);
        $json = json_decode($res['body'], true);
        if (!$res['ok'] || !is_array($json) || empty($json['ok'])) {
            $why = is_array($json) ? (string) ($json['error'] ?? '') : ('HTTP ' . $res['status']);
            return ['status' => 'failed', 'log' => ['انتشار روی سایت دانلود ناموفق: ' . $why]];
        }
        @unlink($file);
        return [
            'status' => 'delivering',
            'result' => (string) ($json['url'] ?? ''),
            'log' => ['منتشر شد: نسخه ' . $version],
        ];
    }

    private function deliver(array $s, array $run): array
    {
        $url = (string) ($run['result'] ?? '');
        $connectorId = (int) ($s['delivery_connector_id'] ?? 0);
        $chatId = trim((string) ($s['delivery_chat_id'] ?? ''));
        if ($connectorId > 0 && $chatId !== '') {
            $channel = Channels::find($connectorId);
            if ($channel !== null) {
                $text = trim((string) ($s['app_name'] ?? 'iLiveX')) . " آماده شد:\n" . $url;
                $sent = Channels::driver($channel)->send(Channels::secret($channel), $chatId, $text);
                return ['status' => 'done', 'log' => [!empty($sent['ok']) ? 'لینک به چت/کانال تحویل شد' : 'ارسال لینک ناموفق بود؛ لینک در پنل موجود است']];
            }
        }
        return ['status' => 'done', 'log' => ['آماده؛ لینک در پنل قابل مشاهده است']];
    }
}
