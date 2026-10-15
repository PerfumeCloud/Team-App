<?php
declare(strict_types=1);

namespace PC;

/**
 * Verbindung zum Members Club (Kunden-App, z. B. app.perfumecloud.de) – von Server zu Server.
 * Alle Aufrufe gehen an <Club-Adresse>/api/internal/… mit dem gemeinsamen Schlüssel im Header X-Club-Key.
 * Der Schlüssel bleibt auf dem Server; der Browser spricht nur mit der Team-App.
 *
 * Adresse und Schlüssel trägt ein Admin unter Integrationen ein. Fehlt etwas davon und hat der Club
 * seine Tabellen (club_…) in diese Datenbank gelegt, liest die Team-App beides aus club_settings.
 */
final class Club
{
    private const TIMEOUT = 10;

    // ---------- Konfiguration ----------

    /** @return array{url:string, key:?string, url_source:string, key_source:string} source: manual | auto | '' */
    public static function config(): array
    {
        $url = (string) (Settings::get('club_url') ?? '');
        $key = Settings::getSecret('club_key');
        $out = ['url' => $url, 'key' => $key, 'url_source' => $url !== '' ? 'manual' : '', 'key_source' => $key !== null ? 'manual' : ''];
        if ($url === '' || $key === null) {
            $d = self::detected();
            if ($d && $url === '' && $d['url'] !== '') {
                $out['url'] = $d['url'];
                $out['url_source'] = 'auto';
            }
            if ($d && $key === null && $d['key'] !== null) {
                $out['key'] = $d['key'];
                $out['key_source'] = 'auto';
            }
        }
        return $out;
    }

    public static function configured(): bool
    {
        $c = self::config();
        return $c['url'] !== '' && $c['key'] !== null;
    }

    /**
     * Adresse und Schlüssel aus club_settings (nur wenn der Club in dieser Datenbank liegt).
     * Werte stehen dort JSON-kodiert in Spalte v. Dabei merkt sich der Club die Adresse der Team-App (team_url).
     * @return array{url:string, key:?string}|null
     */
    public static function detected(): ?array
    {
        try {
            if (!Db::tableExists('club_settings')) {
                return null;
            }
            $rows = Db::all("SELECT k, v FROM club_settings WHERE k IN ('internal_key', 'app_url', 'team_url')");
        } catch (\Throwable) {
            return null;
        }
        $values = [];
        foreach ($rows as $r) {
            $v = json_decode((string) $r['v'], true);
            $values[$r['k']] = is_string($v) ? trim($v) : '';
        }
        self::rememberTeamUrl($values['team_url'] ?? null);
        $url = '';
        if (($values['app_url'] ?? '') !== '') {
            try {
                $url = self::normalizeUrl(preg_replace('#^http://(?!(127\.0\.0\.1|localhost)[:/])#i', 'https://', $values['app_url'] . '/') ?? '');
            } catch (HttpError) {
                $url = '';
            }
        }
        $key = ($values['internal_key'] ?? '') !== '' ? $values['internal_key'] : null;
        return $url !== '' || $key !== null ? ['url' => $url, 'key' => $key] : null;
    }

    /** Der Club verlinkt zurück zur Team-App – er liest die Adresse aus club_settings.team_url. */
    private static function rememberTeamUrl(?string $current): void
    {
        $base = (string) Config::get('base_url', '');
        if ($base === '' && PHP_SAPI !== 'cli' && Util::isHttps()) {
            $base = Util::baseUrl();
        }
        $base = rtrim($base, '/');
        if ($base === '' || $current === $base) {
            return;
        }
        try {
            $json = Util::json($base);
            if (Db::exec('UPDATE club_settings SET v = ?, updated_at = ? WHERE k = ?', [$json, Util::now(), 'team_url']) === 0) {
                Db::insert('club_settings', ['k' => 'team_url', 'v' => $json, 'updated_at' => Util::now()]);
            }
        } catch (\Throwable) {
            // nur ein Komfort für den Club
        }
    }

