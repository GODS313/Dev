<?php
declare(strict_types=1);

namespace App\Connectors;

use InvalidArgumentException;

/** The single place new messenger connectors are registered. */
final class Registry
{
    /** @return array<string, Connector> */
    public static function all(): array
    {
        $list = [new TelegramConnector(), new BaleConnector()];
        $out = [];
        foreach ($list as $connector) {
            $out[$connector->type()] = $connector;
        }
        return $out;
    }

    public static function get(string $type): Connector
    {
        $all = self::all();
        if (!isset($all[$type])) {
            throw new InvalidArgumentException('unknown connector type: ' . $type);
        }
        return $all[$type];
    }
}
