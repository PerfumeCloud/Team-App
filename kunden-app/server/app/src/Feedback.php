<?php
declare(strict_types=1);

namespace Club;

/** Feedback von Mitgliedern: Gut / Neutral / Schlecht und optional ein Text. Geht per Mail an das Team. */
final class Feedback
{
    public const RATINGS = ['gut' => 'Gut', 'neutral' => 'Neutral', 'schlecht' => 'Schlecht'];

    public static function email(): string
    {
        $e = Settings::get('feedback_email');
        return is_string($e) && $e !== '' ? $e : 'info@perfumecloud.de';
    }

    public static function submit(array $member, array $in): array
    {
        $rating = (string) ($in['rating'] ?? '');
        if (!isset(self::RATINGS[$rating])) {
            throw new HttpError(422, 'Bitte wähle Gut, Neutral oder Schlecht.');
        }
        $text = Util::str($in['text'] ?? null, 2000);
        $bid = (string) ($in['anfrage'] ?? '');
        $broadcast = preg_match('/^[0-9a-f-]{36}$/', $bid) ? Broadcasts::find($bid) : null;
        if ($broadcast && Db::value('SELECT 1 FROM club_feedback WHERE broadcast_id = ? AND member_id = ?', [$bid, $member['id']])) {
            throw new HttpError(409, 'Danke, dein Feedback zu dieser Frage haben wir schon.');
        }
        Util::limit('feedback:' . $member['id'], 5, 86400, 'Danke! Für heute haben wir genug Feedback von dir – schreib uns gern morgen wieder.');

        $name = trim(($member['first_name'] ?? '') . ' ' . ($member['last_name'] ?? ''));
        $id = Util::uuid();
        Db::insert('club_feedback', [
            'id' => $id,
            'member_id' => $member['id'],
            'broadcast_id' => $broadcast ? $bid : null,
            'rating' => $rating,
            'text' => $text,
            'name' => $name !== '' ? mb_substr($name, 0, 200) : null,
            'email' => $member['email'],
            'mailed' => 0,
            'created_at' => Util::now(),
        ]);

        $label = self::RATINGS[$rating];
        $frage = $broadcast ? 'Anfrage: ' . $broadcast['title'] . "\n" : '';
        $who = $name !== '' ? "$name <{$member['email']}>" : $member['email'];
        $body = "Neues Feedback aus dem " . Points::program()['name'] . "\n\n"
            . "Bewertung: $label\n"
            . $frage
            . "Von: $who\n"
            . 'Stufe: ' . Tiers::of($member)['name'] . "\n\n"
            . ($text !== null ? "Begründung:\n$text\n" : "(ohne Begründung)\n");
        $html = Mailer::layout(
            'Feedback',
            'Bewertung: ' . htmlspecialchars($label),
            '<p style="margin:0 0 12px">' . nl2br(htmlspecialchars($frage . "Von: $who\nStufe: " . Tiers::of($member)['name'])) . '</p>'
                . ($text !== null ? '<p style="margin:0;padding:14px 16px;background:#F4EFE6;border-radius:14px">' . nl2br(htmlspecialchars($text)) . '</p>' : '<p style="margin:0;color:#6b625b">Ohne Begründung.</p>'),
            null,
            'Antworten geht direkt an das Mitglied.'
        );
        Http::defer(static function () use ($id, $label, $name, $body, $html, $member): void {
            $r = Mailer::send(self::email(), "Club-Feedback: $label" . ($name !== '' ? " von $name" : ''), $body, $html, (string) $member['email']);
            if ($r['sent']) {
                Db::exec('UPDATE club_feedback SET mailed = 1 WHERE id = ?', [$id]);
            }
        });
        return ['ok' => true];
    }

    public static function list(int $limit = 100): array
    {
        return array_map(static fn ($f) => [
            'id' => $f['id'],
            'rating' => $f['rating'],
            'text' => $f['text'],
            'name' => $f['name'],
            'email' => $f['email'],
            'broadcast' => $f['btitle'],
            'mailed' => (bool) $f['mailed'],
            'created_at' => (int) $f['created_at'],
        ], Db::all('SELECT f.*, b.title AS btitle FROM club_feedback f LEFT JOIN club_broadcasts b ON b.id = f.broadcast_id ORDER BY f.created_at DESC LIMIT ' . max(1, min(500, $limit))));
    }

    public static function stats(int $days = 90): array
    {
        $out = ['gut' => 0, 'neutral' => 0, 'schlecht' => 0];
        foreach (Db::all('SELECT rating, COUNT(*) AS n FROM club_feedback WHERE created_at > ? GROUP BY rating', [Util::now() - $days * Points::DAY_MS]) as $r) {
            $out[$r['rating']] = (int) $r['n'];
        }
        return $out;
    }
}
