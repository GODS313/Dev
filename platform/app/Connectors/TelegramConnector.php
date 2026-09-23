<?php
declare(strict_types=1);

namespace App\Connectors;

/** Telegram official Bot API (https://core.telegram.org/bots/api). */
final class TelegramConnector extends BotApiConnector
{
    public function type(): string
    {
        return 'telegram';
    }

    public function label(): string
    {
        return 'تلگرام';
    }

    protected function baseUrl(): string
    {
        return 'https://api.telegram.org/';
    }

    protected function supportsSecretHeader(): bool
    {
        return true;
    }
}
