<?php
declare(strict_types=1);

namespace PC;

/**
 * Holt Mails aus den Team-Postfächern (info@, support@) und den persönlichen Postfächern
 * (z. B. marius.heub@) und markiert die wichtigen offenen.
 *
 * Jedes Postfach hat „Sichtbar für“: alle oder nur bestimmte Personen. Nur wer ein Postfach
 * sehen darf, bekommt seine Mails in der App und die Push-Nachrichten dazu.
 * Newsletter und automatische Mails werden gespeichert, aber markiert (auto = 1) und nie als wichtig gezählt.
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

    /**
     * Alle eingerichteten Postfächer (Team und persönliche).
     * visible_to = [] → für alle sichtbar, sonst nur für diese Personen (User-IDs).
     *
     * @return array<int, array{id:string,email:string,label:string,host:string,port:int,security:string,user:string,visible_to:string[]}>
     */
    public static function mailboxes(): array
    {
        $list = Settings::get('mailboxes', []);
        if (!is_array($list)) {
            return [];
        }
        $out = [];
        foreach ($list as $m) {
            if (!is_array($m) || empty($m['host']) || empty($m['email'])) {
                continue;
            }
            $m['visible_to'] = array_values(array_unique(array_filter((array) ($m['visible_to'] ?? []), 'is_string')));
            $out[] = $m;
        }
        return $out;
    }

    /** Postfächer, die diese Person sehen darf. */
    public static function visibleMailboxes(string $userId): array
    {
        return array_values(array_filter(self::mailboxes(), static fn ($m) => !$m['visible_to'] || in_array($userId, $m['visible_to'], true)));
    }

    /** @return string[] Adressen der Postfächer, die diese Person sehen darf. */
    public static function visibleAddresses(string $userId): array
    {
        return array_column(self::visibleMailboxes($userId), 'email');
    }

    public static function byAddress(string $address): ?array
    {
        foreach (self::mailboxes() as $m) {
            if ($m['email'] === $address) {
                return $m;
            }
        }
        return null;
    }

    public static function byId(string $id): ?array
    {
        foreach (self::mailboxes() as $m) {
            if ($m['id'] === $id) {
                return $m;
            }
        }
        return null;
    }

    /**
     * IMAP-Server, Port und Verschlüsselung aus der Eingabe. Versteht auch Schreibweisen wie
     * „imaps://mxf9a2.netcup.net“, „mxf9a2.netcup.net:993“ oder „{mxf9a2.netcup.net:993/imap/ssl}INBOX“ (PHP-IMAP).
     * Port 993 = SSL/TLS, Port 143 = STARTTLS.
     * @return array{host:string, port:int, security:string}
     */
    public static function server(mixed $host, mixed $port, mixed $security): array
    {
        $h = trim((string) ($host ?? ''));
        $p = (int) ($port ?? 0);
        $sec = Util::oneOf($security, ['ssl', 'starttls'], 'ssl');
        if (preg_match('/^\{([^}:\/]+)(?::(\d+))?([^}]*)\}/', $h, $m)) {
            $h = $m[1];
            $p = ($m[2] ?? '') !== '' ? (int) $m[2] : $p;
            $flags = strtolower($m[3] ?? '');
            $sec = str_contains($flags, '/ssl') ? 'ssl' : (str_contains($flags, '/tls') ? 'starttls' : $sec);
        } else {
            $h = (string) preg_replace('#^[a-z]+://#i', '', $h);
            $h = explode('/', $h)[0];
            if (preg_match('/^(.+):(\d+)$/', $h, $m)) {
                $h = $m[1];
                $p = (int) $m[2];
            }
        }
        $h = strtolower(trim($h, " .\t"));
        if ($h !== '' && !preg_match('/^[a-z0-9.-]+$/', $h)) {
            throw new HttpError(422, 'Ungültiger Servername: ' . $h . ' – z. B. mxf9a2.netcup.net');
        }
        $p = $p > 0 && $p < 65536 ? $p : 993;
        if ($p === 993) {
            $sec = 'ssl';
        } elseif ($p === 143) {
            $sec = 'starttls';
        }
        return ['host' => $h, 'port' => $p, 'security' => $sec];
    }

    /** Darf diese Person die Mail sehen? Entscheidet die Einstellung „Sichtbar für“ des Postfachs. */
    public static function visibleTo(array $mail, string $userId): bool
    {
        return in_array($mail['mailbox'], self::visibleAddresses($userId), true);
    }

    /** Persönliches Postfach = nur für diese eine Person sichtbar. */
    public static function personal(string $userId): ?array
    {
        foreach (self::mailboxes() as $m) {
            if ($m['visible_to'] === [$userId]) {
                return $m;
            }
        }
        return null;
    }

    public static function password(string $id): ?string
    {
        return Settings::getSecret('mailbox_pw_' . $id);
    }

    /**
     * Speichert die Postfächer (Admin); leeres Passwort bedeutet „unverändert lassen“.
     * Wird ein Postfach für weitere Personen sichtbar, bekommen sie seine Mails beim nächsten Abgleich.
     */
    public static function save(array $input): array
    {
        $existing = [];
        foreach (self::mailboxes() as $m) {
            $existing[$m['id']] = $m;
        }
        $userIds = array_column(Db::all('SELECT id FROM users WHERE deleted = 0'), 'id');
        $list = [];
        $seen = [];
        foreach (array_slice($input, 0, 12) as $m) {
            if (!is_array($m)) {
                continue;
            }
            $email = mb_strtolower(trim((string) ($m['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new HttpError(422, 'Ungültige E-Mail-Adresse: ' . $email);
            }
            if (isset($seen[$email])) {
                throw new HttpError(422, $email . ' ist doppelt eingetragen.');
            }
            $seen[$email] = true;
            $id = isset($m['id']) && isset($existing[$m['id']]) ? $m['id'] : substr(sha1($email . random_bytes(4)), 0, 12);
            $visible = array_values(array_unique(array_intersect(array_filter((array) ($m['visible_to'] ?? []), 'is_string'), $userIds)));
            $server = self::server(Util::str($m['host'] ?? '', 190, false), $m['port'] ?? 993, $m['security'] ?? 'ssl');
            $entry = [
                'id' => $id,
                'email' => $email,
                'label' => Util::str($m['label'] ?? null, 40) ?? explode('@', $email)[0],
                'host' => $server['host'],
                'port' => $server['port'],
                'security' => $server['security'],
                'user' => Util::str($m['user'] ?? $email, 190, false) ?: $email,
                'visible_to' => $visible,
                'added_by' => $existing[$id]['added_by'] ?? null,
            ];
            if ($entry['host'] === '') {
                throw new HttpError(422, 'Bitte den IMAP-Server für ' . $email . ' angeben.');
            }
            if (!empty($m['password'])) {
                Settings::setSecret('mailbox_pw_' . $id, (string) $m['password']);
            } elseif (!self::password($id)) {
                throw new HttpError(422, 'Bitte das Passwort für ' . $email . ' eingeben.');
            }
            $old = $existing[$id] ?? null;
            if ($old && $old['email'] !== $email) {
                self::hideMails($old['email']);
            } elseif ($old && $old['visible_to'] !== $visible) {
                // Neu berechtigte Personen sollen die vorhandenen Mails beim nächsten Abgleich bekommen
                Db::exec('UPDATE emails SET updated_at = ? WHERE mailbox = ? AND deleted = 0', [Util::now(), $email]);
            }
            $list[] = $entry;
        }
        foreach ($existing as $id => $old) {
            if (!in_array($id, array_column($list, 'id'), true)) {
                self::forget($old);
            }
        }
        Settings::set('mailboxes', $list);
        return self::mailboxes();
    }

    /** Eigenes Postfach anlegen oder ändern (jede Person für sich, nur für sie sichtbar). */
    public static function savePersonal(array $me, array $m): array
    {
        $email = mb_strtolower(trim((string) ($m['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Bitte eine gültige E-Mail-Adresse angeben.');
        }
        $old = self::personal($me['id']);
        $taken = self::byAddress($email);
        if ($taken && (!$old || $taken['id'] !== $old['id'])) {
            throw new HttpError(422, $taken['visible_to']
                ? 'Dieses Postfach ist schon eingetragen.'
                : $email . ' ist ein Team-Postfach und wird schon für alle abgerufen.');
        }
        $host = Util::str($m['host'] ?? '', 190, false) ?: ($old['host'] ?? (self::mailboxes()[0]['host'] ?? ''));
        $server = self::server($host, $m['port'] ?? 993, $m['security'] ?? 'ssl');
        if ($server['host'] === '') {
            throw new HttpError(422, 'Bitte den IMAP-Server angeben.');
        }
        $entry = [
            'id' => $old['id'] ?? substr(sha1($me['id'] . $email . random_bytes(4)), 0, 12),
            'email' => $email,
            'label' => explode('@', $email)[0],
            'host' => $server['host'],
            'port' => $server['port'],
            'security' => $server['security'],
            'user' => Util::str($m['user'] ?? '', 190, false) ?: $email,
            'visible_to' => [$me['id']],
            'added_by' => $old['added_by'] ?? $me['id'],
        ];
        if (!empty($m['password'])) {
            Settings::setSecret('mailbox_pw_' . $entry['id'], (string) $m['password']);
        } elseif (!self::password($entry['id'])) {
            throw new HttpError(422, 'Bitte das Passwort des Postfachs eingeben.');
        }
        if ($old && $old['email'] !== $email) {
            self::hideMails($old['email']);
            Settings::delete('mail_init_' . $entry['id']);
        }
        $list = array_values(array_filter(Settings::get('mailboxes', []) ?: [], static fn ($x) => ($x['id'] ?? '') !== $entry['id']));
        $list[] = $entry;
        Settings::set('mailboxes', $list);
        return self::byAddress($email) ?? $entry;
    }

    /** Entfernt das persönliche Postfach dieser Person (z. B. beim Austritt) und blendet seine Mails aus. */
    public static function removePersonal(string $userId): void
    {
        $list = Settings::get('mailboxes', []) ?: [];
        $keep = [];
        foreach (self::mailboxes() as $m) {
            if ($m['visible_to'] === [$userId]) {
                self::forget($m);
                continue;
            }
            // Aus geteilten Postfächern nur die Person austragen
            $m['visible_to'] = array_values(array_diff($m['visible_to'], [$userId]));
            $keep[] = $m;
        }
        if (count($keep) !== count($list) || $keep !== $list) {
            Settings::set('mailboxes', $keep);
        }
    }

    /** Passwort, Status und Mails eines entfernten Postfachs löschen bzw. ausblenden. */
    private static function forget(array $m): void
    {
        foreach (['mailbox_pw_', 'mail_status_', 'mail_init_'] as $prefix) {
            Settings::delete($prefix . $m['id']);
        }
        self::hideMails($m['email']);
    }

    private static function hideMails(string $address): void
    {
        Db::exec(
            'UPDATE emails SET deleted = 1, subject = NULL, snippet = NULL, from_name = NULL, from_email = NULL, updated_at = ? WHERE mailbox = ?',
            [Util::now(), $address]
        );
    }

    /** Version 1.1 speicherte persönliche Postfächer getrennt – in die gemeinsame Liste übernehmen. */
    public static function migrateLegacy(): void
    {
        $rows = Db::all("SELECT k FROM settings WHERE k LIKE 'mailbox_user_%'");
        if (!$rows) {
            return;
        }
        $list = Settings::get('mailboxes', []) ?: [];
        foreach ($rows as $r) {
            $userId = substr($r['k'], strlen('mailbox_user_'));
            $m = Settings::get($r['k']);
            if (is_array($m) && !empty($m['email']) && !in_array($m['email'], array_column($list, 'email'), true)) {
                $list[] = $m + ['visible_to' => [$userId], 'added_by' => $userId];
            }
            Settings::delete($r['k']);
        }
        Settings::set('mailboxes', $list);
    }

    // ---------- Abruf ----------

    public static function run(): array
    {
        $summary = [];
        foreach (self::mailboxes() as $mb) {
            try {
                $summary[$mb['email']] = self::fetchMailbox($mb, self::ownAddresses($mb));
                Settings::set('mail_status_' . $mb['id'], ['ok' => true, 'at' => Util::now(), 'message' => 'OK']);
            } catch (\Throwable $e) {
                $summary[$mb['email']] = 'Fehler: ' . $e->getMessage();
                Settings::set('mail_status_' . $mb['id'], ['ok' => false, 'at' => Util::now(), 'message' => $e->getMessage()]);
                // Bleibt auch nach dem nächsten erfolgreichen Abruf sichtbar (Einstellungen → Postfächer)
                Settings::set('mail_last_error', ['at' => Util::now(), 'mailbox' => $mb['email'], 'message' => $e->getMessage()]);
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
                foreach ($imap->fetch($sentUids, 'UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (IN-REPLY-TO REFERENCES DATE)]') as $msg) {
                    $raw = (string) self::firstWithPrefix($msg, 'BODY[HEADER');
                    $h = self::parseHeaders($raw);
                    // Zeitpunkt der Antwort (für die Antwortzeit im Wochenrückblick)
                    $at = self::parseDate((string) ($msg['INTERNALDATE'] ?? ''), $h['date'] ?? '');
                    if (preg_match_all('/<[^<>\s]+>/', ($h['in-reply-to'] ?? '') . ' ' . ($h['references'] ?? ''), $m)) {
                        foreach ($m[0] as $mid) {
                            $mid = strtolower($mid);
                            $replied[$mid] = min($replied[$mid] ?? PHP_INT_MAX, $at);
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
        ['new' => $new, 'important' => $important, 'ids' => $seenIds] = self::store($mb, $own, $validity, $messages, $replied, $initial, $now);
        if ($uids) {
            self::rememberUid($mb, $validity, max($uids));
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


    /**
     * Abgerufene Mails speichern bzw. aktualisieren und neu einstufen.
     * @param array<int, array<string, mixed>> $messages nach UID (aus Imap::fetch)
     * @param array<string, int>|null $replied Message-IDs mit Antwort im Gesendet-Ordner → Zeitpunkt der Antwort (null = nicht geprüft)
     * @return array{new:int, important:int, ids:string[]}
     */
    private static function store(array $mb, array $own, string $validity, array $messages, ?array $replied, bool $initial, int $now): array
    {
        $seenIds = [];
        $new = 0;
        $important = 0;

        foreach ($messages as $uid => $msg) {
            $headers = self::parseHeaders((string) self::firstWithPrefix($msg, 'BODY[HEADER'));
            [$fromName, $fromEmail] = self::parseAddress(self::decodeHeader($headers['from'] ?? ''));
            if ($fromEmail === '' || in_array($fromEmail, $own, true)) {
                continue;
            }
            $auto = self::isAutomated($headers, $fromEmail);
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
            $old = Db::one('SELECT * FROM emails WHERE id = ?', [$id]);
            if ($replied === null && $old && (int) $old['answered'] === 1) {
                $mail['answered'] = 1; // Antwort im Gesendet-Ordner bleibt bekannt
            }
            // Wann wurde geantwortet? Aus dem Gesendet-Ordner, sonst: jetzt bemerkt (bei der ersten Abfrage unbekannt)
            $answeredAt = $old['answered_at'] ?? null;
            if ($mail['answered'] && $answeredAt === null) {
                $sentAt = $messageId !== '' ? ($replied[$messageId] ?? null) : null;
                if ($sentAt !== null && $sentAt >= $receivedAt) {
                    $answeredAt = $sentAt;
                } elseif ($old && !(int) $old['answered'] && !$initial) {
                    $answeredAt = $now;
                }
            }
            $c = $auto ? ['important' => false, 'reasons' => [], 'score' => 0] : self::classify($mail, $now);
            $mail['important'] = $c['important'] ? 1 : 0;
            $mail['reasons'] = implode('|', $c['reasons']) ?: null;
            $mail['score'] = $c['score'];
            $mail['auto'] = $auto ? 1 : 0;

            if (!$old) {
                try {
                    Db::insert('emails', $mail + [
                        'id' => $id,
                        'mailbox' => $mb['email'],
                        'message_id' => mb_substr($messageId, 0, 255) ?: null,
                        'from_name' => mb_substr($fromName, 0, 255) ?: null,
                        'from_email' => mb_substr($fromEmail, 0, 255),
                        'status' => 'open',
                        'notified' => $initial ? 2 : 0,
                        'imap_uid' => (int) $uid,
                        'imap_validity' => $validity,
                        'answered_at' => $answeredAt,
                        'created_at' => $now,
                        'updated_at' => $now,
                        'deleted' => 0,
                    ]);
                    $new++;
                } catch (\PDOException) {
                    // Gleichzeitig von einem anderen Abruf eingetragen – dann ist sie schon da
                }
            } else {
                $changed = (int) $old['deleted'] === 1 || $old['imap_uid'] === null || (string) $old['answered_at'] !== (string) $answeredAt;
                foreach (['seen', 'flagged', 'answered', 'important', 'reasons', 'score', 'snippet', 'auto'] as $k) {
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
                        'auto' => $mail['auto'],
                        'imap_uid' => (int) $uid,
                        'imap_validity' => $validity,
                        'answered_at' => $answeredAt,
                        'deleted' => 0,
                        'updated_at' => max($now, (int) $old['updated_at'] + 1),
                    ], ['id' => $id]);
                }
            }
            if ($mail['important'] && !$mail['answered']) {
                $important++;
            }
        }

        return ['new' => $new, 'important' => $important, 'ids' => $seenIds];
    }

    /** Team-Postfächer: Mails vom eigenen Team ausblenden. Persönliche: nur Mails von sich selbst. */
    public static function ownAddresses(array $mb): array
    {
        return $mb['visible_to'] ? [$mb['email']] : array_column(self::mailboxes(), 'email');
    }

    /** Höchste bekannte UID im Posteingang merken (für den Sofort-Abruf, auch über Neustarts hinweg). */
    public static function rememberUid(array $mb, string $validity, int $uid): void
    {
        $old = Settings::get('mail_uid_' . $mb['id']);
        if (!is_array($old) || ($old['v'] ?? '') !== $validity || (int) ($old['uid'] ?? 0) < $uid) {
            Settings::set('mail_uid_' . $mb['id'], ['v' => $validity, 'uid' => $uid]);
        }
    }

    /** Zuletzt bekannte UID, falls sie zur UIDVALIDITY passt (sonst null). */
    public static function knownUid(array $mb, string $validity): ?int
    {
        $old = Settings::get('mail_uid_' . $mb['id']);
        return is_array($old) && ($old['v'] ?? '') === $validity ? (int) ($old['uid'] ?? 0) : null;
    }

    /**
     * Sofort-Abruf: nur Mails mit UID > $afterUid holen – auf einer bestehenden Verbindung,
     * deren Posteingang schon (schreibgeschützt) geöffnet ist. Gibt die höchste UID und die Zahl neuer Mails zurück.
     * @return array{uid:int, new:int}
     */
    public static function fetchNew(Imap $imap, array $mb, string $validity, int $afterUid): array
    {
        // „UID n:*“ liefert laut RFC immer mindestens die höchste UID – darum selbst filtern
        $uids = array_values(array_filter($imap->search('UID ' . ($afterUid + 1) . ':*'), static fn ($u) => $u > $afterUid));
        if (!$uids) {
            return ['uid' => $afterUid, 'new' => 0];
        }
        $uids = array_slice($uids, -50); // Rest übernimmt der vollständige Abgleich
        $messages = $imap->fetch($uids, 'UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (' . self::HEADER_FIELDS . ')] BODY.PEEK[TEXT]<0.6000>');
        $initial = !Settings::get('mail_init_' . $mb['id']);
        $res = self::store($mb, self::ownAddresses($mb), $validity, $messages, null, $initial, Util::now());
        $max = max($uids);
        self::rememberUid($mb, $validity, $max);
        return ['uid' => $max, 'new' => $res['new']];
    }

    /**
     * Push für jede neue Mail: Team-Mails an alle, persönliche nur an den Besitzer.
     * Wer in den Einstellungen „Nur wichtige“ gewählt hat, bekommt nur wichtige.
     * Schon gelesene oder beantwortete Mails lösen keinen Push aus.
     * @return array<int, array> die Mails, die jetzt gemeldet wurden
     */
    public static function notify(): array
    {
        if (Notify::quietHours()) {
            return []; // bleiben offen und kommen morgens gesammelt
        }
        $now = Util::now();
        // Jede Mail wird genau einmal gemeldet, auch wenn zwei Abrufe gleichzeitig laufen
        $fresh = array_values(array_filter(
            Db::all('SELECT * FROM emails WHERE deleted = 0 AND notified = 0 ORDER BY received_at'),
            static fn ($m) => Db::exec('UPDATE emails SET notified = 1 WHERE id = ? AND notified = 0', [$m['id']]) === 1
        ));
        $users = Db::all('SELECT * FROM users WHERE deleted = 0');
        if ($fresh) {
            $plan = self::pushPlan($fresh, $users, $now);
            foreach ($users as $u) {
                $mine = $plan[$u['id']] ?? [];
                if (count($mine) > 3) {
                    Notify::toUser($u, [
                        'title' => count($mine) . ' neue Mails',
                        'body' => implode(' · ', array_map(static fn ($m) => self::sender($m) . ': ' . $m['subject'], array_slice($mine, 0, 3))),
                        'url' => '/postfach',
                        'tag' => 'mail-summary',
                    ]);
                    continue;
                }
                foreach ($mine as $m) {
                    Notify::toUser($u, [
                        'title' => self::sender($m) . ' · ' . explode('@', (string) $m['mailbox'])[0] . '@',
                        'body' => (string) $m['subject'],
                        'url' => (self::byAddress((string) $m['mailbox'])['visible_to'] ?? []) ? '/postfach?box=' . rawurlencode((string) $m['mailbox']) : '/postfach',
                        'tag' => 'mail-' . $m['id'],
                    ]);
                }
            }
        }

        // Erinnerung: wichtige Mails seit über 24 Std. unbeantwortet
        $stale = Db::all(
            "SELECT * FROM emails WHERE deleted = 0 AND important = 1 AND answered = 0 AND status = 'open' AND notified = 1 AND received_at < ?",
            [$now - 24 * 3600 * 1000]
        );
        if ($stale) {
            foreach ($users as $u) {
                if (empty(Auth::prefs($u)['push']['mail'])) {
                    continue;
                }
                $mine = array_values(array_filter($stale, static fn ($m) => self::visibleTo($m, $u['id'])));
                if (!$mine) {
                    continue;
                }
                Notify::toUser($u, [
                    'title' => count($mine) === 1 ? 'Seit über 24 Std. unbeantwortet' : count($mine) . ' Mails seit über 24 Std. unbeantwortet',
                    'body' => implode(' · ', array_map(static fn ($m) => (string) $m['subject'], array_slice($mine, 0, 3))),
                    'url' => '/postfach',
                    'tag' => 'mail-stale',
                ]);
            }
            $ids = array_column($stale, 'id');
            Db::exec('UPDATE emails SET notified = 2 WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
        }
        return $fresh;
    }

    /**
     * Wer bekommt für welche neuen Mails einen Push?
     * Nur wer das Postfach sehen darf („Sichtbar für“). Je nach Einstellung der Person:
     *   all        – jede neue ungelesene Mail (ohne Newsletter/automatische)
     *   everything – wirklich jede neue Mail, auch Newsletter, automatische und schon gelesene
     *   important  – nur wichtige
     * Immer nur unbeantwortete, offene Mails der letzten 12 Stunden.
     *
     * @return array<string, array<int, array>> userId => Mails
     */
    public static function pushPlan(array $mails, array $users, int $now): array
    {
        $recent = array_filter($mails, static fn ($m) =>
            !(int) $m['deleted'] && !(int) $m['answered'] && $m['status'] === 'open'
            && (int) $m['received_at'] >= $now - 12 * 3600 * 1000);
        $plan = [];
        foreach ($users as $u) {
            $prefs = Auth::prefs($u);
            if (empty($prefs['push']['mail'])) {
                continue;
            }
            $scope = $prefs['mailScope'] ?? 'all';
            $mine = array_values(array_filter($recent, static function ($m) use ($scope, $u) {
                if (!self::visibleTo($m, $u['id'])) {
                    return false;
                }
                $auto = (int) ($m['auto'] ?? 0);
                return match ($scope) {
                    'everything' => true,
                    'important' => (int) $m['important'] && !(int) $m['seen'],
                    default => !$auto && !(int) $m['seen'],
                };
            }));
            if ($mine) {
                $plan[$u['id']] = $mine;
            }
        }
        return $plan;
    }

    private static function sender(array $m): string
    {
        return (string) ($m['from_name'] ?: $m['from_email']);
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

    /**
     * Vollständige Mail (Kopf + Inhalt) zerlegen: Kopfzeilen, lesbarer Text und Namen der Anhänge.
     * @return array{headers:array<string,string>, text:string, attachments:array<int, array{name:string, size:int}>}
     */
    public static function parseFull(string $raw): array
    {
        $split = preg_split("/\r?\n\r?\n/", $raw, 2);
        $headers = self::parseHeaders($split[0] ?? '');
        $body = $split[1] ?? '';
        $text = self::extractText($headers['content-type'] ?? 'text/plain', $headers['content-transfer-encoding'] ?? '', $body, 0);
        $text = trim((string) preg_replace("/\n{3,}/", "\n\n", str_replace(["\r\n", "\r"], "\n", $text)));
        $attachments = [];
        if (preg_match_all('/Content-Disposition:\s*(?:attachment|inline)[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/i', $body, $m)) {
            foreach ($m[0] as $disp) {
                $disp = (string) preg_replace("/\r?\n[ \t]+/", ' ', $disp);
                if (preg_match('/filename\*?=(?:"([^"]+)"|([^;\s]+))/i', $disp, $f)) {
                    $name = self::decodeHeader(rawurldecode((string) preg_replace("/^[a-z0-9-]+''/i", '', $f[1] !== '' ? $f[1] : $f[2])));
                    $attachments[] = ['name' => mb_substr($name, 0, 120), 'size' => 0];
                }
            }
        }
        return ['headers' => $headers, 'text' => $text, 'attachments' => $attachments];
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
