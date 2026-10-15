<?php
declare(strict_types=1);

namespace Club;

/**
 * Treuepunkte.
 *
 * Punkte je Bestellung werden bei jedem Abgleich aus dem aktuellen Stand der Bestellung berechnet
 * (Warenwert nach Rabatten und Rücksendungen, ohne Versand) – mit dem Punktesatz der Stufe und dem Faktor
 * einer Aktion, die beim ersten Abgleich festgehalten werden. Sie sind zuerst „unterwegs“ und werden
 * verfügbar, sobald die Bestellung bezahlt, komplett versendet und die Wartezeit (Widerrufsfrist) vorbei ist.
 * Storniert oder erstattet → keine Punkte. Alle anderen Buchungen stehen im Journal (club_ledger).
 *
 * Kontostand = verfügbare Bestellpunkte + Summe der verfügbaren Journal-Buchungen.
 * Gesperrte Buchungen (z. B. Startbonus „nach der ersten Bestellung“) zählen erst nach der Freischaltung.
 */
final class Points
{
    public const DEFAULTS = [
        'name' => 'Perfume Cloud Club',
        'active' => true,          // Einlösen möglich
        'earn_per_euro' => 1.0,    // Punkte je 1 € Warenwert (Grundstufe)
        'redeem_points' => 100,    // so viele Punkte …
        'redeem_cents' => 500,     // … sind so viel wert
        'max_cents' => 5000,       // höchster Wert je Code
        'code_days' => 90,         // so lange gilt ein Code
        'code_expiry_refund' => true, // abgelaufener Code: Punkte zurück (sonst verfallen sie mit dem Code)
        'wait_days' => 14,         // nach dem Versand, bis die Punkte verfügbar sind
        'welcome_points' => 50,    // Bonus beim Beitritt
        'retro_days' => 30,        // Bestellungen so viele Tage vor dem Beitritt zählen mit
        'max_open_codes' => 3,     // gleichzeitig offene Codes je Person
        'points_expiry_months' => 24, // Punkte verfallen so viele Monate nach der Gutschrift (0 = nie)
        'expiry_warn_days' => 30,  // so lange vorher gibt es eine Erinnerung
        // Stufen: Umsatz der letzten tier_months Monate entscheidet, die Stufe gilt dann tier_months Monate
        'tiers_enabled' => true,
        'tier_months' => 12,
        'tiers' => [
            ['key' => 'bronze', 'name' => 'Bronze', 'min_cents' => 0, 'rate' => 1.0, 'benefits' => ['Willkommensbonus und Punkte zum Geburtstag', 'Club-Aktionen per Push als Erste erfahren']],
            ['key' => 'silber', 'name' => 'Silber', 'min_cents' => 15000, 'rate' => 1.5, 'benefits' => ['Früher Zugang zu neuen Düften', 'Exklusive Aktionen für Silber und Gold']],
            ['key' => 'gold', 'name' => 'Gold', 'min_cents' => 40000, 'rate' => 2.0, 'benefits' => ['Neue Düfte vor allen anderen', 'Exklusive Rabatte und kleine Überraschungen']],
        ],
        // Bonuspunkte
        'bonus_birthday' => 50,
        'bonus_newsletter' => 25,
        'bonus_review' => 25,
        'review_max_month' => 2,
        'bonus_referrer' => 100,   // für das werbende Mitglied, sobald die erste Bestellung des Freundes gutgeschrieben ist
        'bonus_referred' => 100,   // für den Freund, nach der ersten Bestellung
        'referral_min_cents' => 0,
        'referral_max_year' => 10,
        // Startbonus für die Warteliste (Shopify-Tag)
        'start_bonus' => 100,
        'start_bonus_until' => '',  // Registrierung bis (JJJJ-MM-TT), leer = ohne Frist
        'start_bonus_requires_order' => true,
        'start_bonus_min_cents' => 0,
        'start_bonus_days' => 0,    // nach der Freischaltung so viele Tage gültig (0 = normale Verfallsregel)
        'waitlist_tag' => 'warteliste',
        'count_test' => false,     // Testbestellungen zählen (nur zum Ausprobieren)
        'bind_customer' => true,   // Code gilt nur für das eigene Kundenkonto
        'combine_shipping' => true,
        'combine_order' => false,
        'combine_product' => false,
    ];

    public const DAY_MS = 86400 * 1000;
    private const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private static ?array $program = null;

    public static function program(): array
    {
        if (self::$program === null) {
            $p = Settings::get('program', []);
            $p = array_merge(self::DEFAULTS, is_array($p) ? $p : []);
            $p['tiers'] = Tiers::normalize($p['tiers'] ?? [], (float) $p['earn_per_euro']);
            self::$program = $p;
        }
        return self::$program;
    }

    public static function resetCache(): void
    {
        self::$program = null;
    }

