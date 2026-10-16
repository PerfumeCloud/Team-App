<?php
declare(strict_types=1);

namespace PC;

/**
 * Antworten direkt aus der App: voller Mailtext, Textbausteine mit Platzhaltern, Signatur,
 * Versand über das Postfach, in dem die Mail angekommen ist, Kopie in „Gesendet“ und Markierung „beantwortet“.
 */
final class Replies
{
    /** Platzhalter für Textbausteine (Anzeige in der App). */
    public const PLACEHOLDERS = [
        'vorname' => 'Vorname der Kundin / des Kunden',
        'name' => 'Ganzer Name',
        'bestellnummer' => 'Bestellnummer (aus der Mail oder die letzte Bestellung)',
        'versandstatus' => 'z. B. „Unterwegs“ oder „Noch nicht versendet“',
        'versanddienst' => 'z. B. DHL',
        'sendungsnummer' => 'Sendungsnummer',
        'sendungslink' => 'Link zur Sendungsverfolgung',
        'artikel' => 'Düfte der Bestellung',
        'punkte' => 'Club-Punkte (verfügbar)',
        'stufe' => 'Club-Stufe',
        'meinvorname' => 'Dein Vorname',
        'meinname' => 'Dein ganzer Name',
    ];

    private const BODY_MAX = 400000;

    // ---------- Textbausteine ----------

    public static function templates(): array
    {
        return array_map(static fn ($t) => [
            'id' => $t['id'],
            'title' => $t['title'],
            'body' => $t['body'],
            'position' => (int) $t['position'],
            'updated_at' => (int) $t['updated_at'],
        ], Db::all('SELECT * FROM reply_templates WHERE deleted = 0 ORDER BY position, title'));
    }

    public static function saveTemplate(array $me, string $id, array $in): array
    {
        if (!Util::isUuid($id)) {
            throw new HttpError(422, 'Ungültige ID.');
        }
        $title = Util::str($in['title'] ?? '', 120, false);
        $body = Util::str($in['body'] ?? '', 8000, false);
        if ($title === '' || $body === '') {
            throw new HttpError(422, 'Bitte Titel und Text ausfüllen.');
        }
        $now = Util::now();
        $row = ['title' => $title, 'body' => $body, 'position' => (int) ($in['position'] ?? 0), 'updated_by' => $me['id'], 'updated_at' => $now, 'deleted' => 0];
        if (Db::value('SELECT 1 FROM reply_templates WHERE id = ?', [$id])) {
            Db::update('reply_templates', $row, ['id' => $id]);
        } else {
            Db::insert('reply_templates', $row + ['id' => $id, 'created_by' => $me['id'], 'created_at' => $now]);
        }
        return self::templates();
    }

    public static function deleteTemplate(string $id): array
    {
        Db::exec('UPDATE reply_templates SET deleted = 1, updated_at = ? WHERE id = ?', [Util::now(), $id]);
        return self::templates();
    }

