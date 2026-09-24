<?php
declare(strict_types=1);

namespace Mlr;

/** Bot texts. Catalog generated from apps/server/src/i18n by lite/build/export-i18n.ts (do not edit i18n.json by hand). */
final class I18n
{
    private static ?array $cat = null;

    public static function t(string $locale, string $key, array $vars = []): string
    {
        self::$cat ??= json_decode((string) file_get_contents(__DIR__ . '/i18n.json'), true);
        $tpl = self::$cat[$locale][$key] ?? self::$cat['en'][$key] ?? $key;
        return (string) preg_replace_callback('/\{(\w+)\}/', fn($m) => array_key_exists($m[1], $vars) ? (string) $vars[$m[1]] : $m[0], $tpl);
    }

    public static function minutes(string $locale, int $seconds): string
    {
        $m = max(0, (int) ceil($seconds / 60));
        return $locale === 'fa' ? strtr((string) $m, ['0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴', '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹']) . ' دقیقه' : "{$m} min";
    }
}
