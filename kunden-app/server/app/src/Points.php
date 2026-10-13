<?php
declare(strict_types=1);

namespace Club;

/**
 * Treuepunkte.
 *
 * Punkte je Bestellung werden bei jedem Abgleich aus dem aktuellen Stand der Bestellung berechnet
 * (Warenwert nach Rabatten und Rücksendungen, ohne Versand). Sie sind zuerst „unterwegs“ und werden
 * verfügbar, sobald die Bestellung bezahlt, komplett versendet und die Wartezeit (Widerrufsfrist) vorbei ist.
 * Storniert oder erstattet → keine Punkte. Alle anderen Buchungen stehen im Journal (ledger).
 *
 * Kontostand = verfügbare Bestellpunkte + Summe des Journals.
 */
final class Points
{
    public const DEFAULTS = [
        'name' => 'Perfume Cloud Club',
        'active' => true,          // Einlösen möglich
        'earn_per_euro' => 1.0,    // Punkte je 1 € Warenwert
        'redeem_points' => 100,    // so viele Punkte …
        'redeem_cents' => 500,     // … sind so viel wert
        'max_cents' => 5000,       // höchster Wert je Code
        'code_days' => 90,         // so lange gilt ein Code
        'wait_days' => 14,         // nach dem Versand, bis die Punkte verfügbar sind
        'welcome_points' => 50,    // Bonus beim Beitritt
        'retro_days' => 30,        // Bestellungen so viele Tage vor dem Beitritt zählen mit
        'max_open_codes' => 3,     // gleichzeitig offene Codes je Person
        'count_test' => false,     // Testbestellungen zählen (nur zum Ausprobieren)
        'bind_customer' => true,   // Code gilt nur für das eigene Kundenkonto
        'combine_shipping' => true,
        'combine_order' => false,
        'combine_product' => false,
    ];

    private const DAY_MS = 86400 * 1000;
    private const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function program(): array
    {
        $p = Settings::get('program', []);
        return array_merge(self::DEFAULTS, is_array($p) ? $p : []);
    }

    public static function saveProgram(array $in): array
    {
        $p = self::program();
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
        foreach (['active', 'count_test', 'bind_customer', 'combine_shipping', 'combine_order', 'combine_product'] as $flag) {
            if (array_key_exists($flag, $in)) {
                $p[$flag] = (bool) $in[$flag];
            }
        }
        if (array_key_exists('name', $in)) {
            $name = Util::str($in['name'], 60, false);
            $p['name'] = $name !== '' ? $name : self::DEFAULTS['name'];
        }
        if ($p['max_cents'] < $p['redeem_cents']) {
            throw new HttpError(422, 'Der Höchstwert je Code muss mindestens so groß sein wie eine Stufe.');
        }
        Settings::set('program', $p);
        return $p;
    }

