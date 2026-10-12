<?php
declare(strict_types=1);

namespace PC;

/** Liest und schreibt config.php (wird vom Einrichtungsassistenten erzeugt). */
final class Config
{
    private static ?array $data = null;

    public static function path(): string
    {
        $env = getenv('PC_CONFIG');
        return $env !== false && $env !== '' ? $env : APP_ROOT . '/config.php';
    }

    public static function exists(): bool
    {
        return is_file(self::path());
    }

    public static function all(): array
    {
        if (self::$data === null) {
            self::$data = self::exists() ? (array) require self::path() : [];
        }
        return self::$data;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $value = self::all();
        foreach (explode('.', $key) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return $default;
            }
            $value = $value[$part];
        }
        return $value;
    }

    public static function write(array $data): void
    {
        $php = "<?php\n// Automatisch erzeugt vom Einrichtungsassistenten. Nicht veröffentlichen!\nreturn " . var_export($data, true) . ";\n";
        $path = self::path();
        if (@file_put_contents($path, $php, LOCK_EX) === false) {
            throw new HttpError(500, 'config.php konnte nicht geschrieben werden. Bitte Schreibrechte für den App-Ordner prüfen.');
        }
        @chmod($path, 0600);
        self::$data = $data;
        if (function_exists('opcache_invalidate')) {
            @opcache_invalidate($path, true);
        }
    }

    public static function storageDir(): string
    {
        $env = getenv('PC_STORAGE');
        $dir = $env !== false && $env !== '' ? $env : APP_ROOT . '/storage';
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
            @file_put_contents($dir . '/.htaccess', "Require all denied\n");
        }
        return $dir;
    }
}
