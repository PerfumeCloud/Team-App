<?php
declare(strict_types=1);

// Nur für lokale Vorschau/Screenshots: füllt eine leere Test-Datenbank mit Beispieldaten.
// Aufruf: PC_CONFIG=... PC_STORAGE=... php seed-demo.php
require dirname(__DIR__) . '/app/bootstrap.php';

use PC\{Config, Crypto, Db, Settings, Util, WebPush};

if (!Config::exists()) {
    Config::write(['db' => ['driver' => 'sqlite', 'path' => Config::storageDir() . '/app.sqlite'], 'app_key' => Crypto::randomKey(), 'cron_key' => Crypto::randomKey(24), 'base_url' => '']);
}
Db::migrate();
WebPush::keys();

$now = Util::now();
$h = 3600 * 1000;
$d = 24 * $h;
$day = static fn (int $offset) => date('Y-m-d', time() + $offset * 86400);

$users = [
    ['Marius', 'marius@perfumecloud.de', 'blue', 'admin'],
    ['Ben', 'ben@perfumecloud.de', 'rose', 'member'],
    ['Keanu', 'keanu@perfumecloud.de', 'sage', 'member'],
];
$ids = [];
foreach ($users as $i => [$name, $email, $color, $role]) {
    $id = Util::uuid();
    $ids[] = $id;
    Db::insert('users', ['id' => $id, 'name' => $name, 'email' => $email, 'password_hash' => password_hash('demo1234', PASSWORD_DEFAULT), 'color' => $color, 'role' => $role, 'prefs' => null, 'created_at' => $now - 30 * $d, 'updated_at' => $now - 30 * $d, 'deleted' => 0]);
}
[$marius, $ben, $keanu] = $ids;

$tasks = [
    ['Fotoshooting „Date Night“ vorbereiten', 'doing', 'high', 'Marketing', $marius, $day(1), "Flakon, Schachtel und Moodboard mitbringen. Location: Studio Carla.", [['Moodboard', true], ['Flakons polieren', false], ['Model bestätigen', false]]],
    ['Herbst-Newsletter schreiben', 'todo', 'normal', 'Marketing', $keanu, $day(0), null, []],
    ['Retoure #1038 prüfen', 'todo', 'high', 'Versand', $marius, $day(-1), 'Kundin meldet ausgelaufenen Flakon – Fotos liegen im Postfach.', []],
    ['Probenset nachbestellen (50 Stück)', 'todo', 'normal', 'Einkauf', $ben, $day(3), null, [['Angebot Lieferant A', true], ['Angebot Lieferant B', false]]],
    ['Instagram-Reel „Shining Pear“', 'todo', 'low', 'Social Media', $keanu, $day(6), null, []],
    ['Verpackungsdesign final abstimmen', 'doing', 'normal', 'Produkt', $ben, $day(2), 'Variante 02 (Creme & feine Linien) favorisiert.', []],
    ['Versandkartons bestellen', 'todo', 'normal', 'Einkauf', null, null, null, []],
    ['Weihnachts-Geschenkset planen', 'todo', 'normal', 'Produkt', $marius, $day(14), null, []],
    ['Impressum aktualisieren', 'done', 'normal', 'Shop', $marius, $day(-2), null, []],
    ['Preise für 30 ml festlegen', 'done', 'high', 'Shop', $keanu, $day(-3), null, []],
];
foreach ($tasks as $i => [$title, $status, $prio, $cat, $assignee, $due, $desc, $check]) {
    $id = Util::uuid();
    $created = $now - (10 - $i) * $d;
    Db::insert('tasks', [
        'id' => $id, 'title' => $title, 'description' => $desc, 'status' => $status, 'priority' => $prio, 'category' => $cat,
        'assignee_id' => $assignee, 'due_date' => $due, 'position' => $created,
        'checklist' => $check ? Util::json(array_map(static fn ($c) => ['id' => Util::uuid(), 'text' => $c[0], 'done' => $c[1]], $check)) : null,
        'source_email_id' => null, 'completed_at' => $status === 'done' ? $now - ($i - 6) * 5 * $h : null,
        'created_by' => $ids[$i % 3], 'updated_by' => $ids[$i % 3], 'created_at' => $created, 'updated_at' => $created, 'deleted' => 0,
    ]);
    if ($i === 0) {
        Db::insert('comments', ['id' => Util::uuid(), 'task_id' => $id, 'user_id' => $keanu, 'body' => 'Ich kann die Requisiten am Donnerstag abholen 👍', 'created_at' => $now - 3 * $h, 'updated_at' => $now - 3 * $h, 'deleted' => 0]);
    }
}

