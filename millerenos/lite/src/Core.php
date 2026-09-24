<?php
declare(strict_types=1);

namespace Mlr;

use PDO;

/** Error safe to show to clients (mirrors the Node server's error model). */
final class AppError extends \RuntimeException
{
    public const STATUS = [
        'bad_request' => 400, 'validation_failed' => 422, 'unauthorized' => 401, 'forbidden' => 403,
        'not_found' => 404, 'conflict' => 409, 'rate_limited' => 429, 'quota_exceeded' => 429,
        'access_expired' => 402, 'not_configured' => 503, 'feature_disabled' => 403, 'payment_error' => 400,
        'internal' => 500,
    ];
    public function __construct(public string $errCode, string $message, public array $details = [])
    {
        parent::__construct($message);
    }
    public function status(): int
    {
        return self::STATUS[$this->errCode] ?? 500;
    }
}

final class Config
{
    public function __construct(
        public string $baseUrl,          // e.g. https://etebarami.net/God
        public string $basePath,         // e.g. /God
        public ?string $botToken,
        public ?string $botUsername,
        public array $adminIds,          // numeric strings
        public string $webhookSecret,
        public string $dataSecret,
        public string $securityContact,
        public int $trialMinutes = 60,
        public int $trialProducts = 25,
        public int $trialOrders = 50,
        public int $sessionHours = 24,
    ) {
    }

    /** Loads config/app.env and data/secrets.php (generated once on the server, never committed). */
    public static function load(string $root): self
    {
        $env = [];
        $file = $root . '/config/app.env';
        if (is_file($file)) {
            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                if ($line[0] === '#' || !str_contains($line, '=')) continue;
                [$k, $v] = explode('=', $line, 2);
                $env[trim($k)] = trim($v);
            }
        }
        $secretsFile = $root . '/data/secrets.php';
        if (!is_file($secretsFile)) {
            @mkdir($root . '/data', 0700, true);
            $s = ['webhook' => bin2hex(random_bytes(24)), 'data' => bin2hex(random_bytes(32))];
            file_put_contents($secretsFile, '<?php return ' . var_export($s, true) . ';', LOCK_EX);
            @chmod($secretsFile, 0600);
        }
        $secrets = require $secretsFile;
        $baseUrl = rtrim($env['PUBLIC_BASE_URL'] ?? 'https://etebarami.net/God', '/');
        $token = ($env['TELEGRAM_BOT_TOKEN'] ?? '') !== '' ? $env['TELEGRAM_BOT_TOKEN'] : null;
        // Token connected at runtime via POST /setup/bot (stored with the data, never in the web root).
        $botFile = $root . '/data/bot.php';
        if ($token === null && is_file($botFile)) $token = (require $botFile)['token'] ?? null;
        return new self(
            $baseUrl,
            rtrim((string) parse_url($baseUrl, PHP_URL_PATH), '/'),
            $token,
            ($env['TELEGRAM_BOT_USERNAME'] ?? '') ?: null,
            array_values(array_filter(array_map('trim', explode(',', $env['PLATFORM_ADMIN_TELEGRAM_IDS'] ?? '')), fn($x) => ctype_digit($x))),
            $secrets['webhook'],
            $secrets['data'],
            $env['SECURITY_CONTACT'] ?? '',
            (int) ($env['TRIAL_DURATION_MINUTES'] ?? 60),
        );
    }

    /** Key for the external cron trigger; CI derives the same value from the bot token. */
    public function cronKey(): string
    {
        return substr(hash_hmac('sha256', 'cron', (string) $this->botToken), 0, 40);
    }
}

final class Db
{
    public PDO $pdo;

    public function __construct(string $path)
    {
        $this->pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        Schema::migrate($this->pdo);
    }

    public function all(string $sql, array $p = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($p);
        return $st->fetchAll();
    }

    public function one(string $sql, array $p = []): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($p);
        $r = $st->fetch();
        return $r === false ? null : $r;
    }

    public function exec(string $sql, array $p = []): int
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($p);
        return $st->rowCount();
    }

    /** Runs fn in an IMMEDIATE transaction (serializes writers → no oversell / double spend). */
    public function tx(callable $fn): mixed
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $r = $fn($this);
            $this->pdo->exec('COMMIT');
            return $r;
        } catch (\Throwable $e) {
            $this->pdo->exec('ROLLBACK');
            throw $e;
        }
    }
}

function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function isUuid(mixed $v): bool
{
    return is_string($v) && (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v);
}

function randomCode(int $len, string $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string
{
    $out = '';
    for ($i = 0; $i < $len; $i++) $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    return $out;
}

function iso(?int $ts): ?string
{
    return $ts === null ? null : gmdate('Y-m-d\TH:i:s\Z', $ts);
}

function now(): int
{
    return time();
}

/** Removes bot tokens from strings before logging. */
function scrub(string $s): string
{
    return (string) preg_replace('/bot\d{5,}:[A-Za-z0-9_-]{20,}/', 'bot[REDACTED]', $s);
}
