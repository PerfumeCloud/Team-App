<?php
declare(strict_types=1);

namespace Club;

/**
 * Die Regeln des Clubs als Shop-Metafeld club.programm (JSON). Das Theme liest daraus die Punkte je Euro
 * der Stufen und laufende Aktionen – so zeigt der Warenkorb „Mit dieser Bestellung sammelst du 59 Punkte“
 * und die Club-Seite im Shop aktualisiert sich, sobald im Admin-Bereich etwas geändert wird.
 */
final class ShopSync
{
    public static function markDirty(): void
    {
        Settings::set('shop_program_dirty', true);
        if (PHP_SAPI !== 'cli') {
            Http::defer(static function (): void {
                try {
                    self::run();
                } catch (\Throwable $e) {
                    Util::log('Shop-Metafeld: ' . $e->getMessage());
                }
            });
        }
    }

    /** Inhalt des Metafelds. */
    public static function payload(): array
    {
        $p = Points::program();
        $now = Util::now();
        $promos = [];
        foreach (Promotions::all() as $pr) {
            if ((int) $pr['ends_at'] > $now) {
                $promos[] = [
                    'name' => $pr['name'],
                    'factor' => (float) $pr['factor'],
                    'start' => gmdate('c', intdiv((int) $pr['starts_at'], 1000)),
                    'end' => gmdate('c', intdiv((int) $pr['ends_at'], 1000)),
                ];
            }
        }
        return [
            'name' => $p['name'],
            'app_url' => Util::baseUrl(),
            'rate' => (float) $p['earn_per_euro'],
            'tiers_enabled' => (bool) $p['tiers_enabled'],
            'tiers' => array_map(static fn ($t) => [
                'key' => $t['key'],
                'name' => $t['name'],
                'rate' => (float) $t['rate'],
                'min_cents' => (int) $t['min_cents'],
                'benefits' => $t['benefits'],
            ], $p['tiers']),
            'tier_months' => (int) $p['tier_months'],
            // 1.4: Stufe nach dem Einkaufswert seit dem Beitritt, Punkte sofort gutgeschrieben, einlösbar nach wait_days
            'tier_basis' => 'lifetime',
            'wait_from' => 'order',
            'expiry_warn' => Points::warnDays($p),
            'waitlist' => (static function (): array {
                $w = Waitlist::status();
                return ['full' => $w['full'], 'text' => $w['text']];
            })(),
            'redeem_points' => (int) $p['redeem_points'],
            'redeem_cents' => (int) $p['redeem_cents'],
            'max_cents' => (int) $p['max_cents'],
            'welcome_points' => (int) $p['welcome_points'],
            'wait_days' => (int) $p['wait_days'],
            'code_days' => (int) $p['code_days'],
            'expiry_months' => (int) $p['points_expiry_months'],
            'bonus' => [
                'birthday' => (int) $p['bonus_birthday'],
                'newsletter' => (int) $p['bonus_newsletter'],
                'review' => (int) $p['bonus_review'],
                'referrer' => (int) $p['bonus_referrer'],
                'referred' => (int) $p['bonus_referred'],
            ],
            'promos' => $promos,
            'updated' => gmdate('c'),
        ];
    }

    private static function shopId(): string
    {
        $id = Settings::get('shop_gid');
        if (is_string($id) && $id !== '') {
            return $id;
        }
        $d = Shopify::graphql('query ClubShopId { shop { id } }');
        $id = (string) ($d['shop']['id'] ?? '');
        if ($id === '') {
            throw new \RuntimeException('Shop-ID unbekannt.');
        }
        Settings::set('shop_gid', $id);
        return $id;
    }

    /** Schreibt das Metafeld, wenn sich etwas geändert hat (oder täglich, damit beendete Aktionen verschwinden). */
    public static function run(bool $force = false): string
    {
        if (!Shopify::configured()) {
            return 'Shopify nicht verbunden';
        }
        $last = (int) (Settings::get('shop_program_at') ?? 0);
        if (!$force && !Settings::get('shop_program_dirty') && Util::now() - $last < 86400 * 1000) {
            return 'aktuell';
        }
        $payload = self::payload();
        try {
            $d = Shopify::graphql(
                'mutation ClubShopMeta($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { key } userErrors { field message } } }',
                ['m' => [[
                    'ownerId' => self::shopId(),
                    'namespace' => 'club',
                    'key' => 'programm',
                    'type' => 'json',
                    'value' => Util::json($payload),
                ]]]
            );
            Shopify::check($d['metafieldsSet'] ?? [], 'Shop-Metafeld');
        } catch (\Throwable $e) {
            Settings::set('shop_program_status', ['ok' => false, 'at' => Util::now(), 'message' => $e->getMessage()]);
            throw $e;
        }
        Settings::set('shop_program_dirty', false);
        Settings::set('shop_program_at', Util::now());
        Settings::set('shop_program_status', ['ok' => true, 'at' => Util::now(), 'message' => 'Regeln im Shop aktualisiert']);
        try {
            self::syncSegment((int) $payload['redeem_points']);
        } catch (\Throwable $e) {
            Util::log('Segment „' . self::SEGMENT . '“: ' . $e->getMessage());
        }
        return 'Regeln im Shop aktualisiert';
    }

    public const SEGMENT = 'Club: Prämie einlösbar';

    /** Segmentbedingung für Mitglieder, die genug Punkte für eine Prämie haben. */
    public static function segmentQuery(int $points): string
    {
        return "customer_tags CONTAINS 'club' AND metafields.club.punkte >= " . max(1, $points);
    }

    /**
     * Das Segment „Club: Prämie einlösbar“ (Empfänger der Erinnerung „Du hast 5 € Rabatt bereit“ in Shopify Messaging)
     * folgt der Einlöse-Schwelle aus dem Admin-Bereich – fehlt es, wird es angelegt.
     */
    private static function syncSegment(int $points): void
    {
        $query = self::segmentQuery($points);
        if (Settings::get('shop_segment_query') === $query) {
            return;
        }
        $d = Shopify::graphql('query ClubSegments { segments(first: 100) { nodes { id name query } } }');
        $segment = null;
        foreach ($d['segments']['nodes'] ?? [] as $s) {
            if (($s['name'] ?? '') === self::SEGMENT) {
                $segment = $s;
            }
        }
        if ($segment === null) {
            $r = Shopify::graphql(
                'mutation ClubSegmentCreate($name: String!, $query: String!) { segmentCreate(name: $name, query: $query) { segment { id } userErrors { field message } } }',
                ['name' => self::SEGMENT, 'query' => $query]
            );
            Shopify::check($r['segmentCreate'] ?? [], 'Segment');
        } elseif (($segment['query'] ?? '') !== $query) {
            $r = Shopify::graphql(
                'mutation ClubSegmentUpdate($id: ID!, $query: String) { segmentUpdate(id: $id, query: $query) { segment { id } userErrors { field message } } }',
                ['id' => $segment['id'], 'query' => $query]
            );
            Shopify::check($r['segmentUpdate'] ?? [], 'Segment');
        }
        Settings::set('shop_segment_query', $query);
    }
}
