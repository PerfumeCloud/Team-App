<?php
declare(strict_types=1);

namespace Club;

/** Admin-Bereich für das Perfume-Cloud-Team. */
final class Admin
{
    public static function dashboard(): array
    {
        $jobs = Settings::get('jobs_status');
        return self::stats() + [
            'promotion' => Promotions::publicActive(),
            'next_promotion' => Promotions::publicNext(),
            'open_claims' => (int) Db::value("SELECT COUNT(*) FROM club_claims WHERE status = 'open'"),
            'push' => Push::stats(),
            'shop_program' => Settings::get('shop_program_status'),
            'jobs' => is_array($jobs) ? $jobs : null,
            'cron_last_run' => Settings::get('cron_last_run'),
            'checklist' => self::checklist(),
        ];
    }

    /**
     * Kennzahlen des Clubs – für das Dashboard und für die Statistik in der Team-App.
     * Punkte: gesammelt = alle Gutschriften (Bestellungen + Boni), eingelöst = in Codes umgewandelt (abzüglich Rückbuchungen).
     */
    public static function stats(): array
    {
        $now = Util::now();
        $day = Points::DAY_MS;
        $p = Points::program();
        $since30 = $now - 30 * $day;

        $members = (int) Db::value('SELECT COUNT(*) FROM club_members WHERE joined_at IS NOT NULL');
        $tiers = [];
        foreach (Points::program()['tiers'] as $t) {
            $tiers[$t['key']] = ['name' => $t['name'], 'count' => 0];
        }
        foreach (Db::all('SELECT tier, COUNT(*) AS n FROM club_members WHERE joined_at IS NOT NULL GROUP BY tier') as $r) {
            $key = isset($tiers[$r['tier']]) ? $r['tier'] : array_key_first($tiers);
            $tiers[$key]['count'] += (int) $r['n'];
        }

        $orderPts = static fn (string $where, array $params = []) => (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_orders WHERE $where", $params);
        $ledgerPts = static fn (string $where, array $params = []) => (int) Db::value("SELECT COALESCE(SUM(points), 0) FROM club_ledger WHERE $where", $params);
        $bonusWhere = "status = 'available' AND points > 0 AND kind NOT IN ('refund')";

        $earned = $orderPts("status = 'available'") + $ledgerPts($bonusWhere);
        $earned30 = $orderPts("status = 'available' AND available_at >= ?", [$since30]) + $ledgerPts("$bonusWhere AND credited_at >= ?", [$since30]);
        $redeemed = -$ledgerPts("kind = 'redeem'") - $ledgerPts("kind = 'refund'");
        $redeemed30 = -$ledgerPts("kind = 'redeem' AND created_at >= ?", [$since30]) - $ledgerPts("kind = 'refund' AND created_at >= ?", [$since30]);
        $available = $orderPts("status = 'available'") + $ledgerPts("status = 'available'");

        $bonus = [];
        foreach (Db::all("SELECT kind, COUNT(*) AS n, COALESCE(SUM(points), 0) AS pts FROM club_ledger WHERE status = 'available' AND points > 0 AND kind NOT IN ('refund', 'redeem') GROUP BY kind") as $r) {
            $bonus[$r['kind']] = ['count' => (int) $r['n'], 'points' => (int) $r['pts'], 'title' => Points::TITLES[$r['kind']] ?? $r['kind']];
        }

        $codes = [];
        foreach (Db::all("SELECT status, COUNT(*) AS n, COALESCE(SUM(value_cents), 0) AS v FROM club_codes WHERE status <> 'failed' GROUP BY status") as $r) {
            $codes[$r['status']] = ['count' => (int) $r['n'], 'cents' => (int) $r['v']];
        }
        $used30 = Db::one("SELECT COUNT(*) AS n, COALESCE(SUM(value_cents), 0) AS v FROM club_codes WHERE status = 'used' AND used_at >= ?", [$since30]);

        $orders = Db::one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM club_orders WHERE status <> 'void'");
        $orders30 = Db::one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM club_orders WHERE status <> 'void' AND ordered_at >= ?", [$since30]);

        // Beitritte je Monat (letzte 12 Monate)
        $months = [];
        $start = (new \DateTimeImmutable('first day of this month 00:00'))->modify('-11 months');
        for ($i = 0; $i < 12; $i++) {
            $months[$start->modify("+$i months")->format('Y-m')] = 0;
        }
        foreach (Db::all('SELECT joined_at FROM club_members WHERE joined_at >= ?', [$start->getTimestamp() * 1000]) as $r) {
            $k = date('Y-m', intdiv((int) $r['joined_at'], 1000));
            if (isset($months[$k])) {
                $months[$k]++;
            }
        }

        return [
            'members' => $members,
            'new_7' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE joined_at >= ?', [$now - 7 * $day]),
            'new_30' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE joined_at >= ?', [$since30]),
            'active_30' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE joined_at IS NOT NULL AND last_seen_at >= ?', [$since30]),
            'joins_by_month' => array_map(static fn ($k, $v) => ['month' => $k, 'count' => $v], array_keys($months), $months),
            'tiers' => array_map(static fn ($k, $v) => ['key' => $k] + $v, array_keys($tiers), $tiers),
            'points' => [
                'earned' => $earned,
                'earned_30' => $earned30,
                'redeemed' => $redeemed,
                'redeemed_30' => $redeemed30,
                'expired' => -$ledgerPts("kind = 'expire'"),
                'available' => $available,
                // Was die verfügbaren Punkte als Rabatt wert wären (offene Verbindlichkeit)
                'available_value_cents' => (int) floor(max(0, $available) / (int) $p['redeem_points']) * (int) $p['redeem_cents'],
                'pending' => $orderPts("status = 'pending'"),
                'locked' => $ledgerPts("status = 'locked'"),
            ],
            'bonus' => $bonus,
            'codes' => $codes,
            'codes_used_30' => ['count' => (int) $used30['n'], 'cents' => (int) $used30['v']],
            'orders' => ['count' => (int) $orders['n'], 'revenue_cents' => (int) $orders['c']],
            'orders_30' => ['count' => (int) $orders30['n'], 'revenue_cents' => (int) $orders30['c']],
            'push_members' => (int) Db::value('SELECT COUNT(DISTINCT member_id) FROM club_push_subs'),
            'feedback' => Feedback::stats(),
            'at' => $now,
        ];
    }

    /** Was für den Start noch fehlt. */
    public static function checklist(): array
    {
        $shopify = Settings::get('shopify_test');
        $login = Settings::get('login_test');
        $cron = (int) (Settings::get('cron_last_run') ?? 0);
        $shop = Settings::get('shop_program_status');
        return [
            ['key' => 'shopify', 'label' => 'Shopify-App verbunden', 'ok' => Shopify::configured() && is_array($shopify) && !empty($shopify['ok'])],
            ['key' => 'login', 'label' => 'Anmeldung eingerichtet (Shopify-Kundenkonto oder E-Mail-Code)', 'ok' => (CustomerAccount::configured() && is_array($login) && !empty($login['ok'])) || Auth::emailLoginEnabled()],
            ['key' => 'cron', 'label' => 'Cronjob läuft (alle 15 Minuten)', 'ok' => $cron > Util::now() - 2 * 3600 * 1000],
            ['key' => 'base_url', 'label' => 'Adresse der App gespeichert', 'ok' => (string) Config::get('base_url', '') !== ''],
            ['key' => 'mail', 'label' => 'E-Mail-Versand eingerichtet (Codes, Willkommen, Feedback)', 'ok' => Mailer::configured()],
            ['key' => 'shop_program', 'label' => 'Regeln im Shop (Metafeld club.programm)', 'ok' => is_array($shop) && !empty($shop['ok'])],
            ['key' => 'team_db', 'label' => 'Gemeinsame Datenbank mit der Team-App', 'ok' => Db::team()],
        ];
    }

    public static function members(string $q = '', int $limit = 100, string $tier = ''): array
    {
        $where = 'joined_at IS NOT NULL';
        $params = [];
        if ($q !== '') {
            $where .= ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR ref_code = ?)';
            $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $q) . '%';
            $params = [$like, $like, $like, strtoupper($q)];
        }
        if (in_array($tier, Tiers::KEYS, true)) {
            $where .= ' AND tier = ?';
            $params[] = $tier;
        }
        $rows = Db::all("SELECT * FROM club_members WHERE $where ORDER BY joined_at DESC LIMIT " . max(1, min(500, $limit)), $params);
        return array_map(static fn ($m) => self::memberRow($m), $rows);
    }

    private static function memberRow(array $m): array
    {
        $tier = Tiers::of($m);
        return [
            'id' => $m['id'],
            'email' => $m['email'],
            'name' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')),
            'joined_at' => (int) $m['joined_at'],
            'last_seen_at' => $m['last_seen_at'] !== null ? (int) $m['last_seen_at'] : null,
            'balance' => Points::balance($m['id']),
            'pending' => Points::pending($m['id']) + Points::locked($m['id']),
            'tier' => $tier['key'],
            'tier_name' => $tier['name'],
            'shopify_url' => self::adminUrl($m['shopify_id']),
        ];
    }

    public static function member(string $id): array
    {
        $m = Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$id]);
        if (!$m) {
            throw new HttpError(404, 'Mitglied nicht gefunden.');
        }
        $inviter = $m['referred_by'] ? Db::one('SELECT id, first_name, last_name, email FROM club_members WHERE id = ?', [$m['referred_by']]) : null;
        return [
            'member' => self::memberRow($m) + [
                'birthday' => $m['birthday'],
                'ref_code' => $m['ref_code'],
                'waitlist' => (bool) $m['waitlist'],
                'newsletter' => $m['newsletter_at'] !== null,
                'tier_until' => $m['tier_until'] !== null ? (int) $m['tier_until'] : null,
                'tier_spend_cents' => (int) $m['tier_spend_cents'],
                'referred_by' => $inviter ? ['id' => $inviter['id'], 'name' => trim(($inviter['first_name'] ?? '') . ' ' . ($inviter['last_name'] ?? '')) ?: $inviter['email']] : null,
                'invited' => (int) Db::value('SELECT COUNT(*) FROM club_members WHERE referred_by = ?', [$m['id']]),
                'devices' => Push::devices($m['id']),
                'expiring' => Expiry::next($m['id']),
            ],
            'history' => Points::history($m['id'], 300),
            'codes' => Points::codes($m['id']),
            'claims' => Bonus::claims($m['id']),
            'pushes' => array_map(static fn ($r) => [
                'title' => $r['title'],
                'body' => $r['body'],
                'status' => $r['status'],
                'error' => $r['error'],
                'at' => (int) ($r['sent_at'] ?? $r['created_at']),
            ], Db::all('SELECT title, body, status, error, sent_at, created_at FROM club_push_queue WHERE member_id = ? ORDER BY created_at DESC LIMIT 15', [$m['id']])),
            'tiers' => array_map(static fn ($t) => ['key' => $t['key'], 'name' => $t['name']], Points::program()['tiers']),
        ];
    }

    /** Stufe von Hand setzen (gilt für die eingestellte Dauer) oder Geburtstag korrigieren. */
    public static function updateMember(array $admin, string $id, array $in): array
    {
        $m = Db::one('SELECT * FROM club_members WHERE id = ? AND joined_at IS NOT NULL', [$id]);
        if (!$m) {
            throw new HttpError(404, 'Mitglied nicht gefunden.');
        }
        $update = [];
        if (array_key_exists('tier', $in)) {
            $tier = (string) $in['tier'];
            if (!in_array($tier, Tiers::KEYS, true)) {
                throw new HttpError(422, 'Unbekannte Stufe.');
            }
            if ($tier !== $m['tier']) {
                $months = (int) Points::program()['tier_months'];
                $update['tier'] = $tier;
                $update['tier_until'] = $tier === Tiers::KEYS[0] ? null : Expiry::addMonths(Util::now(), $months);
                $update['meta_dirty'] = 1;
            }
        }
        if (array_key_exists('birthday', $in)) {
            $b = trim((string) $in['birthday']);
            if ($b === '') {
                $update['birthday'] = null;
                $update['birthday_set_at'] = null;
            } else {
                if (!preg_match('/^(\d{2})-(\d{2})$/', $b, $mm) || !checkdate((int) $mm[1], (int) $mm[2], 2024)) {
                    throw new HttpError(422, 'Geburtstag bitte als MM-TT angeben, z. B. 04-23.');
                }
                $update['birthday'] = $b;
                // Vom Team gesetzt: gilt sofort (ohne 30 Tage Wartezeit)
                $update['birthday_set_at'] = Util::now() - 31 * Points::DAY_MS;
            }
        }
        if ($update) {
            $update['updated_at'] = Util::now();
            Db::update('club_members', $update, ['id' => $id]);
            Util::log('Admin ' . $admin['email'] . ' ändert Mitglied ' . $id . ': ' . implode(', ', array_keys($update)));
        }
        if (isset($update['tier'])) {
            Http::defer(static fn () => Points::pushMetafields());
        }
        return self::member($id);
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
            'admin_by_email' => (bool) Settings::get('admin_by_email', true),
            'smtp' => $smtp + ['has_password' => Settings::getSecret('smtp_password') !== null],
            'welcome_mail' => (bool) Settings::get('welcome_mail', true),
            'feedback_email' => Feedback::email(),
            'push_contact' => (string) (Settings::get('push_contact') ?? ''),
            'broadcast_four_eyes' => (bool) Settings::get('broadcast_four_eyes', false),
            'account_url' => Club::accountUrl(),
            'terms_url' => (string) (Settings::get('terms_url') ?? ''),
            'base_url' => Util::baseUrl(),
            'cron_url' => Util::baseUrl() . '/api/cron?key=' . rawurlencode((string) Config::get('cron_key', '')),
            'cron_cli' => APP_ROOT . '/app/bin/cron.php',
            'internal_key' => (string) (Settings::get('internal_key') ?? ''),
            'database' => TeamDb::status(),
            'shop_program' => Settings::get('shop_program_status'),
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
            ShopSync::markDirty();
        }
        if (is_array($in['login_shopify'] ?? null)) {
            CustomerAccount::save($in['login_shopify']);
            Settings::set('login_test', CustomerAccount::test());
        }
        foreach (['login_email', 'admin_by_email', 'welcome_mail', 'broadcast_four_eyes'] as $k) {
            if (array_key_exists($k, $in)) {
                Settings::set($k, (bool) $in[$k]);
            }
        }
        if (is_array($in['smtp'] ?? null)) {
            Mailer::save($in['smtp']);
        }
        foreach (['feedback_email', 'push_contact'] as $k) {
            if (array_key_exists($k, $in)) {
                $v = trim((string) $in[$k]);
                Settings::set($k, $v === '' ? null : Util::email($v));
            }
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
            Settings::set('app_url', Util::baseUrl());
        }
        return self::settings();
    }

    public static function testMail(array $admin): array
    {
        $p = Points::program();
        $html = Mailer::layout(
            $p['name'],
            'Test <i style="color:#80562F">erfolgreich</i>',
            '<p style="margin:0">Der Versand aus der Kunden-App funktioniert. So sehen Mails an Mitglieder aus.</p>',
            ['label' => 'App öffnen', 'url' => Util::baseUrl() . '/'],
            'Perfume Cloud · Testmail aus dem Admin-Bereich'
        );
        return Mailer::send($admin['email'], 'Test aus dem ' . $p['name'], 'Der Versand aus der Kunden-App funktioniert.', $html);
    }
}