    public static function saveProgram(array $in): array
    {
        $p = self::program();
        $before = $p;
        $num = static function (string $key, float $min, float $max) use ($in, &$p): void {
            if (!array_key_exists($key, $in)) {
                return;
            }
            $v = $in[$key];
            if (!is_numeric($v) || (float) $v < $min || (float) $v > $max) {
                throw new HttpError(422, "Ungültiger Wert für $key.");
            }
            $p[$key] = is_float(self::DEFAULTS[$key]) ? round((float) $v, 2) : (int) $v;
        };
        $num('earn_per_euro', 0, 100);
        $num('redeem_points', 1, 100000);
        $num('redeem_cents', 1, 100000);
        $num('max_cents', 1, 1000000);
        $num('code_days', 1, 730);
        $num('wait_days', 0, 120);
        $num('welcome_points', 0, 100000);
        $num('retro_days', 0, 730);
        $num('max_open_codes', 1, 20);
        $num('points_expiry_months', 0, 120);
        $num('expiry_warn_days', 0, 120);
        $num('tier_months', 1, 36);
        $num('bonus_birthday', 0, 100000);
        $num('bonus_newsletter', 0, 100000);
        $num('bonus_review', 0, 100000);
        $num('review_max_month', 0, 31);
        $num('bonus_referrer', 0, 100000);
        $num('bonus_referred', 0, 100000);
        $num('referral_min_cents', 0, 10000000);
        $num('referral_max_year', 0, 1000);
        $num('start_bonus', 0, 100000);
        $num('start_bonus_min_cents', 0, 10000000);
        $num('start_bonus_days', 0, 3650);
        foreach (['active', 'count_test', 'bind_customer', 'combine_shipping', 'combine_order', 'combine_product', 'code_expiry_refund', 'tiers_enabled', 'start_bonus_requires_order'] as $flag) {
            if (array_key_exists($flag, $in)) {
                $p[$flag] = (bool) $in[$flag];
            }
        }
        if (array_key_exists('name', $in)) {
            $name = Util::str($in['name'], 60, false);
            $p['name'] = $name !== '' ? $name : self::DEFAULTS['name'];
        }
        if (array_key_exists('start_bonus_until', $in)) {
            $d = Util::str($in['start_bonus_until'], 10, false);
            if ($d !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                throw new HttpError(422, 'Bitte ein Datum für die Frist des Startbonus angeben (oder leer lassen).');
            }
            $p['start_bonus_until'] = $d;
        }
        if (array_key_exists('waitlist_tag', $in)) {
            $tag = Util::str($in['waitlist_tag'], 40, false);
            $p['waitlist_tag'] = $tag !== '' ? $tag : self::DEFAULTS['waitlist_tag'];
        }
        if (array_key_exists('tiers', $in)) {
            if (!is_array($in['tiers'])) {
                throw new HttpError(422, 'Ungültige Stufen.');
            }
            $p['tiers'] = Tiers::validate($in['tiers'], $p['tiers']);
            $p['earn_per_euro'] = (float) $p['tiers'][0]['rate'];
        } elseif (array_key_exists('earn_per_euro', $in)) {
            $p['tiers'][0]['rate'] = (float) $p['earn_per_euro'];
        }
        if ($p['max_cents'] < $p['redeem_cents']) {
            throw new HttpError(422, 'Der Höchstwert je Code muss mindestens so groß sein wie eine Stufe.');
        }
        Settings::set('program', $p);
        self::$program = null;
        $p = self::program();

        // Stufen geändert → Metafelder aller Mitglieder neu schreiben
        if (Util::json($before['tiers']) !== Util::json($p['tiers']) || $before['tiers_enabled'] !== $p['tiers_enabled']) {
            Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE joined_at IS NOT NULL');
        }
        // Regeln im Shop (Metafeld club.programm) aktualisieren – Shop-Texte und Punkteanzeige ziehen nach
        ShopSync::markDirty();
        return $p;
    }

    /** Startbonus der Warteliste, wenn er gerade gilt. */
    public static function startBonus(?array $p = null): ?array
    {
        $p ??= self::program();
        if ((int) $p['start_bonus'] <= 0) {
            return null;
        }
        $until = null;
        if ($p['start_bonus_until'] !== '') {
            $until = (int) (strtotime($p['start_bonus_until'] . ' 23:59:59') ?: 0) * 1000;
            if ($until < Util::now()) {
                return null;
            }
        }
        return [
            'points' => (int) $p['start_bonus'],
            'until' => $until,
            'requires_order' => (bool) $p['start_bonus_requires_order'],
            'min_cents' => (int) $p['start_bonus_min_cents'],
            'days' => (int) $p['start_bonus_days'],
        ];
    }

    /** Was Kundinnen und Kunden über die Regeln sehen. Daraus entstehen alle Texte in App und Shop. */
    public static function publicProgram(): array
    {
        $p = self::program();
        return [
            'name' => $p['name'],
            'active' => $p['active'],
            'earn_per_euro' => $p['earn_per_euro'],
            'redeem_points' => $p['redeem_points'],
            'redeem_cents' => $p['redeem_cents'],
            'max_cents' => $p['max_cents'],
            'code_days' => $p['code_days'],
            'code_expiry_refund' => $p['code_expiry_refund'],
            'wait_days' => $p['wait_days'],
            'welcome_points' => $p['welcome_points'],
            'retro_days' => $p['retro_days'],
            'points_expiry_months' => $p['points_expiry_months'],
            'tiers_enabled' => $p['tiers_enabled'],
            'tier_months' => $p['tier_months'],
            'tiers' => $p['tiers_enabled'] ? $p['tiers'] : [],
            'bonus' => [
                'birthday' => $p['bonus_birthday'],
                'newsletter' => $p['bonus_newsletter'],
                'review' => $p['bonus_review'],
                'referrer' => $p['bonus_referrer'],
                'referred' => $p['bonus_referred'],
                'referral_min_cents' => $p['referral_min_cents'],
            ],
            'start_bonus' => self::startBonus($p),
            'promo' => Promotions::publicActive(),
            'next_promo' => Promotions::publicNext(),
        ];
    }

    // ---------- Punkte je Bestellung ----------

