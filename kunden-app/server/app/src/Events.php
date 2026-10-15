<?php
declare(strict_types=1);

namespace Club;

/**
 * Was nach einer Änderung passiert: Push-Nachrichten (Versand, Zustellung, Gutschrift, Abzug, Prämie bereit),
 * Freischalten von Boni und Neuberechnung der Stufe.
 */
final class Events
{
    private const RECENT_MS = 3 * 86400 * 1000;

    /** Eine Bestellung hat sich geändert ($old = vorheriger Stand oder null). */
    public static function order(array $member, ?array $old, array $new): void
    {
        $now = Util::now();
        $name = (string) $new['name'];
        $url = '/bestellungen/' . preg_replace('/\D/', '', (string) $new['order_id']);
        $joined = (int) $member['joined_at'];

        // Versendet (nur frische Sendungen, keine alten Bestellungen beim Beitritt)
        $shipped = $new['shipped_at'] !== null ? (int) $new['shipped_at'] : null;
        if ($shipped && (!$old || $old['shipped_at'] === null) && $new['status'] !== 'void' && $now - $shipped < self::RECENT_MS && $shipped >= $joined - 86400 * 1000) {
            Push::queue($member, 'order_shipped', ['bestellung' => $name], 'ship:' . $new['order_id'], $url);
        }
        // Zugestellt
        $delivered = $new['delivered_at'] !== null ? (int) $new['delivered_at'] : null;
        if ($delivered && (!$old || $old['delivered_at'] === null) && $now - $delivered < self::RECENT_MS && ($shipped ?? 0) >= $joined - 86400 * 1000) {
            Push::queue($member, 'order_delivered', ['bestellung' => $name], 'delivered:' . $new['order_id'], $url);
        }

        // Punkte gutgeschrieben oder wieder abgezogen
        $was = $old && $old['status'] === 'available' ? (int) $old['points'] : 0;
        $is = $new['status'] === 'available' ? (int) $new['points'] : 0;
        $factor = (float) ($new['factor'] ?? 1);
        if ($is > $was) {
            $grund = 'Bestellung ' . $name . ($factor > 1 ? ' (' . Promotions::factorText($factor) . ' Punkte)' : '');
            Push::queue($member, 'points_credited', ['punkte' => (string) ($is - $was), 'grund' => $grund], 'credit:' . $new['order_id'] . ':' . $is, '/praemien');
            if ($was === 0) {
                Bonus::onOrderAvailable($member, $new);
            }
            self::rewardCheck($member['id']);
        } elseif ($is < $was) {
            $grund = 'Bestellung ' . $name . ($new['status'] === 'void' ? ($new['reason'] === 'cancelled' ? ' wurde storniert' : ' wurde erstattet') : ' wurde teilweise erstattet');
            Push::queue($member, 'points_deducted', ['punkte' => (string) ($was - $is), 'grund' => $grund], 'debit:' . $new['order_id'] . ':' . $is, '/praemien');
            self::rewardCheck($member['id']);
        }

        // Stufe (Umsatz hat sich geändert)
        if (!$old || (int) $old['amount_cents'] !== (int) $new['amount_cents'] || $old['status'] !== $new['status'] || $old['reason'] !== $new['reason']) {
            $fresh = Db::one('SELECT * FROM club_members WHERE id = ?', [$member['id']]);
            if ($fresh) {
                Tiers::evaluate($fresh, $now);
            }
        }
    }

    /** Gründe für Buchungen im Klartext (für Push-Nachrichten). */
    public static function reason(string $kind, int $points, ?string $note): string
    {
        return match ($kind) {
            'welcome' => 'Willkommensbonus',
            'birthday' => 'Geburtstagsbonus',
            'newsletter' => 'Newsletter-Bonus',
            'review' => 'Danke für deine Bewertung',
            'referral' => 'Empfehlung',
            'referred', 'start' => $note && str_contains($note, 'freigeschaltet') ? 'Startbonus freigeschaltet' : 'Startbonus',
            'refund' => $note ?: 'Punkte zurückgebucht',
            'redeem' => $note ?: 'Code erstellt',
            'expire' => 'Punkte verfallen',
            'bonus' => $note ?: 'Bonus vom Team',
            'adjust' => $note ?: ($points > 0 ? 'Gutschrift vom Team' : 'Korrektur vom Team'),
            default => $note ?: 'Buchung',
        };
    }

    /** Eine Journal-Buchung wurde verfügbar → Push mit Grund und Punkten. */
    public static function booked(string $memberId, string $kind, int $points, ?string $note): void
    {
        $key = $points > 0 ? 'points_credited' : ($kind === 'redeem' ? 'points_redeemed' : 'points_deducted');
        Push::queue($memberId, $key, [
            'punkte' => (string) abs($points),
            'grund' => self::reason($kind, $points, $note),
        ], null, '/praemien');
        self::rewardCheck($memberId);
    }

    /**
     * „Deine Prämie wartet“: einmal, sobald der Kontostand eine neue Prämienstufe erreicht.
     * Sinkt der Stand (z. B. nach dem Einlösen), wird die Schwelle zurückgesetzt.
     */
    public static function rewardCheck(string $memberId): void
    {
        $m = Db::one('SELECT * FROM club_members WHERE id = ?', [$memberId]);
        if (!$m || !$m['joined_at']) {
            return;
        }
        $p = Points::program();
        $maxSteps = max(1, intdiv((int) $p['max_cents'], (int) $p['redeem_cents']));
        $level = min($maxSteps, intdiv(max(0, Points::balance($memberId)), (int) $p['redeem_points']));
        $before = (int) $m['reward_level'];
        if ($level === $before) {
            return;
        }
        Db::exec('UPDATE club_members SET reward_level = ? WHERE id = ?', [$level, $memberId]);
        if ($level > $before && $level > 0 && $p['active']) {
            Push::queue($m, 'reward_ready', ['euro' => Util::euro($level * (int) $p['redeem_cents'])], 'reward:' . $memberId . ':' . $level . ':' . date('Y-m-d'), '/praemien');
        }
    }
}
