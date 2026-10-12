<?php
declare(strict_types=1);

namespace PC;

/**
 * Team-Kalender: Termine, Meetings, Events und Fristen.
 *
 * Datum und Uhrzeit werden als Ortszeit (Europe/Berlin) gespeichert: start_date „2026-10-16“,
 * start_time „14:00“ oder null für ganztägig. Alle im Team sehen alle Termine; Teilnehmer
 * (leer = ganzes Team) bekommen Einladungen und Erinnerungen per Push.
 * Über einen persönlichen Abo-Link lässt sich der Kalender in Apple-Kalender, Outlook & Co. abonnieren.
 */
final class Calendar
{
    public const KINDS = ['termin', 'meeting', 'event', 'frist'];
    public const REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];
    private const KIND_LABEL = ['termin' => 'Termin', 'meeting' => 'Meeting', 'event' => 'Event', 'frist' => 'Frist'];
    private const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    // ---------- Speichern ----------

    public static function save(array $me, string $id, array $in): array
    {
        if (!Util::isUuid($id)) {
            throw new HttpError(422, 'Ungültige ID.');
        }
        $title = Util::str($in['title'] ?? '', 300, false);
        if ($title === '') {
            throw new HttpError(422, 'Bitte einen Titel für den Termin eingeben.');
        }
        $startDate = self::date($in['start_date'] ?? null);
        if ($startDate === null) {
            throw new HttpError(422, 'Bitte ein gültiges Datum angeben.');
        }
        $startTime = self::time($in['start_time'] ?? null);
        $endDate = self::date($in['end_date'] ?? null);
        if ($endDate !== null && $endDate < $startDate) {
            $endDate = null;
        }
        $endTime = $startTime === null ? null : self::time($in['end_time'] ?? null);
        if ($endTime !== null && ($endDate ?? $startDate) === $startDate && $endTime <= $startTime) {
            $endTime = null;
        }
        if ($endDate === $startDate && $endTime === null) {
            $endDate = null;
        }
        $userIds = array_column(Db::all('SELECT id FROM users WHERE deleted = 0'), 'id');
        $attendees = array_values(array_unique(array_intersect(array_filter((array) ($in['attendees'] ?? []), 'is_string'), $userIds)));
        $remind = $in['remind_minutes'] ?? null;
        $remind = $remind === null || $remind === '' ? null : (in_array((int) $remind, self::REMINDERS, true) ? (int) $remind : null);

        return Db::tx(function () use ($me, $id, $in, $title, $startDate, $startTime, $endDate, $endTime, $attendees, $remind) {
            $old = Db::one('SELECT * FROM events WHERE id = ?', [$id]);
            $now = max(Util::now(), $old ? (int) $old['updated_at'] + 1 : 0);
            $row = [
                'id' => $id,
                'title' => $title,
                'kind' => Util::oneOf($in['kind'] ?? null, self::KINDS, 'termin'),
                'start_date' => $startDate,
                'start_time' => $startTime,
                'end_date' => $endDate,
                'end_time' => $endTime,
                'location' => Util::str($in['location'] ?? null, 300),
                'notes' => Util::str($in['notes'] ?? null, 20000),
                'attendees' => Util::json($attendees),
                'remind_minutes' => $remind,
                'updated_by' => $me['id'],
                'updated_at' => $now,
                'deleted' => 0,
            ];
            // Erinnerung neu planen, wenn sich Zeit oder Vorlauf ändern
            $row['reminded_at'] = $old && $old['start_date'] === $startDate && $old['start_time'] === $startTime
                && (string) $old['remind_minutes'] === (string) $remind ? $old['reminded_at'] : null;
            if ($old) {
                Db::update('events', $row, ['id' => $id]);
            } else {
                $row['created_by'] = $me['id'];
                $row['created_at'] = $now;
                Db::insert('events', $row);
                Activity::log($me['id'], 'event_created', 'event', $id, "hat „{$title}“ am " . self::shortDate($startDate) . ' in den Kalender eingetragen');
            }

            // Einladung an neu hinzugefügte Teilnehmer
            $before = $old ? (json_decode((string) $old['attendees'], true) ?: []) : [];
            $invited = array_values(array_diff($attendees, $before, [$me['id']]));
            if ($invited) {
                $name = explode(' ', trim($me['name']))[0];
                $when = self::when($row);
                Http::defer(static fn () => Notify::users($invited, 'events', [
                    'title' => "{$name} hat dich eingetragen: {$title}",
                    'body' => $when . ($row['location'] ? ' · ' . $row['location'] : ''),
                    'url' => '/kalender?d=' . $startDate,
                    'tag' => "event-$id",
                ]));
            }
            return self::row(Db::one('SELECT * FROM events WHERE id = ?', [$id]));
        });
    }

    public static function row(array $r): array
    {
        return [
            'id' => $r['id'],
            'title' => $r['title'],
            'kind' => $r['kind'],
            'start_date' => $r['start_date'],
            'start_time' => $r['start_time'],
            'end_date' => $r['end_date'],
            'end_time' => $r['end_time'],
            'location' => $r['location'],
            'notes' => $r['notes'],
            'attendees' => json_decode((string) $r['attendees'], true) ?: [],
            'remind_minutes' => $r['remind_minutes'] !== null ? (int) $r['remind_minutes'] : null,
            'created_by' => $r['created_by'],
            'updated_by' => $r['updated_by'],
            'created_at' => (int) $r['created_at'],
            'updated_at' => (int) $r['updated_at'],
            'deleted' => (int) $r['deleted'],
        ];
    }

    // ---------- Erinnerungen (Cronjob) ----------

    /** Schickt fällige Erinnerungen. Läuft alle 5 Minuten mit den übrigen Hintergrundaufgaben. */
    public static function remind(?int $now = null): string
    {
        $now ??= Util::now();
        $from = date('Y-m-d', intdiv($now, 1000) - 86400);
        $to = date('Y-m-d', intdiv($now, 1000) + 3 * 86400);
        $rows = Db::all(
            'SELECT * FROM events WHERE deleted = 0 AND remind_minutes IS NOT NULL AND reminded_at IS NULL AND start_date >= ? AND start_date <= ?',
            [$from, $to]
        );
        $sent = 0;
        foreach ($rows as $e) {
            [$at, $until] = self::reminderWindow($e);
            if ($now < $at) {
                continue;
            }
            if ($now <= $until) {
                $attendees = json_decode((string) $e['attendees'], true) ?: null;
                $sent += Notify::users($attendees, 'events', [
                    'title' => self::reminderTitle($e, $now) . ': ' . $e['title'],
                    'body' => self::when($e, false) . ($e['location'] ? ' · ' . $e['location'] : ''),
                    'url' => '/kalender?d=' . $e['start_date'],
                    'tag' => 'event-' . $e['id'],
                ]);
            }
            Db::update('events', ['reminded_at' => $now], ['id' => $e['id']]);
        }
        return "$sent Termin-Erinnerungen";
    }

    /** @return array{0:int,1:int} Zeitpunkt der Erinnerung und bis wann sie noch sinnvoll ist (ms). */
    public static function reminderWindow(array $e): array
    {
        $remind = (int) $e['remind_minutes'];
        if ($e['start_time']) {
            $start = self::ts($e['start_date'], $e['start_time']);
            return [$start - $remind * 60000, $start + 15 * 60000];
        }
        // Ganztägig: um 8 Uhr am Tag selbst bzw. so viele Tage vorher
        $start = self::ts($e['start_date'], '08:00');
        return [$start - intdiv($remind, 1440) * 86400000, $start + 14 * 3600000];
    }

    private static function reminderTitle(array $e, int $now): string
    {
        $today = date('Y-m-d', intdiv($now, 1000));
        if ($e['start_date'] === $today) {
            if (!$e['start_time']) {
                return 'Heute';
            }
            $min = (int) round((self::ts($e['start_date'], $e['start_time']) - $now) / 60000);
            return $min <= 1 ? 'Jetzt' : ($min < 60 ? "In {$min} Min." : 'Heute ' . $e['start_time']);
        }
        if ($e['start_date'] === date('Y-m-d', intdiv($now, 1000) + 86400)) {
            return 'Morgen' . ($e['start_time'] ? ' ' . $e['start_time'] : '');
        }
        return self::shortDate($e['start_date']);
    }

    // ---------- Abo-Link (iCalendar) ----------

    public static function createToken(array $user): string
    {
        $token = 'pck_' . Crypto::randomKey(24);
        $tokens = Settings::get('calendar_tokens', []);
        $tokens = is_array($tokens) ? $tokens : [];
        $tokens[$user['id']] = hash('sha256', $token);
        Settings::set('calendar_tokens', $tokens);
        return $token;
    }

    public static function revoke(array $user): void
    {
        $tokens = Settings::get('calendar_tokens', []);
        if (is_array($tokens)) {
            unset($tokens[$user['id']]);
            Settings::set('calendar_tokens', $tokens);
        }
    }

    public static function hasToken(array $user): bool
    {
        $tokens = Settings::get('calendar_tokens', []);
        return is_array($tokens) && isset($tokens[$user['id']]);
    }

    public static function userForToken(string $token): ?array
    {
        if (!str_starts_with($token, 'pck_')) {
            return null;
        }
        $hash = hash('sha256', $token);
        foreach ((array) Settings::get('calendar_tokens', []) as $userId => $stored) {
            if (is_string($stored) && hash_equals($stored, $hash)) {
                return Db::one('SELECT * FROM users WHERE id = ? AND deleted = 0', [$userId]);
            }
        }
        return null;
    }

    /** Kalender als iCalendar-Datei (RFC 5545) – für Apple-Kalender, Outlook, Google Kalender. */
    public static function ics(array $user): string
    {
        $from = date('Y-m-d', time() - 90 * 86400);
        $rows = Db::all('SELECT * FROM events WHERE deleted = 0 AND (start_date >= ? OR end_date >= ?) ORDER BY start_date', [$from, $from]);
        $names = [];
        foreach (Db::all('SELECT id, name FROM users') as $u) {
            $names[$u['id']] = explode(' ', trim($u['name']))[0];
        }
        $host = parse_url(Util::baseUrl(), PHP_URL_HOST) ?: 'perfumecloud.de';
        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Perfume Cloud//Team-App//DE',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:Perfume Cloud Team',
            'X-WR-TIMEZONE:Europe/Berlin',
            'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
            'X-PUBLISHED-TTL:PT15M',
        ];
        foreach ($rows as $e) {
            $attendees = json_decode((string) $e['attendees'], true) ?: [];
            $who = $attendees ? implode(', ', array_map(static fn ($id) => $names[$id] ?? '?', $attendees)) : 'ganzes Team';
            $desc = trim(($e['notes'] ? $e['notes'] . "\n\n" : '') . 'Wer: ' . $who);
            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:' . $e['id'] . '@' . $host;
            $lines[] = 'DTSTAMP:' . gmdate('Ymd\THis\Z', intdiv((int) $e['updated_at'], 1000));
            $lines[] = 'LAST-MODIFIED:' . gmdate('Ymd\THis\Z', intdiv((int) $e['updated_at'], 1000));
            if ($e['start_time']) {
                $start = self::ts($e['start_date'], $e['start_time']);
                $end = $e['end_time'] ? self::ts($e['end_date'] ?: $e['start_date'], $e['end_time']) : $start + 3600000;
                $lines[] = 'DTSTART:' . gmdate('Ymd\THis\Z', intdiv($start, 1000));
                $lines[] = 'DTEND:' . gmdate('Ymd\THis\Z', intdiv(max($end, $start + 60000), 1000));
            } else {
                $endDay = (new \DateTimeImmutable($e['end_date'] ?: $e['start_date']))->modify('+1 day')->format('Ymd');
                $lines[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', $e['start_date']);
                $lines[] = 'DTEND;VALUE=DATE:' . $endDay;
            }
            $lines[] = 'SUMMARY:' . self::esc($e['title']);
            if ($e['location']) {
                $lines[] = 'LOCATION:' . self::esc($e['location']);
            }
            $lines[] = 'DESCRIPTION:' . self::esc($desc);
            $lines[] = 'CATEGORIES:' . (self::KIND_LABEL[$e['kind']] ?? 'Termin');
            if ($e['remind_minutes'] !== null) {
                $lines[] = 'BEGIN:VALARM';
                $lines[] = 'ACTION:DISPLAY';
                $lines[] = 'DESCRIPTION:' . self::esc($e['title']);
                $lines[] = 'TRIGGER:-PT' . (int) $e['remind_minutes'] . 'M';
                $lines[] = 'END:VALARM';
            }
            $lines[] = 'END:VEVENT';
        }
        // Aktionstage (Black Friday, Muttertag …) – gesetzliche Feiertage hat die Kalender-App meist schon selbst
        $cfg = Holidays::config();
        foreach (Holidays::between($from, date('Y-m-d', time() + 400 * 86400), ['state' => $cfg['state'], 'holidays' => false, 'shop' => $cfg['shop']]) as $d) {
            $next = (new \DateTimeImmutable($d['date']))->modify('+1 day')->format('Ymd');
            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:aktion-' . $d['date'] . '-' . substr(sha1($d['title']), 0, 8) . '@' . $host;
            $lines[] = 'DTSTAMP:' . gmdate('Ymd\THis\Z', strtotime(substr($d['date'], 0, 4) . '-01-01'));
            $lines[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', $d['date']);
            $lines[] = 'DTEND;VALUE=DATE:' . $next;
            $lines[] = 'SUMMARY:' . self::esc('🛍 ' . $d['title']);
            $lines[] = 'CATEGORIES:Aktionstag';
            $lines[] = 'TRANSP:TRANSPARENT';
            $lines[] = 'END:VEVENT';
        }
        $lines[] = 'END:VCALENDAR';
        return implode("\r\n", array_map([self::class, 'fold'], $lines)) . "\r\n";
    }

    // ---------- Für das Widget ----------

    /** Nächste Termine dieser Person (eingetragen oder fürs ganze Team), ab heute. */
    public static function upcoming(array $user, int $days = 14, int $limit = 8): array
    {
        $today = date('Y-m-d');
        $until = date('Y-m-d', time() + $days * 86400);
        $nowTime = date('H:i');
        $out = [];
        foreach (Db::all('SELECT * FROM events WHERE deleted = 0 AND ((start_date >= ? AND start_date <= ?) OR (end_date >= ? AND start_date < ?)) ORDER BY start_date, start_time', [$today, $until, $today, $today]) as $e) {
            $att = json_decode((string) $e['attendees'], true) ?: [];
            if ($att && !in_array($user['id'], $att, true)) {
                continue;
            }
            // Heute schon vorbei?
            $endTime = $e['end_time'] ?? $e['start_time'];
            if ($e['start_date'] === $today && !$e['end_date'] && $endTime && $endTime < $nowTime) {
                continue;
            }
            $out[] = [
                'title' => $e['title'],
                'kind' => $e['kind'],
                'date' => $e['start_date'],
                'start' => $e['start_time'],
                'end' => $e['end_time'],
                'endDate' => $e['end_date'],
                'location' => $e['location'],
            ];
        }
        // Feiertage und Aktionstage der nächsten 7 Tage einsortieren
        foreach (Holidays::between($today, min($until, date('Y-m-d', time() + 7 * 86400))) as $d) {
            $out[] = ['title' => $d['title'], 'kind' => $d['type'], 'date' => $d['date'], 'start' => null, 'end' => null, 'endDate' => null, 'location' => null];
        }
        usort($out, static fn ($a, $b) => strcmp($a['date'], $b['date']) ?: strcmp((string) $a['start'], (string) $b['start']));
        return array_slice($out, 0, $limit);
    }

    // ---------- Hilfen ----------

    private static function date(mixed $v): ?string
    {
        if (!is_string($v) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }
        return $v;
    }

    private static function time(mixed $v): ?string
    {
        if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $v)) {
            return null;
        }
        return $v;
    }

    /** Ortszeit (Berlin) → Millisekunden. */
    public static function ts(string $date, string $time): int
    {
        return (new \DateTimeImmutable("$date $time:00", new \DateTimeZone('Europe/Berlin')))->getTimestamp() * 1000;
    }

    private static function shortDate(string $date): string
    {
        $t = strtotime($date . ' 12:00');
        return self::WEEKDAYS[(int) date('w', $t)] . ', ' . date('j.n.', $t);
    }

    /** „Fr, 16.10. · 14:00–15:00“ bzw. „Fr, 16.10. · ganztägig“ */
    private static function when(array $e, bool $withDate = true): string
    {
        $time = $e['start_time'] ? $e['start_time'] . ($e['end_time'] ? '–' . $e['end_time'] : ' Uhr') : 'ganztägig';
        $range = $e['end_date'] && $e['end_date'] !== $e['start_date'] ? ' bis ' . self::shortDate($e['end_date']) : '';
        return ($withDate ? self::shortDate($e['start_date']) . $range . ' · ' : '') . $time;
    }

    private static function esc(string $s): string
    {
        return str_replace(["\\", ';', ',', "\r\n", "\n"], ['\\\\', '\;', '\,', '\n', '\n'], $s);
    }

    /** Zeilen nach 75 Bytes umbrechen (RFC 5545), ohne UTF-8-Zeichen zu zerteilen. */
    private static function fold(string $line): string
    {
        if (strlen($line) <= 75) {
            return $line;
        }
        $out = '';
        $cur = '';
        foreach (mb_str_split($line) as $ch) {
            if (strlen($cur) + strlen($ch) > ($out === '' ? 75 : 74)) {
                $out .= ($out === '' ? '' : "\r\n ") . $cur;
                $cur = '';
            }
            $cur .= $ch;
        }
        return $out . "\r\n " . $cur;
    }
}
