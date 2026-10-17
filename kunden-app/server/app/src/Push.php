<?php
declare(strict_types=1);

namespace Club;

/**
 * Push-Nachrichten an Mitglieder.
 *
 * Alles läuft über eine Warteschlange (club_push_queue): Nachrichten warten das Ende der Ruhezeit ab
 * (Standard 21–8 Uhr) und werden über einen Schlüssel (dedupe) nie doppelt verschickt.
 * Die Texte sind Vorlagen mit Platzhaltern und im Admin-Bereich änderbar.
 */
final class Push
{
    /** Kategorien, die Mitglieder einzeln abschalten können. */
    public const CATEGORIES = [
        'orders' => 'Bestellungen & Versand',
        'points' => 'Punkte & Prämien',
        'news' => 'Aktionen & neue Düfte',
    ];

    public const TEMPLATES = [
        'order_shipped' => ['label' => 'Bestellung versendet', 'cat' => 'orders', 'title' => 'Dein Paket ist unterwegs', 'body' => '{bestellung} hat unser Lager verlassen. Tippe hier, um die Sendung zu verfolgen.'],
        'order_delivered' => ['label' => 'Bestellung zugestellt', 'cat' => 'orders', 'title' => 'Dein Duft ist angekommen', 'body' => '{bestellung} wurde zugestellt. Viel Freude damit, {vorname}!'],
        'points_pending' => ['label' => 'Punkte gutgeschrieben (noch gesperrt)', 'cat' => 'points', 'title' => '+{punkte} Punkte gutgeschrieben', 'body' => '{grund}. Ab {datum} kannst du sie einlösen.'],
        'points_unlocked' => ['label' => 'Punkte jetzt einlösbar', 'cat' => 'points', 'title' => 'Deine {punkte} Punkte sind jetzt einlösbar', 'body' => '{grund}. Einlösbar: {kontostand} Punkte, direkt im Warenkorb.'],
        'points_credited' => ['label' => 'Punkte gutgeschrieben', 'cat' => 'points', 'title' => '+{punkte} Punkte', 'body' => '{grund}. Dein Kontostand: {kontostand} Punkte.'],
        'points_deducted' => ['label' => 'Punkte abgezogen', 'cat' => 'points', 'title' => '−{punkte} Punkte', 'body' => '{grund}. Dein Kontostand: {kontostand} Punkte.'],
        'points_redeemed' => ['label' => 'Punkte eingelöst', 'cat' => 'points', 'title' => '−{punkte} Punkte eingelöst', 'body' => '{grund}. Dein Kontostand: {kontostand} Punkte.'],
        'reward_ready' => ['label' => 'Prämie einlösbar', 'cat' => 'points', 'title' => 'Deine Prämie wartet', 'body' => 'Du hast {euro} Rabatt bereit. Löse ihn mit einem Tipp als Code ein.'],
        'points_expiring' => ['label' => 'Punkte verfallen bald (60 und 30 Tage vorher)', 'cat' => 'points', 'title' => '{punkte} Punkte verfallen am {datum}', 'body' => 'Das sind {euro}. Löse sie vorher im Warenkorb ein, dann gehen sie nicht verloren.'],
        'code_expiring' => ['label' => 'Code läuft bald ab', 'cat' => 'points', 'title' => 'Dein Code läuft bald ab', 'body' => '{code} über {euro} gilt noch bis {datum}.'],
        'code_lapsed' => ['label' => 'Code abgelaufen', 'cat' => 'points', 'title' => 'Dein Code ist abgelaufen', 'body' => '{code} über {euro} ist nicht mehr gültig.'],
        'tier_up' => ['label' => 'Neue Stufe erreicht', 'cat' => 'points', 'title' => 'Willkommen in {stufe}', 'body' => 'Ab jetzt sammelst du {satz}. Danke, dass du dabei bist!'],
        'birthday' => ['label' => 'Geburtstag', 'cat' => 'points', 'title' => 'Alles Gute, {vorname}!', 'body' => 'Zum Geburtstag schenken wir dir {punkte} Punkte.'],
        'referral' => ['label' => 'Empfehlung belohnt', 'cat' => 'points', 'title' => 'Danke fürs Weitersagen', 'body' => '{freund} hat zum ersten Mal bestellt. Dafür sind dir {punkte} Punkte gutgeschrieben, einlösbar ab {datum}.'],
        'promo_start' => ['label' => 'Aktion startet', 'cat' => 'news', 'title' => '{aktion}: {faktor} Punkte', 'body' => 'Bis {datum} sammelst du {faktor} Punkte auf jede Bestellung.'],
        'survey' => ['label' => 'Bewertung nach der Zustellung', 'cat' => 'orders', 'title' => 'Wie gefällt dir {duft}?', 'body' => 'Ein Tipp auf die Sterne genügt. Danke, {vorname}!'],
        'reorder' => ['label' => 'Nachkauf-Erinnerung', 'cat' => 'news', 'title' => 'Zeit für Nachschub?', 'body' => 'Falls {duft} langsam leer wird: Hier kannst du ihn mit einem Tipp nachbestellen.'],
        'referral_pending' => ['label' => 'Bestellung über den Empfehlungslink', 'cat' => 'points', 'title' => 'Über deinen Link wurde bestellt', 'body' => 'Dir sind {punkte} Punkte gutgeschrieben. Ab {datum} kannst du sie einlösen.'],
        'referral_order' => ['label' => 'Empfehlung über den Link einlösbar', 'cat' => 'points', 'title' => 'Danke fürs Weitersagen', 'body' => 'Deine {punkte} Punkte für die Bestellung über deinen Link sind jetzt einlösbar.'],
    ];

