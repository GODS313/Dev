<?php
declare(strict_types=1);

namespace App\Connectors;

/**
 * Contract every messenger connector implements. Connectors only talk to a
 * messenger's official, documented API; the core never calls a messenger directly.
 */
interface Connector
{
    public function type(): string;

    public function label(): string;

    /** Validates credentials; returns ['ok'=>bool, 'name'=>string, 'error'=>?string]. */
    public function verify(string $secret): array;

    /** Returns ['ok'=>bool, 'error'=>?string, 'retry_after'=>int, 'unreachable'=>bool]. */
    public function send(string $secret, string $externalId, string $text): array;

    public function setWebhook(string $secret, string $url, string $key): array;

    public function deleteWebhook(string $secret): array;

    /** Polling fallback: returns list of raw updates newer than $offset. */
    public function fetchUpdates(string $secret, int $offset): array;

    /**
     * Normalises a raw update to ['update_id','external_id','username','name','text']
     * or null when it is not a private text message.
     */
    public function parseUpdate(array $update): ?array;
}
