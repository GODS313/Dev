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

    /** Finds or creates the private-chat user behind a messenger identity; returns the identity row. */
    public static function upsertIdentity(int $connectorId, string $externalId, ?string $username, string $name): array
    {
        $identity = Database::one('SELECT * FROM identities WHERE connector_id = ? AND external_id = ?', [$connectorId, $externalId]);
        $now = gmdate('Y-m-d H:i:s');
        if ($identity === null) {
            $userId = self::createUser($name !== '' ? $name : ($username ?? $externalId), null, null, '', false);
            $id = Database::insert(
                'INSERT INTO identities (user_id, connector_id, external_id, username, kind, subscribed, last_seen_at) VALUES (?,?,?,?,\'private\',0,?)',
                [$userId, $connectorId, $externalId, $username, $now]
            );
            return Database::one('SELECT * FROM identities WHERE id = ?', [$id]);
        }
        Database::run('UPDATE identities SET username = ?, last_seen_at = ? WHERE id = ?', [$username, $now, $identity['id']]);
        return $identity;
    }

    /**
     * Records a group/channel the bot belongs to. $present=false marks it left/removed
     * so campaigns stop targeting it. Returns the identity id.
     */
    public static function registerChat(int $connectorId, string $externalId, string $kind, ?string $title, bool $present): int
    {
        $now = gmdate('Y-m-d H:i:s');
        $existing = Database::one('SELECT id, user_id FROM identities WHERE connector_id = ? AND external_id = ?', [$connectorId, $externalId]);
        if ($existing === null) {
            $userId = self::createUser($title ?: $externalId, null, null, '', false);
            return Database::insert(
                'INSERT INTO identities (user_id, connector_id, external_id, kind, title, subscribed, last_seen_at) VALUES (?,?,?,?,?,?,?)',
                [$userId, $connectorId, $externalId, $kind, $title, $present ? 1 : 0, $now]
            );
        }
        Database::run(
            'UPDATE identities SET kind = ?, title = COALESCE(?, title), subscribed = ?, last_seen_at = ? WHERE id = ?',
            [$kind, $title, $present ? 1 : 0, $now, $existing['id']]
        );
        return (int) $existing['id'];
    }

    /**
     * Imports the operator's own contacts from CSV/TSV text. Recognised headers
     * (any order, English or Persian): name/نام, phone/تلفن, email/ایمیل, tags/برچسب.
     * A header row is optional; a single column is treated as the name.
     * Returns ['added'=>int, 'skipped'=>int].
     */
    public static function importContacts(string $text, bool $consent): array
    {
        $lines = preg_split('/\r\n|\r|\n/', trim($text)) ?: [];
        $added = 0;
        $skipped = 0;
        $map = ['name' => 0, 'phone' => null, 'email' => null, 'tags' => null];
        $aliases = [
            'name' => ['name', 'نام', 'اسم', 'fullname', 'full name'],
            'phone' => ['phone', 'tel', 'mobile', 'تلفن', 'موبایل', 'شماره', 'همراه'],
            'email' => ['email', 'mail', 'ایمیل', 'پست الکترونیک'],
            'tags' => ['tags', 'tag', 'برچسب', 'برچسب‌ها', 'گروه'],
        ];
        $delimiter = static fn (string $l): string => substr_count($l, "\t") > substr_count($l, ',') ? "\t" : ',';

        $first = $lines[0] ?? '';
        $header = array_map(static fn ($c) => mb_strtolower(trim($c, " \"'\t")), str_getcsv($first, $delimiter($first)));
        $hasHeader = false;
        foreach ($header as $i => $col) {
            foreach ($aliases as $field => $names) {
                if (in_array($col, $names, true)) {
                    $map[$field] = $i;
                    $hasHeader = true;
                }
            }
        }
        $rows = $hasHeader ? array_slice($lines, 1) : $lines;

        foreach ($rows as $line) {
            if (trim($line) === '') {
                continue;
            }
            $cells = str_getcsv($line, $delimiter($line));
            $get = static fn (?int $i) => $i !== null && isset($cells[$i]) ? trim($cells[$i], " \"'\t") : '';
            $name = $get($map['name']);
            $phone = self::normalizePhone($get($map['phone']));
            $email = $get($map['email']);
            $tags = $get($map['tags']);
            if ($name === '' && $phone === '' && $email === '') {
                $skipped++;
                continue;
            }
            // De-duplicate on phone when present.
            if ($phone !== '' && Database::scalar('SELECT 1 FROM users WHERE phone = ?', [$phone])) {
                $skipped++;
                continue;
            }
            self::createUser($name !== '' ? $name : ($phone ?: $email), $phone ?: null, $email ?: null, $tags, $consent);
            $added++;
        }
        return ['added' => $added, 'skipped' => $skipped];
    }

    public static function normalizePhone(string $raw): string
    {
        // Persian and Arabic-Indic digits are multibyte, so map whole characters.
        $fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹', '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        $en = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        $raw = str_replace($fa, $en, $raw);
        $digits = preg_replace('/(?!^\+)\D+/', '', $raw) ?? '';
        return $digits === '+' ? '' : $digits;
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
        $sql = 'SELECT u.*, (SELECT COUNT(*) FROM identities i WHERE i.user_id = u.id AND i.subscribed = 1 AND i.kind = \'private\') AS subscriptions,
                       (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS device_count
                FROM users u
                WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.kind <> \'private\')';
        $params = [];
        if ($search !== '') {
            $terms = preg_split('/\s+/', trim($search)) ?: [];
            foreach (array_slice($terms, 0, 5) as $term) {
                $phone = self::normalizePhone($term);
                $sql .= ' AND (u.display_name LIKE ? OR u.tags LIKE ? OR u.email LIKE ?' . ($phone !== '' ? ' OR u.phone LIKE ?' : '') . ')';
                $params[] = '%' . $term . '%';
                $params[] = '%' . $term . '%';
                $params[] = '%' . $term . '%';
                if ($phone !== '') {
                    $params[] = '%' . $phone . '%';
                }
            }
        }
        return Database::all($sql . ' ORDER BY u.id DESC LIMIT ' . max(1, $limit), $params);
    }

    /** Groups and channels the bot currently belongs to on a connector. */
    public static function chats(int $connectorId): array
    {
        return Database::all(
            "SELECT * FROM identities WHERE connector_id = ? AND kind <> 'private' ORDER BY subscribed DESC, id",
            [$connectorId]
        );
    }

    /**
     * Identity ids a campaign should target.
     * $audience 'subscribers': opted-in private chats (optionally filtered by tag).
     * $audience 'groups': groups/channels the bot still belongs to.
     */
    public static function reachable(int $connectorId, string $tag, string $audience = 'subscribers'): array
    {
        if ($audience === 'groups') {
            $rows = Database::all("SELECT id FROM identities WHERE connector_id = ? AND kind <> 'private' AND subscribed = 1", [$connectorId]);
            return array_map('intval', array_column($rows, 'id'));
        }
        $sql = "SELECT i.id FROM identities i JOIN users u ON u.id = i.user_id WHERE i.connector_id = ? AND i.kind = 'private' AND i.subscribed = 1";
        $params = [$connectorId];
        $tag = self::normalizeTags($tag);
        if ($tag !== '') {
            $sql .= " AND (',' || u.tags || ',') LIKE ?";
            $params[] = '%,' . $tag . ',%';
        }
        return array_map('intval', array_column(Database::all($sql, $params), 'id'));
    }
}
