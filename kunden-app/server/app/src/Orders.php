<?php
declare(strict_types=1);

namespace Club;

/** Bestellungen und Sendungsverfolgung für die angemeldete Person (aus der Shopify Admin API). */
final class Orders
{
    private const CACHE_MS = 60 * 1000;

    private const QUERY = 'query ClubOrders($id: ID!) { customer(id: $id) { orders(first: 30, sortKey: PROCESSED_AT, reverse: true) { nodes {
        id name processedAt createdAt cancelledAt test fullyPaid displayFinancialStatus displayFulfillmentStatus statusPageUrl discountCodes
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        lineItems(first: 20) { nodes { title variantTitle quantity image { url(transform: {maxWidth: 240}) altText } } }
        fulfillments(first: 10) { status displayStatus createdAt deliveredAt inTransitAt estimatedDeliveryAt trackingInfo(first: 3) { company number url } }
    } } } }';

    /** @return array{orders: array, fetched_at: int, error?: string} */
    public static function list(array $member, bool $fresh = false): array
    {
        $cache = Db::one('SELECT data, fetched_at FROM club_order_cache WHERE member_id = ?', [$member['id']]);
        $nodes = null;
        $fetched = 0;
        $error = null;
        if (!$fresh && $cache && Util::now() - (int) $cache['fetched_at'] < self::CACHE_MS) {
            $nodes = json_decode((string) $cache['data'], true);
            $fetched = (int) $cache['fetched_at'];
        }
        if (!is_array($nodes)) {
            try {
                $d = Shopify::graphql(self::QUERY, ['id' => $member['shopify_id']]);
                $nodes = $d['customer']['orders']['nodes'] ?? [];
                $fetched = Util::now();
                if ($member['joined_at']) {
                    $prog = Points::program();
                    foreach ($nodes as $o) {
                        Points::upsertOrder($member, $o, $prog);
                    }
                    Db::exec('UPDATE club_members SET orders_synced_at = ? WHERE id = ?', [$fetched, $member['id']]);
                }
                Db::exec('DELETE FROM club_order_cache WHERE member_id = ?', [$member['id']]);
                Db::insert('club_order_cache', ['member_id' => $member['id'], 'data' => Util::json($nodes), 'fetched_at' => $fetched]);
            } catch (\Throwable $e) {
                Util::log('Bestellungen: ' . $e->getMessage());
                $nodes = $cache ? (json_decode((string) $cache['data'], true) ?: []) : [];
                $fetched = $cache ? (int) $cache['fetched_at'] : 0;
                $error = 'Shopify ist gerade nicht erreichbar. Du siehst den letzten bekannten Stand.';
            }
        }

        $points = [];
        foreach (Db::all('SELECT order_id, points, status, reason, available_at FROM club_orders WHERE member_id = ?', [$member['id']]) as $r) {
            $points[$r['order_id']] = [
                'points' => (int) $r['points'],
                'status' => $r['status'],
                'reason' => $r['reason'],
                'available_at' => $r['available_at'] !== null ? (int) $r['available_at'] : null,
            ];
        }
        $out = [];
        foreach ($nodes as $o) {
            if (!empty($o['test']) && !Points::program()['count_test']) {
                // Testbestellungen nur zeigen, wenn sie auch zählen
                continue;
            }
            $view = self::present($o);
            $view['points'] = $points[$o['id']] ?? null;
            $out[] = $view;
        }
        $result = ['orders' => $out, 'fetched_at' => $fetched];
        if ($error) {
            $result['error'] = $error;
        }
        return $result;
    }

    public static function present(array $o): array
    {
        $fulfillments = array_values(array_filter($o['fulfillments'] ?? [], static fn ($f) => in_array($f['status'] ?? 'SUCCESS', ['SUCCESS', 'OPEN', 'PENDING'], true)));
        usort($fulfillments, static fn ($a, $b) => strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? '')));
        $latest = $fulfillments ? $fulfillments[count($fulfillments) - 1] : null;

        $tracking = [];
        foreach ($fulfillments as $f) {
            foreach ($f['trackingInfo'] ?? [] as $t) {
                if (!empty($t['number']) || !empty($t['url'])) {
                    $tracking[] = ['company' => $t['company'] ?? null, 'number' => $t['number'] ?? null, 'url' => self::safeUrl($t['url'] ?? null)];
                }
            }
        }
        $items = [];
        $count = 0;
        foreach ($o['lineItems']['nodes'] ?? [] as $li) {
            $count += (int) ($li['quantity'] ?? 0);
            $items[] = [
                'title' => (string) ($li['title'] ?? ''),
                'variant' => $li['variantTitle'] ?? null,
                'quantity' => (int) ($li['quantity'] ?? 0),
                'image' => self::safeUrl($li['image']['url'] ?? null),
            ];
        }

        $shippedAt = $fulfillments ? Util::ms($fulfillments[0]['createdAt'] ?? null) : null;
        $deliveredAt = null;
        foreach ($fulfillments as $f) {
            $deliveredAt = Util::ms($f['deliveredAt'] ?? null) ?? $deliveredAt;
        }
        $cancelled = !empty($o['cancelledAt']);
        $paid = !empty($o['fullyPaid']);
        $status = self::status($o, $latest);

        return [
            'id' => preg_replace('/\D/', '', (string) $o['id']),
            'gid' => (string) $o['id'],
            'name' => (string) ($o['name'] ?? ''),
            'date' => Util::ms($o['processedAt'] ?? $o['createdAt'] ?? null),
            'total_cents' => Util::cents($o['currentTotalPriceSet']['shopMoney']['amount'] ?? 0),
            'currency' => (string) ($o['currentTotalPriceSet']['shopMoney']['currencyCode'] ?? 'EUR'),
            'status' => $status,
            'cancelled' => $cancelled,
            'steps' => $cancelled ? [] : [
                ['key' => 'ordered', 'label' => 'Bestellt', 'done' => true, 'at' => Util::ms($o['processedAt'] ?? null)],
                ['key' => 'paid', 'label' => 'Bezahlt', 'done' => $paid, 'at' => null],
                ['key' => 'shipped', 'label' => 'Versendet', 'done' => $shippedAt !== null, 'at' => $shippedAt],
                ['key' => 'delivered', 'label' => 'Zugestellt', 'done' => $deliveredAt !== null || ($latest['displayStatus'] ?? '') === 'DELIVERED' || ($latest['displayStatus'] ?? '') === 'PICKED_UP', 'at' => $deliveredAt],
            ],
            'eta' => $latest ? Util::ms($latest['estimatedDeliveryAt'] ?? null) : null,
            'tracking' => $tracking,
            'items' => $items,
            'item_count' => $count,
            'status_url' => self::safeUrl($o['statusPageUrl'] ?? null),
        ];
    }

    /** Ein verständlicher Status für Kundinnen und Kunden. tone: good | progress | wait | bad | muted */
    private static function status(array $o, ?array $latest): array
    {
        if (!empty($o['cancelledAt'])) {
            return ['key' => 'cancelled', 'label' => 'Storniert', 'tone' => 'muted'];
        }
        $fin = (string) ($o['displayFinancialStatus'] ?? '');
        if ($fin === 'REFUNDED') {
            return ['key' => 'refunded', 'label' => 'Erstattet', 'tone' => 'muted'];
        }
        if ($latest) {
            $map = [
                'DELIVERED' => ['delivered', 'Zugestellt', 'good'],
                'PICKED_UP' => ['delivered', 'Abgeholt', 'good'],
                'OUT_FOR_DELIVERY' => ['out', 'In Zustellung', 'progress'],
                'READY_FOR_PICKUP' => ['pickup', 'Abholbereit', 'progress'],
                'ATTEMPTED_DELIVERY' => ['attempted', 'Zustellversuch', 'bad'],
                'FAILURE' => ['problem', 'Problem beim Versand', 'bad'],
                'NOT_DELIVERED' => ['problem', 'Nicht zugestellt', 'bad'],
            ];
            $ds = (string) ($latest['displayStatus'] ?? '');
            if (isset($map[$ds])) {
                [$key, $label, $tone] = $map[$ds];
                return ['key' => $key, 'label' => $label, 'tone' => $tone];
            }
            if (($o['displayFulfillmentStatus'] ?? '') === 'PARTIALLY_FULFILLED') {
                return ['key' => 'partial', 'label' => 'Teilweise versendet', 'tone' => 'progress'];
            }
            return ['key' => 'shipped', 'label' => 'Versendet', 'tone' => 'progress'];
        }
        if (empty($o['fullyPaid']) && in_array($fin, ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED'], true)) {
            return ['key' => 'payment', 'label' => 'Zahlung ausstehend', 'tone' => 'wait'];
        }
        return ['key' => 'processing', 'label' => 'In Bearbeitung', 'tone' => 'wait'];
    }

    private static function safeUrl(mixed $url): ?string
    {
        return is_string($url) && preg_match('#^https://#i', $url) ? $url : null;
    }
}
