<?php
declare(strict_types=1);

namespace Club;

/**
 * Mitgliedsstufen Bronze, Silber, Gold.
 *
 * Maßgeblich ist der Warenwert der bezahlten Bestellungen in den letzten tier_months Monaten.
 * Wer eine höhere Stufe erreicht, steigt sofort auf und behält sie mindestens tier_months Monate.
 * Danach wird neu gerechnet; abgestiegen wird erst, wenn die Stufe abgelaufen ist.
 */
final class Tiers
{
    public const KEYS = ['bronze', 'silber', 'gold'];

    /** Stufen aus den Einstellungen, immer genau drei, aufsteigend. */
    public static function normalize(mixed $tiers, float $base): array
    {
        $defaults = Points::DEFAULTS['tiers'];
        $byKey = [];
        foreach (is_array($tiers) ? $tiers : [] as $t) {
            if (is_array($t) && in_array($t['key'] ?? '', self::KEYS, true)) {
                $byKey[$t['key']] = $t;
            }
        }
        $out = [];
        foreach ($defaults as $i => $d) {
            $t = ($byKey[$d['key']] ?? []) + $d;
            $out[] = [
                'key' => $d['key'],
                'name' => (string) $t['name'],
                'min_cents' => $i === 0 ? 0 : max(0, (int) $t['min_cents']),
                'rate' => $i === 0 ? $base : (float) $t['rate'],
                'benefits' => array_values(array_filter(array_map('strval', is_array($t['benefits']) ? $t['benefits'] : []), static fn ($b) => trim($b) !== '')),
            ];
        }
        return $out;
    }

    /** Eingaben aus dem Admin-Bereich prüfen. */
    public static function validate(array $in, array $current): array
    {
        $byKey = [];
        foreach ($in as $t) {
            if (is_array($t) && in_array($t['key'] ?? '', self::KEYS, true)) {
                $byKey[$t['key']] = $t;
            }
        }
        $out = [];
        foreach ($current as $i => $cur) {
            $t = $byKey[$cur['key']] ?? [];
            $name = Util::str($t['name'] ?? $cur['name'], 30, false);
            $rate = $t['rate'] ?? $cur['rate'];
            $min = $t['min_cents'] ?? $cur['min_cents'];
            if (!is_numeric($rate) || (float) $rate < 0 || (float) $rate > 100) {
                throw new HttpError(422, 'Ungültige Punkte je Euro für ' . $cur['name'] . '.');
            }
            if (!is_numeric($min) || (int) $min < 0 || (int) $min > 100000000) {
                throw new HttpError(422, 'Ungültiger Umsatz für ' . $cur['name'] . '.');
            }
            $benefits = [];
            foreach (is_array($t['benefits'] ?? null) ? $t['benefits'] : $cur['benefits'] as $b) {
                $b = Util::str($b, 120);
                if ($b !== null) {
                    $benefits[] = $b;
                }
            }
            $out[] = [
                'key' => $cur['key'],
                'name' => $name !== '' ? $name : $cur['name'],
                'min_cents' => $i === 0 ? 0 : (int) $min,
                'rate' => round((float) $rate, 2),
                'benefits' => array_slice($benefits, 0, 8),
            ];
        }
        for ($i = 1; $i < count($out); $i++) {
            if ($out[$i]['min_cents'] <= $out[$i - 1]['min_cents']) {
                throw new HttpError(422, $out[$i]['name'] . ' braucht einen höheren Umsatz als ' . $out[$i - 1]['name'] . '.');
            }
        }
        return $out;
    }

    public static function list(?array $p = null): array
    {
        return ($p ?? Points::program())['tiers'];
    }

    private static function index(string $key, array $tiers): int
    {
        foreach ($tiers as $i => $t) {
            if ($t['key'] === $key) {
                return $i;
            }
        }
        return 0;
    }

    /** Aktuelle Stufe eines Mitglieds. Ohne Stufen: immer die Grundstufe. */
    public static function of(array $member, ?array $p = null): array
    {
        $p ??= Points::program();
        $tiers = $p['tiers'];
        if (!$p['tiers_enabled']) {
            return $tiers[0];
        }
        return $tiers[self::index((string) ($member['tier'] ?? 'bronze'), $tiers)];
    }

    /** Punkte je Euro für neue Bestellungen. */
    public static function rate(array $member, ?array $p = null): float
    {
        $p ??= Points::program();
        return $p['tiers_enabled'] ? (float) self::of($member, $p)['rate'] : (float) $p['earn_per_euro'];
    }

    /** Warenwert der bezahlten Bestellungen im Zeitraum (in Cent). */
    public static function spend(string $memberId, ?int $now = null, ?array $p = null): int
    {
        $p ??= Points::program();
        $now ??= Util::now();
        $since = (new \DateTimeImmutable('@' . intdiv($now, 1000)))->modify('-' . (int) $p['tier_months'] . ' months')->getTimestamp() * 1000;
        return (int) Db::value(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM club_orders WHERE member_id = ? AND ordered_at >= ?
             AND (status = 'available' OR (status = 'pending' AND reason IN ('shipping', 'wait')))",
            [$memberId, $since]
        );
    }

