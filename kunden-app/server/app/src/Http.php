<?php
declare(strict_types=1);

namespace Club;

final class Http
{
    /** @var callable[] Arbeit, die nach dem Absenden der Antwort erledigt wird (z. B. Push). */
    private static array $deferred = [];
    private static ?array $body = null;

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** Pfad hinter /api, z. B. "/tasks/123". */
    public static function path(): string
    {
        $uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $pos = strpos($uri, '/api/');
        if ($pos !== false) {
            $uri = substr($uri, $pos + 4);
        } elseif (str_ends_with($uri, '/api')) {
            $uri = '/';
        }
        return '/' . trim($uri, '/');
    }

    public static function body(): array
    {
        if (self::$body === null) {
            $raw = file_get_contents('php://input');
            $data = $raw ? json_decode($raw, true) : [];
            self::$body = is_array($data) ? $data : [];
        }
        return self::$body;
    }

    public static function query(string $key, ?string $default = null): ?string
    {
        $v = $_GET[$key] ?? $default;
        return is_string($v) ? $v : $default;
    }

    public static function defer(callable $fn): void
    {
        self::$deferred[] = $fn;
    }

    public static function json(mixed $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo Util::json($data);
    }

    /** Antwort an den Browser schicken und danach aufgeschobene Arbeit erledigen. */
    public static function finish(): void
    {
        if (!self::$deferred) {
            return;
        }
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        } else {
            @ob_end_flush();
            @flush();
        }
        ignore_user_abort(true);
        foreach (self::$deferred as $fn) {
            try {
                $fn();
            } catch (\Throwable $e) {
                Util::log('Deferred: ' . $e->getMessage());
            }
        }
        self::$deferred = [];
    }

    public static function reset(): void
    {
        self::$body = null;
        self::$deferred = [];
    }
}
