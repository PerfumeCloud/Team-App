<?php
declare(strict_types=1);

namespace PC;

/**
 * Synchronisation: Jedes Gerät fragt alle paar Sekunden „was hat sich seit X geändert?“.
 * Schreibzugriffe sind idempotente Upserts mit vom Gerät erzeugten IDs, damit sie offline
 * gesammelt und später nachgeschickt werden können.
 */
final class Sync
{
    private const OVERLAP_MS = 10000;
    private const TASK_STATUS = ['todo', 'doing', 'done'];
    private const PRIORITIES = ['low', 'normal', 'high'];

    public static function pull(array $me, int $since): array
    {
        $serverTime = Util::now();
        $full = $since <= 0;
        $from = $full ? 0 : max(0, $since - self::OVERLAP_MS);
        $live = $full ? ' AND deleted = 0' : '';

        $users = array_map([Auth::class, 'publicUser'], Db::all('SELECT * FROM users ORDER BY created_at'));
        $tasks = array_map([self::class, 'task'], Db::all("SELECT * FROM tasks WHERE updated_at > ?$live", [$from]));
        $notes = array_map([self::class, 'note'], Db::all("SELECT * FROM notes WHERE updated_at > ?$live", [$from]));
        $comments = array_map([self::class, 'comment'], Db::all("SELECT * FROM comments WHERE updated_at > ?$live", [$from]));
        // Persönliche Postfächer: nur die eigenen Mails
        $emails = array_map([self::class, 'email'], Db::all("SELECT * FROM emails WHERE updated_at > ? AND (owner_id IS NULL OR owner_id = ?)$live", [$from, $me['id']]));
        $activity = array_map([self::class, 'activity'], Db::all(
            'SELECT * FROM activity WHERE updated_at > ? ORDER BY created_at DESC LIMIT 60',
            [$full ? $serverTime - 14 * 86400 * 1000 : $from]
        ));

        return [
            'serverTime' => $serverTime,
            'full' => $full,
            'users' => $users,
            'tasks' => $tasks,
            'notes' => $notes,
            'comments' => $comments,
            'emails' => $emails,
            'activity' => $activity,
            'meta' => self::meta($me),
        ];
    }

    public static function meta(array $me): array
    {
        $personal = MailJob::personal($me['id']);
        $boxes = array_column(MailJob::mailboxes(), 'email');
        if ($personal) {
            $boxes[] = $personal['email'];
        }
        return [
            'shopifyConfigured' => Shopify::configured(),
            'mailConfigured' => count($boxes) > 0,
            'mailboxes' => $boxes,
            'myMailbox' => $personal['email'] ?? null,
            'jobsLastRun' => (int) Settings::get('jobs_last_run', 0),
            'ordersLastSync' => (int) Settings::get('orders_last_sync', 0),
            'mailLastFetch' => (int) Settings::get('mail_last_fetch', 0),
        ];
    }

    // ---------- Aufgaben ----------

    public static function saveTask(array $me, string $id, array $in): array
    {
        if (!Util::isUuid($id)) {
            throw new HttpError(422, 'Ungültige ID.');
        }
        $title = Util::str($in['title'] ?? '', 300, false);
        if ($title === '') {
            throw new HttpError(422, 'Bitte einen Titel eingeben.');
        }
        $assignee = $in['assignee_id'] ?? null;
        if ($assignee !== null && !Db::value('SELECT 1 FROM users WHERE id = ? AND deleted = 0', [$assignee])) {
            $assignee = null;
        }
        $due = $in['due_date'] ?? null;
        if ($due !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $due)) {
            $due = null;
        }

