<?php
declare(strict_types=1);

namespace Club;

/**
 * Probelauf (nur Admins, gesteuert aus der Team-App): den ganzen Weg einer Bestellung durchspielen –
 * eingegangen → Punkte vorgemerkt → versendet → zugestellt → Befragung → Punkte gutgeschrieben →
 * Empfehlung belohnt → Stufenaufstieg.
 *
 * Dafür gibt es ein eigenes Testkonto (club_members.test = 1). Push-Nachrichten an dieses Konto landen auf
 * den Geräten des Admins (falls er mit seiner E-Mail im Club ist), Mails an seiner Adresse. Testkonten zählen
 * nicht in Auswertungen und werden beim Aufräumen vollständig gelöscht.
 *
 * Schnelltest („sim“): Die Bestellung wird nur nachgestellt, jeder Schritt per Knopf.
 * Echte Bestellung („real“): Zwei Einmal-Codes (Ware 100 %, Versand gratis) für eine 0-€-Bestellung im Shop.
 * Die echte Bestellung läuft durch Versand (Team-App) und Zustellung; das Testkonto bekommt dafür Punkte,
 * als hätte die Bestellung den eingestellten Betrag. Schritte, die dauern (Zustellung, Wartezeit), lassen
 * sich überspringen. Die Bestellung storniert beim Aufräumen die Team-App (braucht write_orders).
 */
final class Trial
{
    public const STEPS = [
        'ordered' => 'Bestellung eingegangen',
        'pending' => 'Punkte vorgemerkt',
        'shipped' => 'Versendet',
        'delivered' => 'Zugestellt',
        'survey' => 'Befragung',
        'credited' => 'Punkte gutgeschrieben',
        'referral' => 'Empfehlung belohnt',
        'tier' => 'Stufenaufstieg',
    ];

    /** Push-Vorlage je Schritt (für die Anzeige „Push angekommen?“) */
    private const PUSH = [
        'shipped' => 'order_shipped',
        'delivered' => 'order_delivered',
        'survey' => 'survey',
        'credited' => 'points_credited',
        'referral' => 'referral_order',
        'tier' => 'tier_up',
    ];

    private static ?array $state = null;
    private static bool $loaded = false;

    public static function state(): ?array
    {
        if (!self::$loaded) {
            $s = Settings::get('trial');
            self::$state = is_array($s) && !empty($s['member_id']) ? $s : null;
            self::$loaded = true;
        }
        return self::$state;
    }

    private static function put(?array $s): void
    {
        if ($s === null) {
            Settings::delete('trial');
        } else {
            Settings::set('trial', $s);
        }
        self::$state = $s;
        self::$loaded = true;
    }

    public static function resetCache(): void
    {
        self::$loaded = false;
        self::$state = null;
    }

    // ---------- Push an die Geräte des Admins ----------

    /** Push für das Testkonto geht an die Geräte des Admins. */
    public static function deviceMemberId(string $memberId): string
    {
        $s = self::state();
        return $s && $memberId === $s['member_id'] && !empty($s['device_member_id']) ? (string) $s['device_member_id'] : $memberId;
    }

    // ---------- Start ----------

