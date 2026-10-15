<?php
declare(strict_types=1);

namespace Club;

/**
 * Aktionen mit mehrfachen Punkten (z. B. „Launch-Woche: doppelte Punkte“).
 * Es zählt das Bestelldatum: Bestellungen im Aktionszeitraum bekommen den Faktor dauerhaft.
 * Beim Start geht auf Wunsch eine Push-Nachricht an alle Mitglieder.
 */
final class Promotions
{
    private static ?array $cache = null;

    /** Alle (nicht gelöschten) Aktionen. */
    public static function all(): array
    {
        if (self::$cache === null) {
            self::$cache = Db::all('SELECT * FROM club_promotions WHERE deleted = 0 ORDER BY starts_at DESC');
        }
        return self::$cache;
    }

    private static function reset(): void
    {
        self::$cache = null;
    }

    /** [Faktor, Aktions-ID] für ein Bestelldatum – bei Überschneidung zählt der höchste Faktor. */
    public static function factorAt(int $at): array
    {
        $best = [1.0, null];
        foreach (self::all() as $p) {
            if ((int) $p['starts_at'] <= $at && $at < (int) $p['ends_at'] && (float) $p['factor'] > $best[0]) {
                $best = [(float) $p['factor'], $p['id']];
            }
        }
        return $best;
    }

    public static function publicRow(array $p): array
    {
        return [
            'id' => $p['id'],
            'name' => $p['name'],
            'factor' => (float) $p['factor'],
            'starts_at' => (int) $p['starts_at'],
            'ends_at' => (int) $p['ends_at'],
        ];
    }

    public static function publicActive(?int $now = null): ?array
    {
        $now ??= Util::now();
        [$factor, $id] = self::factorAt($now);
        if ($id === null) {
            return null;
        }
        foreach (self::all() as $p) {
            if ($p['id'] === $id) {
                return self::publicRow($p);
            }
        }
        return null;
    }

    /** Nächste geplante Aktion (für „Bald: doppelte Punkte“). */
    public static function publicNext(?int $now = null): ?array
    {
        $now ??= Util::now();
        $next = null;
        foreach (self::all() as $p) {
            if ((int) $p['starts_at'] > $now && ($next === null || (int) $p['starts_at'] < (int) $next['starts_at'])) {
                $next = $p;
            }
        }
        return $next ? self::publicRow($next) : null;
    }

    public static function adminList(): array
    {
        $now = Util::now();
        return array_map(static function ($p) use ($now) {
            $orders = Db::one('SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS pts, COALESCE(SUM(amount_cents), 0) AS cents FROM club_orders WHERE promo_id = ? AND status <> ?', [$p['id'], 'void']);
            return self::publicRow($p) + [
                'push' => (bool) $p['push'],
                'push_title' => $p['push_title'],
                'push_body' => $p['push_body'],
                'pushed_at' => $p['pushed_at'] !== null ? (int) $p['pushed_at'] : null,
                'state' => $now < (int) $p['starts_at'] ? 'planned' : ($now < (int) $p['ends_at'] ? 'running' : 'done'),
                'orders' => (int) $orders['n'],
                'points' => (int) $orders['pts'],
                'revenue_cents' => (int) $orders['cents'],
            ];
        }, self::all());
    }

    public static function save(array $admin, array $in, ?string $id = null): array
    {
        $name = Util::str($in['name'] ?? '', 100, false);
        if ($name === '') {
            throw new HttpError(422, 'Bitte einen Namen für die Aktion angeben, z. B. „Launch-Woche“.');
        }
        $factor = $in['factor'] ?? 2;
        if (!is_numeric($factor) || (float) $factor < 1.1 || (float) $factor > 10) {
            throw new HttpError(422, 'Der Faktor muss zwischen 1,1 und 10 liegen (2 = doppelte Punkte).');
        }
        $starts = (int) ($in['starts_at'] ?? 0);
        $ends = (int) ($in['ends_at'] ?? 0);
        if ($starts <= 0 || $ends <= $starts) {
            throw new HttpError(422, 'Bitte Start und Ende angeben. Das Ende muss nach dem Start liegen.');
        }
        if ($ends - $starts > 92 * Points::DAY_MS) {
            throw new HttpError(422, 'Eine Aktion kann höchstens drei Monate dauern.');
        }
        $now = Util::now();
        $row = [
            'name' => $name,
            'factor' => round((float) $factor, 2),
            'starts_at' => $starts,
            'ends_at' => $ends,
            'push' => !empty($in['push']) ? 1 : 0,
            'push_title' => Util::str($in['push_title'] ?? null, 120),
            'push_body' => Util::str($in['push_body'] ?? null, 300),
            'updated_at' => $now,
        ];
        if ($id) {
            $old = Db::one('SELECT * FROM club_promotions WHERE id = ? AND deleted = 0', [$id]);
            if (!$old) {
                throw new HttpError(404, 'Aktion nicht gefunden.');
            }
            // Bestellungen, die schon mit dem Faktor gezählt wurden, behalten ihn
            Db::update('club_promotions', $row, ['id' => $id]);
        } else {
            $id = Util::uuid();
            Db::insert('club_promotions', $row + ['id' => $id, 'pushed_at' => null, 'created_by' => $admin['id'], 'created_at' => $now, 'deleted' => 0]);
        }
        self::reset();
        ShopSync::markDirty();
        self::runStarts();
        return self::adminList();
    }

    public static function delete(string $id): array
    {
        Db::exec('UPDATE club_promotions SET deleted = 1, updated_at = ? WHERE id = ?', [Util::now(), $id]);
        self::reset();
        ShopSync::markDirty();
        return self::adminList();
    }

    /** Push zum Start einer Aktion (einmal je Aktion, an alle Mitglieder mit „Aktionen & Neuheiten“). */
    public static function runStarts(): string
    {
        $now = Util::now();
        $n = 0;
        foreach (Db::all('SELECT * FROM club_promotions WHERE deleted = 0 AND push = 1 AND pushed_at IS NULL AND starts_at <= ? AND ends_at > ?', [$now, $now]) as $p) {
            if (Db::exec('UPDATE club_promotions SET pushed_at = ? WHERE id = ? AND pushed_at IS NULL', [$now, $p['id']]) !== 1) {
                continue;
            }
            $vars = [
                'aktion' => $p['name'],
                'faktor' => self::factorText((float) $p['factor']),
                'datum' => date('d.m.Y', intdiv((int) $p['ends_at'], 1000)),
            ];
            $custom = $p['push_title'] || $p['push_body'] ? ['title' => $p['push_title'], 'body' => $p['push_body']] : null;
            foreach (Push::recipients('news') as $m) {
                $n += Push::queue($m, 'promo_start', $vars, 'promo:' . $p['id'] . ':' . $m['id'], null, $custom) ? 1 : 0;
            }
        }
        return "$n Push-Nachrichten zu Aktionen";
    }

    /** 2 → „doppelte“, 3 → „dreifache“, 1.5 → „1,5-fache“ */
    public static function factorText(float $f): string
    {
        $words = [2 => 'doppelte', 3 => 'dreifache', 4 => 'vierfache', 5 => 'fünffache'];
        if (abs($f - round($f)) < 0.001 && isset($words[(int) round($f)])) {
            return $words[(int) round($f)];
        }
        return rtrim(rtrim(number_format($f, 2, ',', ''), '0'), ',') . '-fache';
    }
}