    /** Platzhalter je Vorlage (für die Hilfe im Admin-Bereich). */
    public const VARS = [
        'order_shipped' => ['vorname', 'bestellung'],
        'order_delivered' => ['vorname', 'bestellung'],
        'points_pending' => ['vorname', 'punkte', 'grund', 'datum', 'kontostand'],
        'points_unlocked' => ['vorname', 'punkte', 'grund', 'kontostand'],
        'points_credited' => ['vorname', 'punkte', 'grund', 'kontostand'],
        'points_deducted' => ['vorname', 'punkte', 'grund', 'kontostand'],
        'points_redeemed' => ['vorname', 'punkte', 'grund', 'kontostand'],
        'reward_ready' => ['vorname', 'euro', 'kontostand'],
        'points_expiring' => ['vorname', 'punkte', 'euro', 'datum', 'tage', 'kontostand'],
        'code_expiring' => ['vorname', 'code', 'euro', 'datum'],
        'code_lapsed' => ['vorname', 'code', 'euro'],
        'tier_up' => ['vorname', 'stufe', 'satz'],
        'birthday' => ['vorname', 'punkte', 'kontostand'],
        'referral' => ['vorname', 'freund', 'punkte', 'datum'],
        'promo_start' => ['vorname', 'aktion', 'faktor', 'datum'],
        'survey' => ['vorname', 'duft', 'bestellung', 'punkte'],
        'reorder' => ['vorname', 'duft'],
        'referral_pending' => ['vorname', 'punkte', 'datum'],
        'referral_order' => ['vorname', 'punkte', 'kontostand'],
    ];

    private static bool $flushDeferred = false;

    /** Beim Datenbank-Update: Umstellungen ohne Push-Nachrichten an Mitglieder. */
    public static bool $mute = false;

    // ---------- Vorlagen ----------

    public static function templates(): array
    {
        $saved = Settings::get('push_templates', []);
        $saved = is_array($saved) ? $saved : [];
        $out = [];
        foreach (self::TEMPLATES as $key => $t) {
            $s = is_array($saved[$key] ?? null) ? $saved[$key] : [];
            $out[$key] = [
                'key' => $key,
                'label' => $t['label'],
                'cat' => $t['cat'],
                'title' => is_string($s['title'] ?? null) && $s['title'] !== '' ? $s['title'] : $t['title'],
                'body' => is_string($s['body'] ?? null) && $s['body'] !== '' ? $s['body'] : $t['body'],
                'enabled' => array_key_exists('enabled', $s) ? (bool) $s['enabled'] : true,
                'default_title' => $t['title'],
                'default_body' => $t['body'],
                'vars' => self::VARS[$key],
            ];
        }
        return $out;
    }