    /**
     * Punkte und Status einer Shopify-Bestellung. null = liegt vor dem Zeitraum des Clubs (zählt nicht).
     * @return array{points:int, status:string, reason:?string, amount_cents:int, shipped_at:?int, available_at:?int, ordered_at:int}|null
     */
    public static function compute(array $o, array $member, array $prog, int $now, float $rate = -1, float $factor = 1.0): ?array
    {
        $ordered = Util::ms($o['processedAt'] ?? $o['createdAt'] ?? null) ?? $now;
        $joined = (int) ($member['joined_at'] ?? 0);
        if (!$joined || $ordered < $joined - (int) $prog['retro_days'] * self::DAY_MS) {
            return null;
        }
        if ($rate < 0) {
            $rate = (float) $prog['earn_per_euro'];
        }
        $amount = max(0, Util::cents($o['currentSubtotalPriceSet']['shopMoney']['amount'] ?? 0));
        $points = (int) floor($amount * $rate * $factor / 100 + 1e-9);
        $refunded = Util::cents($o['totalRefundedSet']['shopMoney']['amount'] ?? 0);
        $r = ['points' => $points, 'status' => 'pending', 'reason' => null, 'amount_cents' => $amount, 'shipped_at' => null, 'available_at' => null, 'ordered_at' => $ordered];

        if (!empty($o['cancelledAt'])) {
            return ['status' => 'void', 'reason' => 'cancelled'] + $r;
        }
        if (!empty($o['test']) && !$prog['count_test']) {
            return ['status' => 'void', 'reason' => 'test'] + $r;
        }
        if ($points <= 0) {
            return ['status' => 'void', 'reason' => $refunded > 0 ? 'refunded' : 'zero'] + $r;
        }
        if (empty($o['fullyPaid'])) {
            return ['reason' => 'payment'] + $r;
        }
        if (($o['displayFulfillmentStatus'] ?? '') !== 'FULFILLED') {
            return ['reason' => 'shipping'] + $r;
        }
        $shipped = null;
        foreach ($o['fulfillments'] ?? [] as $f) {
            if (($f['status'] ?? 'SUCCESS') !== 'SUCCESS') {
                continue;
            }
            $at = Util::ms($f['createdAt'] ?? null);
            if ($at !== null && ($shipped === null || $at > $shipped)) {
                $shipped = $at;
            }
        }
        $shipped ??= $ordered;
        $available = $shipped + (int) $prog['wait_days'] * self::DAY_MS;
        $r['shipped_at'] = $shipped;
        $r['available_at'] = $available;
        if ($available <= $now) {
            return ['status' => 'available', 'reason' => null] + $r;
        }
        return ['reason' => 'wait'] + $r;
    }

    /** Wann wurde die Bestellung zugestellt? (letzte Sendung) */
    public static function deliveredAt(array $o, int $now): ?int
    {
        $list = array_values(array_filter($o['fulfillments'] ?? [], static fn ($f) => ($f['status'] ?? 'SUCCESS') === 'SUCCESS'));
        if (!$list || ($o['displayFulfillmentStatus'] ?? '') !== 'FULFILLED') {
            return null;
        }
        $at = null;
        foreach ($list as $f) {
            $d = Util::ms($f['deliveredAt'] ?? null);
            if ($d === null && in_array($f['displayStatus'] ?? '', ['DELIVERED', 'PICKED_UP'], true)) {
                $d = $now;
            }
            if ($d === null) {
                return null; // eine Sendung ist noch unterwegs
            }
            $at = max($at ?? 0, $d);
        }
        return $at;
    }

