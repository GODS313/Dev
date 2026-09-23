<?php
declare(strict_types=1);

namespace App\Web;

final class Request
{
    public function __construct(
        public string $method,
        public string $path,
        public array $query = [],
        public array $post = [],
        public array $cookies = [],
        public array $headers = [],
        public string $body = '',
        public string $ip = '0.0.0.0',
        public bool $secure = false,
        public string $host = 'localhost',
        public array $files = [],
    ) {
    }

    /**
     * Returns the raw bytes of an uploaded file field, or null. Supports the real
     * $_FILES shape (tmp_name) and a test shape ('bytes').
     */
    public function fileBytes(string $field): ?string
    {
        $f = $this->files[$field] ?? null;
        if (!is_array($f)) {
            return null;
        }
        if (isset($f['bytes'])) {
            return (string) $f['bytes'];
        }
        if (($f['error'] ?? 1) === 0 && !empty($f['tmp_name']) && is_uploaded_file($f['tmp_name'])) {
            $bytes = @file_get_contents($f['tmp_name']);
            return $bytes === false ? null : $bytes;
        }
        return null;
    }

    public static function fromGlobals(): self
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $base = \App\Core\Config::basePath();
        if ($base !== '' && ($path === $base || str_starts_with($path, $base . '/'))) {
            $path = substr($path, strlen($base)) ?: '/';
        }
        $headers = [];
        foreach ($_SERVER as $k => $v) {
            if (str_starts_with($k, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = (string) $v;
            }
        }
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($headers['x-forwarded-proto'] ?? '') === 'https';
        return new self(
            strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            '/' . trim($path, '/'),
            $_GET,
            $_POST,
            $_COOKIE,
            $headers,
            (string) file_get_contents('php://input'),
            (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
            $secure,
            (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'),
            $_FILES,
        );
    }

    public function input(string $key, string $default = ''): string
    {
        $v = $this->post[$key] ?? $this->query[$key] ?? $default;
        return is_string($v) ? trim($v) : $default;
    }

    public function json(): array
    {
        $data = json_decode($this->body, true);
        return is_array($data) ? $data : [];
    }

    public function baseUrl(): string
    {
        return ($this->secure ? 'https' : 'http') . '://' . $this->host . \App\Core\Config::basePath();
    }

    public function bearer(): string
    {
        $h = $this->headers['authorization'] ?? '';
        return str_starts_with($h, 'Bearer ') ? substr($h, 7) : '';
    }
}
