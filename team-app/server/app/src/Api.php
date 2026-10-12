<?php
declare(strict_types=1);

namespace PC;

/** Alle Endpunkte unter /api. */
final class Api
{
    private const COLORS = ['blue', 'sage', 'rose', 'amber', 'plum', 'slate'];

    public static function handle(): void
    {
        try {
            $method = Http::method();
            if ($method !== 'GET' && $method !== 'HEAD' && ($_SERVER['HTTP_X_PC'] ?? '') !== '1' && !str_starts_with(Http::path(), '/cron')) {
                throw new HttpError(403, 'Ungültige Anfrage.');
            }
            [$handler, $params] = self::route($method, Http::path());
            $result = $handler(...$params);
            if ($result !== null) {
                Http::json($result);
            }
        } catch (HttpError $e) {
            Http::json(['error' => $e->getMessage()], $e->status);
        } catch (\Throwable $e) {
            Util::log('API-Fehler: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::json(['error' => 'Interner Fehler. Details stehen im Log (storage/app.log).'], 500);
        }
        Http::finish();
    }

    /** @return array{0:callable,1:array} */
    private static function route(string $method, string $path): array
    {
        $uuid = '([0-9a-f-]{36})';
        $routes = [
            ['GET', '/status', static fn () => Setup::status()],
            ['POST', '/setup', static fn () => ['user' => Setup::install(Http::body())]],

            ['POST', '/auth/login', static function () {
                $b = Http::body();
                $u = Auth::login((string) ($b['email'] ?? ''), (string) ($b['password'] ?? ''));
                return ['user' => Auth::publicUser($u)];
            }],
            // Einladung: Link aus der Mail → eigenes Passwort festlegen
            ['GET', '/auth/invite', static fn () => Team::inviteInfo((string) (Http::query('token') ?? ''))],
            ['POST', '/auth/invite', static function () {
                $b = Http::body();
                $u = Team::acceptInvite((string) ($b['token'] ?? ''), (string) ($b['password'] ?? ''));
                return ['user' => Auth::publicUser($u)];
            }],
            ['POST', '/auth/logout', static function () {
                Auth::logout();
                return ['ok' => true];
            }],

            ['GET', '/me', static function () {
                $me = Auth::require();
                return ['user' => Auth::publicUser($me), 'prefs' => Auth::prefs($me)];
            }],
            ['PUT', '/me', static fn () => self::updateMe(Auth::require(), Http::body())],

            // Persönliches Postfach – nur für die angemeldete Person sichtbar
            ['GET', '/me/mailbox', static fn () => self::myMailbox(Auth::require())],
            ['PUT', '/me/mailbox', static function () {
                $me = Auth::require();
                $mb = MailJob::savePersonal($me, Http::body());
                $test = MailJob::test($mb);
                Settings::set('mail_status_' . $mb['id'], ['ok' => $test['ok'], 'at' => Util::now(), 'message' => $test['message']]);
                if ($test['ok']) {
                    Http::defer(static fn () => Jobs::run('setup'));
                }
                return ['test' => $test] + self::myMailbox($me);
            }],
            ['DELETE', '/me/mailbox', static function () {
                $me = Auth::require();
                MailJob::removePersonal($me['id']);
                return self::myMailbox($me);
            }],

            ['GET', '/sync', static function () {
                $me = Auth::require();
                $result = Sync::pull($me, (int) (Http::query('since') ?? 0));
                Jobs::pokeIfDue();
                return $result;
            }],

            ['PUT', "/tasks/$uuid", static fn (string $id) => Sync::saveTask(Auth::require(), $id, Http::body())],
            ['DELETE', "/tasks/$uuid", static function (string $id) {
                Sync::softDelete(Auth::require(), 'tasks', $id);
                return ['ok' => true];
            }],
            ['PUT', "/notes/$uuid", static fn (string $id) => Sync::saveNote(Auth::require(), $id, Http::body())],
            ['DELETE', "/notes/$uuid", static function (string $id) {
                Sync::softDelete(Auth::require(), 'notes', $id);
                return ['ok' => true];
            }],
            ['PUT', "/comments/$uuid", static fn (string $id) => Sync::saveComment(Auth::require(), $id, Http::body())],
            ['DELETE', "/comments/$uuid", static function (string $id) {
                Sync::softDelete(Auth::require(), 'comments', $id);
                return ['ok' => true];
            }],
            ['PUT', "/events/$uuid", static fn (string $id) => Calendar::save(Auth::require(), $id, Http::body())],
            ['DELETE', "/events/$uuid", static function (string $id) {
                Sync::softDelete(Auth::require(), 'events', $id);
                return ['ok' => true];
            }],

            // Kalender-Abo (iCalendar) für Apple-Kalender, Outlook, Google
            ['GET', '/kalender/feed', static function () {
                $user = Calendar::userForToken((string) (Http::query('token') ?? ''));
                if (!$user) {
                    throw new HttpError(401, 'Kalender-Link ungültig. Bitte in der App unter Einstellungen neu erstellen.');
                }
                header('Content-Type: text/calendar; charset=utf-8');
                header('Content-Disposition: inline; filename="perfume-cloud.ics"');
                header('Cache-Control: no-cache');
                echo Calendar::ics($user);
                return null;
            }],
            ['GET', '/kalender/abo', static fn () => ['active' => Calendar::hasToken(Auth::require())]],
            ['POST', '/kalender/abo', static function () {
                $token = Calendar::createToken(Auth::require());
                $url = Util::baseUrl() . '/api/kalender/feed?token=' . $token;
                return ['token' => $token, 'url' => $url, 'webcal' => preg_replace('#^https?://#', 'webcal://', $url)];
            }],
            ['DELETE', '/kalender/abo', static function () {
                Calendar::revoke(Auth::require());
                return ['ok' => true];
            }],

            ['PATCH', '/emails/([0-9a-f]{40})', static fn (string $id) => Sync::updateEmail(Auth::require(), $id, Http::body())],

            ['GET', '/stats', static function () {
                Auth::require();
                return Stats::compute((int) (Http::query('days') ?? 30));
            }],

            ['GET', '/push/key', static function () {
                Auth::require();
                return ['publicKey' => WebPush::keys()['public']];
            }],
            ['POST', '/push/subscribe', static fn () => self::subscribe(Auth::require(), Http::body())],
            ['POST', '/push/unsubscribe', static function () {
                $me = Auth::require();
                $endpoint = (string) (Http::body()['endpoint'] ?? '');
                Db::exec('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', [hash('sha256', $endpoint), $me['id']]);
                return ['ok' => true];
            }],
            ['POST', '/push/test', static function () {
                $me = Auth::require();
                $n = Notify::toUser($me, ['title' => 'Push funktioniert ✓', 'body' => 'So sehen Benachrichtigungen der Team-App aus.', 'url' => '/einstellungen', 'tag' => 'test']);
                return ['sent' => $n];
            }],

            ['GET', '/widget', static function () {
                $user = Widget::userForToken((string) (Http::query('token') ?? ''));
                if (!$user) {
                    throw new HttpError(401, 'Widget-Schlüssel ungültig. Bitte in der App unter Einstellungen neu einrichten.');
                }
                return Widget::summary($user);
            }],
            ['GET', '/widget/status', static fn () => ['active' => Widget::hasToken(Auth::require())]],
            ['POST', '/widget/token', static fn () => ['token' => Widget::createToken(Auth::require())]],
            ['DELETE', '/widget/token', static function () {
                Widget::revoke(Auth::require());
                return ['ok' => true];
            }],

            ['GET', '/cron', static function () {
                $key = (string) Config::get('cron_key', '');
                if ($key === '' || !hash_equals($key, (string) (Http::query('key') ?? ''))) {
                    throw new HttpError(403, 'Falscher Schlüssel.');
                }
                return Jobs::run('cron');
            }],

            // ---- Admin ----
            ['GET', '/admin/integrations', static function () {
                Auth::requireAdmin();
                return self::integrations();
            }],
            ['PUT', '/admin/shopify', static function () {
                Auth::requireAdmin();
                Shopify::save(Http::body());
                $test = Shopify::test();
                if ($test['ok']) {
                    Settings::delete('orders_cursor');
                    Http::defer(static fn () => Jobs::run('setup'));
                }
                return ['test' => $test] + self::integrations();
            }],
            ['DELETE', '/admin/shopify', static function () {
                Auth::requireAdmin();
                Settings::delete('shopify');
                Settings::delete('shopify_secret');
                Settings::delete('shopify_token');
                return self::integrations();
            }],
            ['PUT', '/admin/mailboxes', static function () {
                Auth::requireAdmin();
                $list = MailJob::save(is_array(Http::body()['mailboxes'] ?? null) ? Http::body()['mailboxes'] : []);
                $tests = [];
                foreach ($list as $mb) {
                    $tests[$mb['id']] = MailJob::test($mb);
                    Settings::set('mail_status_' . $mb['id'], ['ok' => $tests[$mb['id']]['ok'], 'at' => Util::now(), 'message' => $tests[$mb['id']]['message']]);
                }
                if ($list) {
                    Http::defer(static fn () => Jobs::run('setup'));
                }
                return ['tests' => $tests] + self::integrations();
            }],
            ['POST', '/admin/jobs', static function () {
                Auth::requireAdmin();
                return ['summary' => Jobs::run('manual')] + self::integrations();
            }],
            ['PUT', '/admin/settings', static function () {
                Auth::requireAdmin();
                $b = Http::body();
                if (array_key_exists('holiday_state', $b)) {
                    Settings::set('holiday_state', in_array($b['holiday_state'], Holidays::STATES, true) ? $b['holiday_state'] : '');
                }
                if (isset($b['holidays_on'])) {
                    Settings::set('holidays_on', (bool) $b['holidays_on']);
                }
                if (isset($b['shop_days_on'])) {
                    Settings::set('shop_days_on', (bool) $b['shop_days_on']);
                }
                if (isset($b['low_stock_threshold'])) {
                    Settings::set('low_stock_threshold', max(0, min(1000, (int) $b['low_stock_threshold'])));
                }
                if (array_key_exists('base_url', $b)) {
                    $cfg = Config::all();
                    $cfg['base_url'] = rtrim(Util::str($b['base_url'], 190) ?? '', '/');
                    Config::write($cfg);
                }
                return self::integrations();
            }],
            ['POST', '/admin/users', static function () {
                $r = Team::create(Auth::requireAdmin(), Http::body());
                return ['user' => Auth::publicUser($r['user']), 'restored' => $r['restored'], 'invite' => $r['invite']];
            }],
            ['POST', "/admin/users/$uuid/invite", static function (string $id) {
                $me = Auth::requireAdmin();
                $u = Db::one('SELECT * FROM users WHERE id = ? AND deleted = 0', [$id]);
                if (!$u) {
                    throw new HttpError(404, 'Person nicht gefunden.');
                }
                return Team::invite($me, $u);
            }],
            ['POST', "/admin/users/$uuid/restore", static fn (string $id) => ['user' => Auth::publicUser(Team::restore(Auth::requireAdmin(), $id))]],
            ['GET', '/admin/maintenance', static function () {
                Auth::requireAdmin();
                return Team::diagnostics();
            }],
            ['POST', '/admin/maintenance', static function () {
                Auth::requireAdmin();
                $log = Team::repair();
                Http::defer(static fn () => Jobs::run('wartung'));
                return ['log' => $log] + Team::diagnostics();
            }],
            ['PUT', "/admin/users/$uuid", static fn (string $id) => self::updateUser(Auth::requireAdmin(), $id, Http::body())],
            ['DELETE', "/admin/users/$uuid", static function (string $id) {
                $me = Auth::requireAdmin();
                if ($id === $me['id']) {
                    throw new HttpError(422, 'Du kannst dich nicht selbst entfernen.');
                }
                Db::update('users', ['deleted' => 1, 'updated_at' => Util::now()], ['id' => $id]);
                MailJob::removePersonal($id);
                $invites = (array) Settings::get('invite_tokens', []);
                unset($invites[$id]);
                Settings::set('invite_tokens', $invites);
                Db::exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
                Db::exec('DELETE FROM push_subscriptions WHERE user_id = ?', [$id]);
                return ['ok' => true];
            }],
        ];

        foreach ($routes as [$m, $pattern, $handler]) {
            if ($m === $method && preg_match('#^' . $pattern . '$#', $path, $match)) {
                return [$handler, array_slice($match, 1)];
            }
        }
        throw new HttpError(404, 'Unbekannter Endpunkt.');
    }

    private static function updateMe(array $me, array $b): array
    {
        $row = ['updated_at' => Util::now()];
        if (isset($b['name'])) {
            $name = Util::str($b['name'], 100, false);
            if ($name === '') {
                throw new HttpError(422, 'Name darf nicht leer sein.');
            }
            $row['name'] = $name;
        }
        if (isset($b['color'])) {
            $row['color'] = Util::oneOf($b['color'], self::COLORS, $me['color']);
        }
        if (isset($b['prefs']) && is_array($b['prefs'])) {
            $prefs = Auth::prefs($me);
            foreach (array_keys($prefs['push']) as $k) {
                if (isset($b['prefs']['push'][$k])) {
                    $prefs['push'][$k] = (bool) $b['prefs']['push'][$k];
                }
            }
            if (isset($b['prefs']['mailScope'])) {
                $prefs['mailScope'] = Util::oneOf($b['prefs']['mailScope'], ['all', 'everything', 'important'], $prefs['mailScope']);
            }
            $row['prefs'] = Util::json($prefs);
        }
        if (!empty($b['newPassword'])) {
            if (!password_verify((string) ($b['currentPassword'] ?? ''), $me['password_hash'])) {
                throw new HttpError(422, 'Das aktuelle Passwort ist falsch.');
            }
            $row['password_hash'] = Auth::hashPassword((string) $b['newPassword']);
        }
        Db::update('users', $row, ['id' => $me['id']]);
        $u = Db::one('SELECT * FROM users WHERE id = ?', [$me['id']]);
        return ['user' => Auth::publicUser($u), 'prefs' => Auth::prefs($u)];
    }

    private static function myMailbox(array $me): array
    {
        $mb = MailJob::personal($me['id']);
        $team = MailJob::mailboxes();
        return [
            'mailbox' => $mb ? [
                'email' => $mb['email'],
                'host' => $mb['host'],
                'port' => (int) $mb['port'],
                'security' => $mb['security'],
                'user' => $mb['user'],
                'hasPassword' => MailJob::password($mb['id']) !== null,
                'status' => Settings::get('mail_status_' . $mb['id']),
            ] : null,
            // Vorschlag für den IMAP-Server: derselbe wie bei info@/support@
            'suggestedHost' => $team[0]['host'] ?? '',
            'lastFetch' => (int) Settings::get('mail_last_fetch', 0),
        ];
    }

    private static function updateUser(array $me, string $id, array $b): array
    {
        $u = Db::one('SELECT * FROM users WHERE id = ? AND deleted = 0', [$id]);
        if (!$u) {
            throw new HttpError(404, 'Person nicht gefunden.');
        }
        $row = ['updated_at' => Util::now()];
        if (isset($b['name'])) {
            $row['name'] = Util::str($b['name'], 100, false) ?: $u['name'];
        }
        if (isset($b['role']) && $id !== $me['id']) {
            $row['role'] = Util::oneOf($b['role'], ['admin', 'member'], $u['role']);
        }
        if (!empty($b['password'])) {
            $row['password_hash'] = Auth::hashPassword((string) $b['password']);
            Db::exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
        }
        Db::update('users', $row, ['id' => $id]);
        return ['user' => Auth::publicUser(Db::one('SELECT * FROM users WHERE id = ?', [$id]))];
    }

    private static function subscribe(array $me, array $b): array
    {
        $endpoint = (string) ($b['endpoint'] ?? '');
        $p256dh = (string) ($b['keys']['p256dh'] ?? '');
        $auth = (string) ($b['keys']['auth'] ?? '');
        if (!preg_match('#^https://#', $endpoint) || $p256dh === '' || $auth === '') {
            throw new HttpError(422, 'Ungültiges Push-Abo.');
        }
        $id = hash('sha256', $endpoint);
        Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$id]);
        Db::insert('push_subscriptions', [
            'id' => $id,
            'user_id' => $me['id'],
            'endpoint' => $endpoint,
            'p256dh' => $p256dh,
            'auth' => $auth,
            'user_agent' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250),
            'created_at' => Util::now(),
            'last_ok_at' => null,
            'fail_count' => 0,
        ]);
        return ['ok' => true];
    }

    private static function integrations(): array
    {
        $shop = Shopify::config();
        $mailboxes = array_map(static function ($m) {
            return $m + [
                'hasPassword' => MailJob::password($m['id']) !== null,
                'status' => Settings::get('mail_status_' . $m['id']),
            ];
        }, MailJob::mailboxes());
        $cronKey = (string) Config::get('cron_key', '');
        return [
            'shopify' => [
                'shop' => $shop['shop'],
                'client_id' => $shop['client_id'],
                'hasSecret' => Settings::getSecret('shopify_secret') !== null,
                'configured' => Shopify::configured(),
                'status' => Settings::get('shopify_status'),
                'lastSync' => (int) Settings::get('orders_last_sync', 0),
                'apiVersion' => Shopify::API_VERSION,
            ],
            'mailboxes' => $mailboxes,
            'cron' => [
                'url' => Util::baseUrl() . '/api/cron?key=' . $cronKey,
                'lastRun' => (int) Settings::get('cron_last_run', 0),
                'jobsLastRun' => (int) Settings::get('jobs_last_run', 0),
            ],
            'settings' => [
                'low_stock_threshold' => (int) Settings::get('low_stock_threshold', 5),
                'holiday_state' => Holidays::config()['state'],
                'holidays_on' => Holidays::config()['holidays'],
                'shop_days_on' => Holidays::config()['shop'],
                'base_url' => (string) Config::get('base_url', ''),
            ],
            'pushDevices' => (int) Db::value('SELECT COUNT(*) FROM push_subscriptions'),
        ];
    }
}
