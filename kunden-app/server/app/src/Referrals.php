<?php
declare(strict_types=1);

namespace Club;

/**
 * Empfehlungslinks: Jedes Mitglied hat einen Link {app}/r/{ref_code}. Er führt in den Shop und legt dort
 * einen persönlichen Rabattcode für Freunde in den Warenkorb (z. B. ANNA-K2M4QX, 10 % auf die erste Bestellung).
 *
 * Zugeordnet wird über den Code in der Bestellung – ohne Tracking-Cookie und auch, wenn der Freund nicht
 * dem Club beitritt. Das werbende Mitglied bekommt Punkte (fest oder als Prozent vom Bestellwert),
 * sobald die Bestellung bezahlt, versendet und die Wartezeit vorbei ist – wie bei eigenen Bestellungen.
 * Eigene Bestellungen, Bestandskunden (einstellbar), Mindestwert und eine Obergrenze je Jahr werden geprüft.
 * Gezählt werden nur Klicks je Tag (keine Daten der Besucher).
 */
final class Referrals
{
    public const DEFAULTS = [
        'enabled' => false,
        'friend_type' => 'percent',   // percent | fixed
        'friend_value' => 10,         // Prozent bzw. Cent
        'friend_min_cents' => 0,
        'new_customers_only' => true, // Punkte nur für Bestellungen von Neukunden
        'segment_only' => false,      // Rabatt in Shopify nur für das Segment „Club: Neukunden“
        'reward_type' => 'points',    // points | percent
        'reward_points' => 100,
        'reward_percent' => 10,       // Prozent des Bestellwerts als Punkte-Gegenwert
        'reward_min_cents' => 0,
        'reward_max_year' => 10,
        'combine_shipping' => true,
        'combine_order' => false,
        'combine_product' => false,
    ];

    public const SEGMENT = 'Club: Neukunden';
    private const BOTS = '/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|linkedin|skype|curl|wget|python|headless|monitor/i';

    private static ?array $config = null;

    public static function config(): array
    {
        if (self::$config === null) {
            $c = Settings::get('referral', []);
            self::$config = array_merge(self::DEFAULTS, is_array($c) ? $c : []);
        }
        return self::$config;
    }

    public static function resetCache(): void
    {
        self::$config = null;
    }

    public static function enabled(): bool
    {
        return (bool) self::config()['enabled'] && Shopify::configured();
    }

    public static function save(array $in): array
    {
        $c = self::config();
        $int = static function (string $k, int $min, int $max) use ($in, &$c): void {
            if (array_key_exists($k, $in)) {
                if (!is_numeric($in[$k]) || (int) $in[$k] < $min || (int) $in[$k] > $max) {
                    throw new HttpError(422, "Ungültiger Wert für $k (erlaubt: $min bis $max).");
                }
                $c[$k] = (int) $in[$k];
            }
        };
        foreach (['friend_type' => ['percent', 'fixed'], 'reward_type' => ['points', 'percent']] as $k => $allowed) {
            if (array_key_exists($k, $in)) {
                if (!in_array($in[$k], $allowed, true)) {
                    throw new HttpError(422, "Ungültiger Wert für $k.");
                }
                $c[$k] = $in[$k];
            }
        }
        $int('friend_value', 1, $c['friend_type'] === 'percent' ? 100 : 100000);
        $int('friend_min_cents', 0, 10000000);
        $int('reward_points', 0, 100000);
        $int('reward_percent', 0, 100);
        $int('reward_min_cents', 0, 10000000);
        $int('reward_max_year', 0, 1000);
        if ($c['friend_type'] === 'percent' && (int) $c['friend_value'] > 100) {
            throw new HttpError(422, 'Ein Prozent-Rabatt kann höchstens 100 % sein.');
        }
        foreach (['enabled', 'new_customers_only', 'segment_only', 'combine_shipping', 'combine_order', 'combine_product'] as $k) {
            if (array_key_exists($k, $in)) {
                $c[$k] = (bool) $in[$k];
            }
        }
        Settings::set('referral', $c);
        self::$config = null;
        return self::config();
    }

