<?php
declare(strict_types=1);

namespace PC;

/**
 * Ordner eines Postfachs wie in Outlook – direkt auf dem Mailserver (IMAP). Was hier angelegt oder
 * verschoben wird, sieht man genauso in Outlook, auf dem iPhone und im Webmail, und umgekehrt.
 * Dazu „Gesendet“ (der Ordner, in den auch die Antworten aus der App kommen).
 * Die Liste in der App kommt live vom Server; gespeichert wird nur die Ordnerliste (5 Minuten).
 */
final class MailFolders
{
    private const PAGE = 40;
    private const SEARCH_MAX = 500;
    private const BODY_MAX = 400000;
    private const CACHE_MS = 300000;
    private const SPECIAL_FLAGS = ['\\sent' => 'sent', '\\drafts' => 'drafts', '\\trash' => 'trash', '\\junk' => 'junk', '\\archive' => 'archive'];
    private const SPECIAL_NAMES = [
        'sent' => '/^(sent|sent items|sent messages|gesendet|gesendete objekte|gesendete elemente)$/i',
        'drafts' => '/^(drafts|entw(ü|ue)rfe)$/iu',
        'trash' => '/^(trash|deleted items|deleted messages|papierkorb|gelöschte (elemente|objekte))$/iu',
        'junk' => '/^(junk|spam|junk-e-mail|junk e-mail|junk-mail)$/i',
        'archive' => '/^(archive|archiv)$/i',
    ];
    public const LABELS = ['inbox' => 'Posteingang', 'sent' => 'Gesendet', 'drafts' => 'Entwürfe', 'archive' => 'Archiv', 'junk' => 'Spam', 'trash' => 'Papierkorb'];
    private const ORDER = ['inbox' => 0, 'sent' => 1, 'drafts' => 2, 'archive' => 3, 'junk' => 4, 'trash' => 5];

    // ---------- Zugriff ----------

    /** Postfach, das diese Person sehen darf und dessen Passwort hinterlegt ist. */
    public static function box(array $me, string $address): array
    {
        $address = mb_strtolower(trim($address));
        $mb = MailJob::byAddress($address);
        if (!$mb || !in_array($mb['email'], MailJob::visibleAddresses($me['id']), true)) {
            throw new HttpError(404, 'Postfach nicht gefunden.');
        }
        if (MailJob::password($mb['id']) === null) {
            throw new HttpError(409, 'Für ' . $mb['email'] . ' ist kein Passwort hinterlegt.');
        }
        return $mb;
    }

    /** Verbindung öffnen, $fn ausführen, sauber schließen; Serverfehler als verständliche Meldung. */
    private static function with(array $mb, callable $fn): mixed
    {
        $imap = new Imap($mb['host'], (int) $mb['port'], $mb['security']);
        try {
            $imap->connect();
            $imap->login($mb['user'], (string) MailJob::password($mb['id']));
            $out = $fn($imap);
            $imap->logout();
            return $out;
        } catch (HttpError $e) {
            $imap->close();
            throw $e;
        } catch (\RuntimeException $e) {
            $imap->close();
            throw new HttpError(502, 'Mailserver: ' . preg_replace('/^IMAP:\s*/', '', $e->getMessage()));
        }
    }

    // ---------- Ordnerliste ----------

    /**
     * Ordner als flache Liste in Baumreihenfolge (depth für die Einrückung).
     * @return array{box:string, delimiter:string, folders:array<int, array<string, mixed>>, sent:?string, at:int}
     */
    public static function folders(array $me, string $address, bool $fresh = false): array
    {
        $mb = self::box($me, $address);
        $cached = Settings::get('mail_folders_' . $mb['id']);
        if (!$fresh && is_array($cached) && ($cached['at'] ?? 0) > Util::now() - self::CACHE_MS) {
            return $cached;
        }
        $out = self::with($mb, static fn (Imap $imap) => self::read($imap)) + ['box' => $mb['email'], 'at' => Util::now()];
        Settings::set('mail_folders_' . $mb['id'], $out);
        return $out;
    }

    private static function forget(array $mb): void
    {
        Settings::delete('mail_folders_' . $mb['id']);
    }

