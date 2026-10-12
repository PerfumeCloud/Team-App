<?php
declare(strict_types=1);

// Testhelfer: wird von backend.test.mjs mit PC_CONFIG/PC_STORAGE aufgerufen.
require dirname(__DIR__) . '/app/bootstrap.php';

use PC\{Db, Settings, MailJob, WebPush, Util, Stats, Sync};

$cmd = $argv[1] ?? '';
$arg = $argv[2] ?? '';

switch ($cmd) {
    case 'mail':
        // Postfach auf den Test-IMAP-Server zeigen lassen
        Settings::set('mailboxes', [[
            'id' => 'mb1', 'email' => 'support@perfumecloud.de', 'label' => 'support',
            'host' => '127.0.0.1', 'port' => (int) $arg, 'security' => 'none', 'user' => 'support@perfumecloud.de',
        ]]);
        Settings::setSecret('mailbox_pw_mb1', $argv[3] ?? 'secret');
        $summary = MailJob::run();
        $rows = array_map([Sync::class, 'email'], Db::all('SELECT * FROM emails WHERE deleted = 0 ORDER BY received_at DESC'));
        echo Util::json(['summary' => $summary, 'emails' => $rows, 'status' => Settings::get('mail_status_mb1')]);
        break;

    case 'personal-run':
        // Alle Postfächer auf den Test-IMAP-Server (unverschlüsselt) umbiegen und abrufen
        $list = Settings::get('mailboxes', []);
        foreach ($list as &$mb) {
            $mb = ['host' => '127.0.0.1', 'port' => (int) $arg, 'security' => 'none'] + $mb;
        }
        unset($mb);
        Settings::set('mailboxes', $list);
        $summary = MailJob::run();
        $rows = Db::all('SELECT * FROM emails WHERE deleted = 0');
        $users = Db::all('SELECT * FROM users WHERE deleted = 0');
        // Push-Plan so berechnen, als wären alle Mails gerade neu angekommen
        $plan = array_map(static fn ($list) => array_map(static fn ($m) => ['id' => $m['id'], 'mailbox' => $m['mailbox'], 'auto' => (int) $m['auto'], 'seen' => (int) $m['seen']], $list), MailJob::pushPlan($rows, $users, Util::now()));
        echo Util::json(['summary' => $summary, 'emails' => array_map([Sync::class, 'email'], $rows), 'plan' => (object) $plan]);
        break;

    case 'event-remind':
        // argv: Event-ID, Minuten relativ zum Start
        $e = Db::one('SELECT * FROM events WHERE id = ?', [$arg]);
        $start = \PC\Calendar::ts($e['start_date'], $e['start_time']);
        $out = \PC\Calendar::remind($start + (int) $argv[3] * 60000);
        echo Util::json(['out' => $out, 'reminded' => Db::value('SELECT reminded_at FROM events WHERE id = ?', [$arg]) !== null]);
        break;

    case 'push-encrypt':
        // argv: p256dh auth payload
        $body = WebPush::encrypt($argv[4], $argv[2], $argv[3]);
        [$pem, $pub] = WebPush::generateKeyPair();
        $jwt = WebPush::vapidJwt('https://push.example.com', 'mailto:test@example.com', $pem);
        echo Util::json(['body' => base64_encode($body), 'jwt' => $jwt, 'pub' => Util::b64url($pub)]);
        break;

    case 'seed-orders':
        $now = time();
        $titles = ['Noire Eclat 50 ml', 'Cloud Musk 30 ml', 'Ambre Soir 50 ml'];
        for ($i = 0; $i < 40; $i++) {
            $created = ($now - $i * 86400 * 1.5) * 1000;
            Db::upsert('orders', [
                'id' => (string) (5000 + $i), 'name' => '#' . (1100 - $i), 'created_at' => (int) $created,
                'shop_updated_at' => (int) $created, 'total_cents' => 4990 + ($i % 3) * 1000, 'currency' => 'EUR',
                'financial_status' => 'PAID', 'fulfillment_status' => $i < 3 ? 'UNFULFILLED' : 'FULFILLED',
                'cancelled' => $i === 5 ? 1 : 0, 'item_count' => 1 + ($i % 2),
                'items' => Util::json([['t' => $titles[$i % 3], 'v' => null, 'q' => 1 + ($i % 2), 's' => 4990 + ($i % 3) * 1000]]),
                'synced_at' => Util::now(),
            ]);
        }
        echo Util::json(Stats::compute((int) ($arg ?: 30)));
        break;

    default:
        fwrite(STDERR, "unknown\n");
        exit(1);
}
