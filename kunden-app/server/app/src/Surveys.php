<?php
declare(strict_types=1);

namespace Club;

/**
 * Befragung nach der Zustellung: ein Tipp auf die Sterne je Duft, danach höchstens drei kurze Fragen.
 *
 * Ablauf: Der Bestellabgleich legt je Bestellung eine Zeile an (auch für Nicht-Mitglieder). Sobald die
 * Bestellung zugestellt ist, wird die Anfrage nach delay_days verschickt (ohne Zustellmeldung fallback_days
 * nach dem Versand). Wege:
 *   - Push an Mitglieder, die Mitteilungen zu „Bestellungen & Versand“ erlauben,
 *   - E-Mail nur mit Einwilligung: Mitglieder mit dem Schalter „Bewertungsanfragen per E-Mail“ oder –
 *     wenn eingeschaltet – Newsletter-Abonnenten (Einwilligungstext im Shop muss das abdecken),
 *   - Mitglieder ohne beides sehen die Frage in der App.
 * Jede Mail enthält einen Abmeldelink (auch als List-Unsubscribe); ein Widerspruch gilt für alle Wege.
 *
 * Danke-Punkte gibt es für die Teilnahme, unabhängig von der Bewertung. Der Link zur Bewertung im Shop
 * erscheint bei allen Antworten (keine Vorauswahl nur zufriedener Kunden).
 * Schlechte Bewertungen (≤ low_threshold) gehen als Hinweis an das Team (Mail + Aufgabe in der Team-App).
 * Nachkauf-Erinnerung: reorder_days nach der Zustellung, nicht bei schlechter Bewertung oder wenn schon nachbestellt.
 */
final class Surveys
{
    public const DEFAULTS = [
        'enabled' => false,
        'since' => 0,               // Bestellungen ab diesem Zeitpunkt (Einschalten), ältere werden nicht befragt
        'delay_days' => 3,          // nach der Zustellung
        'fallback_days' => 8,       // ohne Zustellmeldung: nach dem Versand
        'min_gap_days' => 30,       // höchstens eine Anfrage je Person in diesem Zeitraum
        'expire_days' => 30,        // so lange kann man antworten
        'push' => true,
        'mail_members' => true,     // Mail an Mitglieder mit eigenem Schalter „Bewertungsanfragen per E-Mail“
        'mail_newsletter' => false, // Mail an Newsletter-Abonnenten (erst einschalten, wenn der Einwilligungstext das nennt)
        'points' => 10,
        'questions' => [
            ['id' => 'versand', 'text' => 'Wie zufrieden bist du mit Versand und Verpackung?', 'type' => 'stars', 'options' => []],
            ['id' => 'wieder', 'text' => 'Würdest du diesen Duft wieder kaufen?', 'type' => 'choice', 'options' => ['Ja', 'Vielleicht', 'Nein']],
        ],
        'comment' => true,
        'review_url' => '',
        'review_label' => 'Bewertung im Shop schreiben',
        'low_threshold' => 2,
        'alert_team' => true,
        'reorder' => false,
        'reorder_days' => 75,
        'retention_months' => 24,
        'subject' => '{vorname}, wie gefällt dir dein Duft?',
        'intro' => 'Dein Paket ist angekommen – wir hoffen, du hast Freude daran. Wie gefällt dir dein Duft? Ein Tipp auf die Sterne genügt.',
        'privacy_url' => '',
        'imprint_url' => '',
        'sender' => 'Perfume Cloud',
    ];

    public const TYPES = ['stars', 'choice', 'text'];
    private const DAY = Points::DAY_MS;

    private static ?array $config = null;

    // ---------- Einstellungen ----------

    public static function config(): array
    {
        if (self::$config === null) {
            $c = Settings::get('survey', []);
            $c = array_merge(self::DEFAULTS, is_array($c) ? $c : []);
            $c['questions'] = self::cleanQuestions(is_array($c['questions']) ? $c['questions'] : [], false);
            self::$config = $c;
        }
        return self::$config;
    }

    public static function resetCache(): void
    {
        self::$config = null;
    }

    public static function privacyUrl(): string
    {
        $u = (string) self::config()['privacy_url'];
        return $u !== '' ? $u : Shopify::shopUrl() . '/policies/privacy-policy';
    }

    public static function imprintUrl(): string
    {
        $u = (string) self::config()['imprint_url'];
        return $u !== '' ? $u : Shopify::shopUrl() . '/policies/legal-notice';
    }

    public static function save(array $in): array
    {
        $c = self::config();
        $int = static function (string $k, int $min, int $max) use ($in, &$c): void {
            if (array_key_exists($k, $in)) {
                if (!is_numeric($in[$k]) || (int) $in[$k] < $min || (int) $in[$k] > $max) {
                    throw new HttpError(422, "Ungültiger Wert für $k (erlaubt: $min bis $max).");
                }
                $c[$k] = (int) $in[$k];
            }
        };
        $int('delay_days', 0, 30);
        $int('fallback_days', 1, 60);
        $int('min_gap_days', 0, 365);
        $int('expire_days', 3, 120);
        $int('points', 0, 10000);
        $int('low_threshold', 1, 4);
        $int('reorder_days', 14, 730);
        $int('retention_months', 1, 120);
        foreach (['push', 'mail_members', 'mail_newsletter', 'comment', 'alert_team', 'reorder'] as $k) {
            if (array_key_exists($k, $in)) {
                $c[$k] = (bool) $in[$k];
            }
        }
        if (array_key_exists('enabled', $in)) {
            $on = (bool) $in['enabled'];
            if ($on && !$c['enabled']) {
                $c['since'] = Util::now(); // nur Bestellungen ab jetzt
            }
            $c['enabled'] = $on;
        }
        foreach (['review_url', 'privacy_url', 'imprint_url'] as $k) {
            if (array_key_exists($k, $in)) {
                $u = Util::str($in[$k], 300, false);
                if ($u !== '' && !preg_match('#^https://#', $u)) {
                    throw new HttpError(422, 'Bitte vollständige Adressen mit https:// angeben.');
                }
                $c[$k] = $u;
            }
        }
        foreach (['review_label' => 60, 'subject' => 120, 'intro' => 400, 'sender' => 200] as $k => $max) {
            if (array_key_exists($k, $in)) {
                $v = Util::str($in[$k], $max, false);
                $c[$k] = $v !== '' ? $v : self::DEFAULTS[$k];
            }
        }
        if (array_key_exists('questions', $in)) {
            if (!is_array($in['questions'])) {
                throw new HttpError(422, 'Ungültige Fragen.');
            }
            $c['questions'] = self::cleanQuestions($in['questions'], true);
        }
        Settings::set('survey', $c);
        self::$config = null;
        return self::config();
    }

