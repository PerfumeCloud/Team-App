<?php
declare(strict_types=1);

namespace PC;

/**
 * Versand: offene Bestellungen aus Shopify, Sendungsnummer eintragen (auch per Kamera) und in Shopify
 * als versendet markieren – auf Wunsch mit Versandbestätigung an die Kundin (Shopify-Mail).
 * Erinnerung, wenn Bestellungen länger als X Tage auf den Versand warten.
 *
 * Braucht in Shopify: read_orders und write_merchant_managed_fulfillment_orders.
 */
final class Shipping
{
    public const SCOPES = ['read_orders', 'write_merchant_managed_fulfillment_orders'];

    /** Versanddienste: Name genau so, wie Shopify ihn kennt (dann erkennt Shopify die Sendung) → Link zur Verfolgung. */
    public const CARRIERS = [
        'DHL' => 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode={n}',
        'Deutsche Post (DE)' => 'https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode={n}',
        'Hermes' => 'https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#{n}',
        'DPD' => 'https://tracking.dpd.de/status/de_DE/parcel/{n}',
        'GLS' => 'https://gls-group.com/DE/de/paketverfolgung?match={n}',
        'UPS' => 'https://www.ups.com/track?loc=de_DE&tracknum={n}',
        'DHL Express' => 'https://www.dhl.com/de-de/home/tracking/tracking-express.html?tracking-id={n}',
    ];

    private const PAID = ['PAID', 'PARTIALLY_REFUNDED', 'AUTHORIZED', 'PARTIALLY_PAID'];

    private const LIST_QUERY = <<<'GQL'
query ToShip($q: String!) {
  orders(first: 60, query: $q, sortKey: CREATED_AT) {
    nodes {
      id name createdAt test note tags
      displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount } }
      shippingLine { title }
      ADDRESS
      fulfillmentOrders(first: 5) {
        nodes {
          id status
          supportedActions { action }
          assignedLocation { name }
          lineItems(first: 30) { nodes { productTitle variantTitle remainingQuantity } }
        }
      }
    }
  }
}
GQL;

    private const ORDER_FOS = <<<'GQL'
query FOs($id: ID!) {
  order(id: $id) {
    id name displayFulfillmentStatus
    fulfillmentOrders(first: 10) {
      nodes {
        id status
        supportedActions { action }
        assignedLocation { name }
        lineItems(first: 50) { nodes { productTitle variantTitle remainingQuantity } }
      }
    }
  }
}
GQL;

    private const CREATE = <<<'GQL'