    public static function saveTemplates(array $in): array
    {
        $saved = Settings::get('push_templates', []);
        $saved = is_array($saved) ? $saved : [];
        foreach (self::TEMPLATES as $key => $t) {
            if (!is_array($in[$key] ?? null)) {
                continue; // nicht mitgeschickt: bleibt, wie es ist
            }
            $row = $in[$key];
            $title = Util::str($row['title'] ?? '', 120, false);
            $body = Util::str($row['body'] ?? '', 300, false);
            $saved[$key] = [
                'title' => $title !== '' && $title !== $t['title'] ? $title : '',
                'body' => $body !== '' && $body !== $t['body'] ? $body : '',
                'enabled' => array_key_exists('enabled', $row) ? (bool) $row['enabled'] : true,
            ];
        }
        Settings::set('push_templates', $saved);
        return self::templates();
    }

    /** Platzhalter ersetzen; leere Namen werden sauber weggelassen („Viel Freude damit!“). */
    public static function fill(string $text, array $vars): string
    {
        $out = preg_replace_callback('/\{(\w+)\}/', static fn ($m) => array_key_exists($m[1], $vars) ? (string) $vars[$m[1]] : $m[0], $text) ?? $text;
        $out = preg_replace('/,\s*([!?.])/u', '$1', $out) ?? $out;
        $out = preg_replace('/\s{2,}/u', ' ', $out) ?? $out;
        return trim(preg_replace('/\s+([!?.,])/u', '$1', $out) ?? $out);
    }

    // ---------- Einstellungen der Mitglieder ----------

    public static function prefs(array $member): array
    {
        $saved = json_decode((string) ($member['push_prefs'] ?? ''), true);
        $out = [];
        foreach (array_keys(self::CATEGORIES) as $c) {
            $out[$c] = is_array($saved) && array_key_exists($c, $saved) ? (bool) $saved[$c] : true;
        }
        return $out;
    }

    public static function savePrefs(array $member, array $in): array
    {
        $p = self::prefs($member);
        foreach (array_keys(self::CATEGORIES) as $c) {
            if (array_key_exists($c, $in)) {
                $p[$c] = (bool) $in[$c];
            }
        }
        Db::exec('UPDATE club_members SET push_prefs = ? WHERE id = ?', [Util::json($p), $member['id']]);
        return $p;
    }

    public static function devices(string $memberId): int
    {
        return (int) Db::value('SELECT COUNT(*) FROM club_push_subs WHERE member_id = ?', [$memberId]);
    }

    /** Mitglieder mit mindestens einem Gerät, die diese Kategorie erlauben. */
    public static function recipients(string $cat, ?string $minTier = null): array
    {
        $rows = Db::all('SELECT m.* FROM club_members m WHERE m.joined_at IS NOT NULL AND m.test = 0 AND EXISTS (SELECT 1 FROM club_push_subs s WHERE s.member_id = m.id)');
        $tiers = Tiers::KEYS;
        $min = $minTier !== null ? array_search($minTier, $tiers, true) : false;
        return array_values(array_filter($rows, static function ($m) use ($cat, $min, $tiers) {
            if (!self::prefs($m)[$cat]) {
                return false;
            }
            if ($min !== false && $min > 0) {
                return array_search(Tiers::of($m)['key'], $tiers, true) >= $min;
            }
            return true;
        }));
    }

    // ---------- Warteschlange ----------

    /** Frühester Versandzeitpunkt unter Beachtung der Ruhezeit. */
    public static function notBefore(int $now): int
    {
        $q = Settings::get('push_quiet', ['start' => 21, 'end' => 8]);
        $start = (int) ($q['start'] ?? 21);
        $end = (int) ($q['end'] ?? 8);
        if ($start === $end) {
            return $now;
        }
        $ts = intdiv($now, 1000);
        $h = (int) date('G', $ts);
        $quiet = $start > $end ? ($h >= $start || $h < $end) : ($h >= $start && $h < $end);
        if (!$quiet) {
            return $now;
        }
        // Ende der Ruhezeit: heute um $end Uhr, falls das noch kommt, sonst morgen
        $today = (int) strtotime(date('Y-m-d', $ts) . sprintf(' %02d:00:00', $end));
        return ($today > $ts ? $today : (int) strtotime('+1 day', $today)) * 1000;
    }