    /** Beim ersten Update: ein paar Bausteine für den Alltag (danach pflegen Admins sie selbst). */
    public static function seedTemplates(): void
    {
        if (Settings::get('templates_seeded') || (int) Db::value('SELECT COUNT(*) FROM reply_templates') > 0) {
            return;
        }
        $defaults = [
            ['Wo ist meine Bestellung?', "Hallo {vorname},\n\nvielen Dank für deine Nachricht! Deine Bestellung {bestellnummer} ist {versandstatus}.\n\nHier kannst du die Sendung verfolgen: {sendungslink}\n\nMelde dich gern, falls das Paket in den nächsten Tagen nicht ankommt."],
            ['Bestellung noch nicht versendet', "Hallo {vorname},\n\ndanke für deine Geduld! Deine Bestellung {bestellnummer} wird gerade liebevoll verpackt und geht in den nächsten Tagen raus. Sobald sie unterwegs ist, bekommst du von uns eine Mail mit der Sendungsnummer."],
            ['Rücksendung', "Hallo {vorname},\n\nschade, dass der Duft nicht ganz deins ist. Du kannst ihn innerhalb von 14 Tagen nach Erhalt zurückschicken. Antworte einfach auf diese Mail, dann senden wir dir alle Infos zur Rücksendung."],
            ['Duftberatung', "Hallo {vorname},\n\nwie schön, dass du nach dem passenden Duft suchst! Erzähl uns gern, welche Düfte du bisher magst (z. B. frisch, holzig, süß, blumig) und zu welchem Anlass du ihn tragen möchtest – dann empfehlen wir dir zwei, drei Favoriten."],
            ['Entschuldigung (unzufrieden)', "Hallo {vorname},\n\nes tut uns wirklich leid, dass du mit deiner Bestellung {bestellnummer} nicht zufrieden bist. Das ist nicht unser Anspruch. Magst du uns kurz schreiben, was nicht gepasst hat? Wir finden gemeinsam eine Lösung – versprochen."],
            ['Danke für dein Feedback', "Hallo {vorname},\n\nvielen Dank für deine lieben Worte – das freut uns riesig! Als Club-Mitglied hast du übrigens gerade {punkte} Punkte."],
        ];
        $now = Util::now();
        foreach ($defaults as $i => [$title, $body]) {
            Db::insert('reply_templates', ['id' => Util::uuid(), 'title' => $title, 'body' => $body, 'position' => $i, 'created_by' => null, 'updated_by' => null, 'created_at' => $now, 'updated_at' => $now, 'deleted' => 0]);
        }
        Settings::set('templates_seeded', true);
    }

    // ---------- Signatur ----------

    /** Signatur einer Person (Standard: „Viele Grüße / Vorname“). */
    public static function signature(array $me): string
    {
        $sig = Auth::prefs($me)['signature'] ?? null;
        return is_string($sig) && trim($sig) !== '' ? trim($sig) : "Viele Grüße\n" . self::firstName($me['name']);
    }

    /** Fußzeile unter Antworten aus Team-Postfächern (Admins, Einstellungen → Vorlagen). */
    public static function footer(): string
    {
        $f = Settings::get('mail_footer');
        return is_string($f) ? trim($f) : "Perfume Cloud\nwww.perfumecloud.de";
    }

    public static function fromName(): string
    {
        $n = Settings::get('mail_from_name');
        return is_string($n) && trim($n) !== '' ? trim($n) : 'Perfume Cloud';
    }

    // ---------- Mail lesen ----------

    /** Mail, die diese Person sehen darf – sonst 404. */
    public static function mail(array $me, string $id): array
    {
        $mail = Db::one('SELECT * FROM emails WHERE id = ? AND deleted = 0', [$id]);
        if (!$mail || !MailJob::visibleTo($mail, $me['id'])) {
            throw new HttpError(404, 'Mail nicht gefunden.');
        }
        return $mail;
    }

    /** Ganze Mail zum Lesen (wird beim ersten Öffnen vom Mailserver geholt und 30 Tage gemerkt). */
    public static function message(array $me, string $id, bool $fresh = false): array
    {
        $mail = self::mail($me, $id);
        $cached = Db::one('SELECT * FROM email_bodies WHERE id = ?', [$id]);
        if (!$cached || $fresh) {
            $full = self::fetchFull($mail);
            $row = [
                'id' => $id,
                'headers' => Util::json($full['headers']),
                'body' => $full['text'],
                'attachments' => Util::json($full['attachments']),
                'fetched_at' => Util::now(),
            ];
            Db::upsert('email_bodies', $row);
            $cached = $row;
        }
        $headers = json_decode((string) $cached['headers'], true) ?: [];
        $text = (string) $cached['body'];
        return [
            'id' => $id,
            'text' => $text,
            'attachments' => json_decode((string) $cached['attachments'], true) ?: [],
            'to' => self::decodeList($headers['to'] ?? ''),
            'cc' => self::decodeList($headers['cc'] ?? ''),
            'reply_to' => self::replyTarget($mail, $headers),
            'date' => isset($headers['date']) ? (strtotime(preg_replace('/\s*\(.*\)$/', '', $headers['date'])) ?: null) : null,
            'order_number' => Customers::findOrderNumber($mail['subject'] . "\n" . mb_substr($text, 0, 4000)),
            'replies' => array_map(static fn ($r) => [
                'id' => $r['id'], 'to' => $r['to_email'], 'subject' => $r['subject'], 'user_id' => $r['user_id'], 'created_at' => (int) $r['created_at'],
            ], Db::all('SELECT * FROM replies WHERE email_id = ? ORDER BY created_at', [$id])),
            'signature' => self::signature($me),
            'footer' => self::isTeamBox($mail) ? self::footer() : '',
            // Bilder unter der Signatur (Vorschau beim Antworten)
            'signature_image' => Signature::dataUrl((string) $me['id']),
            'footer_image' => self::isTeamBox($mail) ? Signature::dataUrl('team') : null,
        ];
    }

