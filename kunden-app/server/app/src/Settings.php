<?php
declare(strict_types=1);

namespace Club;

/** Schlüssel-Wert-Speicher in der Datenbank. Geheimnisse werden verschlüsselt abgelegt. */
final class Settings
{
    private static array $cache = [];

    public static function get(string $key, mixed $default = null): mixed
    {
        if (!array_key_exists($key, self::$cache)) {
            $raw = Db::value('SELECT v FROM settings WHERE k = ?', [$key]);
            self::$cache[$key] = $raw === null ? null : json_decode((string) $raw, true);
        }
        return self::$cache[$key] ?? $default;
    }

    public static function set(string $key, mixed $value): void
    {
        $now = Util::now();
        $json = Util::json($value);
        if (Db::exec('UPDATE settings SET v = ?, updated_at = ? WHERE k = ?', [$json, $now, $key]) === 0) {
            if (!Db::value('SELECT 1 FROM settings WHERE k = ?', [$key])) {
                Db::insert('settings', ['k' => $key, 'v' => $json, 'updated_at' => $now]);
            }
        }
        self::$cache[$key] = $value;
    }

    public static function delete(string $key): void
    {
        Db::exec('DELETE FROM settings WHERE k = ?', [$key]);
        unset(self::$cache[$key]);
    }

    public static function getSecret(string $key): ?string
    {
        $enc = self::get($key);
        if (!is_string($enc) || $enc === '') {
            return null;
        }
        return Crypto::decrypt($enc);
    }

    public static function setSecret(string $key, ?string $plain): void
    {
        if ($plain === null || $plain === '') {
            self::delete($key);
            return;
        }
        self::set($key, Crypto::encrypt($plain));
    }

    public static function clearCache(): void
    {
        self::$cache = [];
    }
}
