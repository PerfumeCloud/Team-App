<?php
declare(strict_types=1);

namespace Club;

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

    public static function email(mixed $v): string
    {
        $e = mb_strtolower(trim(is_string($v) ? $v : ''));
        if ($e === '' || mb_strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Bitte gib eine gültige E-Mail-Adresse ein.');
        }
        return $e;
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

    /** Basis-URL der App, z. B. https://app.perfumecloud.de */
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

    /** "12.90" → 1290 */
    public static function cents(mixed $amount): int
    {
        if (!is_string($amount) && !is_int($amount) && !is_float($amount)) {
            return 0;
        }
        return (int) round(((float) $amount) * 100);
    }

    /** 1290 → "12.90" (für die Shopify-API) */
    public static function decimal(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    public static function euro(int $cents): string
    {
        $s = number_format($cents / 100, 2, ',', '.');
        return (str_ends_with($s, ',00') ? substr($s, 0, -3) : $s) . ' €';
    }

    /** ISO-Datum von Shopify → Millisekunden */
    public static function ms(?string $iso): ?int
    {
        if (!$iso) {
            return null;
        }
        $t = strtotime($iso);
        return $t === false ? null : $t * 1000;
    }

    public static function iso(int $ms): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', intdiv($ms, 1000));
    }

    /** Begrenzt Versuche je Schlüssel (z. B. IP oder E-Mail) in einem Zeitfenster. */
    public static function limit(string $bucket, int $max, int $windowSec, string $message): void
    {
        $now = self::now();
        Db::exec('DELETE FROM attempts WHERE bucket = ? AND created_at < ?', [$bucket, $now - $windowSec * 1000]);
        if ((int) Db::value('SELECT COUNT(*) FROM attempts WHERE bucket = ?', [$bucket]) >= $max) {
            throw new HttpError(429, $message);
        }
        Db::insert('attempts', ['id' => self::uuid(), 'bucket' => $bucket, 'created_at' => $now]);
    }

    /** Für ausgehende HTTP-Anfragen (Shopify). @return array{0:int,1:string} */
    public static function http(string $method, string $url, array $headers = [], ?string $body = null): array
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => $method === 'GET',
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT => 'PerfumeCloudClub/' . APP_VERSION,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($ch, $opts);
        $res = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false) {
            throw new \RuntimeException('Keine Verbindung zu ' . (parse_url($url, PHP_URL_HOST) ?: $url) . ': ' . $err);
        }
        return [$status, (string) $res];
    }
}