    /** @return array{delimiter:string, prefix:string, folders:array<int, array<string, mixed>>, sent:?string} */
    private static function read(Imap $imap): array
    {
        $raw = $imap->listFolders();
        $delim = '';
        foreach ($raw as $f) {
            if ($f['delim'] !== '') {
                $delim = $f['delim'];
                break;
            }
        }
        $ns = $imap->personalNamespace();
        $prefix = $ns[0] ?? '';
        $byPath = [];
        foreach ($raw as $f) {
            $flags = array_map('strtolower', $f['flags']);
            if (in_array('\\nonexistent', $flags, true)) {
                continue;
            }
            $path = $f['name'];
            $isInbox = strcasecmp($path, 'INBOX') === 0;
            $segments = $delim !== '' ? explode($delim, $path) : [$path];
            $leaf = Imap::decodeFolder((string) end($segments));
            $special = $isInbox ? 'inbox' : null;
            foreach (self::SPECIAL_FLAGS as $flag => $kind) {
                if (!$special && in_array($flag, $flags, true)) {
                    $special = $kind;
                }
            }
            if (!$special) {
                // Ohne Kennzeichnung: am Namen erkennen (nur oberste Ebene bzw. direkt unter INBOX)
                $top = count($segments) === 1 || (count($segments) === 2 && strcasecmp($segments[0], 'INBOX') === 0);
                foreach (self::SPECIAL_NAMES as $kind => $re) {
                    if ($top && preg_match($re, $leaf)) {
                        $special = $kind;
                        break;
                    }
                }
            }
            $parent = $delim !== '' && count($segments) > 1 ? implode($delim, array_slice($segments, 0, -1)) : null;
            $byPath[$path] = [
                'path' => $path,
                'name' => $special && $special !== 'inbox' && count($segments) <= 2 ? self::LABELS[$special] : ($isInbox ? self::LABELS['inbox'] : $leaf),
                'parent' => $parent,
                'special' => $special,
                'selectable' => !in_array('\\noselect', $flags, true),
            ];
        }
        // Gleiche Art nur einmal hervorheben (z. B. zwei „Sent“-Ordner): die mit Kennzeichnung gewinnt
        $seen = [];
        foreach ($byPath as $path => $f) {
            if ($f['special'] && $f['special'] !== 'inbox') {
                if (isset($seen[$f['special']])) {
                    $byPath[$path]['special'] = null;
                    $byPath[$path]['name'] = Imap::decodeFolder((string) (($delim !== '' ? array_slice(explode($delim, $path), -1) : [$path])[0]));
                } else {
                    $seen[$f['special']] = $path;
                }
            }
        }
        // Eltern, die der Server nicht eigens listet, ergänzen
        foreach (array_values($byPath) as $f) {
            $p = $f['parent'];
            while ($p !== null && !isset($byPath[$p])) {
                $segs = explode($delim, $p);
                $byPath[$p] = ['path' => $p, 'name' => Imap::decodeFolder((string) end($segs)), 'parent' => count($segs) > 1 ? implode($delim, array_slice($segs, 0, -1)) : null, 'special' => null, 'selectable' => false];
                $p = $byPath[$p]['parent'];
            }
        }
        // Baum aufbauen: Posteingang, Gesendet, … zuerst, dann alphabetisch; Kinder direkt unter ihren Eltern
        $children = [];
        foreach ($byPath as $f) {
            $children[$f['parent'] ?? ''][] = $f;
        }
        $sort = static function (array $a, array $b): int {
            $oa = self::ORDER[$a['special'] ?? ''] ?? 9;
            $ob = self::ORDER[$b['special'] ?? ''] ?? 9;
            return $oa <=> $ob ?: strnatcasecmp($a['name'], $b['name']);
        };
        $list = [];
        $walk = static function (string $parent, int $depth) use (&$walk, &$list, $children, $sort): void {
            $kids = $children[$parent] ?? [];
            usort($kids, $sort);
            foreach ($kids as $k) {
                $list[] = $k + ['depth' => $depth, 'children' => count($children[$k['path']] ?? [])];
                $walk($k['path'], $depth + 1);
            }
        };
        $walk('', 0);
        return ['delimiter' => $delim, 'prefix' => $prefix, 'folders' => $list, 'sent' => $seen['sent'] ?? null];
    }

    /** Ordner muss es geben (schützt vor beliebigen Pfaden). */
    private static function folder(array $me, array $mb, string $path): array
    {
        foreach ([false, true] as $fresh) {
            foreach (self::folders($me, $mb['email'], $fresh)['folders'] as $f) {
                if ($f['path'] === $path) {
                    return $f;
                }
            }
        }
        throw new HttpError(404, 'Den Ordner gibt es nicht mehr.');
    }