    /** @return array{headers:array<string,string>, text:string, attachments:array} */
    private static function fetchFull(array $mail): array
    {
        $mb = MailJob::byAddress((string) $mail['mailbox']);
        $pw = $mb ? MailJob::password($mb['id']) : null;
        if (!$mb || $pw === null) {
            throw new HttpError(409, 'Das Postfach ' . $mail['mailbox'] . ' ist nicht mehr eingerichtet.');
        }
        $imap = new Imap($mb['host'], (int) $mb['port'], $mb['security']);
        try {
            $imap->connect();
            $imap->login($mb['user'], $pw);
            $validity = $imap->examine('INBOX');
            $uid = self::findUid($imap, $mail, $validity);
            if ($uid === null) {
                throw new HttpError(404, 'Die Mail liegt nicht mehr im Posteingang (gelöscht oder verschoben).');
            }
            $msg = $imap->fetch([$uid], 'UID BODY.PEEK[]<0.' . self::BODY_MAX . '>')[$uid] ?? null;
            $imap->logout();
        } catch (HttpError $e) {
            $imap->close();
            throw $e;
        } catch (\RuntimeException $e) {
            $imap->close();
            throw new HttpError(502, 'Mailserver: ' . $e->getMessage());
        }
        $raw = '';
        foreach ((array) $msg as $k => $v) {
            if (str_starts_with((string) $k, 'BODY[')) {
                $raw = (string) $v;
            }
        }
        if ($raw === '') {
            throw new HttpError(404, 'Die Mail konnte nicht geladen werden.');
        }
        $full = MailJob::parseFull($raw);
        $keep = [];
        foreach (['from', 'to', 'cc', 'reply-to', 'date', 'message-id', 'references', 'subject'] as $k) {
            if (isset($full['headers'][$k])) {
                $keep[$k] = mb_substr($full['headers'][$k], 0, 2000);
            }
        }
        return ['headers' => $keep, 'text' => mb_substr($full['text'], 0, 100000), 'attachments' => array_slice($full['attachments'], 0, 20)];
    }

    /** UID der Mail im Posteingang: gespeichert (gleiche UIDVALIDITY) oder per Message-ID gesucht. */
    public static function findUid(Imap $imap, array $mail, string $validity): ?int
    {
        if ($mail['imap_uid'] !== null && (string) $mail['imap_validity'] === $validity) {
            return (int) $mail['imap_uid'];
        }
        $mid = trim((string) $mail['message_id']);
        if ($mid === '') {
            return null;
        }
        $uids = $imap->search('HEADER Message-ID ' . Imap::quote($mid));
        return $uids ? max($uids) : null;
    }

    public static function decodeList(string $v): array
    {
        $out = [];
        foreach (preg_split('/,(?=(?:[^"]*"[^"]*")*[^"]*$)/', MailJob::decodeHeader($v)) ?: [] as $part) {
            [$name, $email] = MailJob::parseAddress($part);
            if ($email !== '') {
                $out[] = ['name' => $name, 'email' => $email];
            }
        }
        return $out;
    }

    private static function replyTarget(array $mail, array $headers): string
    {
        $rt = self::decodeList($headers['reply-to'] ?? '');
        return $rt[0]['email'] ?? (string) $mail['from_email'];
    }

