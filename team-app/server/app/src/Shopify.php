<?php
declare(strict_types=1);

namespace PC;

/**
 * Zugriff auf die Shopify Admin API über eine eigene App aus dem Shopify Dev Dashboard
 * (Client-Credentials-Grant: Client-ID + Secret → Token, 24 h gültig).
 */
final class Shopify
{
    public const API_VERSION = '2026-10';

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
            throw new HttpError(422, 'Bitte die Client-ID angeben.');
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
        [$status, $body] = self::http('https://' . $c['shop'] . '/admin/oauth/access_token', [
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
        $c = self::config();
        $url = 'https://' . $c['shop'] . '/admin/api/' . self::API_VERSION . '/graphql.json';
        $payload = Util::json(['query' => $query, 'variables' => (object) $variables]);
        $forceToken = false;
        for ($attempt = 0; $attempt < 4; $attempt++) {
            [$status, $body] = self::http($url, [
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
                sleep(2 + $attempt * 2);
                continue;
            }
            if ($status !== 200 || !is_array($data)) {
                throw new \RuntimeException("Shopify-API-Fehler ($status)");
            }
            if (!empty($data['errors'])) {
                throw new \RuntimeException('Shopify: ' . Util::json($data['errors']));
            }
            return $data['data'] ?? [];
        }
        throw new \RuntimeException('Shopify-API ist gerade überlastet.');
    }

    public static function test(): array
    {
        try {
            self::token(true);
            $d = self::graphql('query { shop { name myshopifyDomain currencyCode } }');
            $scope = (string) (Settings::get('shopify_token')['scope'] ?? '');
            $missing = array_values(array_diff(['read_orders', 'read_products', 'read_inventory'], explode(',', $scope)));
            $msg = 'Verbunden mit ' . ($d['shop']['name'] ?? '?');
            if ($missing) {
                return ['ok' => false, 'message' => $msg . ' – es fehlen Berechtigungen: ' . implode(', ', $missing)];
            }
            return ['ok' => true, 'message' => $msg];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        }
    }

    /** @return array{0:int,1:string} */
    private static function http(string $url, array $headers, string $body): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_USERAGENT => 'PerfumeCloudTeamApp/' . APP_VERSION,
        ]);
        $res = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false) {
            throw new \RuntimeException('Shopify nicht erreichbar: ' . $err);
        }
        return [$status, (string) $res];
    }
}
