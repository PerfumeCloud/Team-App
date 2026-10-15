<?php
declare(strict_types=1);

namespace Club;

/**
 * Hintergrundarbeit (Cronjob alle 15 Minuten, sonst nach App-Aufrufen nachgeholt):
 * Bestellungen abgleichen, Versand verfolgen, Punkte freigeben, Codes prüfen, tägliche Aufgaben
 * (Verfall, Stufen, Geburtstage), Aktionen und Nachrichten verschicken, Kontostände an Shopify.
 */
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
        $shop = Shopify::configured();
        try {
            // Die Team-App und Mails brauchen die Adresse der App auch ohne Web-Anfrage
            if ((string) Config::get('base_url', '') !== '' && Settings::get('app_url') !== Util::baseUrl()) {
                Settings::set('app_url', Util::baseUrl());
            }
            if ($shop) {
                $summary['orders'] = self::safe(static fn () => Points::syncRecent(), $errors);
                $summary['deliveries'] = self::safe(static fn () => Points::trackDeliveries(), $errors);
                $summary['survey_track'] = self::safe(static fn () => Surveys::track(), $errors);
            }
            $summary['released'] = self::safe(static fn () => Points::release() . ' freigegeben', $errors);
            $summary['referrals'] = self::safe(static fn () => Referrals::release(), $errors);
            $summary['surveys'] = self::safe(static fn () => Surveys::run(), $errors);
            if ($shop) {
                $summary['codes'] = self::safe(static fn () => Points::checkCodes(), $errors);
            }
            if (self::due('daily_last', 'Y-m-d')) {
                $summary['expiry'] = self::safe(static fn () => Expiry::run(), $errors);
                $summary['tiers'] = self::safe(static fn () => Tiers::runDaily(), $errors);
                $summary['birthdays'] = self::safe(static fn () => Bonus::runBirthdays(), $errors);
                $summary['code_warnings'] = self::safe(static fn () => Points::warnCodes() . ' Hinweise', $errors);
                $summary['survey_cleanup'] = self::safe(static fn () => Surveys::cleanup(), $errors);
            }
            if ($shop && self::due('hourly_last', 'Y-m-d H')) {
                $summary['newsletter'] = self::safe(static fn () => Bonus::runNewsletter(), $errors);
            }
            $summary['promotions'] = self::safe(static fn () => Promotions::runStarts(), $errors);
            $summary['broadcasts'] = self::safe(static fn () => Broadcasts::run(), $errors);
            $summary['invites'] = self::safe(static fn () => Invites::run(), $errors);
            $summary['push'] = self::safe(static fn () => Push::flush(), $errors);
            if ($shop) {
                $summary['referral_codes'] = self::safe(static fn () => Referrals::syncCodes(), $errors);
                $summary['metafields'] = self::safe(static fn () => Points::pushMetafields(), $errors);
                $summary['shop'] = self::safe(static fn () => ShopSync::run(), $errors);
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

    /** Einmal je Zeitraum (Tag bzw. Stunde, Ortszeit). */
    private static function due(string $key, string $format): bool
    {
        $now = date($format);
        if (Settings::get($key) === $now) {
            return false;
        }
        Settings::set($key, $now);
        return true;
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
            "UPDATE club_settings SET v = '1', updated_at = ? WHERE k = 'jobs_lock' AND (v <> '1' OR updated_at < ?)",
            [$now, $now - self::LOCK_STALE_MS]
        ) === 1;
    }

    private static function unlock(): void
    {
        Db::exec("UPDATE club_settings SET v = '0', updated_at = ? WHERE k = 'jobs_lock'", [Util::now()]);
    }

    private static function cleanup(): string
    {
        $now = Util::now();
        $day = Points::DAY_MS;
        Db::exec('DELETE FROM club_sessions WHERE expires_at < ?', [$now]);
        Db::exec('DELETE FROM club_oauth_states WHERE created_at < ?', [$now - 3600 * 1000]);
        Db::exec('DELETE FROM club_login_codes WHERE expires_at < ?', [$now]);
        Db::exec('DELETE FROM club_attempts WHERE created_at < ?', [$now - $day]);
        Db::exec('DELETE FROM club_order_cache WHERE fetched_at < ?', [$now - 7 * $day]);
        Db::exec('DELETE FROM club_sso WHERE expires_at < ?', [$now]);
        // Abgebrochene Läufe: Push nicht doppelt schicken, Nachrichten an Mitglieder erneut anstoßen (Dedupe schützt)
        Db::exec("UPDATE club_push_queue SET status = 'failed', error = 'Versand abgebrochen' WHERE status = 'sending' AND created_at < ?", [$now - 3600 * 1000]);
        Db::exec("UPDATE club_broadcasts SET status = 'approved' WHERE status = 'sending' AND updated_at < ?", [$now - 15 * 60 * 1000]);
        // Versandprotokoll 90 Tage; Einträge mit Dedupe-Schlüssel (z. B. Geburtstag, Aktionen) ein Jahr
        Db::exec("DELETE FROM club_push_queue WHERE status <> 'queued' AND created_at < ? AND (dedupe IS NULL OR created_at < ?)", [$now - 90 * $day, $now - 400 * $day]);
        return 'ok';
    }
}
