<?php
declare(strict_types=1);

namespace Mlr;

/** Maps a request to [status, headers, body]. Pure enough to be exercised by tests/run.php. */
final class Kernel
{
    public const REDIRECTS = ['/en/home' => '/en/', '/fa/home' => '/fa/', '/en' => '/en/', '/fa' => '/fa/'];

    /** @var callable(string): TelegramApi */
    private $tgFactory;

    public function __construct(private App $app, private string $publicDir, private string $root = '', ?callable $tgFactory = null)
    {
        $this->tgFactory = $tgFactory ?? fn(string $t) => new HttpTelegramApi($t);
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
            if ($p === '/setup/bot' && $r->method === 'POST') return $json(200, $this->setupBot($r));
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

    /**
     * Connects (or rotates) the bot token without redeploying. Only a token whose getMe username equals the
     * configured TELEGRAM_BOT_USERNAME is accepted — possessing that bot's token is the proof of ownership.
     */
    private function setupBot(Request $r): array
    {
        $this->app->rateLimit('setup:' . $r->ip, 5, 600);
        $expected = strtolower((string) $this->app->cfg->botUsername);
        if ($expected === '' || $this->root === '') throw new AppError('not_configured', 'Bot username is not configured');
        $token = V::str($r->json(), 'token', 100, 20);
        if (!preg_match('/^\d{6,12}:[A-Za-z0-9_-]{30,}$/', (string) $token)) throw new AppError('validation_failed', 'Invalid token format');
        $tg = ($this->tgFactory)($token);
        try {
            $me = $tg->call('getMe');
        } catch (\Throwable) {
            throw new AppError('unauthorized', 'Token rejected by Telegram');
        }
        if (strtolower((string) ($me['username'] ?? '')) !== $expected) throw new AppError('forbidden', 'Token belongs to a different bot');
        $file = $this->root . '/data/bot.php';
        file_put_contents($file, '<?php return ' . var_export(['token' => $token, 'set_at' => now()], true) . ';', LOCK_EX);
        @chmod($file, 0600);
        $this->app->audit('bot.token_connected', null, null, 'bot', (string) $me['username']);
        $this->app->cfg->botToken = $token;
        $app = new App($this->app->db, $this->app->cfg, $tg);
        return ['ok' => true, 'bot' => $me['username']] + $app->ensureWebhook() + ['commands' => $this->setCommands($tg)];
    }

    private function setCommands(TelegramApi $tg): string
    {
        $en = [['start', 'Main menu'], ['app', 'Open Millerenos'], ['plans', 'Plans & pricing'], ['support', 'Support'], ['language', 'Change language'], ['privacy', 'Privacy policy']];
        $fa = [['start', 'منوی اصلی'], ['app', 'باز کردن Millerenos'], ['plans', 'پلن‌ها و قیمت'], ['support', 'پشتیبانی'], ['language', 'تغییر زبان'], ['privacy', 'حریم خصوصی']];
        $map = fn(array $l) => array_map(fn($c) => ['command' => $c[0], 'description' => $c[1]], $l);
        $tg->call('setMyCommands', ['commands' => $map($en)]);
        $tg->call('setMyCommands', ['commands' => $map($fa), 'language_code' => 'fa']);
        return 'ok';
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
