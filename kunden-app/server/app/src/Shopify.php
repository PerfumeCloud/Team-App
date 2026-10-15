<?php
declare(strict_types=1);

namespace Club;

/**
 * Shopify Admin API über eine eigene App aus dem Shopify Dev Dashboard
 * (Client-Credentials-Grant: Client-ID + Secret → Token, 24 h gültig).
 */
final class Shopify
{
    public const API_VERSION = '2026-10';

    /** Diese Berechtigungen braucht der Club. write_* schließt read_* ein. */
    public const SCOPES = ['read_orders', 'write_customers', 'write_discounts'];

    public static function config(): array
    {
        $c = Settings::get('shopify', []);
        return [
            'shop' => is_array($c) ? (string) ($c['shop'] ?? '') : '',
            'client_id' => is_array($c) ? (string) ($c['client_id'] ?? '') : '',
        ];
    }

    public static function configured(): bool
    {
        $c = self::config();
        return $c['shop'] !== '' && $c['client_id'] !== '' && Settings::getSecret('shopify_secret') !== null;
    }

    /** https://<shop>.myshopify.com – in Tests durch einen Nachbau ersetzt (CLUB_SHOPIFY_BASE). */
    public static function base(): string
    {
        $env = getenv('CLUB_SHOPIFY_BASE');
        if ($env !== false && $env !== '') {
            return rtrim($env, '/');
        }
        return 'https://' . self::config()['shop'];
    }