    /**
     * Nachricht für ein Mitglied einreihen. Gibt true zurück, wenn sie eingereiht wurde
     * (nicht, wenn die Vorlage aus ist, die Kategorie abbestellt ist oder kein Gerät angemeldet ist).
     * $custom: eigener Titel/Text statt der Vorlage (z. B. bei Aktionen)
     */
    public static function queue(array|string $member, string $key, array $vars = [], ?string $dedupe = null, ?string $url = null, ?array $custom = null): bool
    {
        if (self::$mute) {
            return false;
        }
        $m = is_array($member) ? $member : Db::one('SELECT * FROM club_members WHERE id = ?', [$member]);
        if (!$m || !$m['joined_at']) {
            return false;
        }
        $tpl = self::templates()[$key] ?? null;
        if (!$tpl || !$tpl['enabled'] || !self::prefs($m)[$tpl['cat']]) {
            return false;
        }
        if (self::devices(Trial::deviceMemberId($m['id'])) === 0) {
            return false;
        }
        $vars += [
            'vorname' => trim((string) ($m['first_name'] ?? '')),
            'kontostand' => number_format(Points::balance($m['id']), 0, ',', '.'),
        ];
        $title = self::fill((string) (($custom['title'] ?? null) ?: $tpl['title']), $vars);
        if ((int) ($m['test'] ?? 0) === 1) {
            $title = 'Testbestellung · ' . $title;
        }
        $body = self::fill((string) (($custom['body'] ?? null) ?: $tpl['body']), $vars);
        $now = Util::now();

        // „Prämie bereit“ direkt nach einer Gutschrift: an die Gutschrift anhängen statt zwei Nachrichten
        if ($key === 'reward_ready') {
            $prev = Db::one(
                "SELECT * FROM club_push_queue WHERE member_id = ? AND kind IN ('points_credited', 'points_unlocked', 'referral') AND status = 'queued' AND created_at > ? ORDER BY created_at DESC",
                [$m['id'], $now - 120000]
            );
            if ($prev) {
                $add = ' Du hast jetzt ' . ($vars['euro'] ?? '') . ' Rabatt bereit.';
                Db::exec('UPDATE club_push_queue SET body = ?, url = ? WHERE id = ?', [mb_substr($prev['body'] . $add, 0, 500), '/praemien', $prev['id']]);
                return true;
            }
        }
        // Testbestellung: sofort, auch in der Ruhezeit – sonst kommt beim Ausprobieren am Abend nichts an
        $notBefore = (int) ($m['test'] ?? 0) === 1 ? $now : self::notBefore($now);
        return self::insert($m['id'], $key, $title, $body, $url ?? self::defaultUrl($key), $dedupe, null, $notBefore);
    }

    public static function insert(string $memberId, string $kind, string $title, string $body, ?string $url, ?string $dedupe, ?string $broadcastId, int $notBefore): bool
    {
        if ($dedupe !== null && Db::value('SELECT 1 FROM club_push_queue WHERE dedupe = ?', [$dedupe])) {
            return false;
        }
        try {
            Db::insert('club_push_queue', [
                'id' => Util::uuid(),
                'member_id' => $memberId,
                'kind' => $kind,
                'title' => mb_substr($title, 0, 200),
                'body' => mb_substr($body, 0, 500),
                'url' => $url !== null ? mb_substr($url, 0, 255) : null,
                'dedupe' => $dedupe !== null ? mb_substr($dedupe, 0, 120) : null,
                'broadcast_id' => $broadcastId,
                'not_before' => $notBefore,
                'status' => 'queued',
                'devices' => 0,
                'error' => null,
                'created_at' => Util::now(),
                'sent_at' => null,
            ]);
        } catch (\PDOException) {
            return false; // gleichzeitig schon eingereiht (dedupe)
        }
        if (!self::$flushDeferred && PHP_SAPI !== 'cli') {
            self::$flushDeferred = true;
            Http::defer(static fn () => self::flush());
        }
        return true;
    }

    private static function defaultUrl(string $key): string
    {
        return match (self::TEMPLATES[$key]['cat'] ?? 'points') {
            'orders' => '/bestellungen',
            'news' => '/',
            default => '/praemien',
        };
    }

