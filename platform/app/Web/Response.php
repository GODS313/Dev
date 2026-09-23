<?php
declare(strict_types=1);

namespace App\Web;

final class Response
{
    public function __construct(
        public int $status = 200,
        public string $body = '',
        public array $headers = [],
        public array $cookies = [],
    ) {
    }

    public static function json(array $data, int $status = 200): self
    {
        return new self($status, json_encode($data, JSON_UNESCAPED_UNICODE), ['Content-Type' => 'application/json; charset=utf-8']);
    }

    public static function redirect(string $to, ?string $flash = null): self
    {
        $r = new self(303, '', ['Location' => $to]);
        if ($flash !== null) {
            $r->cookies['mp_flash'] = [$flash, 60];
        }
        return $r;
    }

    public static function html(string $html, int $status = 200): self
    {
        return new self($status, $html, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public function send(bool $secure): void
    {
        http_response_code($this->status);
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header('X-Frame-Options: DENY');
        header("Content-Security-Policy: default-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'");
        foreach ($this->headers as $k => $v) {
            header($k . ': ' . $v);
        }
        foreach ($this->cookies as $name => [$value, $ttl]) {
            setcookie($name, $value, [
                'expires' => $ttl > 0 ? time() + $ttl : time() - 3600,
                'path' => '/',
                'secure' => $secure,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
        echo $this->body;
    }
}
