<?php
declare(strict_types=1);

namespace PC;

/**
 * Kundeninfos neben der Mail: Shopify-Kunde, letzte Bestellungen mit Sendungsverfolgung,
 * Club-Stand (Stufe, Punkte, Codes, Bewertungen) und Notizen des Teams.
 *
 * Braucht in Shopify read_orders (Bestellungen nach E-Mail) und für Kundendaten read_customers.
 * Fehlt eine Berechtigung, zeigt das Panel, was es trotzdem weiß, und sagt, was fehlt.
 */
final class Customers
{
    private const ORDER_FULL = <<<'GQL'
fragment O on Order {
  id name createdAt cancelledAt test
  displayFinancialStatus displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 10) { nodes { title variantTitle quantity } }
  fulfillments(first: 5) { createdAt deliveredAt inTransitAt estimatedDeliveryAt displayStatus trackingInfo { company number url } }
  discountCodes
  shippingAddress { firstName city zip countryCodeV2 }
}
GQL;

    // Ohne Zugriff auf geschützte Kundendaten (Adresse) – dann eben ohne Ort
    private const ORDER_BASIC = <<<'GQL'
fragment O on Order {
  id name createdAt cancelledAt test
  displayFinancialStatus displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 10) { nodes { title variantTitle quantity } }
  fulfillments(first: 5) { createdAt deliveredAt inTransitAt estimatedDeliveryAt displayStatus trackingInfo { company number url } }
  discountCodes
}
GQL;

    private const CUSTOMER = <<<'GQL'
