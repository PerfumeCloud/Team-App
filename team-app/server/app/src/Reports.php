<?php
declare(strict_types=1);

namespace PC;

/**
 * Auswertungen: Wochenrückblick (freitags, damit ihr am Wochenende darüber sprechen könnt),
 * Antwortzeit auf Kundenmails und die Auswertungsadresse (z. B. auswertung@perfumecloud.de),
 * an die alle Berichte und die wöchentliche Datensicherung gehen.
 */
final class Reports
{
    public const DEFAULT_EMAIL = 'auswertung@perfumecloud.de';
    private const DAYS = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
    private const EXCLUDED_FINANCIAL = ['VOIDED', 'EXPIRED'];

    // ---------- Einstellungen ----------

    /** Adresse für alle Auswertungen und die Wochen-Sicherung. */
    public static function email(): string
    {
        $e = Settings::get('report_email');
        return is_string($e) && filter_var($e, FILTER_VALIDATE_EMAIL) ? $e : self::DEFAULT_EMAIL;
    }

    /** @return array{on:bool, day:int, hour:int, mail:bool, push:bool} day: 1 = Montag … 5 = Freitag … 7 = Sonntag */
    public static function weeklyConfig(): array
    {
        $c = Settings::get('weekly');
        $c = is_array($c) ? $c : [];
        return [
            'on' => (bool) ($c['on'] ?? true),
            'day' => max(1, min(7, (int) ($c['day'] ?? 5))),
            'hour' => max(6, min(22, (int) ($c['hour'] ?? 17))),
            'mail' => (bool) ($c['mail'] ?? true),
            'push' => (bool) ($c['push'] ?? true),
        ];
    }

    public static function settings(): array
    {
        return [
            'email' => self::email(),
            'weekly' => self::weeklyConfig(),
            'lastWeekly' => Settings::get('weekly_last'),
            'days' => array_slice(self::DAYS, 1),
        ];
    }

