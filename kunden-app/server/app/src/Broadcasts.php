<?php
declare(strict_types=1);

namespace Club;

/**
 * Nachrichten an Mitglieder (z. B. „Neuer Duft“), geschrieben und freigegeben in der Team-App.
 * Ablauf: Entwurf → zur Prüfung → freigegeben (sofort oder geplant) → wird verschickt → verschickt.
 * Der Club verschickt freigegebene Nachrichten zum geplanten Zeitpunkt als Push (Ruhezeit wird beachtet).
 * Feedback-Anfragen öffnen in der App die Seite „Feedback“.
 */
final class Broadcasts
{
    public const AUDIENCES = ['all' => 'Alle Mitglieder', 'silber' => 'Ab Silber (Silber, Gold, Platin)', 'gold' => 'Ab Gold (Gold, Platin)', 'platin' => 'Nur Platin'];
    public const STATUS = [
        'draft' => 'Entwurf',
        'review' => 'Zur Prüfung',
        'approved' => 'Freigegeben',
        'sending' => 'Wird verschickt',
        'sent' => 'Verschickt',
    ];

    /** Vorlagen für die Team-App. {duft}, {aktion} … füllt das Team beim Schreiben aus; {vorname} und {stufe} beim Versand. */
    public const TEMPLATES = [
        'release' => [
            'label' => 'Neuer Duft',
            'kind' => 'news',
            'title' => 'Neu: {duft}',
            'body' => '{vorname}, unser neuer Duft {duft} ist da. Als Club-Mitglied sammelst du darauf wie immer Punkte.',
            'url' => '',
            'audience' => 'all',
            'fields' => ['duft' => 'Name des Dufts'],
        ],
        'early_access' => [
            'label' => 'Früher Zugang (Gold)',
            'kind' => 'news',
            'title' => 'Exklusiv für {stufe}: {duft}',
            'body' => 'Bevor alle anderen ihn sehen: {duft} ist für dich schon jetzt erhältlich – 48 Stunden früher.',
            'url' => '',
            'audience' => 'gold',
            'fields' => ['duft' => 'Name des Dufts'],
        ],
        'restock' => [
            'label' => 'Wieder da',
            'kind' => 'news',
            'title' => 'Wieder da: {duft}',
            'body' => '{duft} ist wieder auf Lager. Schnell sein lohnt sich – die letzte Charge war nach wenigen Tagen weg.',
            'url' => '',
            'audience' => 'all',
            'fields' => ['duft' => 'Name des Dufts'],
        ],
        'sample' => [
            'label' => 'Probe zur Bestellung',
            'kind' => 'news',
            'title' => 'Eine Probe für dich',
            'body' => '{vorname}, zu deiner nächsten Bestellung legen wir dir eine Probe von {duft} dazu. Nur für Club-Mitglieder.',
            'url' => '',
            'audience' => 'all',
            'fields' => ['duft' => 'Name des Dufts'],
        ],
        'feedback' => [
            'label' => 'Feedback-Anfrage',
            'kind' => 'feedback',
            'title' => 'Wie gefällt dir der Club?',
            'body' => 'Sag uns in 10 Sekunden, wie es dir gefällt: Gut, Neutral oder Schlecht. Wir lesen jede Antwort.',
            'url' => '',
            'audience' => 'all',
            'fields' => [],
        ],
        'free' => [
            'label' => 'Freie Nachricht',
            'kind' => 'news',
            'title' => '',
            'body' => '',
            'url' => '',
            'audience' => 'all',
            'fields' => [],
        ],
    ];

    public static function templates(): array
    {
        $out = [];
        foreach (self::TEMPLATES as $key => $t) {
            $out[] = ['key' => $key] + $t;
        }
        return $out;
    }

    public static function fourEyes(): bool
    {
        return (bool) Settings::get('broadcast_four_eyes', false);
    }

    // ---------- Verwaltung (aus der Team-App über /api/internal, mit Name und ID der Person) ----------

    public static function overview(): array
    {
        return [
            'broadcasts' => self::list(),
            'templates' => self::templates(),
            'audiences' => array_map(static fn ($k, $v) => ['key' => $k, 'label' => $v, 'count' => count(self::audience($k))], array_keys(self::AUDIENCES), self::AUDIENCES),
            'four_eyes' => self::fourEyes(),
            'quiet' => Settings::get('push_quiet', ['start' => 21, 'end' => 8]),
            'app_url' => Util::baseUrl(),
        ];
    }

