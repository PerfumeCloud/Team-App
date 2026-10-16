<?php
declare(strict_types=1);

namespace PC;

/**
 * Instagram (Business- oder Creator-Konto) über die Instagram API mit Instagram-Login.
 * Ein Admin verbindet das Konto einmal per Anmeldung bei Instagram; der Zugang (60 Tage gültig)
 * verlängert sich danach selbst. Profil, Beiträge, Kennzahlen und Kommentare gleicht der
 * Cronjob stündlich ab, die Auswertung rechnet die App selbst aus.
 */
final class Instagram
{
    public const API_VERSION = 'v24.0';
    public const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_insights'];
    private const DAY = 86400000;
    private const SYNC_EVERY_MS = 55 * 60000;
    private const PROFILE_FIELDS = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count';
    private const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

    // ---------- Rechte ----------

    /** Admins immer, andere nur mit Freischaltung („Instagram-Zugang“ unter Team). */
    public static function access(array $user): bool
    {
        return $user['role'] === 'admin' || (int) ($user['instagram_access'] ?? 0) === 1;
    }

    public static function requireAccess(): array
    {
        $user = Auth::require();
        if (!self::access($user)) {
            throw new HttpError(403, 'Kein Zugriff auf Instagram. Ein Admin kann ihn unter Einstellungen → Team freischalten.');
        }
        return $user;
    }

    /** Für die App: Menüpunkt zeigen? Admins auch ohne Verbindung (zum Einrichten). */
    public static function meta(array $user): ?array
    {
        if (!self::access($user) || (!self::connected() && $user['role'] !== 'admin')) {
            return null;
        }
        return ['connected' => self::connected(), 'username' => self::tokenData()['username'] ?? null];
    }

    // ---------- Einrichtung ----------

    public static function config(): array
    {
        $c = Settings::get('instagram', []);
        return [
            'app_id' => is_array($c) ? (string) ($c['app_id'] ?? '') : '',
            'four_eyes' => is_array($c) ? (bool) ($c['four_eyes'] ?? true) : true,
            'hashtags' => is_array($c) ? (string) ($c['hashtags'] ?? '') : '',
        ];
    }

    public static function redirectUri(): string
    {
        return Util::baseUrl() . '/api/instagram/callback';
    }

    public static function connected(): bool
    {
        return self::tokenData() !== null;
    }

    private static function tokenData(): ?array
    {
        $t = Settings::get('instagram_token');
        return is_array($t) && !empty($t['token']) ? $t : null;
    }

    public static function token(): string
    {
        $t = self::tokenData();
        $plain = $t ? Crypto::decrypt((string) $t['token']) : null;
        if (!$plain) {
            throw new HttpError(409, 'Instagram ist nicht verbunden. Ein Admin kann es unter Einstellungen → Integrationen verbinden.');
        }
        return $plain;
    }

    /** ID des Instagram-Kontos (für Veröffentlichen und Kommentare). */
    public static function accountId(): string
    {
        return (string) (self::tokenData()['user_id'] ?? 'me');
    }

    public static function username(): string
    {
        return (string) (self::tokenData()['username'] ?? '');
    }

    public static function save(array $me, array $in): void
    {
        $c = self::config();
        if (array_key_exists('app_id', $in)) {
            $id = Util::str($in['app_id'], 40) ?? '';
            if ($id !== '' && !preg_match('/^\d{5,25}$/', $id)) {
                throw new HttpError(422, 'Die Instagram-App-ID besteht nur aus Ziffern (Meta App Dashboard → Instagram → API-Einrichtung mit Instagram-Login).');
            }
            $c['app_id'] = $id;
        }
        if (!empty($in['app_secret'])) {
            $secret = trim((string) $in['app_secret']);
            if (!preg_match('/^[A-Za-z0-9]{16,64}$/', $secret)) {
                throw new HttpError(422, 'Das App-Secret sieht nicht richtig aus. Bitte im Meta App Dashboard neben „Instagram-App-Secret“ auf „Anzeigen“ und neu kopieren.');
            }
            Settings::setSecret('instagram_secret', $secret);
        }
        if (isset($in['four_eyes'])) {
            $c['four_eyes'] = (bool) $in['four_eyes'];
        }
        if (array_key_exists('hashtags', $in)) {
            $c['hashtags'] = Util::str($in['hashtags'], 500) ?? '';
        }
        Settings::set('instagram', $c);
        // Zugang direkt einfügen (Meta App Dashboard → „Token generieren“) statt Anmeldung über Instagram
        if (!empty($in['token'])) {
            $token = trim((string) $in['token']);
            if (!preg_match('/^[A-Za-z0-9_\-|.]{40,600}$/', $token)) {
                throw new HttpError(422, 'Der Zugangsschlüssel sieht nicht richtig aus (beginnt meist mit „IG“).');
            }
            try {
                self::store($token, 60 * 86400, $me['id']);
            } catch (HttpError $e) {
                throw $e;
            } catch (\Throwable $e) {
                throw new HttpError(422, 'Instagram hat den Schlüssel nicht angenommen: ' . $e->getMessage());
            }
        }
    }

    public static function disconnect(): void
    {
        foreach (['instagram_token', 'instagram_status', 'instagram_profile', 'instagram_totals', 'instagram_audience', 'instagram_sync_at', 'instagram_sync_due', 'instagram_unsupported', 'instagram_oauth'] as $k) {
            Settings::delete($k);
        }
    }

    public static function adminSettings(): array
    {
        $t = self::tokenData();
        $c = self::config();
        return [
            'app_id' => $c['app_id'],
            'hasSecret' => Settings::getSecret('instagram_secret') !== null,
            'redirectUri' => self::redirectUri(),
            'connected' => $t !== null,
            'username' => $t['username'] ?? null,
            'expires' => $t ? (int) $t['expires'] * 1000 : null,
            'connectedAt' => $t['at'] ?? null,
            'status' => Settings::get('instagram_status'),
            'lastSync' => (int) Settings::get('instagram_sync_at', 0),
            'four_eyes' => $c['four_eyes'],
            'hashtags' => $c['hashtags'],
            'scopes' => self::SCOPES,
            // null = unbekannt (Zugang direkt eingefügt)
            'missingScopes' => is_array($t['scopes'] ?? null) ? array_values(array_diff(self::SCOPES, $t['scopes'])) : null,
        ];
    }

    // ---------- Anmeldung über Instagram (OAuth) ----------