    /** Schreibt den aktuellen Stand einer Bestellung. Gibt true zurück, wenn sich etwas geändert hat. */
    public static function upsertOrder(array $member, array $o, ?array $prog = null): bool
    {
        $prog ??= self::program();
        $now = Util::now();
        if ((int) ($member['test'] ?? 0) === 1) {
            $o = Trial::adjust($o, $member);
        }
        self::markCodesUsed($member, $o);
        $id = (string) $o['id'];
        $old = Db::one('SELECT * FROM club_orders WHERE order_id = ?', [$id]);
        if ($old) {
            $rate = $old['rate'] !== null ? (float) $old['rate'] : (float) $prog['earn_per_euro'];
            $factor = (float) $old['factor'];
            $promo = $old['promo_id'];
        } else {
            // Satz der Stufe und Faktor einer Aktion werden beim ersten Abgleich festgehalten
            $ordered = Util::ms($o['processedAt'] ?? $o['createdAt'] ?? null) ?? $now;
            $rate = $ordered < (int) $member['joined_at'] ? (float) $prog['earn_per_euro'] : Tiers::rate($member, $prog);
            [$factor, $promo] = Promotions::factorAt($ordered);
        }
        $c = self::compute($o, $member, $prog, $now, $rate, $factor);
        if ($c === null) {
            return false;
        }
        $delivered = $c['status'] === 'void' ? null : (self::deliveredAt($o, $now) ?? ($old['delivered_at'] ?? null));
        $row = [
            'member_id' => $member['id'],
            'name' => mb_substr((string) ($o['name'] ?? ''), 0, 40),
            'ordered_at' => $c['ordered_at'],
            'amount_cents' => $c['amount_cents'],
            'points' => $c['points'],
            'status' => $c['status'],
            'reason' => $c['reason'],
            'shipped_at' => $c['shipped_at'],
            'available_at' => $c['available_at'],
            'rate' => $rate,
            'factor' => $factor,
            'promo_id' => $promo,
            'delivered_at' => $delivered !== null ? (int) $delivered : null,
            'updated_at' => $now,
        ];
        if ($old) {
            $same = (int) $old['points'] === $c['points'] && $old['status'] === $c['status'] && $old['reason'] === $c['reason']
                && (int) ($old['available_at'] ?? 0) === (int) ($c['available_at'] ?? 0)
                && (int) ($old['shipped_at'] ?? 0) === (int) ($c['shipped_at'] ?? 0)
                && (int) ($old['delivered_at'] ?? 0) === (int) ($row['delivered_at'] ?? 0)
                && (int) $old['amount_cents'] === $c['amount_cents'];
            if ($same) {
                return false;
            }
            Db::update('club_orders', $row, ['order_id' => $id]);
        } else {
            Db::insert('club_orders', ['order_id' => $id] + $row);
        }
        Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$member['id']]);
        Events::order($member, $old, ['order_id' => $id] + $row);
        return true;
    }

    /** Rabattcodes aus dieser Bestellung als verwendet markieren. */
    private static function markCodesUsed(array $member, array $o): void
    {
        $used = array_map('strtoupper', array_filter((array) ($o['discountCodes'] ?? []), 'is_string'));
        if (!$used) {
            return;
        }
        $rows = Db::all(
            "SELECT * FROM club_codes WHERE member_id = ? AND status IN ('active', 'expired', 'cancelled', 'lapsed') AND code IN (" . Db::marks($used) . ')',
            array_merge([$member['id']], $used)
        );
        foreach ($rows as $c) {
            Db::update('club_codes', [
                'status' => 'used',
                'used_at' => Util::ms($o['processedAt'] ?? null) ?? Util::now(),
                'order_name' => mb_substr((string) ($o['name'] ?? ''), 0, 40),
                'updated_at' => Util::now(),
            ], ['id' => $c['id']]);
            // Kurz vor Ablauf benutzt, aber schon zurückgebucht (Shopify zählt Nutzungen verzögert): Rückbuchung aufheben
            if ($c['status'] === 'expired' || $c['status'] === 'cancelled') {
                self::book($member['id'], 'adjust', -(int) $c['points'], 'Code ' . $c['code'] . ' wurde doch verwendet (' . ($o['name'] ?? '') . ')', $c['id']);
            }
        }
    }

    public const ORDER_FIELDS = 'id name processedAt createdAt cancelledAt test fullyPaid displayFulfillmentStatus discountCodes
        currentSubtotalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }
        fulfillments(first: 10) { status createdAt deliveredAt displayStatus }';

    /** Holt die Bestellungen einer Person (z. B. direkt nach dem Beitritt). */
    public static function syncMember(array $member): int
    {
        if (!$member['joined_at'] || !Shopify::configured()) {
            return 0;
        }
        $d = Shopify::graphql(
            'query ClubMemberOrders($id: ID!) { customer(id: $id) { orders(first: 50, sortKey: PROCESSED_AT, reverse: true) { nodes { ' . self::ORDER_FIELDS . ' } } } }',
            ['id' => $member['shopify_id']]
        );
        $prog = self::program();
        $n = 0;
        // Älteste zuerst, damit Stufe und „erste Bestellung“ in der richtigen Reihenfolge entstehen
        foreach (array_reverse($d['customer']['orders']['nodes'] ?? []) as $o) {
            $n += self::upsertOrder($member, $o, $prog) ? 1 : 0;
            $member = Db::one('SELECT * FROM club_members WHERE id = ?', [$member['id']]) ?? $member;
        }
        Db::exec('UPDATE club_members SET orders_synced_at = ? WHERE id = ?', [Util::now(), $member['id']]);
        return $n;
    }

    /** Cronjob: alle seit dem letzten Lauf geänderten Bestellungen von Club-Mitgliedern. */
    public static function syncRecent(): string
    {
        $cursor = (string) (Settings::get('sync_cursor') ?: Util::iso(Util::now() - 2 * self::DAY_MS));
        $prog = self::program();
        $after = null;
        $seen = 0;
        $changed = 0;
        $newest = $cursor;
        for ($page = 0; $page < 20; $page++) {
            $d = Shopify::graphql(
                'query ClubSync($q: String!, $after: String) { orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT) {
                    pageInfo { hasNextPage endCursor } nodes { updatedAt ' . Surveys::ORDER_EXTRA . ' ' . self::ORDER_FIELDS . ' } } }',
                ['q' => "updated_at:>='$cursor'", 'after' => $after]
            );
            $orders = $d['orders']['nodes'] ?? [];
            $ids = array_values(array_unique(array_filter(array_map(static fn ($o) => $o['customer']['id'] ?? null, $orders))));
            $members = [];
            if ($ids) {
                foreach (Db::all('SELECT * FROM club_members WHERE joined_at IS NOT NULL AND shopify_id IN (' . Db::marks($ids) . ')', $ids) as $m) {
                    $members[$m['shopify_id']] = $m;
                }
            }
            foreach ($orders as $o) {
                $seen++;
                if (($o['updatedAt'] ?? '') > $newest) {
                    $newest = (string) $o['updatedAt'];
                }
                $m = $members[$o['customer']['id'] ?? ''] ?? null;
                // Probelauf (0-€-Testbestellung eines Admins): läuft nur über das Testkonto
                if (Trial::isTrialOrder($o)) {
                    Trial::onOrder($o);
                    continue;
                }
                if ($m) {
                    $changed += self::upsertOrder($m, $o, $prog) ? 1 : 0;
                    $members[$m['shopify_id']] = Db::one('SELECT * FROM club_members WHERE id = ?', [$m['id']]) ?? $m;
                }
                // Befragung und Empfehlungen betreffen alle Bestellungen, nicht nur die von Mitgliedern
                try {
                    Surveys::consider($o, $m);
                } catch (\Throwable $e) {
                    Util::log('Befragung ' . ($o['name'] ?? '') . ': ' . $e->getMessage());
                }
                try {
                    Referrals::consider($o);
                } catch (\Throwable $e) {
                    Util::log('Empfehlung ' . ($o['name'] ?? '') . ': ' . $e->getMessage());
                }
            }
            if (!($d['orders']['pageInfo']['hasNextPage'] ?? false)) {
                break;
            }
            $after = $d['orders']['pageInfo']['endCursor'];
        }
        Settings::set('sync_cursor', $newest);
        return $seen . ($seen === 1 ? ' Bestellung' : ' Bestellungen') . " geprüft, $changed geändert";
    }

    /**
     * Zustellungen verfolgen: Ändert sich nur der Sendungsstatus, ändert Shopify die Bestellung nicht immer.
     * Deshalb werden versendete, noch nicht zugestellte Bestellungen der letzten drei Wochen direkt abgefragt.
     */
    public static function trackDeliveries(): string
    {
        $rows = Db::all(
            "SELECT order_id, member_id FROM club_orders WHERE shipped_at > ? AND delivered_at IS NULL AND status <> 'void' AND order_id LIKE 'gid://%' ORDER BY shipped_at DESC LIMIT 100",
            [Util::now() - 21 * self::DAY_MS]
        );
        if (!$rows) {
            return '0 unterwegs';
        }
        $prog = self::program();
        $members = [];
        $changed = 0;
        foreach (array_chunk($rows, 50) as $chunk) {
            $d = Shopify::graphql(
                'query ClubTrack($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ' . self::ORDER_FIELDS . ' } } }',
                ['ids' => array_column($chunk, 'order_id')]
            );
            $byId = array_column($chunk, 'member_id', 'order_id');
            foreach ($d['nodes'] ?? [] as $o) {
                if (!is_array($o) || empty($o['id']) || !isset($byId[$o['id']])) {
                    continue;
                }
                $mid = $byId[$o['id']];
                $members[$mid] ??= Db::one('SELECT * FROM club_members WHERE id = ?', [$mid]);
                if ($members[$mid] && $members[$mid]['joined_at']) {
                    $changed += self::upsertOrder($members[$mid], $o, $prog) ? 1 : 0;
                }
            }
        }
        return count($rows) . ' unterwegs, ' . $changed . ' geändert';
    }

    /** Punkte, deren Wartezeit vorbei ist, freigeben. */
    public static function release(): int
    {
        $now = Util::now();
        $rows = Db::all("SELECT * FROM club_orders WHERE status = 'pending' AND reason = 'wait' AND available_at <= ? LIMIT 500", [$now]);
        $n = 0;
        foreach ($rows as $old) {
            if (Db::exec("UPDATE club_orders SET status = 'available', reason = NULL, updated_at = ? WHERE order_id = ? AND status = 'pending'", [$now, $old['order_id']]) !== 1) {
                continue;
            }
            $n++;
            Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$old['member_id']]);
            $member = Db::one('SELECT * FROM club_members WHERE id = ?', [$old['member_id']]);
            if ($member) {
                Events::order($member, $old, ['status' => 'available', 'reason' => null] + $old);
            }
        }
        return $n;
    }

    // ---------- Kontostand und Verlauf ----------

    public static function balance(string $memberId): int
    {
        $orders = (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE member_id = ? AND status = 'available'", [$memberId]);
        $ledger = (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_ledger WHERE member_id = ? AND status = 'available'", [$memberId]);
        return $orders + $ledger;
    }

    /** Punkte aus Bestellungen, die noch nicht verfügbar sind. */
    public static function pending(string $memberId): int
    {
        return (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE member_id = ? AND status = 'pending'", [$memberId]);
    }

    /** Boni, die auf eine Bedingung warten (z. B. erste Bestellung). */
    public static function locked(string $memberId): int
    {
        return (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_ledger WHERE member_id = ? AND status = 'locked'", [$memberId]);
    }

    /** Kontostand, Wert in Euro, Abstand zur nächsten Prämie und die Einlöse-Stufen. */
    public static function summary(array $member): array
    {
        $p = self::program();
        $balance = self::balance($member['id']);
        $pending = self::pending($member['id']);
        $maxSteps = max(1, intdiv((int) $p['max_cents'], (int) $p['redeem_cents']));
        $steps = [];
        for ($i = 1; $i <= $maxSteps; $i++) {
            $steps[] = [
                'steps' => $i,
                'points' => $i * (int) $p['redeem_points'],
                'cents' => $i * (int) $p['redeem_cents'],
                'affordable' => $i * (int) $p['redeem_points'] <= $balance,
            ];
        }
        $affordable = min($maxSteps, intdiv(max(0, $balance), (int) $p['redeem_points']));
        return [
            'balance' => $balance,
            'pending' => $pending,
            'locked' => self::locked($member['id']),
            'value_cents' => $affordable * (int) $p['redeem_cents'],
            'to_next' => $affordable >= $maxSteps ? 0 : (int) $p['redeem_points'] - (max(0, $balance) % (int) $p['redeem_points']),
            'next_cents' => min($maxSteps, $affordable + 1) * (int) $p['redeem_cents'],
            'steps' => $steps,
            'lifetime' => (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE member_id = ? AND status = 'available'", [$member['id']])
                + (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_ledger WHERE member_id = ? AND status = 'available' AND points > 0 AND kind <> 'refund'", [$member['id']]),
            'expiring' => Expiry::next($member['id']),
        ];
    }

    public const TITLES = [
        'welcome' => 'Willkommensbonus',
        'redeem' => 'Eingelöst',
        'refund' => 'Zurückgebucht',
        'adjust' => 'Gutschrift vom Team',
        'bonus' => 'Bonus vom Team',
        'birthday' => 'Geburtstagsbonus',
        'newsletter' => 'Newsletter-Bonus',
        'review' => 'Danke für deine Bewertung',
        'referral' => 'Empfehlung',
        'referred' => 'Startbonus über eine Empfehlung',
        'start' => 'Startbonus',
        'expire' => 'Punkte verfallen',
        'survey' => 'Danke fürs Bewerten',
    ];

    /** Alle Buchungen, neueste zuerst. */
    public static function history(string $memberId, int $limit = 200): array
    {
        $items = [];
        foreach (Db::all('SELECT * FROM club_orders WHERE member_id = ? ORDER BY ordered_at DESC LIMIT ' . $limit, [$memberId]) as $o) {
            $items[] = [
                'id' => 'o' . preg_replace('/\D/', '', $o['order_id']),
                'kind' => 'order',
                'title' => 'Bestellung ' . $o['name'],
                'points' => (int) $o['points'],
                'status' => $o['status'],
                'reason' => $o['reason'],
                'available_at' => $o['available_at'] !== null ? (int) $o['available_at'] : null,
                'amount_cents' => (int) $o['amount_cents'],
                'factor' => (float) $o['factor'],
                'rate' => $o['rate'] !== null ? (float) $o['rate'] : null,
                'at' => (int) $o['ordered_at'],
            ];
        }
        foreach (Db::all("SELECT * FROM club_ledger WHERE member_id = ? AND status <> 'void' ORDER BY created_at DESC LIMIT " . $limit, [$memberId]) as $l) {
            $title = self::TITLES[$l['kind']] ?? 'Buchung';
            if ($l['kind'] === 'adjust' && (int) $l['points'] < 0) {
                $title = 'Korrektur vom Team';
            }
            $locked = $l['status'] === 'locked';
            $items[] = [
                'id' => 'l' . $l['id'],
                'kind' => $l['kind'],
                'title' => $title,
                'note' => $l['note'],
                'points' => (int) $l['points'],
                'status' => $locked ? 'pending' : 'available',
                'reason' => $locked ? 'first_order' : null,
                'min_cents' => $locked && $l['unlock_min_cents'] !== null ? (int) $l['unlock_min_cents'] : null,
                'at' => (int) $l['created_at'],
            ];
        }
        usort($items, static fn ($a, $b) => $b['at'] <=> $a['at']);
        return array_slice($items, 0, $limit);
    }

    public static function welcome(array $member): void
    {
        $bonus = (int) self::program()['welcome_points'];
        if ($bonus <= 0 || Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND kind = 'welcome'", [$member['id']])) {
            return;
        }
        self::book($member['id'], 'welcome', $bonus, 'Schön, dass du dabei bist!');
    }

    public static function adjust(array $admin, string $memberId, int $points, string $note, string $kind = 'adjust'): void
    {
        if ($points === 0 || abs($points) > 100000) {
            throw new HttpError(422, 'Bitte eine Punktzahl angeben (z. B. 50 oder -20).');
        }
        if (!Db::value('SELECT 1 FROM club_members WHERE id = ?', [$memberId])) {
            throw new HttpError(404, 'Mitglied nicht gefunden.');
        }
        self::book($memberId, $kind, $points, $note !== '' ? $note : null, null, $admin['id']);
    }

    /**
     * Bucht Punkte ins Journal. Verfügbare Buchungen lösen eine Push-Nachricht aus (Gutschrift/Abzug mit Grund).
     * $extra: status ('available'|'locked'), unlock_rule, unlock_min_cents, expires_days, expires_at
     */
    public static function book(string $memberId, string $kind, int $points, ?string $note, ?string $ref = null, ?string $by = null, array $extra = [], bool $notify = true): string
    {
        $id = Util::uuid();
        $now = Util::now();
        $status = $extra['status'] ?? 'available';
        Db::insert('club_ledger', [
            'id' => $id,
            'member_id' => $memberId,
            'kind' => $kind,
            'points' => $points,
            'note' => $note !== null ? mb_substr($note, 0, 250) : null,
            'ref' => $ref,
            'created_by' => $by,
            'created_at' => $now,
            'status' => $status,
            'unlock_rule' => $extra['unlock_rule'] ?? null,
            'unlock_min_cents' => $extra['unlock_min_cents'] ?? null,
            'expires_days' => $extra['expires_days'] ?? null,
            'expires_at' => $extra['expires_at'] ?? null,
            'credited_at' => $status === 'available' ? $now : null,
        ]);
        Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$memberId]);
        if ($notify && $status === 'available' && $points !== 0) {
            Events::booked($memberId, $kind, $points, $note);
        }
        return $id;
    }

    // ---------- Einlösen: persönlicher Rabattcode in Shopify ----------

    public static function codes(string $memberId): array
    {
        $rows = Db::all("SELECT * FROM club_codes WHERE member_id = ? AND status <> 'failed' ORDER BY created_at DESC LIMIT 50", [$memberId]);
        return array_map(static fn ($c) => self::publicCode($c), $rows);
    }

    public static function publicCode(array $c): array
    {
        return [
            'id' => $c['id'],
            'code' => $c['code'],
            'points' => (int) $c['points'],
            'value_cents' => (int) $c['value_cents'],
            'min_cents' => (int) $c['min_cents'],
            'status' => $c['status'],
            'created_at' => (int) $c['created_at'],
            'expires_at' => (int) $c['expires_at'],
            'used_at' => $c['used_at'] !== null ? (int) $c['used_at'] : null,
            'order_name' => $c['order_name'],
            'url' => Shopify::shopUrl() . '/discount/' . rawurlencode($c['code']),
        ];
    }

    public static function redeem(array $member, int $steps): array
    {
        $p = self::program();
        if (!$p['active']) {
            throw new HttpError(409, 'Das Einlösen ist gerade pausiert. Deine Punkte bleiben erhalten.');
        }
        if (!Shopify::configured()) {
            throw new HttpError(503, 'Das Einlösen ist noch nicht eingerichtet.');
        }
        $maxSteps = max(1, intdiv((int) $p['max_cents'], (int) $p['redeem_cents']));
        if ($steps < 1 || $steps > $maxSteps) {
            throw new HttpError(422, 'Bitte wähle eine Prämie aus.');
        }
        $points = $steps * (int) $p['redeem_points'];
        $value = $steps * (int) $p['redeem_cents'];
        $now = Util::now();
        $expires = $now + (int) $p['code_days'] * self::DAY_MS;

        // Punkte sofort abbuchen (gesperrt, damit doppeltes Tippen nicht zweimal abbucht) …
        $codeId = Util::uuid();
        $code = self::newCode();
        $ledgerId = Db::tx(static function () use ($member, $points, $value, $now, $expires, $codeId, $code, $p): string {
            Db::lockRow('club_members', $member['id']);
            $open = (int) Db::value("SELECT COUNT(*) FROM club_codes WHERE member_id = ? AND status IN ('active', 'creating')", [$member['id']]);
            if ($open >= (int) $p['max_open_codes']) {
                throw new HttpError(409, 'Du hast schon ' . $open . ' offene Codes. Löse erst einen davon ein.');
            }
            if (self::balance($member['id']) < $points) {
                throw new HttpError(422, 'Dafür reichen deine Punkte noch nicht.');
            }
            Db::insert('club_codes', [
                'id' => $codeId,
                'member_id' => $member['id'],
                'code' => $code,
                'discount_id' => null,
                'points' => $points,
                'value_cents' => $value,
                'min_cents' => $value,
                'status' => 'creating',
                'created_at' => $now,
                'expires_at' => $expires,
                'used_at' => null,
                'order_name' => null,
                'updated_at' => $now,
            ]);
            return self::book($member['id'], 'redeem', -$points, 'Code ' . $code . ' über ' . Util::euro($value), $codeId, null, [], false);
        });

        // … dann den Code in Shopify anlegen. Klappt das nicht, werden die Punkte zurückgebucht.
        try {
            $discountId = self::createDiscount($member, $code, $value, $now, $expires, $p);
        } catch (\Throwable $e) {
            Util::log('Rabattcode: ' . $e->getMessage());
            Db::exec('DELETE FROM club_ledger WHERE id = ?', [$ledgerId]);
            Db::exec("UPDATE club_codes SET status = 'failed', updated_at = ? WHERE id = ?", [Util::now(), $codeId]);
            throw new HttpError(502, 'Der Code konnte gerade nicht erstellt werden. Deine Punkte sind unverändert – bitte versuche es gleich noch einmal.');
        }
        Db::exec("UPDATE club_codes SET status = 'active', discount_id = ?, updated_at = ? WHERE id = ?", [$discountId, Util::now(), $codeId]);
        Events::booked($member['id'], 'redeem', -$points, 'Code ' . $code . ' über ' . Util::euro($value));
        return self::publicCode(Db::one('SELECT * FROM club_codes WHERE id = ?', [$codeId]));
    }

    private static function newCode(): string
    {
        $chars = self::CODE_CHARS;
        do {
            $s = '';
            for ($i = 0; $i < 8; $i++) {
                $s .= $chars[random_int(0, strlen($chars) - 1)];
            }
            $code = 'PC-' . substr($s, 0, 4) . '-' . substr($s, 4);
        } while (Db::value('SELECT 1 FROM club_codes WHERE code = ?', [$code]));
        return $code;
    }

    private static function createDiscount(array $member, string $code, int $value, int $now, int $expires, array $p): string
    {
        $who = trim(($member['first_name'] ?? '') . ' ' . mb_substr((string) ($member['last_name'] ?? ''), 0, 1));
        $input = [
            'title' => 'Club-Prämie ' . Util::euro($value) . ' · ' . ($who !== '' ? $who . ($member['last_name'] ? '.' : '') : $member['email']) . ' · ' . $code,
            'code' => $code,
            'startsAt' => Util::iso($now - 60000),
            'endsAt' => Util::iso($expires),
            'usageLimit' => 1,
            'appliesOncePerCustomer' => true,
            'context' => $p['bind_customer'] ? ['customers' => ['add' => [$member['shopify_id']]]] : ['all' => 'ALL'],
            'customerGets' => [
                'value' => ['discountAmount' => ['amount' => Util::decimal($value), 'appliesOnEachItem' => false]],
                'items' => ['all' => true],
            ],
            'minimumRequirement' => ['subtotal' => ['greaterThanOrEqualToSubtotal' => Util::decimal($value)]],
            'combinesWith' => [
                'shippingDiscounts' => (bool) $p['combine_shipping'],
                'orderDiscounts' => (bool) $p['combine_order'],
                'productDiscounts' => (bool) $p['combine_product'],
            ],
        ];
        $d = Shopify::graphql(
            'mutation ClubCode($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message code } } }',
            ['input' => $input]
        );
        Shopify::check($d['discountCodeBasicCreate'] ?? [], 'Rabattcode');
        $id = $d['discountCodeBasicCreate']['codeDiscountNode']['id'] ?? null;
        if (!is_string($id) || $id === '') {
            throw new \RuntimeException('Shopify hat keinen Rabattcode zurückgegeben.');
        }
        return $id;
    }

    /** Wie oft wurde der Code schon benutzt? null = unbekannt (z. B. Code in Shopify gelöscht). */
    private static function usage(?string $discountId): ?int
    {
        if (!$discountId) {
            return null;
        }
        $d = Shopify::graphql(
            'query ClubCodeCheck($id: ID!) { codeDiscountNode(id: $id) { id codeDiscount { ... on DiscountCodeBasic { asyncUsageCount } } } }',
            ['id' => $discountId]
        );
        $n = $d['codeDiscountNode']['codeDiscount']['asyncUsageCount'] ?? null;
        return $n === null ? null : (int) $n;
    }

    public static function deleteDiscount(?string $discountId): void
    {
        if (!$discountId) {
            return;
        }
        try {
            Shopify::graphql(
                'mutation ClubCodeDelete($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }',
                ['id' => $discountId]
            );
        } catch (\Throwable $e) {
            Util::log('Rabattcode löschen: ' . $e->getMessage());
        }
    }

    /** Unbenutzten Code zurückgeben → Punkte zurück. */
    public static function cancelCode(array $member, string $codeId): array
    {
        $c = Db::one('SELECT * FROM club_codes WHERE id = ? AND member_id = ?', [$codeId, $member['id']]);
        if (!$c || $c['status'] !== 'active') {
            throw new HttpError(404, 'Diesen Code gibt es nicht mehr.');
        }
        if ((self::usage($c['discount_id']) ?? 0) > 0) {
            Db::exec("UPDATE club_codes SET status = 'used', used_at = ?, updated_at = ? WHERE id = ?", [Util::now(), Util::now(), $c['id']]);
            throw new HttpError(409, 'Der Code wurde bereits bei einer Bestellung verwendet.');
        }
        self::deleteDiscount($c['discount_id']);
        Db::tx(static function () use ($c): void {
            if (Db::exec("UPDATE club_codes SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'", [Util::now(), $c['id']]) === 1) {
                self::book($c['member_id'], 'refund', (int) $c['points'], 'Code ' . $c['code'] . ' zurückgegeben', $c['id']);
            }
        });
        return self::publicCode(Db::one('SELECT * FROM club_codes WHERE id = ?', [$c['id']]));
    }

    /**
     * Cronjob: abgelaufene Codes verfallen lassen (je nach Einstellung mit Rückbuchung der Punkte),
     * hängengebliebene aufräumen.
     */
    public static function checkCodes(): string
    {
        $now = Util::now();
        $refund = (bool) self::program()['code_expiry_refund'];
        $expired = 0;
        foreach (Db::all("SELECT * FROM club_codes WHERE status = 'active' AND expires_at <= ? LIMIT 50", [$now]) as $c) {
            $used = self::usage($c['discount_id']);
            if ($used !== null && $used > 0) {
                Db::exec("UPDATE club_codes SET status = 'used', used_at = COALESCE(used_at, ?), updated_at = ? WHERE id = ?", [$now, $now, $c['id']]);
                continue;
            }
            self::deleteDiscount($c['discount_id']);
            Db::tx(static function () use ($c, $now, $refund, &$expired): void {
                $status = $refund ? 'expired' : 'lapsed';
                if (Db::exec("UPDATE club_codes SET status = ?, updated_at = ? WHERE id = ? AND status = 'active'", [$status, $now, $c['id']]) === 1) {
                    if ($refund) {
                        self::book($c['member_id'], 'refund', (int) $c['points'], 'Code ' . $c['code'] . ' ist abgelaufen – Punkte zurück', $c['id']);
                    } else {
                        Push::queue($c['member_id'], 'code_lapsed', ['code' => $c['code'], 'euro' => Util::euro((int) $c['value_cents'])], 'lapsed:' . $c['id']);
                    }
                    $expired++;
                }
            });
        }
        // Abgebrochenes Anlegen (z. B. Zeitüberschreitung): Punkte zurück
        foreach (Db::all("SELECT * FROM club_codes WHERE status = 'creating' AND created_at < ?", [$now - 10 * 60 * 1000]) as $c) {
            Db::exec('DELETE FROM club_ledger WHERE ref = ? AND kind = ?', [$c['id'], 'redeem']);
            Db::exec("UPDATE club_codes SET status = 'failed', updated_at = ? WHERE id = ?", [$now, $c['id']]);
            Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$c['member_id']]);
        }
        return "$expired abgelaufen";
    }

    /** Täglich: Erinnerung an Codes, die in den nächsten 7 Tagen ablaufen. */
    public static function warnCodes(): int
    {
        $now = Util::now();
        $n = 0;
        foreach (Db::all("SELECT * FROM club_codes WHERE status = 'active' AND expires_at > ? AND expires_at <= ?", [$now, $now + 7 * self::DAY_MS]) as $c) {
            $n += Push::queue($c['member_id'], 'code_expiring', [
                'code' => $c['code'],
                'euro' => Util::euro((int) $c['value_cents']),
                'datum' => date('d.m.Y', intdiv((int) $c['expires_at'], 1000)),
            ], 'codewarn:' . $c['id']) ? 1 : 0;
        }
        return $n;
    }

    // ---------- Kontostand in Shopify (Kunden-Metafelder club.*) ----------

    public static function pushMetafields(int $max = 80): string
    {
        $rows = Db::all('SELECT * FROM club_members WHERE joined_at IS NOT NULL AND meta_dirty = 1 AND test = 0 LIMIT ' . $max);
        $done = 0;
        foreach (array_chunk($rows, 6) as $chunk) {
            $fields = [];
            foreach ($chunk as $m) {
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'punkte', 'type' => 'number_integer', 'value' => (string) self::balance($m['id'])];
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'punkte_ausstehend', 'type' => 'number_integer', 'value' => (string) (self::pending($m['id']) + self::locked($m['id']))];
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'mitglied_seit', 'type' => 'date', 'value' => date('Y-m-d', intdiv((int) $m['joined_at'], 1000))];
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'stufe', 'type' => 'single_line_text_field', 'value' => Tiers::of($m)['key']];
            }
            $d = Shopify::graphql(
                'mutation ClubMeta($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { key } userErrors { field message } } }',
                ['m' => $fields]
            );
            Shopify::check($d['metafieldsSet'] ?? [], 'Metafelder');
            $ids = array_column($chunk, 'id');
            Db::exec('UPDATE club_members SET meta_dirty = 0 WHERE id IN (' . Db::marks($ids) . ')', $ids);
            $done += count($chunk);
        }
        return "$done Kontostände an Shopify übertragen";
    }
}