    public static function list(int $limit = 50): array
    {
        return array_map([self::class, 'publicRow'], Db::all('SELECT * FROM club_broadcasts ORDER BY updated_at DESC LIMIT ' . max(1, min(200, $limit))));
    }

    public static function publicRow(array $b): array
    {
        $out = [
            'id' => $b['id'],
            'kind' => $b['kind'],
            'template' => $b['template'],
            'title' => $b['title'],
            'body' => $b['body'],
            'url' => $b['url'],
            'audience' => $b['audience'],
            'status' => $b['status'],
            'status_label' => self::STATUS[$b['status']] ?? $b['status'],
            'scheduled_at' => $b['scheduled_at'] !== null ? (int) $b['scheduled_at'] : null,
            'created_by' => $b['created_by'],
            'created_by_name' => $b['created_by_name'],
            'approved_by_name' => $b['approved_by_name'],
            'approved_at' => $b['approved_at'] !== null ? (int) $b['approved_at'] : null,
            'sent_at' => $b['sent_at'] !== null ? (int) $b['sent_at'] : null,
            'recipients' => (int) $b['recipients'],
            'review_note' => $b['review_note'],
            'error' => $b['error'],
            'created_at' => (int) $b['created_at'],
            'updated_at' => (int) $b['updated_at'],
        ];
        if ($b['status'] === 'sent') {
            $q = Db::one("SELECT SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS ok, COUNT(*) AS n FROM club_push_queue WHERE broadcast_id = ?", [$b['id']]);
            $out['delivered'] = (int) ($q['ok'] ?? 0);
            $out['queued'] = (int) Db::value("SELECT COUNT(*) FROM club_push_queue WHERE broadcast_id = ? AND status = 'queued'", [$b['id']]);
            if ($b['kind'] === 'feedback') {
                $out['answers'] = (int) Db::value('SELECT COUNT(*) FROM club_feedback WHERE broadcast_id = ?', [$b['id']]);
            }
        }
        return $out;
    }

    /** Mitglieder, die diese Nachricht bekommen würden (mit Gerät und „Aktionen & Neuheiten“ an). */
    private static function audience(string $key): array
    {
        return Push::recipients('news', $key === 'all' ? null : $key);
    }

    private static function load(string $id): array
    {
        $b = Db::one('SELECT * FROM club_broadcasts WHERE id = ?', [$id]);
        if (!$b) {
            throw new HttpError(404, 'Nachricht nicht gefunden.');
        }
        return $b;
    }

    /** Entwurf anlegen oder ändern. $user: ['id' => …, 'name' => …] aus der Team-App */
    public static function save(array $user, array $in, ?string $id = null): array
    {
        $kind = ($in['kind'] ?? 'news') === 'feedback' ? 'feedback' : 'news';
        $template = is_string($in['template'] ?? null) && isset(self::TEMPLATES[$in['template']]) ? $in['template'] : null;
        $title = Util::str($in['title'] ?? '', 120, false);
        $body = Util::str($in['body'] ?? '', 400, false);
        if ($title === '' || $body === '') {
            throw new HttpError(422, 'Bitte Überschrift und Text ausfüllen.');
        }
        if (preg_match('/\{(duft|aktion)\}/', $title . ' ' . $body)) {
            throw new HttpError(422, 'Bitte die Platzhalter in geschweiften Klammern ausfüllen (z. B. {duft}).');
        }
        $url = Util::str($in['url'] ?? null, 255);
        if ($url !== null && !preg_match('#^(https://|/)#', $url)) {
            throw new HttpError(422, 'Der Link muss mit https:// beginnen.');
        }
        $audience = (string) ($in['audience'] ?? 'all');
        if (!isset(self::AUDIENCES[$audience])) {
            throw new HttpError(422, 'Unbekannte Empfängergruppe.');
        }
        $scheduled = isset($in['scheduled_at']) && $in['scheduled_at'] !== null && $in['scheduled_at'] !== '' ? (int) $in['scheduled_at'] : null;
        if ($scheduled !== null && $scheduled < Util::now() - 60000) {
            throw new HttpError(422, 'Der geplante Zeitpunkt liegt in der Vergangenheit.');
        }
        $now = Util::now();
        $row = [
            'kind' => $kind,
            'template' => $template,
            'title' => $title,
            'body' => $body,
            'url' => $url,
            'audience' => $audience,
            'scheduled_at' => $scheduled,
            'updated_at' => $now,
        ];
        if ($id) {
            $b = self::load($id);
            if (!in_array($b['status'], ['draft', 'review'], true)) {
                throw new HttpError(409, 'Freigegebene oder verschickte Nachrichten können nicht mehr geändert werden. Zurückziehen und neu freigeben.');
            }
            // Jede Änderung braucht eine neue Prüfung
            Db::update('club_broadcasts', $row + ['status' => 'draft', 'review_note' => null], ['id' => $id]);
        } else {
            $id = Util::uuid();
            Db::insert('club_broadcasts', $row + [
                'id' => $id,
                'status' => 'draft',
                'created_by' => (string) $user['id'],
                'created_by_name' => mb_substr((string) $user['name'], 0, 100),
                'approved_by' => null,
                'approved_by_name' => null,
                'approved_at' => null,
                'sent_at' => null,
                'recipients' => 0,
                'review_note' => null,
                'error' => null,
                'created_at' => $now,
            ]);
        }
        return self::publicRow(self::load($id));
    }