    // ---------- Mails in einem Ordner ----------

    /** Mails eines Ordners, neueste zuerst, seitenweise; $q sucht in Absender, Empfänger und Betreff. */
    public static function messages(array $me, string $address, string $path, int $page = 1, string $q = ''): array
    {
        $mb = self::box($me, $address);
        $f = self::folder($me, $mb, $path);
        if (!$f['selectable']) {
            throw new HttpError(422, 'Dieser Ordner enthält nur Unterordner.');
        }
        $q = mb_strtolower(trim($q));
        $page = max(1, $page);
        return self::with($mb, static function (Imap $imap) use ($path, $page, $q, $f, $mb) {
            $imap->examine($path);
            $uids = array_reverse($imap->search('ALL'));
            if ($q !== '') {
                $hits = [];
                $heads = $imap->fetch(array_slice($uids, 0, self::SEARCH_MAX), 'UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT)]');
                foreach ($uids as $uid) {
                    $raw = '';
                    foreach ($heads[$uid] ?? [] as $k => $v) {
                        if (str_starts_with((string) $k, 'BODY[')) {
                            $raw = (string) $v;
                        }
                    }
                    $h = MailJob::parseHeaders($raw);
                    $hay = mb_strtolower(MailJob::decodeHeader(($h['from'] ?? '') . ' ' . ($h['to'] ?? '') . ' ' . ($h['subject'] ?? '')));
                    if ($raw !== '' && str_contains($hay, $q)) {
                        $hits[] = $uid;
                    }
                }
                $uids = $hits;
            }
            $total = count($uids);
            $slice = array_slice($uids, ($page - 1) * self::PAGE, self::PAGE);
            $rows = $slice ? $imap->fetch($slice, 'UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.4000>') : [];
            $out = [];
            foreach ($slice as $uid) {
                $m = $rows[$uid] ?? null;
                if (!$m) {
                    continue;
                }
                $head = '';
                $text = '';
                foreach ($m as $k => $v) {
                    if (str_starts_with((string) $k, 'BODY[HEADER')) {
                        $head = (string) $v;
                    } elseif (str_starts_with((string) $k, 'BODY[TEXT')) {
                        $text = (string) $v;
                    }
                }
                $h = MailJob::parseHeaders($head);
                [$fromName, $fromEmail] = MailJob::parseAddress(MailJob::decodeHeader($h['from'] ?? ''));
                $flags = array_map('strtolower', is_array($m['FLAGS'] ?? null) ? $m['FLAGS'] : []);
                $subject = MailJob::decodeHeader($h['subject'] ?? '');
                $out[] = [
                    'uid' => $uid,
                    'from_name' => $fromName,
                    'from_email' => $fromEmail,
                    'to' => Replies::decodeList($h['to'] ?? ''),
                    'subject' => $subject !== '' ? $subject : '(kein Betreff)',
                    'date' => MailJob::parseDate((string) ($m['INTERNALDATE'] ?? ''), $h['date'] ?? ''),
                    'snippet' => MailJob::snippet($h, $text),
                    'seen' => in_array('\\seen', $flags, true),
                    'flagged' => in_array('\\flagged', $flags, true),
                    'answered' => in_array('\\answered', $flags, true),
                ];
            }
            return [
                'box' => $mb['email'],
                'folder' => $f,
                'total' => $total,
                'page' => $page,
                'pages' => max(1, (int) ceil($total / self::PAGE)),
                'messages' => $out,
            ];
        });
    }

    /** Eine Mail aus einem Ordner ganz lesen. */
    public static function message(array $me, string $address, string $path, int $uid): array
    {
        $mb = self::box($me, $address);
        self::folder($me, $mb, $path);
        return self::with($mb, static function (Imap $imap) use ($path, $uid) {
            $imap->examine($path);
            $msg = $imap->fetch([$uid], 'UID FLAGS BODY.PEEK[]<0.' . self::BODY_MAX . '>')[$uid] ?? null;
            $raw = '';
            foreach ((array) $msg as $k => $v) {
                if (str_starts_with((string) $k, 'BODY[')) {
                    $raw = (string) $v;
                }
            }
            if ($raw === '') {
                throw new HttpError(404, 'Die Mail liegt nicht mehr in diesem Ordner.');
            }
            $full = MailJob::parseFull($raw);
            $h = $full['headers'];
            [$fromName, $fromEmail] = MailJob::parseAddress(MailJob::decodeHeader($h['from'] ?? ''));
            $subject = MailJob::decodeHeader($h['subject'] ?? '');
            return [
                'uid' => $uid,
                'from_name' => $fromName,
                'from_email' => $fromEmail,
                'to' => Replies::decodeList($h['to'] ?? ''),
                'cc' => Replies::decodeList($h['cc'] ?? ''),
                'subject' => $subject !== '' ? $subject : '(kein Betreff)',
                'date' => isset($h['date']) ? ((strtotime((string) preg_replace('/\s*\(.*\)$/', '', $h['date'])) ?: 0) * 1000) : null,
                'text' => $full['text'],
                'attachments' => $full['attachments'],
            ];
        });
    }

