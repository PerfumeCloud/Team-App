<?php
declare(strict_types=1);

namespace PC;

/**
 * Testbestellung (nur Admins, früher „Probelauf“): einmal den ganzen Weg einer Bestellung durch den Club gehen –
 * als Schnelltest (simuliert) oder mit einer echten 0-€-Bestellung über Einmal-Codes.
 * Der Club führt die Schritte aus; die Team-App merkt sich die Testbestellung (zählt nirgends mit)
 * und storniert sie beim Aufräumen in Shopify.
 */
final class ClubTrial
{
    public static function view(): array
    {
        return self::wrap(Club::request('GET', '/internal/trial'));
    }

    public static function start(array $me, array $in): array
    {
        $mode = ($in['mode'] ?? 'sim') === 'real' ? 'real' : 'sim';
        $amount = (int) ($in['amount_cents'] ?? 5900);
        if ($amount < 100 || $amount > 100000) {
            throw new HttpError(422, 'Bitte einen Bestellwert zwischen 1 € und 1.000 € angeben.');
        }
        $r = Club::request('POST', '/internal/trial/start', ['user' => Club::user($me), 'mode' => $mode, 'amount_cents' => $amount]);
        // Hinweise aus der Testbestellung (z. B. 2 Sterne) gehen nur an die Person, die ihn gestartet hat
        Settings::set('club_trial', ['user_id' => $me['id'], 'started_at' => Util::now()]);
        return self::wrap($r);
    }

    public static function step(array $in): array
    {
        $step = is_string($in['step'] ?? null) ? $in['step'] : '';
        return self::wrap(Club::request('POST', '/internal/trial/step', ['step' => $step]));
    }

    /** Club gleicht Bestellungen sofort ab (statt auf den Cronjob zu warten) – auch Hinweise holen. */
    public static function sync(): array
    {
        $r = Club::request('POST', '/internal/trial/sync', []);
        try {
            Club::pullAlerts();
        } catch (\Throwable $e) {
            Util::log('Testbestellung: Hinweise nicht abgeholt – ' . $e->getMessage());
        }
        return self::wrap($r);
    }

    /** Testdaten im Club löschen; die echte Testbestellung in Shopify stornieren (falls erlaubt). */
    public static function cleanup(): array
    {
        $r = Club::request('POST', '/internal/trial/cleanup', []);
        Settings::delete('club_trial');
        $order = is_array($r['order'] ?? null) ? $r['order'] : null;
        $out = ['ok' => true, 'message' => is_string($r['message'] ?? null) ? $r['message'] : 'Aufgeräumt.', 'order' => null];
        if ($order && is_string($order['id'] ?? null)) {
            self::remember($order['id']);
            $out['order'] = ['name' => (string) ($order['name'] ?? ''), 'admin_url' => Shopify::configured() ? Shopify::adminUrl('orders/' . Shopify::numericId($order['id'])) : null] + self::cancel($order['id']);
        }
        return $out + self::view();
    }

    /** @return array{cancelled:bool, note:string} */
    private static function cancel(string $gid): array
    {
        if (!Shopify::configured()) {
            return ['cancelled' => false, 'note' => 'Shopify ist in der Team-App nicht verbunden – bitte die Bestellung im Shopify-Admin stornieren.'];
        }
        if (Shopify::missing(['write_orders'])) {
            return ['cancelled' => false, 'note' => 'Zum automatischen Stornieren fehlt der Team-App die Shopify-Berechtigung write_orders – bitte die Bestellung im Shopify-Admin stornieren (Artikel zurück ins Lager).'];
        }
        try {
            $d = Shopify::graphql(
                'mutation TeamTrialCancel($id: ID!) { orderCancel(orderId: $id, reason: OTHER, restock: true, notifyCustomer: false, refundMethod: { originalPaymentMethodsRefund: true }, staffNote: "Testbestellung der Team-App") { job { id } orderCancelUserErrors { message } } }',
                ['id' => $gid]
            );
            $errors = $d['orderCancel']['orderCancelUserErrors'] ?? [];
            if ($errors) {
                return ['cancelled' => false, 'note' => 'Shopify konnte die Bestellung nicht stornieren: ' . implode(' ', array_column($errors, 'message')) . ' Ist sie schon versendet, bitte im Shopify-Admin erst den Versand und dann die Bestellung stornieren.'];
            }
            return ['cancelled' => true, 'note' => 'In Shopify storniert, Artikel zurück ins Lager, keine Mail an die Kundin.'];
        } catch (\Throwable $e) {
            Util::log('Testbestellung: Storno fehlgeschlagen – ' . $e->getMessage());
            return ['cancelled' => false, 'note' => 'Storno fehlgeschlagen (' . $e->getMessage() . ') – bitte im Shopify-Admin stornieren.'];
        }
    }

    /** Echte Testbestellung merken: Versand zeigt „Testbestellung“, der Wochenrückblick lässt sie weg. */
    private static function remember(string $gid): void
    {
        $id = Shopify::numericId($gid);
        if ($id === '') {
            return;
        }
        $ids = Reports::testOrderIds();
        if (!in_array($id, $ids, true)) {
            $ids[] = $id;
            Settings::set('test_orders', array_slice($ids, -50));
        }
    }

    private static function wrap(array $r): array
    {
        $order = $r['order'] ?? null;
        if (is_array($order) && !empty($order['real']) && is_string($order['id'] ?? null)) {
            self::remember($order['id']);
        }
        $r['cancel'] = [
            'shopify' => Shopify::configured(),
            'allowed' => Shopify::configured() && !Shopify::missing(['write_orders']),
        ];
        return $r;
    }
}