query C($q: String!) {
  customers(first: 1, query: $q) {
    nodes {
      id displayName firstName lastName numberOfOrders createdAt tags note
      amountSpent { amount currencyCode }
      defaultEmailAddress { emailAddress marketingState }
      defaultAddress { city countryCodeV2 }
    }
  }
}
GQL;

    public const FULFILLMENT = [
        'UNFULFILLED' => 'Noch nicht versendet',
        'PARTIALLY_FULFILLED' => 'Teilweise versendet',
        'FULFILLED' => 'Versendet',
        'IN_PROGRESS' => 'In Bearbeitung',
        'ON_HOLD' => 'Zurückgehalten',
        'SCHEDULED' => 'Geplant',
        'OPEN' => 'Offen',
        'PENDING_FULFILLMENT' => 'Wird vorbereitet',
        'RESTOCKED' => 'Zurück im Lager',
        'REQUEST_DECLINED' => 'Abgelehnt',
    ];

    public const DELIVERY = [
        'DELIVERED' => 'Zugestellt',
        'IN_TRANSIT' => 'Unterwegs',
        'OUT_FOR_DELIVERY' => 'In Zustellung',
        'ATTEMPTED_DELIVERY' => 'Zustellversuch',
        'READY_FOR_PICKUP' => 'Abholbereit',
        'PICKED_UP' => 'Abgeholt',
        'CARRIER_PICKED_UP' => 'Beim Versanddienst',
        'FAILURE' => 'Problem bei der Zustellung',
        'NOT_DELIVERED' => 'Nicht zugestellt',
        'CANCELED' => 'Storniert',
    ];

    public const FINANCIAL = [
        'PAID' => 'Bezahlt',
        'PENDING' => 'Zahlung offen',
        'AUTHORIZED' => 'Autorisiert',
        'PARTIALLY_PAID' => 'Teilweise bezahlt',
        'PARTIALLY_REFUNDED' => 'Teilweise erstattet',
        'REFUNDED' => 'Erstattet',
        'VOIDED' => 'Storniert',
        'EXPIRED' => 'Abgelaufen',
    ];

    /**
     * Alles zu einer Kundin auf einen Blick. $order = Bestellnummer aus der Mail (ohne #), falls erkannt.
     * $email darf fehlen, wenn nur die Bestellnummer bekannt ist.
     */
    public static function lookup(string $email, ?string $order = null): array
    {
        $email = mb_strtolower(trim($email));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Bitte eine gültige E-Mail-Adresse angeben.');
        }
        $order = $order !== null && preg_match('/^\d{3,8}$/', $order) ? $order : null;
        $out = [
            'email' => $email,
            'order' => $order,
            'shopify' => ['configured' => Shopify::configured(), 'missing' => [], 'error' => null],
            'customer' => null,
            'orders' => [],
            'mentioned' => null,
            'club' => null,
            'notes' => $email !== '' ? self::notes($email) : [],
        ];
        if (Shopify::configured()) {
            try {
                $out['shopify']['missing'] = Shopify::missing(['read_orders', 'read_customers']);
                if ($email !== '' && !in_array('read_customers', $out['shopify']['missing'], true)) {
                    $out['customer'] = self::customer($email);
                }
                if ($email !== '') {
                    $out['orders'] = self::orders('email:"' . addcslashes($email, '"\\') . '"', 8);
                }
                if ($order !== null) {
                    $known = array_values(array_filter($out['orders'], static fn ($o) => ltrim($o['name'], '#') === $order || preg_replace('/\D/', '', $o['name']) === $order));
                    $found = $known[0] ?? (self::orders('name:' . $order, 1)[0] ?? null);
                    if ($found) {
                        $found['other'] = !$known; // von einer anderen E-Mail-Adresse bestellt
                        $out['mentioned'] = $found;
                    }
                }
            } catch (\Throwable $e) {
                $out['shopify']['error'] = self::friendly($e->getMessage());
            }
        }
        if ($email !== '' && Club::configured()) {
            try {
                $out['club'] = Club::request('GET', '/internal/customer?email=' . rawurlencode($email));
            } catch (HttpError $e) {
                $out['club'] = $e->status === 404 && $e->getMessage() === 'Nicht gefunden.'
                    ? ['error' => 'Der Club ist noch auf einer älteren Version – nach dem Update erscheinen hier Stufe und Punkte.']
                    : ['error' => $e->getMessage()];
            }
        }
        return $out;
    }

    private static function customer(string $email): ?array
    {
        $d = Shopify::graphql(self::CUSTOMER, ['q' => 'email:"' . addcslashes($email, '"\\') . '"']);
        $c = $d['customers']['nodes'][0] ?? null;
        if (!$c) {
            return null;
        }
        $id = Shopify::numericId((string) $c['id']);
        return [
            'id' => $id,
            'name' => trim((string) ($c['displayName'] ?? '')),
            'first_name' => trim((string) ($c['firstName'] ?? '')),
            'since' => (int) (strtotime((string) $c['createdAt']) * 1000),
            'orders' => (int) ($c['numberOfOrders'] ?? 0),
            'spent_cents' => (int) round(((float) ($c['amountSpent']['amount'] ?? 0)) * 100),
            'tags' => array_values(array_filter((array) ($c['tags'] ?? []), 'is_string')),
            'note' => $c['note'] ?? null,
            'newsletter' => ($c['defaultEmailAddress']['marketingState'] ?? '') === 'SUBSCRIBED',
            'city' => $c['defaultAddress']['city'] ?? null,
            'country' => $c['defaultAddress']['countryCodeV2'] ?? null,
            'admin_url' => Shopify::adminUrl('customers/' . $id),
        ];
    }

    /** Bestellungen zu einer Shopify-Suche, neueste zuerst. */
    public static function orders(string $query, int $limit): array
    {
        $q = 'query Q($q: String!, $n: Int!) { orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ...O } } }';
        try {
            $d = Shopify::graphql($q . "\n" . self::ORDER_FULL, ['q' => $query, 'n' => $limit]);
        } catch (\RuntimeException $e) {
            if (!preg_match('/access|denied|protected/i', $e->getMessage())) {
                throw $e;
            }
            $d = Shopify::graphql($q . "\n" . self::ORDER_BASIC, ['q' => $query, 'n' => $limit]);
        }
        return array_map([self::class, 'order'], $d['orders']['nodes'] ?? []);
    }

    public static function order(array $o): array
    {
        $id = Shopify::numericId((string) $o['id']);
        $tracking = [];
        $delivered = null;
        $shipped = null;
        $delivery = null;
        foreach ($o['fulfillments'] ?? [] as $f) {
            $shipped = $shipped ?? (int) (strtotime((string) $f['createdAt']) * 1000);
            if (!empty($f['deliveredAt'])) {
                $delivered = (int) (strtotime((string) $f['deliveredAt']) * 1000);
            }
            $delivery = $f['displayStatus'] ?? $delivery;
            foreach ($f['trackingInfo'] ?? [] as $t) {
                if (!empty($t['number']) || !empty($t['url'])) {
                    $tracking[] = ['company' => $t['company'] ?? null, 'number' => $t['number'] ?? null, 'url' => $t['url'] ?? null];
                }
            }
        }
        $fulfillment = (string) ($o['displayFulfillmentStatus'] ?? '');
        $financial = (string) ($o['displayFinancialStatus'] ?? '');
        return [
            'id' => $id,
            'name' => (string) $o['name'],
            'created_at' => (int) (strtotime((string) $o['createdAt']) * 1000),
            'total_cents' => (int) round(((float) ($o['currentTotalPriceSet']['shopMoney']['amount'] ?? 0)) * 100),
            'cancelled' => !empty($o['cancelledAt']),
            'test' => !empty($o['test']),
            'financial' => $financial,
            'financial_label' => self::FINANCIAL[$financial] ?? ucfirst(strtolower($financial)),
            'fulfillment' => $fulfillment,
            'status_label' => self::statusLabel($fulfillment, $delivery, !empty($o['cancelledAt'])),
            'delivery' => $delivery,
            'shipped_at' => $shipped,
            'delivered_at' => $delivered,
            'items' => array_map(static fn ($li) => [
                'title' => (string) $li['title'],
                'variant' => $li['variantTitle'] ?? null,
                'qty' => (int) $li['quantity'],
            ], $o['lineItems']['nodes'] ?? []),
            'tracking' => $tracking,
            'codes' => array_values(array_filter((array) ($o['discountCodes'] ?? []), 'is_string')),
            'city' => $o['shippingAddress']['city'] ?? null,
            'first_name' => $o['shippingAddress']['firstName'] ?? null,
            'admin_url' => Shopify::adminUrl('orders/' . $id),
        ];
    }

    /** „Unterwegs“, „Zugestellt“, „Noch nicht versendet“ … */
    public static function statusLabel(string $fulfillment, ?string $delivery, bool $cancelled): string
    {
        if ($cancelled) {
            return 'Storniert';
        }
        if ($delivery !== null && isset(self::DELIVERY[$delivery])) {
            return self::DELIVERY[$delivery];
        }
        return self::FULFILLMENT[$fulfillment] ?? 'Unbekannt';
    }

    /** Bestellnummer in Betreff oder Text finden, z. B. „#1042“, „Bestellung 1042“, „Bestellnr. 1042“. */
    public static function findOrderNumber(string $text): ?string
    {
        if (preg_match('/(?:#|\b(?:bestell(?:ung|nummer|nr)?|auftrag(?:snummer)?|order(?:\s*(?:no|number|nr))?)\.?\s*(?:nr\.?|nummer)?\s*:?\s*#?)\s?(\d{4,6})\b/iu', $text, $m)) {
            return $m[1];
        }
        return null;
    }

    // ---------- Notizen (I3) ----------

    public static function notes(string $email): array
    {
        return array_map(static fn ($n) => [
            'id' => $n['id'],
            'body' => $n['body'],
            'created_by' => $n['created_by'],
            'created_at' => (int) $n['created_at'],
        ], Db::all('SELECT * FROM customer_notes WHERE email = ? AND deleted = 0 ORDER BY created_at DESC', [mb_strtolower(trim($email))]));
    }

    public static function addNote(array $me, array $in): array
    {
        $email = mb_strtolower(trim((string) ($in['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Ungültige E-Mail-Adresse.');
        }
        $body = Util::str($in['body'] ?? '', 2000, false);
        if ($body === '') {
            throw new HttpError(422, 'Die Notiz ist leer.');
        }
        $now = Util::now();
        Db::insert('customer_notes', ['id' => Util::uuid(), 'email' => $email, 'body' => $body, 'created_by' => $me['id'], 'created_at' => $now, 'updated_at' => $now, 'deleted' => 0]);
        return ['notes' => self::notes($email)];
    }

    public static function deleteNote(array $me, string $id): array
    {
        $n = Db::one('SELECT * FROM customer_notes WHERE id = ?', [$id]);
        if (!$n) {
            throw new HttpError(404, 'Notiz nicht gefunden.');
        }
        if ($n['created_by'] !== $me['id'] && $me['role'] !== 'admin') {
            throw new HttpError(403, 'Nur eigene Notizen können gelöscht werden.');
        }
        Db::update('customer_notes', ['deleted' => 1, 'updated_at' => Util::now()], ['id' => $id]);
        return ['notes' => self::notes((string) $n['email'])];
    }

    /** Verständliche Meldung für fehlende Shopify-Rechte. */
    public static function friendly(string $msg): string
    {
        if (preg_match('/access denied|ACCESS_DENIED|not approved to access/i', $msg)) {
            return 'Shopify verweigert den Zugriff auf Kundendaten. In der Shopify-App unter „Zugriff auf geschützte Kundendaten“ Name, E-Mail und Adresse freigeben (Anleitung in docs/ANLEITUNG.md).';
        }
        return $msg;
    }
}
