<?php
declare(strict_types=1);

namespace Club;

/**
 * Verfall von Punkten.
 *
 * Jede Gutschrift ist ein „Los“ mit Ablaufdatum (Gutschrift + points_expiry_months, oder ein eigenes Datum,
 * z. B. beim Startbonus). Abbuchungen verbrauchen zuerst die Punkte, die am frühesten ablaufen – das ist für
 * Mitglieder am günstigsten. Wird ein Code zurückgegeben, kommen die Punkte mit ihrem alten Ablaufdatum zurück
 * (mindestens noch 30 Tage), damit sich Punkte nicht durch Einlösen und Zurückgeben verlängern lassen.
 *
 * Was nach dieser Rechnung abgelaufen ist und noch nicht verbucht wurde, wird täglich als „expire“ gebucht.
 */
final class Expiry
{
    private const GRACE_MS = 30 * 86400 * 1000;

    public static function addMonths(int $ms, int $months): int
    {
        if ($months <= 0) {
            return PHP_INT_MAX;
        }
        return (new \DateTimeImmutable('@' . intdiv($ms, 1000)))->modify("+$months months")->getTimestamp() * 1000;
    }

    /**
     * Restpunkte je Los nach allen Buchungen.
     * @return array<int, array{exp:int, left:int, at:int}>
     */
    public static function lots(string $memberId, ?array $p = null): array
    {
        $p ??= Points::program();
        $months = (int) $p['points_expiry_months'];
        $events = [];
        foreach (Db::all("SELECT order_id, points, available_at, ordered_at FROM club_orders WHERE member_id = ? AND status = 'available' AND points > 0", [$memberId]) as $o) {
            $at = (int) ($o['available_at'] ?? $o['ordered_at']);
            $events[] = ['t' => $at, 'o' => 0, 'type' => 'credit', 'n' => (int) $o['points'], 'exp' => self::addMonths($at, $months)];
        }
        foreach (Db::all("SELECT * FROM club_ledger WHERE member_id = ? AND status = 'available' AND points <> 0", [$memberId]) as $l) {
            $at = (int) ($l['credited_at'] ?? $l['created_at']);
            $n = (int) $l['points'];
            if ($l['kind'] === 'refund') {
                $events[] = ['t' => $at, 'o' => 0, 'type' => 'refund', 'n' => $n, 'ref' => (string) $l['ref']];
            } elseif ($n > 0) {
                $exp = $l['expires_at'] !== null ? (int) $l['expires_at'] : self::addMonths($at, $months);
                $events[] = ['t' => $at, 'o' => 0, 'type' => 'credit', 'n' => $n, 'exp' => $exp];
            } else {
                $events[] = ['t' => $at, 'o' => 1, 'type' => 'debit', 'n' => -$n, 'ref' => (string) ($l['kind'] === 'redeem' ? $l['ref'] : '')];
            }
        }
        // Zeitlich sortiert, bei gleicher Zeit Gutschriften zuerst
        usort($events, static fn ($a, $b) => [$a['t'], $a['o']] <=> [$b['t'], $b['o']]);

        $lots = [];
        $taken = []; // ref → [[lot, Punkte], …]
        $debt = 0;
        foreach ($events as $e) {
            if ($e['type'] === 'credit') {
                $n = $e['n'];
                if ($debt > 0) {
                    $use = min($debt, $n);
                    $debt -= $use;
                    $n -= $use;
                }
                $lots[] = ['exp' => $e['exp'], 'left' => $n, 'at' => $e['t']];
                continue;
            }
            if ($e['type'] === 'refund') {
                $back = $e['n'];
                foreach ($taken[$e['ref']] ?? [] as [$li, $amount]) {
                    if ($back <= 0) {
                        break;
                    }
                    $give = min($back, $amount);
                    $lots[] = ['exp' => max($lots[$li]['exp'], $e['t'] + self::GRACE_MS), 'left' => $give, 'at' => $e['t']];
                    $back -= $give;
                }
                if ($back > 0) {
                    $lots[] = ['exp' => self::addMonths($e['t'], $months), 'left' => $back, 'at' => $e['t']];
                }
                unset($taken[$e['ref']]);
                continue;
            }
            // Abbuchung: früheste Ablaufdaten zuerst
            $need = $e['n'];
            $order = array_keys($lots);
            usort($order, static fn ($a, $b) => [$lots[$a]['exp'], $a] <=> [$lots[$b]['exp'], $b]);
            foreach ($order as $li) {
                if ($need <= 0) {
                    break;
                }
                if ($lots[$li]['left'] <= 0) {
                    continue;
                }
                $use = min($need, $lots[$li]['left']);
                $lots[$li]['left'] -= $use;
                $need -= $use;
                if ($e['ref'] !== '') {
                    $taken[$e['ref']][] = [$li, $use];
                }
            }
            $debt += $need;
        }
        return array_values(array_filter($lots, static fn ($l) => $l['left'] > 0));
    }

