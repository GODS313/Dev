<?php
declare(strict_types=1);

namespace App\Core;

/** Users (the audience) and their per-connector identities. */
final class Audience
{
    public static function normalizeTags(string $tags): string
    {
        $parts = array_filter(array_map(static fn ($t) => mb_strtolower(trim($t)), preg_split('/[,،\s]+/u', $tags) ?: []));
        $parts = array_unique($parts);
        sort($parts);
        return implode(',', $parts);
    }

    public static function createUser(string $name, ?string $phone, ?string $email, string $tags, bool $consent): int
    {
        return Database::insert(
            'INSERT INTO users (display_name, phone, email, tags, consent, consent_at) VALUES (?,?,?,?,?,?)',
            [$name, $phone ?: null, $email ?: null, self::normalizeTags($tags), $consent ? 1 : 0, $consent ? gmdate('Y-m-d H:i:s') : null]
        );
    }

    public static function updateTags(int $userId, string $tags): void
    {
        Database::run('UPDATE users SET tags = ?, updated_at = ? WHERE id = ?', [self::normalizeTags($tags), gmdate('Y-m-d H:i:s'), $userId]);
    }

    /** Finds or creates the user behind a messenger identity; returns the identity row. */
    public static function upsertIdentity(int $connectorId, string $externalId, ?string $username, string $name): array
    {
        $identity = Database::one('SELECT * FROM identities WHERE connector_id = ? AND external_id = ?', [$connectorId, $externalId]);
        $now = gmdate('Y-m-d H:i:s');
        if ($identity === null) {
            $userId = self::createUser($name !== '' ? $name : ($username ?? $externalId), null, null, '', false);
            $id = Database::insert(
                'INSERT INTO identities (user_id, connector_id, external_id, username, subscribed, last_seen_at) VALUES (?,?,?,?,0,?)',
                [$userId, $connectorId, $externalId, $username, $now]
            );
            return Database::one('SELECT * FROM identities WHERE id = ?', [$id]);
        }
        Database::run('UPDATE identities SET username = ?, last_seen_at = ? WHERE id = ?', [$username, $now, $identity['id']]);
        return $identity;
    }

    public static function setSubscribed(int $identityId, bool $subscribed): void
    {
        Database::run('UPDATE identities SET subscribed = ? WHERE id = ?', [$subscribed ? 1 : 0, $identityId]);
        if ($subscribed) {
            Database::run(
                'UPDATE users SET consent = 1, consent_at = COALESCE(consent_at, ?) WHERE id = (SELECT user_id FROM identities WHERE id = ?)',
                [gmdate('Y-m-d H:i:s'), $identityId]
            );
        }
    }

    public static function users(string $search = '', int $limit = 300): array
    {
        $sql = 'SELECT u.*, (SELECT COUNT(*) FROM identities i WHERE i.user_id = u.id AND i.subscribed = 1) AS subscriptions,
                       (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
                FROM users u';
        $params = [];
        if ($search !== '') {
            $sql .= ' WHERE u.display_name LIKE ? OR u.phone LIKE ? OR u.tags LIKE ?';
            $like = '%' . $search . '%';
            $params = [$like, $like, $like];
        }
        return Database::all($sql . ' ORDER BY u.id DESC LIMIT ' . max(1, $limit), $params);
    }

    /** Subscribed identities on a connector, optionally restricted to users having a tag. */
    public static function reachable(int $connectorId, string $tag): array
    {
        $sql = 'SELECT i.id FROM identities i JOIN users u ON u.id = i.user_id WHERE i.connector_id = ? AND i.subscribed = 1';
        $params = [$connectorId];
        $tag = self::normalizeTags($tag);
        if ($tag !== '') {
            $sql .= " AND (',' || u.tags || ',') LIKE ?";
            $params[] = '%,' . $tag . ',%';
        }
        return array_map('intval', array_column(Database::all($sql, $params), 'id'));
    }
}
