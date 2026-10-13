<?php
declare(strict_types=1);

namespace Club;

/**
 * Anmeldung mit dem Perfume-Cloud-Kundenkonto über die Shopify Customer Account API (OpenID Connect).
 * Kundinnen und Kunden melden sich auf der Shopify-Seite mit E-Mail-Code an oder legen dort ihr Konto an –
 * dasselbe Konto wie im Shop. Die App bekommt danach nur Kundennummer, E-Mail und Name.
 *
 * Einrichtung: Shopify-Admin → Vertriebskanäle → Headless → Storefront → Customer Account API.
 * Mit Client-Secret (Typ „Vertraulich“) oder ohne (Typ „Öffentlich“, dann mit PKCE).
 */
final class CustomerAccount
{
    private const STATE_COOKIE = 'pcc_o';
    private const STATE_TTL_MS = 15 * 60 * 1000;

    public static function config(): array
    {
        $c = Settings::get('login_shopify', []);
        return ['client_id' => is_array($c) ? (string) ($c['client_id'] ?? '') : ''];
    }

    public static function configured(): bool
    {
        return self::config()['client_id'] !== '' && (Shopify::config()['shop'] !== '' || self::envBase() !== null);
    }

    public static function save(array $in): void
    {
        $clientId = Util::str($in['client_id'] ?? '', 200, false);
        Settings::set('login_shopify', ['client_id' => $clientId]);
        if (array_key_exists('client_secret', $in) && $in['client_secret'] !== null && $in['client_secret'] !== '') {
            Settings::setSecret('login_shopify_secret', (string) $in['client_secret']);
        }
        if (!empty($in['clear_secret'])) {
            Settings::setSecret('login_shopify_secret', null);
        }
        Settings::delete('login_discovery');
    }

    public static function redirectUri(): string
    {
        return Util::baseUrl() . '/api/auth/shopify/callback';
    }

    private static function envBase(): ?string
    {
        $env = getenv('CLUB_CA_BASE');
        return $env !== false && $env !== '' ? rtrim($env, '/') : null;
    }

    /** Endpunkte aus den Discovery-Dokumenten des Shops (12 h zwischengespeichert). */
    public static function discovery(bool $fresh = false): array
    {
        $cached = Settings::get('login_discovery');
        if (!$fresh && is_array($cached) && ($cached['at'] ?? 0) > time() - 12 * 3600) {
            return $cached;
        }
        $base = self::envBase() ?? 'https://' . Shopify::config()['shop'];
        [$s1, $b1] = Util::http('GET', $base . '/.well-known/openid-configuration', ['Accept: application/json']);
        [$s2, $b2] = Util::http('GET', $base . '/.well-known/customer-account-api', ['Accept: application/json']);
        $oidc = json_decode($b1, true);
        $api = json_decode($b2, true);
        if ($s1 !== 200 || !is_array($oidc) || empty($oidc['authorization_endpoint']) || empty($oidc['token_endpoint'])) {
            throw new \RuntimeException('Shopify-Anmeldung nicht gefunden (' . $s1 . '). Sind die neuen Kundenkonten im Shop aktiv?');
        }
        if ($s2 !== 200 || !is_array($api) || empty($api['graphql_api'])) {
            throw new \RuntimeException('Customer Account API nicht gefunden (' . $s2 . ').');
        }
        $d = [
            'authorize' => (string) $oidc['authorization_endpoint'],
            'token' => (string) $oidc['token_endpoint'],
            'logout' => (string) ($oidc['end_session_endpoint'] ?? ''),
            'graphql' => (string) $api['graphql_api'],
            'at' => time(),
        ];
        Settings::set('login_discovery', $d);
        return $d;
    }

    /** Baut den Link zur Shopify-Anmeldeseite und merkt sich state/nonce. */
    public static function start(string $next, bool $silent = false): string
    {
        if (!self::configured()) {
            throw new HttpError(503, 'Die Anmeldung über Shopify ist noch nicht eingerichtet.');
        }
        $d = self::discovery();
        $state = Util::b64url(random_bytes(24));
        $nonce = Util::b64url(random_bytes(16));
        $verifier = self::isPublic() ? Util::b64url(random_bytes(48)) : null;
        Db::insert('oauth_states', [
            'id' => hash('sha256', $state),
            'verifier' => $verifier,
            'nonce' => $nonce,
            'next_path' => self::safeNext($next),
            'created_at' => Util::now(),
        ]);
        self::cookie($state, time() + intdiv(self::STATE_TTL_MS, 1000));

        $params = [
            'scope' => 'openid email customer-account-api:full',
            'client_id' => self::config()['client_id'],
            'response_type' => 'code',
            'redirect_uri' => self::redirectUri(),
            'state' => $state,
            'nonce' => $nonce,
            'locale' => 'de',
        ];
        if ($verifier !== null) {
            $params['code_challenge'] = Util::b64url(hash('sha256', $verifier, true));
            $params['code_challenge_method'] = 'S256';
        }
        if ($silent) {
            $params['prompt'] = 'none';
        }
        return $d['authorize'] . (str_contains($d['authorize'], '?') ? '&' : '?') . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    }