    /** Stufe neu bestimmen (nach jeder Änderung an Bestellungen und täglich). Gibt das aktuelle Mitglied zurück. */
    public static function evaluate(array $member, ?int $now = null): array
    {
        $p = Points::program();
        if (!$p['tiers_enabled'] || !$member['joined_at']) {
            return $member;
        }
        $now ??= Util::now();
        $tiers = $p['tiers'];
        $spend = self::spend($member['id'], $now, $p);
        $qual = 0;
        foreach ($tiers as $i => $t) {
            if ($spend >= (int) $t['min_cents']) {
                $qual = $i;
            }
        }
        $cur = self::index((string) $member['tier'], $tiers);
        $until = $member['tier_until'] !== null ? (int) $member['tier_until'] : null;
        $months = (int) $p['tier_months'];
        $validUntil = (new \DateTimeImmutable('@' . intdiv($now, 1000)))->modify("+$months months")->getTimestamp() * 1000;
        $update = ['tier_spend_cents' => $spend];

        if ($qual > $cur) {
            $update['tier'] = $tiers[$qual]['key'];
            $update['tier_until'] = $validUntil;
        } elseif ($qual === $cur && $qual > 0) {
            $update['tier_until'] = max($until ?? 0, $validUntil);
        } elseif ($qual < $cur && ($until === null || $until < $now)) {
            $update['tier'] = $tiers[$qual]['key'];
            $update['tier_until'] = $qual > 0 ? $validUntil : null;
        }
        $changedTier = isset($update['tier']) && $update['tier'] !== $member['tier'];
        if ($changedTier) {
            $update['meta_dirty'] = 1;
        }
        $differs = false;
        foreach ($update as $k => $v) {
            if ((string) ($member[$k] ?? '') !== (string) ($v ?? '')) {
                $differs = true;
            }
        }
        if ($differs) {
            Db::update('club_members', $update, ['id' => $member['id']]);
        }
        $fresh = array_merge($member, $update);
        if ($changedTier && $qual > $cur) {
            $t = $tiers[$qual];
            Push::queue($fresh, 'tier_up', [
                'stufe' => $t['name'],
                'satz' => self::rateText((float) $t['rate']),
            ], 'tier:' . $member['id'] . ':' . $t['key'] . ':' . date('Y-m', intdiv($now, 1000)));
        }
        return $fresh;
    }

    /** Täglich: abgelaufene Stufen prüfen (Abstieg) und Umsätze aktualisieren. */
    public static function runDaily(): string
    {
        $now = Util::now();
        $n = 0;
        foreach (Db::all('SELECT * FROM club_members WHERE joined_at IS NOT NULL AND (tier_until IS NOT NULL AND tier_until < ?) LIMIT 500', [$now]) as $m) {
            $after = self::evaluate($m, $now);
            $n += $after['tier'] !== $m['tier'] ? 1 : 0;
        }
        return "$n Stufen geändert";
    }

    /** „1,5 Punkte pro Euro“ */
    public static function rateText(float $rate): string
    {
        $s = rtrim(rtrim(number_format($rate, 2, ',', '.'), '0'), ',');
        return $s . ($rate == 1.0 ? ' Punkt' : ' Punkte') . ' pro Euro';
    }

    /** Alles zur Stufe für die App. */
    public static function info(array $member): ?array
    {
        $p = Points::program();
        if (!$p['tiers_enabled']) {
            return null;
        }
        $tiers = $p['tiers'];
        $cur = self::index((string) $member['tier'], $tiers);
        $spend = (int) $member['tier_spend_cents'];
        $next = $tiers[$cur + 1] ?? null;
        // Was fehlt, um die nächste Stufe zu erreichen – oder um die aktuelle zu halten
        $keep = $cur > 0 && $spend < (int) $tiers[$cur]['min_cents'] ? (int) $tiers[$cur]['min_cents'] - $spend : 0;
        return [
            'key' => $tiers[$cur]['key'],
            'name' => $tiers[$cur]['name'],
            'rate' => $tiers[$cur]['rate'],
            'benefits' => $tiers[$cur]['benefits'],
            'until' => $member['tier_until'] !== null ? (int) $member['tier_until'] : null,
            'spend_cents' => $spend,
            'months' => (int) $p['tier_months'],
            'next' => $next ? [
                'key' => $next['key'],
                'name' => $next['name'],
                'rate' => $next['rate'],
                'min_cents' => (int) $next['min_cents'],
                'missing_cents' => max(0, (int) $next['min_cents'] - $spend),
            ] : null,
            'keep_cents' => $keep,
        ];
    }
}
