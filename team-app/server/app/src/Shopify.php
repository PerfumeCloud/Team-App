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

    /** https://<shop> – im Test zeigt PC_SHOPIFY_TEST auf einen Nachbau. */
    private static function base(): string
    {
        $test = getenv('PC_SHOPIFY_TEST');
        if (is_string($test) && $test !== '') {
            return rtrim($test, '/');
        }
        return 'https://' . self::config()['shop'];
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
        Settings::delete('shopify_scopes');
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
        [$status, $body] = self::http(self::base() . '/admin/oauth/access_token', [
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
        $url = self::base() . '/admin/api/' . self::API_VERSION . '/graphql.json';
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

    /**
     * Berechtigungen, die der Shop der App wirklich gegeben hat. Quelle ist Shopify selbst
     * (currentAppInstallation.accessScopes), nicht nur die Liste beim Token – write_x schließt read_x ein.
     * @return string[]
     */
    public static function scopes(): array
    {
        $g = self::grants();
        return $g ? $g['granted'] : self::tokenScopes();
    }

    /**
     * Gewährte und von der App-Version angefragte Berechtigungen (eine Stunde gemerkt, „Speichern & testen“ fragt neu).
     * Angefragt, aber nicht gewährt = im Dev Dashboard freigegeben, im Shop aber noch nicht bestätigt.
     * @return array{granted:string[], requested:string[], handle:string, at:int}|null
     */
    public static function grants(bool $refresh = false): ?array
    {
        $cached = Settings::get('shopify_scopes');
        if (!$refresh && is_array($cached) && ($cached['at'] ?? 0) > Util::now() - 3600 * 1000) {
            return $cached;
        }
        try {
            $d = self::graphql('query TeamScopes { currentAppInstallation { accessScopes { handle } app { handle requestedAccessScopes { handle } } } }');
        } catch (\Throwable $e) {
            Util::log('Shopify-Berechtigungen nicht abgefragt: ' . $e->getMessage());
            return is_array($cached) ? $cached : null;
        }
        $inst = $d['currentAppInstallation'] ?? null;
        if (!is_array($inst)) {
            return null;
        }
        $handles = static fn ($list) => array_values(array_unique(array_filter(array_map(static fn ($x) => trim((string) ($x['handle'] ?? '')), is_array($list) ? $list : []))));
        $out = [
            'granted' => self::expand(array_merge($handles($inst['accessScopes'] ?? []), self::tokenScopes())),
            'requested' => self::expand($handles($inst['app']['requestedAccessScopes'] ?? [])),
            'handle' => (string) ($inst['app']['handle'] ?? ''),
            'at' => Util::now(),
        ];
        Settings::set('shopify_scopes', $out);
        return $out;
    }

    /** Berechtigungen aus der letzten Anmeldung (Token-Antwort). @return string[] */
    private static function tokenScopes(): array
    {
        $t = Settings::get('shopify_token');
        if (!is_array($t) || ($t['scope'] ?? '') === '') {
            try {
                self::token();
                $t = Settings::get('shopify_token');
            } catch (\Throwable) {
                return [];
            }
        }
        return self::expand(explode(',', (string) ($t['scope'] ?? '')));
    }

    /** write_x schließt read_x ein (Shopify nennt dann oft nur write_x). @return string[] */
    private static function expand(array $scopes): array
    {
        $out = [];
        foreach ($scopes as $sc) {
            $sc = trim((string) $sc);
            if ($sc === '') {
                continue;
            }
            $out[$sc] = true;
            if (str_starts_with($sc, 'write_')) {
                $out['read_' . substr($sc, 6)] = true;
            }
        }
        return array_keys($out);
    }

    /**
     * Wo der Shop neue Berechtigungen bestätigt. Shopify liefert dafür selbst die Seite (app.installUrl:
     * „Webpage where you can install the app, if app requires explicit user permission“) und den Link zum Öffnen
     * der App. Den Kurznamen der App gibt es bei Apps aus dem Dev Dashboard oft nicht – „apps/<handle>“ führte
     * dann nur in die allgemeine App-Liste ohne Bestätigen-Knopf.
     * @return array{approve_url:string, open_url?:string}
     */
    private static function approveUrls(): array
    {
        $out = [];
        try {
            $d = self::graphql('query TeamApprove { currentAppInstallation { launchUrl app { installUrl } } }');
            $install = trim((string) ($d['currentAppInstallation']['app']['installUrl'] ?? ''));
            $launch = trim((string) ($d['currentAppInstallation']['launchUrl'] ?? ''));
            if (str_starts_with($install, 'https://')) {
                $out['approve_url'] = $install;
            }
            if (str_starts_with($launch, 'https://')) {
                $out[isset($out['approve_url']) ? 'open_url' : 'approve_url'] = $launch;
            }
        } catch (\Throwable $e) {
            Util::log('Shopify-Bestätigungslink nicht abgefragt: ' . $e->getMessage());
        }
        // Rückfall: App über die Client-ID öffnen – Shopify fragt dabei nach den neuen Berechtigungen
        $out['approve_url'] ??= 'https://' . self::config()['shop'] . '/admin/apps/' . rawurlencode(self::config()['client_id']);
        return $out;
    }

    /** Fehlende Berechtigungen. @return string[] */
    public static function missing(array $needed): array
    {
        $have = self::scopes();
        return array_values(array_filter($needed, static fn (string $s) => !in_array($s, $have, true)));
    }

    /** Link in den Shopify-Admin, z. B. adminUrl('orders/123'). */
    public static function adminUrl(string $path): string
    {
        $handle = (string) preg_replace('/\.myshopify\.com$/', '', self::config()['shop']);
        return 'https://admin.shopify.com/store/' . $handle . '/' . ltrim($path, '/');
    }

    /** Ziffern am Ende einer Shopify-ID („gid://shopify/Order/123“ → „123“). */
    public static function numericId(string $gid): string
    {
        return (string) preg_replace('/\D/', '', substr($gid, (int) strrpos($gid, '/')));
    }

    /** Pflicht für Bestellungen und Statistik. */
    public const REQUIRED = ['read_orders', 'read_products', 'read_inventory'];
    /** Für Kundeninfos, Versand und die Testbestellung im Club – ohne sie läuft der Rest trotzdem. */
    public const OPTIONAL = ['read_customers', 'write_merchant_managed_fulfillment_orders', 'write_orders'];

    /** @return array{ok:bool, message:string, missing?:string[], unapproved?:string[], approve_url?:string} */
    public static function test(): array
    {
        try {
            self::token(true);
            $d = self::graphql('query { shop { name myshopifyDomain currencyCode } }');
            $msg = 'Verbunden mit ' . ($d['shop']['name'] ?? '?');
            $g = self::grants(true);
            $have = $g ? $g['granted'] : self::tokenScopes();
            $missing = array_values(array_filter([...self::REQUIRED, ...self::OPTIONAL], static fn (string $s) => !in_array($s, $have, true)));
            if (!$missing) {
                return ['ok' => true, 'message' => $msg . ' · alle Berechtigungen da'];
            }
            // In der App-Version angefragt, aber im Shop noch nicht bestätigt (häufigster Fall nach einer neuen Version)
            $unapproved = $g ? array_values(array_intersect($missing, $g['requested'])) : [];
            $notRequested = array_values(array_diff($missing, $unapproved));
            $required = array_values(array_intersect($missing, self::REQUIRED));
            $parts = [];
            $out = ['missing' => $missing, 'unapproved' => $unapproved];
            if ($unapproved) {
                $parts[] = 'Im Shop noch nicht bestätigt: ' . implode(', ', $unapproved)
                    . '. Die neue App-Version ist freigegeben, Shopify wartet aber noch auf eure Zustimmung: „In Shopify bestätigen“ antippen, im Shop die Berechtigungen ansehen und „Aktualisieren“ bzw. „Installieren“ wählen. Danach hier „Erneut prüfen“.';
                $out += self::approveUrls();
            }
            if ($notRequested) {
                $parts[] = 'In der App-Version fehlen: ' . implode(', ', $notRequested) . '. Im Dev Dashboard eine neue Version mit diesen Zugriffsbereichen freigeben.';
            }
            if (!$required) {
                $parts[] = 'Bestellungen und Statistik laufen schon; nur Kundeninfos, Versand oder die Testbestellung warten darauf.';
            }
            return ['ok' => !$required, 'message' => $msg . ' – ' . implode(' ', $parts)] + $out;
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