    /**
     * Rückkehr von Shopify: Code gegen Token tauschen und das Kundenkonto lesen.
     * @return array{customer: array{id:string,email:string,first_name:?string,last_name:?string}, id_token: ?string, next: string}
     */
    public static function finish(string $code, string $state): array
    {
        $cookie = $_COOKIE[self::STATE_COOKIE] ?? '';
        self::cookie('', time() - 3600);
        if ($state === '' || $code === '' || !is_string($cookie) || !hash_equals($cookie, $state)) {
            throw new HttpError(400, 'Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.');
        }
        $row = Db::one('SELECT * FROM oauth_states WHERE id = ?', [hash('sha256', $state)]);
        Db::exec('DELETE FROM oauth_states WHERE id = ? OR created_at < ?', [hash('sha256', $state), Util::now() - self::STATE_TTL_MS]);
        if (!$row || (int) $row['created_at'] < Util::now() - self::STATE_TTL_MS) {
            throw new HttpError(400, 'Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.');
        }

        $d = self::discovery();
        $clientId = self::config()['client_id'];
        $form = [
            'grant_type' => 'authorization_code',
            'client_id' => $clientId,
            'redirect_uri' => self::redirectUri(),
            'code' => $code,
        ];
        $headers = ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'];
        $secret = Settings::getSecret('login_shopify_secret');
        if ($secret) {
            $headers[] = 'Authorization: Basic ' . base64_encode($clientId . ':' . $secret);
        } else {
            $form['code_verifier'] = (string) $row['verifier'];
            $headers[] = 'Origin: ' . Util::baseUrl();
        }
        [$status, $body] = Util::http('POST', $d['token'], $headers, http_build_query($form));
        $tokens = json_decode($body, true);
        if ($status !== 200 || !is_array($tokens) || empty($tokens['access_token'])) {
            Util::log('Shopify-Login: Token-Tausch fehlgeschlagen (' . $status . '): ' . mb_substr($body, 0, 300));
            throw new HttpError(502, 'Shopify hat die Anmeldung nicht bestätigt. Bitte versuche es noch einmal.');
        }
        $idToken = isset($tokens['id_token']) ? (string) $tokens['id_token'] : null;
        if ($idToken !== null) {
            $claims = self::claims($idToken);
            if (isset($claims['nonce']) && !hash_equals((string) $row['nonce'], (string) $claims['nonce'])) {
                throw new HttpError(400, 'Die Anmeldung konnte nicht bestätigt werden. Bitte versuche es noch einmal.');
            }
        }

        $apiHeaders = [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: ' . $tokens['access_token'],
        ];
        if (!$secret) {
            $apiHeaders[] = 'Origin: ' . Util::baseUrl();
        }
        [$s, $b] = Util::http('POST', $d['graphql'], $apiHeaders, Util::json([
            'query' => 'query { customer { id firstName lastName emailAddress { emailAddress } } }',
        ]));
        $data = json_decode($b, true);
        $c = is_array($data) ? ($data['data']['customer'] ?? null) : null;
        if ($s !== 200 || !is_array($c) || empty($c['id'])) {
            Util::log('Shopify-Login: Kundendaten nicht lesbar (' . $s . '): ' . mb_substr($b, 0, 300));
            throw new HttpError(502, 'Dein Kundenkonto konnte nicht gelesen werden. Bitte versuche es noch einmal.');
        }
        $email = mb_strtolower((string) ($c['emailAddress']['emailAddress'] ?? ''));
        if ($email === '') {
            throw new HttpError(422, 'In deinem Kundenkonto ist keine E-Mail-Adresse hinterlegt.');
        }
        return [
            'customer' => [
                'id' => (string) $c['id'],
                'email' => $email,
                'first_name' => $c['firstName'] ?? null,
                'last_name' => $c['lastName'] ?? null,
            ],
            'id_token' => $idToken,
            'next' => (string) ($row['next_path'] ?: '/'),
        ];
    }

    /** Abmelden auch bei Shopify, damit beim nächsten „Anmelden“ nicht automatisch dasselbe Konto genommen wird. */
    public static function logoutUrl(?string $idToken): ?string
    {
        if (!$idToken || !self::configured()) {
            return null;
        }
        try {
            $d = self::discovery();
        } catch (\Throwable) {
            return null;
        }
        if ($d['logout'] === '') {
            return null;
        }
        return $d['logout'] . (str_contains($d['logout'], '?') ? '&' : '?') . http_build_query([
            'id_token_hint' => $idToken,
            'post_logout_redirect_uri' => Util::baseUrl() . '/',
        ], '', '&', PHP_QUERY_RFC3986);
    }

    public static function test(): array
    {
        if (self::config()['client_id'] === '') {
            return ['ok' => false, 'message' => 'Client-ID der Customer Account API fehlt.'];
        }
        try {
            $d = self::discovery(true);
            $type = self::isPublic() ? 'öffentlicher Client (ohne Secret)' : 'vertraulicher Client (mit Secret)';
            return ['ok' => true, 'message' => 'Anmeldeseite gefunden: ' . parse_url($d['authorize'], PHP_URL_HOST) . ' · ' . $type];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        }
    }

    private static function isPublic(): bool
    {
        return Settings::getSecret('login_shopify_secret') === null;
    }

    /** Nur relative Pfade innerhalb der App zulassen (kein offener Redirect). */
    public static function safeNext(string $next): string
    {
        return preg_match('#^/(?!/)[A-Za-z0-9/_\-?=&.%]*$#', $next) && !str_starts_with($next, '/api') ? $next : '/';
    }

    /** Inhalt eines JWT (ohne Signaturprüfung – das Token kommt direkt per TLS vom Token-Endpunkt). */
    private static function claims(string $jwt): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) < 2) {
            return [];
        }
        try {
            $data = json_decode(Util::b64urlDecode($parts[1]), true);
        } catch (\Throwable) {
            return [];
        }
        return is_array($data) ? $data : [];
    }

    private static function cookie(string $value, int $expires): void
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        setcookie(self::STATE_COOKIE, $value, [
            'expires' => $expires,
            'path' => '/api/auth/shopify',
            'secure' => Util::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
}
