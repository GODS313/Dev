<?php
declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/** Encrypts connector secrets at rest with a server-side key that never leaves the host. */
final class Crypto
{
    public static function key(): string
    {
        $configured = Config::get('APP_KEY');
        if ($configured) {
            return hash('sha256', $configured, true);
        }
        $file = Config::storagePath('app.key');
        if (!is_file($file)) {
            if (@file_put_contents($file, bin2hex(random_bytes(32)), LOCK_EX) === false) {
                throw new RuntimeException('storage directory is not writable');
            }
            @chmod($file, 0600);
        }
        return hash('sha256', trim((string) file_get_contents($file)), true);
    }

    public static function encrypt(string $plain): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new RuntimeException('encryption failed');
        }
        return base64_encode($iv . $tag . $cipher);
    }

    public static function decrypt(string $encoded): string
    {
        $raw = base64_decode($encoded, true);
        if ($raw === false || strlen($raw) < 28) {
            throw new RuntimeException('invalid ciphertext');
        }
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        if ($plain === false) {
            throw new RuntimeException('decryption failed');
        }
        return $plain;
    }

    public static function token(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }
}