    /** Höchstens drei Fragen: Sterne, Auswahl (2–5 Antworten) oder Freitext. */
    private static function cleanQuestions(array $in, bool $strict): array
    {
        $out = [];
        $ids = [];
        foreach ($in as $q) {
            if (!is_array($q)) {
                continue;
            }
            $text = trim((string) ($q['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $type = in_array($q['type'] ?? '', self::TYPES, true) ? $q['type'] : 'stars';
            $options = [];
            if ($type === 'choice') {
                foreach (is_array($q['options'] ?? null) ? $q['options'] : [] as $o) {
                    $o = trim(mb_substr((string) $o, 0, 40));
                    if ($o !== '' && !in_array($o, $options, true)) {
                        $options[] = $o;
                    }
                }
                $options = array_slice($options, 0, 5);
                if (count($options) < 2) {
                    if ($strict) {
                        throw new HttpError(422, 'Eine Auswahlfrage braucht mindestens zwei Antworten: „' . mb_substr($text, 0, 40) . '“');
                    }
                    continue;
                }
            }
            $id = preg_replace('/[^a-z0-9_]/', '', strtolower((string) ($q['id'] ?? ''))) ?: 'f' . substr(md5($text), 0, 6);
            while (in_array($id, $ids, true)) {
                $id .= 'x';
            }
            $ids[] = $id;
            $out[] = ['id' => substr($id, 0, 20), 'text' => mb_substr($text, 0, 140), 'type' => $type, 'options' => $options];
            if (count($out) === 3) {
                break;
            }
        }
        if ($strict && count(array_filter($in, static fn ($q) => is_array($q) && trim((string) ($q['text'] ?? '')) !== '')) > 3) {
            throw new HttpError(422, 'Höchstens drei Fragen – damit es schnell geht.');
        }
        return $out;
    }

    // ---------- Bestellungen aus dem Abgleich ----------

    /**
     * Felder, die der Abgleich zusätzlich holt – nur, was gerade gebraucht wird (Datensparsamkeit, weniger Rechte):
     * Befragung (oder Probelauf): Kundendaten, Einwilligung, Düfte; nur Empfehlungslinks: E-Mail und Anzahl Bestellungen.
     * Produktlinks nur mit read_products, sonst führt die Nachkauf-Erinnerung in den Shop.
     */
    public static function orderExtra(): string
    {
        if (!self::config()['enabled'] && Trial::state() === null) {
            return Referrals::config()['enabled'] ? 'email customer { id numberOfOrders }' : 'customer { id }';
        }
        $product = Shopify::hasScope('read_products') ? ' product { id handle onlineStoreUrl }' : '';
        return 'email tags customer { id firstName numberOfOrders defaultEmailAddress { emailAddress marketingState } }
        lineItems(first: 20) { nodes { title variantTitle currentQuantity isGiftCard image { url }' . $product . ' } }';
    }

    /** Düfte einer Bestellung (je Produkt einmal, ohne Gutscheine). */
    public static function items(array $o): array
    {
        $out = [];
        foreach ($o['lineItems']['nodes'] ?? [] as $li) {
            if (!is_array($li) || !empty($li['isGiftCard']) || (int) ($li['currentQuantity'] ?? $li['quantity'] ?? 1) <= 0) {
                continue;
            }
            $title = trim((string) ($li['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $pid = preg_replace('/\D/', '', (string) ($li['product']['id'] ?? ''));
            $key = $pid !== '' ? 'p' . $pid : 't' . substr(md5(mb_strtolower($title)), 0, 10);
            if (isset($out[$key])) {
                continue;
            }
            $url = $li['product']['onlineStoreUrl'] ?? null;
            if (!$url && !empty($li['product']['handle'])) {
                $url = Shopify::shopUrl() . '/products/' . rawurlencode((string) $li['product']['handle']);
            }
            $out[$key] = [
                'key' => $key,
                'title' => mb_substr($title, 0, 120),
                'variant' => isset($li['variantTitle']) && $li['variantTitle'] !== 'Default Title' ? mb_substr((string) $li['variantTitle'], 0, 60) : null,
                'image' => isset($li['image']['url']) ? (string) $li['image']['url'] : null,
                'url' => $url,
            ];
            if (count($out) === 6) {
                break;
            }
        }
        return array_values($out);
    }

    private static function newsletter(array $o): bool
    {
        return ($o['customer']['defaultEmailAddress']['marketingState'] ?? '') === 'SUBSCRIBED';
    }

    /**
     * Bestellung aus dem Abgleich: Zeile anlegen bzw. Versand/Zustellung nachtragen.
     * $test: Probelauf (auch wenn die Befragung aus ist; zählt nicht in Auswertungen).
     */
    public static function consider(array $o, ?array $member, bool $test = false): void
    {
        $c = self::config();
        $id = (string) ($o['id'] ?? '');
        if ($id === '') {
            return;
        }
        $row = Db::one('SELECT * FROM club_surveys WHERE order_id = ?', [$id]);
        $now = Util::now();
        if (!$row) {
            if ((!$c['enabled'] && !$test) || !empty($o['cancelledAt']) || (!empty($o['test']) && !$test)) {
                return;
            }
            $ordered = Util::ms($o['processedAt'] ?? $o['createdAt'] ?? null) ?? $now;
            if (!$test && ($ordered < (int) $c['since'] || $ordered < $now - 45 * self::DAY)) {
                return;
            }
            $items = self::items($o);
            if (!$items) {
                return;
            }
            $email = mb_strtolower(trim((string) ($o['email'] ?? $o['customer']['defaultEmailAddress']['emailAddress'] ?? '')));
            $first = trim((string) ($o['customer']['firstName'] ?? ($member['first_name'] ?? '')));
            try {
                Db::insert('club_surveys', [
                    'id' => Util::uuid(),
                    'token' => bin2hex(random_bytes(16)),
                    'order_id' => $id,
                    'order_name' => mb_substr((string) ($o['name'] ?? ''), 0, 40),
                    'member_id' => $member['id'] ?? null,
                    'customer_id' => isset($o['customer']['id']) ? (string) $o['customer']['id'] : null,
                    'email' => filter_var($email, FILTER_VALIDATE_EMAIL) ? mb_substr($email, 0, 190) : null,
                    'first_name' => $first !== '' ? mb_substr($first, 0, 100) : null,
                    'consent' => self::newsletter($o) ? 1 : 0,
                    'items' => Util::json($items),
                    'status' => 'waiting',
                    'reason' => null,
                    'channel' => null,
                    'test' => $test ? 1 : 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } catch (\PDOException) {
                return; // gleichzeitig angelegt
            }
            $row = Db::one('SELECT * FROM club_surveys WHERE order_id = ?', [$id]);
            if (!$row) {
                return;
            }
        } elseif (isset($o['customer'])) {
            // Einwilligung kann sich ändern (Newsletter an- oder abbestellt)
            $consent = self::newsletter($o) ? 1 : 0;
            if ((int) $row['consent'] !== $consent) {
                Db::exec('UPDATE club_surveys SET consent = ?, updated_at = ? WHERE id = ?', [$consent, $now, $row['id']]);
            }
        }
        self::advance($row, $o, $now);
    }

    /** Versand/Zustellung/Storno einer wartenden Anfrage nachtragen. */
    private static function advance(array $row, array $o, int $now): void
    {
        if (!in_array($row['status'], ['waiting', 'scheduled'], true)) {
            return;
        }
        $c = self::config();
        if (!empty($o['cancelledAt'])) {
            Db::exec("UPDATE club_surveys SET status = 'skipped', reason = 'cancelled', updated_at = ? WHERE id = ?", [$now, $row['id']]);
            return;
        }
        if (!array_key_exists('fulfillments', $o)) {
            return;
        }
        $delivered = Points::deliveredAt($o, $now);
        $shipped = null;
        foreach ($o['fulfillments'] ?? [] as $f) {
            if (($f['status'] ?? 'SUCCESS') === 'SUCCESS') {
                $at = Util::ms($f['createdAt'] ?? null);
                if ($at !== null && ($shipped === null || $at > $shipped)) {
                    $shipped = $at;
                }
            }
        }
        if (($o['displayFulfillmentStatus'] ?? '') !== 'FULFILLED') {
            $shipped = null; // erst wenn alles unterwegs ist
        }
        $update = [];
        if ($delivered !== null && $row['delivered_at'] === null) {
            $update['delivered_at'] = $delivered;
            $update['send_at'] = $delivered + (int) $c['delay_days'] * self::DAY;
        } elseif ($shipped !== null && $row['shipped_at'] === null) {
            $update['shipped_at'] = $shipped;
            if ($row['delivered_at'] === null) {
                $update['send_at'] = $shipped + (int) $c['fallback_days'] * self::DAY;
            }
        }
        if ($delivered !== null && $row['shipped_at'] === null && $shipped !== null) {
            $update['shipped_at'] = $shipped;
        }
        if ($update) {
            $update['status'] = 'scheduled';
            $update['updated_at'] = $now;
            Db::update('club_surveys', $update, ['id' => $row['id']]);
        }
    }

    /** Cronjob: Zustellung wartender Anfragen bei Shopify nachfragen (der Status ändert die Bestellung nicht immer). */
    public static function track(): string
    {
        $rows = Db::all(
            "SELECT * FROM club_surveys WHERE status IN ('waiting', 'scheduled') AND delivered_at IS NULL AND created_at > ? AND order_id LIKE 'gid://%' ORDER BY created_at DESC LIMIT 100",
            [Util::now() - 45 * self::DAY]
        );
        if (!$rows) {
            return '0 offen';
        }
        $now = Util::now();
        $n = 0;
        foreach (array_chunk($rows, 50) as $chunk) {
            $d = Shopify::graphql(
                'query ClubSurveyTrack($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id cancelledAt displayFulfillmentStatus fulfillments(first: 10) { status createdAt deliveredAt displayStatus } } } }',
                ['ids' => array_column($chunk, 'order_id')]
            );
            $byId = array_column($chunk, null, 'order_id');
            foreach ($d['nodes'] ?? [] as $o) {
                if (is_array($o) && isset($o['id'], $byId[$o['id']])) {
                    self::advance($byId[$o['id']], $o, $now);
                    $n++;
                }
            }
        }
        return "$n geprüft";
    }

    // ---------- Versand ----------

    public static function hash(string $email): string
    {
        return hash('sha256', mb_strtolower(trim($email)));
    }

    public static function optedOut(?string $email): bool
    {
        return $email !== null && $email !== '' && (bool) Db::value('SELECT 1 FROM club_survey_optout WHERE email_hash = ?', [self::hash($email)]);
    }

    /** Cronjob: fällige Anfragen und Nachkauf-Erinnerungen verschicken, Abgelaufenes schließen. */
    public static function run(int $max = 40): string
    {
        $now = Util::now();
        $c = self::config();
        $sent = 0;
        foreach (Db::all("SELECT * FROM club_surveys WHERE status = 'scheduled' AND send_at <= ? ORDER BY send_at LIMIT $max", [$now]) as $row) {
            if (!$c['enabled'] && !(int) $row['test']) {
                continue;
            }
            $r = self::send($row);
            $sent += $r['status'] === 'sent' ? 1 : 0;
        }
        $expired = Db::exec(
            "UPDATE club_surveys SET status = 'expired', updated_at = ? WHERE status = 'sent' AND sent_at < ?",
            [$now, $now - (int) $c['expire_days'] * self::DAY]
        );
        $reorders = $c['reorder'] ? self::runReorders($now) : 0;
        return "$sent verschickt, $expired abgelaufen, $reorders Nachkauf";
    }

    /**
     * Eine Anfrage verschicken. $force (Test an mich): ohne Prüfung von Einwilligung und Abstand.
     * @return array{status:string, channel:?string, reason:?string, mail:?array, push:bool}
     */
    public static function send(array $row, bool $force = false): array
    {
        $c = self::config();
        $now = Util::now();
        $member = $row['member_id'] ? Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$row['member_id']]) : null;
        $finish = static function (string $status, ?string $channel, ?string $reason, ?array $mail = null, bool $push = false) use ($row, $now, $c): array {
            $update = ['status' => $status, 'channel' => $channel, 'reason' => $reason, 'updated_at' => $now];
            if ($status === 'sent') {
                $update['sent_at'] = $now;
                $base = $row['delivered_at'] ?? $row['shipped_at'] ?? $now;
                $update['reorder_at'] = (int) $base + (int) $c['reorder_days'] * self::DAY;
            }
            Db::update('club_surveys', $update, ['id' => $row['id']]);
            return ['status' => $status, 'channel' => $channel, 'reason' => $reason, 'mail' => $mail, 'push' => $push];
        };
        if (!$force) {
            if (self::optedOut($row['email'])) {
                return $finish('skipped', null, 'optout');
            }
            if ((int) $c['min_gap_days'] > 0 && $row['email'] && Db::value(
                "SELECT 1 FROM club_surveys WHERE email = ? AND id <> ? AND test = 0 AND sent_at > ?",
                [$row['email'], $row['id'], $now - (int) $c['min_gap_days'] * self::DAY]
            )) {
                return $finish('skipped', null, 'recent');
            }
        }
        $items = json_decode((string) $row['items'], true) ?: [];
        $channels = [];
        $push = false;
        if ($member && ($c['push'] || $force)) {
            $push = Push::queue($member, 'survey', [
                'duft' => $items[0]['title'] ?? 'dein Duft',
                'bestellung' => $row['order_name'],
                'punkte' => (string) $c['points'],
            ], 'survey:' . $row['id'] . ($force ? ':' . $now : ''), '/bewertung/' . $row['token']);
            if ($push) {
                $channels[] = 'push';
            }
        }
        $mail = null;
        $allowed = $force
            || ($member && $c['mail_members'] && (int) ($member['survey_mail'] ?? 0) === 1)
            || ($c['mail_newsletter'] && (int) $row['consent'] === 1);
        if ($allowed && $row['email'] && Mailer::configured()) {
            $m = self::render($row, $member);
            $mail = Mailer::send((string) $row['email'], $m['subject'], $m['text'], $m['html'], null, $m['headers']);
            if ($mail['sent']) {
                $channels[] = 'mail';
            }
        }
        if (!$channels && $member) {
            $channels[] = 'app'; // in der App als Karte sichtbar
        }
        if (!$channels) {
            return $finish('skipped', null, $allowed ? 'mail_failed' : 'no_consent', $mail);
        }
        return $finish('sent', implode('+', $channels), null, $mail, $push);
    }

    public static function link(array $row, ?int $stars = null, ?int $item = null): string
    {
        $q = $stars !== null ? '?s=' . $stars . '&p=' . (int) $item : '';
        return Util::baseUrl() . '/bewertung/' . $row['token'] . $q;
    }

    public static function unsubscribeUrl(array $row): string
    {
        return Util::baseUrl() . '/abmelden/' . $row['token'];
    }

    /** Mail mit Sternen je Duft (Tipp öffnet die Seite und speichert die Bewertung). */
    public static function render(array $row, ?array $member): array
    {
        $c = self::config();
        $items = json_decode((string) $row['items'], true) ?: [];
        $first = trim((string) ($row['first_name'] ?? ''));
        $subject = Push::fill($c['subject'], ['vorname' => $first]);
        $subject = preg_replace('/^,\s*/u', '', $subject) ?? $subject;
        $subject = mb_strtoupper(mb_substr($subject, 0, 1)) . mb_substr($subject, 1);
        $hallo = $first !== '' ? 'Hallo ' . $first . ',' : 'Hallo,';
        $rows = '';
        $text = [];
        foreach (array_slice($items, 0, 3) as $i => $it) {
            $stars = '';
            for ($s = 1; $s <= 5; $s++) {
                $stars .= '<a href="' . htmlspecialchars(self::link($row, $s, $i), ENT_QUOTES) . '" style="color:#C9A15B;text-decoration:none;font-size:30px;line-height:1;padding:0 2px" title="' . $s . ' von 5">&#9733;</a>';
            }
            $img = $it['image']
                ? '<img src="' . htmlspecialchars($it['image'] . (str_contains((string) $it['image'], '?') ? '&' : '?') . 'width=120', ENT_QUOTES) . '" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:12px;object-fit:cover;background:#F4EFE6">'
                : '<div style="width:56px;height:56px;border-radius:12px;background:#F4EFE6"></div>';
            $rows .= '<tr><td style="padding:14px 0;border-top:1px solid #EDE5D8"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
                . '<td style="padding-right:14px;vertical-align:middle">' . $img . '</td>'
                . '<td style="vertical-align:middle"><div style="font-size:16px;color:#232120">' . htmlspecialchars($it['title']) . '</div>'
                . ($it['variant'] ? '<div style="font-size:13px;color:#6b625b">' . htmlspecialchars($it['variant']) . '</div>' : '')
                . '<div style="padding-top:6px;white-space:nowrap">' . $stars . '</div></td></tr></table></td></tr>';
            $text[] = '- ' . $it['title'] . ($it['variant'] ? ' (' . $it['variant'] . ')' : '');
        }
        $more = count($items) > 3 ? '<p style="margin:8px 0 0;font-size:14px;color:#6b625b">… und ' . (count($items) - 3) . ' weitere auf der Bewertungsseite.</p>' : '';
        $thanks = $member && (int) $c['points'] > 0
            ? '<p style="margin:14px 0 0;font-size:15px">Als Dankeschön schreiben wir dir <b>' . (int) $c['points'] . ' Club-Punkte</b> gut – egal, wie deine Bewertung ausfällt.</p>'
            : '';
        $content = '<p style="margin:0">' . htmlspecialchars($hallo) . '</p>'
            . '<p style="margin:10px 0 0">' . htmlspecialchars($c['intro']) . '</p>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">' . $rows . '</table>'
            . $more . $thanks;
        $unsub = self::unsubscribeUrl($row);
        $why = $member && (int) ($member['survey_mail'] ?? 0) === 1
            ? 'weil du im Club Bewertungsanfragen per E-Mail eingeschaltet hast'
            : 'weil du unseren Newsletter abonniert hast';
        $footer = htmlspecialchars($c['sender']) . ' · Bestellung ' . htmlspecialchars($row['order_name']) . '<br>'
            . 'Du bekommst diese E-Mail, ' . $why . '. '
            . '<a href="' . htmlspecialchars($unsub, ENT_QUOTES) . '" style="color:#6b625b">Keine Bewertungsanfragen mehr</a> · '
            . '<a href="' . htmlspecialchars(self::privacyUrl(), ENT_QUOTES) . '" style="color:#6b625b">Datenschutz</a> · '
            . '<a href="' . htmlspecialchars(self::imprintUrl(), ENT_QUOTES) . '" style="color:#6b625b">Impressum</a>';
        $html = Mailer::layout($c['sender'], 'Wie gefällt dir <i style="color:#80562F">dein Duft</i>?', $content, ['label' => 'Bewertung abgeben', 'url' => self::link($row)], $footer);
        $plain = "$hallo\n\n" . $c['intro'] . "\n\n" . implode("\n", $text) . "\n\nZur Bewertung (dauert eine Minute): " . self::link($row) . "\n\n"
            . ($thanks !== '' ? 'Als Dankeschön gibt es ' . (int) $c['points'] . " Club-Punkte – egal, wie deine Bewertung ausfällt.\n\n" : '')
            . "Du bekommst diese E-Mail, $why. Keine Bewertungsanfragen mehr: $unsub\nDatenschutz: " . self::privacyUrl() . "\nImpressum: " . self::imprintUrl() . "\n\n" . $c['sender'];
        return [
            'subject' => $subject,
            'text' => $plain,
            'html' => $html,
            'headers' => [
                'List-Unsubscribe' => '<' . Util::baseUrl() . '/api/abmelden/' . $row['token'] . '>',
                'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
            ],
        ];
    }

    // ---------- Öffentliche Seite /bewertung/{token} ----------

    public static function byToken(string $token): array
    {
        $row = preg_match('/^[0-9a-f]{32}$/', $token) ? Db::one('SELECT * FROM club_surveys WHERE token = ?', [$token]) : null;
        if (!$row || $row['status'] === 'skipped' && $row['reason'] !== 'optout' && $row['sent_at'] === null && !(int) $row['test']) {
            throw new HttpError(404, 'Diese Bewertung kennen wir nicht (mehr).');
        }
        return $row;
    }

    private static function member(array $row): ?array
    {
        return $row['member_id'] ? Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$row['member_id']]) : null;
    }

    private static function state(array $row): string
    {
        if ($row['answered_at'] !== null) {
            return 'answered';
        }
        if ($row['status'] === 'expired' || ($row['sent_at'] !== null && (int) $row['sent_at'] < Util::now() - (int) self::config()['expire_days'] * self::DAY)) {
            return 'expired';
        }
        return 'open';
    }

    public static function publicView(array $row): array
    {
        $c = self::config();
        $member = self::member($row);
        $answers = json_decode((string) ($row['answers'] ?? ''), true) ?: [];
        $state = self::state($row);
        return [
            'state' => $state,
            'first_name' => $row['first_name'],
            'order_name' => $row['order_name'],
            'items' => array_map(static fn ($i) => ['key' => $i['key'], 'title' => $i['title'], 'variant' => $i['variant'], 'image' => $i['image']], json_decode((string) $row['items'], true) ?: []),
            'ratings' => (object) ($answers['ratings'] ?? []),
            'answers' => (object) ($answers['questions'] ?? []),
            'comment' => $row['comment'],
            'questions' => $c['questions'],
            'comment_enabled' => (bool) $c['comment'],
            'member' => $member !== null,
            'points' => $member && (int) $row['points'] === 0 && $state === 'open' ? (int) $c['points'] : 0,
            'privacy_url' => self::privacyUrl(),
            'imprint_url' => self::imprintUrl(),
            'shop_url' => Shopify::shopUrl(),
            'test' => (bool) (int) $row['test'],
            'thanks' => $state === 'answered' ? self::thanks($row, $member) : null,
        ];
    }

    /** Dankeseite: Punkte, Bewertung im Shop (für alle), Empfehlungslink bei Begeisterung, Beitritt für Nicht-Mitglieder. */
    private static function thanks(array $row, ?array $member): array
    {
        $c = self::config();
        $avg = $row['rating_avg'] !== null ? (float) $row['rating_avg'] : null;
        $low = $row['rating_min'] !== null && (int) $row['rating_min'] <= (int) $c['low_threshold'];
        $out = [
            'points' => (int) $row['points'],
            'low' => $low,
            'review' => $c['review_url'] !== '' ? ['url' => $c['review_url'], 'label' => $c['review_label']] : null,
            'referral' => null,
            'join' => null,
        ];
        if ($member && $avg !== null && $avg >= 4) {
            $out['referral'] = Referrals::teaser($member);
        }
        if (!$member) {
            $p = Points::program();
            $out['join'] = ['url' => Util::baseUrl() . '/', 'program' => $p['name'], 'welcome_points' => (int) $p['welcome_points']];
        }
        return $out;
    }

    /** Antwort speichern (auch zwischendurch, z. B. nach dem Tipp in der Mail). $done = abschicken. */
    public static function answer(string $token, array $in): array
    {
        $row = self::byToken($token);
        Util::limit('survey:' . $row['id'], 40, 3600, 'Bitte versuche es gleich noch einmal.');
        $c = self::config();
        if (self::state($row) === 'expired') {
            throw new HttpError(410, 'Diese Befragung ist leider schon abgelaufen. Schreib uns gern direkt, wie dir dein Duft gefällt.');
        }
        $items = json_decode((string) $row['items'], true) ?: [];
        $keys = array_column($items, 'key');
        $old = json_decode((string) ($row['answers'] ?? ''), true) ?: [];
        $ratings = is_array($old['ratings'] ?? null) ? $old['ratings'] : [];
        foreach (is_array($in['ratings'] ?? null) ? $in['ratings'] : [] as $k => $v) {
            if (!in_array((string) $k, $keys, true)) {
                continue;
            }
            $v = (int) $v;
            if ($v < 1 || $v > 5) {
                throw new HttpError(422, 'Bitte 1 bis 5 Sterne wählen.');
            }
            $ratings[(string) $k] = $v;
        }
        $answers = is_array($old['questions'] ?? null) ? $old['questions'] : [];
        foreach ($c['questions'] as $q) {
            if (!array_key_exists($q['id'], (array) ($in['answers'] ?? []))) {
                continue;
            }
            $v = $in['answers'][$q['id']];
            if ($v === null || $v === '') {
                unset($answers[$q['id']]);
                continue;
            }
            if ($q['type'] === 'stars') {
                $v = (int) $v;
                if ($v < 1 || $v > 5) {
                    throw new HttpError(422, 'Bitte 1 bis 5 Sterne wählen.');
                }
            } elseif ($q['type'] === 'choice') {
                if (!in_array((string) $v, $q['options'], true)) {
                    throw new HttpError(422, 'Bitte eine der Antworten wählen.');
                }
                $v = (string) $v;
            } else {
                $v = mb_substr(trim((string) $v), 0, 500);
            }
            $answers[$q['id']] = $v;
        }
        $comment = array_key_exists('comment', $in) ? Util::str($in['comment'], 2000) : $row['comment'];
        $done = !empty($in['done']);
        if ($done && !$ratings) {
            throw new HttpError(422, 'Bitte bewerte mindestens einen Duft mit Sternen.');
        }
        $stars = array_values($ratings);
        foreach ($c['questions'] as $q) {
            if ($q['type'] === 'stars' && isset($answers[$q['id']])) {
                $stars[] = (int) $answers[$q['id']];
            }
        }
        $now = Util::now();
        $update = [
            'answers' => Util::json(['ratings' => (object) $ratings, 'questions' => (object) $answers]),
            'comment' => $comment,
            'rating_min' => $stars ? min($stars) : null,
            'rating_avg' => $ratings ? round(array_sum($ratings) / count($ratings), 2) : null,
            'updated_at' => $now,
        ];
        $first = $done && $row['answered_at'] === null;
        if ($first) {
            $update['answered_at'] = $now;
            $update['status'] = 'answered';
            $update['sent_at'] = $row['sent_at'] ?? $now;
        }
        Db::update('club_surveys', $update, ['id' => $row['id']]);
        $row = Db::one('SELECT * FROM club_surveys WHERE id = ?', [$row['id']]);
        if ($row['answered_at'] !== null) {
            self::afterAnswer($row, $first);
            $row = Db::one('SELECT * FROM club_surveys WHERE id = ?', [$row['id']]);
        }
        return self::publicView($row);
    }

    /** Punkte (einmal), Hinweis ans Team bei schlechter Bewertung (einmal), keine Nachkauf-Erinnerung nach Enttäuschung. */
    private static function afterAnswer(array $row, bool $first): void
    {
        $c = self::config();
        $member = self::member($row);
        // Probelauf: Punkte nur für das Testkonto, nie für ein echtes Konto
        if ($member && (!(int) $row['test'] || (int) ($member['test'] ?? 0) === 1) && (int) $row['points'] === 0 && (int) $c['points'] > 0
            && !Db::value("SELECT 1 FROM club_ledger WHERE kind = 'survey' AND ref = ?", ['survey:' . $row['id']])) {
            $pts = (int) $c['points'];
            if (Db::exec('UPDATE club_surveys SET points = ? WHERE id = ? AND points = 0', [$pts, $row['id']]) === 1) {
                Points::book($member['id'], 'survey', $pts, 'Danke für deine Bewertung zu ' . $row['order_name'], 'survey:' . $row['id']);
                Http::defer(static fn () => Points::pushMetafields());
            }
        }
        $low = $row['rating_min'] !== null && (int) $row['rating_min'] <= (int) $c['low_threshold'];
        if ($low) {
            Db::exec('UPDATE club_surveys SET reorder_at = NULL WHERE id = ?', [$row['id']]);
        }
        if ($low && $c['alert_team'] && !(int) $row['alerted']) {
            if (Db::exec('UPDATE club_surveys SET alerted = 1 WHERE id = ? AND alerted = 0', [$row['id']]) === 1) {
                self::alert($row, $member);
            }
        }
    }

    /** Hinweis an das Team: Eintrag für die Team-App (Aufgabe + Push) und Mail an die Feedback-Adresse. */
    private static function alert(array $row, ?array $member): void
    {
        $items = json_decode((string) $row['items'], true) ?: [];
        $answers = json_decode((string) ($row['answers'] ?? ''), true) ?: [];
        $c = self::config();
        $rated = [];
        foreach ($items as $it) {
            $s = $answers['ratings'][$it['key']] ?? null;
            if ($s !== null) {
                $rated[] = ['title' => $it['title'] . ($it['variant'] ? ' (' . $it['variant'] . ')' : ''), 'stars' => (int) $s];
            }
        }
        $qs = [];
        foreach ($c['questions'] as $q) {
            if (isset($answers['questions'][$q['id']])) {
                $qs[] = ['question' => $q['text'], 'answer' => (string) $answers['questions'][$q['id']], 'type' => $q['type']];
            }
        }
        $payload = [
            'survey_id' => $row['id'],
            'order_id' => $row['order_id'],
            'order_name' => $row['order_name'],
            'email' => $row['email'],
            'name' => trim((string) ($row['first_name'] ?? '')) ?: null,
            'member' => $member !== null,
            'tier' => $member ? Tiers::of($member)['name'] : null,
            'stars' => (int) $row['rating_min'],
            'avg' => $row['rating_avg'] !== null ? (float) $row['rating_avg'] : null,
            'items' => $rated,
            'questions' => $qs,
            'comment' => $row['comment'],
        ];
        Db::insert('club_alerts', [
            'id' => Util::uuid(),
            'kind' => 'low_rating',
            'payload' => Util::json($payload),
            'test' => (int) $row['test'],
            'created_at' => Util::now(),
            'claimed_at' => null,
        ]);
        $who = ($payload['name'] ?? 'Kundin/Kunde') . ($row['email'] ? ' <' . $row['email'] . '>' : '');
        $lines = array_map(static fn ($r) => $r['title'] . ': ' . str_repeat('★', $r['stars']) . str_repeat('☆', 5 - $r['stars']), $rated);
        foreach ($qs as $q) {
            $lines[] = $q['question'] . ' ' . ($q['type'] === 'stars' ? $q['answer'] . ' ★' : $q['answer']);
        }
        $text = "Schlechte Bewertung zu Bestellung {$row['order_name']}\n\nVon: $who" . ($member ? ' (Club-Mitglied, ' . $payload['tier'] . ')' : '') . "\n\n"
            . implode("\n", $lines) . "\n\n" . ($row['comment'] ? "Kommentar:\n{$row['comment']}\n\n" : '')
            . "In der Team-App liegt eine Aufgabe mit einem Vorschlag für die Antwort. Antworten auf diese Mail gehen direkt an die Person.";
        $html = Mailer::layout(
            'Bewertung',
            htmlspecialchars((string) $payload['stars']) . ' ★ zu ' . htmlspecialchars($row['order_name']),
            '<p style="margin:0 0 12px">' . nl2br(htmlspecialchars("Von: $who" . ($member ? "\nClub-Mitglied, " . $payload['tier'] : ''))) . '</p>'
                . '<p style="margin:0 0 12px">' . nl2br(htmlspecialchars(implode("\n", $lines))) . '</p>'
                . ($row['comment'] ? '<p style="margin:0;padding:14px 16px;background:#F4EFE6;border-radius:14px">' . nl2br(htmlspecialchars((string) $row['comment'])) . '</p>' : ''),
            null,
            'Antworten geht direkt an die Person. In der Team-App liegt dazu eine Aufgabe.'
        );
        $to = Feedback::email();
        $subject = ((int) $row['test'] ? '[Probelauf] ' : '') . 'Bewertung ' . $payload['stars'] . ' ★ zu ' . $row['order_name'];
        $reply = $row['email'];
        Http::defer(static fn () => Mailer::send($to, $subject, $text, $html, $reply));
    }

    /** Abmelden (Link in der Mail, List-Unsubscribe): keine Bewertungs- und Nachkauf-Mails mehr an diese Adresse. */
    public static function optOut(string $token, string $source = 'link'): array
    {
        $row = self::byToken($token);
        if ($row['email']) {
            $h = self::hash((string) $row['email']);
            if (!Db::value('SELECT 1 FROM club_survey_optout WHERE email_hash = ?', [$h])) {
                Db::insert('club_survey_optout', ['email_hash' => $h, 'source' => $source, 'created_at' => Util::now()]);
            }
            $now = Util::now();
            Db::exec("UPDATE club_surveys SET status = 'skipped', reason = 'optout', updated_at = ? WHERE email = ? AND status IN ('waiting', 'scheduled')", [$now, $row['email']]);
            Db::exec('UPDATE club_surveys SET reorder_at = NULL WHERE email = ? AND reorder_sent_at IS NULL', [$row['email']]);
            Db::exec('UPDATE club_members SET survey_mail = 0 WHERE email = ?', [$row['email']]);
        }
        return ['ok' => true, 'email' => $row['email'] ? self::mask((string) $row['email']) : null];
    }

    public static function mask(string $email): string
    {
        [$u, $d] = array_pad(explode('@', $email, 2), 2, '');
        return mb_substr($u, 0, 2) . str_repeat('•', max(1, min(6, mb_strlen($u) - 2))) . '@' . $d;
    }

    // ---------- Nachkauf-Erinnerung (I6) ----------

    private static function runReorders(int $now, int $max = 40): int
    {
        $c = self::config();
        $n = 0;
        foreach (Db::all(
            "SELECT * FROM club_surveys WHERE reorder_at IS NOT NULL AND reorder_at <= ? AND reorder_sent_at IS NULL AND status IN ('sent', 'answered', 'expired') ORDER BY reorder_at LIMIT $max",
            [$now]
        ) as $row) {
            if (Db::exec('UPDATE club_surveys SET reorder_sent_at = ? WHERE id = ? AND reorder_sent_at IS NULL', [$now, $row['id']]) !== 1) {
                continue;
            }
            $n += self::reorder($row)['sent'] ? 1 : 0;
        }
        return $n;
    }

    /**
     * Erinnerung an einen Duft: Push (Kategorie „Aktionen & neue Düfte“) an Mitglieder,
     * Mail nur an Newsletter-Abonnenten (Werbung) – und nur, wenn er nicht schon nachbestellt wurde.
     * @return array{sent:bool, reason:?string, channels:string[], mail:?array}
     */
    public static function reorder(array $row, bool $force = false): array
    {
        $c = self::config();
        $items = json_decode((string) $row['items'], true) ?: [];
        $answers = json_decode((string) ($row['answers'] ?? ''), true) ?: [];
        // Den am besten bewerteten Duft nehmen (ohne Bewertung: den ersten)
        usort($items, static fn ($a, $b) => ($answers['ratings'][$b['key']] ?? 3) <=> ($answers['ratings'][$a['key']] ?? 3));
        $item = $items[0] ?? null;
        if (!$item) {
            return ['sent' => false, 'reason' => 'no_item', 'channels' => [], 'mail' => null];
        }
        if (!$force) {
            if (self::optedOut($row['email'])) {
                return ['sent' => false, 'reason' => 'optout', 'channels' => [], 'mail' => null];
            }
            if (($answers['ratings'][$item['key']] ?? 3) <= (int) $c['low_threshold']) {
                return ['sent' => false, 'reason' => 'low', 'channels' => [], 'mail' => null];
            }
            // Schon wieder bestellt (gleicher Duft in einer späteren Bestellung)?
            foreach (Db::all('SELECT items FROM club_surveys WHERE email = ? AND created_at > ? AND id <> ?', [$row['email'], $row['created_at'], $row['id']]) as $later) {
                if (in_array($item['key'], array_column(json_decode((string) $later['items'], true) ?: [], 'key'), true)) {
                    return ['sent' => false, 'reason' => 'reordered', 'channels' => [], 'mail' => null];
                }
            }
        }
        $url = $item['url'] ?: Shopify::shopUrl();
        $member = self::member($row);
        $channels = [];
        if ($member && Push::queue($member, 'reorder', ['duft' => $item['title']], 'reorder:' . $row['id'] . ($force ? ':' . Util::now() : ''), $url)) {
            $channels[] = 'push';
        }
        $mail = null;
        if (($force || ($c['mail_newsletter'] && (int) $row['consent'] === 1)) && $row['email'] && Mailer::configured()) {
            $m = self::renderReorder($row, $item, $member);
            $mail = Mailer::send((string) $row['email'], $m['subject'], $m['text'], $m['html'], null, $m['headers']);
            if ($mail['sent']) {
                $channels[] = 'mail';
            }
        }
        return ['sent' => (bool) $channels, 'reason' => $channels ? null : 'no_channel', 'channels' => $channels, 'mail' => $mail];
    }

    public static function renderReorder(array $row, array $item, ?array $member): array
    {
        $c = self::config();
        $first = trim((string) ($row['first_name'] ?? ''));
        $url = $item['url'] ?: Shopify::shopUrl();
        $value = '';
        if ($member) {
            $s = Points::summary($member);
            if ($s['value_cents'] > 0) {
                $value = '<p style="margin:14px 0 0;padding:14px 16px;background:#F4EFE6;border-radius:14px;font-size:15px">Übrigens: Mit deinen Club-Punkten hast du gerade <b>' . Util::euro((int) $s['value_cents']) . ' Rabatt</b> bereit.</p>';
            }
        }
        $img = $item['image'] ? '<img src="' . htmlspecialchars($item['image'] . (str_contains((string) $item['image'], '?') ? '&' : '?') . 'width=240', ENT_QUOTES) . '" width="120" alt="" style="display:block;width:120px;border-radius:16px;margin:16px 0 0">' : '';
        $content = '<p style="margin:0">' . htmlspecialchars($first !== '' ? "Hallo $first," : 'Hallo,') . '</p>'
            . '<p style="margin:10px 0 0">vor einiger Zeit ist <b>' . htmlspecialchars($item['title']) . '</b> bei dir angekommen. Falls dein Flakon langsam leer wird: Hier kannst du ihn mit einem Klick nachbestellen.</p>'
            . $img . $value;
        $unsub = self::unsubscribeUrl($row);
        $footer = htmlspecialchars($c['sender']) . '<br>Du bekommst diese E-Mail, weil du unseren Newsletter abonniert hast. '
            . '<a href="' . htmlspecialchars($unsub, ENT_QUOTES) . '" style="color:#6b625b">Keine Erinnerungen mehr</a> · '
            . '<a href="' . htmlspecialchars(self::privacyUrl(), ENT_QUOTES) . '" style="color:#6b625b">Datenschutz</a> · '
            . '<a href="' . htmlspecialchars(self::imprintUrl(), ENT_QUOTES) . '" style="color:#6b625b">Impressum</a>';
        return [
            'subject' => ($first !== '' ? "$first, " : '') . 'Zeit für ' . $item['title'] . '?',
            'html' => Mailer::layout($c['sender'], 'Zeit für <i style="color:#80562F">Nachschub</i>?', $content, ['label' => 'Jetzt nachbestellen', 'url' => $url], $footer),
            'text' => ($first !== '' ? "Hallo $first,\n\n" : "Hallo,\n\n") . 'vor einiger Zeit ist ' . $item['title'] . " bei dir angekommen. Falls dein Flakon langsam leer wird: $url\n\n"
                . "Keine Erinnerungen mehr: $unsub\nDatenschutz: " . self::privacyUrl() . "\nImpressum: " . self::imprintUrl() . "\n\n" . $c['sender'],
            'headers' => [
                'List-Unsubscribe' => '<' . Util::baseUrl() . '/api/abmelden/' . $row['token'] . '>',
                'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
            ],
        ];
    }

    // ---------- Mitglieder: offene Befragung in der App, Schalter für Mails ----------

    public static function openFor(array $member): ?array
    {
        $row = Db::one(
            "SELECT * FROM club_surveys WHERE member_id = ? AND status = 'sent' AND answered_at IS NULL AND sent_at > ? ORDER BY sent_at DESC",
            [$member['id'], Util::now() - (int) self::config()['expire_days'] * self::DAY]
        );
        if (!$row) {
            return null;
        }
        $items = json_decode((string) $row['items'], true) ?: [];
        return ['token' => $row['token'], 'order_name' => $row['order_name'], 'title' => $items[0]['title'] ?? null, 'image' => $items[0]['image'] ?? null, 'count' => count($items), 'points' => (int) self::config()['points']];
    }

    public static function memberState(array $member): array
    {
        $c = self::config();
        return [
            'enabled' => (bool) $c['enabled'],
            'mail' => (int) ($member['survey_mail'] ?? 0) === 1,
            'mail_available' => (bool) $c['mail_members'],
            'open' => $c['enabled'] ? self::openFor($member) : null,
        ];
    }

    public static function setMemberMail(array $member, bool $on): void
    {
        Db::exec('UPDATE club_members SET survey_mail = ? WHERE id = ?', [$on ? 1 : 0, $member['id']]);
        if ($on) {
            // Ausdrückliche Einwilligung hebt einen früheren Widerspruch auf
            Db::exec('DELETE FROM club_survey_optout WHERE email_hash = ?', [self::hash((string) $member['email'])]);
        }
    }

    // ---------- Auswertung ----------

    public static function stats(int $from, int $to): array
    {
        $c = self::config();
        $r = Db::one(
            'SELECT COUNT(*) AS n, AVG(rating_avg) AS a, SUM(CASE WHEN rating_min <= ? THEN 1 ELSE 0 END) AS low FROM club_surveys WHERE test = 0 AND answered_at >= ? AND answered_at < ? AND rating_avg IS NOT NULL',
            [(int) $c['low_threshold'], $from, $to]
        );
        $sent = (int) Db::value('SELECT COUNT(*) FROM club_surveys WHERE test = 0 AND sent_at >= ? AND sent_at < ?', [$from, $to]);
        return [
            'count' => (int) $r['n'],
            'avg' => $r['a'] !== null ? round((float) $r['a'], 2) : null,
            'low' => (int) $r['low'],
            'sent' => $sent,
        ];
    }

    public static function forEmail(string $email): array
    {
        $rows = Db::all(
            'SELECT * FROM club_surveys WHERE email = ? AND test = 0 AND answered_at IS NOT NULL AND rating_avg IS NOT NULL ORDER BY answered_at DESC LIMIT 20',
            [mb_strtolower($email)]
        );
        if (!$rows) {
            return ['avg' => null, 'count' => 0, 'last' => null];
        }
        $last = $rows[0];
        $items = json_decode((string) $last['items'], true) ?: [];
        return [
            'avg' => round(array_sum(array_map(static fn ($r) => (float) $r['rating_avg'], $rows)) / count($rows), 2),
            'count' => count($rows),
            'last' => [
                'stars' => (int) round((float) $last['rating_avg']),
                'product' => $items[0]['title'] ?? null,
                'comment' => $last['comment'],
                'created_at' => (int) $last['answered_at'],
            ],
        ];
    }

    /** Für den Admin-Bereich: Kennzahlen der letzten 90 Tage, Durchschnitt je Duft, letzte Antworten. */
    public static function overview(): array
    {
        $since = Util::now() - 90 * self::DAY;
        $byStatus = [];
        foreach (Db::all('SELECT status, COUNT(*) AS n FROM club_surveys WHERE test = 0 AND created_at > ? GROUP BY status', [$since]) as $r) {
            $byStatus[$r['status']] = (int) $r['n'];
        }
        $reasons = [];
        foreach (Db::all("SELECT reason, COUNT(*) AS n FROM club_surveys WHERE test = 0 AND status = 'skipped' AND created_at > ? GROUP BY reason", [$since]) as $r) {
            $reasons[(string) $r['reason']] = (int) $r['n'];
        }
        $dist = [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0];
        $products = [];
        $recent = [];
        foreach (Db::all('SELECT * FROM club_surveys WHERE test = 0 AND answered_at > ? ORDER BY answered_at DESC LIMIT 500', [$since]) as $r) {
            $items = array_column(json_decode((string) $r['items'], true) ?: [], null, 'key');
            $a = json_decode((string) ($r['answers'] ?? ''), true) ?: [];
            foreach ((array) ($a['ratings'] ?? []) as $k => $s) {
                $dist[(int) $s] = ($dist[(int) $s] ?? 0) + 1;
                $t = $items[$k]['title'] ?? $k;
                $products[$t] ??= ['title' => $t, 'sum' => 0, 'n' => 0];
                $products[$t]['sum'] += (int) $s;
                $products[$t]['n']++;
            }
            if (count($recent) < 20) {
                $recent[] = [
                    'order_name' => $r['order_name'],
                    'name' => $r['first_name'],
                    'member' => $r['member_id'] !== null,
                    'avg' => $r['rating_avg'] !== null ? (float) $r['rating_avg'] : null,
                    'min' => $r['rating_min'] !== null ? (int) $r['rating_min'] : null,
                    'comment' => $r['comment'],
                    'items' => array_values(array_map(static fn ($k, $s) => ['title' => $items[$k]['title'] ?? $k, 'stars' => (int) $s], array_keys((array) ($a['ratings'] ?? [])), (array) ($a['ratings'] ?? []))),
                    'at' => (int) $r['answered_at'],
                ];
            }
        }
        $products = array_values(array_map(static fn ($p) => ['title' => $p['title'], 'avg' => round($p['sum'] / $p['n'], 2), 'count' => $p['n']], $products));
        usort($products, static fn ($a, $b) => $b['count'] <=> $a['count']);
        $s = self::stats($since, Util::now() + 1);
        return [
            'status' => $byStatus,
            'skipped' => $reasons,
            'answered' => $s['count'],
            'sent' => $s['sent'],
            'avg' => $s['avg'],
            'low' => $s['low'],
            'distribution' => $dist,
            'products' => array_slice($products, 0, 12),
            'recent' => $recent,
            'optouts' => (int) Db::value('SELECT COUNT(*) FROM club_survey_optout'),
            'members_mail' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE joined_at IS NOT NULL AND survey_mail = 1'),
        ];
    }

    // ---------- Test und Vorschau (Admin) ----------

    /** Beispielzeile: letzte echte Bestellung (Düfte) oder ein Musterduft. */
    private static function sampleItems(): array
    {
        $last = Db::value('SELECT items FROM club_surveys WHERE test = 0 ORDER BY created_at DESC');
        $items = $last ? (json_decode((string) $last, true) ?: []) : [];
        return $items ?: [['key' => 'tmuster', 'title' => 'Sunset Dune', 'variant' => '50 ml', 'image' => null, 'url' => Shopify::shopUrl()]];
    }

    public static function preview(string $kind, array $admin): array
    {
        $own = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL', [$admin['email']]);
        $row = [
            'id' => 'vorschau',
            'token' => str_repeat('0', 32),
            'order_name' => '#1042',
            'first_name' => explode(' ', (string) $admin['name'])[0] ?: null,
            'items' => Util::json(self::sampleItems()),
            'answers' => null,
            'consent' => 1,
        ];
        $m = $kind === 'reorder' ? self::renderReorder($row, self::sampleItems()[0], $own) : self::render($row, $own);
        return ['subject' => $m['subject'], 'html' => $m['html']];
    }

    /** „Test an mich“: echte Anfrage (als Test markiert) an die eigene Adresse und – falls angemeldet – als Push. */
    public static function test(array $admin, string $kind = 'survey'): array
    {
        $own = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL', [$admin['email']]);
        $now = Util::now();
        $id = Util::uuid();
        Db::insert('club_surveys', [
            'id' => $id,
            'token' => bin2hex(random_bytes(16)),
            'order_id' => 'test:' . $id,
            'order_name' => '#TEST',
            'member_id' => $own['id'] ?? null,
            'customer_id' => $own['shopify_id'] ?? null,
            'email' => mb_strtolower((string) $admin['email']),
            'first_name' => explode(' ', (string) $admin['name'])[0] ?: null,
            'consent' => 1,
            'items' => Util::json(self::sampleItems()),
            'status' => 'scheduled',
            'reason' => null,
            'channel' => null,
            'delivered_at' => $now,
            'send_at' => $now,
            'test' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $row = Db::one('SELECT * FROM club_surveys WHERE id = ?', [$id]);
        if ($kind === 'reorder') {
            Db::update('club_surveys', ['status' => 'sent', 'sent_at' => $now], ['id' => $id]);
            $r = self::reorder($row, true);
            return ['message' => self::testMessage($r['channels'], $r['mail'], $admin['email'], $own !== null), 'link' => null];
        }
        $r = self::send($row, true);
        $channels = $r['channel'] ? explode('+', $r['channel']) : [];
        return ['message' => self::testMessage($channels, $r['mail'], $admin['email'], $own !== null), 'link' => self::link($row)];
    }

    private static function testMessage(array $channels, ?array $mail, string $email, bool $member): string
    {
        $parts = [];
        if (in_array('mail', $channels, true)) {
            $parts[] = 'Mail an ' . $email;
        } elseif ($mail) {
            $parts[] = 'Mail: ' . $mail['message'];
        } else {
            $parts[] = 'keine Mail (Versand nicht eingerichtet)';
        }
        if (in_array('push', $channels, true)) {
            $parts[] = 'Push auf dein Gerät';
        } elseif ($member) {
            $parts[] = 'kein Push (kein Gerät angemeldet oder Kategorie aus)';
        } else {
            $parts[] = 'kein Push (mit ' . $email . ' bist du kein Club-Mitglied)';
        }
        return 'Test verschickt: ' . implode(', ', $parts) . '.';
    }

    // ---------- Aufräumen ----------

    /** Täglich: Testzeilen nach 7 Tagen löschen, unbeantwortete nach 6 Monaten, Antworten nach der Frist anonymisieren. */
    public static function cleanup(): string
    {
        $now = Util::now();
        $c = self::config();
        $a = Db::exec('DELETE FROM club_surveys WHERE test = 1 AND created_at < ?', [$now - 7 * self::DAY]);
        $b = Db::exec('DELETE FROM club_surveys WHERE answered_at IS NULL AND created_at < ?', [$now - 183 * self::DAY]);
        $cut = (new \DateTimeImmutable('@' . intdiv($now, 1000)))->modify('-' . (int) $c['retention_months'] . ' months')->getTimestamp() * 1000;
        $d = Db::exec(
            'UPDATE club_surveys SET email = NULL, first_name = NULL, customer_id = NULL, member_id = NULL, comment = NULL, reorder_at = NULL WHERE answered_at IS NOT NULL AND answered_at < ? AND email IS NOT NULL',
            [$cut]
        );
        Db::exec('DELETE FROM club_alerts WHERE created_at < ?', [$now - 90 * self::DAY]);
        return "$a Tests, $b unbeantwortet gelöscht, $d anonymisiert";
    }
}
