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

    /** Validates credentials; returns ['ok'=>bool, 'name'=>string, 'username'=>?string, 'error'=>?string]. */
    public function verify(string $secret): array;

    /**
     * Sends a text message. $options may carry 'button' => ['text'=>..,'url'=>..]
     * and 'business_connection_id' => string.
     * Returns ['ok'=>bool, 'error'=>?string, 'retry_after'=>int, 'unreachable'=>bool].
     */
    public function send(string $secret, string $externalId, string $text, array $options = []): array;

    public function setWebhook(string $secret, string $url, string $key): array;

    public function deleteWebhook(string $secret): array;

    /** Polling fallback: returns list of raw updates newer than $offset. */
    public function fetchUpdates(string $secret, int $offset): array;

    /**
     * Normalises a raw update to
     * ['update_id','event','kind','external_id','username','name','title','text','business_connection_id']
     * or null when it carries nothing the core acts on. 'event' is one of
     * message|membership|business; 'kind' is private|group|channel.
     */
    public function parseUpdate(array $update): ?array;
}