    private static function isTeamBox(array $mail): bool
    {
        return !(MailJob::byAddress((string) $mail['mailbox'])['visible_to'] ?? []);
    }

    // ---------- Platzhalter ----------

    /**
     * Platzhalter füllen. Kundendaten werden nur geholt, wenn der Text sie braucht.
     * @return array{text:string, missing:string[]}
     */
    public static function fill(array $me, array $mail, string $text, ?string $orderNumber = null): array
    {
        preg_match_all('/\{([a-zäöü]+)\}/u', $text, $m);
        $used = array_values(array_unique(array_intersect($m[1], array_keys(self::PLACEHOLDERS))));
        if (!$used) {
            return ['text' => $text, 'missing' => []];
        }
        $vars = self::vars($me, $mail, $used, $orderNumber);
        $missing = [];
        foreach ($used as $k) {
            $v = trim((string) ($vars[$k] ?? ''));
            if ($v === '') {
                $missing[] = $k;
                // „Hallo {vorname},“ → „Hallo,“ statt „Hallo ,“
                $text = (string) preg_replace('/[ \t]?\{' . $k . '\}/u', '', $text);
                continue;
            }
            $text = str_replace('{' . $k . '}', $v, $text);
        }
        return ['text' => $text, 'missing' => $missing];
    }

    /** @param string[] $used */
    private static function vars(array $me, array $mail, array $used, ?string $orderNumber): array
    {
        $vars = ['meinname' => $me['name'], 'meinvorname' => self::firstName($me['name'])];
        $needsShop = (bool) array_diff($used, ['meinname', 'meinvorname', 'vorname', 'name']);
        $info = null;
        if ($needsShop || in_array('vorname', $used, true) || in_array('name', $used, true)) {
            try {
                $orderNumber ??= Customers::findOrderNumber($mail['subject'] . ' ' . $mail['snippet']);
                $info = Customers::lookup((string) $mail['from_email'], $orderNumber);
            } catch (\Throwable $e) {
                Util::log('Platzhalter: ' . $e->getMessage());
            }
        }
        $customer = $info['customer'] ?? null;
        $order = $info['mentioned'] ?? ($info['orders'][0] ?? null);
        $fromFirst = self::nameFromSender((string) ($mail['from_name'] ?? ''));
        $vars['vorname'] = ($customer['first_name'] ?? '') ?: (($order['first_name'] ?? '') ?: $fromFirst);
        $vars['name'] = ($customer['name'] ?? '') ?: trim((string) ($mail['from_name'] ?? ''));
        if ($order) {
            $t = $order['tracking'][0] ?? null;
            $vars['bestellnummer'] = $order['name'];
            $vars['versandstatus'] = mb_strtolower($order['status_label']) === 'versendet' ? 'versendet' : (str_starts_with($order['status_label'], 'Noch') ? 'noch nicht versendet' : mb_strtolower($order['status_label']));
            $vars['versanddienst'] = $t['company'] ?? '';
            $vars['sendungsnummer'] = $t['number'] ?? '';
            $vars['sendungslink'] = $t['url'] ?? '';
            $vars['artikel'] = implode(', ', array_map(static fn ($i) => $i['title'], $order['items']));
        }
        $club = $info['club'] ?? null;
        if (is_array($club) && !empty($club['member'])) {
            $vars['punkte'] = isset($club['points']['available']) ? number_format((int) $club['points']['available'], 0, ',', '.') : '';
            $vars['stufe'] = (string) ($club['tier']['name'] ?? '');
        }
        return $vars;
    }

    /** „Jürgen Müller“ → „Jürgen“; „info@…“, „Shop GmbH“ → '' */
    public static function nameFromSender(string $name): string
    {
        $name = trim(str_replace('"', '', $name));
        if ($name === '' || str_contains($name, '@')) {
            return '';
        }
        if (str_contains($name, ',')) {
            // „Müller, Jürgen“
            $parts = array_map('trim', explode(',', $name, 2));
            $name = $parts[1] !== '' ? $parts[1] : $parts[0];
        }
        $first = explode(' ', $name)[0];
        return preg_match('/^\p{Lu}[\p{L}\'-]{1,30}$/u', $first) && !preg_match('/^(GmbH|Team|Shop|Service|Support|Info)$/i', $first) ? $first : '';
    }

