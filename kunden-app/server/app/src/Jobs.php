<?php
declare(strict_types=1);

namespace Club;

/** Hintergrundarbeit: Bestellungen abgleichen, Punkte freigeben, Codes prüfen, Kontostände an Shopify. */
final class Jobs
{
    private const LOCK_STALE_MS = 10 * 60 * 1000;
    private const POKE_AFTER_MS = 10 * 60 * 1000;

    public static function run(string $trigger): array
    {
        @set_time_limit(170);
        if (!self::lock()) {
            return ['skipped' => 'läuft bereits'];
        }
        $summary = ['trigger' => $trigger];
        $errors = [];
        try {
            if (Shopify::configured()) {
                $summary['orders'] = self::safe(static fn () => Points::syncRecent(), $errors);
            }
            $summary['released'] = self::safe(static fn () => Points::release() . ' freigegeben', $errors);
            if (Shopify::configured()) {
                $summary['codes'] = self::safe(static fn () => Points::checkCodes(), $errors);
                $summary['metafields'] = self::safe(static fn () => Points::pushMetafields(), $errors);
            }
            $summary['cleanup'] = self::safe(static fn () => self::cleanup(), $errors);
            Settings::set('jobs_status', ['ok' => !$errors, 'at' => Util::now(), 'trigger' => $trigger, 'summary' => $summary, 'errors' => $errors]);
            if ($trigger === 'cron') {
                Settings::set('cron_last_run', Util::now());
            }
        } finally {
            self::unlock();
        }
        return $summary;
    }

    /** Falls der Cronjob nicht eingerichtet ist: nach einer Anfrage im Hintergrund nachholen. */
    public static function pokeIfDue(): void
    {
        $status = Settings::get('jobs_status');
        $last = is_array($status) ? (int) ($status['at'] ?? 0) : 0;
        if (Util::now() - $last > self::POKE_AFTER_MS) {
            Http::defer(static fn () => self::run('app'));
        }
    }

    private static function safe(callable $fn, array &$errors): string
    {
        try {
            return (string) $fn();
        } catch (\Throwable $e) {
            Util::log('Job: ' . $e->getMessage());
            $errors[] = $e->getMessage();
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

    private static function cleanup(): string
    {
        $now = Util::now();
        Db::exec('DELETE FROM sessions WHERE expires_at < ?', [$now]);
        Db::exec('DELETE FROM oauth_states WHERE created_at < ?', [$now - 3600 * 1000]);
        Db::exec('DELETE FROM login_codes WHERE expires_at < ?', [$now]);
        Db::exec('DELETE FROM attempts WHERE created_at < ?', [$now - 86400 * 1000]);
        Db::exec('DELETE FROM order_cache WHERE fetched_at < ?', [$now - 7 * 86400 * 1000]);
        return 'ok';
    }
}
