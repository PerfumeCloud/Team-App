<?php
declare(strict_types=1);

namespace PC;

/** Holt Bestellungen und Lagerbestand aus Shopify und legt sie für die Statistik lokal ab. */
final class OrdersJob
{
    private const ORDERS_QUERY = <<<'GQL'
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      updatedAt
      cancelledAt
      test
      displayFinancialStatus
      displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 20) {
        nodes {
          title
          variantTitle
          quantity
          sku
          originalTotalSet { shopMoney { amount } }
          product { id }
        }
      }
    }
  }
}
GQL;

    private const LOW_STOCK_QUERY = <<<'GQL'
query LowStock($query: String) {
  productVariants(first: 50, query: $query) {
    nodes {
      id
      displayName
      sku
      inventoryQuantity
      inventoryItem { tracked }
      product { title status }
    }
  }
}
GQL;

    public static function run(): string
    {
        $cursorTs = (int) Settings::get('orders_cursor', 0);
        $initial = $cursorTs === 0;
        $filter = $initial
            ? "created_at:>='" . gmdate('Y-m-d\TH:i:s\Z', time() - 90 * 86400) . "'"
            : "updated_at:>'" . gmdate('Y-m-d\TH:i:s\Z', intdiv($cursorTs, 1000) - 120) . "'";

        $after = null;
        $count = 0;
        $newOrders = [];
        $maxUpdated = $cursorTs;
        $now = Util::now();

        for ($page = 0; $page < 40; $page++) {
            $data = Shopify::graphql(self::ORDERS_QUERY, ['first' => 25, 'after' => $after, 'query' => $filter]);
            $conn = $data['orders'] ?? null;
            if (!$conn) {
                break;
            }
            foreach ($conn['nodes'] as $o) {
                if (!empty($o['test'])) {
                    continue;
                }
                $id = preg_replace('/\D/', '', (string) $o['id']);
                $items = [];
                $itemCount = 0;
                foreach ($o['lineItems']['nodes'] ?? [] as $li) {
                    $items[] = [
                        't' => (string) $li['title'],
                        'v' => $li['variantTitle'] ?? null,
                        'q' => (int) $li['quantity'],
                        's' => self::cents($li['originalTotalSet']['shopMoney']['amount'] ?? '0'),
                    ];
                    $itemCount += (int) $li['quantity'];
                }
                $updated = (int) (strtotime((string) $o['updatedAt']) * 1000);
                $created = (int) (strtotime((string) $o['createdAt']) * 1000);
                $exists = Db::value('SELECT 1 FROM orders WHERE id = ?', [$id]);
                Db::upsert('orders', [
                    'id' => $id,
                    'name' => (string) $o['name'],
                    'created_at' => $created,
                    'shop_updated_at' => $updated,
                    'total_cents' => self::cents($o['currentTotalPriceSet']['shopMoney']['amount'] ?? '0'),
                    'currency' => (string) ($o['currentTotalPriceSet']['shopMoney']['currencyCode'] ?? 'EUR'),
                    'financial_status' => $o['displayFinancialStatus'] ?? null,
                    'fulfillment_status' => $o['displayFulfillmentStatus'] ?? null,
                    'cancelled' => !empty($o['cancelledAt']) ? 1 : 0,
                    'item_count' => $itemCount,
                    'items' => Util::json($items),
                    'synced_at' => $now,
                ]);
                if (!$exists && !$initial && $created > $now - 3 * 3600 * 1000 && empty($o['cancelledAt'])) {
                    $newOrders[] = ['name' => $o['name'], 'cents' => self::cents($o['currentTotalPriceSet']['shopMoney']['amount'] ?? '0'), 'items' => $itemCount, 'first' => $items[0]['t'] ?? ''];
                }
                $maxUpdated = max($maxUpdated, $updated);
                $count++;
            }
            if (empty($conn['pageInfo']['hasNextPage'])) {
                break;
            }
            $after = $conn['pageInfo']['endCursor'];
        }

        Settings::set('orders_cursor', $maxUpdated ?: $now);
        Settings::set('orders_last_sync', $now);
        self::refreshLowStock();

        if ($newOrders && !Notify::quietHours()) {
            if (count($newOrders) <= 3) {
                foreach ($newOrders as $o) {
                    Notify::users(null, 'orders', [
                        'title' => 'Neue Bestellung ' . $o['name'],
                        'body' => Util::euro($o['cents']) . ' · ' . $o['items'] . ($o['items'] === 1 ? ' Artikel' : ' Artikel') . ($o['first'] ? ' · ' . $o['first'] : ''),
                        'url' => '/statistik',
                        'tag' => 'order-' . $o['name'],
                    ]);
                }
            } else {
                $sum = array_sum(array_column($newOrders, 'cents'));
                Notify::users(null, 'orders', [
                    'title' => count($newOrders) . ' neue Bestellungen',
                    'body' => 'Zusammen ' . Util::euro($sum),
                    'url' => '/statistik',
                    'tag' => 'orders-summary',
                ]);
            }
        }
        return "$count Bestellungen aktualisiert" . ($newOrders ? ', ' . count($newOrders) . ' neu' : '');
    }

    public static function refreshLowStock(): void
    {
        $threshold = (int) Settings::get('low_stock_threshold', 5);
        $data = Shopify::graphql(self::LOW_STOCK_QUERY, ['query' => "inventory_quantity:<=$threshold"]);
        $list = [];
        foreach ($data['productVariants']['nodes'] ?? [] as $v) {
            if (empty($v['inventoryItem']['tracked']) || ($v['product']['status'] ?? '') !== 'ACTIVE') {
                continue;
            }
            $list[] = [
                'title' => (string) ($v['product']['title'] ?? $v['displayName']),
                'variant' => (string) $v['displayName'],
                'sku' => $v['sku'] ?? null,
                'qty' => (int) $v['inventoryQuantity'],
            ];
        }
        usort($list, static fn ($a, $b) => $a['qty'] <=> $b['qty']);
        Settings::set('low_stock', ['at' => Util::now(), 'threshold' => $threshold, 'items' => array_slice($list, 0, 20)]);
    }

    private static function cents(mixed $amount): int
    {
        return (int) round(((float) $amount) * 100);
    }
}