    public static function save(array $in): array
    {
        if (array_key_exists('email', $in)) {
            $email = mb_strtolower(trim((string) $in['email']));
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new HttpError(422, 'Bitte eine gültige Adresse für die Auswertungen angeben.');
            }
            Settings::set('report_email', $email !== '' ? $email : self::DEFAULT_EMAIL);
        }
        if (is_array($in['weekly'] ?? null)) {
            $c = self::weeklyConfig();
            foreach (['on', 'mail', 'push'] as $k) {
                if (isset($in['weekly'][$k])) {
                    $c[$k] = (bool) $in['weekly'][$k];
                }
            }
            if (isset($in['weekly']['day'])) {
                $c['day'] = max(1, min(7, (int) $in['weekly']['day']));
            }
            if (isset($in['weekly']['hour'])) {
                $c['hour'] = max(6, min(22, (int) $in['weekly']['hour']));
            }
            Settings::set('weekly', $c);
        }
        return self::settings();
    }

    /** Kurze Testmail an die Auswertungsadresse. */
    public static function testMail(): array
    {
        $to = self::email();
        return Mailer::send($to, 'Test: Auswertungen der Team-App', "Hallo,\n\ndiese Adresse ist in der Team-App als Empfänger für Auswertungen eingetragen. Hierher kommen:\n\n• der Wochenrückblick (" . self::DAYS[self::weeklyConfig()['day']] . 's, ' . self::weeklyConfig()['hour'] . " Uhr)\n• die wöchentliche Datensicherung (verschlüsselt)\n\nWenn du diese Mail liest, klappt alles.\n");
    }

    // ---------- Erinnerung an das Postfach ----------

    /** Einmalig: Aufgabe „Postfach auswertung@… anlegen“ für einen Admin (Marius zuerst). */
    public static function seedReminderTask(): void
    {
        if (Settings::get('seed_report_task')) {
            return;
        }
        $admin = Db::one("SELECT * FROM users WHERE role = 'admin' AND deleted = 0 AND email LIKE 'marius%' ORDER BY created_at")
            ?? Db::one("SELECT * FROM users WHERE role = 'admin' AND deleted = 0 ORDER BY created_at");
        if (!$admin) {
            return; // noch niemand eingerichtet – beim nächsten Update
        }
        $now = Util::now();
        Db::insert('tasks', [
            'id' => Util::uuid(),
            'title' => 'Postfach ' . self::DEFAULT_EMAIL . ' anlegen',
            'description' => "Dorthin gehen ab jetzt alle Auswertungen: der Wochenrückblick (freitags) und die wöchentliche Datensicherung.\n\n"
                . "1. netcup (Plesk) → E-Mail → „E-Mail-Adresse erstellen“: " . self::DEFAULT_EMAIL . " mit einem sicheren Passwort.\n"
                . "2. Das Postfach in Apple Mail/Outlook hinzufügen oder eine Weiterleitung an eure eigenen Adressen einrichten.\n"
                . "3. Team-App → Einstellungen → Auswertungen: Adresse prüfen und „Testmail schicken“.\n"
                . "4. Ebenfalls dort ein Sicherungs-Passwort festlegen und sicher aufbewahren (ohne Passwort lässt sich keine Sicherung öffnen).",
            'status' => 'todo',
            'priority' => 'high',
            'category' => 'Einrichtung',
            'assignee_id' => $admin['id'],
            'due_date' => date('Y-m-d'),
            'position' => (float) $now,
            'checklist' => Util::json([
                ['id' => Util::uuid(), 'text' => 'Postfach bei netcup anlegen', 'done' => false],
                ['id' => Util::uuid(), 'text' => 'Im Mailprogramm hinzufügen oder weiterleiten', 'done' => false],
                ['id' => Util::uuid(), 'text' => 'Testmail aus der Team-App erhalten', 'done' => false],
                ['id' => Util::uuid(), 'text' => 'Sicherungs-Passwort festlegen', 'done' => false],
            ]),
            'source_email_id' => null,
            'completed_at' => null,
            'created_by' => null,
            'updated_by' => null,
            'created_at' => $now,
            'updated_at' => $now,
            'deleted' => 0,
        ]);
        Settings::set('seed_report_task', true);
    }

    // ---------- Wochenrückblick ----------

    /** Bestellungen aus dem Probelauf zählen nicht mit. @return string[] */
    public static function testOrderIds(): array
    {
        $ids = Settings::get('test_orders', []);
        return is_array($ids) ? array_map('strval', $ids) : [];
    }

    /** Kennzahlen der letzten 7 Tage bis $end (ms) im Vergleich zu den 7 Tagen davor. */
    public static function compute(?int $end = null): array
    {
        $end ??= Util::now();
        $week = 7 * 86400000;
        $start = $end - $week;
        $prevStart = $start - $week;
        $test = array_flip(self::testOrderIds());

        $orders = array_values(array_filter(
            Db::all('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? AND cancelled = 0', [$prevStart, $end]),
            static fn ($o) => !isset($test[$o['id']]) && !in_array($o['financial_status'], self::EXCLUDED_FINANCIAL, true)
        ));
        $cur = ['revenue' => 0, 'orders' => 0, 'items' => 0];
        $prev = ['revenue' => 0, 'orders' => 0, 'items' => 0];
        $products = [];
        $add = static function (array $t, array $o): array {
            $t['revenue'] += (int) $o['total_cents'];
            $t['orders']++;
            $t['items'] += (int) $o['item_count'];
            return $t;
        };
        foreach ($orders as $o) {
            $isCur = (int) $o['created_at'] >= $start;
            if ($isCur) {
                $cur = $add($cur, $o);
            } else {
                $prev = $add($prev, $o);
            }
            if ($isCur) {
                foreach (json_decode((string) $o['items'], true) ?: [] as $it) {
                    $k = (string) $it['t'];
                    $products[$k] ??= ['title' => $k, 'qty' => 0, 'revenue' => 0];
                    $products[$k]['qty'] += (int) $it['q'];
                    $products[$k]['revenue'] += (int) $it['s'];
                }
            }
        }
        usort($products, static fn ($a, $b) => $b['qty'] <=> $a['qty'] ?: $b['revenue'] <=> $a['revenue']);
        $aov = static fn (array $t) => $t['orders'] ? (int) round($t['revenue'] / $t['orders']) : 0;
        $cur['aov'] = $aov($cur);
        $prev['aov'] = $aov($prev);

        $toShip = Stats::toShip();
        $today = date('Y-m-d');
        return [
            'from' => $start,
            'to' => $end,
            'shop' => [
                'current' => $cur,
                'previous' => $prev,
                'top' => array_slice($products, 0, 3),
                'shipped' => (int) Db::value('SELECT COUNT(*) FROM shipments WHERE created_at >= ? AND created_at < ?', [$start, $end]),
                'to_ship' => count($toShip),
                'oldest_days' => $toShip ? (int) floor(($end - (int) end($toShip)['created_at']) / 86400000) : null,
                'configured' => Shopify::configured(),
            ],
            'mail' => self::mailStats($start, $end, $prevStart),
            'tasks' => [
                'done' => (int) Db::value("SELECT COUNT(*) FROM tasks WHERE deleted = 0 AND status = 'done' AND completed_at >= ? AND completed_at < ?", [$start, $end]),
                'created' => (int) Db::value('SELECT COUNT(*) FROM tasks WHERE deleted = 0 AND created_at >= ? AND created_at < ?', [$start, $end]),
                'overdue' => array_map(static fn ($t) => ['title' => $t['title'], 'due' => $t['due_date'], 'assignee' => $t['assignee_id']], Db::all(
                    "SELECT title, due_date, assignee_id FROM tasks WHERE deleted = 0 AND status <> 'done' AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date LIMIT 8",
                    [$today]
                )),
            ],
            'events' => array_map(static fn ($e) => ['title' => $e['title'], 'date' => $e['start_date'], 'time' => $e['start_time']], Db::all(
                'SELECT title, start_date, start_time FROM events WHERE deleted = 0 AND start_date >= ? AND start_date <= ? ORDER BY start_date, start_time LIMIT 6',
                [$today, date('Y-m-d', intdiv($end, 1000) + 9 * 86400)]
            )),
            'club' => self::club($start, $end),
            'instagram' => self::instagram($start, $end),
            'users' => array_column(array_map(static fn ($u) => ['id' => $u['id'], 'name' => explode(' ', $u['name'])[0]], Db::all('SELECT id, name FROM users')), 'name', 'id'),
        ];
    }

    /**
     * I7 Antwortzeit: Kundenmails in Team-Postfächern (ohne Newsletter/automatische), Zeit bis zur Antwort.
     * Gezählt wird, was in der Woche eingegangen ist; „offen über 24 Std.“ ist der Stand jetzt.
     */
    public static function mailStats(int $start, int $end, int $prevStart): array
    {
        $team = array_column(array_filter(MailJob::mailboxes(), static fn ($m) => !$m['visible_to']), 'email');
        if (!$team) {
            return ['configured' => false];
        }
        $in = implode(',', array_fill(0, count($team), '?'));
        $rows = Db::all("SELECT received_at, answered_at, status, answered FROM emails WHERE auto = 0 AND mailbox IN ($in) AND received_at >= ? AND received_at < ?", [...$team, $prevStart, $end]);
        $calc = static function (array $list): array {
            $hours = [];
            foreach ($list as $r) {
                if ($r['answered_at'] !== null && (int) $r['answered_at'] >= (int) $r['received_at']) {
                    $hours[] = ((int) $r['answered_at'] - (int) $r['received_at']) / 3600000;
                }
            }
            sort($hours);
            $n = count($hours);
            return [
                'received' => count($list),
                'answered' => count(array_filter($list, static fn ($r) => (int) $r['answered'] === 1)),
                'measured' => $n,
                'avg_hours' => $n ? round(array_sum($hours) / $n, 1) : null,
                'median_hours' => $n ? round($n % 2 ? $hours[intdiv($n, 2)] : ($hours[$n / 2 - 1] + $hours[$n / 2]) / 2, 1) : null,
                'within_24h' => $n ? (int) round(100 * count(array_filter($hours, static fn ($h) => $h <= 24)) / $n) : null,
            ];
        };
        $cur = $calc(array_filter($rows, static fn ($r) => (int) $r['received_at'] >= $start));
        $prev = $calc(array_filter($rows, static fn ($r) => (int) $r['received_at'] < $start));
        $open24 = (int) Db::value(
            "SELECT COUNT(*) FROM emails WHERE deleted = 0 AND auto = 0 AND answered = 0 AND status = 'open' AND mailbox IN ($in) AND received_at < ?",
            [...$team, $end - 24 * 3600000]
        );
        $byPerson = [];
        foreach (Db::all('SELECT user_id, COUNT(*) AS n FROM replies WHERE created_at >= ? AND created_at < ? GROUP BY user_id', [$start, $end]) as $r) {
            $byPerson[(string) $r['user_id']] = (int) $r['n'];
        }
        return ['configured' => true, 'current' => $cur, 'previous' => $prev, 'open_24h' => $open24, 'replies_in_app' => $byPerson];
    }

    private static function club(int $start, int $end): ?array
    {
        if (!Club::configured()) {
            return null;
        }
        try {
            return Club::request('GET', '/internal/weekly?from=' . $start . '&to=' . $end);
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    private static function instagram(int $start, int $end): ?array
    {
        try {
            return Instagram::weekly($start, $end);
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    /** Fällig? Am eingestellten Tag ab der eingestellten Stunde, einmal pro Woche. */
    public static function weeklyIfDue(): string
    {
        $c = self::weeklyConfig();
        $week = date('o-W');
        if (!$c['on'] || (int) date('N') !== $c['day'] || (int) date('G') < $c['hour'] || Settings::get('weekly_week') === $week) {
            return '–';
        }
        Settings::set('weekly_week', $week);
        $r = self::send(null);
        return $r['message'];
    }

    /**
     * Verschicken. $only = Person (Test „an mich“): nur an sie, als Mail und Push.
     * Sonst: Mail an die Auswertungsadresse, an alle mit „Wochenrückblick per Mail“, Push an alle, die ihn wollen.
     */
    public static function send(?array $only): array
    {
        $data = self::compute();
        ['subject' => $subject, 'text' => $text, 'html' => $html, 'push' => $push] = self::render($data);
        $c = self::weeklyConfig();
        $results = [];
        if ($only) {
            $m = Mailer::send($only['email'], '[Vorschau] ' . $subject, $text, $html);
            $p = Notify::toUser($only, $push);
            return ['sent' => $m['sent'], 'message' => $m['sent'] ? 'Wochenrückblick an ' . $only['email'] . ' verschickt' . ($p ? ' und als Push auf ' . $p . ' Gerät' . ($p === 1 ? '' : 'en') : '') . '.' : $m['message']];
        }
        $to = [];
        if ($c['mail']) {
            $to[] = self::email();
        }
        $users = Db::all('SELECT * FROM users WHERE deleted = 0');
        foreach ($users as $u) {
            if (!empty(Auth::prefs($u)['weeklyMail'])) {
                $to[] = mb_strtolower((string) $u['email']);
            }
        }
        foreach (array_unique($to) as $addr) {
            $r = Mailer::send($addr, $subject, $text, $html);
            $results[] = $addr . ': ' . ($r['sent'] ? 'ok' : $r['message']);
        }
        $pushed = $c['push'] ? Notify::users(null, 'weekly', $push) : 0;
        $msg = 'Wochenrückblick: ' . (count($to) ? implode(' · ', $results) : 'keine Mail') . ' · ' . $pushed . ' Push';
        Settings::set('weekly_last', ['at' => Util::now(), 'message' => $msg]);
        return ['sent' => true, 'message' => $msg];
    }

    // ---------- Darstellung ----------

    public static function pct(int|float $cur, int|float $prev): ?int
    {
        if ($prev == 0) {
            return null;
        }
        return (int) round(($cur - $prev) / $prev * 100);
    }

    private static function hours(?float $h): string
    {
        if ($h === null) {
            return '–';
        }
        if ($h < 1) {
            return max(1, (int) round($h * 60)) . ' Min.';
        }
        return number_format($h, $h < 10 ? 1 : 0, ',', '.') . ' Std.';
    }

    /** @return array{subject:string, text:string, html:string, push:array} */
    public static function render(array $d): array
    {
        $from = date('d.m.', intdiv($d['from'], 1000));
        $to = date('d.m.Y', intdiv($d['to'], 1000) - 1);
        $cur = $d['shop']['current'];
        $prev = $d['shop']['previous'];
        $club = is_array($d['club']) && !isset($d['club']['error']) ? $d['club'] : null;
        $mail = $d['mail'];
        $fmtPct = static function (?int $p, bool $lowerIsBetter = false): array {
            if ($p === null) {
                return ['', '#6e7177'];
            }
            $good = $lowerIsBetter ? $p <= 0 : $p >= 0;
            return [($p > 0 ? '+' : ($p < 0 ? '−' : '±')) . abs($p) . ' %', $p === 0 ? '#6e7177' : ($good ? '#2e7d4f' : '#b3261e')];
        };

        $rows = [];
        $rows[] = ['Umsatz', Util::euro($cur['revenue']), $fmtPct(self::pct($cur['revenue'], $prev['revenue'])), 'Vorwoche ' . Util::euro($prev['revenue'])];
        $rows[] = ['Bestellungen', (string) $cur['orders'], $fmtPct(self::pct($cur['orders'], $prev['orders'])), 'Vorwoche ' . $prev['orders']];
        $rows[] = ['Ø Warenkorb', Util::euro($cur['aov']), $fmtPct(self::pct($cur['aov'], $prev['aov'])), 'Vorwoche ' . Util::euro($prev['aov'])];
        if ($club) {
            $rows[] = ['Neue Club-Mitglieder', (string) ($club['members_new'] ?? 0), $fmtPct(self::pct((int) ($club['members_new'] ?? 0), (int) ($club['members_new_prev'] ?? 0))), 'insgesamt ' . (int) ($club['members_total'] ?? 0)];
            $rows[] = ['Eingelöste Punkte', number_format((int) ($club['points_redeemed'] ?? 0), 0, ',', '.'), ['', '#6e7177'], (int) ($club['codes_used'] ?? 0) . ' Codes genutzt'];
            if (isset($club['survey']['avg']) && $club['survey']['avg'] !== null) {
                $rows[] = ['Ø Bewertung', number_format((float) $club['survey']['avg'], 1, ',', '.') . ' ★', ['', '#6e7177'], (int) ($club['survey']['count'] ?? 0) . ' Bewertungen' . (!empty($club['survey']['low']) ? ' · ' . (int) $club['survey']['low'] . '× ≤ 2 ★' : '')];
            }
            if (isset($club['referrals']['orders'])) {
                $rows[] = ['Bestellungen über Empfehlungen', (string) (int) $club['referrals']['orders'], ['', '#6e7177'], (int) ($club['referrals']['clicks'] ?? 0) . ' Klicks auf Empfehlungslinks'];
            }
        }
        $ig = is_array($d['instagram'] ?? null) && !isset($d['instagram']['error']) ? $d['instagram'] : null;
        if ($ig) {
            $rows[] = ['Instagram-Follower', $ig['followers'] !== null ? number_format((int) $ig['followers'], 0, ',', '.') : '–', ['', '#6e7177'], $ig['followers_delta'] !== null ? ($ig['followers_delta'] >= 0 ? '+' : '−') . number_format(abs((int) $ig['followers_delta']), 0, ',', '.') . ' in 7 Tagen' : '@' . $ig['username']];
            if ($ig['reach'] !== null) {
                $rows[] = ['Instagram: erreichte Konten', number_format((int) $ig['reach'], 0, ',', '.'), $fmtPct($ig['reach_prev'] !== null ? self::pct((int) $ig['reach'], (int) $ig['reach_prev']) : null), $ig['posts'] . ' Beiträge' . ($ig['link_taps'] !== null ? ' · ' . (int) $ig['link_taps'] . ' Klicks auf Links im Profil' : '')];
            }
            if ($ig['unanswered'] > 0 || $ig['planned'] > 0) {
                $rows[] = ['Instagram: offen', (string) $ig['unanswered'], ['', '#6e7177'], 'Kommentare ohne Antwort · ' . $ig['planned'] . ' Beiträge geplant'];
            }
        }
        if (!empty($mail['configured'])) {
            $mc = $mail['current'];
            $rows[] = ['Antwortzeit (Median)', self::hours($mc['median_hours']), $fmtPct($mc['median_hours'] !== null && $mail['previous']['median_hours'] ? self::pct($mc['median_hours'], $mail['previous']['median_hours']) : null, true), $mc['measured'] ? ($mc['within_24h'] . ' % innerhalb von 24 Std. · Ø ' . self::hours($mc['avg_hours'])) : 'noch keine Antworten gemessen'];
            $rows[] = ['Kundenmails', (string) $mc['received'], ['', '#6e7177'], $mail['open_24h'] . ' seit über 24 Std. offen'];
        }
        $rows[] = ['Versendet', (string) $d['shop']['shipped'], ['', '#6e7177'], $d['shop']['to_ship'] . ' warten noch' . ($d['shop']['oldest_days'] ? ' (älteste seit ' . $d['shop']['oldest_days'] . ($d['shop']['oldest_days'] === 1 ? ' Tag)' : ' Tagen)') : '')];
        $rows[] = ['Aufgaben erledigt', (string) $d['tasks']['done'], ['', '#6e7177'], count($d['tasks']['overdue']) . ' überfällig'];

        $esc = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $subject = "Wochenrückblick $from–$to · " . Util::euro($cur['revenue']) . ($fmtPct(self::pct($cur['revenue'], $prev['revenue']))[0] !== '' ? ' (' . $fmtPct(self::pct($cur['revenue'], $prev['revenue']))[0] . ')' : '');

        // Text
        $t = "Wochenrückblick Perfume Cloud\n$from – $to (verglichen mit den 7 Tagen davor)\n\n";
        foreach ($rows as [$label, $value, [$p], $note]) {
            $t .= str_pad($label, 32) . $value . ($p !== '' ? "  ($p)" : '') . ($note !== '' ? "  · $note" : '') . "\n";
        }
        if ($d['shop']['top']) {
            $t .= "\nTop-Düfte\n";
            foreach ($d['shop']['top'] as $i => $p) {
                $t .= ($i + 1) . '. ' . $p['title'] . ' – ' . $p['qty'] . '× (' . Util::euro($p['revenue']) . ")\n";
            }
        }
        if ($ig && $ig['top']) {
            $t .= "\nStärkster Instagram-Beitrag\n" . ($ig['top']['caption'] !== '' ? $ig['top']['caption'] : 'ohne Text') . ' – ' . ($ig['top']['reach'] !== null ? number_format((int) $ig['top']['reach'], 0, ',', '.') . ' erreichte Konten' : $ig['top']['interactions'] . ' Interaktionen') . ($ig['top']['permalink'] ? "\n" . $ig['top']['permalink'] : '') . "\n";
        }
        if ($d['tasks']['overdue']) {
            $t .= "\nÜberfällige Aufgaben\n";
            foreach ($d['tasks']['overdue'] as $task) {
                $t .= '• ' . $task['title'] . ' (fällig ' . date('d.m.', (int) strtotime($task['due'])) . ($task['assignee'] && isset($d['users'][$task['assignee']]) ? ', ' . $d['users'][$task['assignee']] : '') . ")\n";
            }
        }
        if ($d['events']) {
            $t .= "\nDie nächsten Tage\n";
            foreach ($d['events'] as $e) {
                $t .= '• ' . self::weekday($e['date']) . ($e['time'] ? ' ' . $e['time'] : '') . ' – ' . $e['title'] . "\n";
            }
        }
        $t .= "\nAlle Zahlen live: " . Util::baseUrl() . "/statistik\n";

        // HTML (Mail-tauglich: Tabellen, Inline-Styles)
        $h = '<!doctype html><html><body style="margin:0;background:#f6f2eb;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1e2024">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2eb"><tr><td align="center" style="padding:24px 12px">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">'
            . '<tr><td style="padding:28px 28px 8px"><div style="font-family:Georgia,serif;font-size:28px;font-weight:600">Wochenrückblick</div>'
            . '<div style="color:#565a61;font-size:14px;margin-top:4px">' . $esc("$from – $to") . ' · verglichen mit den 7 Tagen davor</div></td></tr>'
            . '<tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">';
        foreach ($rows as [$label, $value, [$p, $color], $note]) {
            $h .= '<tr><td style="padding:10px 0;border-bottom:1px solid #ece7de;font-size:14px;color:#565a61">' . $esc($label)
                . ($note !== '' ? '<div style="font-size:12px;color:#6e7177;margin-top:2px">' . $esc($note) . '</div>' : '') . '</td>'
                . '<td align="right" style="padding:10px 0;border-bottom:1px solid #ece7de;white-space:nowrap"><span style="font-size:17px;font-weight:600">' . $esc($value) . '</span>'
                . ($p !== '' ? '<div style="font-size:12px;font-weight:600;color:' . $color . '">' . $esc($p) . '</div>' : '') . '</td></tr>';
        }
        $h .= '</table></td></tr>';
        $section = static fn (string $title, string $body): string => '<tr><td style="padding:14px 28px 4px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6e7177;font-weight:600">' . $title . '</div>' . $body . '</td></tr>';
        if ($d['shop']['top']) {
            $list = '';
            foreach ($d['shop']['top'] as $i => $p) {
                $list .= '<div style="padding:6px 0;font-size:14px">' . ($i + 1) . '. ' . $esc($p['title']) . ' <span style="color:#6e7177">– ' . $p['qty'] . '× · ' . $esc(Util::euro($p['revenue'])) . '</span></div>';
            }
            $h .= $section('Top-Düfte', $list);
        }
        if ($ig && $ig['top']) {
            $label = ($ig['top']['caption'] !== '' ? $ig['top']['caption'] : 'ohne Text');
            $h .= $section('Stärkster Instagram-Beitrag', '<div style="padding:6px 0;font-size:14px">' . ($ig['top']['permalink'] ? '<a href="' . $esc((string) $ig['top']['permalink']) . '" style="color:#2f4e85">' . $esc($label) . '</a>' : $esc($label))
                . ' <span style="color:#6e7177">– ' . $esc($ig['top']['reach'] !== null ? number_format((int) $ig['top']['reach'], 0, ',', '.') . ' erreichte Konten' : $ig['top']['interactions'] . ' Interaktionen') . '</span></div>');
        }
        if ($d['tasks']['overdue']) {
            $list = '';
            foreach ($d['tasks']['overdue'] as $task) {
                $who = $task['assignee'] && isset($d['users'][$task['assignee']]) ? ' · ' . $d['users'][$task['assignee']] : '';
                $list .= '<div style="padding:4px 0;font-size:14px">' . $esc($task['title']) . ' <span style="color:#b3261e">fällig ' . date('d.m.', (int) strtotime($task['due'])) . '</span><span style="color:#6e7177">' . $esc($who) . '</span></div>';
            }
            $h .= $section('Überfällige Aufgaben', $list);
        }
        if ($d['events']) {
            $list = '';
            foreach ($d['events'] as $e) {
                $list .= '<div style="padding:4px 0;font-size:14px">' . $esc(self::weekday($e['date']) . ($e['time'] ? ' ' . $e['time'] : '')) . ' – ' . $esc($e['title']) . '</div>';
            }
            $h .= $section('Die nächsten Tage', $list);
        }
        if (isset($d['instagram']['error'])) {
            $h .= $section('Instagram', '<div style="font-size:13px;color:#6e7177">Instagram-Zahlen gerade nicht abrufbar: ' . $esc((string) $d['instagram']['error']) . '</div>');
        }
        if (isset($d['club']['error'])) {
            $h .= $section('Club', '<div style="font-size:13px;color:#6e7177">Club-Zahlen gerade nicht abrufbar: ' . $esc((string) $d['club']['error']) . '</div>');
        }
        $h .= '<tr><td style="padding:20px 28px 28px"><a href="' . $esc(Util::baseUrl() . '/statistik') . '" style="display:inline-block;background:#2f4e85;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;border-radius:12px">Statistik öffnen</a></td></tr>'
            . '</table><div style="font-size:12px;color:#6e7177;padding:14px">Automatisch erstellt von der Perfume-Cloud-Team-App</div></td></tr></table></body></html>';

        $pushBody = Util::euro($cur['revenue']) . ($fmtPct(self::pct($cur['revenue'], $prev['revenue']))[0] !== '' ? ' (' . $fmtPct(self::pct($cur['revenue'], $prev['revenue']))[0] . ')' : '') . ' · ' . $cur['orders'] . ' Bestellungen';
        if ($club && isset($club['survey']['avg']) && $club['survey']['avg'] !== null) {
            $pushBody .= ' · Ø ' . number_format((float) $club['survey']['avg'], 1, ',', '.') . ' ★';
        }
        if ($ig && $ig['followers_delta'] !== null) {
            $pushBody .= ' · Instagram ' . ($ig['followers_delta'] >= 0 ? '+' : '−') . abs((int) $ig['followers_delta']);
        }
        if (!empty($mail['configured']) && $mail['current']['median_hours'] !== null) {
            $pushBody .= ' · Antwort in ' . self::hours($mail['current']['median_hours']);
        }
        return [
            'subject' => $subject,
            'text' => $t,
            'html' => $h,
            'push' => ['title' => 'Wochenrückblick ' . $from . '–' . $to, 'body' => $pushBody, 'url' => '/statistik?rueckblick=1', 'tag' => 'weekly'],
        ];
    }

    private static function weekday(string $date): string
    {
        $ts = (int) strtotime($date);
        return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][(int) date('w', $ts)] . ' ' . date('d.m.', $ts);
    }
}