mutation Ship($f: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $f) {
    fulfillment { id status trackingInfo { company number url } }
    userErrors { field message }
  }
}
GQL;

    public static function settings(): array
    {
        $s = Settings::get('shipping');
        $s = is_array($s) ? $s : [];
        $carrier = (string) ($s['default_carrier'] ?? 'DHL');
        return [
            'remind_days' => max(0, min(14, (int) ($s['remind_days'] ?? 2))),
            'default_carrier' => isset(self::CARRIERS[$carrier]) ? $carrier : 'DHL',
            'notify' => (bool) ($s['notify'] ?? true),
        ];
    }

    public static function saveSettings(array $in): array
    {
        $cur = self::settings();
        if (isset($in['remind_days'])) {
            $cur['remind_days'] = max(0, min(14, (int) $in['remind_days']));
        }
        if (isset($in['default_carrier']) && isset(self::CARRIERS[$in['default_carrier']])) {
            $cur['default_carrier'] = $in['default_carrier'];
        }
        if (isset($in['notify'])) {
            $cur['notify'] = (bool) $in['notify'];
        }
        Settings::set('shipping', $cur);
        return $cur;
    }

    /** Offene Bestellungen, älteste zuerst. */
    public static function list(): array
    {
        $out = [
            'configured' => Shopify::configured(),
            'missing' => [],
            'error' => null,
            'orders' => [],
            'settings' => self::settings(),
            'carriers' => array_keys(self::CARRIERS),
            'recent' => self::recent(),
        ];
        if (!Shopify::configured()) {
            return $out;
        }
        $out['missing'] = Shopify::missing(self::SCOPES);
        try {
            $q = 'status:open AND (fulfillment_status:unshipped OR fulfillment_status:partial)';
            try {
                $d = Shopify::graphql(str_replace('ADDRESS', 'shippingAddress { name city zip countryCodeV2 }', self::LIST_QUERY), ['q' => $q]);
            } catch (\RuntimeException $e) {
                if (!preg_match('/access|denied|protected/i', $e->getMessage())) {
                    throw $e;
                }
                $d = Shopify::graphql(str_replace('ADDRESS', '', self::LIST_QUERY), ['q' => $q]);
            }
            $now = Util::now();
            foreach ($d['orders']['nodes'] ?? [] as $o) {
                $out['orders'][] = self::row($o, $now);
            }
        } catch (\Throwable $e) {
            $out['error'] = Customers::friendly($e->getMessage());
        }
        return $out;
    }

    private static function row(array $o, int $now): array
    {
        $created = (int) (strtotime((string) $o['createdAt']) * 1000);
        $items = [];
        $canShip = false;
        $location = null;
        foreach ($o['fulfillmentOrders']['nodes'] ?? [] as $fo) {
            $actions = array_column($fo['supportedActions'] ?? [], 'action');
            if (!in_array($fo['status'], ['OPEN', 'IN_PROGRESS'], true)) {
                continue;
            }
            $canShip = $canShip || in_array('CREATE_FULFILLMENT', $actions, true);
            $location ??= $fo['assignedLocation']['name'] ?? null;
            foreach ($fo['lineItems']['nodes'] ?? [] as $li) {
                if ((int) $li['remainingQuantity'] > 0) {
                    $items[] = ['title' => (string) $li['productTitle'], 'variant' => $li['variantTitle'] ?? null, 'qty' => (int) $li['remainingQuantity']];
                }
            }
        }
        $financial = (string) ($o['displayFinancialStatus'] ?? '');
        $tags = array_values(array_filter((array) ($o['tags'] ?? []), 'is_string'));
        $id = Shopify::numericId((string) $o['id']);
        return [
            'id' => $id,
            'name' => (string) $o['name'],
            'created_at' => $created,
            'age_days' => (int) floor(($now - $created) / 86400000),
            'total_cents' => (int) round(((float) ($o['currentTotalPriceSet']['shopMoney']['amount'] ?? 0)) * 100),
            'financial' => $financial,
            'financial_label' => Customers::FINANCIAL[$financial] ?? $financial,
            'paid' => in_array($financial, self::PAID, true),
            'partial' => ($o['displayFulfillmentStatus'] ?? '') === 'PARTIALLY_FULFILLED',
            'customer' => isset($o['shippingAddress']) && is_array($o['shippingAddress']) ? [
                'name' => $o['shippingAddress']['name'] ?? null,
                'city' => trim(($o['shippingAddress']['zip'] ?? '') . ' ' . ($o['shippingAddress']['city'] ?? '')),
                'country' => $o['shippingAddress']['countryCodeV2'] ?? null,
            ] : null,
            'method' => $o['shippingLine']['title'] ?? null,
            'note' => $o['note'] ?? null,
            'location' => $location,
            'items' => $items,
            'can_ship' => $canShip && $items !== [],
            'test' => !empty($o['test']) || in_array('Probelauf', $tags, true),
            'admin_url' => Shopify::adminUrl('orders/' . $id),
        ];
    }

    /** Versanddienst an der Sendungsnummer erkennen (nur eindeutige Formate). */
    public static function guessCarrier(string $number): ?string
    {
        $n = strtoupper((string) preg_replace('/[\s-]/', '', $number));
        return match (true) {
            (bool) preg_match('/^1Z[0-9A-Z]{16}$/', $n) => 'UPS',
            (bool) preg_match('/^(JJD\d{10,}|JVGL\d+|00340\d{15}|\d{12}|\d{20})$/', $n) => 'DHL',
            (bool) preg_match('/^[A-Z]{2}\d{9}DE$/', $n) => 'Deutsche Post (DE)',
            (bool) preg_match('/^(H\d{10,19}|\d{16})$/', $n) => 'Hermes',
            (bool) preg_match('/^0\d{13}$/', $n) => 'DPD',
            (bool) preg_match('/^\d{11}$/', $n) => 'GLS',
            default => null,
        };
    }

    public static function trackingUrl(string $carrier, string $number): ?string
    {
        $tpl = self::CARRIERS[$carrier] ?? null;
        return $tpl ? str_replace('{n}', rawurlencode($number), $tpl) : null;
    }

    /**
     * Bestellung als versendet markieren. $in: carrier, number, url? (bei „Andere“), notify (bool), mode: test | send
     * test = nur prüfen (liest die Bestellung, ändert nichts in Shopify).
     */
    public static function ship(array $me, string $orderId, array $in): array
    {
        if (!preg_match('/^\d{1,20}$/', $orderId)) {
            throw new HttpError(422, 'Ungültige Bestellung.');
        }
        if (!Shopify::configured()) {
            throw new HttpError(409, 'Shopify ist noch nicht verbunden.');
        }
        $mode = ($in['mode'] ?? 'send') === 'test' ? 'test' : 'send';
        $number = strtoupper((string) preg_replace('/\s+/', '', (string) ($in['number'] ?? '')));
        if (!preg_match('/^[A-Z0-9-]{6,40}$/', $number)) {
            throw new HttpError(422, 'Bitte eine gültige Sendungsnummer eingeben (6–40 Buchstaben/Ziffern).');
        }
        $carrier = Util::str($in['carrier'] ?? '', 60, false);
        if ($carrier === '') {
            $carrier = self::guessCarrier($number) ?? self::settings()['default_carrier'];
        }
        $url = self::trackingUrl($carrier, $number);
        if ($url === null) {
            $custom = Util::str($in['url'] ?? '', 500);
            $url = $custom !== null && preg_match('#^https://#i', $custom) ? $custom : null;
        }
        $notify = (bool) ($in['notify'] ?? self::settings()['notify']);

        $missing = Shopify::missing(self::SCOPES);
        $d = Shopify::graphql(self::ORDER_FOS, ['id' => 'gid://shopify/Order/' . $orderId]);
        $order = $d['order'] ?? null;
        if (!$order) {
            throw new HttpError(404, 'Bestellung nicht gefunden.');
        }
        $fos = array_values(array_filter($order['fulfillmentOrders']['nodes'] ?? [], static fn ($fo) =>
            in_array($fo['status'], ['OPEN', 'IN_PROGRESS'], true)
            && in_array('CREATE_FULFILLMENT', array_column($fo['supportedActions'] ?? [], 'action'), true)));
        $items = [];
        foreach ($fos as $fo) {
            foreach ($fo['lineItems']['nodes'] ?? [] as $li) {
                if ((int) $li['remainingQuantity'] > 0) {
                    $items[] = $li['remainingQuantity'] . '× ' . $li['productTitle'] . ($li['variantTitle'] ? ' (' . $li['variantTitle'] . ')' : '');
                }
            }
        }
        $plan = [
            'order' => (string) $order['name'],
            'carrier' => $carrier,
            'number' => $number,
            'url' => $url,
            'notify' => $notify,
            'items' => $items,
            'missing' => $missing,
        ];
        if (!$fos || !$items) {
            throw new HttpError(409, 'Bestellung ' . $order['name'] . ' hat nichts mehr zu versenden (schon versendet oder storniert?).');
        }
        if ($mode === 'test') {
            $hint = $missing
                ? 'Testlauf: Bestellung gefunden, aber es fehlt noch die Shopify-Berechtigung ' . implode(', ', $missing) . ' – ohne sie klappt das echte Versenden nicht.'
                : 'Testlauf ok: ' . $order['name'] . ' würde mit ' . $carrier . ' ' . $number . ' als versendet markiert' . ($notify ? ', die Kundin bekäme die Versandbestätigung von Shopify.' : ' (ohne Mail an die Kundin).');
            return $plan + ['test' => true, 'message' => $hint];
        }
        if ($missing) {
            throw new HttpError(409, 'Für den Versand fehlt in Shopify die Berechtigung ' . implode(', ', $missing) . '. Anleitung: docs/ANLEITUNG.md → „Shopify-Rechte erweitern“.');
        }
        $tracking = ['company' => $carrier, 'number' => $number];
        if ($url !== null) {
            $tracking['url'] = $url;
        }
        $r = Shopify::graphql(self::CREATE, ['f' => [
            'lineItemsByFulfillmentOrder' => array_map(static fn ($fo) => ['fulfillmentOrderId' => $fo['id']], $fos),
            'trackingInfo' => $tracking,
            'notifyCustomer' => $notify,
        ]]);
        $errors = $r['fulfillmentCreate']['userErrors'] ?? [];
        if ($errors) {
            throw new HttpError(422, 'Shopify: ' . implode(' · ', array_map(static fn ($e) => (string) $e['message'], $errors)));
        }
        $now = Util::now();
        Db::insert('shipments', [
            'id' => Util::uuid(), 'order_id' => $orderId, 'order_name' => (string) $order['name'], 'carrier' => $carrier,
            'tracking' => $number, 'url' => $url, 'notified' => $notify ? 1 : 0, 'user_id' => $me['id'], 'created_at' => $now,
        ]);
        Db::exec("UPDATE orders SET fulfillment_status = 'FULFILLED', synced_at = ? WHERE id = ?", [$now, $orderId]);
        Activity::log($me['id'], 'order_shipped', 'order', $orderId, 'hat ' . $order['name'] . ' versendet (' . $carrier . ')');
        return $plan + ['sent' => true, 'message' => $order['name'] . ' ist als versendet markiert' . ($notify ? ' – die Kundin bekommt die Versandbestätigung.' : '.')];
    }

    /** Zuletzt in der App versendet (für die Liste). */
    public static function recent(): array
    {
        return array_map(static fn ($s) => [
            'order_id' => $s['order_id'],
            'name' => $s['order_name'],
            'carrier' => $s['carrier'],
            'tracking' => $s['tracking'],
            'url' => $s['url'],
            'user_id' => $s['user_id'],
            'created_at' => (int) $s['created_at'],
        ], Db::all('SELECT * FROM shipments ORDER BY created_at DESC LIMIT 10'));
    }

    /** I4: morgens Erinnerung, wenn Bestellungen länger als X Tage auf den Versand warten. */
    public static function remind(): string
    {
        $days = self::settings()['remind_days'];
        $today = date('Y-m-d');
        if ($days === 0 || (int) date('G') < 9 || Settings::get('ship_remind_date') === $today) {
            return '–';
        }
        Settings::set('ship_remind_date', $today);
        $limit = Util::now() - $days * 86400000;
        $late = array_values(array_filter(Stats::toShip(), static fn ($o) => (int) $o['created_at'] < $limit));
        if (!$late) {
            return '0 überfällig';
        }
        $oldest = (int) floor((Util::now() - (int) end($late)['created_at']) / 86400000);
        $title = count($late) === 1 ? '1 Bestellung wartet auf Versand' : count($late) . ' Bestellungen warten auf Versand';
        Notify::users(null, 'shipping', [
            'title' => $title,
            'body' => implode(', ', array_map(static fn ($o) => $o['name'], array_slice($late, 0, 4))) . " · älteste seit $oldest Tagen",
            'url' => '/versand',
            'tag' => 'ship-remind',
        ]);
        return count($late) . ' überfällig';
    }
}
