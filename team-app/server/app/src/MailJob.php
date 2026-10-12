<?php
declare(strict_types=1);

namespace PC;

/**
 * Holt Mails aus info@ / support@ und markiert die wichtigen offenen.
 *
 * Offen   = nicht beantwortet (\Answered oder Antwort im Gesendet-Ordner) und in der App nicht erledigt.
 * Wichtig = offen UND (ungelesen ODER markiert ODER Kundenanliegen ODER > 24 h ohne Antwort).
 * Newsletter, automatische Mails, No-Reply und Shopify-Systemmails werden ignoriert.
 */
final class MailJob
{
    private const WINDOW_DAYS = 14;
    private const MAX_PER_MAILBOX = 300;
    private const HEADER_FIELDS = 'FROM REPLY-TO SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING AUTO-SUBMITTED PRECEDENCE LIST-UNSUBSCRIBE LIST-ID X-AUTO-RESPONSE-SUPPRESS';

    private const CUSTOMER_PATTERN = '/(bestell|order|liefer|versand|sendung|paket|tracking|retour|rücksend|rueck|zurücksend|umtausch|reklamation|beschwerde|defekt|kaputt|ausgelaufen|beschädigt|falsch|fehlt|erstatt|storn|zahlung|bezahl|rechnung|refund|return|shipping|delivery|problem|hilfe|frage|anfrage|dringend|urgent|#\s?\d{4,})/iu';
    private const AUTO_SENDER = '/(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?@|newsletter|news@|marketing@)/i';
    private const SYSTEM_DOMAINS = '/@([a-z0-9-]+\.)*(shopify\.com|shopifyemail\.com|myshopify\.com|paypal\.(de|com)|stripe\.com|klarna\.(de|com)|google\.com|facebookmail\.com|instagram\.com|linkedin\.com|netcup\.(de|net|com))$/i';

    // ---------- Konfiguration ----------

    /** @return array<int, array{id:string,email:string,label:string,host:string,port:int,security:string,user:string}> */
    public static function mailboxes(): array
    {
        $list = Settings::get('mailboxes', []);
        return is_array($list) ? array_values(array_filter($list, static fn ($m) => !empty($m['host']) && !empty($m['email']))) : [];
    }

    public static function password(string $id): ?string
    {
        return Settings::getSecret('mailbox_pw_' . $id);
    }

