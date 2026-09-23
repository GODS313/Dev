<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Campaign lifecycle: draft -> scheduled/running -> done, with pause/resume.
 * Messages go only to identities that opted in (/start) and every message
 * carries the opt-out instruction.
 */
final class Campaigns
{
    public const STATUSES = ['draft', 'scheduled', 'running', 'paused', 'done'];
    private const MAX_ATTEMPTS = 3;

    public static function create(string $name, int $connectorId, string $message, string $tag, ?string $scheduledAt): int
    {
        if (trim($message) === '' || Channels::find($connectorId) === null) {
            throw new \InvalidArgumentException('message and connector are required');
        }
        return Database::insert(
            'INSERT INTO campaigns (name, connector_id, message, tag_filter, scheduled_at) VALUES (?,?,?,?,?)',
            [$name !== '' ? $name : 'کمپین', $connectorId, $message, Audience::normalizeTags($tag), $scheduledAt ?: null]
        );
    }

    public static function find(int $id): ?array
    {
        return Database::one('SELECT * FROM campaigns WHERE id = ?', [$id]);
    }

    public static function all(): array
    {
        return Database::all(
            "SELECT c.*, k.name AS connector_name, k.type AS connector_type,
                    (SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id = c.id) AS total,
                    (SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id = c.id AND d.status = 'sent') AS sent,
                    (SELECT COUNT(*) FROM deliveries d WHERE d.campaign_id = c.id AND d.status = 'failed') AS failed
             FROM campaigns c JOIN connectors k ON k.id = c.connector_id ORDER BY c.id DESC"
        );
    }

    /** Starts now, or schedules when scheduled_at is in the future. */
    public static function start(int $id): string
    {
        $campaign = self::find($id);
        if ($campaign === null || !in_array($campaign['status'], ['draft', 'paused', 'scheduled'], true)) {
            throw new \RuntimeException('campaign cannot be started in its current state');
        }
        if ($campaign['status'] !== 'paused' && $campaign['scheduled_at'] && strtotime($campaign['scheduled_at']) > time()) {
            Database::run("UPDATE campaigns SET status = 'scheduled' WHERE id = ?", [$id]);
            return 'scheduled';
        }
        self::launch($campaign);
        return 'running';
    }

    public static function pause(int $id): void
    {
        Database::run("UPDATE campaigns SET status = 'paused' WHERE id = ? AND status IN ('running','scheduled')", [$id]);
    }

    private static function launch(array $campaign): void
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('INSERT OR IGNORE INTO deliveries (campaign_id, identity_id) VALUES (?, ?)');
        foreach (Audience::reachable((int) $campaign['connector_id'], $campaign['tag_filter']) as $identityId) {
            $stmt->execute([$campaign['id'], $identityId]);
        }
        $pdo->prepare("UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?")
            ->execute([gmdate('Y-m-d H:i:s'), $campaign['id']]);
        $pdo->commit();
    }

    public static function compose(string $message): string
    {
        $footer = Config::get('OPT_OUT_FOOTER', 'لغو دریافت پیام: /stop');
        return rtrim($message) . "\n\n" . $footer;
    }

    /** Sends up to $limit queued messages across running campaigns; returns counters. */
    public static function dispatch(int $limit = 60, float $delaySeconds = 0.05): array
    {
        $stats = ['launched' => 0, 'sent' => 0, 'failed' => 0, 'finished' => 0];
        foreach (Database::all("SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?", [date('Y-m-d H:i:s')]) as $due) {
            self::launch($due);
            $stats['launched']++;
        }

        $rows = Database::all(
            "SELECT d.id, d.attempts, d.identity_id, i.external_id, c.id AS campaign_id, c.message, c.connector_id
             FROM deliveries d
             JOIN campaigns c ON c.id = d.campaign_id
             JOIN identities i ON i.id = d.identity_id
             JOIN connectors k ON k.id = c.connector_id
             WHERE c.status = 'running' AND d.status = 'queued' AND i.subscribed = 1 AND k.enabled = 1
             ORDER BY d.id LIMIT " . max(1, $limit)
        );
        $channels = [];
        foreach ($rows as $row) {
            $cid = (int) $row['connector_id'];
            $channels[$cid] ??= Channels::find($cid);
            $channel = $channels[$cid];
            $res = Channels::driver($channel)->send(Channels::secret($channel), $row['external_id'], self::compose($row['message']));
            $now = gmdate('Y-m-d H:i:s');
            if ($res['ok']) {
                Database::run("UPDATE deliveries SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?", [$now, $row['id']]);
                $stats['sent']++;
            } elseif ($res['retry_after'] > 0) {
                break; // rate limited: leave the rest queued for the next run
            } else {
                $final = $res['unreachable'] || (int) $row['attempts'] + 1 >= self::MAX_ATTEMPTS;
                Database::run(
                    'UPDATE deliveries SET status = ?, attempts = attempts + 1, error = ? WHERE id = ?',
                    [$final ? 'failed' : 'queued', substr((string) $res['error'], 0, 255), $row['id']]
                );
                if ($res['unreachable']) {
                    Audience::setSubscribed((int) $row['identity_id'], false);
                }
                $final ? $stats['failed']++ : null;
            }
            if ($delaySeconds > 0) {
                usleep((int) ($delaySeconds * 1e6));
            }
        }

        // Unsubscribed recipients are skipped for good.
        Database::run(
            "UPDATE deliveries SET status = 'skipped' WHERE status = 'queued'
             AND identity_id IN (SELECT id FROM identities WHERE subscribed = 0)"
        );
        $stats['finished'] = Database::run(
            "UPDATE campaigns SET status = 'done', finished_at = ? WHERE status = 'running'
             AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.campaign_id = campaigns.id AND d.status = 'queued')",
            [gmdate('Y-m-d H:i:s')]
        );
        return $stats;
    }
}