    private static function firstName(string $name): string
    {
        return explode(' ', trim($name))[0] ?? $name;
    }

    // ---------- Antworten ----------

    /**
     * Antwort vorbereiten (Vorschau), an mich testen oder verschicken.
     * $in: text, template_id?, quote (bool), done (bool), mode: preview | test | send
     */
    public static function reply(array $me, string $id, array $in): array
    {
        $mail = self::mail($me, $id);
        $mode = Util::oneOf($in['mode'] ?? 'preview', ['preview', 'test', 'send'], 'preview');
        $text = trim(str_replace("\r\n", "\n", (string) ($in['text'] ?? '')));
        if ($text === '') {
            throw new HttpError(422, 'Bitte einen Text schreiben.');
        }
        if (mb_strlen($text) > 20000) {
            throw new HttpError(422, 'Der Text ist zu lang.');
        }
        $msg = self::message($me, $id);
        $filled = self::fill($me, $mail, $text, $msg['order_number']);
        // Signatur (Text + Bild) und bei Team-Postfächern die Fußzeile des Teams
        $sig = Signature::block($me, self::isTeamBox($mail));
        $body = $filled['text'] . ($sig['text'] !== '' ? "\n\n" . $sig['text'] : '');
        $quote = !empty($in['quote']) ? self::quote($mail, $msg) : '';
        if ($quote !== '') {
            $body .= "\n\n" . $quote;
        }
        $html = Signature::mailHtml($filled['text'], $sig['html'], $quote);
        $subject = (string) $mail['subject'];
        if (!preg_match('/^(re|aw|antw|wg)\s*:/i', $subject)) {
            $subject = 'Re: ' . $subject;
        }
        $to = $msg['reply_to'];
        $mb = MailJob::byAddress((string) $mail['mailbox']);
        if (!$mb || MailJob::password($mb['id']) === null) {
            throw new HttpError(409, 'Für ' . $mail['mailbox'] . ' ist kein Passwort hinterlegt – Antworten geht nur mit eingerichtetem Postfach.');
        }
        $from = Mailer::fromAddress($mb);
        $fromName = $mb['visible_to'] ? $me['name'] : self::fromName();
        $preview = ['from' => "$fromName <$from>", 'to' => $to, 'subject' => $subject, 'text' => $body, 'missing' => $filled['missing'], 'images' => count($sig['inline'])];
        if ($mode === 'preview') {
            return $preview;
        }

        $cached = Db::one('SELECT headers FROM email_bodies WHERE id = ?', [$id]);
        $h = json_decode((string) ($cached['headers'] ?? ''), true) ?: [];
        $origId = trim((string) ($h['message-id'] ?? '')) ?: (string) $mail['message_id'];
        $refs = trim(((string) ($h['references'] ?? '')) . ' ' . $origId);

        if ($mode === 'test') {
            $data = Mailer::compose([
                'from' => $from, 'fromName' => $fromName, 'to' => $me['email'],
                'subject' => '[TEST] ' . $subject,
                'text' => "Testmail – so käme die Antwort bei $to an:\n" . str_repeat('–', 40) . "\n\n" . $body,
                'html' => str_replace('<body style="margin:0;padding:0">', '<body style="margin:0;padding:0"><p style="font-family:sans-serif;font-size:13px;color:#80562F;margin:0 0 14px">Testmail – so käme die Antwort bei ' . htmlspecialchars($to) . ' an:</p>', $html),
                'inline' => $sig['inline'],
            ]);
            try {
                Mailer::deliver($mb, $me['email'], $data);
            } catch (\Throwable $e) {
                throw new HttpError(502, 'Versand fehlgeschlagen: ' . $e->getMessage());
            }
            return $preview + ['sent' => true, 'message' => 'Testmail an ' . $me['email'] . ' verschickt (über ' . $from . ').'];
        }

        $host = explode('@', $from)[1] ?? 'perfumecloud.de';
        $messageId = '<' . bin2hex(random_bytes(12)) . "@$host>";
        $data = Mailer::compose([
            'from' => $from, 'fromName' => $fromName, 'to' => $to, 'subject' => $subject, 'text' => $body,
            'html' => $html, 'inline' => $sig['inline'],
            'messageId' => $messageId,
            'headers' => $origId !== '' ? ['In-Reply-To' => $origId, 'References' => mb_substr($refs, -1900)] : [],
        ]);
        try {
            Mailer::deliver($mb, $to, $data);
        } catch (\Throwable $e) {
            Util::log('Antwort: ' . $e->getMessage());
            throw new HttpError(502, 'Versand fehlgeschlagen: ' . $e->getMessage());
        }

        $warnings = self::afterSend($mb, $mail, $data);
        $now = max(Util::now(), (int) $mail['updated_at'] + 1);
        $row = ['answered' => 1, 'answered_at' => $now, 'replied_by' => $me['id'], 'important' => 0, 'reasons' => null, 'score' => 0, 'seen' => 1, 'updated_at' => $now];
        if (!empty($in['done'])) {
            $row += ['status' => 'done', 'done_by' => $me['id'], 'done_at' => $now];
        }
        Db::update('emails', $row, ['id' => $id]);
        Db::insert('replies', [
            'id' => Util::uuid(), 'email_id' => $id, 'mailbox' => $mail['mailbox'], 'to_email' => mb_substr($to, 0, 255),
            'subject' => mb_substr($subject, 0, 500), 'user_id' => $me['id'],
            'template_id' => Util::isUuid($in['template_id'] ?? null) ? $in['template_id'] : null, 'created_at' => $now,
        ]);
        if (self::isTeamBox($mail)) {
            Activity::log($me['id'], 'mail_replied', 'email', $id, 'hat „' . mb_substr((string) $mail['subject'], 0, 80) . '“ beantwortet');
        }
        return $preview + [
            'sent' => true,
            'message' => 'Antwort an ' . $to . ' verschickt.',
            'warnings' => $warnings,
            'email' => Sync::email(Db::one('SELECT * FROM emails WHERE id = ?', [$id])),
        ];
    }