    public static function start(array $user, array $in): array
    {
        if (self::state()) {
            throw new HttpError(409, 'Es läuft schon ein Probelauf. Bitte erst aufräumen.');
        }
        $mode = ($in['mode'] ?? 'sim') === 'real' ? 'real' : 'sim';
        $amount = (int) ($in['amount_cents'] ?? 5900);
        if ($amount < 100 || $amount > 100000) {
            throw new HttpError(422, 'Bitte einen Betrag zwischen 1 € und 1.000 € wählen.');
        }
        if ($mode === 'real' && !Shopify::configured()) {
            throw new HttpError(503, 'Für eine echte Testbestellung muss Shopify verbunden sein.');
        }
        $email = mb_strtolower((string) ($user['email'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Für den Probelauf fehlt deine E-Mail-Adresse.');
        }
        $now = Util::now();
        $id = Util::uuid();
        $first = explode(' ', trim((string) ($user['name'] ?? '')))[0] ?: 'Probelauf';
        Db::insert('club_members', [
            'id' => $id,
            'shopify_id' => 'probelauf:' . $id,
            'email' => 'probelauf+' . substr($id, 0, 8) . '@club.invalid',
            'first_name' => $first,
            'last_name' => '(Probelauf)',
            'joined_at' => $now,
            'last_seen_at' => null,
            'orders_synced_at' => $now,
            'meta_dirty' => 0,
            'created_at' => $now,
            'updated_at' => $now,
            'tier' => Tiers::KEYS[0],
            'test' => 1,
        ]);
        $device = Db::value('SELECT id FROM club_members WHERE email = ? AND joined_at IS NOT NULL AND test = 0', [$email]);
        $state = [
            'id' => Util::uuid(),
            'mode' => $mode,
            'by' => (string) ($user['name'] ?? 'Team'),
            'email' => $email,
            'member_id' => $id,
            'device_member_id' => $device ?: null,
            'amount_cents' => $amount,
            'order_id' => null,
            'order_name' => null,
            'codes' => [],
            'skip_wait' => false,
            'started_at' => $now,
        ];
        if ($mode === 'real') {
            $suffix = strtoupper(substr(bin2hex(random_bytes(3)), 0, 5));
            $code = 'PROBE-' . $suffix;
            $ship = 'PROBE-' . $suffix . '-VERSAND';
            $base = [
                'startsAt' => Util::iso($now - 60000),
                'endsAt' => Util::iso($now + 3 * Points::DAY_MS),
                'usageLimit' => 1,
                'appliesOncePerCustomer' => true,
                'context' => ['all' => 'ALL'],
            ];
            $d = Shopify::graphql(
                'mutation ClubTrialCode($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message code } } }',
                ['input' => $base + [
                    'title' => 'Club-Probelauf (Ware) · ' . $state['by'],
                    'code' => $code,
                    'customerGets' => ['value' => ['percentage' => 1.0], 'items' => ['all' => true]],
                    'combinesWith' => ['shippingDiscounts' => true, 'orderDiscounts' => false, 'productDiscounts' => false],
                ]]
            );
            Shopify::check($d['discountCodeBasicCreate'] ?? [], 'Probelauf-Code');
            $state['codes'][] = ['code' => $code, 'id' => $d['discountCodeBasicCreate']['codeDiscountNode']['id'] ?? null];
            $d = Shopify::graphql(
                'mutation ClubTrialShip($input: DiscountCodeFreeShippingInput!) { discountCodeFreeShippingCreate(freeShippingCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message code } } }',
                ['input' => $base + [
                    'title' => 'Club-Probelauf (Versand) · ' . $state['by'],
                    'code' => $ship,
                    'destination' => ['all' => true],
                    'combinesWith' => ['shippingDiscounts' => false, 'orderDiscounts' => true, 'productDiscounts' => true],
                ]]
            );
            Shopify::check($d['discountCodeFreeShippingCreate'] ?? [], 'Probelauf-Versandcode');
            $state['codes'][] = ['code' => $ship, 'id' => $d['discountCodeFreeShippingCreate']['codeDiscountNode']['id'] ?? null];
        }
        self::put($state);
        Util::log('Probelauf gestartet (' . $mode . ') von ' . $email);
        return self::view();
    }

    // ---------- Echte Bestellung aus dem Abgleich ----------

    public static function isTrialOrder(array $o): bool
    {
        $s = self::state();
        if (!$s || $s['mode'] !== 'real') {
            return false;
        }
        if ($s['order_id'] !== null) {
            return (string) $o['id'] === $s['order_id'];
        }
        $codes = array_map('strtoupper', array_filter((array) ($o['discountCodes'] ?? []), 'is_string'));
        return (bool) array_intersect($codes, array_column($s['codes'], 'code'));
    }

    /** Echte Testbestellung: dem Testkonto zuordnen (mit dem Probelauf-Betrag statt 0 €). */
    public static function onOrder(array $o): void
    {
        $s = self::state();
        if (!$s) {
            return;
        }
        if ($s['order_id'] === null) {
            $s['order_id'] = (string) $o['id'];
            $s['order_name'] = (string) ($o['name'] ?? '');
            self::put($s);
        }
        $member = Db::one('SELECT * FROM club_members WHERE id = ?', [$s['member_id']]);
        if (!$member) {
            return;
        }
        Points::upsertOrder($member, $o);
        $o['email'] = $s['email'];
        Surveys::consider(self::adjust($o, $member), Db::one('SELECT * FROM club_members WHERE id = ?', [$s['member_id']]), true);
    }

    /**
     * Bestellung des Testkontos anpassen: Betrag des Probelaufs, übersprungene Wartezeit.
     * Wird von Points::upsertOrder für Testkonten aufgerufen.
     */
    public static function adjust(array $o, array $member): array
    {
        $s = self::state();
        if (!$s || $member['id'] !== $s['member_id']) {
            return $o;
        }
        $amount = Util::decimal((int) $s['amount_cents']);
        $o['currentSubtotalPriceSet'] = ['shopMoney' => ['amount' => $amount]];
        $o['totalRefundedSet'] = ['shopMoney' => ['amount' => '0.00']];
        if (!empty($s['skip_wait']) && !empty($o['fulfillments'])) {
            $back = Util::iso(Util::now() - ((int) Points::program()['wait_days'] + 1) * Points::DAY_MS);
            foreach ($o['fulfillments'] as &$f) {
                $f['createdAt'] = $back;
            }
            unset($f);
        }
        $o['test'] = false;
        return $o;
    }

    // ---------- Schritte ----------

    private static function member(): array
    {
        $s = self::state();
        $m = $s ? Db::one('SELECT * FROM club_members WHERE id = ?', [$s['member_id']]) : null;
        if (!$m) {
            throw new HttpError(404, 'Es läuft kein Probelauf.');
        }
        return $m;
    }

    /** Nachgestellte Shopify-Bestellung für den Schnelltest. */
    private static function fakeOrder(array $s, bool $paid, ?int $shipped, ?int $delivered): array
    {
        $ordered = (int) $s['started_at'];
        $o = [
            'id' => (string) $s['order_id'],
            'name' => (string) $s['order_name'],
            'email' => $s['email'],
            'processedAt' => Util::iso($ordered),
            'createdAt' => Util::iso($ordered),
            'cancelledAt' => null,
            'test' => false,
            'fullyPaid' => $paid,
            'displayFulfillmentStatus' => $shipped ? 'FULFILLED' : 'UNFULFILLED',
            'discountCodes' => [],
            'currentSubtotalPriceSet' => ['shopMoney' => ['amount' => Util::decimal((int) $s['amount_cents'])]],
            'totalRefundedSet' => ['shopMoney' => ['amount' => '0.00']],
            'customer' => ['id' => 'probelauf:' . $s['member_id'], 'firstName' => null],
            'lineItems' => ['nodes' => self::sampleLines()],
            'fulfillments' => $shipped ? [[
                'status' => 'SUCCESS',
                'createdAt' => Util::iso($shipped),
                'deliveredAt' => $delivered ? Util::iso($delivered) : null,
                'displayStatus' => $delivered ? 'DELIVERED' : 'IN_TRANSIT',
            ]] : [],
        ];
        return $o;
    }

    /** Düfte der letzten echten Bestellung, sonst ein Musterduft. */
    private static function sampleLines(): array
    {
        $items = json_decode((string) (Db::value('SELECT items FROM club_surveys WHERE test = 0 ORDER BY created_at DESC') ?? ''), true) ?: [];
        if (!$items) {
            return [['title' => 'Sunset Dune', 'variantTitle' => '50 ml', 'currentQuantity' => 1, 'isGiftCard' => false, 'image' => null, 'product' => null]];
        }
        return array_map(static fn ($i) => [
            'title' => $i['title'],
            'variantTitle' => $i['variant'],
            'currentQuantity' => 1,
            'isGiftCard' => false,
            'image' => $i['image'] ? ['url' => $i['image']] : null,
            'product' => str_starts_with((string) $i['key'], 'p') ? ['id' => 'gid://shopify/Product/' . substr((string) $i['key'], 1), 'handle' => null, 'onlineStoreUrl' => $i['url']] : null,
        ], array_slice($items, 0, 2));
    }

    private static function orderRow(array $s): ?array
    {
        return $s['order_id'] ? Db::one('SELECT * FROM club_orders WHERE order_id = ? AND member_id = ?', [$s['order_id'], $s['member_id']]) : null;
    }

    private static function surveyRow(array $s): ?array
    {
        return $s['order_id'] ? Db::one('SELECT * FROM club_surveys WHERE order_id = ?', [$s['order_id']]) : null;
    }

    public static function step(string $key): array
    {
        $s = self::state();
        if (!$s) {
            throw new HttpError(404, 'Es läuft kein Probelauf.');
        }
        if (!isset(self::STEPS[$key])) {
            throw new HttpError(422, 'Unbekannter Schritt.');
        }
        $m = self::member();
        $now = Util::now();
        $real = $s['mode'] === 'real';
        $order = self::orderRow($s);
        $need = static function (bool $ok, string $msg): void {
            if (!$ok) {
                throw new HttpError(409, $msg);
            }
        };

        switch ($key) {
            case 'ordered':
            case 'pending':
                if ($real) {
                    throw new HttpError(409, 'Bitte im Shop mit dem Code ' . ($s['codes'][0]['code'] ?? '') . ' bestellen – der Abgleich erkennt die Bestellung dann von selbst (spätestens nach 15 Minuten, sofort mit „Jetzt abgleichen“).');
                }
                if (!$s['order_id']) {
                    $s['order_id'] = 'probelauf:' . $s['id'];
                    $s['order_name'] = '#PROBE-' . strtoupper(substr($s['id'], 0, 4));
                    self::put($s);
                }
                $o = self::fakeOrder($s, $key === 'pending', null, null);
                Points::upsertOrder($m, $o);
                Surveys::consider($o, $m, true);
                break;
            case 'shipped':
                $need($real || $order !== null, 'Erst die Bestellung anlegen.');
                if ($real) {
                    throw new HttpError(409, 'Die echte Testbestellung bitte in der Team-App unter „Versand“ als versendet markieren – genau wie im Alltag.');
                }
                if (!$order || $order['reason'] === 'payment') {
                    Points::upsertOrder($m, self::fakeOrder($s, true, null, null));
                }
                $o = self::fakeOrder($s, true, $now, null);
                Points::upsertOrder(Db::one('SELECT * FROM club_members WHERE id = ?', [$m['id']]), $o);
                Surveys::consider($o, $m, true);
                break;
            case 'delivered':
                $need($order !== null && $order['shipped_at'] !== null, 'Die Bestellung ist noch nicht versendet.');
                if ($real) {
                    // Zustellung vorziehen: Paket ist noch unterwegs, der Club tut so, als wäre es da
                    Db::exec('UPDATE club_orders SET delivered_at = ?, updated_at = ? WHERE order_id = ?', [$now, $now, $s['order_id']]);
                    Push::queue($m, 'order_delivered', ['bestellung' => $s['order_name']], 'delivered:' . $s['order_id'], '/bestellungen');
                    $row = self::surveyRow($s);
                    if ($row && in_array($row['status'], ['waiting', 'scheduled'], true)) {
                        Db::update('club_surveys', ['delivered_at' => $now, 'send_at' => $now + (int) Surveys::config()['delay_days'] * Points::DAY_MS, 'status' => 'scheduled', 'updated_at' => $now], ['id' => $row['id']]);
                    }
                } else {
                    $o = self::fakeOrder($s, true, (int) $order['shipped_at'], $now);
                    Points::upsertOrder($m, $o);
                    Surveys::consider($o, $m, true);
                }
                break;
            case 'survey':
                $row = self::surveyRow($s);
                $need($row !== null, 'Für diese Bestellung gibt es noch keine Befragung – erst die Bestellung anlegen.');
                $need($row['delivered_at'] !== null || $row['shipped_at'] !== null, 'Die Befragung kommt nach der Zustellung – erst „Zugestellt“ auslösen.');
                $r = Surveys::send($row, true);
                return self::view(['message' => 'Befragung verschickt (' . ($r['channel'] ?? 'ohne Weg') . ').' . ($r['mail'] && !$r['mail']['sent'] ? ' Mail: ' . $r['mail']['message'] : '')]);
            case 'credited':
                $need($order !== null && $order['shipped_at'] !== null, 'Punkte gibt es erst nach dem Versand.');
                $s['skip_wait'] = true;
                self::put($s);
                if ($order['status'] === 'pending' && $order['reason'] === 'wait') {
                    Db::exec('UPDATE club_orders SET available_at = ? WHERE order_id = ?', [$now, $s['order_id']]);
                    Points::release();
                }
                break;
            case 'referral':
                $c = Referrals::config();
                $amount = (int) $s['amount_cents'];
                $oid = 'probelauf:ref:' . $s['id'];
                if (!Db::value('SELECT 1 FROM club_referral_orders WHERE order_id = ?', [$oid])) {
                    $points = Referrals::pointsFor($amount, $c);
                    Db::insert('club_referral_orders', [
                        'order_id' => $oid,
                        'member_id' => $m['id'],
                        'code' => 'PROBELAUF',
                        'order_name' => '#PROBE-FREUND',
                        'friend_customer_id' => null,
                        'ordered_at' => $now,
                        'amount_cents' => $amount,
                        'points' => $points,
                        'status' => 'pending',
                        'reason' => 'wait',
                        'shipped_at' => $now,
                        'available_at' => $now,
                        'credited_at' => null,
                        'ledger_id' => null,
                        'test' => 1,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                    Push::queue($m, 'referral_pending', ['punkte' => (string) $points], 'refpend:' . $oid, '/konto');
                }
                Referrals::release();
                break;
            case 'tier':
                $p = Points::program();
                $need((bool) $p['tiers_enabled'], 'Stufen sind in den Einstellungen ausgeschaltet.');
                $tiers = $p['tiers'];
                $cur = array_search(Tiers::of($m)['key'], array_column($tiers, 'key'), true);
                $next = $tiers[min(count($tiers) - 1, (int) $cur + 1)];
                $need((int) $cur < count($tiers) - 1, 'Das Testkonto ist schon in der höchsten Stufe.');
                $gap = max(100, (int) $next['min_cents'] - Tiers::spend($m['id']));
                $oid = 'probelauf:tier:' . $s['id'] . ':' . $next['key'];
                if (!Db::value('SELECT 1 FROM club_orders WHERE order_id = ?', [$oid])) {
                    Db::insert('club_orders', [
                        'order_id' => $oid,
                        'member_id' => $m['id'],
                        'name' => '#PROBE-' . strtoupper($next['key']),
                        'ordered_at' => $now,
                        'amount_cents' => $gap,
                        'points' => 0,
                        'status' => 'available',
                        'reason' => null,
                        'shipped_at' => $now,
                        'available_at' => $now,
                        'rate' => 0,
                        'factor' => 1,
                        'promo_id' => null,
                        'delivered_at' => $now,
                        'updated_at' => $now,
                    ]);
                }
                Tiers::evaluate(Db::one('SELECT * FROM club_members WHERE id = ?', [$m['id']]), $now);
                break;
        }
        Push::flush($m['id']);
        return self::view();
    }

    // ---------- Anzeige ----------

    public static function view(array $extra = []): array
    {
        $s = self::state();
        if (!$s) {
            return ['active' => false, 'amount_cents' => 5900, 'steps' => array_map(static fn ($k, $l) => ['key' => $k, 'label' => $l, 'done' => false], array_keys(self::STEPS), self::STEPS)] + $extra;
        }
        $m = Db::one('SELECT * FROM club_members WHERE id = ?', [$s['member_id']]);
        $order = self::orderRow($s);
        $survey = self::surveyRow($s);
        $ref = Db::one('SELECT * FROM club_referral_orders WHERE member_id = ? ORDER BY created_at DESC', [$s['member_id']]);
        $pushes = [];
        foreach (Db::all('SELECT kind, status, error, created_at, sent_at FROM club_push_queue WHERE member_id = ? ORDER BY created_at', [$s['member_id']]) as $p) {
            $pushes[$p['kind']] = $p;
        }
        $tierIdx = $m ? (int) array_search(Tiers::of($m)['key'], Tiers::KEYS, true) : 0;
        $done = [
            'ordered' => $order !== null ? (int) $s['started_at'] : null,
            'pending' => $order !== null && ($order['reason'] !== 'payment' || $order['status'] === 'available') && $order['status'] !== 'void' ? (int) $order['updated_at'] : null,
            'shipped' => $order['shipped_at'] ?? null,
            'delivered' => $order['delivered_at'] ?? ($survey['delivered_at'] ?? null),
            'survey' => $survey['sent_at'] ?? null,
            'credited' => $order !== null && $order['status'] === 'available' ? (int) $order['updated_at'] : null,
            'referral' => $ref !== null && $ref['status'] === 'credited' ? (int) $ref['credited_at'] : null,
            'tier' => $tierIdx > 0 ? (int) $m['updated_at'] : null,
        ];
        $detail = [
            'ordered' => $order ? $order['name'] . ' · ' . Util::euro((int) $s['amount_cents']) . ($s['mode'] === 'real' ? ' (gezählt wie ' . Util::euro((int) $s['amount_cents']) . ', bezahlt 0 €)' : '') : ($s['mode'] === 'real' ? 'Wartet auf die Bestellung mit ' . ($s['codes'][0]['code'] ?? '') : null),
            'pending' => $order ? (int) $order['points'] . ' Punkte' . ($order['status'] === 'pending' ? ' vorgemerkt' : '') : null,
            'shipped' => $order && $order['shipped_at'] === null && $s['mode'] === 'real' ? 'In der Team-App unter „Versand“ abhaken' : null,
            'delivered' => null,
            'survey' => $survey ? match (true) {
                $survey['answered_at'] !== null => 'Beantwortet: ' . number_format((float) $survey['rating_avg'], 1, ',', '.') . ' ★' . ((int) $survey['points'] > 0 ? ' · +' . (int) $survey['points'] . ' Punkte' : ''),
                $survey['sent_at'] !== null => 'Verschickt per ' . str_replace('+', ' + ', (string) $survey['channel']),
                $survey['send_at'] !== null => 'Geplant für ' . date('d.m. H:i', intdiv((int) $survey['send_at'], 1000)) . ' Uhr',
                default => 'Wartet auf die Zustellung',
            } : null,
            'credited' => $order && $order['status'] === 'pending' && $order['reason'] === 'wait' ? 'Wartezeit bis ' . date('d.m.', intdiv((int) $order['available_at'], 1000)) . ' – überspringen möglich' : null,
            'referral' => $ref ? (int) $ref['points'] . ' Punkte für eine Freundes-Bestellung' . ($ref['status'] === 'void' ? ' (nicht vergeben: ' . $ref['reason'] . ')' : '') : null,
            'tier' => $m && $tierIdx > 0 ? 'Jetzt ' . Tiers::of($m)['name'] : null,
        ];
        $steps = [];
        foreach (self::STEPS as $k => $label) {
            $pk = self::PUSH[$k] ?? null;
            $push = $pk && isset($pushes[$pk]) ? $pushes[$pk] : null;
            $steps[] = [
                'key' => $k,
                'label' => $label,
                'done' => $done[$k] !== null,
                'at' => $done[$k] !== null ? (int) $done[$k] : null,
                'detail' => $detail[$k],
                'push' => $push ? ['status' => $push['status'], 'error' => $push['error']] : null,
            ];
        }
        $shop = Shopify::shopUrl();
        return [
            'active' => true,
            'mode' => $s['mode'],
            'by' => $s['by'],
            'email' => $s['email'],
            'started_at' => (int) $s['started_at'],
            'amount_cents' => (int) $s['amount_cents'],
            'codes' => array_column($s['codes'], 'code'),
            'shop_link' => $s['codes'] ? $shop . '/discount/' . rawurlencode($s['codes'][0]['code']) . '?redirect=%2F' : null,
            'order' => $s['order_id'] ? ['id' => $s['order_id'], 'name' => $s['order_name'], 'real' => str_starts_with((string) $s['order_id'], 'gid://')] : null,
            'devices' => $s['device_member_id'] ? Push::devices((string) $s['device_member_id']) : 0,
            'device_member' => (bool) $s['device_member_id'],
            'member_url' => Util::baseUrl() . '/admin/mitglieder/' . $s['member_id'],
            'balance' => $m ? Points::balance($m['id']) : 0,
            'pending' => $m ? Points::pending($m['id']) : 0,
            'survey_link' => $survey ? Surveys::link($survey) : null,
            'steps' => $steps,
        ] + $extra;
    }

    // ---------- Aufräumen ----------

    /** Alle Testdaten löschen, Codes in Shopify entfernen. Gibt die echte Bestellung zurück (Storno macht die Team-App). */
    public static function cleanup(): array
    {
        $s = self::state();
        if (!$s) {
            return ['ok' => true, 'order' => null, 'message' => 'Es lief kein Probelauf.'];
        }
        $id = (string) $s['member_id'];
        if (Shopify::configured()) {
            foreach ($s['codes'] as $c) {
                if (!empty($c['id'])) {
                    Points::deleteDiscount((string) $c['id']);
                }
            }
            foreach (Db::all('SELECT discount_id FROM club_codes WHERE member_id = ? AND discount_id IS NOT NULL', [$id]) as $c) {
                Points::deleteDiscount((string) $c['discount_id']);
            }
        }
        Db::tx(static function () use ($s, $id): void {
            foreach (['club_orders', 'club_ledger', 'club_codes', 'club_push_queue', 'club_claims', 'club_referral_orders', 'club_referral_codes', 'club_referral_clicks', 'club_order_cache'] as $t) {
                Db::exec("DELETE FROM $t WHERE member_id = ?", [$id]);
            }
            Db::exec('DELETE FROM club_surveys WHERE member_id = ? OR order_id = ?', [$id, (string) ($s['order_id'] ?? '-')]);
            Db::exec('DELETE FROM club_alerts WHERE test = 1');
            Db::exec('DELETE FROM club_members WHERE id = ? AND test = 1', [$id]);
        });
        $order = $s['order_id'] && str_starts_with((string) $s['order_id'], 'gid://') ? ['id' => $s['order_id'], 'name' => $s['order_name']] : null;
        self::put(null);
        Util::log('Probelauf aufgeräumt');
        return ['ok' => true, 'order' => $order, 'message' => 'Testkonto, Punkte, Befragung und Codes sind gelöscht.'];
    }
}
