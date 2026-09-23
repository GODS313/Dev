<?php
declare(strict_types=1);

namespace App\Core;

final class Audit
{
    public static function log(string $actor, string $action, ?string $detail = null, ?string $ip = null): void
    {
        Database::run('INSERT INTO audit_log (actor, action, detail, ip) VALUES (?,?,?,?)', [$actor, $action, $detail, $ip]);
    }

    public static function recent(int $limit = 200): array
    {
        return Database::all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ' . max(1, $limit));
    }
}