    // ---------- Ordner anlegen, umbenennen, löschen ----------

    private static function cleanName(mixed $name, string $delim): string
    {
        $n = trim((string) preg_replace('/\s+/u', ' ', (string) $name));
        if ($n === '' || mb_strlen($n) > 60) {
            throw new HttpError(422, 'Bitte einen Ordnernamen mit höchstens 60 Zeichen eingeben.');
        }
        if (preg_match('/[\x00-\x1f*%"\\\\]/u', $n) || ($delim !== '' && str_contains($n, $delim)) || str_starts_with($n, '.')) {
            throw new HttpError(422, 'Der Ordnername darf keine Zeichen wie ' . ($delim !== '' ? "„{$delim}“, " : '') . '„*“, „%“ oder Anführungszeichen enthalten.');
        }
        if (strcasecmp($n, 'INBOX') === 0) {
            throw new HttpError(422, 'Diesen Namen hat schon der Posteingang.');
        }
        return $n;
    }

    /** Neuer Ordner; $parent = Pfad des Elternordners oder null (oberste Ebene). */
    public static function create(array $me, string $address, ?string $parent, mixed $name): array
    {
        $mb = self::box($me, $address);
        $list = self::folders($me, $address, true);
        $delim = $list['delimiter'];
        $n = self::cleanName($name, $delim);
        if ($parent !== null && $parent !== '') {
            $p = self::folder($me, $mb, $parent);
            if ($delim === '') {
                throw new HttpError(422, 'Dieser Mailserver kennt keine Unterordner.');
            }
            $path = $p['path'] . $delim . Imap::encodeFolder($n);
        } else {
            // Liegen alle Ordner unter INBOX (z. B. „INBOX.“ bei netcup), kommt der neue auch dorthin
            $path = $list['prefix'] . Imap::encodeFolder($n);
        }
        foreach ($list['folders'] as $f) {
            if (strcasecmp($f['path'], $path) === 0) {
                throw new HttpError(409, 'Einen Ordner „' . $n . '“ gibt es hier schon.');
            }
        }
        self::with($mb, static fn (Imap $imap) => $imap->createFolder($path));
        self::forget($mb);
        self::log($me, $mb, 'hat in ' . $mb['email'] . ' den Ordner „' . $n . '“ angelegt');
        return ['created' => $path] + self::folders($me, $address, true);
    }

    public static function rename(array $me, string $address, string $path, mixed $name): array
    {
        $mb = self::box($me, $address);
        $f = self::folder($me, $mb, $path);
        if ($f['special']) {
            throw new HttpError(422, '„' . $f['name'] . '“ lässt sich nicht umbenennen.');
        }
        $list = self::folders($me, $address);
        $n = self::cleanName($name, $list['delimiter']);
        $to = ($f['parent'] !== null ? $f['parent'] . $list['delimiter'] : $list['prefix']) . Imap::encodeFolder($n);
        if ($to === $path) {
            return self::folders($me, $address);
        }
        foreach ($list['folders'] as $x) {
            if (strcasecmp($x['path'], $to) === 0) {
                throw new HttpError(409, 'Einen Ordner „' . $n . '“ gibt es hier schon.');
            }
        }
        self::with($mb, static fn (Imap $imap) => $imap->renameFolder($path, $to));
        self::forget($mb);
        return ['renamed' => $to] + self::folders($me, $address, true);
    }