    public static function normalizeShop(string $input): string
    {
        $s = strtolower(trim($input));
        $s = preg_replace('#^https?://#', '', $s);
        $s = explode('/', (string) $s)[0];
        if ($s !== '' && !str_contains($s, '.')) {
            $s .= '.myshopify.com';
        }
        if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $s)) {
            throw new HttpError(422, 'Bitte die myshopify-Adresse angeben (z. B. ks8yin-mg.myshopify.com), nicht die Shop-Domain.');
        }
        return $s;
    }

    public static function save(array $in): void
    {
        $shop = self::normalizeShop((string) ($in['shop'] ?? ''));
        $clientId = Util::str($in['client_id'] ?? '', 200, false);
        if ($clientId === '') {
            throw new HttpError(422, 'Bitte die Client-ID der Shopify-App angeben.');
        }
        Settings::set('shopify', ['shop' => $shop, 'client_id' => $clientId]);
        if (!empty($in['client_secret'])) {
            Settings::setSecret('shopify_secret', (string) $in['client_secret']);
        }
        Settings::delete('shopify_token');
    }

    public static function token(bool $force = false): string
    {
        $cached = Settings::get('shopify_token');
        if (!$force && is_array($cached) && ($cached['expires'] ?? 0) > time() + 300) {
            $plain = Crypto::decrypt((string) $cached['token']);
            if ($plain) {
                return $plain;
            }
        }
        $c = self::config();
        $secret = Settings::getSecret('shopify_secret');
        if ($c['shop'] === '' || $c['client_id'] === '' || !$secret) {
            throw new \RuntimeException('Shopify ist noch nicht verbunden.');
        }
        [$status, $body] = Util::http('POST', self::base() . '/admin/oauth/access_token', [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ], http_build_query([
            'grant_type' => 'client_credentials',
            'client_id' => $c['client_id'],
            'client_secret' => $secret,
        ]));
        $data = json_decode($body, true);
        if ($status !== 200 || empty($data['access_token'])) {
            $msg = is_array($data) ? ($data['error_description'] ?? $data['error'] ?? $data['errors'] ?? '') : '';
            throw new \RuntimeException('Shopify-Anmeldung fehlgeschlagen (' . $status . ')' . ($msg ? ': ' . (is_string($msg) ? $msg : Util::json($msg)) : ''));
        }
        Settings::set('shopify_token', [
            'token' => Crypto::encrypt($data['access_token']),
            'expires' => time() + (int) ($data['expires_in'] ?? 86399),
            'scope' => $data['scope'] ?? '',
        ]);
        return $data['access_token'];
    }

    public static function graphql(string $query, array $variables = []): array
    {
        $strict = null;
        return self::request($query, $variables, $strict);
    }

    /**
     * Wie graphql(), aber fehlende Rechte für einzelne Felder (fehlender Scope, nicht freigegebene geschützte
     * Kundendaten) brechen nicht ab: Shopify liefert diese Felder als null, die Meldungen landen in $denied.
     * Für den Abgleich, damit Punkte auch dann weiterlaufen, wenn z. B. Name und E-Mail nicht freigegeben sind.
     */
    public static function graphqlPartial(string $query, array $variables, ?array &$denied): array
    {
        $denied = [];
        return self::request($query, $variables, $denied);
    }

    /** Ist dieser Scope (oder sein write_-Gegenstück) für die App freigegeben? */
    public static function hasScope(string $scope): bool
    {
        $granted = array_filter(explode(',', (string) (Settings::get('shopify_token')['scope'] ?? '')));
        return in_array($scope, $granted, true) || in_array((string) preg_replace('/^read_/', 'write_', $scope), $granted, true);
    }

    private static function accessError(mixed $e): bool
    {
        return is_array($e) && (($e['extensions']['code'] ?? '') === 'ACCESS_DENIED'
            || (bool) preg_match('/not approved to access|access denied|access scope/i', (string) ($e['message'] ?? '')));
    }

    private static function request(string $query, array $variables, ?array &$denied): array
    {
        $url = self::base() . '/admin/api/' . self::API_VERSION . '/graphql.json';
        $payload = Util::json(['query' => $query, 'variables' => (object) $variables]);
        $forceToken = false;
        for ($attempt = 0; $attempt < 4; $attempt++) {
            [$status, $body] = Util::http('POST', $url, [
                'Content-Type: application/json',
                'X-Shopify-Access-Token: ' . self::token($forceToken),
            ], $payload);
            $data = json_decode($body, true);
            if ($status === 401 && !$forceToken) {
                $forceToken = true;
                continue;
            }
            $throttled = $status === 429 || (is_array($data) && str_contains(Util::json($data['errors'] ?? ''), 'THROTTLED'));
            if ($throttled) {
                sleep(1 + $attempt * 2);
                continue;
            }
            if ($status !== 200 || !is_array($data)) {
                throw new \RuntimeException("Shopify-API-Fehler ($status)");
            }
            if (!empty($data['errors'])) {
                $errors = is_array($data['errors']) ? $data['errors'] : [$data['errors']];
                if ($denied === null || !is_array($data['data'] ?? null) || count(array_filter($errors, static fn ($e) => self::accessError($e))) !== count($errors)) {
                    throw new \RuntimeException('Shopify: ' . Util::json($data['errors']));
                }
                $denied = array_values(array_unique(array_map(static fn ($e) => (string) ($e['message'] ?? ''), $errors)));
            }
            return $data['data'] ?? [];
        }
        throw new \RuntimeException('Shopify-API ist gerade überlastet.');
    }

    /** Wirft eine verständliche Meldung, wenn eine Mutation userErrors zurückgibt. */
    public static function check(array $payload, string $what): void
    {
        $errors = $payload['userErrors'] ?? [];
        if ($errors) {
            $msg = implode('; ', array_map(static fn ($e) => (string) ($e['message'] ?? ''), $errors));
            throw new \RuntimeException("Shopify ($what): $msg");
        }
    }

    public static function missingScopes(): array
    {
        $granted = array_filter(explode(',', (string) (Settings::get('shopify_token')['scope'] ?? '')));
        $missing = [];
        foreach (self::SCOPES as $scope) {
            $write = preg_replace('/^read_/', 'write_', $scope);
            if (!in_array($scope, $granted, true) && !in_array($write, $granted, true)) {
                $missing[] = $scope;
            }
        }
        return $missing;
    }

    public static function test(): array
    {
        try {
            self::token(true);
            $d = self::graphql('query { shop { name myshopifyDomain primaryDomain { url } } }');
            $msg = 'Verbunden mit ' . ($d['shop']['name'] ?? '?');
            if ($url = $d['shop']['primaryDomain']['url'] ?? null) {
                Settings::set('shop_url', $url);
            }
            $missing = self::missingScopes();
            if ($missing) {
                return ['ok' => false, 'message' => $msg . ' – es fehlen Berechtigungen: ' . implode(', ', $missing)];
            }
            return ['ok' => true, 'message' => $msg];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        }
    }

    /** Öffentliche Shop-Adresse, z. B. https://www.perfumecloud.de */
    public static function shopUrl(): string
    {
        $url = Settings::get('shop_url');
        if (is_string($url) && $url !== '') {
            return rtrim($url, '/');
        }
        $shop = self::config()['shop'];
        return $shop !== '' ? 'https://' . $shop : 'https://www.perfumecloud.de';
    }
}