    /** Kopie in „Gesendet“ und Original als beantwortet markieren. Fehler hier sind nur Hinweise. */
    private static function afterSend(array $mb, array $mail, string $data): array
    {
        $warnings = [];
        $imap = new Imap($mb['host'], (int) $mb['port'], $mb['security']);
        try {
            $imap->connect();
            $imap->login($mb['user'], (string) MailJob::password($mb['id']));
            $sent = MailJob::findSentFolder($imap);
            if ($sent) {
                try {
                    $imap->append($sent, $data);
                } catch (\RuntimeException $e) {
                    $warnings[] = 'Kopie in „Gesendet“ fehlgeschlagen: ' . $e->getMessage();
                }
            } else {
                $warnings[] = 'Kein Ordner „Gesendet“ gefunden – die Antwort liegt nur beim Empfänger.';
            }
            $validity = $imap->select('INBOX');
            $uid = self::findUid($imap, $mail, $validity);
            if ($uid !== null) {
                $imap->storeFlags([$uid], '\\Answered \\Seen');
            }
            $imap->logout();
        } catch (\Throwable $e) {
            $imap->close();
            $warnings[] = 'Postfach nach dem Versand nicht erreichbar: ' . $e->getMessage();
        }
        return $warnings;
    }

    private static function quote(array $mail, array $msg): string
    {
        $when = $msg['date'] ?? intdiv((int) $mail['received_at'], 1000);
        $who = trim(($mail['from_name'] ? $mail['from_name'] . ' ' : '') . '<' . $mail['from_email'] . '>');
        $lines = preg_split('/\n/', mb_substr($msg['text'], 0, 8000)) ?: [];
        return 'Am ' . date('d.m.Y', $when) . ' um ' . date('H:i', $when) . " schrieb $who:\n"
            . implode("\n", array_map(static fn ($l) => '> ' . $l, $lines));
    }
}