    /** Zur Prüfung geben. */
    public static function submit(array $user, string $id): array
    {
        $b = self::load($id);
        if ($b['status'] !== 'draft') {
            throw new HttpError(409, 'Nur Entwürfe können zur Prüfung gegeben werden.');
        }
        Db::update('club_broadcasts', ['status' => 'review', 'review_note' => null, 'updated_at' => Util::now()], ['id' => $id]);
        return self::publicRow(self::load($id));
    }

    /** Freigeben: wird sofort bzw. zum geplanten Zeitpunkt verschickt. */
    public static function approve(array $user, string $id): array
    {
        $b = self::load($id);
        if (!in_array($b['status'], ['draft', 'review'], true)) {
            throw new HttpError(409, 'Diese Nachricht ist schon freigegeben oder verschickt.');
        }
        if (self::fourEyes() && (string) $b['created_by'] === (string) $user['id']) {
            throw new HttpError(403, 'Vier-Augen-Prinzip: Eine andere Person muss die Nachricht freigeben.');
        }
        if ($b['scheduled_at'] !== null && (int) $b['scheduled_at'] < Util::now() - 60000) {
            throw new HttpError(422, 'Der geplante Zeitpunkt ist vorbei. Bitte neu planen oder „sofort“ wählen.');
        }
        Db::update('club_broadcasts', [
            'status' => 'approved',
            'approved_by' => (string) $user['id'],
            'approved_by_name' => mb_substr((string) $user['name'], 0, 100),
            'approved_at' => Util::now(),
            'error' => null,
            'updated_at' => Util::now(),
        ], ['id' => $id]);
        // Sofortige Nachrichten gleich verschicken (nicht erst beim nächsten Cronjob)
        if ($b['scheduled_at'] === null || (int) $b['scheduled_at'] <= Util::now()) {
            self::run();
            Push::flush();
        }
        return self::publicRow(self::load($id));
    }

    /** Zurück an den Entwurf – mit Hinweis, was geändert werden soll. */
    public static function reject(array $user, string $id, string $note): array
    {
        $b = self::load($id);
        if ($b['status'] !== 'review') {
            throw new HttpError(409, 'Nur Nachrichten in Prüfung können zurückgegeben werden.');
        }
        $note = Util::str($note, 250);
        Db::update('club_broadcasts', [
            'status' => 'draft',
            'review_note' => trim(mb_substr((string) $user['name'], 0, 60) . ': ' . ($note ?? 'Bitte überarbeiten.')),
            'updated_at' => Util::now(),
        ], ['id' => $id]);
        return self::publicRow(self::load($id));
    }

    /** Geplante Nachricht zurückziehen (solange sie noch nicht verschickt wird). */
    public static function cancel(string $id): array
    {
        $n = Db::exec("UPDATE club_broadcasts SET status = 'draft', approved_by = NULL, approved_by_name = NULL, approved_at = NULL, updated_at = ? WHERE id = ? AND status = 'approved'", [Util::now(), $id]);
        if ($n !== 1) {
            throw new HttpError(409, 'Die Nachricht wird schon verschickt oder ist nicht freigegeben.');
        }
        return self::publicRow(self::load($id));
    }