    /** Admin: Adresse und Schlüssel speichern. Leerer Schlüssel = unverändert lassen. */
    public static function save(array $in): void
    {
        if (array_key_exists('url', $in)) {
            $url = self::normalizeUrl((string) ($in['url'] ?? ''));
            if ($url === '') {
                Settings::delete('club_url');
            } else {
                Settings::set('club_url', $url);
            }
        }
        if (!empty($in['clear_key'])) {
            Settings::delete('club_key');
        } elseif (is_string($in['key'] ?? null) && trim($in['key']) !== '') {
            Settings::setSecret('club_key', trim($in['key']));
        }
        Settings::delete('club_status');
    }

    /** https://app.perfumecloud.de – ohne / am Ende und ohne /api (falls mitkopiert). */
    public static function normalizeUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        if (!preg_match('#^[a-z]+://#i', $url)) {
            $url = 'https://' . $url;
        }
        $p = parse_url($url);
        if (!is_array($p) || empty($p['host'])) {
            throw new HttpError(422, 'Bitte die Adresse des Clubs angeben, z. B. https://app.perfumecloud.de');
        }
        $scheme = strtolower((string) ($p['scheme'] ?? ''));
        $local = in_array($p['host'], ['127.0.0.1', 'localhost'], true);
        if ($scheme !== 'https' && !($scheme === 'http' && $local)) {
            throw new HttpError(422, 'Die Adresse des Clubs muss mit https:// beginnen.');
        }
        $path = (string) preg_replace('#/api(/internal)?$#', '', rtrim((string) ($p['path'] ?? ''), '/'));
        return $scheme . '://' . strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '') . $path;
    }

    /** Für die Einstellungen (ohne Schlüssel). */
    public static function settings(): array
    {
        $c = self::config();
        $d = self::detected();
        return [
            'club' => [
                'url' => (string) (Settings::get('club_url') ?? ''),
                'hasKey' => Settings::getSecret('club_key') !== null,
                'detected' => $d ? ['url' => $d['url'], 'hasKey' => $d['key'] !== null] : null,
                'effectiveUrl' => $c['url'],
                'urlSource' => $c['url_source'],
                'keySource' => $c['key_source'],
                'configured' => $c['url'] !== '' && $c['key'] !== null,
                'status' => Settings::get('club_status'),
            ],
        ];
    }

    // ---------- Aufrufe ----------

    /** Aufruf an den Club. Fehler kommen als HttpError mit verständlicher Meldung zurück. */
    public static function request(string $method, string $path, ?array $body = null): array
    {
        $c = self::config();
        if ($c['url'] === '' || $c['key'] === null) {
            throw new HttpError(409, 'Der Club ist noch nicht verbunden. Ein Admin kann Adresse und Schlüssel unter Einstellungen → Integrationen eintragen.');
        }
        $headers = ['Accept: application/json', 'X-Club-Key: ' . $c['key']];
        $opts = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => false,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = Util::json((object) $body);
            $headers[] = 'Content-Type: application/json';
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        $ch = curl_init($c['url'] . '/api' . $path);
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $status === 0) {
            Util::log('Club nicht erreichbar: ' . $error);
            throw new HttpError(502, 'Der Club ist nicht erreichbar (' . $c['url'] . ')' . ($error !== '' ? ': ' . $error : '.'));
        }
        if ($status >= 300 && $status < 400) {
            throw new HttpError(502, 'Der Club leitet die Anfrage um. Bitte die Adresse genau so eintragen, wie sie im Browser steht (mit https://).');
        }
        $data = json_decode((string) $raw, true);
        if (!is_array($data)) {
            throw new HttpError(502, "Der Club antwortet nicht wie erwartet (HTTP $status). Stimmt die Adresse {$c['url']}?");
        }
        if ($status === 403 && ($data['error'] ?? '') === 'Ungültiger Schlüssel.') {
            throw new HttpError(502, 'Club-Schlüssel stimmt nicht. Bitte den Schlüssel aus den Club-Einstellungen neu eintragen.');
        }
        if ($status >= 400) {
            $message = is_string($data['error'] ?? null) && $data['error'] !== '' ? $data['error'] : "Fehler im Club (HTTP $status).";
            throw new HttpError($status >= 500 ? 502 : $status, $message);
        }
        return $data;
    }

    /** „Verbindung testen“: /internal/ping. Ergebnis wird für die Einstellungen gemerkt. @return array{ok:bool, message:string} */
    public static function test(): array
    {
        try {
            $r = self::request('GET', '/internal/ping');
            $parts = ['Verbunden mit ' . (is_string($r['program'] ?? null) && $r['program'] !== '' ? $r['program'] : 'dem Club')];
            if (is_string($r['version'] ?? null)) {
                $parts[] = 'Version ' . $r['version'];
            }
            if (!empty($r['team_mode'])) {
                $parts[] = 'gemeinsame Datenbank';
            }
            $result = ['ok' => true, 'message' => implode(' · ', $parts)];
        } catch (HttpError $e) {
            $result = ['ok' => false, 'message' => $e->getMessage()];
        }
        Settings::set('club_status', $result + ['at' => Util::now()]);
        return $result;
    }

    /** Für „Datenbank aktualisieren“: Club-Tabellen nachziehen. Zeile fürs Protokoll, null = kein Club verbunden. */
    public static function migrate(): ?string
    {
        if (!self::configured()) {
            return null;
        }
        try {
            $r = self::request('POST', '/internal/migrate', []);
            return 'Club-Datenbank auf Version ' . (is_string($r['version'] ?? null) ? $r['version'] : '?') . ' gebracht.';
        } catch (\Throwable $e) {
            return 'Achtung: Club-Datenbank nicht aktualisiert – ' . $e->getMessage();
        }
    }

    /** Fällige Nachrichten im Club sofort verschicken (nach einer Freigabe). */
    public static function kick(): void
    {
        try {
            self::request('POST', '/internal/kick', []);
        } catch (\Throwable $e) {
            Util::log('Club kick: ' . $e->getMessage());
        }
    }

    /** Person aus der Team-App, wie der Club sie erwartet. */
    public static function user(array $me): array
    {
        return ['id' => $me['id'], 'name' => $me['name'], 'email' => $me['email']];
    }

    // ---------- Nachrichten an Mitglieder ----------

    public static function broadcasts(array $me): array
    {
        return self::request('GET', '/internal/broadcasts') + ['me' => self::user($me)];
    }

    public static function saveBroadcast(array $me, array $in, ?string $id): array
    {
        $text = static fn (string $k): string => is_string($in[$k] ?? null) ? $in[$k] : '';
        $body = [
            'user' => self::user($me),
            'kind' => ($in['kind'] ?? 'news') === 'feedback' ? 'feedback' : 'news',
            'template' => is_string($in['template'] ?? null) ? $in['template'] : null,
            'title' => $text('title'),
            'body' => $text('body'),
            'url' => $text('url') !== '' ? trim($text('url')) : null,
            'audience' => $text('audience') ?: 'all',
            'scheduled_at' => is_numeric($in['scheduled_at'] ?? null) ? (int) $in['scheduled_at'] : null,
        ];
        return $id === null
            ? self::request('POST', '/internal/broadcasts', $body)
            : self::request('PUT', "/internal/broadcasts/$id", $body);
    }

    /** submit | approve | reject | cancel | test */
    public static function broadcastAction(array $me, string $id, string $action, array $in): array
    {
        $body = ['user' => self::user($me)];
        if ($action === 'reject') {
            $body['note'] = is_string($in['note'] ?? null) ? mb_substr(trim($in['note']), 0, 250) : '';
        }
        $result = self::request('POST', "/internal/broadcasts/$id/$action", $body);
        if ($action === 'approve') {
            // Sofortige Nachrichten gleich verschicken, nicht erst beim nächsten Cronjob des Clubs
            self::kick();
        }
        return $result;
    }
}
