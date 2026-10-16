<?php
declare(strict_types=1);

namespace PC;

/** Hintergrundarbeit: Mails abrufen, Bestellungen holen, Erinnerungen, Aufräumen. */
final class Jobs
{
    private const LOCK_STALE_MS = 10 * 60 * 1000;
    private const POKE_AFTER_MS = 4 * 60 * 1000;

    public const ALL = ['orders' => true, 'mail' => true, 'other' => true];

    /**
     * @param array{orders?:bool, mail?:bool, other?:bool} $parts Was laufen soll (der Sofort-Abruf
     *        holt Bestellungen öfter als den vollständigen Mail-Abgleich)
     */
    public static function run(string $trigger, array $parts = self::ALL): array
    {
        @set_time_limit(170);
        if ($trigger === 'cron') {
            // Der Cronjob hat sich gemeldet – auch wenn gerade noch ein Abgleich läuft
            Settings::set('cron_last_run', Util::now());
        }
        if (!self::lock()) {
            return ['skipped' => 'läuft bereits'];
        }
        $summary = ['trigger' => $trigger];
        try {
            if (!empty($parts['orders']) && Shopify::configured()) {
                $summary['shopify'] = self::safe(static fn () => OrdersJob::run(), 'shopify_status');
            }
            if (!empty($parts['mail']) && MailJob::mailboxes()) {
                $summary['mail'] = MailJob::run();
            }
            if (!empty($parts['other'])) {
                $summary['reminders'] = self::safe(static fn () => self::reminders(), null);
                $summary['events'] = self::safe(static fn () => Calendar::remind(), null);
                if (Shopify::configured()) {
                    $summary['shipping'] = self::safe(static fn () => Shipping::remind(), null);
                }
                if (Club::configured()) {
                    $summary['club_alerts'] = self::safe(static fn () => Club::pullAlerts(), null);
                }
                if (Instagram::connected()) {
                    $summary['instagram'] = self::safe(static fn () => Instagram::run(), null);
                }
                $summary['weekly'] = self::safe(static fn () => Reports::weeklyIfDue(), null);
                $summary['backup'] = self::safe(static fn () => Backup::nightly(), null);
                $summary['cleanup'] = self::safe(static fn () => self::cleanup(), null);
            }
            Settings::set('jobs_last_run', Util::now());
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
        // Mails (nur Betreff, Absender, Vorschau) – erledigte bleiben ein halbes Jahr unter „Erledigt“ zu finden
        Db::exec('DELETE FROM emails WHERE received_at < ?', [$now - 180 * $day]);
        Db::exec('DELETE FROM email_bodies WHERE fetched_at < ?', [$now - 30 * $day]);
        Db::exec('DELETE FROM customer_notes WHERE deleted = 1 AND updated_at < ?', [$now - 60 * $day]);
        foreach (['tasks', 'notes', 'comments'] as $t) {
            Db::exec("DELETE FROM $t WHERE deleted = 1 AND updated_at < ?", [$now - 60 * $day]);
        }
        Db::exec('DELETE FROM orders WHERE created_at < ?', [$now - 800 * $day]);
        InstagramPosts::cleanup();
        return 'ok';
    }
}