    private static function subject(): string
    {
        $contact = Settings::get('push_contact');
        if (!is_string($contact) || $contact === '') {
            $contact = Mailer::config()['from_email'] ?: 'info@perfumecloud.de';
        }
        return 'mailto:' . $contact;
    }

    /** Fällige Nachrichten verschicken. */
    public static function flush(?string $memberId = null, int $max = 300): string
    {
        self::$flushDeferred = false;
        $now = Util::now();
        $rows = $memberId
            ? Db::all("SELECT * FROM club_push_queue WHERE status = 'queued' AND not_before <= ? AND member_id = ? ORDER BY created_at LIMIT $max", [$now, $memberId])
            : Db::all("SELECT * FROM club_push_queue WHERE status = 'queued' AND not_before <= ? ORDER BY created_at LIMIT $max", [$now]);
        $sent = 0;
        $subject = self::subject();
        $subsCache = [];
        foreach ($rows as $r) {
            if (Db::exec("UPDATE club_push_queue SET status = 'sending' WHERE id = ? AND status = 'queued'", [$r['id']]) !== 1) {
                continue;
            }
            $subs = $subsCache[$r['member_id']] ??= Db::all('SELECT * FROM club_push_subs WHERE member_id = ?', [Trial::deviceMemberId($r['member_id'])]);
            if (!$subs) {
                Db::exec("UPDATE club_push_queue SET status = 'no_device', sent_at = ? WHERE id = ?", [Util::now(), $r['id']]);
                continue;
            }
            $ok = 0;
            $errors = [];
            foreach ($subs as $s) {
                $res = self::sendTo($s, ['title' => $r['title'], 'body' => $r['body'], 'url' => $r['url'] ?: '/', 'tag' => $r['id']], $subject);
                if ($res['ok']) {
                    $ok++;
                } elseif ($res['reason'] !== '') {
                    $errors[] = $res['reason'];
                }
            }
            unset($subsCache[$r['member_id']]);
            Db::update('club_push_queue', [
                'status' => $ok > 0 ? 'sent' : 'failed',
                'devices' => $ok,
                'error' => $errors ? mb_substr(implode('; ', array_unique($errors)), 0, 250) : null,
                'sent_at' => Util::now(),
            ], ['id' => $r['id']]);
            $sent += $ok > 0 ? 1 : 0;
        }
        return "$sent Push-Nachrichten verschickt";
    }

    /** An ein Gerät senden und das Ergebnis am Abo vermerken. @return array{ok:bool, status:int, reason:string} */
    private static function sendTo(array $s, array $payload, string $subject): array
    {
        try {
            $res = WebPush::send($s, $payload, $subject);
        } catch (\Throwable $e) {
            $res = ['status' => 0, 'reason' => $e->getMessage()];
        }
        $status = $res['status'];
        $ok = $status >= 200 && $status < 300;
        if ($ok) {
            Db::update('club_push_subs', ['last_ok_at' => Util::now(), 'fail_count' => 0, 'last_status' => $status, 'last_error' => null], ['id' => $s['id']]);
        } elseif ($status === 404 || $status === 410) {
            // Abo gibt es nicht mehr (App gelöscht, Mitteilungen ausgeschaltet)
            Db::exec('DELETE FROM club_push_subs WHERE id = ?', [$s['id']]);
            $res['reason'] = 'Gerät abgemeldet';
        } else {
            $fails = (int) $s['fail_count'] + 1;
            if ($fails >= 30) {
                Db::exec('DELETE FROM club_push_subs WHERE id = ?', [$s['id']]);
            } else {
                Db::update('club_push_subs', ['fail_count' => $fails, 'last_status' => $status, 'last_error' => mb_substr($res['reason'], 0, 250)], ['id' => $s['id']]);
            }
        }
        return ['ok' => $ok, 'status' => $status, 'reason' => $res['reason']];
    }

    // ---------- Abos ----------