    /** Was den Rabatt in Shopify ausmacht – ändert sich das, werden die Codes neu angelegt. */
    private static function discountHash(): string
    {
        $c = self::config();
        return sha1(Util::json([$c['friend_type'], (int) $c['friend_value'], (int) $c['friend_min_cents'], (bool) $c['segment_only'], (bool) $c['combine_shipping'], (bool) $c['combine_order'], (bool) $c['combine_product']]));
    }

    // ---------- Texte ----------

    public static function friendText(?array $c = null): string
    {
        $c ??= self::config();
        $value = $c['friend_type'] === 'percent' ? (int) $c['friend_value'] . ' %' : Util::euro((int) $c['friend_value']);
        $text = $value . ' Rabatt' . ($c['new_customers_only'] ? ' auf die erste Bestellung' : '');
        if ((int) $c['friend_min_cents'] > 0) {
            $text .= ' ab ' . Util::euro((int) $c['friend_min_cents']);
        }
        return $text;
    }

    public static function rewardText(?array $c = null): string
    {
        $c ??= self::config();
        $text = $c['reward_type'] === 'percent'
            ? (int) $c['reward_percent'] . ' % des Bestellwerts als Punkte'
            : (int) $c['reward_points'] . ' Punkte';
        if ((int) $c['reward_min_cents'] > 0) {
            $text .= ' (ab ' . Util::euro((int) $c['reward_min_cents']) . ' Bestellwert)';
        }
        return $text;
    }

    /** Punkte für eine Bestellung über den Link. Prozent: Gegenwert in Punkten (z. B. 10 % von 60 € = 6 € = 120 Punkte). */
    public static function pointsFor(int $amountCents, ?array $c = null): int
    {
        $c ??= self::config();
        if ($c['reward_type'] === 'percent') {
            $p = Points::program();
            $euroValue = $amountCents * (int) $c['reward_percent'] / 100;
            return (int) floor($euroValue * (int) $p['redeem_points'] / max(1, (int) $p['redeem_cents']) + 1e-9);
        }
        return (int) $c['reward_points'];
    }

    // ---------- Code und Link je Mitglied ----------

    public static function link(array $member): string
    {
        return Util::baseUrl() . '/r/' . Bonus::refCode($member);
    }

