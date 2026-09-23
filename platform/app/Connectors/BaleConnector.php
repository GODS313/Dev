<?php
declare(strict_types=1);

namespace App\Connectors;

/** Bale official Bot API (https://docs.bale.ai), Telegram-compatible. */
final class BaleConnector extends BotApiConnector
{
    public function type(): string
    {
        return 'bale';
    }

    public function label(): string
    {
        return 'بله';
    }

    protected function baseUrl(): string
    {
        return 'https://tapi.bale.ai/';
    }
}
