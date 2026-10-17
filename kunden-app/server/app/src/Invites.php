<?php
declare(strict_types=1);

namespace Club;

/**
 * Einladung an die Warteliste zum Start des Clubs.
 * Kundinnen und Kunden mit dem Shopify-Tag der Warteliste bekommen eine E-Mail mit Link zur App.
 * Wer beitritt, erhält den Startbonus (siehe Bonus::onJoin). Verschickt wird in Paketen per Cronjob.
 */
final class Invites
{
    public const DEFAULT_SUBJECT = 'Der {club} ist da – dein Startbonus wartet';
    public const DEFAULT_TEXT = "Du hast dich auf unsere Warteliste eingetragen – danke für deine Geduld! Ab heute ist der {club} offen: Mit jeder Bestellung sammelst du Punkte und löst sie als Rabatt ein.\n\nAls Dankeschön bekommst du {startbonus} Punkte Startbonus, wenn du jetzt beitrittst.";

    public static function template(): array
    {
        $t = Settings::get('invite_mail', []);
        return [
            'subject' => is_string($t['subject'] ?? null) && $t['subject'] !== '' ? $t['subject'] : self::DEFAULT_SUBJECT,
            'text' => is_string($t['text'] ?? null) && $t['text'] !== '' ? $t['text'] : self::DEFAULT_TEXT,
        ];
    }

    public static function saveTemplate(array $in): array
    {
        Settings::set('invite_mail', [
            'subject' => Util::str($in['subject'] ?? '', 150, false),
            'text' => Util::str($in['text'] ?? '', 3000, false),
        ]);
        return self::template();
    }

    /** @return array{0:string,1:string,2:string} Betreff, Text, HTML */
    public static function render(?string $firstName): array
    {
        $p = Points::program();
        $sb = Points::startBonus($p);
        $vars = [
            'club' => $p['name'],
            'vorname' => trim((string) $firstName),
            'startbonus' => $sb ? (string) $sb['points'] : '0',
        ];
        $t = self::template();
        $subject = Push::fill($t['subject'], $vars);
        $text = Push::fill($t['text'], $vars);
        $conditions = [];
        if ($sb) {
            if ($sb['until']) {
                $conditions[] = 'Beitritt bis ' . date('d.m.Y', intdiv($sb['until'], 1000));
            }
            if ($sb['requires_order']) {
                $conditions[] = 'die Punkte werden mit deiner ersten Bestellung' . ($sb['min_cents'] > 0 ? ' ab ' . Util::euro($sb['min_cents']) : '') . ' frei';
            }
            if ($sb['days'] > 0) {
                $conditions[] = 'danach ' . $sb['days'] . ' Tage einlösbar';
            }
        }
        $cond = $conditions ? 'Bedingungen: ' . implode(', ', $conditions) . '.' : '';
        $hallo = $vars['vorname'] !== '' ? 'Hallo ' . $vars['vorname'] . ',' : 'Hallo,';
        $url = Util::baseUrl() . '/?von=warteliste';
        $paras = array_filter(array_map('trim', explode("\n\n", $text)));
        $html = Mailer::layout(
            $p['name'],
            'Endlich <i style="color:#80562F">da</i>',
            '<p style="margin:0 0 12px">' . htmlspecialchars($hallo) . '</p>'
                . implode('', array_map(static fn ($t) => '<p style="margin:0 0 12px">' . nl2br(htmlspecialchars($t)) . '</p>', $paras))
                . ($sb ? '<p style="margin:16px 0 0;padding:16px 18px;background:#F4EFE6;border-radius:14px;font-size:22px;color:#232120">+' . $sb['points'] . ' Punkte<span style="display:block;font-size:14px;color:#6b625b;margin-top:4px">' . htmlspecialchars($cond ?: 'Startbonus für die Warteliste') . '</span></p>' : ''),
            ['label' => 'Jetzt beitreten', 'url' => $url],
            'Perfume Cloud · Du bekommst diese E-Mail einmalig, weil du dich auf die Warteliste für den ' . htmlspecialchars($p['name']) . ' eingetragen hast.'
        );
        $plain = "$hallo\n\n$text" . ($cond !== '' ? "\n\n$cond" : '') . "\n\nJetzt beitreten: $url\n\nPerfume Cloud";
        return [$subject, $plain, $html];
    }

    public static function overview(): array
    {
        $counts = ['new' => 0, 'queued' => 0, 'sent' => 0, 'failed' => 0, 'joined' => 0];
        foreach (Db::all('SELECT status, COUNT(*) AS n FROM club_invites GROUP BY status') as $r) {
            $counts[$r['status']] = (int) $r['n'];
        }
        [$subject] = self::render(null);
        return [
            'counts' => $counts,
            'total' => array_sum($counts),
            'loaded_at' => Settings::get('invites_loaded_at'),
            'tag' => Points::program()['waitlist_tag'],
            'limit' => Waitlist::status(),
            'start_bonus' => Points::startBonus(),
            'mail_ready' => Mailer::configured(),
            'template' => self::template(),
            'subject' => $subject,
            'recent' => array_map(static fn ($r) => [
                'email' => $r['email'],
                'first_name' => $r['first_name'],
                'status' => $r['status'],
                'error' => $r['error'],
                'sent_at' => $r['sent_at'] !== null ? (int) $r['sent_at'] : null,
            ], Db::all('SELECT * FROM club_invites ORDER BY COALESCE(sent_at, queued_at, created_at) DESC LIMIT 30')),
        ];
    }

