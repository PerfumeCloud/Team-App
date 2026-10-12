<?php
declare(strict_types=1);

namespace PC;

/**
 * Feiertage (bundesweit + je Bundesland) und Aktionstage für den Shop – für jedes Jahr berechnet.
 * Gleiche Regeln wie web/src/lib/holidays.ts (App); ein Test vergleicht beide.
 */
final class Holidays
{
    public const STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];

    /** Einstellungen: Bundesland ('' = nur bundesweit), Feiertage und Aktionstage an/aus. */
    public static function config(): array
    {
        $state = (string) Settings::get('holiday_state', '');
        return [
            'state' => in_array($state, self::STATES, true) ? $state : '',
            'holidays' => (bool) Settings::get('holidays_on', true),
            'shop' => (bool) Settings::get('shop_days_on', true),
        ];
    }

    public static function easter(int $y): \DateTimeImmutable
    {
        $a = $y % 19;
        $b = intdiv($y, 100);
        $c = $y % 100;
        $d = intdiv($b, 4);
        $e = $b % 4;
        $f = intdiv($b + 8, 25);
        $g = intdiv($b - $f + 1, 3);
        $h = (19 * $a + $b - $d - $g + 15) % 30;
        $i = intdiv($c, 4);
        $k = $c % 4;
        $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
        $m = intdiv($a + 11 * $h + 22 * $l, 451);
        $month = intdiv($h + $l - 7 * $m + 114, 31);
        $day = (($h + $l - 7 * $m + 114) % 31) + 1;
        return new \DateTimeImmutable(sprintf('%04d-%02d-%02d', $y, $month, $day));
    }

    private static function nth(int $y, int $month, int $weekday, int $n): \DateTimeImmutable
    {
        $first = new \DateTimeImmutable(sprintf('%04d-%02d-01', $y, $month));
        $diff = ($weekday - (int) $first->format('w') + 7) % 7 + ($n - 1) * 7;
        return $first->modify("+$diff days");
    }

    /** @return array<int, array{date:string, title:string, type:string}> */
    public static function year(int $year, string $state = '', bool $holidays = true, bool $shop = true): array
    {
        $out = [];
        $e = self::easter($year);
        $fixed = static fn (int $m, int $d) => new \DateTimeImmutable(sprintf('%04d-%02d-%02d', $year, $m, $d));
        $rel = static fn (\DateTimeImmutable $d, int $n) => $d->modify(($n >= 0 ? '+' : '') . $n . ' days');
        $hol = static function (\DateTimeImmutable $d, string $title, ?array $states = null) use (&$out, $state, $holidays): void {
            if ($holidays && ($states === null || in_array($state, $states, true))) {
                $out[] = ['date' => $d->format('Y-m-d'), 'title' => $title, 'type' => 'feiertag'];
            }
        };
        $sh = static function (\DateTimeImmutable $d, string $title) use (&$out, $shop): void {
            if ($shop) {
                $out[] = ['date' => $d->format('Y-m-d'), 'title' => $title, 'type' => 'aktion'];
            }
        };

        $hol($fixed(1, 1), 'Neujahr');
        $hol($rel($e, -2), 'Karfreitag');
        $hol($rel($e, 1), 'Ostermontag');
        $hol($fixed(5, 1), 'Tag der Arbeit');
        $hol($rel($e, 39), 'Christi Himmelfahrt');
        $hol($rel($e, 50), 'Pfingstmontag');
        $hol($fixed(10, 3), 'Tag der Deutschen Einheit');
        $hol($fixed(12, 25), '1. Weihnachtstag');
        $hol($fixed(12, 26), '2. Weihnachtstag');
        $hol($fixed(1, 6), 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
        $hol($fixed(3, 8), 'Internationaler Frauentag', ['BE', 'MV']);
        $hol($e, 'Ostersonntag', ['BB']);
        $hol($rel($e, 49), 'Pfingstsonntag', ['BB']);
        $hol($rel($e, 60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
        $hol($fixed(8, 15), 'Mariä Himmelfahrt', ['SL', 'BY']);
        $hol($fixed(9, 20), 'Weltkindertag', ['TH']);
        $hol($fixed(10, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
        $hol($fixed(11, 1), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
        $nov23 = $fixed(11, 23);
        $back = ((int) $nov23->format('w') - 3 + 7) % 7 ?: 7;
        $hol($rel($nov23, -$back), 'Buß- und Bettag', ['SN']);

        $blackFriday = $rel(self::nth($year, 11, 4, 4), 1);
        $eve = $fixed(12, 24);
        $fourthAdvent = $rel($eve, -(int) $eve->format('w'));
        $sh($fixed(2, 14), 'Valentinstag');
        if ($state !== 'BE' && $state !== 'MV') {
            $sh($fixed(3, 8), 'Weltfrauentag');
        }
        $sh($fixed(3, 21), 'Welttag des Parfums');
        if ($state !== 'BB') {
            $sh($e, 'Ostersonntag');
        }
        $sh(self::nth($year, 5, 0, 2), 'Muttertag');
        $sh($rel($e, 39), 'Vatertag');
        $sh($fixed(11, 11), 'Singles’ Day');
        $sh($rel($blackFriday, -4), 'Start Black Week');
        $sh($blackFriday, 'Black Friday');
        $sh($rel($blackFriday, 3), 'Cyber Monday');
        $sh($rel($fourthAdvent, -21), '1. Advent');
        $sh($fixed(12, 6), 'Nikolaus');
        $sh($eve, 'Heiligabend');
        $sh($fixed(12, 31), 'Silvester');

        usort($out, static fn ($a, $b) => strcmp($a['date'], $b['date']) ?: ($a['type'] === $b['type'] ? 0 : ($a['type'] === 'feiertag' ? -1 : 1)));
        return $out;
    }

    /** Alle Tage zwischen zwei Daten (inklusive) – mit den gespeicherten Einstellungen. */
    public static function between(string $from, string $to, ?array $cfg = null): array
    {
        $cfg ??= self::config();
        $out = [];
        for ($y = (int) substr($from, 0, 4); $y <= (int) substr($to, 0, 4); $y++) {
            foreach (self::year($y, $cfg['state'], $cfg['holidays'], $cfg['shop']) as $d) {
                if ($d['date'] >= $from && $d['date'] <= $to) {
                    $out[] = $d;
                }
            }
        }
        return $out;
    }
}
