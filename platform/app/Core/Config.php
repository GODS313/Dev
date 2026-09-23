<?php
declare(strict_types=1);

namespace App\Core;

/** Reads KEY=VALUE settings from a file kept outside the web root, with env overrides. */
final class Config
{
    private static array $values = [];

    public static function load(string $file): void
    {
        self::$values = [];
        if (!is_file($file)) {
            return;
        }
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            self::$values[trim($key)] = trim(trim($value), "\"'");
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            return $env;
        }
        return self::$values[$key] ?? $default;
    }

    public static function set(string $key, string $value): void
    {
        self::$values[$key] = $value;
    }

    /** URL prefix when the app is served from a sub-directory, e.g. "/panel". */
    public static function basePath(): string
    {
        $base = '/' . trim((string) self::get('BASE_PATH', ''), '/');
        return $base === '/' ? '' : $base;
    }

    public static function storagePath(string $name = ''): string
    {
        $dir = self::get('STORAGE_DIR', APP_ROOT . '/storage');
        return $name === '' ? $dir : $dir . '/' . $name;
    }
}
