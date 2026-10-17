<?php
declare(strict_types=1);

namespace Club;

/**
 * Bonuspunkte: Geburtstag, Newsletter, Bewertung, Empfehlung und Startbonus für die Warteliste.
 */
final class Bonus
{
    private const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    // ---------- Beitritt: Shopify-Daten, Warteliste, Empfehlung ----------

    /** Tags, Bestellanzahl und Newsletter-Status eines Kundenkontos (null, wenn Shopify nicht erreichbar ist). */
    public static function customer(string $shopifyId): ?array
    {
        if (!Shopify::configured()) {
            return null;
        }
        try {
            $d = Shopify::graphql(
                'query ClubCustomer($id: ID!) { customer(id: $id) { id tags numberOfOrders defaultEmailAddress { marketingState } } }',
                ['id' => $shopifyId]
            );
        } catch (\Throwable $e) {
            Util::log('Kundendaten: ' . $e->getMessage());
            return null;
        }
        $c = $d['customer'] ?? null;
        if (!is_array($c)) {
            return null;
        }
        return [
            'tags' => array_map('strtolower', array_map('trim', (array) ($c['tags'] ?? []))),
            'orders' => (int) ($c['numberOfOrders'] ?? 0),
            'newsletter' => ($c['defaultEmailAddress']['marketingState'] ?? '') === 'SUBSCRIBED',
        ];
    }

    /** Beim Beitritt: Startbonus (Warteliste), Empfehlung, Newsletter. */
    public static function onJoin(array $member, ?string $refCode): void
    {
        $p = Points::program();
        $info = self::customer((string) $member['shopify_id']);
        if ($info === null) {
            return;
        }
        $tag = mb_strtolower((string) $p['waitlist_tag']);
        if (in_array($tag, $info['tags'], true)) {
            Db::exec('UPDATE club_members SET waitlist = 1 WHERE id = ?', [$member['id']]);
            $sb = Points::startBonus($p);
            if ($sb && !Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND kind = 'start'", [$member['id']])) {
                $extra = $sb['requires_order']
                    ? ['status' => 'locked', 'unlock_rule' => 'first_order', 'unlock_min_cents' => $sb['min_cents'] ?: null, 'expires_days' => $sb['days'] ?: null]
                    : ($sb['days'] > 0 ? ['expires_at' => Util::now() + $sb['days'] * Points::DAY_MS] : []);
                Points::book($member['id'], 'start', $sb['points'], 'Danke, dass du auf der Warteliste warst!', null, null, $extra);
            }
            Db::exec("UPDATE club_invites SET status = 'joined' WHERE customer_id = ?", [$member['shopify_id']]);
        }
        if ($refCode !== null && $refCode !== '') {
            self::applyReferral($member, $refCode, $info['orders']);
        }
        if ($info['newsletter']) {
            self::newsletterBonus($member);
        }
        Db::exec('UPDATE club_members SET newsletter_checked_at = ? WHERE id = ?', [Util::now(), $member['id']]);
    }

    // ---------- Empfehlung ----------

    public static function refCode(array $member): string
    {
        if (!empty($member['ref_code'])) {
            return (string) $member['ref_code'];
        }
        do {
            $code = '';
            for ($i = 0; $i < 6; $i++) {
                $code .= self::REF_CHARS[random_int(0, strlen(self::REF_CHARS) - 1)];
            }
        } while (Db::value('SELECT 1 FROM club_members WHERE ref_code = ?', [$code]));
        Db::exec('UPDATE club_members SET ref_code = ? WHERE id = ? AND ref_code IS NULL', [$code, $member['id']]);
        return (string) Db::value('SELECT ref_code FROM club_members WHERE id = ?', [$member['id']]);
    }