    /** Warteliste aus Shopify laden (alle Kundenkonten mit dem Tag). */
    public static function load(): array
    {
        if (!Shopify::configured()) {
            throw new HttpError(503, 'Shopify ist noch nicht verbunden.');
        }
        $tag = (string) Points::program()['waitlist_tag'];
        $after = null;
        $found = 0;
        $added = 0;
        for ($page = 0; $page < 50; $page++) {
            $d = Shopify::graphql(
                'query ClubWaitlist($q: String!, $after: String) { customers(first: 100, after: $after, query: $q) {
                    pageInfo { hasNextPage endCursor } nodes { id firstName defaultEmailAddress { emailAddress } } } }',
                ['q' => 'tag:"' . addcslashes($tag, '"\\') . '"', 'after' => $after]
            );
            foreach ($d['customers']['nodes'] ?? [] as $c) {
                $email = mb_strtolower((string) ($c['defaultEmailAddress']['emailAddress'] ?? ''));
                if ($email === '') {
                    continue;
                }
                $found++;
                $joined = (bool) Db::value('SELECT 1 FROM club_members WHERE shopify_id = ? AND joined_at IS NOT NULL', [$c['id']]);
                $row = Db::one('SELECT * FROM club_invites WHERE customer_id = ?', [$c['id']]);
                if (!$row) {
                    Db::insert('club_invites', [
                        'id' => Util::uuid(),
                        'customer_id' => (string) $c['id'],
                        'email' => mb_substr($email, 0, 190),
                        'first_name' => Util::str($c['firstName'] ?? null, 100),
                        'status' => $joined ? 'joined' : 'new',
                        'error' => null,
                        'created_at' => Util::now(),
                        'queued_at' => null,
                        'sent_at' => null,
                    ]);
                    $added++;
                } elseif ($joined && $row['status'] !== 'joined') {
                    Db::exec("UPDATE club_invites SET status = 'joined' WHERE id = ?", [$row['id']]);
                }
            }
            if (!($d['customers']['pageInfo']['hasNextPage'] ?? false)) {
                break;
            }
            $after = $d['customers']['pageInfo']['endCursor'];
        }
        Settings::set('invites_loaded_at', Util::now());
        return ['found' => $found, 'added' => $added] + self::overview();
    }

    /** Testmail an die eigene Adresse. */
    public static function test(array $admin): array
    {
        [$subject, $text, $html] = self::render(explode(' ', (string) $admin['name'])[0] ?? null);
        return Mailer::send((string) $admin['email'], '[Test] ' . $subject, $text, $html);
    }

    /** Alle noch nicht eingeladenen Personen einreihen; der Cronjob verschickt sie nach und nach. */
    public static function start(): array
    {
        if (!Mailer::configured()) {
            throw new HttpError(409, 'Bitte zuerst das Postfach für den Versand einrichten (Einstellungen → E-Mail).');
        }
        $n = Db::exec("UPDATE club_invites SET status = 'queued', queued_at = ? WHERE status IN ('new', 'failed')", [Util::now()]);
        return ['queued' => $n] + self::overview();
    }

    public static function stop(): array
    {
        Db::exec("UPDATE club_invites SET status = 'new', queued_at = NULL WHERE status = 'queued'");
        return self::overview();
    }

    /** Cronjob: höchstens $max Einladungen je Lauf (schont das Postfach und die Zustellbarkeit). */
    public static function run(int $max = 40): string
    {
        $rows = Db::all("SELECT * FROM club_invites WHERE status = 'queued' ORDER BY queued_at LIMIT $max");
        $sent = 0;
        foreach ($rows as $r) {
            if (Db::value('SELECT 1 FROM club_members WHERE shopify_id = ? AND joined_at IS NOT NULL', [$r['customer_id']])) {
                Db::exec("UPDATE club_invites SET status = 'joined' WHERE id = ?", [$r['id']]);
                continue;
            }
            [$subject, $text, $html] = self::render($r['first_name']);
            $res = Mailer::send((string) $r['email'], $subject, $text, $html);
            Db::update('club_invites', [
                'status' => $res['sent'] ? 'sent' : 'failed',
                'error' => $res['sent'] ? null : mb_substr($res['message'], 0, 250),
                'sent_at' => Util::now(),
            ], ['id' => $r['id']]);
            $sent += $res['sent'] ? 1 : 0;
        }
        return "$sent Einladungen verschickt";
    }
}
