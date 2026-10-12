<?php
declare(strict_types=1);

namespace PC;

/** Hintergrundarbeit: Mails abrufen, Bestellungen holen, Erinnerungen, Aufräumen. */
final class Jobs
{
    private const LOCK_STALE_MS = 10 * 60 * 1000;
    private const POKE_AFTER_MS = 4 * 60 * 1000;

    public static function run(string $trigger): array
    {
        @set_time_limit(170);
        if (!self::lock()) {
            return ['skipped' => 'läuft bereits'];
        }
        $summary = ['trigger' => $trigger];
        try {
            if (Shopify::configured()) {
                $summary['shopify'] = self::safe(static fn () => OrdersJob::run(), 'shopify_status');
            }
            if (MailJob::mailboxes()) {
                $summary['mail'] = MailJob::run();
            }
            $summary['reminders'] = self::safe(static fn () => self::reminders(), null);
            $summary['cleanup'] = self::safe(static fn () => self::cleanup(), null);
            Settings::set('jobs_last_run', Util::now());
            if ($trigger === 'cron') {
                Settings::set('cron_last_run', Util::now());
            }
        } finally {
            self::unlock();
        }
        return $summary;
    }

    /** Läuft nach einer Sync-Anfrage, falls der Cronjob länger nicht lief (Fallback). */
    public static function pokeIfDue(): void
    {
        $last = (int) Settings::get('jobs_last_run', 0);
        if (Util::now() - $last > self::POKE_AFTER_MS) {
            Http::defer(static fn () => self::run('app'));
        }
    }

    private static function safe(callable $fn, ?string $statusKey): string
    {
        try {
            $result = (string) $fn();
            if ($statusKey) {
                Settings::set($statusKey, ['ok' => true, 'at' => Util::now(), 'message' => $result]);
            }
            return $result;
        } catch (\Throwable $e) {
            Util::log($e->getMessage());
            if ($statusKey) {
                Settings::set($statusKey, ['ok' => false, 'at' => Util::now(), 'message' => $e->getMessage()]);
            }
            return 'Fehler: ' . $e->getMessage();
        }
    }

    private static function lock(): bool
    {
        $now = Util::now();
        return Db::exec(
            "UPDATE settings SET v = '1', updated_at = ? WHERE k = 'jobs_lock' AND (v <> '1' OR updated_at < ?)",
            [$now, $now - self::LOCK_STALE_MS]
        ) === 1;
    }

    private static function unlock(): void
    {
        Db::exec("UPDATE settings SET v = '0', updated_at = ? WHERE k = 'jobs_lock'", [Util::now()]);
    }

    /** Morgens ab 8 Uhr: Wer hat heute fällige oder überfällige Aufgaben? */
    private static function reminders(): string
    {
        $today = date('Y-m-d');
        if ((int) date('G') < 8 || Settings::get('reminder_date') === $today) {
            return '–';
        }
        Settings::set('reminder_date', $today);
        $sent = 0;
        foreach (Db::all('SELECT * FROM users WHERE deleted = 0') as $u) {
            $tasks = Db::all(
                "SELECT title, due_date FROM tasks WHERE deleted = 0 AND status <> 'done' AND assignee_id = ? AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date",
                [$u['id'], $today]
            );
            if (!$tasks) {
                continue;
            }
            $overdue = count(array_filter($tasks, static fn ($t) => $t['due_date'] < $today));
            $title = count($tasks) === 1 ? '1 Aufgabe für heute' : count($tasks) . ' Aufgaben für heute';
            if ($overdue) {
                $title .= " · $overdue überfällig";
            }
            $sent += Notify::users([$u['id']], 'reminders', [
                'title' => $title,
                'body' => implode(' · ', array_map(static fn ($t) => $t['title'], array_slice($tasks, 0, 3))),
                'url' => '/planung',
                'tag' => 'reminder-' . $today,
            ]);
        }
        return "$sent Erinnerungen";
    }

    private static function cleanup(): string
    {
        $today = date('Y-m-d');
        if (Settings::get('cleanup_date') === $today) {
            return '–';
        }
        Settings::set('cleanup_date', $today);
        $now = Util::now();
        $day = 86400 * 1000;
        Db::exec('DELETE FROM sessions WHERE expires_at < ?', [$now]);
        Db::exec('DELETE FROM login_attempts WHERE created_at < ?', [$now - $day]);
        Db::exec('DELETE FROM activity WHERE created_at < ?', [$now - 90 * $day]);
        Db::exec('DELETE FROM emails WHERE received_at < ?', [$now - 30 * $day]);
        foreach (['tasks', 'notes', 'comments'] as $t) {
            Db::exec("DELETE FROM $t WHERE deleted = 1 AND updated_at < ?", [$now - 60 * $day]);
        }
        Db::exec('DELETE FROM orders WHERE created_at < ?', [$now - 800 * $day]);
        return 'ok';
    }
}