    public static function normalizeRef(string $code): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');
    }

    /** Wer hat eingeladen? (öffentlich, nur Vorname + Initiale) */
    public static function inviter(string $code): ?array
    {
        $code = self::normalizeRef($code);
        if ($code === '' || ((int) Points::program()['bonus_referred'] <= 0 && (int) Points::program()['bonus_referrer'] <= 0)) {
            return null;
        }
        $m = Db::one('SELECT first_name, last_name FROM club_members WHERE ref_code = ? AND joined_at IS NOT NULL', [$code]);
        if (!$m) {
            return null;
        }
        $name = trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ? mb_substr((string) $m['last_name'], 0, 1) . '.' : ''));
        return ['name' => $name !== '' ? $name : 'Ein Mitglied', 'points' => (int) Points::program()['bonus_referred']];
    }

    /** Freund tritt mit Einladungscode bei: nur Neukunden, nicht sich selbst. Bonus nach der ersten Bestellung. */
    private static function applyReferral(array $member, string $code, int $orders): void
    {
        $p = Points::program();
        $code = self::normalizeRef($code);
        $ref = Db::one('SELECT * FROM club_members WHERE ref_code = ? AND joined_at IS NOT NULL', [$code]);
        if (!$ref || $ref['id'] === $member['id'] || $member['referred_by'] || $orders > 0) {
            return;
        }
        Db::exec('UPDATE club_members SET referred_by = ? WHERE id = ?', [$ref['id'], $member['id']]);
        if ((int) $p['bonus_referred'] > 0) {
            $who = trim((string) ($ref['first_name'] ?? '')) ?: 'einem Mitglied';
            Points::book($member['id'], 'referred', (int) $p['bonus_referred'], "Eingeladen von $who", $ref['id'], null, [
                'status' => 'locked',
                'unlock_rule' => 'first_order',
                'unlock_min_cents' => (int) $p['referral_min_cents'] ?: null,
            ]);
        }
    }

    /**
     * Eine Bestellung ist eingegangen (gutgeschrieben, noch gesperrt): Boni „nach der ersten Bestellung“ werden
     * mit ihr einlösbar, das werbende Mitglied bekommt seinen Bonus sofort – einlösbar wie die Bestellung.
     */
    public static function onOrderPlaced(array $member, array $order): void
    {
        $unlock = (int) ($order['available_at'] ?? Util::now());
        $rows = Db::all(
            "SELECT id FROM club_ledger WHERE member_id = ? AND status = 'locked' AND unlock_rule = 'first_order' AND (unlock_min_cents IS NULL OR unlock_min_cents <= ?)",
            [$member['id'], (int) $order['amount_cents']]
        );
        foreach ($rows as $l) {
            Db::exec("UPDATE club_ledger SET unlock_rule = 'time', unlock_at = ?, unlock_order = ? WHERE id = ? AND status = 'locked'", [$unlock, $order['order_id'], $l['id']]);
        }
        if ($rows) {
            Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$member['id']]);
        }
        self::rewardReferrer($member, $order);
    }

    /** Die Punkte einer Bestellung sind einlösbar: daran gebundene Boni freigeben (auch die des werbenden Mitglieds). */
    public static function onOrderAvailable(array $member, array $order): void
    {
        foreach (Db::all("SELECT * FROM club_ledger WHERE unlock_order = ? AND status = 'locked'", [$order['order_id']]) as $l) {
            self::unlock($l);
        }
        // Bestellungen aus der Zeit vor 1.4 (noch ohne Bindung an die Bestellung)
        $legacy = Db::all(
            "SELECT * FROM club_ledger WHERE member_id = ? AND status = 'locked' AND unlock_rule = 'first_order' AND (unlock_min_cents IS NULL OR unlock_min_cents <= ?)",
            [$member['id'], (int) $order['amount_cents']]
        );
        foreach ($legacy as $l) {
            self::unlock($l);
        }
        self::rewardReferrer($member, $order);
    }

    /** Die Bestellung wurde storniert oder ganz erstattet: daran gebundene Boni zurücknehmen. */
    public static function onOrderVoid(array $member, array $order): void
    {
        foreach (Db::all('SELECT * FROM club_ledger WHERE unlock_order = ?', [$order['order_id']]) as $l) {
            if ($l['status'] === 'locked') {
                if ($l['kind'] === 'referral') {
                    // Empfehlung: Bonus fällt weg (eine neue Bestellung des Freundes bringt ihn wieder)
                    if (Db::exec("UPDATE club_ledger SET status = 'void' WHERE id = ? AND status = 'locked'", [$l['id']]) === 1) {
                        Push::queue($l['member_id'], 'points_deducted', [
                            'punkte' => (string) (int) $l['points'],
                            'grund' => 'Die Bestellung deiner Empfehlung wurde storniert',
                        ], 'refvoid:' . $l['id'], '/praemien');
                    }
                } else {
                    // Startbonus und Einladung: warten wieder auf die erste Bestellung
                    Db::exec("UPDATE club_ledger SET unlock_rule = 'first_order', unlock_at = NULL, unlock_order = NULL WHERE id = ? AND status = 'locked'", [$l['id']]);
                }
                Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$l['member_id']]);
            } elseif ($l['status'] === 'available' && $l['kind'] === 'referral' && !Db::value("SELECT 1 FROM club_ledger WHERE kind = 'adjust' AND ref = ?", ['void:' . $l['id']])) {
                // Nach der Freigabe storniert: wieder abziehen (wie die Punkte der Bestellung)
                Points::book($l['member_id'], 'adjust', -(int) $l['points'], 'Empfehlung: Die Bestellung wurde storniert', 'void:' . $l['id']);
            }
        }
    }

    /** Cronjob: Boni mit Freigabedatum einlösbar machen (gebunden an eine Bestellung nur, wenn deren Punkte frei sind). */
    public static function releaseDue(?int $now = null): int
    {
        $now ??= Util::now();
        $rows = Db::all(
            "SELECT l.* FROM club_ledger l LEFT JOIN club_orders o ON o.order_id = l.unlock_order
             WHERE l.status = 'locked' AND l.unlock_rule = 'time' AND l.unlock_at <= ? AND (l.unlock_order IS NULL OR o.order_id IS NULL OR o.status = 'available')
             LIMIT 500",
            [$now]
        );
        $n = 0;
        foreach ($rows as $l) {
            $n += self::unlock($l) ? 1 : 0;
        }
        return $n;
    }

    /** Gesperrte Buchung freigeben → Push „jetzt einlösbar“. */
    private static function unlock(array $l): bool
    {
        $now = Util::now();
        $expires = $l['expires_days'] !== null && (int) $l['expires_days'] > 0 ? $now + (int) $l['expires_days'] * Points::DAY_MS : ($l['expires_at'] !== null ? (int) $l['expires_at'] : null);
        if (Db::exec("UPDATE club_ledger SET status = 'available', credited_at = ?, expires_at = ? WHERE id = ? AND status = 'locked'", [$now, $expires, $l['id']]) !== 1) {
            return false;
        }
        Db::exec('UPDATE club_members SET meta_dirty = 1 WHERE id = ?', [$l['member_id']]);
        $grund = match ($l['kind']) {
            'start' => 'Dein Startbonus',
            'referred' => 'Dein Bonus für die Einladung',
            'referral' => 'Dein Bonus für die Empfehlung',
            default => Events::reason((string) $l['kind'], (int) $l['points'], $l['note']),
        };
        Push::queue($l['member_id'], 'points_unlocked', ['punkte' => (string) (int) $l['points'], 'grund' => $grund], 'unlock:l' . $l['id'], '/praemien');
        Events::rewardCheck($l['member_id']);
        return true;
    }

    /**
     * Empfehlung über den Einladungscode beim Beitritt: das werbende Mitglied bekommt seinen Bonus mit der ersten
     * Bestellung des Freundes – sofort gutgeschrieben, einlösbar wie die Bestellung, bei Storno fällt er weg.
     */
    private static function rewardReferrer(array $member, array $order): void
    {
        $p = Points::program();
        if (!$member['referred_by'] || (int) $p['bonus_referrer'] <= 0 || (int) $order['amount_cents'] < (int) $p['referral_min_cents']) {
            return;
        }
        // Schon belohnt? Ein nach der Freigabe wieder abgezogener Bonus zählt nicht (neue Bestellung bringt ihn wieder)
        foreach (Db::all("SELECT id FROM club_ledger WHERE kind = 'referral' AND ref = ? AND status <> 'void'", [$member['id']]) as $l) {
            if (!Db::value("SELECT 1 FROM club_ledger WHERE kind = 'adjust' AND ref = ?", ['void:' . $l['id']])) {
                return;
            }
        }
        // Schon über den Empfehlungslink (Code in der Bestellung) belohnt – nicht doppelt
        if (Referrals::rewardedViaLink((string) $member['referred_by'], (string) $member['shopify_id'])) {
            return;
        }
        $referrer = Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$member['referred_by']]);
        if (!$referrer) {
            return;
        }
        $now = Util::now();
        $year = (int) Db::value("SELECT COUNT(*) FROM club_ledger WHERE member_id = ? AND kind = 'referral' AND status <> 'void' AND created_at > ?", [$referrer['id'], $now - 365 * Points::DAY_MS]);
        if ((int) $p['referral_max_year'] > 0 && $year >= (int) $p['referral_max_year']) {
            return;
        }
        $friend = trim((string) ($member['first_name'] ?? '')) ?: 'Deine Empfehlung';
        // Frei erst, wenn die Punkte der Bestellung frei sind (Wartezeit vorbei und bezahlt)
        $free = $order['status'] === 'available';
        $unlock = max($now, (int) ($order['available_at'] ?? $now));
        $points = (int) $p['bonus_referrer'];
        // An die Bestellung gebunden (auch wenn sie schon frei ist): bei Storno oder Rückgabe fällt der Bonus weg
        Points::book($referrer['id'], 'referral', $points, "$friend hat zum ersten Mal bestellt", $member['id'], null, ['unlock_order' => $order['order_id']] + ($free ? [] : [
            'status' => 'locked',
            'unlock_rule' => 'time',
            'unlock_at' => $unlock,
        ]), false);
        Push::queue($referrer, 'referral', ['freund' => $friend, 'punkte' => (string) $points, 'datum' => $free ? 'sofort' : Events::day($unlock)], 'referral:' . $member['id'] . ':' . $order['order_id']);
        Events::rewardCheck($referrer['id']);
    }

    // ---------- Geburtstag ----------

    public static function setBirthday(array $member, string $value): void
    {
        if ($member['birthday']) {
            throw new HttpError(409, 'Dein Geburtstag ist schon eingetragen. Für eine Änderung schreib uns bitte kurz.');
        }
        if (!preg_match('/^(\d{2})-(\d{2})$/', $value, $m) || !checkdate((int) $m[1], (int) $m[2], 2024)) {
            throw new HttpError(422, 'Bitte wähle Tag und Monat aus.');
        }
        Db::exec('UPDATE club_members SET birthday = ?, birthday_set_at = ? WHERE id = ? AND birthday IS NULL', [$value, Util::now(), $member['id']]);
    }

    /** Täglich: Geburtstagskinder bekommen ihren Bonus (einmal im Jahr; frühestens 30 Tage nach dem Eintragen). */
    public static function runBirthdays(?int $now = null): string
    {
        $now ??= Util::now();
        $bonus = (int) Points::program()['bonus_birthday'];
        if ($bonus <= 0) {
            return '0 Geburtstage';
        }
        $today = date('m-d', intdiv($now, 1000));
        $days = [$today];
        // 29. Februar feiert in anderen Jahren am 28.
        if ($today === '02-28' && !checkdate(2, 29, (int) date('Y', intdiv($now, 1000)))) {
            $days[] = '02-29';
        }
        $year = date('Y', intdiv($now, 1000));
        $n = 0;
        foreach (Db::all('SELECT * FROM club_members WHERE joined_at IS NOT NULL AND birthday IN (' . Db::marks($days) . ') AND birthday_set_at < ?', array_merge($days, [$now - 30 * Points::DAY_MS])) as $m) {
            $ref = 'birthday-' . $year;
            if (Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND kind = 'birthday' AND ref = ?", [$m['id'], $ref])) {
                continue;
            }
            Points::book($m['id'], 'birthday', $bonus, 'Alles Gute zum Geburtstag!', $ref, null, [], false);
            Push::queue($m, 'birthday', ['punkte' => (string) $bonus], 'birthday:' . $m['id'] . ':' . $year);
            Events::rewardCheck($m['id']);
            $n++;
        }
        return "$n Geburtstage";
    }

    // ---------- Newsletter ----------

    private static function newsletterBonus(array $member): bool
    {
        $bonus = (int) Points::program()['bonus_newsletter'];
        if ($bonus <= 0 || $member['newsletter_at'] || Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND kind = 'newsletter'", [$member['id']])) {
            return false;
        }
        Db::exec('UPDATE club_members SET newsletter_at = ? WHERE id = ?', [Util::now(), $member['id']]);
        Points::book($member['id'], 'newsletter', $bonus, 'Danke für deine Newsletter-Anmeldung!');
        Events::rewardCheck($member['id']);
        return true;
    }

    /** Stündlich: Wer hat den Newsletter inzwischen abonniert? (nur Mitglieder ohne Newsletter-Bonus) */
    public static function runNewsletter(?string $memberId = null): string
    {
        if ((int) Points::program()['bonus_newsletter'] <= 0 || !Shopify::configured()) {
            return 'aus';
        }
        $now = Util::now();
        $rows = $memberId
            ? Db::all('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL AND newsletter_at IS NULL AND test = 0', [$memberId])
            : Db::all('SELECT * FROM club_members WHERE joined_at IS NOT NULL AND newsletter_at IS NULL AND test = 0 AND (newsletter_checked_at IS NULL OR newsletter_checked_at < ?) ORDER BY newsletter_checked_at LIMIT 100', [$now - 3600 * 1000]);
        $n = 0;
        foreach (array_chunk($rows, 50) as $chunk) {
            $d = Shopify::graphql(
                'query ClubNewsletter($ids: [ID!]!) { nodes(ids: $ids) { ... on Customer { id defaultEmailAddress { marketingState } } } }',
                ['ids' => array_column($chunk, 'shopify_id')]
            );
            $subscribed = [];
            foreach ($d['nodes'] ?? [] as $c) {
                if (is_array($c) && ($c['defaultEmailAddress']['marketingState'] ?? '') === 'SUBSCRIBED') {
                    $subscribed[$c['id']] = true;
                }
            }
            foreach ($chunk as $m) {
                if (isset($subscribed[$m['shopify_id']])) {
                    $n += self::newsletterBonus($m) ? 1 : 0;
                }
            }
            $ids = array_column($chunk, 'id');
            Db::exec('UPDATE club_members SET newsletter_checked_at = ? WHERE id IN (' . Db::marks($ids) . ')', array_merge([$now], $ids));
        }
        return "$n Newsletter-Boni";
    }

    // ---------- Bewertung (Anfrage, das Team bestätigt) ----------

    public static function claimReview(array $member, string $note): array
    {
        $p = Points::program();
        if ((int) $p['bonus_review'] <= 0) {
            throw new HttpError(409, 'Für Bewertungen gibt es gerade keine Bonuspunkte.');
        }
        $note = trim($note);
        if (mb_strlen($note) < 3) {
            throw new HttpError(422, 'Schreib uns kurz, welchen Duft du wo bewertet hast.');
        }
        if ($p['review_once']) {
            // Einmal je Mitglied: abgelehnte Anfragen zählen nicht
            $prev = Db::value("SELECT status FROM club_claims WHERE member_id = ? AND kind = 'review' AND status IN ('open', 'approved') ORDER BY created_at DESC", [$member['id']]);
            if ($prev) {
                throw new HttpError(409, $prev === 'open' ? 'Deine Bewertung liegt uns schon vor, wir prüfen sie gerade.' : 'Du hast den Bonus für deine Bewertung schon bekommen. Danke dir!');
            }
        } else {
            $month = (int) Db::value("SELECT COUNT(*) FROM club_claims WHERE member_id = ? AND kind = 'review' AND status <> 'rejected' AND created_at > ?", [$member['id'], Util::now() - 30 * Points::DAY_MS]);
            if ($month >= max(1, (int) $p['review_max_month'])) {
                throw new HttpError(429, 'Du hast diesen Monat schon Bewertungen eingereicht. Danke dir!');
            }
        }
        Util::limit('claim:' . $member['id'], 5, 86400, 'Bitte versuche es morgen noch einmal.');
        $id = Util::uuid();
        Db::insert('club_claims', [
            'id' => $id,
            'member_id' => $member['id'],
            'kind' => 'review',
            'note' => mb_substr($note, 0, 500),
            'status' => 'open',
            'points' => null,
            'decided_by' => null,
            'decided_at' => null,
            'created_at' => Util::now(),
        ]);
        return self::claims($member['id']);
    }

    public static function claims(string $memberId): array
    {
        return array_map(static fn ($c) => [
            'id' => $c['id'],
            'kind' => $c['kind'],
            'note' => $c['note'],
            'status' => $c['status'],
            'points' => $c['points'] !== null ? (int) $c['points'] : null,
            'created_at' => (int) $c['created_at'],
        ], Db::all('SELECT * FROM club_claims WHERE member_id = ? ORDER BY created_at DESC LIMIT 20', [$memberId]));
    }

    public static function openClaims(): array
    {
        return array_map(static fn ($c) => [
            'id' => $c['id'],
            'kind' => $c['kind'],
            'note' => $c['note'],
            'status' => $c['status'],
            'created_at' => (int) $c['created_at'],
            'member' => ['id' => $c['member_id'], 'name' => trim(($c['first_name'] ?? '') . ' ' . ($c['last_name'] ?? '')), 'email' => $c['email']],
        ], Db::all(
            "SELECT c.*, m.first_name, m.last_name, m.email FROM club_claims c JOIN club_members m ON m.id = c.member_id
             WHERE c.status = 'open' ORDER BY c.created_at LIMIT 200"
        ));
    }

    public static function decide(array $admin, string $id, bool $approve, ?int $points = null): array
    {
        $c = Db::one("SELECT * FROM club_claims WHERE id = ? AND status = 'open'", [$id]);
        if (!$c) {
            throw new HttpError(404, 'Diese Anfrage ist schon erledigt.');
        }
        $points ??= (int) Points::program()['bonus_review'];
        if ($approve && ($points <= 0 || $points > 100000)) {
            throw new HttpError(422, 'Bitte eine Punktzahl angeben.');
        }
        if ($approve && $c['kind'] === 'review' && Points::program()['review_once']
            && Db::value("SELECT 1 FROM club_claims WHERE member_id = ? AND kind = 'review' AND status = 'approved'", [$c['member_id']])) {
            throw new HttpError(409, 'Dieses Mitglied hat den Bonus für eine Bewertung schon bekommen (einmal je Mitglied). Bitte ablehnen.');
        }
        Db::update('club_claims', [
            'status' => $approve ? 'approved' : 'rejected',
            'points' => $approve ? $points : null,
            'decided_by' => $admin['id'],
            'decided_at' => Util::now(),
        ], ['id' => $id]);
        if ($approve) {
            Points::book($c['member_id'], 'review', $points, 'Bewertung: ' . mb_substr((string) $c['note'], 0, 120), $c['id'], $admin['id']);
            Events::rewardCheck($c['member_id']);
        }
        return self::openClaims();
    }

    // ---------- Übersicht für die App ----------

    public static function status(array $member): array
    {
        $p = Points::program();
        $year = date('Y');
        return [
            'birthday' => $member['birthday'],
            'birthday_bonus_this_year' => (bool) Db::value("SELECT 1 FROM club_ledger WHERE member_id = ? AND kind = 'birthday' AND ref = ?", [$member['id'], 'birthday-' . $year]),
            'newsletter' => $member['newsletter_at'] !== null,
            'referral' => [
                'code' => (int) $p['bonus_referrer'] > 0 || (int) $p['bonus_referred'] > 0 || Referrals::enabled() ? self::refCode($member) : null,
                'invited' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE referred_by = ?', [$member['id']]),
                // ohne stornierte und wieder abgezogene Empfehlungen
                'rewarded' => max(0, (int) Db::value("SELECT COUNT(*) FROM club_ledger WHERE member_id = ? AND kind = 'referral' AND status <> 'void'", [$member['id']])
                    - (int) Db::value("SELECT COUNT(*) FROM club_ledger WHERE member_id = ? AND kind = 'adjust' AND ref LIKE 'void:%'", [$member['id']])),
                // Empfehlungslink mit Rabatt für Freunde (Punkte je Bestellung, auch ohne Club-Beitritt)
                'link' => Referrals::status($member),
            ],
            'claims' => self::claims($member['id']),
            // Bewertungsbonus: einmal je Mitglied – offen (wird geprüft) oder schon erhalten
            'review' => [
                'once' => (bool) $p['review_once'],
                'state' => $p['review_once'] ? (Db::value("SELECT status FROM club_claims WHERE member_id = ? AND kind = 'review' AND status IN ('open', 'approved') ORDER BY created_at DESC", [$member['id']]) ?: null) : null,
            ],
        ];
    }
}