    /** Nur leere Ordner ohne Unterordner – damit nie versehentlich Mails verschwinden. */
    public static function delete(array $me, string $address, string $path): array
    {
        $mb = self::box($me, $address);
        $f = self::folder($me, $mb, $path);
        if ($f['special']) {
            throw new HttpError(422, '„' . $f['name'] . '“ lässt sich nicht löschen.');
        }
        if ($f['children'] > 0) {
            throw new HttpError(409, 'Der Ordner hat noch Unterordner – bitte erst diese löschen oder verschieben.');
        }
        self::with($mb, static function (Imap $imap) use ($path, $f) {
            if ($f['selectable']) {
                $imap->examine($path);
                if ($imap->exists > 0) {
                    throw new HttpError(409, 'Im Ordner liegen noch ' . $imap->exists . ' Mails – bitte erst verschieben, dann löschen.');
                }
            }
            $imap->deleteFolder($path);
        });
        self::forget($mb);
        self::log($me, $mb, 'hat in ' . $mb['email'] . ' den Ordner „' . $f['name'] . '“ gelöscht');
        return self::folders($me, $address, true);
    }

    // ---------- Verschieben ----------

    /** Mails aus einem Ordner in einen anderen (auch zurück in den Posteingang). */
    public static function move(array $me, string $address, string $from, array $uids, string $to): array
    {
        $mb = self::box($me, $address);
        $src = self::folder($me, $mb, $from);
        $dst = self::folder($me, $mb, $to);
        $uids = array_values(array_unique(array_filter(array_map('intval', $uids), static fn ($u) => $u > 0)));
        if (!$uids || count($uids) > 200) {
            throw new HttpError(422, 'Bitte eine bis 200 Mails wählen.');
        }
        if (!$dst['selectable'] || $src['path'] === $dst['path']) {
            throw new HttpError(422, 'Bitte einen anderen Ordner wählen.');
        }
        self::with($mb, static function (Imap $imap) use ($from, $to, $uids, $mb) {
            $validity = $imap->select($from);
            $imap->moveUids($uids, $to);
            if (strcasecmp($from, 'INBOX') === 0) {
                self::hideInApp($mb, $validity, $uids);
            }
        });
        if (strcasecmp($to, 'INBOX') === 0) {
            // Zurück im Posteingang: beim nächsten Abruf wieder in der App (sofort anstoßen)
            Http::defer(static fn () => MailJob::run());
        }
        return ['moved' => count($uids), 'to' => $dst];
    }

    /** Mail aus dem Posteingang der App in einen Ordner sortieren. */
    public static function moveEmail(array $me, string $emailId, string $to): array
    {
        $mail = Replies::mail($me, $emailId);
        $mb = self::box($me, (string) $mail['mailbox']);
        $dst = self::folder($me, $mb, $to);
        if (!$dst['selectable'] || $dst['special'] === 'inbox') {
            throw new HttpError(422, 'Bitte einen anderen Ordner wählen.');
        }
        self::with($mb, static function (Imap $imap) use ($mail, $to, $mb) {
            $validity = $imap->select('INBOX');
            $uid = Replies::findUid($imap, $mail, $validity);
            if ($uid === null) {
                throw new HttpError(404, 'Die Mail liegt nicht mehr im Posteingang (schon verschoben oder gelöscht).');
            }
            $imap->moveUids([$uid], $to);
        });
        $now = max(Util::now(), (int) $mail['updated_at'] + 1);
        Db::update('emails', ['deleted' => 1, 'updated_at' => $now], ['id' => $emailId]);
        if (!($mb['visible_to'] ?? [])) {
            Activity::log($me['id'], 'mail_moved', 'email', $emailId, 'hat „' . mb_substr((string) $mail['subject'], 0, 80) . '“ nach „' . $dst['name'] . '“ verschoben');
        }
        return ['email' => Sync::email(Db::one('SELECT * FROM emails WHERE id = ?', [$emailId])), 'to' => $dst];
    }

    /** Aus dem Posteingang verschobene Mails sofort aus der App nehmen (sonst erst beim nächsten Abruf). */
    private static function hideInApp(array $mb, string $validity, array $uids): void
    {
        $now = Util::now();
        foreach ($uids as $uid) {
            $id = substr(sha1($mb['email'] . '|' . $validity . '|' . $uid), 0, 40);
            Db::exec('UPDATE emails SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0', [$now, $id]);
        }
    }

    private static function log(array $me, array $mb, string $text): void
    {
        if (!($mb['visible_to'] ?? [])) {
            Activity::log($me['id'], 'mail_folder', 'mailbox', $mb['id'], $text);
        }
    }
}
