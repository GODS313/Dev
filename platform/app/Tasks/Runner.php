<?php
declare(strict_types=1);

namespace App\Tasks;

use App\Core\Crypto;
use App\Core\Database;

/** Stores task settings/state and drives runs step by step. */
final class Runner
{
    public const TERMINAL = ['done', 'failed', 'skipped'];

    public static function settings(string $key): array
    {
        $task = Registry::get($key);
        $row = Database::one('SELECT settings_json, enabled FROM task_settings WHERE task_key = ?', [$key]);
        $stored = $row ? json_decode($row['settings_json'], true) : [];
        return [
            'values' => array_merge($task->defaultSettings(), is_array($stored) ? $stored : []),
            'enabled' => $row ? (bool) $row['enabled'] : false,
            'has_secret' => $row ? (Database::scalar('SELECT secret_enc FROM task_settings WHERE task_key = ?', [$key]) !== null) : false,
        ];
    }

    public static function saveSettings(string $key, array $values, ?string $secret, bool $enabled): void
    {
        $task = Registry::get($key);
        $clean = [];
        foreach ($task->fields() as $field => $meta) {
            if (($meta['secret'] ?? false) === false && array_key_exists($field, $values)) {
                $clean[$field] = is_string($values[$field]) ? trim($values[$field]) : $values[$field];
            }
        }
        $existing = Database::one('SELECT task_key FROM task_settings WHERE task_key = ?', [$key]);
        $json = json_encode($clean, JSON_UNESCAPED_UNICODE);
        if ($existing === null) {
            Database::run(
                'INSERT INTO task_settings (task_key, settings_json, secret_enc, enabled) VALUES (?,?,?,?)',
                [$key, $json, ($secret !== null && $secret !== '') ? Crypto::encrypt($secret) : null, $enabled ? 1 : 0]
            );
            return;
        }
        Database::run('UPDATE task_settings SET settings_json = ?, enabled = ?, updated_at = ? WHERE task_key = ?', [$json, $enabled ? 1 : 0, gmdate('Y-m-d H:i:s'), $key]);
        if ($secret !== null && $secret !== '') {
            Database::run('UPDATE task_settings SET secret_enc = ? WHERE task_key = ?', [Crypto::encrypt($secret), $key]);
        }
    }

    public static function secret(string $key): ?string
    {
        $enc = Database::scalar('SELECT secret_enc FROM task_settings WHERE task_key = ?', [$key]);
        return is_string($enc) && $enc !== '' ? Crypto::decrypt($enc) : null;
    }

    public static function enabled(string $key): bool
    {
        return (bool) Database::scalar('SELECT enabled FROM task_settings WHERE task_key = ?', [$key]);
    }

    /** Creates a run, or returns an already-active run sharing the dedup key. */
    public static function createRun(string $key, ?string $dedupKey = null): array
    {
        if ($dedupKey !== null) {
            $active = Database::one(
                "SELECT * FROM task_runs WHERE task_key = ? AND dedup_key = ? AND status NOT IN ('done','failed','skipped') ORDER BY id DESC LIMIT 1",
                [$key, $dedupKey]
            );
            if ($active !== null) {
                return $active;
            }
        }
        $id = Database::insert('INSERT INTO task_runs (task_key, status, dedup_key) VALUES (?, \'queued\', ?)', [$key, $dedupKey]);
        return Database::one('SELECT * FROM task_runs WHERE id = ?', [$id]);
    }

    public static function run(int $id): ?array
    {
        return Database::one('SELECT * FROM task_runs WHERE id = ?', [$id]);
    }

    public static function runs(string $key, int $limit = 50): array
    {
        return Database::all('SELECT * FROM task_runs WHERE task_key = ? ORDER BY id DESC LIMIT ' . max(1, $limit), [$key]);
    }

    /** Runs pending steps for one run until it reaches a terminal state or the step budget ends. */
    public static function advance(array $run, int $maxSteps = 6): array
    {
        $task = Registry::get($run['task_key']);
        $settings = self::settings($run['task_key'])['values'];
        $secret = self::secret($run['task_key']);
        for ($i = 0; $i < $maxSteps && !in_array($run['status'], self::TERMINAL, true); $i++) {
            $before = $run['status'];
            try {
                $out = $task->step($settings, $secret, $run);
            } catch (\Throwable $e) {
                $out = ['status' => 'failed', 'log' => ['error: ' . $e->getMessage()]];
            }
            $run = self::persist($run, $out);
            if ($run['status'] === $before && empty($out['log'])) {
                break; // no progress: stop rather than spin
            }
        }
        return $run;
    }

    /** Advances every non-terminal run across all tasks (called by the worker). */
    public static function advanceAll(): int
    {
        $count = 0;
        foreach (Database::all("SELECT * FROM task_runs WHERE status NOT IN ('done','failed','skipped') ORDER BY id LIMIT 20") as $run) {
            self::advance($run);
            $count++;
        }
        return $count;
    }

    private static function persist(array $run, array $out): array
    {
        $log = json_decode($run['log_json'] ?? '[]', true);
        $log = is_array($log) ? $log : [];
        foreach ((array) ($out['log'] ?? []) as $line) {
            $log[] = ['t' => gmdate('H:i:s'), 'm' => self::redact((string) $line)];
        }
        $log = array_slice($log, -100);
        $status = $out['status'] ?? $run['status'];
        $ref = array_key_exists('ref', $out) ? $out['ref'] : $run['ref'];
        $result = array_key_exists('result', $out) ? $out['result'] : $run['result'];
        Database::run(
            'UPDATE task_runs SET status = ?, ref = ?, result = ?, log_json = ?, updated_at = ? WHERE id = ?',
            [$status, $ref, $result, json_encode($log, JSON_UNESCAPED_UNICODE), gmdate('Y-m-d H:i:s'), $run['id']]
        );
        return Database::one('SELECT * FROM task_runs WHERE id = ?', [$run['id']]);
    }

    /** Strips anything that looks like a token/secret from a log line. */
    private static function redact(string $line): string
    {
        $line = preg_replace('/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/', '[token]', $line) ?? $line;      // bot tokens
        $line = preg_replace('/[A-Fa-f0-9]{40,}/', '[hash]', $line) ?? $line;                     // long hex secrets
        return mb_substr($line, 0, 300);
    }
}
