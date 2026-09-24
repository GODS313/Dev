<?php
declare(strict_types=1);

namespace Mlr;

/** Maps a request to [status, headers, body]. Pure enough to be exercised by tests/run.php. */
final class Kernel
{
    public const REDIRECTS = ['/en/home' => '/en/', '/fa/home' => '/fa/', '/en' => '/en/', '/fa' => '/fa/'];

    public function __construct(private App $app, private string $publicDir)
    {
    }

    public function handle(Request $r): array
    {
        $rid = bin2hex(random_bytes(8));
        $json = fn(int $s, mixed $b) => [$s, ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store', 'X-Request-Id' => $rid,
            'X-Robots-Tag' => 'noindex, nofollow'], json_encode($b, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
        try {
            $p = $r->path;
            if ($p === '/healthz') return $json(200, ['ok' => true]);
            if ($p === '/readyz') {
                $this->app->db->one('SELECT 1');
                return $json(200, ['ok' => true, 'db' => 'up', 'edition' => 'php']);
            }
            if ($p === '/tg/webhook' && $r->method === 'POST') {
                $given = $r->headers['x-telegram-bot-api-secret-token'] ?? '';
                if (!$this->app->cfg->botToken || !hash_equals($this->app->cfg->webhookSecret, (string) $given)) {
                    return $json(401, ['error' => ['code' => 'unauthorized', 'message' => 'Unauthorized', 'requestId' => $rid]]);
                }
                $update = json_decode($r->rawBody, true);
                if (!is_array($update) || !is_int($update['update_id'] ?? null)) return $json(400, ['error' => ['code' => 'bad_request', 'message' => 'Bad update', 'requestId' => $rid]]);
                try {
                    (new Bot($this->app))->handle($update);
                } catch (\Throwable $e) {
                    error_log(scrub('bot update failed: ' . $e->getMessage()));
                    // payment updates must be redelivered (processing is idempotent); others are acknowledged
                    if (isset($update['message']['successful_payment'])) return $json(503, ['error' => ['code' => 'internal', 'message' => 'Retry', 'requestId' => $rid]]);
                }
                $this->opportunisticCron();
                return $json(200, ['ok' => true]);
            }
            if ($p === '/cron') {
                $key = (string) ($r->query['key'] ?? '');
                if (!$this->app->cfg->botToken || !hash_equals($this->app->cfg->cronKey(), $key)) return $json(404, ['error' => ['code' => 'not_found', 'message' => 'Not found', 'requestId' => $rid]]);
                $out = $this->app->runScheduled(true);
                try {
                    $out += $this->app->ensureWebhook();
                } catch (\Throwable $e) {
                    $out['webhook'] = 'error: ' . scrub($e->getMessage());
                }
                return $json(200, ['ok' => true] + $out);
            }
            if (str_starts_with($p, '/api/')) {
                [$status, $body] = (new Api($this->app))->handle($r);
                $this->opportunisticCron();
                return $json($status, $body);
            }
            if (preg_match('#^/(en|fa)/status$#', $p, $m)) return $this->statusPage($m[1]);
            if (isset(self::REDIRECTS[$p])) return [301, ['Location' => $this->app->cfg->basePath . self::REDIRECTS[$p]], ''];
            return $this->notFound();
        } catch (AppError $e) {
            $h = [];
            if (isset($e->details['retryAfterSeconds'])) $h['Retry-After'] = (string) $e->details['retryAfterSeconds'];
            [$s, $hh, $b] = $json($e->status(), ['error' => ['code' => $e->errCode, 'message' => $e->getMessage(), 'details' => $e->details ?: null, 'requestId' => $rid]]);
            return [$s, $hh + $h, $b];
        } catch (\Throwable $e) {
            error_log(scrub("[{$rid}] " . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine()));
            return $json(500, ['error' => ['code' => 'internal', 'message' => 'Something went wrong', 'requestId' => $rid]]);
        }
    }

    private function opportunisticCron(): void
    {
        try {
            $this->app->runScheduled();
        } catch (\Throwable $e) {
            error_log(scrub('scheduled work failed: ' . $e->getMessage()));
        }
    }

    private function notFound(): array
    {
        $f = $this->publicDir . '/404.html';
        return [404, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-store'], is_file($f) ? (string) file_get_contents($f) : 'Not found'];
    }

    /** Pre-rendered status page with a live badge. */
    private function statusPage(string $l): array
    {
        $f = $this->publicDir . "/{$l}/status.html";
        if (!is_file($f)) return $this->notFound();
        $ok = true;
        try {
            $this->app->db->one('SELECT 1');
        } catch (\Throwable) {
            $ok = false;
        }
        $html = (string) file_get_contents($f);
        if (!$ok) $html = preg_replace('#<span class="badge ok">[^<]*</span>#', '<span class="badge no">' . ($l === 'fa' ? 'اختلال' : 'Degraded') . '</span>', $html);
        return [200, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex'], $html];
    }
}
