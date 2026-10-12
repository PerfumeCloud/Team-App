<?php
declare(strict_types=1);

namespace PC;

final class Util
{
    /** Aktuelle Zeit in Millisekunden. */
    public static function now(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    public static function isUuid(mixed $v): bool
    {
        return is_string($v) && (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v);
    }

    public static function b64url(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    public static function b64urlDecode(string $s): string
    {
        $s = strtr($s, '-_', '+/');
        $pad = strlen($s) % 4;
        if ($pad) {
            $s .= str_repeat('=', 4 - $pad);
        }
        $out = base64_decode($s, true);
        if ($out === false) {
            throw new \InvalidArgumentException('Ungültiges Base64.');
        }
        return $out;
    }

    public static function str(mixed $v, int $max, bool $nullable = true): ?string
    {
        if ($v === null || $v === '') {
            return $nullable ? null : '';
        }
        if (!is_string($v) && !is_numeric($v)) {
            throw new HttpError(422, 'Ungültiger Text.');
        }
        $s = trim((string) $v);
        if (mb_strlen($s) > $max) {
            $s = mb_substr($s, 0, $max);
        }
        return $s === '' && $nullable ? null : $s;
    }

    public static function oneOf(mixed $v, array $allowed, string $default): string
    {
        return is_string($v) && in_array($v, $allowed, true) ? $v : $default;
    }

    public static function json(mixed $v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public static function clientIp(): string
    {
        return substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'cli'), 0, 64);
    }

    public static function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
            || ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443);
    }

    /** Basis-URL der App, z. B. https://team.perfumecloud.de */
    public static function baseUrl(): string
    {
        $configured = Config::get('base_url');
        if (is_string($configured) && $configured !== '') {
            return rtrim($configured, '/');
        }
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        return (self::isHttps() ? 'https' : 'http') . '://' . $host;
    }

    public static function log(string $message): void
    {
        $line = '[' . date('Y-m-d H:i:s') . '] ' . $message . "\n";
        @file_put_contents(Config::storageDir() . '/app.log', $line, FILE_APPEND | LOCK_EX);
    }

    public static function euro(int $cents): string
    {
        return number_format($cents / 100, 2, ',', '.') . ' €';
    }
}
