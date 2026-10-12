<?php
declare(strict_types=1);

namespace PC;

/** Kennzahlen aus den lokal gespeicherten Shopify-Bestellungen. */
final class Stats
{
    private const TO_SHIP = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'OPEN', 'PENDING_FULFILLMENT', 'SCHEDULED', 'ON_HOLD'];
    private const PAID = ['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'AUTHORIZED'];
    private const EXCLUDED_FINANCIAL = ['VOIDED', 'EXPIRED'];

    /** Bezahlte, noch nicht (vollständig) versendete Bestellungen – neueste zuerst. */
    public static function toShip(): array
    {
        $rows = Db::all('SELECT * FROM orders WHERE cancelled = 0 ORDER BY created_at DESC LIMIT 500');
        return array_values(array_filter($rows, static fn ($o) =>
            in_array($o['fulfillment_status'], self::TO_SHIP, true) && in_array($o['financial_status'], self::PAID, true)));
    }

    /** Umsatz und Bestellungen seit heute 0 Uhr (Berlin). */
    public static function today(): array
    {
        $start = (new \DateTimeImmutable('today', new \DateTimeZone('Europe/Berlin')))->getTimestamp() * 1000;
        $rows = Db::all("SELECT total_cents, financial_status FROM orders WHERE cancelled = 0 AND created_at >= ?", [$start]);
        $rows = array_filter($rows, static fn ($o) => !in_array($o['financial_status'], self::EXCLUDED_FINANCIAL, true));
        return ['revenue' => array_sum(array_map(static fn ($o) => (int) $o['total_cents'], $rows)), 'orders' => count($rows)];
    }

    public static function compute(int $days): array
    {
        $days = in_array($days, [7, 30, 90], true) ? $days : 30;
        $tz = new \DateTimeZone('Europe/Berlin');
        $today = new \DateTimeImmutable('today', $tz);
        $start = $today->modify('-' . ($days - 1) . ' days');
        $prevStart = $start->modify("-$days days");
        $startMs = $start->getTimestamp() * 1000;
        $prevStartMs = $prevStart->getTimestamp() * 1000;
        $todayMs = $today->getTimestamp() * 1000;

        $rows = Db::all('SELECT * FROM orders WHERE created_at >= ? AND cancelled = 0 ORDER BY created_at', [$prevStartMs]);

        $series = [];
        for ($d = $start; $d <= $today; $d = $d->modify('+1 day')) {
            $series[$d->format('Y-m-d')] = ['date' => $d->format('Y-m-d'), 'revenue' => 0, 'orders' => 0];
        }
        $cur = ['revenue' => 0, 'orders' => 0, 'items' => 0];
        $prev = ['revenue' => 0, 'orders' => 0, 'items' => 0];
        $todayTotals = ['revenue' => 0, 'orders' => 0];
        $products = [];

        foreach ($rows as $o) {
            if (in_array($o['financial_status'], self::EXCLUDED_FINANCIAL, true)) {
                continue;
            }
            $ts = (int) $o['created_at'];
            $cents = (int) $o['total_cents'];
            if ($ts >= $startMs) {
                $key = (new \DateTimeImmutable('@' . intdiv($ts, 1000)))->setTimezone($tz)->format('Y-m-d');
                if (isset($series[$key])) {
                    $series[$key]['revenue'] += $cents;
                    $series[$key]['orders']++;
                }
                $cur['revenue'] += $cents;
                $cur['orders']++;
                $cur['items'] += (int) $o['item_count'];
                foreach (json_decode((string) $o['items'], true) ?: [] as $it) {
                    $t = (string) $it['t'];
                    $products[$t] ??= ['title' => $t, 'qty' => 0, 'revenue' => 0];
                    $products[$t]['qty'] += (int) $it['q'];
                    $products[$t]['revenue'] += (int) $it['s'];
                }
                if ($ts >= $todayMs) {
                    $todayTotals['revenue'] += $cents;
                    $todayTotals['orders']++;
                }
            } else {
                $prev['revenue'] += $cents;
                $prev['orders']++;
                $prev['items'] += (int) $o['item_count'];
            }
        }
        usort($products, static fn ($a, $b) => $b['revenue'] <=> $a['revenue']);

        $toShip = self::toShip();

        $recent = array_map(static fn ($o) => [
            'id' => $o['id'],
            'name' => $o['name'],
            'created_at' => (int) $o['created_at'],
            'total' => (int) $o['total_cents'],
            'items' => (int) $o['item_count'],
            'financial' => $o['financial_status'],
            'fulfillment' => $o['fulfillment_status'],
            'cancelled' => (int) $o['cancelled'],
        ], Db::all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8'));

        $aov = static fn (array $t) => $t['orders'] ? (int) round($t['revenue'] / $t['orders']) : 0;

        return [
            'days' => $days,
            'currency' => 'EUR',
            'configured' => Shopify::configured(),
            'lastSync' => (int) Settings::get('orders_last_sync', 0),
            'today' => $todayTotals,
            'current' => $cur + ['aov' => $aov($cur)],
            'previous' => $prev + ['aov' => $aov($prev)],
            'series' => array_values($series),
            'topProducts' => array_slice($products, 0, 6),
            'toShip' => [
                'count' => count($toShip),
                'oldest' => $toShip ? (int) end($toShip)['created_at'] : null,
            ],
            'recent' => $recent,
            'lowStock' => Settings::get('low_stock', ['items' => []]),
        ];
    }
}