    /** ANNA-K2M4QX: Vorname (nur Buchstaben) + Empfehlungscode. */
    private static function codeFor(array $member): string
    {
        $name = (string) ($member['first_name'] ?? '');
        $ascii = strtr($name, ['ä' => 'AE', 'ö' => 'OE', 'ü' => 'UE', 'Ä' => 'AE', 'Ö' => 'OE', 'Ü' => 'UE', 'ß' => 'SS']);
        $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $ascii) ?: '';
        $ascii = substr(strtoupper(preg_replace('/[^A-Za-z]/', '', $ascii) ?? ''), 0, 10);
        return ($ascii !== '' ? $ascii : 'CLUB') . '-' . Bonus::refCode($member);
    }

    public static function row(array $member): array
    {
        $row = Db::one('SELECT * FROM club_referral_codes WHERE member_id = ?', [$member['id']]);
        if ($row) {
            return $row;
        }
        $code = self::codeFor($member);
        if (Db::value('SELECT 1 FROM club_referral_codes WHERE code = ?', [$code])) {
            $code = 'CLUB-' . Bonus::refCode($member);
        }
        $now = Util::now();
        try {
            Db::insert('club_referral_codes', [
                'member_id' => $member['id'],
                'code' => $code,
                'discount_id' => null,
                'config_hash' => null,
                'status' => 'new',
                'error' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } catch (\PDOException) {
            // gleichzeitig angelegt
        }
        return Db::one('SELECT * FROM club_referral_codes WHERE member_id = ?', [$member['id']]);
    }

    /** Rabattcode in Shopify anlegen bzw. nach geänderten Einstellungen neu anlegen. */
    public static function ensureDiscount(array $member): array
    {
        $row = self::row($member);
        $hash = self::discountHash();
        if ($row['status'] === 'active' && $row['discount_id'] && $row['config_hash'] === $hash) {
            return $row;
        }
        try {
            if ($row['discount_id']) {
                Points::deleteDiscount($row['discount_id']);
                Db::exec("UPDATE club_referral_codes SET discount_id = NULL, status = 'new', updated_at = ? WHERE member_id = ?", [Util::now(), $member['id']]);
            }
            $id = self::createDiscount($member, (string) $row['code']);
            Db::exec("UPDATE club_referral_codes SET discount_id = ?, config_hash = ?, status = 'active', error = NULL, updated_at = ? WHERE member_id = ?", [$id, $hash, Util::now(), $member['id']]);
        } catch (\Throwable $e) {
            Util::log('Empfehlungscode: ' . $e->getMessage());
            Db::exec("UPDATE club_referral_codes SET status = 'failed', error = ?, updated_at = ? WHERE member_id = ?", [mb_substr($e->getMessage(), 0, 250), Util::now(), $member['id']]);
        }
        return Db::one('SELECT * FROM club_referral_codes WHERE member_id = ?', [$member['id']]);
    }

    private static function createDiscount(array $member, string $code): string
    {
        $c = self::config();
        $who = trim(($member['first_name'] ?? '') . ' ' . ($member['last_name'] ? mb_substr((string) $member['last_name'], 0, 1) . '.' : ''));
        $value = $c['friend_type'] === 'percent'
            ? ['percentage' => round((int) $c['friend_value'] / 100, 4)]
            : ['discountAmount' => ['amount' => Util::decimal((int) $c['friend_value']), 'appliesOnEachItem' => false]];
        $input = [
            'title' => 'Club-Empfehlung · ' . ($who !== '' ? $who : $member['email']) . ' · ' . $code,
            'code' => $code,
            'startsAt' => Util::iso(Util::now() - 60000),
            'appliesOncePerCustomer' => true,
            'context' => $c['segment_only'] ? ['customerSegments' => ['add' => [self::segmentId()]]] : ['all' => 'ALL'],
            'customerGets' => ['value' => $value, 'items' => ['all' => true]],
            'combinesWith' => [
                'shippingDiscounts' => (bool) $c['combine_shipping'],
                'orderDiscounts' => (bool) $c['combine_order'],
                'productDiscounts' => (bool) $c['combine_product'],
            ],
        ];
        if ((int) $c['friend_min_cents'] > 0) {
            $input['minimumRequirement'] = ['subtotal' => ['greaterThanOrEqualToSubtotal' => Util::decimal((int) $c['friend_min_cents'])]];
        }
        $d = Shopify::graphql(
            'mutation ClubRefCode($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message code } } }',
            ['input' => $input]
        );
        Shopify::check($d['discountCodeBasicCreate'] ?? [], 'Empfehlungscode');
        $id = $d['discountCodeBasicCreate']['codeDiscountNode']['id'] ?? null;
        if (!is_string($id) || $id === '') {
            throw new \RuntimeException('Shopify hat keinen Rabattcode zurückgegeben.');
        }
        return $id;
    }

    /** Segment „Club: Neukunden“ (noch keine Bestellung) – wird bei Bedarf angelegt. */
    private static function segmentId(): string
    {
        $cached = Settings::get('referral_segment');
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }
        $d = Shopify::graphql('query ClubSegments { segments(first: 100) { nodes { id name query } } }');
        foreach ($d['segments']['nodes'] ?? [] as $s) {
            if (($s['name'] ?? '') === self::SEGMENT) {
                Settings::set('referral_segment', $s['id']);
                return (string) $s['id'];
            }
        }
        $r = Shopify::graphql(
            'mutation ClubSegmentCreate($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id } userErrors { field message } } }',
            ['name' => self::SEGMENT, 'query' => 'number_of_orders = 0']
        );
        Shopify::check($r['segmentCreate'] ?? [], 'Segment');
        $id = (string) ($r['segmentCreate']['segment']['id'] ?? '');
        Settings::set('referral_segment', $id);
        return $id;
    }

    /**
     * Klick auf /r/{code}: zählen (ohne Bots), Rabattcode sicherstellen und in den Shop weiterleiten.
     * Ohne Empfehlungsprogramm: Einladung in den Club (falls Boni für Einladungen aktiv), sonst Shop.
     */
    public static function click(string $ref): string
    {
        $shop = Shopify::shopUrl();
        $code = Bonus::normalizeRef($ref);
        $member = $code !== '' ? Db::one('SELECT * FROM club_members WHERE ref_code = ? AND joined_at IS NOT NULL', [$code]) : null;
        if (!$member) {
            return $shop . '/';
        }
        if (!self::enabled()) {
            return Bonus::inviter($code) ? Util::baseUrl() . '/?einladung=' . rawurlencode($code) : $shop . '/';
        }
        $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
        if ($ua !== '' && !preg_match(self::BOTS, $ua)) {
            $day = date('Y-m-d');
            $id = $member['id'] . ':' . $day;
            if (Db::exec('UPDATE club_referral_clicks SET n = n + 1 WHERE id = ?', [$id]) === 0) {
                try {
                    Db::insert('club_referral_clicks', ['id' => $id, 'member_id' => $member['id'], 'day' => $day, 'n' => 1]);
                } catch (\PDOException) {
                    Db::exec('UPDATE club_referral_clicks SET n = n + 1 WHERE id = ?', [$id]);
                }
            }
        }
        $row = self::ensureDiscount($member);
        if ($row['status'] !== 'active') {
            return $shop . '/';
        }
        return $shop . '/discount/' . rawurlencode((string) $row['code']) . '?redirect=%2F';
    }

    // ---------- Bestellungen über einen Code ----------

    /**
     * Bestellung aus dem Abgleich (alle Kundinnen und Kunden): Enthält sie einen Empfehlungscode,
     * wird sie dem werbenden Mitglied zugeordnet und wie eine eigene Bestellung verfolgt.
     */
    public static function consider(array $o, bool $test = false): void
    {
        $codes = array_values(array_unique(array_map('strtoupper', array_filter((array) ($o['discountCodes'] ?? []), 'is_string'))));
        if (!$codes) {
            return;
        }
        $code = Db::one('SELECT * FROM club_referral_codes WHERE code IN (' . Db::marks($codes) . ')', $codes);
        if (!$code) {
            return;
        }
        $referrer = Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$code['member_id']]);
        if (!$referrer) {
            return;
        }
        $c = self::config();
        $p = Points::program();
        $now = Util::now();
        $id = (string) $o['id'];
        $old = Db::one('SELECT * FROM club_referral_orders WHERE order_id = ?', [$id]);
        $amount = max(0, Util::cents($o['currentSubtotalPriceSet']['shopMoney']['amount'] ?? 0));
        $points = self::pointsFor($amount, $c);
        $status = 'pending';
        $reason = null;
        $shippedAt = null;
        $availableAt = null;

        // Einmalige Prüfungen beim ersten Abgleich
        $fixed = $old && $old['status'] === 'void' && in_array($old['reason'], ['self', 'existing', 'test'], true) ? $old['reason'] : null;
        if (!$old) {
            $cid = (string) ($o['customer']['id'] ?? '');
            $email = mb_strtolower((string) ($o['email'] ?? ''));
            if (($cid !== '' && $cid === $referrer['shopify_id']) || ($email !== '' && $email === mb_strtolower((string) $referrer['email']))) {
                $fixed = 'self';
            } elseif ($c['new_customers_only'] && isset($o['customer']['numberOfOrders']) && (int) $o['customer']['numberOfOrders'] > 1) {
                $fixed = 'existing';
            } elseif (!empty($o['test']) && !$p['count_test'] && !$test) {
                $fixed = 'test';
            }
        }
        if ($fixed !== null) {
            [$status, $reason] = ['void', $fixed];
        } elseif (!empty($o['cancelledAt'])) {
            [$status, $reason] = ['void', 'cancelled'];
        } elseif ($points <= 0 || $amount <= 0) {
            [$status, $reason] = ['void', 'zero'];
        } elseif ($amount < (int) $c['reward_min_cents']) {
            [$status, $reason] = ['void', 'min'];
        } elseif (empty($o['fullyPaid'])) {
            $reason = 'payment';
        } elseif (($o['displayFulfillmentStatus'] ?? '') !== 'FULFILLED') {
            $reason = 'shipping';
        } else {
            foreach ($o['fulfillments'] ?? [] as $f) {
                $at = ($f['status'] ?? 'SUCCESS') === 'SUCCESS' ? Util::ms($f['createdAt'] ?? null) : null;
                if ($at !== null && ($shippedAt === null || $at > $shippedAt)) {
                    $shippedAt = $at;
                }
            }
            $shippedAt ??= Util::ms($o['processedAt'] ?? null) ?? $now;
            $availableAt = $shippedAt + (int) $p['wait_days'] * Points::DAY_MS;
            $reason = 'wait';
        }

        $row = [
            'member_id' => $referrer['id'],
            'code' => $code['code'],
            'order_name' => mb_substr((string) ($o['name'] ?? ''), 0, 40),
            'friend_customer_id' => isset($o['customer']['id']) ? (string) $o['customer']['id'] : null,
            'ordered_at' => Util::ms($o['processedAt'] ?? $o['createdAt'] ?? null) ?? $now,
            'amount_cents' => $amount,
            'points' => $points,
            'status' => $status,
            'reason' => $reason,
            'shipped_at' => $shippedAt,
            'available_at' => $availableAt,
            'updated_at' => $now,
        ];
        if (!$old) {
            try {
                Db::insert('club_referral_orders', $row + ['order_id' => $id, 'credited_at' => null, 'ledger_id' => null, 'test' => $test ? 1 : 0, 'created_at' => $now]);
            } catch (\PDOException) {
                return;
            }
            if ($status === 'pending') {
                Push::queue($referrer, 'referral_pending', ['punkte' => (string) $points], 'refpend:' . $id, '/konto');
            }
            return;
        }
        if ($old['status'] === 'credited') {
            // Nach der Gutschrift storniert oder ganz erstattet: Punkte wieder abziehen
            if ($status === 'void' && in_array($reason, ['cancelled', 'zero'], true)) {
                if (Db::exec("UPDATE club_referral_orders SET status = 'void', reason = ?, updated_at = ? WHERE order_id = ? AND status = 'credited'", [$reason, $now, $id]) === 1) {
                    Points::book($referrer['id'], 'adjust', -(int) $old['points'], 'Empfehlung ' . $old['order_name'] . ' wurde storniert', 'order:' . $id);
                }
            }
            return;
        }
        if ($old['status'] === 'void' && $fixed === null && in_array($old['reason'], ['limit', 'duplicate'], true)) {
            return; // bleibt so
        }
        Db::update('club_referral_orders', $row, ['order_id' => $id]);
    }

    /** Cronjob: Wartezeit vorbei → Punkte gutschreiben (mit Obergrenze je Jahr und ohne doppelte Belohnung). */
    public static function release(): string
    {
        $now = Util::now();
        $c = self::config();
        $n = 0;
        foreach (Db::all("SELECT * FROM club_referral_orders WHERE status = 'pending' AND reason = 'wait' AND available_at <= ? ORDER BY available_at LIMIT 200", [$now]) as $r) {
            $referrer = Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$r['member_id']]);
            if (!$referrer) {
                Db::exec("UPDATE club_referral_orders SET status = 'void', reason = 'left', updated_at = ? WHERE order_id = ?", [$now, $r['order_id']]);
                continue;
            }
            // Freund ist (über die Einladung) Mitglied geworden und wurde dafür schon belohnt?
            $friend = $r['friend_customer_id'] ? Db::one('SELECT id FROM club_members WHERE shopify_id = ?', [$r['friend_customer_id']]) : null;
            if ($friend && Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND kind = 'referral' AND ref = ?", [$referrer['id'], $friend['id']])) {
                Db::exec("UPDATE club_referral_orders SET status = 'void', reason = 'duplicate', updated_at = ? WHERE order_id = ?", [$now, $r['order_id']]);
                continue;
            }
            $year = (int) Db::value("SELECT COUNT(*) FROM club_ledger WHERE member_id = ? AND kind = 'referral' AND created_at > ?", [$referrer['id'], $now - 365 * Points::DAY_MS]);
            if ((int) $c['reward_max_year'] > 0 && $year >= (int) $c['reward_max_year']) {
                Db::exec("UPDATE club_referral_orders SET status = 'void', reason = 'limit', updated_at = ? WHERE order_id = ?", [$now, $r['order_id']]);
                continue;
            }
            if (Db::exec("UPDATE club_referral_orders SET status = 'credited', reason = NULL, credited_at = ?, updated_at = ? WHERE order_id = ? AND status = 'pending'", [$now, $now, $r['order_id']]) !== 1) {
                continue;
            }
            $ledger = Points::book($referrer['id'], 'referral', (int) $r['points'], 'Bestellung über deinen Empfehlungslink', 'order:' . $r['order_id'], null, [], false);
            Db::exec('UPDATE club_referral_orders SET ledger_id = ? WHERE order_id = ?', [$ledger, $r['order_id']]);
            Push::queue($referrer, 'referral_order', ['punkte' => (string) $r['points']], 'refok:' . $r['order_id']);
            Events::rewardCheck($referrer['id']);
            $n++;
        }
        return "$n gutgeschrieben";
    }

    /** Wurde dieser Freund schon über den Link belohnt? (für die Belohnung über die Club-Einladung) */
    public static function rewardedViaLink(string $referrerId, string $friendShopifyId): bool
    {
        return (bool) Db::value(
            "SELECT 1 FROM club_referral_orders WHERE member_id = ? AND friend_customer_id = ? AND status IN ('pending', 'credited')",
            [$referrerId, $friendShopifyId]
        );
    }

    /** Cronjob: Codes nach geänderten Einstellungen neu anlegen; ausgeschaltet → Codes in Shopify löschen. */
    public static function syncCodes(int $max = 20): string
    {
        if (!Shopify::configured()) {
            return '–';
        }
        if (!self::config()['enabled']) {
            $n = 0;
            foreach (Db::all("SELECT * FROM club_referral_codes WHERE discount_id IS NOT NULL LIMIT $max") as $r) {
                Points::deleteDiscount($r['discount_id']);
                Db::exec("UPDATE club_referral_codes SET discount_id = NULL, status = 'off', updated_at = ? WHERE member_id = ?", [Util::now(), $r['member_id']]);
                $n++;
            }
            return "$n deaktiviert";
        }
        $rows = Db::all(
            "SELECT r.member_id FROM club_referral_codes r JOIN club_members m ON m.id = r.member_id
             WHERE m.joined_at IS NOT NULL AND r.discount_id IS NOT NULL AND (r.config_hash IS NULL OR r.config_hash <> ?) LIMIT $max",
            [self::discountHash()]
        );
        foreach ($rows as $r) {
            $m = Db::one('SELECT * FROM club_members WHERE id = ?', [$r['member_id']]);
            if ($m) {
                self::ensureDiscount($m);
            }
        }
        return count($rows) . ' aktualisiert';
    }

    /** Austritt: Code in Shopify löschen, Daten entfernen. */
    public static function leave(array $member): void
    {
        $row = Db::one('SELECT * FROM club_referral_codes WHERE member_id = ?', [$member['id']]);
        if ($row && $row['discount_id'] && Shopify::configured()) {
            Points::deleteDiscount($row['discount_id']);
        }
        foreach (['club_referral_codes', 'club_referral_clicks', 'club_referral_orders'] as $t) {
            Db::exec("DELETE FROM $t WHERE member_id = ?", [$member['id']]);
        }
    }

    // ---------- Anzeige ----------

    /** Kurzfassung für die Dankeseite der Befragung. */
    public static function teaser(array $member): ?array
    {
        if (!self::enabled()) {
            return null;
        }
        return ['link' => self::link($member), 'friend_text' => self::friendText(), 'reward_text' => self::rewardText()];
    }

    /** Für die App: Link, Texte und eigene Zahlen. */
    public static function status(array $member): ?array
    {
        if (!self::enabled()) {
            return null;
        }
        $row = Db::one('SELECT * FROM club_referral_codes WHERE member_id = ?', [$member['id']]);
        $orders = Db::one(
            "SELECT SUM(CASE WHEN status IN ('pending', 'credited') THEN 1 ELSE 0 END) AS n,
                    SUM(CASE WHEN status = 'pending' THEN points ELSE 0 END) AS pending,
                    SUM(CASE WHEN status = 'credited' THEN points ELSE 0 END) AS earned
             FROM club_referral_orders WHERE member_id = ?",
            [$member['id']]
        );
        return [
            'link' => self::link($member),
            'code' => $row['code'] ?? self::codeFor($member),
            'friend_text' => self::friendText(),
            'reward_text' => self::rewardText(),
            'new_customers_only' => (bool) self::config()['new_customers_only'],
            'max_year' => (int) self::config()['reward_max_year'],
            'clicks' => (int) Db::value('SELECT COALESCE(SUM(n), 0) FROM club_referral_clicks WHERE member_id = ?', [$member['id']]),
            'orders' => (int) ($orders['n'] ?? 0),
            'pending_points' => (int) ($orders['pending'] ?? 0),
            'earned_points' => (int) ($orders['earned'] ?? 0),
        ];
    }

    public static function stats(int $from, int $to): array
    {
        return [
            'orders' => (int) Db::value("SELECT COUNT(*) FROM club_referral_orders WHERE test = 0 AND status IN ('pending', 'credited') AND ordered_at >= ? AND ordered_at < ?", [$from, $to]),
            'revenue_cents' => (int) Db::value("SELECT COALESCE(SUM(amount_cents), 0) FROM club_referral_orders WHERE test = 0 AND status IN ('pending', 'credited') AND ordered_at >= ? AND ordered_at < ?", [$from, $to]),
            'clicks' => (int) Db::value('SELECT COALESCE(SUM(n), 0) FROM club_referral_clicks WHERE day >= ? AND day <= ?', [date('Y-m-d', intdiv($from, 1000)), date('Y-m-d', intdiv($to - 1, 1000))]),
        ];
    }

    /** Für den Admin-Bereich: Zahlen, beste Empfehler, letzte Bestellungen. */
    public static function overview(): array
    {
        $since = Util::now() - 90 * Points::DAY_MS;
        $byStatus = [];
        foreach (Db::all('SELECT status, reason, COUNT(*) AS n, COALESCE(SUM(points), 0) AS pts FROM club_referral_orders WHERE test = 0 AND created_at > ? GROUP BY status, reason', [$since]) as $r) {
            $byStatus[] = ['status' => $r['status'], 'reason' => $r['reason'], 'count' => (int) $r['n'], 'points' => (int) $r['pts']];
        }
        $top = array_map(static fn ($r) => [
            'member_id' => $r['member_id'],
            'name' => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: $r['email'],
            'orders' => (int) $r['n'],
            'revenue_cents' => (int) $r['c'],
        ], Db::all(
            "SELECT o.member_id, m.first_name, m.last_name, m.email, COUNT(*) AS n, SUM(o.amount_cents) AS c
             FROM club_referral_orders o JOIN club_members m ON m.id = o.member_id
             WHERE o.test = 0 AND o.status IN ('pending', 'credited') GROUP BY o.member_id, m.first_name, m.last_name, m.email ORDER BY n DESC LIMIT 10"
        ));
        $recent = array_map(static fn ($r) => [
            'order_name' => $r['order_name'],
            'member' => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: $r['email'],
            'code' => $r['code'],
            'amount_cents' => (int) $r['amount_cents'],
            'points' => (int) $r['points'],
            'status' => $r['status'],
            'reason' => $r['reason'],
            'test' => (bool) (int) $r['test'],
            'at' => (int) $r['ordered_at'],
        ], Db::all(
            'SELECT o.*, m.first_name, m.last_name, m.email FROM club_referral_orders o LEFT JOIN club_members m ON m.id = o.member_id ORDER BY o.ordered_at DESC LIMIT 20'
        ));
        $s = self::stats($since, Util::now() + 1);
        return [
            'clicks_90' => $s['clicks'],
            'orders_90' => $s['orders'],
            'revenue_90' => $s['revenue_cents'],
            'codes' => (int) Db::value("SELECT COUNT(*) FROM club_referral_codes WHERE status = 'active'"),
            'failed' => array_map(static fn ($r) => ['code' => $r['code'], 'error' => $r['error']], Db::all("SELECT code, error FROM club_referral_codes WHERE status = 'failed' LIMIT 5")),
            'by_status' => $byStatus,
            'top' => $top,
            'recent' => $recent,
            'friend_text' => self::friendText(),
            'reward_text' => self::rewardText(),
        ];
    }
}
