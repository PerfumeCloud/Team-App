<?php
declare(strict_types=1);

namespace Club;

/**
 * Shopify App-Proxy: Der Shop leitet perfumecloud.de/apps/club/* an /api/proxy/* weiter und hängt an, wer im Shop
 * angemeldet ist (logged_in_customer_id) – signiert mit dem Client-Secret der Shopify-App. Cookies kommen nicht mit.
 * So kann der Warenkorb im Theme Punkte einlösen, ohne eigene Anmeldung in der Club-App.
 */
final class Proxy
{
    /** So alt darf eine weitergeleitete Anfrage höchstens sein (Sekunden). */
    private const MAX_AGE = 300;

    private static ?string $customer = null;

    /**
     * Signatur und Alter prüfen. Schreibende Anfragen nur als JSON: Ein Formular auf einer fremden Seite kann das
     * nicht senden, ohne dass der Browser vorher fragt – so löst niemand über eine fremde Seite Punkte ein.
     */
    public static function guard(string $method): void
    {
        $secret = Settings::getSecret('shopify_secret');
        if (!$secret) {
            throw new HttpError(503, 'Der Club ist noch nicht mit dem Shop verbunden.');
        }
        $params = self::params((string) ($_SERVER['QUERY_STRING'] ?? ''));
        $signature = $params['signature'] ?? '';
        unset($params['signature']);
        $pairs = [];
        foreach ($params as $k => $v) {
            $pairs[] = $k . '=' . $v;
        }
        sort($pairs, SORT_STRING);
        if ($signature === '' || !hash_equals(hash_hmac('sha256', implode('', $pairs), $secret), $signature)) {
            throw new HttpError(401, 'Ungültige Signatur.');
        }
        if (abs(time() - (int) ($params['timestamp'] ?? 0)) > self::MAX_AGE) {
            throw new HttpError(401, 'Die Anfrage ist abgelaufen. Bitte lade die Seite neu.');
        }
        $shop = Shopify::config()['shop'];
        if ($shop !== '' && ($params['shop'] ?? '') !== $shop) {
            throw new HttpError(401, 'Anfrage aus einem anderen Shop.');
        }
        if ($method !== 'GET' && $method !== 'HEAD' && !str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
            throw new HttpError(415, 'Ungültige Anfrage.');
        }
        $id = (string) ($params['logged_in_customer_id'] ?? '');
        self::$customer = preg_match('/^\d{1,20}$/', $id) ? $id : '';
    }

    /** Wie Shopify (Rack::Utils.parse_query): mehrfache Schlüssel mit Komma verbunden. */
    private static function params(string $query): array
    {
        $out = [];
        foreach (explode('&', $query) as $pair) {
            if ($pair === '') {
                continue;
            }
            [$k, $v] = array_pad(explode('=', $pair, 2), 2, '');
            $k = urldecode($k);
            $v = urldecode($v);
            $out[$k] = array_key_exists($k, $out) ? $out[$k] . ',' . $v : $v;
        }
        return $out;
    }

    /** Club-Mitglied des angemeldeten Kundenkontos (null = Gast oder nicht beigetreten). */
    private static function member(): ?array
    {
        if (!self::$customer) {
            return null;
        }
        $m = Db::one('SELECT * FROM club_members WHERE shopify_id = ?', ['gid://shopify/Customer/' . self::$customer]);
        return $m && $m['joined_at'] ? $m : null;
    }

    private static function requireMember(): array
    {
        $m = self::member();
        if (!$m) {
            throw new HttpError(self::$customer ? 409 : 401, self::$customer ? 'Tritt erst dem Club bei, dann kannst du Punkte einlösen.' : 'Bitte melde dich im Shop an.');
        }
        return $m;
    }

    /** Für den Warenkorb: Punktestand, Euro-Wert, was in diesen Warenkorb passt, gesperrte Punkte und die aktive Einlösung. */
    public static function status(int $cartCents): array
    {
        $m = self::member();
        $base = ['app_url' => Util::baseUrl()];
        if (!$m) {
            return $base + ['zustand' => self::$customer ? 'kein_mitglied' : 'gast'];
        }
        $p = Points::program();
        $balance = Points::balance($m['id']);
        $held = Points::held($m['id']);
        $code = Points::cartCode($m['id']);
        // Die aktive Einlösung zählt zum Spielraum dazu: Neu wählen ersetzt sie
        $free = $balance + ($code ? (int) $code['points'] : 0);
        return $base + [
            'zustand' => 'mitglied',
            'aktiv' => (bool) $p['active'],
            'punkte' => $balance,
            'wert_cents' => Points::worth($balance, $p),
            'schritt_punkte' => (int) $p['redeem_points'],
            'schritt_cents' => (int) $p['redeem_cents'],
            'max_cents' => (int) $p['max_cents'],
            'max_punkte' => max(0, min($free, Points::cartCap($cartCents, $p))),
            'verfuegbar' => $free,
            'gesperrt' => $held['points'],
            'freigaben' => array_map(static fn ($u) => [
                'punkte' => $u['points'],
                'ab' => $u['payment'] ? null : date('Y-m-d', intdiv($u['at'], 1000)),
                'zahlung' => $u['payment'],
            ], array_slice($held['unlocks'], 0, 3)),
            'einloesung' => $code ? self::publicCode($code) : null,
            'stunden' => Points::CART_HOURS,
        ];
    }

    public static function redeem(array $in): array
    {
        $m = self::requireMember();
        Util::limit('cart-redeem:' . $m['id'], 30, 3600, 'Bitte warte ein bisschen, bevor du noch einmal einlöst.');
        $cart = max(0, (int) ($in['cents'] ?? 0));
        $code = Points::redeemCart($m, (int) ($in['punkte'] ?? 0), !empty($in['alle']), $cart);
        Http::defer(static fn () => Points::pushMetafields());
        return ['code' => $code['code']] + self::status($cart);
    }

    public static function release(array $in): array
    {
        $m = self::requireMember();
        $code = Points::releaseCart($m);
        if ($code) {
            Http::defer(static fn () => Points::pushMetafields());
        }
        return ['zurueck' => $code ? $code['code'] : null] + self::status(max(0, (int) ($in['cents'] ?? 0)));
    }

    private static function publicCode(array $c): array
    {
        return ['code' => $c['code'], 'punkte' => (int) $c['points'], 'wert_cents' => (int) $c['value_cents'], 'bis' => (int) $c['expires_at']];
    }
}
