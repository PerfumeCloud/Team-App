<?php
declare(strict_types=1);

namespace Club;

/** Daten für die Team-App (Server zu Server): Kundeninfos neben der Mail, Wochenrückblick, Hinweise. */
final class Internal
{
    /** Club-Daten zu einer E-Mail-Adresse (Kundeninfos in der Team-App). */
    public static function customer(string $email): array
    {
        $email = mb_strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Ungültige E-Mail-Adresse.');
        }
        $out = ['member' => false, 'ratings' => Surveys::forEmail($email)];
        $m = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL AND test = 0', [$email]);
        if (!$m) {
            return $out;
        }
        $tier = Tiers::of($m);
        $sum = Points::summary($m);
        $linkOrders = (int) Db::value("SELECT COUNT(*) FROM club_referral_orders WHERE member_id = ? AND test = 0 AND status IN ('pending', 'credited')", [$m['id']]);
        $invited = (int) Db::value('SELECT COUNT(*) FROM club_members WHERE referred_by = ?', [$m['id']]);
        return [
            'member' => true,
            'joined_at' => (int) $m['joined_at'],
            'tier' => ['key' => $tier['key'], 'name' => $tier['name']],
            'points' => ['available' => $sum['balance'], 'pending' => $sum['pending'] + $sum['locked'], 'value_cents' => $sum['value_cents']],
            'codes' => array_map(static fn ($c) => [
                'code' => $c['code'],
                'value_cents' => $c['value_cents'],
                'status' => $c['status'],
                'expires_at' => $c['expires_at'],
            ], array_slice(array_values(array_filter(Points::codes($m['id']), static fn ($c) => in_array($c['status'], ['active', 'used'], true))), 0, 5)),
            'ratings' => $out['ratings'],
            'referrals' => ['count' => $invited + $linkOrders, 'orders' => $linkOrders],
            'ref_link' => Referrals::enabled() ? Referrals::link($m) : null,
            'admin_url' => Util::baseUrl() . '/admin/mitglieder/' . $m['id'],
        ];
    }

    /** Kennzahlen eines Zeitraums für den Wochenrückblick. */
    public static function weekly(int $from, int $to): array
    {
        if ($from <= 0 || $to <= $from) {
            throw new HttpError(422, 'Ungültiger Zeitraum.');
        }
        $prevFrom = $from - ($to - $from);
        $nt = 'member_id NOT IN (SELECT id FROM club_members WHERE test = 1)';
        $joined = static fn (int $a, int $b) => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE test = 0 AND joined_at >= ? AND joined_at < ?', [$a, $b]);
        return [
            'members_new' => $joined($from, $to),
            'members_new_prev' => $joined($prevFrom, $from),
            'members_total' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE joined_at IS NOT NULL AND test = 0'),
            'points_redeemed' => -(int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_ledger WHERE kind IN ('redeem', 'refund') AND created_at >= ? AND created_at < ? AND $nt", [$from, $to]),
            'codes_used' => (int) Db::value("SELECT COUNT(*) FROM club_codes WHERE status = 'used' AND used_at >= ? AND used_at < ? AND $nt", [$from, $to]),
            'survey' => Surveys::stats($from, $to),
            'referrals' => Referrals::stats($from, $to),
        ];
    }

    /** Neue Hinweise abholen (z. B. schlechte Bewertung) – die Team-App legt daraus Aufgaben an. */
    public static function claimAlerts(int $max = 20): array
    {
        $rows = Db::all('SELECT * FROM club_alerts WHERE claimed_at IS NULL ORDER BY created_at LIMIT ' . max(1, min(100, $max)));
        $out = [];
        $now = Util::now();
        foreach ($rows as $r) {
            if (Db::exec('UPDATE club_alerts SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL', [$now, $r['id']]) !== 1) {
                continue;
            }
            $out[] = [
                'id' => $r['id'],
                'kind' => $r['kind'],
                'payload' => json_decode((string) $r['payload'], true) ?: [],
                'test' => (bool) (int) $r['test'],
                'created_at' => (int) $r['created_at'],
            ];
        }
        return ['alerts' => $out];
    }
}