    public static function subscribe(array $member, array $in): array
    {
        $endpoint = (string) ($in['endpoint'] ?? '');
        $keys = is_array($in['keys'] ?? null) ? $in['keys'] : [];
        if (!WebPush::validEndpoint($endpoint) || strlen($endpoint) > 2000 || empty($keys['p256dh']) || empty($keys['auth'])) {
            throw new HttpError(422, 'Ungültiges Push-Abo.');
        }
        $id = hash('sha256', $endpoint);
        Db::exec('DELETE FROM club_push_subs WHERE id = ?', [$id]);
        Db::insert('club_push_subs', [
            'id' => $id,
            'member_id' => $member['id'],
            'endpoint' => $endpoint,
            'p256dh' => mb_substr((string) $keys['p256dh'], 0, 200),
            'auth' => mb_substr((string) $keys['auth'], 0, 100),
            'user_agent' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250),
            'created_at' => Util::now(),
            'last_ok_at' => null,
            'last_status' => null,
            'last_error' => null,
            'fail_count' => 0,
        ]);
        return self::state($member);
    }

    public static function unsubscribe(array $member, string $endpoint): array
    {
        Db::exec('DELETE FROM club_push_subs WHERE id = ? AND member_id = ?', [hash('sha256', $endpoint), $member['id']]);
        return self::state($member);
    }

    public static function state(array $member): array
    {
        return ['devices' => self::devices($member['id']), 'prefs' => self::prefs($member), 'categories' => self::CATEGORIES];
    }

    /** Testnachricht an alle Geräte eines Mitglieds – mit Ergebnis je Gerät. */
    public static function test(array $member, ?string $title = null, ?string $body = null, ?string $url = null): array
    {
        $subs = Db::all('SELECT * FROM club_push_subs WHERE member_id = ?', [$member['id']]);
        $results = [];
        foreach ($subs as $s) {
            $res = self::sendTo($s, [
                'title' => $title ?? 'Push funktioniert',
                'body' => $body ?? 'So erfährst du von Versand, Punkten und Aktionen.',
                'url' => $url ?? '/konto',
                'tag' => 'test',
            ], self::subject());
            $results[] = ['device' => self::deviceName((string) $s['user_agent']), 'ok' => $res['ok'], 'status' => $res['status'], 'reason' => $res['reason']];
        }
        return ['devices' => count($subs), 'results' => $results];
    }

    public static function deviceName(string $ua): string
    {
        $os = match (true) {
            str_contains($ua, 'iPhone') => 'iPhone',
            str_contains($ua, 'iPad') => 'iPad',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Mac OS') => 'Mac',
            str_contains($ua, 'Windows') => 'Windows',
            default => 'Gerät',
        };
        $browser = match (true) {
            str_contains($ua, 'Edg/') => 'Edge',
            str_contains($ua, 'Firefox') => 'Firefox',
            str_contains($ua, 'Chrome') => 'Chrome',
            str_contains($ua, 'Safari') => 'Safari',
            default => '',
        };
        return trim("$os $browser");
    }

    /** Für den Admin-Bereich: Geräte, Versand der letzten 7 Tage, letzte Fehler. */
    public static function stats(): array
    {
        $since = Util::now() - 7 * Points::DAY_MS;
        $byStatus = [];
        foreach (Db::all('SELECT status, COUNT(*) AS n FROM club_push_queue WHERE created_at > ? GROUP BY status', [$since]) as $r) {
            $byStatus[$r['status']] = (int) $r['n'];
        }
        return [
            'devices' => (int) Db::value('SELECT COUNT(*) FROM club_push_subs'),
            'members' => (int) Db::value('SELECT COUNT(DISTINCT member_id) FROM club_push_subs'),
            'week' => $byStatus,
            'errors' => array_map(static fn ($r) => [
                'device' => self::deviceName((string) $r['user_agent']),
                'status' => $r['last_status'] !== null ? (int) $r['last_status'] : null,
                'error' => $r['last_error'],
                'fails' => (int) $r['fail_count'],
            ], Db::all('SELECT user_agent, last_status, last_error, fail_count FROM club_push_subs WHERE fail_count > 0 ORDER BY fail_count DESC LIMIT 10')),
            'quiet' => Settings::get('push_quiet', ['start' => 21, 'end' => 8]),
        ];
    }

    public static function saveQuiet(array $in): void
    {
        $start = (int) ($in['start'] ?? 21);
        $end = (int) ($in['end'] ?? 8);
        if ($start < 0 || $start > 23 || $end < 0 || $end > 23) {
            throw new HttpError(422, 'Ruhezeit: bitte volle Stunden von 0 bis 23 angeben.');
        }
        Settings::set('push_quiet', ['start' => $start, 'end' => $end]);
    }
}