    public static function delete(string $id): void
    {
        $b = self::load($id);
        if (!in_array($b['status'], ['draft', 'review'], true)) {
            throw new HttpError(409, 'Freigegebene oder verschickte Nachrichten bleiben im Verlauf. Zurückziehen geht, solange sie nicht verschickt sind.');
        }
        Db::exec('DELETE FROM club_broadcasts WHERE id = ?', [$id]);
    }

    // ---------- Versand ----------

    public static function run(): string
    {
        $now = Util::now();
        $n = 0;
        foreach (Db::all("SELECT * FROM club_broadcasts WHERE status = 'approved' AND (scheduled_at IS NULL OR scheduled_at <= ?)", [$now]) as $b) {
            if (Db::exec("UPDATE club_broadcasts SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'approved'", [$now, $b['id']]) !== 1) {
                continue;
            }
            try {
                $count = self::deliver($b);
                Db::update('club_broadcasts', ['status' => 'sent', 'sent_at' => Util::now(), 'recipients' => $count, 'error' => null, 'updated_at' => Util::now()], ['id' => $b['id']]);
                $n++;
            } catch (\Throwable $e) {
                Util::log('Nachricht an Mitglieder: ' . $e->getMessage());
                Db::update('club_broadcasts', ['status' => 'approved', 'error' => mb_substr($e->getMessage(), 0, 250), 'updated_at' => Util::now()], ['id' => $b['id']]);
            }
        }
        return "$n Nachrichten an Mitglieder";
    }

    public static function url(array $b): string
    {
        if ($b['kind'] === 'feedback') {
            return '/feedback?anfrage=' . $b['id'];
        }
        $url = (string) ($b['url'] ?? '');
        return preg_match('#^(https://|/)#', $url) ? $url : '/';
    }

    private static function deliver(array $b): int
    {
        $notBefore = Push::notBefore(Util::now());
        $count = 0;
        foreach (self::audience((string) $b['audience']) as $m) {
            $vars = ['vorname' => trim((string) ($m['first_name'] ?? '')), 'stufe' => Tiers::of($m)['name']];
            if (Push::insert($m['id'], 'broadcast', Push::fill((string) $b['title'], $vars), Push::fill((string) $b['body'], $vars), self::url($b), 'b:' . $b['id'] . ':' . $m['id'], $b['id'], $notBefore)) {
                $count++;
            }
        }
        return $count;
    }

    /** Testversand an die eigenen Geräte (Club-Konto mit derselben E-Mail wie in der Team-App). */
    public static function test(string $id, string $email): array
    {
        $b = self::load($id);
        $m = Db::one('SELECT * FROM club_members WHERE email = ?', [mb_strtolower(trim($email))]);
        if (!$m || Push::devices($m['id']) === 0) {
            throw new HttpError(409, 'Für ' . $email . ' gibt es im Club kein Gerät mit Mitteilungen. Melde dich in der Club-App mit dieser E-Mail an und schalte unter „Konto“ die Mitteilungen ein.');
        }
        $vars = ['vorname' => trim((string) ($m['first_name'] ?? '')), 'stufe' => Tiers::of($m)['name']];
        return Push::test($m, '[Test] ' . Push::fill((string) $b['title'], $vars), Push::fill((string) $b['body'], $vars), self::url($b));
    }

    /** Offene Feedback-Anfrage für dieses Mitglied (in den letzten 21 Tagen verschickt, noch nicht beantwortet). */
    public static function openFeedback(array $member): ?array
    {
        $b = Db::one(
            "SELECT b.* FROM club_broadcasts b WHERE b.kind = 'feedback' AND b.status = 'sent' AND b.sent_at > ?
             AND EXISTS (SELECT 1 FROM club_push_queue q WHERE q.broadcast_id = b.id AND q.member_id = ?)
             AND NOT EXISTS (SELECT 1 FROM club_feedback f WHERE f.broadcast_id = b.id AND f.member_id = ?)
             ORDER BY b.sent_at DESC",
            [Util::now() - 21 * Points::DAY_MS, $member['id'], $member['id']]
        );
        if (!$b) {
            return null;
        }
        $vars = ['vorname' => trim((string) ($member['first_name'] ?? '')), 'stufe' => Tiers::of($member)['name']];
        return ['id' => $b['id'], 'title' => Push::fill((string) $b['title'], $vars), 'body' => Push::fill((string) $b['body'], $vars)];
    }

    public static function find(string $id): ?array
    {
        return Db::one('SELECT id, kind, title, body FROM club_broadcasts WHERE id = ?', [$id]);
    }
}