    /** Nächster Verfall innerhalb der Warnfrist (für die App): {points, at} oder null. */
    public static function next(string $memberId, ?int $now = null, ?int $withinDays = null): ?array
    {
        $p = Points::program();
        if ((int) $p['points_expiry_months'] <= 0 && !Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND status = 'available' AND expires_at IS NOT NULL", [$memberId])) {
            return null;
        }
        $now ??= Util::now();
        $within = ($withinDays ?? max(30, ...(Points::warnDays($p) ?: [30]))) * Points::DAY_MS;
        $first = null;
        $lots = self::lots($memberId, $p);
        foreach ($lots as $l) {
            if ($l['exp'] > $now && $l['exp'] <= $now + $within && ($first === null || $l['exp'] < $first)) {
                $first = $l['exp'];
            }
        }
        if ($first === null) {
            return null;
        }
        // alles, was bis zum Ende dieses Tages verfällt
        $dayEnd = (int) (strtotime(date('Y-m-d 23:59:59', intdiv($first, 1000))) * 1000);
        $sum = 0;
        foreach ($lots as $l) {
            if ($l['exp'] > $now && $l['exp'] <= $dayEnd) {
                $sum += $l['left'];
            }
        }
        return $sum > 0 ? ['points' => $sum, 'at' => $first] : null;
    }

    /** Fällige Punkte eines Mitglieds verbuchen. Gibt die verfallenen Punkte zurück. */
    public static function expireMember(string $memberId, ?int $now = null): int
    {
        $now ??= Util::now();
        $due = 0;
        foreach (self::lots($memberId) as $l) {
            if ($l['exp'] <= $now) {
                $due += $l['left'];
            }
        }
        // Nie unter null: nur so viel, wie wirklich auf dem Konto ist
        $due = min($due, max(0, Points::balance($memberId)));
        if ($due <= 0) {
            return 0;
        }
        Points::book($memberId, 'expire', -$due, $due === 1 ? '1 Punkt war älter als erlaubt' : "$due Punkte waren älter als erlaubt");
        return $due;
    }

    /**
     * Täglich: Punkte verfallen lassen und vorher daran erinnern – je Stufe der Liste einmal (Standard 60 und 30 Tage
     * vorher). Liegt der Verfall schon näher als die erste Stufe, kommt nur die nächste passende Erinnerung.
     */
    public static function run(?int $now = null): string
    {
        $now ??= Util::now();
        $p = Points::program();
        $expiring = (int) $p['points_expiry_months'] > 0 || Db::value("SELECT 1 FROM club_ledger WHERE expires_at IS NOT NULL AND status = 'available'");
        if (!$expiring) {
            return 'Punkte verfallen nicht';
        }
        $expired = 0;
        $warned = 0;
        $stages = Points::warnDays($p);
        foreach (Db::all('SELECT id FROM club_members WHERE joined_at IS NOT NULL') as $m) {
            $expired += self::expireMember($m['id'], $now);
            if ($stages) {
                $warned += self::remind($m['id'], $now, $stages, $p) ? 1 : 0;
            }
        }
        return "$expired Punkte verfallen, $warned Erinnerungen";
    }

    /** Erinnerung für den nächsten Verfall, wenn eine Stufe (z. B. 60 Tage vorher) erreicht ist. */
    public static function remind(string $memberId, int $now, array $stages, ?array $p = null): bool
    {
        $next = self::next($memberId, $now, max($stages));
        if (!$next) {
            return false;
        }
        $daysLeft = (int) ceil(($next['at'] - $now) / Points::DAY_MS);
        $stage = null;
        foreach ($stages as $d) {
            if ($daysLeft <= $d) {
                $stage = $d; // kleinste passende Stufe (Liste ist absteigend)
            }
        }
        if ($stage === null) {
            return false;
        }
        return Push::queue($memberId, 'points_expiring', [
            'punkte' => number_format($next['points'], 0, ',', '.'),
            'euro' => Util::euro(Points::worth($next['points'], $p)),
            'datum' => date('d.m.Y', intdiv($next['at'], 1000)),
            'tage' => (string) $daysLeft,
        ], 'expwarn:' . $memberId . ':' . date('Y-m-d', intdiv($next['at'], 1000)) . ':' . $stage);
    }
}