$notes = [
    ['Ideen Weihnachtskollektion', "- Geschenkset mit 3 Proben\n- Limitierte Edition „Dunkler Winterduft“\n- Gratis Gravur bis 15.12.\n- Adventskalender für Instagram", 1, 'cream', $keanu],
    ['Messe Beauty Düsseldorf', "Termin: März\nStandgröße klären, Budget max. 1.500 €\nWer fährt mit?", 1, 'blue', $marius],
    ['Lieferanten', "Flakons: Glaswerk Nord – 0,85 €/Stk ab 500\nKartons: Packwerk – Muster angefragt", 0, 'none', $ben],
    ['Feedback Testkunden', "Shining Pear: „frisch, aber hält lange“\nDate Night: „sehr intensiv, abends perfekt“", 0, 'sage', $keanu],
];
foreach ($notes as $i => [$title, $body, $pinned, $color, $by]) {
    $t = $now - ($i + 1) * 7 * $h;
    Db::insert('notes', ['id' => Util::uuid(), 'title' => $title, 'body' => $body, 'pinned' => $pinned, 'color' => $color, 'created_by' => $by, 'updated_by' => $by, 'created_at' => $t, 'updated_at' => $t, 'deleted' => 0]);
}

$mails = [
    ['support@perfumecloud.de', 'Julia Weber', 'julia.weber@example.de', 'Bestellung #1042 noch nicht angekommen', 'Hallo, ich habe vor einer Woche bestellt und noch keine Versandbestätigung bekommen. Könnt ihr bitte nachsehen?', 2 * $h, 0, 0, ['Kundenanliegen', 'Ungelesen'], 4],
    ['info@perfumecloud.de', 'Carla – Studio Licht', 'carla@studio-licht.de', 'Fotoshooting nächste Woche', 'Hi ihr Lieben, passt euch Dienstag um 10 Uhr? Ich bringe zwei Softboxen mit.', 5 * $h, 1, 1, ['Markiert'], 4],
    ['support@perfumecloud.de', 'Tobias K.', 'tobias.k@example.com', 'Flakon ausgelaufen – Rücksendung?', 'Leider ist der Flakon beim Versand ausgelaufen. Wie läuft die Rücksendung?', 28 * $h, 1, 0, ['Kundenanliegen', 'Über 24 Std. offen'], 5],
    ['info@perfumecloud.de', 'Beauty Messe GmbH', 'aussteller@beauty-messe.de', 'Ihre Standanfrage für März', 'Vielen Dank für Ihr Interesse. Anbei die Unterlagen zur Standbuchung.', 9 * $h, 0, 0, ['Ungelesen'], 1],
    ['info@perfumecloud.de', 'Glaswerk Nord', 'vertrieb@glaswerk-nord.de', 'Angebot Flakons 50 ml', 'Gerne bieten wir Ihnen folgende Konditionen an …', 50 * $h, 1, 0, ['Über 2 Tage offen'], 3],
];
foreach ($mails as $i => [$box, $name, $email, $subject, $snippet, $age, $seen, $flagged, $reasons, $score]) {
    Db::insert('emails', [
        'id' => substr(sha1("demo$i"), 0, 40), 'mailbox' => $box, 'message_id' => "<demo$i@example>", 'from_name' => $name, 'from_email' => $email,
        'subject' => $subject, 'snippet' => $snippet, 'received_at' => $now - $age, 'seen' => $seen, 'flagged' => $flagged, 'answered' => 0,
        'important' => 1, 'reasons' => implode('|', $reasons), 'score' => $score, 'status' => 'open', 'assignee_id' => $i === 2 ? $marius : null,
        'done_by' => null, 'done_at' => null, 'notified' => 2, 'created_at' => $now - $age, 'updated_at' => $now - $age, 'deleted' => 0,
    ]);
}
Db::insert('emails', [
    'id' => substr(sha1('demo-done'), 0, 40), 'mailbox' => 'support@perfumecloud.de', 'message_id' => '<done@example>', 'from_name' => 'Anna S.', 'from_email' => 'anna@example.de',
    'subject' => 'Frage zu Duftnoten', 'snippet' => 'Ist Date Night eher süß oder holzig?', 'received_at' => $now - 30 * $h, 'seen' => 1, 'flagged' => 0, 'answered' => 1,
    'important' => 0, 'reasons' => null, 'score' => 0, 'status' => 'open', 'assignee_id' => null, 'done_by' => null, 'done_at' => null, 'notified' => 2,
    'created_at' => $now - 30 * $h, 'updated_at' => $now - 30 * $h, 'deleted' => 0,
]);