        return Db::tx(function () use ($me, $id, $in, $title, $assignee, $due) {
            $old = Db::one('SELECT * FROM tasks WHERE id = ?', [$id]);
            $now = max(Util::now(), $old ? (int) $old['updated_at'] + 1 : 0);
            $status = Util::oneOf($in['status'] ?? null, self::TASK_STATUS, 'todo');
            $row = [
                'id' => $id,
                'title' => $title,
                'description' => Util::str($in['description'] ?? null, 20000),
                'status' => $status,
                'priority' => Util::oneOf($in['priority'] ?? null, self::PRIORITIES, 'normal'),
                'category' => Util::str($in['category'] ?? null, 60),
                'assignee_id' => $assignee,
                'due_date' => $due,
                'position' => is_numeric($in['position'] ?? null) ? (float) $in['position'] : ($old ? (float) $old['position'] : (float) $now),
                'checklist' => self::checklist($in['checklist'] ?? null),
                'source_email_id' => Util::str($in['source_email_id'] ?? ($old['source_email_id'] ?? null), 40),
                'completed_at' => $status === 'done' ? ($old && $old['status'] === 'done' ? $old['completed_at'] : $now) : null,
                'updated_by' => $me['id'],
                'updated_at' => $now,
                'deleted' => 0,
            ];
            if ($old) {
                Db::update('tasks', $row, ['id' => $id]);
            } else {
                $row['created_by'] = $me['id'];
                $row['created_at'] = $now;
                Db::insert('tasks', $row);
                Activity::log($me['id'], 'task_created', 'task', $id, "hat „{$title}“ angelegt");
            }

            if ($old && $old['status'] !== 'done' && $status === 'done') {
                Activity::log($me['id'], 'task_done', 'task', $id, "hat „{$title}“ erledigt");
            }
            $assigneeChanged = $assignee !== null && (!$old || $old['assignee_id'] !== $assignee);
            if ($assigneeChanged && $assignee !== $me['id']) {
                $name = $me['name'];
                Http::defer(static fn () => Notify::users([$assignee], 'tasks', [
                    'title' => 'Neue Aufgabe für dich',
                    'body' => "{$name}: {$title}",
                    'url' => "/planung/$id",
                    'tag' => "task-$id",
                ]));
            }
            return self::task(Db::one('SELECT * FROM tasks WHERE id = ?', [$id]));
        });
    }

    private static function checklist(mixed $v): ?string
    {
        if (!is_array($v)) {
            return null;
        }
        $items = [];
        foreach (array_slice($v, 0, 100) as $item) {
            if (!is_array($item)) {
                continue;
            }
            $text = Util::str($item['text'] ?? '', 300);
            if ($text === null) {
                continue;
            }
            $items[] = [
                'id' => Util::str($item['id'] ?? Util::uuid(), 40),
                'text' => $text,
                'done' => !empty($item['done']),
            ];
        }
        return $items ? Util::json($items) : null;
    }

    // ---------- Notizen ----------

    public static function saveNote(array $me, string $id, array $in): array
    {
        if (!Util::isUuid($id)) {
            throw new HttpError(422, 'Ungültige ID.');
        }
        return Db::tx(function () use ($me, $id, $in) {
            $old = Db::one('SELECT * FROM notes WHERE id = ?', [$id]);
            $now = max(Util::now(), $old ? (int) $old['updated_at'] + 1 : 0);
            $row = [
                'id' => $id,
                'title' => Util::str($in['title'] ?? '', 300, false),
                'body' => Util::str($in['body'] ?? null, 200000),
                'pinned' => !empty($in['pinned']) ? 1 : 0,
                'color' => Util::oneOf($in['color'] ?? null, ['none', 'cream', 'blue', 'sage', 'rose', 'sand'], 'none'),
                'updated_by' => $me['id'],
                'updated_at' => $now,
                'deleted' => 0,
            ];
            if ($old) {
                Db::update('notes', $row, ['id' => $id]);
            } else {
                $row['created_by'] = $me['id'];
                $row['created_at'] = $now;
                Db::insert('notes', $row);
                $title = $row['title'] !== '' ? $row['title'] : 'eine Notiz';
                Activity::log($me['id'], 'note_created', 'note', $id, "hat „{$title}“ erstellt");
            }
            return self::note(Db::one('SELECT * FROM notes WHERE id = ?', [$id]));
        });
    }

    // ---------- Kommentare ----------

    public static function saveComment(array $me, string $id, array $in): array
    {
        if (!Util::isUuid($id)) {
            throw new HttpError(422, 'Ungültige ID.');
        }
        $body = Util::str($in['body'] ?? '', 5000, false);
        if ($body === '') {
            throw new HttpError(422, 'Kommentar ist leer.');
        }
        $task = Db::one('SELECT * FROM tasks WHERE id = ?', [$in['task_id'] ?? '']);
        if (!$task) {
            throw new HttpError(404, 'Aufgabe nicht gefunden.');
        }
        $old = Db::one('SELECT * FROM comments WHERE id = ?', [$id]);
        if ($old && $old['user_id'] !== $me['id']) {
            throw new HttpError(403, 'Nur eigene Kommentare können bearbeitet werden.');
        }
        $now = max(Util::now(), $old ? (int) $old['updated_at'] + 1 : 0);
        if ($old) {
            Db::update('comments', ['body' => $body, 'updated_at' => $now], ['id' => $id]);
        } else {
            Db::insert('comments', [
                'id' => $id,
                'task_id' => $task['id'],
                'user_id' => $me['id'],
                'body' => $body,
                'created_at' => $now,
                'updated_at' => $now,
                'deleted' => 0,
            ]);
            Activity::log($me['id'], 'comment', 'task', $task['id'], "hat „{$task['title']}“ kommentiert");
            $recipients = array_values(array_unique(array_filter(
                [$task['assignee_id'], $task['created_by']],
                static fn ($u) => $u !== null && $u !== $me['id']
            )));
            if ($recipients) {
                $name = $me['name'];
                Http::defer(static fn () => Notify::users($recipients, 'comments', [
                    'title' => "{$name} hat kommentiert",
                    'body' => "{$task['title']}: " . mb_substr($body, 0, 120),
                    'url' => "/planung/{$task['id']}",
                    'tag' => "task-{$task['id']}",
                ]));
            }
        }
        return self::comment(Db::one('SELECT * FROM comments WHERE id = ?', [$id]));
    }

    // ---------- E-Mails ----------

    public static function updateEmail(array $me, string $id, array $in): array
    {
        $mail = Db::one('SELECT * FROM emails WHERE id = ?', [$id]);
        if (!$mail || !MailJob::visibleTo($mail, $me['id'])) {
            throw new HttpError(404, 'Mail nicht gefunden.');
        }
        $private = (bool) $mail['owner_id'];
        $now = max(Util::now(), (int) $mail['updated_at'] + 1);
        $row = ['updated_at' => $now];
        if (array_key_exists('status', $in)) {
            $status = Util::oneOf($in['status'], ['open', 'done'], $mail['status']);
            $row['status'] = $status;
            if ($status === 'done' && $mail['status'] !== 'done') {
                $row['done_by'] = $me['id'];
                $row['done_at'] = $now;
                if (!$private) {
                    Activity::log($me['id'], 'mail_done', 'email', $id, 'hat die Mail „' . mb_substr((string) $mail['subject'], 0, 80) . '“ erledigt');
                }
            } elseif ($status === 'open') {
                $row['done_by'] = null;
                $row['done_at'] = null;
            }
        }
        if (array_key_exists('assignee_id', $in)) {
            $assignee = $in['assignee_id'];
            if ($private && $assignee !== null && $assignee !== $me['id']) {
                throw new HttpError(422, 'Mails aus deinem persönlichen Postfach können nicht weitergegeben werden.');
            }
            if ($assignee !== null && !Db::value('SELECT 1 FROM users WHERE id = ? AND deleted = 0', [$assignee])) {
                throw new HttpError(422, 'Unbekannte Person.');
            }
            $row['assignee_id'] = $assignee;
            if ($assignee !== null && $assignee !== $me['id'] && $assignee !== $mail['assignee_id']) {
                $name = $me['name'];
                Http::defer(static fn () => Notify::users([$assignee], 'mail', [
                    'title' => "{$name} hat dir eine Mail zugewiesen",
                    'body' => ($mail['from_name'] ?: $mail['from_email']) . ': ' . $mail['subject'],
                    'url' => '/postfach',
                    'tag' => "mail-$id",
                ]));
            }
        }
        Db::update('emails', $row, ['id' => $id]);
        return self::email(Db::one('SELECT * FROM emails WHERE id = ?', [$id]));
    }

    // ---------- Löschen ----------

    public static function softDelete(array $me, string $table, string $id): void
    {
        $row = Db::one("SELECT * FROM $table WHERE id = ?", [$id]);
        if (!$row) {
            return; // bereits weg – idempotent
        }
        if ($table === 'comments' && $row['user_id'] !== $me['id']) {
            throw new HttpError(403, 'Nur eigene Kommentare können gelöscht werden.');
        }
        Db::update($table, ['deleted' => 1, 'updated_at' => max(Util::now(), (int) $row['updated_at'] + 1)], ['id' => $id]);
        if ($table === 'tasks') {
            Activity::log($me['id'], 'task_deleted', 'task', $id, "hat „{$row['title']}“ gelöscht");
        }
    }

    // ---------- Ausgabeformate ----------

    public static function task(array $r): array
    {
        return [
            'id' => $r['id'],
            'title' => $r['title'],
            'description' => $r['description'],
            'status' => $r['status'],
            'priority' => $r['priority'],
            'category' => $r['category'],
            'assignee_id' => $r['assignee_id'],
            'due_date' => $r['due_date'],
            'position' => (float) $r['position'],
            'checklist' => $r['checklist'] ? json_decode($r['checklist'], true) : [],
            'source_email_id' => $r['source_email_id'],
            'completed_at' => $r['completed_at'] !== null ? (int) $r['completed_at'] : null,
            'created_by' => $r['created_by'],
            'updated_by' => $r['updated_by'],
            'created_at' => (int) $r['created_at'],
            'updated_at' => (int) $r['updated_at'],
            'deleted' => (int) $r['deleted'],
        ];
    }

    public static function note(array $r): array
    {
        return [
            'id' => $r['id'],
            'title' => $r['title'],
            'body' => $r['body'],
            'pinned' => (int) $r['pinned'],
            'color' => $r['color'],
            'created_by' => $r['created_by'],
            'updated_by' => $r['updated_by'],
            'created_at' => (int) $r['created_at'],
            'updated_at' => (int) $r['updated_at'],
            'deleted' => (int) $r['deleted'],
        ];
    }

    public static function comment(array $r): array
    {
        return [
            'id' => $r['id'],
            'task_id' => $r['task_id'],
            'user_id' => $r['user_id'],
            'body' => $r['body'],
            'created_at' => (int) $r['created_at'],
            'updated_at' => (int) $r['updated_at'],
            'deleted' => (int) $r['deleted'],
        ];
    }

    public static function email(array $r): array
    {
        return [
            'id' => $r['id'],
            'mailbox' => $r['mailbox'],
            'from_name' => $r['from_name'],
            'from_email' => $r['from_email'],
            'subject' => $r['subject'],
            'snippet' => $r['snippet'],
            'received_at' => (int) $r['received_at'],
            'seen' => (int) $r['seen'],
            'flagged' => (int) $r['flagged'],
            'answered' => (int) $r['answered'],
            'important' => (int) $r['important'],
            'reasons' => $r['reasons'] ? explode('|', $r['reasons']) : [],
            'score' => (int) $r['score'],
            'status' => $r['status'],
            'assignee_id' => $r['assignee_id'],
            'done_by' => $r['done_by'],
            'done_at' => $r['done_at'] !== null ? (int) $r['done_at'] : null,
            'owner_id' => $r['owner_id'] ?? null,
            'updated_at' => (int) $r['updated_at'],
            'deleted' => (int) $r['deleted'],
        ];
    }

    public static function activity(array $r): array
    {
        return [
            'id' => $r['id'],
            'user_id' => $r['user_id'],
            'type' => $r['type'],
            'entity_type' => $r['entity_type'],
            'entity_id' => $r['entity_id'],
            'text' => $r['text'],
            'created_at' => (int) $r['created_at'],
        ];
    }
}
