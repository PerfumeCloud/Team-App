<?php
declare(strict_types=1);

namespace PC;

/** AES-256-GCM mit dem App-Schlüssel aus config.php. */
final class Crypto
{
    private static function key(): string
    {
        $key = Config::get('app_key');
        if (!is_string($key) || $key === '') {
            throw new HttpError(500, 'App-Schlüssel fehlt in config.php.');
        }
        return hash('sha256', $key, true);
    }

    public static function encrypt(string $plain): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new \RuntimeException('Verschlüsselung fehlgeschlagen.');
        }
        return 'v1:' . base64_encode($iv . $tag . $cipher);
    }

    public static function decrypt(string $enc): ?string
    {
        if (!str_starts_with($enc, 'v1:')) {
            return null;
        }
        $raw = base64_decode(substr($enc, 3), true);
        if ($raw === false || strlen($raw) < 28) {
            return null;
        }
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        return $plain === false ? null : $plain;
    }

    public static function randomKey(int $bytes = 32): string
    {
        return Util::b64url(random_bytes($bytes));
    }
}
