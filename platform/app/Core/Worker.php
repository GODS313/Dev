<?php
declare(strict_types=1);

namespace App\Core;

/** One background tick: poll inbound messages, send queued campaign messages. */
final class Worker
{
    public static function cronKey(): string
    {
        $configured = Config::get('CRON_KEY');
        if ($configured) {
            return $configured;
        }
        $file = Config::storagePath('cron.key');
        if (!is_file($file)) {
            file_put_contents($file, Crypto::token(24), LOCK_EX);
            @chmod($file, 0600);
        }
        return trim((string) file_get_contents($file));
    }

    /** True when no tick has completed in the last $seconds (drives the request-piggyback fallback). */
    public static function due(int $seconds = 60): bool
    {
        $mtime = @filemtime(Config::storagePath('worker.last'));
        return $mtime === false || $mtime < time() - $seconds;
    }

    /** Returns null when another tick is already running. */
    public static function tick(int $budgetSeconds = 50): ?array
    {
        $lock = fopen(Config::storagePath('worker.lock'), 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            return null;
        }
        $started = microtime(true);
        $result = ['polled' => 0, 'sent' => 0, 'failed' => 0, 'launched' => 0, 'finished' => 0, 'errors' => []];
        try {
            foreach (Channels::all() as $channel) {
                try {
                    $result['polled'] += Channels::poll($channel);
                } catch (\Throwable $e) {
                    $result['errors'][] = $channel['name'] . ': ' . $e->getMessage();
                }
            }
            do {
                $stats = Campaigns::dispatch(40);
                foreach (['sent', 'failed', 'launched', 'finished'] as $k) {
                    $result[$k] += $stats[$k];
                }
            } while ($stats['sent'] + $stats['failed'] > 0 && microtime(true) - $started < $budgetSeconds);
            try {
                $result['tasks'] = \App\Tasks\Runner::advanceAll();
            } catch (\Throwable $e) {
                $result['errors'][] = 'tasks: ' . $e->getMessage();
            }
            Database::run('DELETE FROM sessions WHERE expires_at < ?', [gmdate('Y-m-d H:i:s', time() - 86400 * 30)]);
            file_put_contents(Config::storagePath('worker.last'), gmdate('c'));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return $result;
    }
}