    /** Speichert die Postfächer; leeres Passwort bedeutet „unverändert lassen“. */
    public static function save(array $input): array
    {
        $existing = [];
        foreach (self::mailboxes() as $m) {
            $existing[$m['id']] = $m;
        }
        $list = [];
        foreach (array_slice($input, 0, 6) as $m) {
            if (!is_array($m)) {
                continue;
            }
            $email = mb_strtolower(trim((string) ($m['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new HttpError(422, 'Ungültige E-Mail-Adresse: ' . $email);
            }
            $id = isset($m['id']) && isset($existing[$m['id']]) ? $m['id'] : substr(sha1($email . random_bytes(4)), 0, 12);
            $entry = [
                'id' => $id,
                'email' => $email,
                'label' => Util::str($m['label'] ?? null, 40) ?? explode('@', $email)[0],
                'host' => Util::str($m['host'] ?? '', 190, false),
                'port' => (int) ($m['port'] ?? 993) ?: 993,
                'security' => Util::oneOf($m['security'] ?? 'ssl', ['ssl', 'starttls'], 'ssl'),
                'user' => Util::str($m['user'] ?? $email, 190, false) ?: $email,
            ];
            if ($entry['host'] === '') {
                throw new HttpError(422, 'Bitte den IMAP-Server für ' . $email . ' angeben.');
            }
            $list[] = $entry;
            if (!empty($m['password'])) {
                Settings::setSecret('mailbox_pw_' . $id, (string) $m['password']);
            }
        }
        foreach (array_keys($existing) as $id) {
            if (!in_array($id, array_column($list, 'id'), true)) {
                Settings::delete('mailbox_pw_' . $id);
            }
        }
        Settings::set('mailboxes', $list);
        return $list;
    }

    public static function test(array $mb): array
    {
        $pw = self::password($mb['id']);
        if (!$pw) {
            return ['ok' => false, 'message' => 'Passwort fehlt.'];
        }
        try {
            $imap = new Imap($mb['host'], (int) $mb['port'], $mb['security']);
            $imap->connect();
            $imap->login($mb['user'], $pw);
            $imap->examine('INBOX');
            $count = count($imap->search('SINCE ' . date('d-M-Y', time() - self::WINDOW_DAYS * 86400)));
            $sent = self::findSentFolder($imap);
            $imap->logout();
            return ['ok' => true, 'message' => "Verbunden · $count Mails der letzten 14 Tage" . ($sent ? " · Gesendet-Ordner: $sent" : '')];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        }
    }

    // ---------- Abruf ----------

    public static function run(): array
    {
        $summary = [];
        $own = array_map(static fn ($m) => $m['email'], self::mailboxes());
        foreach (self::mailboxes() as $mb) {
            try {
                $summary[$mb['email']] = self::fetchMailbox($mb, $own);
                Settings::set('mail_status_' . $mb['id'], ['ok' => true, 'at' => Util::now(), 'message' => 'OK']);
            } catch (\Throwable $e) {
                $summary[$mb['email']] = 'Fehler: ' . $e->getMessage();
                Settings::set('mail_status_' . $mb['id'], ['ok' => false, 'at' => Util::now(), 'message' => $e->getMessage()]);
                Util::log('Mail ' . $mb['email'] . ': ' . $e->getMessage());
            }
        }
        Settings::set('mail_last_fetch', Util::now());
        self::notify();
        return $summary;
    }

    private static function fetchMailbox(array $mb, array $own): string
    {
        $pw = self::password($mb['id']);
        if (!$pw) {
            throw new \RuntimeException('Passwort fehlt.');
        }
        $sinceTs = time() - self::WINDOW_DAYS * 86400;
        $since = date('d-M-Y', $sinceTs);

        $imap = new Imap($mb['host'], (int) $mb['port'], $mb['security']);
        $imap->connect();
        $imap->login($mb['user'], $pw);

        // Antworten im Gesendet-Ordner finden
        $replied = [];
        $sentFolder = self::findSentFolder($imap);
        if ($sentFolder) {
            $imap->examine($sentFolder);
            $sentUids = array_slice($imap->search("SINCE $since"), -self::MAX_PER_MAILBOX);
            if ($sentUids) {
                foreach ($imap->fetch($sentUids, 'UID BODY.PEEK[HEADER.FIELDS (IN-REPLY-TO REFERENCES)]') as $msg) {
                    $raw = self::firstWithPrefix($msg, 'BODY[HEADER');
                    if (preg_match_all('/<[^<>\s]+>/', (string) $raw, $m)) {
                        foreach ($m[0] as $mid) {
                            $replied[strtolower($mid)] = true;
                        }
                    }
                }
            }
        }

        $validity = $imap->examine('INBOX');
        $uids = array_slice($imap->search("SINCE $since"), -self::MAX_PER_MAILBOX);
        $messages = $uids ? $imap->fetch($uids, 'UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (' . self::HEADER_FIELDS . ')] BODY.PEEK[TEXT]<0.6000>') : [];
        $imap->logout();

        $initial = !Settings::get('mail_init_' . $mb['id']);
        $now = Util::now();
        $seenIds = [];
        $new = 0;
        $important = 0;

        foreach ($messages as $uid => $msg) {
            $headers = self::parseHeaders((string) self::firstWithPrefix($msg, 'BODY[HEADER'));
            [$fromName, $fromEmail] = self::parseAddress(self::decodeHeader($headers['from'] ?? ''));
            if ($fromEmail === '' || in_array($fromEmail, $own, true) || self::isAutomated($headers, $fromEmail)) {
                continue;
            }
            $id = substr(sha1($mb['email'] . '|' . $validity . '|' . $uid), 0, 40);
            $seenIds[] = $id;

            $flags = array_map('strtolower', is_array($msg['FLAGS'] ?? null) ? $msg['FLAGS'] : []);
            $messageId = strtolower(trim((string) ($headers['message-id'] ?? '')));
            $receivedAt = self::parseDate((string) ($msg['INTERNALDATE'] ?? ''), $headers['date'] ?? '');
            $subject = self::decodeHeader($headers['subject'] ?? '');
            $mail = [
                'subject' => mb_substr($subject !== '' ? $subject : '(kein Betreff)', 0, 500),
                'seen' => in_array('\\seen', $flags, true) ? 1 : 0,
                'flagged' => in_array('\\flagged', $flags, true) ? 1 : 0,
                'answered' => (in_array('\\answered', $flags, true) || ($messageId !== '' && isset($replied[$messageId]))) ? 1 : 0,
                'received_at' => $receivedAt,
                'snippet' => self::snippet($headers, (string) self::firstWithPrefix($msg, 'BODY[TEXT]')),
            ];
            $c = self::classify($mail, $now);
            $mail['important'] = $c['important'] ? 1 : 0;
            $mail['reasons'] = implode('|', $c['reasons']) ?: null;
            $mail['score'] = $c['score'];

            $old = Db::one('SELECT * FROM emails WHERE id = ?', [$id]);
            if (!$old) {
                Db::insert('emails', $mail + [
                    'id' => $id,
                    'mailbox' => $mb['email'],
                    'message_id' => mb_substr($messageId, 0, 255) ?: null,
                    'from_name' => mb_substr($fromName, 0, 255) ?: null,
                    'from_email' => mb_substr($fromEmail, 0, 255),
                    'status' => 'open',
                    'notified' => $initial ? 2 : 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                    'deleted' => 0,
                ]);
                $new++;
            } else {
                $changed = (int) $old['deleted'] === 1;
                foreach (['seen', 'flagged', 'answered', 'important', 'reasons', 'score', 'snippet'] as $k) {
                    if ((string) $old[$k] !== (string) $mail[$k]) {
                        $changed = true;
                    }
                }
                if ($changed) {
                    Db::update('emails', [
                        'seen' => $mail['seen'],
                        'flagged' => $mail['flagged'],
                        'answered' => $mail['answered'],
                        'important' => $mail['important'],
                        'reasons' => $mail['reasons'],
                        'score' => $mail['score'],
                        'snippet' => $mail['snippet'],
                        'deleted' => 0,
                        'updated_at' => max($now, (int) $old['updated_at'] + 1),
                    ], ['id' => $id]);
                }
            }
            if ($mail['important'] && !$mail['answered']) {
                $important++;
            }
        }

        // Mails, die im Postfach gelöscht oder verschoben wurden, aus der App entfernen
        $rows = Db::all('SELECT id FROM emails WHERE mailbox = ? AND deleted = 0 AND received_at >= ?', [$mb['email'], $sinceTs * 1000]);
        foreach ($rows as $r) {
            if (!in_array($r['id'], $seenIds, true)) {
                Db::update('emails', ['deleted' => 1, 'updated_at' => $now], ['id' => $r['id']]);
            }
        }

        if ($initial) {
            Settings::set('mail_init_' . $mb['id'], true);
        }
        return count($messages) . " geprüft, $new neu, $important wichtig offen";
    }

    private static function notify(): void
    {
        if (Notify::quietHours()) {
            return;
        }
        $fresh = Db::all("SELECT * FROM emails WHERE deleted = 0 AND important = 1 AND answered = 0 AND status = 'open' AND notified = 0 ORDER BY received_at");
        if ($fresh) {
            if (count($fresh) <= 2) {
                foreach ($fresh as $m) {
                    Notify::users(null, 'mail', [
                        'title' => ($m['from_name'] ?: $m['from_email']) . ' · ' . explode('@', $m['mailbox'])[0] . '@',
                        'body' => (string) $m['subject'],
                        'url' => '/postfach',
                        'tag' => 'mail-' . $m['id'],
                    ]);
                }
            } else {
                Notify::users(null, 'mail', [
                    'title' => count($fresh) . ' neue wichtige Mails',
                    'body' => implode(' · ', array_map(static fn ($m) => (string) $m['subject'], array_slice($fresh, 0, 3))),
                    'url' => '/postfach',
                    'tag' => 'mail-summary',
                ]);
            }
            $ids = array_column($fresh, 'id');
            Db::exec('UPDATE emails SET notified = 1 WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
        }

        $stale = Db::all(
            "SELECT * FROM emails WHERE deleted = 0 AND answered = 0 AND status = 'open' AND notified = 1 AND received_at < ?",
            [Util::now() - 24 * 3600 * 1000]
        );
        if ($stale) {
            Notify::users(null, 'mail', [
                'title' => count($stale) === 1 ? 'Seit über 24 Std. unbeantwortet' : count($stale) . ' Mails seit über 24 Std. unbeantwortet',
                'body' => implode(' · ', array_map(static fn ($m) => (string) $m['subject'], array_slice($stale, 0, 3))),
                'url' => '/postfach',
                'tag' => 'mail-stale',
            ]);
            $ids = array_column($stale, 'id');
            Db::exec('UPDATE emails SET notified = 2 WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
        }
    }

    // ---------- Bewertung ----------

    /** @return array{important:bool, reasons:string[], score:int} */
    public static function classify(array $mail, int $now): array
    {
        $reasons = [];
        $score = 0;
        $text = $mail['subject'] . ' ' . $mail['snippet'];
        if ($mail['flagged']) {
            $reasons[] = 'Markiert';
            $score += 4;
        }
        if (preg_match(self::CUSTOMER_PATTERN, $text)) {
            $reasons[] = 'Kundenanliegen';
            $score += 3;
        }
        if (!$mail['seen']) {
            $reasons[] = 'Ungelesen';
            $score += 1;
        }
        $ageH = ($now - $mail['received_at']) / 3600000;
        if ($ageH > 24) {
            $reasons[] = $ageH > 48 ? 'Über 2 Tage offen' : 'Über 24 Std. offen';
            $score += $ageH > 48 ? 3 : 2;
        }
        $important = !$mail['answered'] && $reasons !== [];
        return ['important' => $important, 'reasons' => $reasons, 'score' => $important ? $score : 0];
    }

    public static function isAutomated(array $h, string $fromEmail): bool
    {
        $auto = strtolower(trim((string) ($h['auto-submitted'] ?? 'no')));
        $prec = strtolower(trim((string) ($h['precedence'] ?? '')));
        return ($auto !== '' && $auto !== 'no')
            || in_array($prec, ['bulk', 'list', 'junk'], true)
            || isset($h['list-unsubscribe'])
            || isset($h['list-id'])
            || isset($h['x-auto-response-suppress'])
            || (bool) preg_match(self::AUTO_SENDER, $fromEmail)
            || (bool) preg_match(self::SYSTEM_DOMAINS, $fromEmail);
    }

    // ---------- Hilfsfunktionen zum Zerlegen von Mails ----------

    public static function findSentFolder(Imap $imap): ?string
    {
        $folders = $imap->listFolders();
        foreach ($folders as $f) {
            if (in_array('\\sent', array_map('strtolower', $f['flags']), true)) {
                return $f['name'];
            }
        }
        foreach ($folders as $f) {
            if (preg_match('/(^|[.\/])(sent|sent items|sent messages|gesendet|gesendete objekte|gesendete elemente)$/i', $f['name'])) {
                return $f['name'];
            }
        }
        return null;
    }

    private static function firstWithPrefix(array $msg, string $prefix): mixed
    {
        foreach ($msg as $k => $v) {
            if (str_starts_with((string) $k, $prefix)) {
                return $v;
            }
        }
        return null;
    }

    /** @return array<string,string> Kopfzeilen in Kleinbuchstaben */
    public static function parseHeaders(string $raw): array
    {
        $raw = preg_replace("/\r?\n[ \t]+/", ' ', $raw);
        $out = [];
        foreach (preg_split("/\r?\n/", (string) $raw) as $line) {
            $p = strpos($line, ':');
            if ($p === false || $p === 0) {
                continue;
            }
            $name = strtolower(trim(substr($line, 0, $p)));
            if (!isset($out[$name])) {
                $out[$name] = trim(substr($line, $p + 1));
            }
        }
        return $out;
    }

    /** RFC 2047: =?utf-8?B?...?= und =?iso-8859-1?Q?...?= dekodieren. */
    public static function decodeHeader(string $v): string
    {
        if (!str_contains($v, '=?')) {
            return self::toUtf8($v, 'UTF-8');
        }
        $re = '/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/';
        $out = '';
        $pos = 0;
        $pendingCharset = null;
        $pendingBytes = '';
        $flush = static function () use (&$out, &$pendingCharset, &$pendingBytes): void {
            if ($pendingCharset !== null) {
                $out .= self::toUtf8($pendingBytes, $pendingCharset);
                $pendingCharset = null;
                $pendingBytes = '';
            }
        };
        while (preg_match($re, $v, $m, PREG_OFFSET_CAPTURE, $pos)) {
            $start = $m[0][1];
            $between = substr($v, $pos, $start - $pos);
            if ($pendingCharset === null || trim($between) !== '') {
                $flush();
                $out .= self::toUtf8($between, 'UTF-8');
            }
            $charset = strtolower(explode('*', $m[1][0])[0]);
            $bytes = strtoupper($m[2][0]) === 'B'
                ? (string) base64_decode($m[3][0])
                : quoted_printable_decode(str_replace('_', ' ', $m[3][0]));
            if ($pendingCharset !== null && $pendingCharset !== $charset) {
                $flush();
            }
            $pendingCharset = $charset;
            $pendingBytes .= $bytes;
            $pos = $start + strlen($m[0][0]);
        }
        $flush();
        $out .= self::toUtf8(substr($v, $pos), 'UTF-8');
        return trim($out);
    }

    /** @return array{0:string,1:string} [Name, E-Mail] */
    public static function parseAddress(string $v): array
    {
        if (preg_match('/^\s*"?(.*?)"?\s*<([^<>]+)>/s', $v, $m)) {
            return [trim(str_replace('\\"', '"', $m[1])), strtolower(trim($m[2]))];
        }
        if (preg_match('/[^\s<>"]+@[^\s<>"]+/', $v, $m)) {
            return ['', strtolower($m[0])];
        }
        return ['', ''];
    }

    public static function parseDate(string $internal, string $header): int
    {
        foreach ([trim($internal), trim($header)] as $candidate) {
            if ($candidate === '') {
                continue;
            }
            $ts = strtotime(preg_replace('/\s*\(.*\)$/', '', $candidate));
            if ($ts !== false) {
                return $ts * 1000;
            }
        }
        return Util::now();
    }

    public static function snippet(array $headers, string $body): string
    {
        $text = self::extractText($headers['content-type'] ?? 'text/plain', $headers['content-transfer-encoding'] ?? '', $body, 0);
        $lines = [];
        foreach (preg_split("/\r?\n/", $text) as $line) {
            $t = trim($line);
            if (str_starts_with($t, '>')) {
                continue;
            }
            if (preg_match('/^(am|on) .{5,80}(schrieb|wrote).{0,40}:$/iu', $t)) {
                break; // zitierte Vorgeschichte
            }
            if ($t === '--' || $t === '-- ') {
                break; // Signatur
            }
            $lines[] = $t;
        }
        $text = trim((string) preg_replace('/\s+/u', ' ', implode(' ', $lines)));
        return mb_substr($text, 0, 280);
    }

    private static function extractText(string $ct, string $cte, string $body, int $depth): string
    {
        $type = strtolower(trim(explode(';', $ct)[0]));
        if (str_starts_with($type, 'multipart/')) {
            if ($depth > 3 || !preg_match('/boundary\s*=\s*"?([^";]+)"?/i', $ct, $m)) {
                return '';
            }
            $html = '';
            foreach (explode('--' . trim($m[1]), $body) as $part) {
                $part = ltrim($part, "\r\n");
                if ($part === '' || str_starts_with($part, '--')) {
                    continue;
                }
                $split = preg_split("/\r?\n\r?\n/", $part, 2);
                if (count($split) < 2) {
                    continue;
                }
                $ph = self::parseHeaders($split[0]);
                $pct = $ph['content-type'] ?? 'text/plain';
                $ptype = strtolower(trim(explode(';', $pct)[0]));
                if ($ptype === 'text/plain' || str_starts_with($ptype, 'multipart/')) {
                    $t = self::extractText($pct, $ph['content-transfer-encoding'] ?? '', $split[1], $depth + 1);
                    if (trim($t) !== '') {
                        return $t;
                    }
                } elseif ($ptype === 'text/html' && $html === '') {
                    $html = self::extractText($pct, $ph['content-transfer-encoding'] ?? '', $split[1], $depth + 1);
                }
            }
            return $html;
        }
        if ($type !== '' && !str_starts_with($type, 'text/')) {
            return '';
        }
        $enc = strtolower(trim($cte));
        if ($enc === 'base64') {
            $clean = preg_replace('/[^A-Za-z0-9+\/=]/', '', $body);
            $clean = substr($clean, 0, intdiv(strlen($clean), 4) * 4);
            $decoded = (string) base64_decode($clean);
        } elseif ($enc === 'quoted-printable') {
            $decoded = quoted_printable_decode($body);
        } else {
            $decoded = $body;
        }
        $charset = preg_match('/charset\s*=\s*"?([^";\s]+)"?/i', $ct, $m) ? $m[1] : 'UTF-8';
        $decoded = self::toUtf8($decoded, $charset);
        if ($type === 'text/html') {
            $decoded = preg_replace('#<(style|script|head)[^>]*>.*?</\1>#is', ' ', $decoded);
            $decoded = preg_replace('#<(br|/p|/div|/tr|/li|/h\d)[^>]*>#i', "\n", (string) $decoded);
            $decoded = html_entity_decode(strip_tags((string) $decoded), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
        return (string) $decoded;
    }

    public static function toUtf8(string $s, string $charset): string
    {
        $cs = strtolower(trim($charset, " \"'"));
        if ($cs === '' || $cs === 'utf-8' || $cs === 'utf8' || $cs === 'us-ascii') {
            return mb_scrub($s, 'UTF-8');
        }
        try {
            return mb_convert_encoding($s, 'UTF-8', $cs === 'iso-8859-1' || $cs === 'latin1' ? 'Windows-1252' : $charset);
        } catch (\ValueError) {
            return mb_scrub($s, 'UTF-8');
        }
    }
}
