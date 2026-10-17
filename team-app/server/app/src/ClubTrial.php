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
        $device = is_string($in['device_member_id'] ?? null) && $in['device_member_id'] !== '' ? $in['device_member_id'] : null;
        $r = Club::request('POST', '/internal/trial/start', ['user' => Club::user($me), 'mode' => $mode, 'amount_cents' => $amount, 'device_member_id' => $device]);
        // Hinweise aus der Testbestellung (z. B. 2 Sterne) gehen nur an die Person, die ihn gestartet hat
        Settings::set('club_trial', ['user_id' => $me['id'], 'started_at' => Util::now()]);
        return self::wrap($r);
    }

    public static function step(array $in): array
    {
        $step = is_string($in['step'] ?? null) ? $in['step'] : '';
        return self::wrap(Club::request('POST', '/internal/trial/step', ['step' => $step]));
    }

    /** Club gleicht Bestellungen sofort ab (statt auf den Cronjob zu warten) – auch Hinweise holen und „Neue Bestellung“ der Team-App. */
    public static function sync(): array
    {
        if (Shopify::configured() && !Shopify::missing(['read_orders'])) {
            Jobs::run('testbestellung', ['orders' => true]);
        }
        $r = Club::request('POST', '/internal/trial/sync', []);
        try {
            Club::pullAlerts();
        } catch (\Throwable $e) {
            Util::log('Testbestellung: Hinweise nicht abgeholt – ' . $e->getMessage());
        }
        return self::wrap($r);
    }

    // ---------- Push-Check ----------

    /**
     * Kommen die Pushs der Testbestellung an? Team-App („Neue Bestellung“): Gerät, Einstellung, Shopify-Recht,
     * Abgleich, Ruhezeit. Club („Punkte gutgeschrieben“ usw.): an welches Club-Konto der Person sie gehen.
     */
    public static function check(array $me): array
    {
        $q = Settings::get('quiet_hours');
        $trial = Settings::get('club_trial');
        $team = [
            'devices' => count(Notify::devices($me['id'])),
            'orders_push' => !empty(Auth::prefs($me)['push']['orders']),
            'shopify' => Shopify::configured(),
            'read_orders' => Shopify::configured() && !Shopify::missing(['read_orders']),
            'last_sync' => (int) Settings::get('orders_last_sync', 0) ?: null,
            'cron_last_run' => (int) Settings::get('cron_last_run', 0) ?: null,
            'quiet_now' => Notify::quietHours(),
            'quiet' => ['start' => is_array($q) && isset($q['start']) ? (int) $q['start'] : 22, 'end' => is_array($q) && isset($q['end']) ? (int) $q['end'] : 7],
            'order_push' => is_array($trial) && is_array($trial['order_push'] ?? null) ? $trial['order_push'] : null,
        ];
        try {
            $club = Club::request('POST', '/internal/access', ['user' => Club::user($me)]);
        } catch (HttpError $e) {
            $club = ['error' => $e->getMessage()];
        }
        return ['team' => $team, 'club' => $club];
    }

    /** Testpush: channel team = Geräte in der Team-App, club = ein eigenes Club-Konto. */
    public static function testPush(array $me, array $in): array
    {
        if (($in['channel'] ?? '') === 'club') {
            return Club::request('POST', '/internal/push/test', ['user' => Club::user($me), 'member_id' => (string) ($in['member_id'] ?? '')]);
        }
        return Notify::test($me);
    }

    /** Anderes eigenes Club-Konto für die Pushs der laufenden Testbestellung. */
    public static function device(array $me, array $in): array
    {
        return self::wrap(Club::request('POST', '/internal/trial/device', ['user' => Club::user($me), 'member_id' => (string) ($in['member_id'] ?? '')]));
    }

    /** Weitere eigene Adresse als Admin-E-Mail im Club eintragen (oder entfernen). */
    public static function email(array $me, array $in, bool $remove = false): array
    {
        Club::request('POST', $remove ? '/internal/access/emails/remove' : '/internal/access/emails', ['user' => Club::user($me), 'email' => (string) ($in['email'] ?? '')]);
        return self::check($me);
    }

    /** Die Team-App hat „Neue Bestellung“ für die Testbestellung verschickt (OrdersJob). */
    public static function orderPushed(string $name, int $sent): void
    {
        $t = Settings::get('club_trial');
        if (is_array($t)) {
            $t['order_push'] = ['name' => $name, 'sent' => $sent, 'at' => Util::now()];
            Settings::set('club_trial', $t);
        }
    }

    /** Läuft eine Testbestellung (in den letzten 3 Tagen gestartet)? */
    public static function running(): bool
    {
        $t = Settings::get('club_trial');
        return is_array($t) && (int) ($t['started_at'] ?? 0) > Util::now() - 3 * 86400 * 1000;
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