    public static function authorizeUrl(array $me): string
    {
        $c = self::config();
        if ($c['app_id'] === '' || !Settings::getSecret('instagram_secret')) {
            throw new HttpError(409, 'Bitte zuerst Instagram-App-ID und App-Secret speichern.');
        }
        $state = Crypto::randomKey(24);
        Settings::set('instagram_oauth', ['state' => hash('sha256', $state), 'user' => $me['id'], 'until' => Util::now() + 15 * 60000]);
        return self::host('www') . '/oauth/authorize?' . http_build_query([
            'enable_fb_login' => 0,
            'client_id' => $c['app_id'],
            'redirect_uri' => self::redirectUri(),
            'response_type' => 'code',
            'scope' => implode(',', self::SCOPES),
            'state' => $state,
        ]);
    }

    /** Rücksprung von Instagram. Gibt die Seite zurück, auf die der Browser weitergeleitet wird. */
    public static function callback(array $q): string
    {
        $back = static fn (string $msg): string => '/einstellungen/integrationen?instagram=' . rawurlencode($msg) . '#instagram';
        $o = Settings::get('instagram_oauth');
        Settings::delete('instagram_oauth');
        $state = (string) ($q['state'] ?? '');
        if (!is_array($o) || $state === '' || !hash_equals((string) $o['state'], hash('sha256', $state)) || (int) $o['until'] < Util::now()) {
            return $back('Die Anmeldung ist abgelaufen. Bitte noch einmal „Mit Instagram verbinden“ tippen.');
        }
        if (!empty($q['error'])) {
            return $back(($q['error_reason'] ?? '') === 'user_denied' ? 'Abgebrochen – Instagram wurde nicht verbunden.' : 'Instagram meldet: ' . mb_substr((string) ($q['error_description'] ?? $q['error']), 0, 200));
        }
        $code = (string) ($q['code'] ?? '');
        if ($code === '') {
            return $back('Instagram hat keinen Code geschickt. Bitte noch einmal versuchen.');
        }
        try {
            $secret = (string) Settings::getSecret('instagram_secret');
            $short = self::request('POST', self::host('api') . '/oauth/access_token', [
                'client_id' => self::config()['app_id'],
                'client_secret' => $secret,
                'grant_type' => 'authorization_code',
                'redirect_uri' => self::redirectUri(),
                'code' => preg_replace('/#_$/', '', $code),
            ]);
            $short = isset($short['data'][0]) && is_array($short['data'][0]) ? $short['data'][0] : $short;
            if (empty($short['access_token'])) {
                throw new \RuntimeException('kein Zugang erhalten');
            }
            // Kurzzeit-Zugang (1 Std.) gegen einen 60-Tage-Zugang tauschen
            $long = self::request('GET', self::host('graph') . '/access_token', [
                'grant_type' => 'ig_exchange_token',
                'client_secret' => $secret,
                'access_token' => (string) $short['access_token'],
            ]);
            $profile = self::store((string) $long['access_token'], (int) ($long['expires_in'] ?? 60 * 86400), (string) $o['user'], $short['permissions'] ?? null);
        } catch (\Throwable $e) {
            Util::log('Instagram verbinden: ' . $e->getMessage());
            return $back('Verbinden fehlgeschlagen: ' . $e->getMessage());
        }
        Http::defer(static fn () => self::sync());
        return $back('ok:' . ($profile['username'] ?? ''));
    }

    /** Zugang prüfen und speichern. @return array Profil */
    private static function store(string $token, int $expiresIn, ?string $by, mixed $permissions = null): array
    {
        $profile = self::request('GET', self::graph('/me'), ['fields' => self::PROFILE_FIELDS, 'access_token' => $token]);
        if (empty($profile['username'])) {
            throw new \RuntimeException('Instagram hat kein Profil geliefert.');
        }
        Settings::set('instagram_token', [
            'token' => Crypto::encrypt($token),
            'expires' => time() + max(3600, $expiresIn),
            'refreshed' => time(),
            'user_id' => (string) ($profile['user_id'] ?? $profile['id'] ?? 'me'),
            'username' => (string) $profile['username'],
            'by' => $by,
            'at' => Util::now(),
            // Freigegebene Berechtigungen (kommt bei der Anmeldung über Instagram mit)
            'scopes' => is_array($permissions) ? array_values(array_map('strval', $permissions)) : (is_string($permissions) && $permissions !== '' ? array_map('trim', explode(',', $permissions)) : null),
        ]);
        self::saveProfile($profile);
        Settings::set('instagram_status', ['ok' => true, 'at' => Util::now(), 'message' => 'Verbunden mit @' . $profile['username']]);
        Settings::delete('instagram_sync_at');
        Settings::delete('instagram_expiry_warned');
        return $profile;
    }

    /** Ab 24 Std. Alter lässt sich der Zugang um 60 Tage verlängern – wir tun es, sobald er unter 30 Tage hat. */
    private static function refreshIfDue(): string
    {
        $t = self::tokenData();
        if (!$t) {
            return '';
        }
        $left = (int) $t['expires'] - time();
        if ($left > 30 * 86400 || time() - (int) ($t['refreshed'] ?? 0) < 86400) {
            return '';
        }
        try {
            $r = self::request('GET', self::host('graph') . '/refresh_access_token', ['grant_type' => 'ig_refresh_token', 'access_token' => self::token()]);
            if (empty($r['access_token'])) {
                throw new \RuntimeException('keine Antwort');
            }
            $t['token'] = Crypto::encrypt((string) $r['access_token']);
            $t['expires'] = time() + (int) ($r['expires_in'] ?? 60 * 86400);
            $t['refreshed'] = time();
            Settings::set('instagram_token', $t);
            return 'Zugang verlängert';
        } catch (\Throwable $e) {
            // Kurz vor Ablauf einmal die Admins warnen
            if ($left < 7 * 86400 && !Settings::get('instagram_expiry_warned')) {
                Settings::set('instagram_expiry_warned', true);
                $admins = array_column(Db::all("SELECT id FROM users WHERE deleted = 0 AND role = 'admin'"), 'id');
                Notify::users($admins, 'instagram', [
                    'title' => 'Instagram-Verbindung läuft bald ab',
                    'body' => 'Bitte unter Einstellungen → Integrationen neu verbinden.',
                    'url' => '/einstellungen/integrationen#instagram',
                    'tag' => 'instagram-expiry',
                ]);
            }
            return 'Verlängern fehlgeschlagen: ' . $e->getMessage();
        }
    }