    /** Was Kundinnen und Kunden über die Regeln sehen. */
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
            'wait_days' => $p['wait_days'],
            'welcome_points' => $p['welcome_points'],
            'retro_days' => $p['retro_days'],
        ];
    }

    // ---------- Punkte je Bestellung ----------

    /**
     * Punkte und Status einer Shopify-Bestellung. null = liegt vor dem Zeitraum des Clubs (zählt nicht).
     * @return array{points:int, status:string, reason:?string, amount_cents:int, shipped_at:?int, available_at:?int, ordered_at:int}|null
     */
    public static function compute(array $o, array $member, array $prog, int $now): ?array
    {
        $ordered = Util::ms($o['processedAt'] ?? $o['createdAt'] ?? null) ?? $now;
        $joined = (int) ($member['joined_at'] ?? 0);
        if (!$joined || $ordered < $joined - (int) $prog['retro_days'] * self::DAY_MS) {
            return null;
        }
        $amount = max(0, Util::cents($o['currentSubtotalPriceSet']['shopMoney']['amount'] ?? 0));
        $points = (int) floor($amount * (float) $prog['earn_per_euro'] / 100 + 1e-9);
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

    /** Schreibt den aktuellen Stand einer Bestellung. Gibt true zurück, wenn sich der Kontostand ändern kann. */
    public static function upsertOrder(array $member, array $o, ?array $prog = null): bool
    {
        $prog ??= self::program();
        $now = Util::now();
        self::markCodesUsed($member, $o);
        $c = self::compute($o, $member, $prog, $now);
        if ($c === null) {
            return false;
        }
        $id = (string) $o['id'];
        $old = Db::one('SELECT points, status, reason, available_at FROM club_orders WHERE order_id = ?', [$id]);
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
            'updated_at' => $now,
        ];
        if ($old) {
            if ((int) $old['points'] === $c['points'] && $old['status'] === $c['status'] && $old['reason'] === $c['reason']
                && (int) ($old['available_at'] ?? 0) === (int) ($c['available_at'] ?? 0)) {
                return false;
            }
            Db::update('club_orders', $row, ['order_id' => $id]);
        } else {
            Db::insert('club_orders', ['order_id' => $id] + $row);
        }
        Db::exec('UPDATE members SET meta_dirty = 1 WHERE id = ?', [$member['id']]);
        return true;
    }

    /** Rabattcodes aus dieser Bestellung als verwendet markieren. */
    private static function markCodesUsed(array $member, array $o): void
    {
        $used = array_map('strtoupper', array_filter((array) ($o['discountCodes'] ?? []), 'is_string'));
        if (!$used) {
            return;
        }
        $marks = implode(',', array_fill(0, count($used), '?'));
        $rows = Db::all("SELECT * FROM codes WHERE member_id = ? AND status IN ('active', 'expired', 'cancelled') AND code IN ($marks)", array_merge([$member['id']], $used));
        foreach ($rows as $c) {
            Db::update('codes', [
                'status' => 'used',
                'used_at' => Util::ms($o['processedAt'] ?? null) ?? Util::now(),
                'order_name' => mb_substr((string) ($o['name'] ?? ''), 0, 40),
                'updated_at' => Util::now(),
            ], ['id' => $c['id']]);
            // Kurz vor Ablauf benutzt, aber schon zurückgebucht (Shopify zählt Nutzungen verzögert): Rückbuchung aufheben
            if ($c['status'] !== 'active') {
                self::book($member['id'], 'adjust', -(int) $c['points'], 'Code ' . $c['code'] . ' wurde doch verwendet (' . ($o['name'] ?? '') . ')', $c['id']);
            }
        }
    }

    private const ORDER_FIELDS = 'id name processedAt createdAt cancelledAt test fullyPaid displayFulfillmentStatus discountCodes
        currentSubtotalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }
        fulfillments(first: 10) { status createdAt }';

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
        foreach ($d['customer']['orders']['nodes'] ?? [] as $o) {
            $n += self::upsertOrder($member, $o, $prog) ? 1 : 0;
        }
        Db::exec('UPDATE members SET orders_synced_at = ? WHERE id = ?', [Util::now(), $member['id']]);
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
                    pageInfo { hasNextPage endCursor } nodes { updatedAt customer { id } ' . self::ORDER_FIELDS . ' } } }',
                ['q' => "updated_at:>='$cursor'", 'after' => $after]
            );
            $orders = $d['orders']['nodes'] ?? [];
            $ids = array_values(array_unique(array_filter(array_map(static fn ($o) => $o['customer']['id'] ?? null, $orders))));
            $members = [];
            if ($ids) {
                $marks = implode(',', array_fill(0, count($ids), '?'));
                foreach (Db::all("SELECT * FROM members WHERE joined_at IS NOT NULL AND shopify_id IN ($marks)", $ids) as $m) {
                    $members[$m['shopify_id']] = $m;
                }
            }
            foreach ($orders as $o) {
                $seen++;
                if (($o['updatedAt'] ?? '') > $newest) {
                    $newest = (string) $o['updatedAt'];
                }
                $m = $members[$o['customer']['id'] ?? ''] ?? null;
                if ($m) {
                    $changed += self::upsertOrder($m, $o, $prog) ? 1 : 0;
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

    /** Punkte, deren Wartezeit vorbei ist, freigeben. */
    public static function release(): int
    {
        $now = Util::now();
        $ids = Db::all("SELECT DISTINCT member_id FROM club_orders WHERE status = 'pending' AND reason = 'wait' AND available_at <= ?", [$now]);
        $n = Db::exec("UPDATE club_orders SET status = 'available', reason = NULL, updated_at = ? WHERE status = 'pending' AND reason = 'wait' AND available_at <= ?", [$now, $now]);
        foreach ($ids as $r) {
            Db::exec('UPDATE members SET meta_dirty = 1 WHERE id = ?', [$r['member_id']]);
        }
        return $n;
    }

    // ---------- Kontostand und Verlauf ----------

    public static function balance(string $memberId): int
    {
        $orders = (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE member_id = ? AND status = 'available'", [$memberId]);
        $ledger = (int) Db::value('SELECT COALESCE(SUM(points), 0) FROM ledger WHERE member_id = ?', [$memberId]);
        return $orders + $ledger;
    }

    public static function pending(string $memberId): int
    {
        return (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE member_id = ? AND status = 'pending'", [$memberId]);
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
            'value_cents' => $affordable * (int) $p['redeem_cents'],
            'to_next' => $affordable >= $maxSteps ? 0 : (int) $p['redeem_points'] - (max(0, $balance) % (int) $p['redeem_points']),
            'next_cents' => min($maxSteps, $affordable + 1) * (int) $p['redeem_cents'],
            'steps' => $steps,
            'lifetime' => (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE member_id = ? AND status = 'available'", [$member['id']])
                + (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM ledger WHERE member_id = ? AND points > 0 AND kind <> 'refund'", [$member['id']]),
        ];
    }

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
                'at' => (int) $o['ordered_at'],
            ];
        }
        $titles = ['welcome' => 'Willkommensbonus', 'redeem' => 'Eingelöst', 'refund' => 'Zurückgebucht', 'adjust' => 'Gutschrift vom Team'];
        foreach (Db::all('SELECT * FROM ledger WHERE member_id = ? ORDER BY created_at DESC LIMIT ' . $limit, [$memberId]) as $l) {
            $title = $titles[$l['kind']] ?? 'Buchung';
            if ($l['kind'] === 'adjust' && (int) $l['points'] < 0) {
                $title = 'Korrektur vom Team';
            }
            $items[] = [
                'id' => 'l' . $l['id'],
                'kind' => $l['kind'],
                'title' => $title,
                'note' => $l['note'],
                'points' => (int) $l['points'],
                'status' => 'available',
                'at' => (int) $l['created_at'],
            ];
        }
        usort($items, static fn ($a, $b) => $b['at'] <=> $a['at']);
        return array_slice($items, 0, $limit);
    }

    public static function welcome(array $member): void
    {
        $bonus = (int) self::program()['welcome_points'];
        if ($bonus <= 0 || Db::value("SELECT 1 FROM ledger WHERE member_id = ? AND kind = 'welcome'", [$member['id']])) {
            return;
        }
        self::book($member['id'], 'welcome', $bonus, 'Schön, dass du dabei bist!');
    }

    public static function adjust(array $admin, string $memberId, int $points, string $note): void
    {
        if ($points === 0 || abs($points) > 100000) {
            throw new HttpError(422, 'Bitte eine Punktzahl angeben (z. B. 50 oder -20).');
        }
        if (!Db::value('SELECT 1 FROM members WHERE id = ?', [$memberId])) {
            throw new HttpError(404, 'Mitglied nicht gefunden.');
        }
        self::book($memberId, 'adjust', $points, $note !== '' ? $note : null, null, $admin['id']);
    }

    private static function book(string $memberId, string $kind, int $points, ?string $note, ?string $ref = null, ?string $by = null): string
    {
        $id = Util::uuid();
        Db::insert('ledger', [
            'id' => $id,
            'member_id' => $memberId,
            'kind' => $kind,
            'points' => $points,
            'note' => $note !== null ? mb_substr($note, 0, 250) : null,
            'ref' => $ref,
            'created_by' => $by,
            'created_at' => Util::now(),
        ]);
        Db::exec('UPDATE members SET meta_dirty = 1 WHERE id = ?', [$memberId]);
        return $id;
    }

    // ---------- Einlösen: persönlicher Rabattcode in Shopify ----------

    public static function codes(string $memberId): array
    {
        $rows = Db::all("SELECT * FROM codes WHERE member_id = ? AND status <> 'failed' ORDER BY created_at DESC LIMIT 50", [$memberId]);
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
            Db::lockRow('members', $member['id']);
            $open = (int) Db::value("SELECT COUNT(*) FROM codes WHERE member_id = ? AND status IN ('active', 'creating')", [$member['id']]);
            if ($open >= (int) $p['max_open_codes']) {
                throw new HttpError(409, 'Du hast schon ' . $open . ' offene Codes. Löse erst einen davon ein.');
            }
            if (self::balance($member['id']) < $points) {
                throw new HttpError(422, 'Dafür reichen deine Punkte noch nicht.');
            }
            Db::insert('codes', [
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
            return self::book($member['id'], 'redeem', -$points, 'Code ' . $code . ' über ' . Util::euro($value), $codeId);
        });

        // … dann den Code in Shopify anlegen. Klappt das nicht, werden die Punkte zurückgebucht.
        try {
            $discountId = self::createDiscount($member, $code, $value, $now, $expires, $p);
        } catch (\Throwable $e) {
            Util::log('Rabattcode: ' . $e->getMessage());
            Db::exec('DELETE FROM ledger WHERE id = ?', [$ledgerId]);
            Db::exec("UPDATE codes SET status = 'failed', updated_at = ? WHERE id = ?", [Util::now(), $codeId]);
            throw new HttpError(502, 'Der Code konnte gerade nicht erstellt werden. Deine Punkte sind unverändert – bitte versuche es gleich noch einmal.');
        }
        Db::exec("UPDATE codes SET status = 'active', discount_id = ?, updated_at = ? WHERE id = ?", [$discountId, Util::now(), $codeId]);
        return self::publicCode(Db::one('SELECT * FROM codes WHERE id = ?', [$codeId]));
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
        } while (Db::value('SELECT 1 FROM codes WHERE code = ?', [$code]));
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

    private static function deleteDiscount(?string $discountId): void
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
        $c = Db::one("SELECT * FROM codes WHERE id = ? AND member_id = ?", [$codeId, $member['id']]);
        if (!$c || $c['status'] !== 'active') {
            throw new HttpError(404, 'Diesen Code gibt es nicht mehr.');
        }
        if ((self::usage($c['discount_id']) ?? 0) > 0) {
            Db::exec("UPDATE codes SET status = 'used', used_at = ?, updated_at = ? WHERE id = ?", [Util::now(), Util::now(), $c['id']]);
            throw new HttpError(409, 'Der Code wurde bereits bei einer Bestellung verwendet.');
        }
        self::deleteDiscount($c['discount_id']);
        Db::tx(static function () use ($c): void {
            if (Db::exec("UPDATE codes SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'", [Util::now(), $c['id']]) === 1) {
                self::book($c['member_id'], 'refund', (int) $c['points'], 'Code ' . $c['code'] . ' zurückgegeben', $c['id']);
            }
        });
        return self::publicCode(Db::one('SELECT * FROM codes WHERE id = ?', [$c['id']]));
    }

    /** Cronjob: abgelaufene Codes zurückbuchen, hängengebliebene aufräumen. */
    public static function checkCodes(): string
    {
        $now = Util::now();
        $expired = 0;
        foreach (Db::all("SELECT * FROM codes WHERE status = 'active' AND expires_at <= ? LIMIT 50", [$now]) as $c) {
            $used = self::usage($c['discount_id']);
            if ($used !== null && $used > 0) {
                Db::exec("UPDATE codes SET status = 'used', used_at = COALESCE(used_at, ?), updated_at = ? WHERE id = ?", [$now, $now, $c['id']]);
                continue;
            }
            self::deleteDiscount($c['discount_id']);
            Db::tx(static function () use ($c, $now, &$expired): void {
                if (Db::exec("UPDATE codes SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'active'", [$now, $c['id']]) === 1) {
                    self::book($c['member_id'], 'refund', (int) $c['points'], 'Code ' . $c['code'] . ' ist abgelaufen – Punkte zurück', $c['id']);
                    $expired++;
                }
            });
        }
        // Abgebrochenes Anlegen (z. B. Zeitüberschreitung): Punkte zurück
        foreach (Db::all("SELECT * FROM codes WHERE status = 'creating' AND created_at < ?", [$now - 10 * 60 * 1000]) as $c) {
            Db::exec('DELETE FROM ledger WHERE ref = ? AND kind = ?', [$c['id'], 'redeem']);
            Db::exec("UPDATE codes SET status = 'failed', updated_at = ? WHERE id = ?", [$now, $c['id']]);
            Db::exec('UPDATE members SET meta_dirty = 1 WHERE id = ?', [$c['member_id']]);
        }
        return "$expired abgelaufen";
    }

    // ---------- Kontostand in Shopify (Kunden-Metafelder club.*) ----------

    public static function pushMetafields(int $max = 80): string
    {
        $rows = Db::all('SELECT * FROM members WHERE joined_at IS NOT NULL AND meta_dirty = 1 LIMIT ' . $max);
        $done = 0;
        foreach (array_chunk($rows, 8) as $chunk) {
            $fields = [];
            foreach ($chunk as $m) {
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'punkte', 'type' => 'number_integer', 'value' => (string) self::balance($m['id'])];
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'punkte_ausstehend', 'type' => 'number_integer', 'value' => (string) self::pending($m['id'])];
                $fields[] = ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => 'mitglied_seit', 'type' => 'date', 'value' => date('Y-m-d', intdiv((int) $m['joined_at'], 1000))];
            }
            $d = Shopify::graphql(
                'mutation ClubMeta($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { key } userErrors { field message } } }',
                ['m' => $fields]
            );
            Shopify::check($d['metafieldsSet'] ?? [], 'Metafelder');
            $ids = array_column($chunk, 'id');
            $marks = implode(',', array_fill(0, count($ids), '?'));
            Db::exec("UPDATE members SET meta_dirty = 0 WHERE id IN ($marks)", $ids);
            $done += count($chunk);
        }
        return "$done Kontostände an Shopify übertragen";
    }
}