// Bestellungen der letzten 100 Tage
$products = [['Date Night 50 ml', 6900], ['Dunkler Winterduft 50 ml', 7400], ['Shining Pear 30 ml', 4900], ['Dunkle Pflaume & Vanille 50 ml', 6900], ['Süße Kirsche 30 ml', 4900], ['Probenset 5 × 2 ml', 1900]];
mt_srand(42);
$n = 1100;
for ($dd = 100; $dd >= 0; $dd--) {
    $count = mt_rand(0, 3) + ($dd < 30 ? mt_rand(0, 2) : 0) + (in_array((int) date('N', time() - $dd * 86400), [6, 7], true) ? 1 : 0);
    for ($k = 0; $k < $count; $k++) {
        $ts = (time() - $dd * 86400 - mt_rand(0, 12) * 3600) * 1000;
        if ($ts > $now) {
            $ts = $now - mt_rand(1, 5) * $h;
        }
        $items = [];
        $total = 0;
        $qtyAll = 0;
        foreach ((array) array_rand($products, mt_rand(1, 2)) as $pi) {
            [$t, $price] = $products[$pi];
            $q = mt_rand(1, 2);
            $items[] = ['t' => $t, 'v' => null, 'q' => $q, 's' => $price * $q];
            $total += $price * $q;
            $qtyAll += $q;
        }
        $n++;
        Db::insert('orders', [
            'id' => (string) (900000 + $n), 'name' => '#' . $n, 'created_at' => $ts, 'shop_updated_at' => $ts, 'total_cents' => $total + 490, 'currency' => 'EUR',
            'financial_status' => 'PAID', 'fulfillment_status' => $dd <= 1 ? 'UNFULFILLED' : 'FULFILLED', 'cancelled' => mt_rand(0, 40) === 0 ? 1 : 0,
            'item_count' => $qtyAll, 'items' => Util::json($items), 'synced_at' => $now,
        ]);
    }
}

Settings::set('mailboxes', [
    ['id' => 'mb1', 'email' => 'info@perfumecloud.de', 'label' => 'info', 'host' => 'demo.invalid', 'port' => 993, 'security' => 'ssl', 'user' => 'info@perfumecloud.de'],
    ['id' => 'mb2', 'email' => 'support@perfumecloud.de', 'label' => 'support', 'host' => 'demo.invalid', 'port' => 993, 'security' => 'ssl', 'user' => 'support@perfumecloud.de'],
]);
Settings::set('shopify', ['shop' => 'ks8yin-mg.myshopify.com', 'client_id' => 'demo']);
Settings::setSecret('shopify_secret', 'demo');
Settings::set('orders_last_sync', $now - 2 * 60 * 1000);
Settings::set('mail_last_fetch', $now - 3 * 60 * 1000);
Settings::set('jobs_last_run', $now + 365 * $d); // Demo: keine echten Abrufe
Settings::set('low_stock', ['at' => $now, 'threshold' => 5, 'items' => [
    ['title' => 'Shining Pear 30 ml', 'variant' => 'Shining Pear 30 ml', 'sku' => 'SP-30', 'qty' => 0],
    ['title' => 'Probenset 5 × 2 ml', 'variant' => 'Probenset 5 × 2 ml', 'sku' => 'PS-5', 'qty' => 3],
]]);

$acts = [
    [$keanu, 'task_done', 'hat „Preise für 30 ml festlegen“ erledigt', 50],
    [$ben, 'note_created', 'hat „Lieferanten“ erstellt', 40],
    [$marius, 'mail_done', 'hat die Mail „Rechnung September“ erledigt', 26],
    [$keanu, 'comment', 'hat „Fotoshooting „Date Night“ vorbereiten“ kommentiert', 3],
    [$ben, 'task_created', 'hat „Probenset nachbestellen (50 Stück)“ angelegt', 1],
];
foreach ($acts as [$u, $type, $text, $ago]) {
    Db::insert('activity', ['id' => Util::uuid(), 'user_id' => $u, 'type' => $type, 'entity_type' => null, 'entity_id' => null, 'text' => $text, 'created_at' => $now - $ago * $h, 'updated_at' => $now - $ago * $h]);
}
echo "Demo-Daten angelegt. Login: marius@perfumecloud.de / demo1234\n";
