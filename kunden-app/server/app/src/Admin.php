<?php
declare(strict_types=1);

namespace Club;

/** Admin-Bereich für das Perfume-Cloud-Team. */
final class Admin
{
    public static function dashboard(): array
    {
        $now = Util::now();
        $day = 86400 * 1000;
        $p = Points::program();
        $members = (int) Db::value('SELECT COUNT(*) FROM members WHERE joined_at IS NOT NULL');
        $new30 = (int) Db::value('SELECT COUNT(*) FROM members WHERE joined_at >= ?', [$now - 30 * $day]);
        $available = (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE status = 'available'")
            + (int) Db::value('SELECT COALESCE(SUM(points), 0) FROM ledger');
        $pending = (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE status = 'pending'");
        $codes = [];
        foreach (Db::all("SELECT status, COUNT(*) AS n, COALESCE(SUM(value_cents), 0) AS v FROM codes WHERE status IN ('active', 'used', 'expired', 'cancelled') GROUP BY status") as $r) {
            $codes[$r['status']] = ['count' => (int) $r['n'], 'cents' => (int) $r['v']];
        }
        $revenue = (int) Db::value("SELECT COALESCE(SUM(amount_cents), 0) FROM club_orders WHERE status <> 'void'");
        $orders = (int) Db::value("SELECT COUNT(*) FROM club_orders WHERE status <> 'void'");
        $jobs = Settings::get('jobs_status');
        return [
            'members' => $members,
            'new_30' => $new30,
            'points_available' => $available,
            // Was die verfügbaren Punkte als Rabatt wert wären (offene Verbindlichkeit)
            'points_value_cents' => (int) floor(max(0, $available) / (int) $p['redeem_points']) * (int) $p['redeem_cents'],
            'points_pending' => $pending,
            'codes' => $codes,
            'club_orders' => $orders,
            'club_revenue_cents' => $revenue,
            'jobs' => is_array($jobs) ? $jobs : null,
            'cron_last_run' => Settings::get('cron_last_run'),
            'checklist' => self::checklist(),
        ];
    }

    /** Was für den Start noch fehlt. */
    public static function checklist(): array
    {
        $shopify = Settings::get('shopify_test');
        $login = Settings::get('login_test');
        $cron = (int) (Settings::get('cron_last_run') ?? 0);
        return [
            ['key' => 'shopify', 'label' => 'Shopify-App verbunden', 'ok' => Shopify::configured() && is_array($shopify) && !empty($shopify['ok'])],
            ['key' => 'login', 'label' => 'Anmeldung eingerichtet (Shopify-Kundenkonto oder E-Mail-Code)', 'ok' => (CustomerAccount::configured() && is_array($login) && !empty($login['ok'])) || Auth::emailLoginEnabled()],
            ['key' => 'cron', 'label' => 'Cronjob läuft (alle 15 Minuten)', 'ok' => $cron > Util::now() - 2 * 3600 * 1000],
            ['key' => 'base_url', 'label' => 'Adresse der App gespeichert', 'ok' => (string) Config::get('base_url', '') !== ''],
        ];
    }

    public static function members(string $q = '', int $limit = 100): array
    {
        $where = 'joined_at IS NOT NULL';
        $params = [];
        if ($q !== '') {
            $where .= ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
            $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $q) . '%';
            $params = [$like, $like, $like];
        }
        $rows = Db::all("SELECT * FROM members WHERE $where ORDER BY joined_at DESC LIMIT " . max(1, min(500, $limit)), $params);
        return array_map(static fn ($m) => self::memberRow($m), $rows);
    }

    private static function memberRow(array $m): array
    {
        return [
            'id' => $m['id'],
            'email' => $m['email'],
            'name' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')),
            'joined_at' => (int) $m['joined_at'],
            'last_seen_at' => $m['last_seen_at'] !== null ? (int) $m['last_seen_at'] : null,
            'balance' => Points::balance($m['id']),
            'pending' => Points::pending($m['id']),
            'shopify_url' => self::adminUrl($m['shopify_id']),
        ];
    }

    public static function member(string $id): array
    {
        $m = Db::one('SELECT * FROM members WHERE id = ?', [$id]);
        if (!$m) {
            throw new HttpError(404, 'Mitglied nicht gefunden.');
        }
        return [
            'member' => self::memberRow($m),
            'history' => Points::history($m['id'], 300),
            'codes' => Points::codes($m['id']),
        ];
    }

    /** Link zum Kunden im Shopify-Admin */
    private static function adminUrl(string $gid): ?string
    {
        $shop = Shopify::config()['shop'];
        $num = preg_replace('/\D/', '', $gid);
        if ($shop === '' || $num === '') {
            return null;
        }
        return 'https://admin.shopify.com/store/' . explode('.', $shop)[0] . '/customers/' . $num;
    }

    public static function settings(): array
    {
        $smtp = Mailer::config();
        return [
            'program' => Points::program(),
            'shopify' => Shopify::config() + ['has_secret' => Settings::getSecret('shopify_secret') !== null, 'test' => Settings::get('shopify_test')],
            'login_shopify' => CustomerAccount::config() + [
                'has_secret' => Settings::getSecret('login_shopify_secret') !== null,
                'redirect_uri' => CustomerAccount::redirectUri(),
                'logout_uri' => Util::baseUrl() . '/',
                'origin' => Util::baseUrl(),
                'test' => Settings::get('login_test'),
            ],
            'login_email' => (bool) Settings::get('login_email', false),
            'smtp' => $smtp + ['has_password' => Settings::getSecret('smtp_password') !== null],
            'account_url' => Club::accountUrl(),
            'terms_url' => (string) (Settings::get('terms_url') ?? ''),
            'base_url' => Util::baseUrl(),
            'cron_url' => Util::baseUrl() . '/api/cron?key=' . rawurlencode((string) Config::get('cron_key', '')),
            'cron_cli' => APP_ROOT . '/app/bin/cron.php',
            'version' => APP_VERSION,
        ];
    }

    public static function saveSettings(array $in): array
    {
        if (is_array($in['program'] ?? null)) {
            Points::saveProgram($in['program']);
        }
        if (is_array($in['shopify'] ?? null)) {
            Shopify::save($in['shopify']);
            Settings::set('shopify_test', Shopify::test());
        }
        if (is_array($in['login_shopify'] ?? null)) {
            CustomerAccount::save($in['login_shopify']);
            Settings::set('login_test', CustomerAccount::test());
        }
        if (array_key_exists('login_email', $in)) {
            Settings::set('login_email', (bool) $in['login_email']);
        }
        if (is_array($in['smtp'] ?? null)) {
            Mailer::save($in['smtp']);
        }
        foreach (['account_url', 'terms_url'] as $k) {
            if (array_key_exists($k, $in)) {
                $url = Util::str($in[$k], 300);
                if ($url !== null && !preg_match('#^https://#', $url)) {
                    throw new HttpError(422, 'Bitte eine vollständige Adresse mit https:// angeben.');
                }
                Settings::set($k, $url);
            }
        }
        // Die Adresse der App fest speichern (für Shopify-Rückleitung und Cron-Link)
        if ((string) Config::get('base_url', '') === '' && Util::isHttps()) {
            $cfg = Config::all();
            $cfg['base_url'] = Util::baseUrl();
            Config::write($cfg);
        }
        return self::settings();
    }

    public static function testMail(array $admin): array
    {
        return Mailer::send($admin['email'], 'Test aus dem ' . Points::program()['name'], 'Der Versand aus der Kunden-App funktioniert.');
    }
}
