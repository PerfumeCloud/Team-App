<?php
declare(strict_types=1);

namespace Club;

/** Mitgliedschaft: Anmelden, Beitreten, Austreten. Jede Person ist ein Shopify-Kundenkonto. */
final class Club
{
    public const TAG = 'club';

    /** Nach der Anmeldung über Shopify: Mitglied anlegen oder Name/E-Mail aktualisieren. */
    public static function fromShopify(array $c): array
    {
        $now = Util::now();
        $m = Db::one('SELECT * FROM members WHERE shopify_id = ?', [$c['id']]);
        $data = [
            'email' => mb_substr(mb_strtolower((string) $c['email']), 0, 190),
            'first_name' => Util::str($c['first_name'] ?? null, 100),
            'last_name' => Util::str($c['last_name'] ?? null, 100),
            'last_seen_at' => $now,
            'updated_at' => $now,
        ];
        if ($m) {
            // Leere Namen aus Shopify überschreiben keinen bekannten Namen
            foreach (['first_name', 'last_name'] as $k) {
                if ($data[$k] === null) {
                    unset($data[$k]);
                }
            }
            Db::update('members', $data, ['id' => $m['id']]);
            return Db::one('SELECT * FROM members WHERE id = ?', [$m['id']]);
        }
        $id = Util::uuid();
        Db::insert('members', $data + [
            'id' => $id,
            'shopify_id' => (string) $c['id'],
            'joined_at' => null,
            'orders_synced_at' => null,
            'meta_dirty' => 0,
            'created_at' => $now,
        ]);
        return Db::one('SELECT * FROM members WHERE id = ?', [$id]);
    }

    /** Nach der Anmeldung per E-Mail-Code: Shopify-Kundenkonto suchen oder anlegen. */
    public static function fromEmail(string $email): array
    {
        if (!Shopify::configured()) {
            throw new HttpError(503, 'Die App ist noch nicht mit Shopify verbunden.');
        }
        $d = Shopify::graphql(
            'query ClubFind($q: String!) { customers(first: 1, query: $q) { nodes { id firstName lastName defaultEmailAddress { emailAddress } } } }',
            ['q' => 'email:"' . addcslashes($email, '"\\') . '"']
        );
        $c = $d['customers']['nodes'][0] ?? null;
        if (!$c || mb_strtolower((string) ($c['defaultEmailAddress']['emailAddress'] ?? '')) !== $email) {
            $created = Shopify::graphql(
                'mutation ClubCreate($input: CustomerInput!) { customerCreate(input: $input) { customer { id firstName lastName } userErrors { field message } } }',
                ['input' => ['email' => $email]]
            );
            Shopify::check($created['customerCreate'] ?? [], 'Kundenkonto');
            $c = $created['customerCreate']['customer'] ?? null;
            if (!$c) {
                throw new \RuntimeException('Shopify hat kein Kundenkonto angelegt.');
            }
        }
        return self::fromShopify([
            'id' => $c['id'],
            'email' => $email,
            'first_name' => $c['firstName'] ?? null,
            'last_name' => $c['lastName'] ?? null,
        ]);
    }

    public static function join(array $m, array $in): array
    {
        if ($m['joined_at']) {
            return $m;
        }
        if (empty($in['terms'])) {
            throw new HttpError(422, 'Bitte bestätige die Teilnahmebedingungen.');
        }
        $first = Util::str($in['first_name'] ?? null, 100);
        $now = Util::now();
        $update = ['joined_at' => $now, 'meta_dirty' => 1, 'updated_at' => $now];
        if ($first !== null && !$m['first_name']) {
            $update['first_name'] = $first;
        }
        Db::update('members', $update, ['id' => $m['id']]);
        $m = Db::one('SELECT * FROM members WHERE id = ?', [$m['id']]);
        Points::welcome($m);

        // Shopify: Tag „club“ (für Segmente, Mails, Flow) und erste Punkte aus bisherigen Bestellungen
        if (Shopify::configured()) {
            $member = $m;
            Http::defer(static function () use ($member): void {
                try {
                    $d = Shopify::graphql(
                        'mutation ClubTag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }',
                        ['id' => $member['shopify_id'], 'tags' => [self::TAG]]
                    );
                    Shopify::check($d['tagsAdd'] ?? [], 'Tag');
                } catch (\Throwable $e) {
                    Util::log('Club-Tag: ' . $e->getMessage());
                }
                try {
                    Points::syncMember($member);
                    Points::pushMetafields();
                } catch (\Throwable $e) {
                    Util::log('Beitritt-Abgleich: ' . $e->getMessage());
                }
            });
        }
        return $m;
    }

    /** Austritt: offene Codes werden ungültig, Punkte verfallen, Daten werden gelöscht. */
    public static function leave(array $m): void
    {
        $codes = Db::all("SELECT discount_id FROM codes WHERE member_id = ? AND status = 'active'", [$m['id']]);
        if (Shopify::configured()) {
            foreach ($codes as $c) {
                if ($c['discount_id']) {
                    try {
                        Shopify::graphql('mutation ClubCodeDelete($id: ID!) { discountCodeDelete(id: $id) { userErrors { message } } }', ['id' => $c['discount_id']]);
                    } catch (\Throwable $e) {
                        Util::log('Austritt, Code löschen: ' . $e->getMessage());
                    }
                }
            }
            try {
                Shopify::graphql(
                    'mutation ClubUntag($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }',
                    ['id' => $m['shopify_id'], 'tags' => [self::TAG]]
                );
                Shopify::graphql(
                    'mutation ClubMetaDelete($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { message } } }',
                    ['m' => array_map(static fn ($k) => ['ownerId' => $m['shopify_id'], 'namespace' => 'club', 'key' => $k], ['punkte', 'punkte_ausstehend', 'mitglied_seit'])]
                );
            } catch (\Throwable $e) {
                Util::log('Austritt, Shopify: ' . $e->getMessage());
            }
        }
        Db::tx(static function () use ($m): void {
            foreach (['ledger', 'codes', 'club_orders', 'order_cache'] as $t) {
                Db::exec("DELETE FROM $t WHERE member_id = ?", [$m['id']]);
            }
            Db::exec('DELETE FROM sessions WHERE kind = ? AND subject_id = ?', ['member', $m['id']]);
            Db::exec('DELETE FROM members WHERE id = ?', [$m['id']]);
        });
    }

    public static function publicMember(array $m): array
    {
        return [
            'id' => $m['id'],
            'email' => $m['email'],
            'first_name' => $m['first_name'],
            'last_name' => $m['last_name'],
            'joined_at' => $m['joined_at'] !== null ? (int) $m['joined_at'] : null,
        ];
    }

    /** Alles für die Startseite der App in einem Aufruf. */
    public static function me(array $m): array
    {
        $out = [
            'member' => self::publicMember($m),
            'program' => Points::publicProgram(),
            'shop_url' => Shopify::shopUrl(),
            'account_url' => self::accountUrl(),
        ];
        if ($m['joined_at']) {
            $out['points'] = Points::summary($m);
            $out['codes'] = array_values(array_filter(Points::codes($m['id']), static fn ($c) => $c['status'] === 'active'));
        }
        return $out;
    }

    /** Link zum Shopify-Kundenkonto (Adressen, Zahlungsarten, Bestellungen bei Shopify). */
    public static function accountUrl(): string
    {
        $url = Settings::get('account_url');
        return is_string($url) && $url !== '' ? $url : Shopify::shopUrl() . '/account';
    }
}
