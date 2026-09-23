<?php
declare(strict_types=1);

namespace App\Web;

final class View
{
    public static function render(string $name, array $data = []): string
    {
        $data['e'] = static fn ($v): string => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $data['local'] = static function (?string $utc): string {
            if (!$utc) {
                return '—';
            }
            $ts = strtotime($utc . (preg_match('/[zZ+]/', $utc) ? '' : ' UTC'));
            return $ts ? date('Y-m-d H:i', $ts) : '—';
        };
        $render = static function (string $__file, array $__data): string {
            extract($__data);
            ob_start();
            require $__file;
            return (string) ob_get_clean();
        };
        $content = $render(APP_ROOT . '/app/Views/' . $name . '.php', $data);
        $html = in_array($name, ['login', 'error'], true)
            ? $render(APP_ROOT . '/app/Views/bare.php', $data + ['content' => $content])
            : $render(APP_ROOT . '/app/Views/layout.php', $data + ['content' => $content, 'view' => $name]);
        $base = \App\Core\Config::basePath();
        // Views use root-relative URLs; mount them under the sub-directory when there is one.
        return $base === '' ? $html : preg_replace('#\b(href|src|action)="/(?!/)#', '$1="' . $base . '/', $html);
    }
}