    // ---------- HTTP ----------

    /** Für Tests: alle Instagram-Adressen auf einen lokalen Nachbau umleiten (nur 127.0.0.1). */
    private static function host(string $which): string
    {
        $test = getenv('PC_INSTAGRAM_TEST');
        if (is_string($test) && preg_match('#^http://127\.0\.0\.1:\d+$#', $test)) {
            return $test . '/' . $which;
        }
        return ['www' => 'https://www.instagram.com', 'api' => 'https://api.instagram.com', 'graph' => 'https://graph.instagram.com'][$which];
    }

    private static function graph(string $path): string
    {
        return self::host('graph') . '/' . self::API_VERSION . $path;
    }

    public static function get(string $path, array $params = []): array
    {
        return self::request('GET', self::graph($path), $params + ['access_token' => self::token()]);
    }

    public static function post(string $path, array $params = []): array
    {
        return self::request('POST', self::graph($path), $params + ['access_token' => self::token()]);
    }

    /**
     * @throws \RuntimeException mit lesbarer Meldung (ohne Zugangsschlüssel) und dem Fehlercode von Instagram als Code
     */
    private static function request(string $method, string $url, array $params): array
    {
        $ch = curl_init();
        if ($method === 'GET') {
            curl_setopt($ch, CURLOPT_URL, $url . (str_contains($url, '?') ? '&' : '?') . http_build_query($params));
        } else {
            curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($params)]);
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 40,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'PerfumeCloudTeamApp/' . APP_VERSION,
        ]);
        $res = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false) {
            throw new \RuntimeException('Instagram nicht erreichbar: ' . $err, -1);
        }
        $data = json_decode((string) $res, true);
        if ($status < 400 && is_array($data) && !isset($data['error']) && !isset($data['error_message'])) {
            return $data;
        }
        $e = is_array($data) ? ($data['error'] ?? $data) : [];
        $code = (int) (is_array($e) ? ($e['code'] ?? 0) : 0);
        $msg = is_array($e) ? (string) ($e['error_user_msg'] ?? $e['message'] ?? $e['error_message'] ?? '') : (string) $e;
        if ($code === 190) {
            Settings::set('instagram_status', ['ok' => false, 'at' => Util::now(), 'message' => 'Zugang abgelaufen oder entzogen – bitte neu verbinden.']);
            throw new \RuntimeException('Die Verbindung zu Instagram ist abgelaufen oder wurde entzogen. Bitte unter Einstellungen → Integrationen neu verbinden.', 190);
        }
        if (in_array($code, [4, 17, 32, 613], true) || $status === 429) {
            throw new \RuntimeException('Instagram bremst gerade (zu viele Abfragen). Bitte später noch einmal.', $code ?: 4);
        }
        if (in_array($code, [10, 200], true)) {
            throw new \RuntimeException('Instagram verweigert die Berechtigung' . ($msg !== '' ? ': ' . $msg : '') . '. Beim Verbinden alle Häkchen setzen.', $code);
        }
        throw new \RuntimeException('Instagram: ' . ($msg !== '' ? mb_substr($msg, 0, 300) : 'Fehler ' . $status), $code ?: $status);
    }

    /**
     * Kennzahlen abfragen. Instagram ändert die Liste der erlaubten Kennzahlen immer wieder: Lehnt es eine
     * Abfrage ab, fragen wir einzeln nach. Was dann allein scheitert, während andere klappen, gilt als nicht
     * unterstützt und wird eine Woche lang nicht mehr abgefragt. @return array<string, mixed> Name → Wert
     */
    private static function metrics(string $path, array $metrics, array $params, string $scope): array
    {
        $skip = Settings::get('instagram_unsupported', []);
        $skip = is_array($skip) ? $skip : [];
        $now = Util::now();
        $metrics = array_values(array_filter($metrics, static fn ($m) => (int) ($skip["$scope:$m"] ?? 0) < $now));
        if (!$metrics) {
            return [];
        }
        $parse = static function (array $r): array {
            $out = [];
            foreach ($r['data'] ?? [] as $row) {
                $name = (string) ($row['name'] ?? '');
                if ($name === '') {
                    continue;
                }
                if (isset($row['total_value'])) {
                    $out[$name] = isset($row['total_value']['breakdowns']) ? $row['total_value'] : (int) ($row['total_value']['value'] ?? 0);
                } elseif (isset($row['values'])) {
                    // Zeitreihe (mit end_time) oder ein einzelner Wert (Kennzahlen eines Beitrags)
                    $out[$name] = count($row['values']) === 1 && !isset($row['values'][0]['end_time']) ? (int) ($row['values'][0]['value'] ?? 0) : $row['values'];
                }
            }
            return $out;
        };
        $rejected = static fn (\RuntimeException $e): bool => in_array($e->getCode(), [100, 400], true);
        try {
            return $parse(self::get($path, ['metric' => implode(',', $metrics)] + $params));
        } catch (\RuntimeException $e) {
            if (!$rejected($e) || count($metrics) === 1) {
                if ($rejected($e)) {
                    return [];
                }
                throw $e;
            }
        }
        $out = [];
        $failed = [];
        foreach ($metrics as $m) {
            try {
                $out += $parse(self::get($path, ['metric' => $m] + $params));
            } catch (\RuntimeException $e) {
                if (!$rejected($e)) {
                    throw $e;
                }
                $failed[] = $m;
            }
        }
        // Scheitert alles, liegt es eher am Beitrag (z. B. vor der Umstellung auf ein Business-Konto gepostet)
        if ($out && $failed) {
            foreach ($failed as $m) {
                $skip["$scope:$m"] = $now + 7 * self::DAY;
            }
            Settings::set('instagram_unsupported', $skip);
        }
        return $out;
    }

    // ---------- Abgleich ----------

    /** Aus dem Cronjob: Fälliges veröffentlichen, stündlich abgleichen, Zugang verlängern. */
    public static function run(): string
    {
        if (!self::connected()) {
            return '–';
        }
        $out = [InstagramPosts::due()];
        // Stündlich – oder gleich, nachdem die App etwas veröffentlicht hat (dann gibt es neue Zahlen)
        if (Settings::get('instagram_sync_due') || Util::now() - (int) Settings::get('instagram_sync_at', 0) >= self::SYNC_EVERY_MS) {
            try {
                $out[] = self::sync();
            } catch (\Throwable $e) {
                $out[] = 'Fehler: ' . $e->getMessage();
            }
        }
        $out[] = self::refreshIfDue();
        $out = array_values(array_filter($out, static fn ($s) => $s !== '' && $s !== '–'));
        return $out ? implode(' · ', $out) : '–';
    }

    /** Profil, Beiträge, Kennzahlen und Kommentare holen. */
    public static function sync(): string
    {
        Settings::set('instagram_sync_at', Util::now());
        Settings::delete('instagram_sync_due');
        try {
            $profile = self::get('/me', ['fields' => self::PROFILE_FIELDS]);
            self::saveProfile($profile);
            $today = date('Y-m-d');
            self::daily($today, [
                'followers' => isset($profile['followers_count']) ? (int) $profile['followers_count'] : null,
                'follows' => isset($profile['follows_count']) ? (int) $profile['follows_count'] : null,
                'media_count' => isset($profile['media_count']) ? (int) $profile['media_count'] : null,
            ]);
            $media = self::syncMedia();
            $insights = self::syncMediaInsights();
            $account = self::syncAccount();
            $comments = InstagramPosts::syncComments();
            InstagramPosts::linkPublished();
            $msg = "$media Beiträge · $insights mit Kennzahlen · $comments neue Kommentare" . ($account !== '' ? " · $account" : '');
            Settings::set('instagram_status', ['ok' => true, 'at' => Util::now(), 'message' => $msg]);
            return $msg;
        } catch (\Throwable $e) {
            Settings::set('instagram_status', ['ok' => false, 'at' => Util::now(), 'message' => $e->getMessage()]);
            throw $e;
        }
    }

    private static function saveProfile(array $p): void
    {
        Settings::set('instagram_profile', [
            'username' => (string) ($p['username'] ?? ''),
            'name' => (string) ($p['name'] ?? ''),
            'account_type' => (string) ($p['account_type'] ?? ''),
            'picture' => (string) ($p['profile_picture_url'] ?? ''),
            'followers' => isset($p['followers_count']) ? (int) $p['followers_count'] : null,
            'follows' => isset($p['follows_count']) ? (int) $p['follows_count'] : null,
            'media_count' => isset($p['media_count']) ? (int) $p['media_count'] : null,
            'at' => Util::now(),
        ]);
    }

    /** Tageswerte ergänzen (fehlende Werte bleiben, wie sie sind). */
    private static function daily(string $day, array $values): void
    {
        $values = array_filter($values, static fn ($v) => $v !== null);
        if (!$values) {
            return;
        }
        $row = Db::one('SELECT * FROM ig_daily WHERE day = ?', [$day]);
        if ($row) {
            Db::update('ig_daily', $values + ['updated_at' => Util::now()], ['day' => $day]);
        } else {
            Db::insert('ig_daily', array_merge(
                ['day' => $day, 'followers' => null, 'follows' => null, 'media_count' => null, 'reach' => null, 'views' => null, 'interactions' => null, 'link_taps' => null],
                $values,
                ['updated_at' => Util::now()]
            ));
        }
    }

    /** Die neuesten Beiträge (beim ersten Mal bis zu 200). */
    private static function syncMedia(): int
    {
        $first = !Db::value('SELECT 1 FROM ig_media LIMIT 1');
        $count = 0;
        $after = null;
        for ($page = 0; $page < ($first ? 4 : 1); $page++) {
            $r = self::get('/me/media', ['fields' => self::MEDIA_FIELDS, 'limit' => 50] + ($after ? ['after' => $after] : []));
            foreach ($r['data'] ?? [] as $m) {
                if (empty($m['id'])) {
                    continue;
                }
                $row = [
                    'media_type' => (string) ($m['media_type'] ?? ''),
                    'product_type' => (string) ($m['media_product_type'] ?? ''),
                    'caption' => isset($m['caption']) ? mb_substr((string) $m['caption'], 0, 2500) : null,
                    'permalink' => isset($m['permalink']) ? mb_substr((string) $m['permalink'], 0, 300) : null,
                    'media_url' => isset($m['media_url']) ? (string) $m['media_url'] : null,
                    'thumbnail_url' => isset($m['thumbnail_url']) ? (string) $m['thumbnail_url'] : null,
                    'posted_at' => isset($m['timestamp']) ? (int) strtotime((string) $m['timestamp']) * 1000 : Util::now(),
                    'likes' => (int) ($m['like_count'] ?? 0),
                    'comments' => (int) ($m['comments_count'] ?? 0),
                    'synced_at' => Util::now(),
                ];
                if (Db::value('SELECT 1 FROM ig_media WHERE id = ?', [$m['id']])) {
                    Db::update('ig_media', $row, ['id' => $m['id']]);
                } else {
                    Db::insert('ig_media', ['id' => (string) $m['id']] + $row + ['reach' => null, 'views' => null, 'saved' => null, 'shares' => null, 'interactions' => null, 'avg_watch_ms' => null, 'insights_at' => null]);
                }
                $count++;
            }
            $after = $r['paging']['cursors']['after'] ?? null;
            if (!$after || empty($r['paging']['next'])) {
                break;
            }
        }
        return $count;
    }

    /** Kennzahlen je Beitrag: neue oft, ältere einmal pro Woche (höchstens 30 Abfragen pro Lauf). */
    private static function syncMediaInsights(): int
    {
        $now = Util::now();
        $rows = Db::all(
            'SELECT id, media_type, product_type, posted_at, insights_at FROM ig_media WHERE posted_at >= ? AND (insights_at IS NULL OR (posted_at >= ? AND insights_at < ?) OR insights_at < ?) ORDER BY posted_at DESC LIMIT 30',
            [$now - 730 * self::DAY, $now - 14 * self::DAY, $now - 3 * 3600000, $now - 7 * self::DAY]
        );
        $done = 0;
        foreach ($rows as $m) {
            $reel = $m['product_type'] === 'REELS';
            $story = $m['product_type'] === 'STORY';
            $list = $story ? ['reach', 'views', 'replies', 'shares', 'total_interactions'] : ['reach', 'views', 'saved', 'shares', 'total_interactions'];
            if ($reel) {
                $list[] = 'ig_reels_avg_watch_time';
            }
            $v = self::metrics('/' . $m['id'] . '/insights', $list, [], $reel ? 'reel' : ($story ? 'story' : 'feed'));
            Db::update('ig_media', [
                'reach' => isset($v['reach']) ? (int) $v['reach'] : null,
                'views' => isset($v['views']) ? (int) $v['views'] : null,
                'saved' => isset($v['saved']) ? (int) $v['saved'] : null,
                'shares' => isset($v['shares']) ? (int) $v['shares'] : null,
                'interactions' => isset($v['total_interactions']) ? (int) $v['total_interactions'] : null,
                'avg_watch_ms' => isset($v['ig_reels_avg_watch_time']) ? (int) $v['ig_reels_avg_watch_time'] : null,
                'insights_at' => $now,
            ], ['id' => $m['id']]);
            $done += $v ? 1 : 0;
        }
        return $done;
    }

    /** Konto-Kennzahlen: Reichweite je Tag, Summen für 7 Tage und die 7 davor, Zielgruppe einmal pro Woche. */
    private static function syncAccount(): string
    {
        $now = time();
        $first = !Db::value('SELECT 1 FROM ig_daily WHERE reach IS NOT NULL LIMIT 1');
        $series = self::metrics('/me/insights', ['reach'], ['period' => 'day', 'since' => $now - ($first ? 29 : 4) * 86400, 'until' => $now], 'account-series');
        foreach (is_array($series['reach'] ?? null) ? $series['reach'] : [] as $p) {
            if (isset($p['end_time'])) {
                // end_time ist das Tagesende (Pazifik-Zeit) in UTC – 12 Std. zurück trifft sicher den gemeinten Tag
                self::daily(gmdate('Y-m-d', (int) strtotime((string) $p['end_time']) - 12 * 3600), ['reach' => (int) ($p['value'] ?? 0)]);
            }
        }
        $totals = ['views', 'reach', 'accounts_engaged', 'total_interactions', 'profile_links_taps', 'likes', 'comments', 'saves', 'shares'];
        $window = static fn (int $from, int $to) => self::metrics('/me/insights', $totals, ['period' => 'day', 'metric_type' => 'total_value', 'since' => $from, 'until' => $to], 'account-total');
        $cur = $window($now - 7 * 86400, $now);
        $prev = $window($now - 14 * 86400, $now - 7 * 86400);
        Settings::set('instagram_totals', ['cur' => $cur, 'prev' => $prev, 'at' => Util::now()]);

        // Zielgruppe (Alter, Geschlecht, Städte) – erst ab 100 Follower:innen, einmal pro Woche
        $profile = Settings::get('instagram_profile', []);
        $aud = Settings::get('instagram_audience');
        if ((int) ($profile['followers'] ?? 0) >= 100 && (!is_array($aud) || (int) ($aud['at'] ?? 0) < Util::now() - 7 * self::DAY)) {
            $out = ['at' => Util::now()];
            foreach (['age', 'gender', 'city', 'country'] as $b) {
                $r = self::metrics('/me/insights', ['follower_demographics'], ['period' => 'lifetime', 'metric_type' => 'total_value', 'timeframe' => 'this_month', 'breakdown' => $b], "audience-$b");
                $rows = [];
                foreach ($r['follower_demographics']['breakdowns'][0]['results'] ?? [] as $x) {
                    $rows[] = ['label' => (string) ($x['dimension_values'][0] ?? ''), 'value' => (int) ($x['value'] ?? 0)];
                }
                usort($rows, static fn ($a, $b2) => $b2['value'] <=> $a['value']);
                $out[$b] = array_slice($rows, 0, $b === 'age' || $b === 'gender' ? 10 : 6);
            }
            Settings::set('instagram_audience', $out);
        }
        return $cur ? 'Konto-Kennzahlen aktualisiert' : '';
    }

    // ---------- Auswertung ----------

    /** Interaktionen eines Beitrags (Instagrams Summe, sonst selbst zusammengezählt). */
    private static function interactions(array $m): int
    {
        if ($m['interactions'] !== null) {
            return (int) $m['interactions'];
        }
        return (int) $m['likes'] + (int) $m['comments'] + (int) ($m['saved'] ?? 0) + (int) ($m['shares'] ?? 0);
    }

    private static function format(array $m): string
    {
        if ($m['product_type'] === 'REELS') {
            return 'reel';
        }
        if ($m['product_type'] === 'STORY') {
            return 'story';
        }
        return $m['media_type'] === 'CAROUSEL_ALBUM' ? 'carousel' : ($m['media_type'] === 'VIDEO' ? 'video' : 'image');
    }

    public const FORMAT_LABELS = ['reel' => 'Reels', 'carousel' => 'Karussells', 'image' => 'Bilder', 'video' => 'Videos', 'story' => 'Storys'];

    /** @return string[] */
    public static function hashtags(?string $caption): array
    {
        preg_match_all('/#([\p{L}\p{N}_]{2,60})/u', (string) $caption, $m);
        return array_values(array_unique(array_map('mb_strtolower', $m[1])));
    }

    private static function avg(array $values): ?float
    {
        $values = array_values(array_filter($values, static fn ($v) => $v !== null));
        return $values ? array_sum($values) / count($values) : null;
    }

    private static function num(float|int|null $n, int $dec = 0): string
    {
        return $n === null ? '–' : number_format((float) $n, $dec, ',', '.');
    }

    /** Alles für die Seite „Instagram“. */
    public static function overview(array $me): array
    {
        $now = Util::now();
        $profile = Settings::get('instagram_profile');
        $totals = Settings::get('instagram_totals', []);
        $daily = Db::all('SELECT * FROM ig_daily WHERE day >= ? ORDER BY day', [date('Y-m-d', intdiv($now, 1000) - 90 * 86400)]);
        $followersAt = static function (int $daysAgo) use ($daily): ?int {
            $target = date('Y-m-d', time() - $daysAgo * 86400);
            $best = null;
            foreach ($daily as $d) {
                if ($d['day'] <= $target && $d['followers'] !== null) {
                    $best = (int) $d['followers'];
                }
            }
            return $best;
        };
        $followers = isset($profile['followers']) ? (int) $profile['followers'] : null;
        $f7 = $followersAt(7);
        $f30 = $followersAt(30);
        $media = Db::all('SELECT * FROM ig_media WHERE posted_at >= ? ORDER BY posted_at DESC', [$now - 180 * self::DAY]);
        $posts = array_map(fn ($m) => self::mediaRow($m), $media);
        $feed = array_values(array_filter($posts, static fn ($p) => $p['format'] !== 'story'));
        $last30 = array_filter($feed, static fn ($p) => $p['posted_at'] >= $now - 30 * self::DAY);
        $rates = array_values(array_filter(array_map(static fn ($p) => $p['rate'], $last30), static fn ($r) => $r !== null));

        return [
            'connected' => self::connected(),
            'admin' => $me['role'] === 'admin',
            'profile' => is_array($profile) ? $profile : null,
            'status' => Settings::get('instagram_status'),
            'lastSync' => (int) Settings::get('instagram_sync_at', 0),
            'kpis' => [
                'followers' => $followers,
                'followers_7' => $followers !== null && $f7 !== null ? $followers - $f7 : null,
                'followers_30' => $followers !== null && $f30 !== null ? $followers - $f30 : null,
                'cur' => $totals['cur'] ?? [],
                'prev' => $totals['prev'] ?? [],
                'posts_30' => count($last30),
                'rate_30' => $rates ? round(array_sum($rates) / count($rates), 1) : null,
                'unanswered' => InstagramPosts::unansweredCount(),
            ],
            'followers_series' => array_values(array_map(static fn ($d) => ['day' => $d['day'], 'value' => (int) $d['followers']], array_filter($daily, static fn ($d) => $d['followers'] !== null))),
            'reach_series' => array_values(array_map(static fn ($d) => ['day' => $d['day'], 'value' => (int) $d['reach']], array_filter($daily, static fn ($d) => $d['reach'] !== null && $d['day'] >= date('Y-m-d', time() - 30 * 86400)))),
            'media' => array_slice($posts, 0, 60),
            'analysis' => self::analysis($feed),
            'audience' => Settings::get('instagram_audience'),
            'planned' => InstagramPosts::upcoming(),
        ];
    }

    private static function mediaRow(array $m): array
    {
        $inter = self::interactions($m);
        $reach = $m['reach'] !== null ? (int) $m['reach'] : null;
        return [
            'id' => $m['id'],
            'format' => self::format($m),
            'caption' => (string) ($m['caption'] ?? ''),
            'permalink' => $m['permalink'],
            'thumb' => $m['thumbnail_url'] ?: ($m['media_type'] === 'VIDEO' ? null : $m['media_url']),
            'posted_at' => (int) $m['posted_at'],
            'likes' => (int) $m['likes'],
            'comments' => (int) $m['comments'],
            'saved' => $m['saved'] !== null ? (int) $m['saved'] : null,
            'shares' => $m['shares'] !== null ? (int) $m['shares'] : null,
            'reach' => $reach,
            'views' => $m['views'] !== null ? (int) $m['views'] : null,
            'interactions' => $inter,
            'avg_watch_s' => $m['avg_watch_ms'] !== null ? round((int) $m['avg_watch_ms'] / 1000, 1) : null,
            // Interaktionsrate: Anteil der erreichten Konten, die reagiert haben
            'rate' => $reach ? round($inter / $reach * 100, 1) : null,
        ];
    }

    /**
     * Was funktioniert bei euch? Formate, Wochentage, Uhrzeiten, Hashtags, Textlänge, Rhythmus –
     * berechnet aus den eigenen Beiträgen der letzten 180 Tage, dazu Tipps in Klartext.
     */
    public static function analysis(array $feed): array
    {
        $now = Util::now();
        $score = static fn (array $p): float => (float) ($p['reach'] ?? $p['interactions'] * 10);
        $metric = array_filter($feed, static fn ($p) => $p['reach'] !== null) ? 'reach' : 'interactions';
        $val = static fn (array $p): ?float => $metric === 'reach' ? ($p['reach'] !== null ? (float) $p['reach'] : null) : (float) $p['interactions'];
        $overall = self::avg(array_map($val, $feed));

        $group = static function (callable $key) use ($feed, $val): array {
            $g = [];
            foreach ($feed as $p) {
                $k = $key($p);
                if ($k === null) {
                    continue;
                }
                $g[$k][] = $p;
            }
            $out = [];
            foreach ($g as $k => $list) {
                $out[$k] = [
                    'count' => count($list),
                    'avg' => self::avg(array_map($val, $list)),
                    'avg_interactions' => self::avg(array_map(static fn ($p) => (float) $p['interactions'], $list)),
                    'avg_rate' => self::avg(array_map(static fn ($p) => $p['rate'], $list)),
                    'avg_comments' => self::avg(array_map(static fn ($p) => (float) $p['comments'], $list)),
                    'avg_saved' => self::avg(array_map(static fn ($p) => $p['saved'] !== null ? (float) $p['saved'] : null, $list)),
                ];
            }
            return $out;
        };

        $formats = $group(static fn ($p) => $p['format']);
        $weekdays = $group(static fn ($p) => (int) date('N', intdiv($p['posted_at'], 1000)));
        $slot = static function (int $ms): string {
            $h = (int) date('G', intdiv($ms, 1000));
            return $h < 6 ? 'nacht' : ($h < 11 ? 'morgen' : ($h < 15 ? 'mittag' : ($h < 18 ? 'nachmittag' : ($h < 22 ? 'abend' : 'nacht'))));
        };
        $slots = $group(static fn ($p) => $slot($p['posted_at']));
        $question = $group(static fn ($p) => str_contains($p['caption'], '?') ? 'frage' : 'ohne');
        $length = $group(static fn ($p) => mb_strlen($p['caption']) < 125 ? 'kurz' : (mb_strlen($p['caption']) < 500 ? 'mittel' : 'lang'));

        // Hashtags: Ø Reichweite der Beiträge, in denen ein Hashtag vorkommt (ab 2 Beiträgen)
        $tags = [];
        $tagCounts = [];
        foreach ($feed as $p) {
            $list = self::hashtags($p['caption']);
            $tagCounts[] = count($list);
            foreach ($list as $t) {
                $tags[$t][] = $val($p);
            }
        }
        $tagRows = [];
        foreach ($tags as $t => $vals) {
            $tagRows[] = ['tag' => '#' . $t, 'count' => count($vals), 'avg' => self::avg($vals)];
        }
        usort($tagRows, static fn ($a, $b) => [$b['count'] >= 2, $b['avg'] ?? 0] <=> [$a['count'] >= 2, $a['avg'] ?? 0]);

        // Rhythmus: Beiträge pro Woche (letzte 4 Wochen), Tage seit dem letzten Beitrag
        $recent = array_filter($feed, static fn ($p) => $p['posted_at'] >= $now - 28 * self::DAY);
        $perWeek = round(count($recent) / 4, 1);
        $lastPost = $feed ? max(array_column($feed, 'posted_at')) : null;
        $daysSince = $lastPost ? (int) floor(($now - $lastPost) / self::DAY) : null;

        $sorted = $feed;
        usort($sorted, static fn ($a, $b) => $score($b) <=> $score($a));

        // ---- Tipps in Klartext ----
        $tips = [];
        $label = $metric === 'reach' ? 'erreichte Konten' : 'Interaktionen';
        $ranked = array_filter($formats, static fn ($f) => $f['count'] >= 2 && $f['avg'] !== null);
        if (count($ranked) >= 2) {
            uasort($ranked, static fn ($a, $b) => $b['avg'] <=> $a['avg']);
            $keys = array_keys($ranked);
            $best = $ranked[$keys[0]];
            $worst = $ranked[$keys[count($keys) - 1]];
            if ($worst['avg'] > 0 && $best['avg'] / $worst['avg'] >= 1.3) {
                $tips[] = ['kind' => 'format', 'text' => self::FORMAT_LABELS[$keys[0]] . ' kommen bei euch im Schnitt auf ' . self::num($best['avg']) . " $label – " . self::num($best['avg'] / $worst['avg'], 1) . '× so viel wie ' . self::FORMAT_LABELS[$keys[count($keys) - 1]] . '. Mehr davon einplanen.'];
            }
        }
        $days = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
        $rankedDays = array_filter($weekdays, static fn ($d) => $d['count'] >= 2 && $d['avg'] !== null);
        if (count($rankedDays) >= 3 && $overall) {
            uasort($rankedDays, static fn ($a, $b) => $b['avg'] <=> $a['avg']);
            $k = array_key_first($rankedDays);
            if ($rankedDays[$k]['avg'] >= $overall * 1.15) {
                $tips[] = ['kind' => 'day', 'text' => 'Am besten laufen Beiträge am ' . $days[$k] . ' (Ø ' . self::num($rankedDays[$k]['avg']) . " $label, " . self::num(($rankedDays[$k]['avg'] / $overall - 1) * 100) . ' % über eurem Schnitt).'];
            }
        }
        $slotLabels = ['morgen' => 'morgens (6–11 Uhr)', 'mittag' => 'mittags (11–15 Uhr)', 'nachmittag' => 'nachmittags (15–18 Uhr)', 'abend' => 'abends (18–22 Uhr)', 'nacht' => 'spät (22–6 Uhr)'];
        $rankedSlots = array_filter($slots, static fn ($s) => $s['count'] >= 2 && $s['avg'] !== null);
        if (count($rankedSlots) >= 2 && $overall) {
            uasort($rankedSlots, static fn ($a, $b) => $b['avg'] <=> $a['avg']);
            $k = array_key_first($rankedSlots);
            if ($rankedSlots[$k]['avg'] >= $overall * 1.1) {
                $tips[] = ['kind' => 'time', 'text' => 'Gepostet ' . $slotLabels[$k] . ' erreicht ihr am meisten. Geplante Beiträge am besten in diese Zeit legen.'];
            }
        }
        if ($feed && $perWeek < 2) {
            $tips[] = ['kind' => 'rhythm', 'text' => 'In den letzten 4 Wochen waren es ' . self::num($perWeek, 1) . ' Beiträge pro Woche. Mit 3–4 pro Woche bleibt ihr sichtbarer – im Planer lassen sich Beiträge vorbereiten und automatisch veröffentlichen.'];
        }
        if ($daysSince !== null && $daysSince >= 7) {
            $tips[] = ['kind' => 'rhythm', 'text' => "Der letzte Beitrag ist $daysSince Tage her."];
        }
        $avgTags = self::avg($tagCounts);
        if ($avgTags !== null && $avgTags > 8) {
            $tips[] = ['kind' => 'hashtags', 'text' => 'Im Schnitt ' . self::num($avgTags) . ' Hashtags pro Beitrag. Instagram empfiehlt inzwischen 3–5 passende statt vieler allgemeiner.'];
        }
        $goodTags = array_values(array_filter($tagRows, static fn ($t) => $t['count'] >= 2 && $overall && $t['avg'] !== null && $t['avg'] >= $overall * 1.2));
        if ($goodTags) {
            $tips[] = ['kind' => 'hashtags', 'text' => 'Überdurchschnittlich mit ' . implode(', ', array_map(static fn ($t) => $t['tag'], array_slice($goodTags, 0, 3))) . '.'];
        }
        if (isset($question['frage'], $question['ohne']) && $question['frage']['count'] >= 2 && $question['ohne']['count'] >= 2
            && $question['frage']['avg_comments'] > $question['ohne']['avg_comments'] * 1.3) {
            $tips[] = ['kind' => 'caption', 'text' => 'Beiträge mit einer Frage bekommen Ø ' . self::num($question['frage']['avg_comments'], 1) . ' Kommentare statt ' . self::num($question['ohne']['avg_comments'], 1) . '. Eine Frage am Ende lohnt sich.'];
        }
        $unanswered = InstagramPosts::unansweredCount();
        if ($unanswered > 0) {
            $tips[] = ['kind' => 'comments', 'text' => ($unanswered === 1 ? 'Ein Kommentar wartet' : "$unanswered Kommentare warten") . ' auf eine Antwort. Schnelle Antworten bringen mehr Reichweite.'];
        }
        if (!$feed) {
            $tips[] = ['kind' => 'start', 'text' => 'Noch keine Beiträge abgeglichen. Nach dem ersten Abgleich stehen hier Tipps aus euren eigenen Zahlen.'];
        }

        $round = static fn (array $g) => array_map(static fn ($x) => [
            'count' => $x['count'],
            'avg' => $x['avg'] !== null ? (int) round($x['avg']) : null,
            'avg_interactions' => $x['avg_interactions'] !== null ? round($x['avg_interactions'], 1) : null,
            'avg_rate' => $x['avg_rate'] !== null ? round($x['avg_rate'], 1) : null,
        ], $g);
        return [
            'metric' => $metric,
            'posts' => count($feed),
            'overall' => $overall !== null ? (int) round($overall) : null,
            'formats' => $round($formats),
            'weekdays' => $round($weekdays),
            'slots' => $round($slots),
            'hashtags' => ['avg_count' => $avgTags !== null ? round($avgTags, 1) : null, 'top' => array_slice($tagRows, 0, 12)],
            'captions' => ['length' => $round($length), 'question' => $round($question)],
            'rhythm' => ['per_week' => $perWeek, 'days_since' => $daysSince],
            'top' => array_slice(array_map(static fn ($p) => $p['id'], $sorted), 0, 5),
            'tips' => $tips,
        ];
    }

    /** Zusammenfassung als Text, z. B. zum Weitergeben an Claude für eine Analyse (ohne Namen von Kommentierenden). */
    public static function export(array $me): string
    {
        $o = self::overview($me);
        $p = $o['profile'] ?? [];
        $k = $o['kpis'];
        $a = $o['analysis'];
        $lines = [];
        $lines[] = '# Instagram @' . ($p['username'] ?? '?') . ' – Stand ' . date('d.m.Y H:i');
        $lines[] = '';
        $lines[] = '- Follower: ' . self::num($k['followers']) . ' (7 Tage: ' . self::signed($k['followers_7']) . ', 30 Tage: ' . self::signed($k['followers_30']) . ')';
        foreach (['reach' => 'Erreichte Konten', 'views' => 'Aufrufe', 'accounts_engaged' => 'Konten mit Interaktion', 'total_interactions' => 'Interaktionen', 'profile_links_taps' => 'Klicks auf Links im Profil'] as $key => $label) {
            if (isset($k['cur'][$key]) && !is_array($k['cur'][$key])) {
                $lines[] = "- $label (7 Tage): " . self::num($k['cur'][$key]) . (isset($k['prev'][$key]) && !is_array($k['prev'][$key]) ? ' (Vorwoche ' . self::num($k['prev'][$key]) . ')' : '');
            }
        }
        $lines[] = '- Beiträge in 30 Tagen: ' . $k['posts_30'] . ' · Ø Interaktionsrate: ' . ($k['rate_30'] !== null ? self::num($k['rate_30'], 1) . ' %' : '–');
        $lines[] = '- Unbeantwortete Kommentare: ' . $k['unanswered'];
        $lines[] = '';
        $lines[] = '## Formate (Ø ' . ($a['metric'] === 'reach' ? 'Reichweite' : 'Interaktionen') . ')';
        foreach ($a['formats'] as $f => $x) {
            $lines[] = '- ' . (self::FORMAT_LABELS[$f] ?? $f) . ': ' . $x['count'] . ' Beiträge, Ø ' . self::num($x['avg']) . ', Ø Rate ' . ($x['avg_rate'] !== null ? self::num($x['avg_rate'], 1) . ' %' : '–');
        }
        $lines[] = '';
        $lines[] = '## Beiträge (neueste zuerst, max. 40)';
        $lines[] = '| Datum | Format | Reichweite | Likes | Kommentare | Gespeichert | Geteilt | Text (Anfang) |';
        $lines[] = '|---|---|---|---|---|---|---|---|';
        foreach (array_slice($o['media'], 0, 40) as $m) {
            $text = str_replace(['|', "\n", "\r"], ['/', ' ', ' '], mb_substr($m['caption'], 0, 90));
            $lines[] = '| ' . date('d.m.y H:i', intdiv($m['posted_at'], 1000)) . ' | ' . (self::FORMAT_LABELS[$m['format']] ?? $m['format']) . ' | ' . self::num($m['reach']) . ' | ' . $m['likes'] . ' | ' . $m['comments'] . ' | ' . self::num($m['saved']) . ' | ' . self::num($m['shares']) . " | $text |";
        }
        if ($a['hashtags']['top']) {
            $lines[] = '';
            $lines[] = '## Hashtags (Ø ' . self::num($a['hashtags']['avg_count'], 1) . ' pro Beitrag)';
            foreach (array_slice($a['hashtags']['top'], 0, 10) as $t) {
                $lines[] = '- ' . $t['tag'] . ': ' . $t['count'] . '×, Ø ' . self::num($t['avg']);
            }
        }
        if (is_array($o['audience'])) {
            $lines[] = '';
            $lines[] = '## Zielgruppe';
            foreach (['age' => 'Alter', 'gender' => 'Geschlecht', 'city' => 'Städte'] as $key => $label) {
                if (!empty($o['audience'][$key])) {
                    $lines[] = "- $label: " . implode(', ', array_map(static fn ($x) => $x['label'] . ' ' . $x['value'], $o['audience'][$key]));
                }
            }
        }
        if ($a['tips']) {
            $lines[] = '';
            $lines[] = '## Hinweise der App';
            foreach ($a['tips'] as $t) {
                $lines[] = '- ' . $t['text'];
            }
        }
        return implode("\n", $lines) . "\n";
    }

    private static function signed(?int $n): string
    {
        return $n === null ? '–' : ($n > 0 ? '+' : '') . self::num($n);
    }

    /** Für den Wochenrückblick. */
    public static function weekly(int $start, int $end): ?array
    {
        if (!self::connected()) {
            return null;
        }
        $profile = Settings::get('instagram_profile', []);
        $totals = Settings::get('instagram_totals', []);
        $startDay = date('Y-m-d', intdiv($start, 1000));
        $before = Db::value('SELECT followers FROM ig_daily WHERE day <= ? AND followers IS NOT NULL ORDER BY day DESC LIMIT 1', [$startDay]);
        $media = Db::all("SELECT * FROM ig_media WHERE posted_at >= ? AND posted_at < ? AND product_type <> 'STORY' ORDER BY posted_at", [$start, $end]);
        $top = null;
        foreach ($media as $m) {
            $row = self::mediaRow($m);
            if (!$top || ($row['reach'] ?? $row['interactions']) > ($top['reach'] ?? $top['interactions'])) {
                $top = $row;
            }
        }
        $num = static fn ($v) => isset($v) && !is_array($v) ? (int) $v : null;
        return [
            'username' => (string) ($profile['username'] ?? ''),
            'followers' => isset($profile['followers']) ? (int) $profile['followers'] : null,
            'followers_delta' => isset($profile['followers']) && $before !== null ? (int) $profile['followers'] - (int) $before : null,
            'reach' => $num($totals['cur']['reach'] ?? null),
            'reach_prev' => $num($totals['prev']['reach'] ?? null),
            'interactions' => $num($totals['cur']['total_interactions'] ?? null),
            'link_taps' => $num($totals['cur']['profile_links_taps'] ?? null),
            'posts' => count($media),
            'top' => $top ? ['caption' => mb_substr($top['caption'], 0, 80), 'reach' => $top['reach'], 'interactions' => $top['interactions'], 'permalink' => $top['permalink']] : null,
            'unanswered' => InstagramPosts::unansweredCount(),
            'planned' => count(InstagramPosts::upcoming()),
        ];
    }
}
