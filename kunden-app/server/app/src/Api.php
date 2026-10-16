<?php
declare(strict_types=1);

namespace Club;

/** Alle Endpunkte unter /api. */
final class Api
{
    public static function handle(): void
    {
        try {
            $method = Http::method();
            $path = Http::path();
            $internal = str_starts_with($path, '/internal/');
            if ($internal) {
                // Team-App → Club (Server zu Server): gemeinsamer Schlüssel statt Sitzung
                $key = (string) (Settings::get('internal_key') ?? '');
                if ($key === '' || !hash_equals($key, (string) ($_SERVER['HTTP_X_CLUB_KEY'] ?? ''))) {
                    throw new HttpError(403, 'Ungültiger Schlüssel.');
                }
            } elseif ($method !== 'GET' && $method !== 'HEAD' && ($_SERVER['HTTP_X_PC'] ?? '') !== '1' && !preg_match('#^/abmelden/[0-9a-f]{32}$#', $path)) {
                // Ausnahme: Abmelden mit einem Klick aus dem Mailprogramm (List-Unsubscribe-Post, RFC 8058) – ändert nur den Widerspruch
                // Schutz gegen Anfragen von fremden Seiten: Schreibende Anfragen brauchen den eigenen Header
                throw new HttpError(403, 'Ungültige Anfrage.');
            }
            // Vorschau „Als Mitglied ansehen“: nur lesen
            if (isset($_SERVER['HTTP_X_ALS']) && $method !== 'GET' && !str_starts_with($path, '/admin/')) {
                throw new HttpError(403, 'In der Vorschau kannst du nichts ändern.');
            }
            [$handler, $params] = self::route($method, $path);
            $result = $handler(...$params);
            if ($result !== null) {
                Http::json($result);
            }
        } catch (HttpError $e) {
            Http::json(['error' => $e->getMessage()], $e->status);
        } catch (\Throwable $e) {
            Util::log('API-Fehler: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::json(['error' => 'Da ist etwas schiefgelaufen. Bitte versuche es gleich noch einmal.'], 500);
        }
        Http::finish();
    }

    private static function redirect(string $url): ?array
    {
        header('Location: ' . $url, true, 302);
        header('Cache-Control: no-store');
        return null;
    }

    /** Person aus der Team-App (bei internen Aufrufen im Body unter „user“). */
    private static function teamUser(): array
    {
        $u = Http::body()['user'] ?? null;
        if (!is_array($u) || !is_string($u['id'] ?? null) || $u['id'] === '') {
            throw new HttpError(422, 'Person aus der Team-App fehlt.');
        }
        return ['id' => mb_substr($u['id'], 0, 36), 'name' => Util::str($u['name'] ?? 'Team', 100, false) ?: 'Team', 'email' => (string) ($u['email'] ?? '')];
    }

    /** @return array{0:callable,1:array} */
    private static function route(string $method, string $path): array
    {
        $uuid = '([0-9a-f-]{36})';
        $routes = [
            ['GET', '/status', static fn () => self::status()],
            ['POST', '/setup', static fn () => ['admin' => Setup::install(Http::body())]],

            // ----- Anmeldung mit dem Shopify-Kundenkonto -----
            ['GET', '/auth/shopify/start', static function () {
                try {
                    return self::redirect(CustomerAccount::start((string) (Http::query('next') ?? '/'), Http::query('silent') === '1'));
                } catch (\Throwable $e) {
                    Util::log('Shopify-Login Start: ' . $e->getMessage());
                    return self::redirect('/anmelden?fehler=' . rawurlencode('Die Anmeldung über Shopify ist gerade nicht möglich.'));
                }
            }],
            ['GET', '/auth/shopify/callback', static function () {
                $error = Http::query('error');
                if ($error) {
                    // z. B. Abbruch auf der Shopify-Seite oder prompt=none ohne Sitzung
                    $msg = $error === 'login_required' ? '' : 'Die Anmeldung wurde abgebrochen.';
                    return self::redirect('/anmelden' . ($msg ? '?fehler=' . rawurlencode($msg) : ''));
                }
                try {
                    $r = CustomerAccount::finish((string) (Http::query('code') ?? ''), (string) (Http::query('state') ?? ''));
                } catch (HttpError $e) {
                    return self::redirect('/anmelden?fehler=' . rawurlencode($e->getMessage()));
                }
                $m = Club::fromShopify($r['customer']);
                Auth::start('member', $m['id'], $r['id_token']);
                // Team-Mitglieder (gleiche E-Mail wie in der Team-App) bekommen den Admin-Bereich dazu. Dorthin geht es
                // aber nur, wenn sie von dort kamen – von der Startseite aus landen sie wie alle in der Club-App
                // (mit Vornamen und Beitritt); der Admin-Bereich ist dann oben über „Admin“ erreichbar.
                $next = (string) $r['next'];
                if (Auth::adminFromMember($m) && str_starts_with($next, '/admin')) {
                    return self::redirect($next);
                }
                return self::redirect($m['joined_at'] ? $r['next'] : '/willkommen');
            }],

            // ----- Anmeldung per E-Mail-Code (Ausweichweg) -----
            ['POST', '/auth/code', static function () {
                Auth::requestCode((string) (Http::body()['email'] ?? ''));
                return ['ok' => true];
            }],
            ['POST', '/auth/code/verify', static function () {
                $b = Http::body();
                $email = Auth::verifyCode((string) ($b['email'] ?? ''), (string) ($b['code'] ?? ''));
                $m = Club::fromEmail($email);
                Auth::start('member', $m['id']);
                Auth::adminFromMember($m);
                return Club::me($m);
            }],

            ['POST', '/auth/logout', static function () {
                $idToken = Auth::end('member');
                return ['ok' => true, 'logout_url' => CustomerAccount::logoutUrl($idToken)];
            }],

            // ----- Einladung eines Freundes (öffentlich: wer hat eingeladen?) -----
            ['GET', '/einladung/([A-Za-z0-9-]{3,20})', static function (string $code) {
                $inv = Bonus::inviter($code);
                if (!$inv) {
                    throw new HttpError(404, 'Diese Einladung kennen wir nicht.');
                }
                return $inv;
            }],

            // ----- Bewertung nach der Zustellung (öffentlich über den Link aus Mail/Push) -----
            ['GET', '/bewertung/([0-9a-f]{32})', static fn (string $t) => Surveys::publicView(Surveys::byToken($t))],
            ['POST', '/bewertung/([0-9a-f]{32})', static fn (string $t) => Surveys::answer($t, Http::body())],
            ['POST', '/bewertung/([0-9a-f]{32})/abmelden', static fn (string $t) => Surveys::optOut($t, 'link')],
            ['GET', '/abmelden/([0-9a-f]{32})', static fn (string $t) => self::redirect('/abmelden/' . $t)],
            ['POST', '/abmelden/([0-9a-f]{32})', static fn (string $t) => Surveys::optOut($t, 'one-click')],

            // ----- Empfehlungslink {app}/r/CODE → Shop mit Rabatt für Freunde -----
            ['GET', '/r/([A-Za-z0-9]{3,20})/?', static function (string $code) {
                try {
                    return self::redirect(Referrals::click($code));
                } catch (\Throwable $e) {
                    Util::log('Empfehlungslink: ' . $e->getMessage());
                    return self::redirect(Shopify::shopUrl() . '/');
                }
            }],

            // ----- Kundinnen und Kunden -----
            ['GET', '/me', static function () {
                $m = Auth::requireMember();
                // Admin-Recht auch für schon angemeldete Mitglieder (z. B. Adresse gerade erst als Admin-E-Mail eingetragen)
                if (!Auth::preview() && !Auth::admin()) {
                    Auth::adminFromMember($m);
                }
                Jobs::pokeIfDue();
                return Club::me($m);
            }],
            ['POST', '/me/join', static function () {
                $m = Club::join(Auth::requireMember(), Http::body());
                return Club::me($m);
            }],
            ['PUT', '/me/name', static fn () => Club::me(Club::rename(Auth::requireMember(), Http::body()))],
            ['DELETE', '/me', static function () {
                $m = Auth::requireMember();
                $idToken = Auth::end('member');
                Club::leave($m);
                return ['ok' => true, 'logout_url' => CustomerAccount::logoutUrl($idToken)];
            }],
            ['POST', '/me/birthday', static function () {
                $m = Auth::requireJoined();
                Bonus::setBirthday($m, (string) (Http::body()['birthday'] ?? ''));
                return Club::me(Db::one('SELECT * FROM club_members WHERE id = ?', [$m['id']]));
            }],
            ['PUT', '/me/survey-mail', static function () {
                $m = Auth::requireJoined();
                Surveys::setMemberMail($m, !empty(Http::body()['on']));
                return Surveys::memberState(Db::one('SELECT * FROM club_members WHERE id = ?', [$m['id']]));
            }],
            ['POST', '/me/review', static function () {
                $m = Auth::requireJoined();
                return ['claims' => Bonus::claimReview($m, (string) (Http::body()['note'] ?? ''))];
            }],
            ['GET', '/orders', static function () {
                $m = Auth::requireMember();
                return Orders::list($m, Http::query('fresh') === '1' && !Auth::preview());
            }],
            ['GET', '/points', static function () {
                $m = Auth::requireJoined();
                return [
                    'points' => Points::summary($m),
                    'history' => Points::history($m['id']),
                    'codes' => Points::codes($m['id']),
                    'program' => Points::publicProgram(),
                    'tier' => Tiers::info($m),
                ];
            }],
            ['POST', '/codes', static function () {
                $m = Auth::requireJoined();
                Util::limit('redeem:' . $m['id'], 10, 3600, 'Bitte warte ein bisschen, bevor du den nächsten Code erstellst.');
                $code = Points::redeem($m, (int) (Http::body()['steps'] ?? 0));
                Http::defer(static fn () => Points::pushMetafields());
                return ['code' => $code, 'points' => Points::summary($m)];
            }],
            ['DELETE', "/codes/$uuid", static function (string $id) {
                $m = Auth::requireJoined();
                $code = Points::cancelCode($m, $id);
                Http::defer(static fn () => Points::pushMetafields());
                return ['code' => $code, 'points' => Points::summary($m)];
            }],

            // ----- Push-Mitteilungen -----
            ['GET', '/push/key', static fn () => ['key' => WebPush::keys()['public']]],
            ['POST', '/push/subscribe', static fn () => Push::subscribe(Auth::requireJoined(), Http::body())],
            ['POST', '/push/unsubscribe', static fn () => Push::unsubscribe(Auth::requireJoined(), (string) (Http::body()['endpoint'] ?? ''))],
            ['PUT', '/push/prefs', static function () {
                $m = Auth::requireJoined();
                Push::savePrefs($m, Http::body());
                return Push::state(Db::one('SELECT * FROM club_members WHERE id = ?', [$m['id']]));
            }],
            ['POST', '/push/test', static function () {
                $m = Auth::requireJoined();
                Util::limit('pushtest:' . $m['id'], 5, 600, 'Bitte warte ein paar Minuten bis zum nächsten Test.');
                return Push::test($m);
            }],

            // ----- Feedback -----
            ['GET', "/feedback/anfrage/$uuid", static function (string $id) {
                Auth::requireJoined();
                $b = Broadcasts::find($id);
                if (!$b || $b['kind'] !== 'feedback') {
                    throw new HttpError(404, 'Diese Anfrage gibt es nicht mehr.');
                }
                return ['id' => $b['id'], 'title' => $b['title']];
            }],
            ['POST', '/feedback', static fn () => Feedback::submit(Auth::requireJoined(), Http::body())],

            // ----- Admin-Bereich -----
            ['POST', '/admin/login', static function () {
                $b = Http::body();
                return ['admin' => Auth::publicAdmin(Auth::adminLogin((string) ($b['email'] ?? ''), (string) ($b['password'] ?? '')))];
            }],
            ['POST', '/admin/logout', static function () {
                Auth::end('admin');
                return ['ok' => true];
            }],
            ['GET', '/admin/sso', static function () {
                try {
                    $admin = Admins::sso((string) (Http::query('t') ?? ''));
                } catch (HttpError $e) {
                    return self::redirect('/admin/anmelden?fehler=' . rawurlencode($e->getMessage()));
                }
                Auth::start('admin', $admin['id']);
                return self::redirect('/admin');
            }],
            ['GET', '/admin/me', static function () {
                $a = Auth::requireAdmin();
                $own = Db::value('SELECT id FROM club_members WHERE email = ? AND joined_at IS NOT NULL', [$a['email']]);
                return [
                    'admin' => Auth::publicAdmin($a),
                    'own_member_id' => $own ?: null,
                    'team_url' => Admins::overview()['team_url'],
                    'open_claims' => (int) Db::value("SELECT COUNT(*) FROM club_claims WHERE status = 'open'"),
                ];
            }],
            ['GET', '/admin/dashboard', static function () {
                Auth::requireAdmin();
                return Admin::dashboard();
            }],
            ['GET', '/admin/members', static function () {
                Auth::requireAdmin();
                return ['members' => Admin::members(trim((string) (Http::query('q') ?? '')), 100, (string) (Http::query('stufe') ?? ''))];
            }],
            ['GET', "/admin/members/$uuid", static function (string $id) {
                Auth::requireAdmin();
                return Admin::member($id);
            }],
            ['PUT', "/admin/members/$uuid", static fn (string $id) => Admin::updateMember(Auth::requireAdmin(), $id, Http::body())],
            ['POST', "/admin/members/$uuid/adjust", static function (string $id) {
                $admin = Auth::requireAdmin();
                $b = Http::body();
                $kind = ($b['kind'] ?? '') === 'bonus' ? 'bonus' : 'adjust';
                Points::adjust($admin, $id, (int) ($b['points'] ?? 0), (string) (Util::str($b['note'] ?? '', 200) ?? ''), $kind);
                Http::defer(static fn () => Points::pushMetafields());
                return Admin::member($id);
            }],

            ['GET', '/admin/promotions', static function () {
                Auth::requireAdmin();
                return ['promotions' => Promotions::adminList()];
            }],
            ['POST', '/admin/promotions', static fn () => ['promotions' => Promotions::save(Auth::requireAdmin(), Http::body())]],
            ['PUT', "/admin/promotions/$uuid", static fn (string $id) => ['promotions' => Promotions::save(Auth::requireAdmin(), Http::body(), $id)]],
            ['DELETE', "/admin/promotions/$uuid", static function (string $id) {
                Auth::requireAdmin();
                return ['promotions' => Promotions::delete($id)];
            }],

            ['GET', '/admin/claims', static function () {
                Auth::requireAdmin();
                return ['claims' => Bonus::openClaims()];
            }],
            ['POST', "/admin/claims/$uuid", static function (string $id) {
                $b = Http::body();
                $points = isset($b['points']) && $b['points'] !== '' ? (int) $b['points'] : null;
                $claims = Bonus::decide(Auth::requireAdmin(), $id, !empty($b['approve']), $points);
                Http::defer(static fn () => Points::pushMetafields());
                return ['claims' => $claims];
            }],

            ['GET', '/admin/feedback', static function () {
                Auth::requireAdmin();
                return ['items' => Feedback::list(), 'stats' => Feedback::stats(), 'email' => Feedback::email()];
            }],

            ['GET', '/admin/push', static function () {
                $a = Auth::requireAdmin();
                $own = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL', [$a['email']]);
                return ['templates' => array_values(Push::templates()), 'stats' => Push::stats(), 'categories' => Push::CATEGORIES, 'own_devices' => $own ? Push::devices($own['id']) : 0];
            }],
            ['PUT', '/admin/push', static function () {
                Auth::requireAdmin();
                $b = Http::body();
                if (is_array($b['quiet'] ?? null)) {
                    Push::saveQuiet($b['quiet']);
                }
                if (is_array($b['templates'] ?? null)) {
                    $byKey = [];
                    foreach ($b['templates'] as $k => $t) {
                        if (is_array($t)) {
                            $byKey[is_string($k) ? $k : (string) ($t['key'] ?? '')] = $t;
                        }
                    }
                    Push::saveTemplates($byKey);
                }
                return ['templates' => array_values(Push::templates()), 'stats' => Push::stats(), 'categories' => Push::CATEGORIES];
            }],
            ['POST', '/admin/push/test', static function () {
                $a = Auth::requireAdmin();
                $b = Http::body();
                $own = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL', [$a['email']]);
                if (!$own || Push::devices($own['id']) === 0) {
                    throw new HttpError(409, 'Für ' . $a['email'] . ' ist im Club kein Gerät angemeldet. Öffne die Club-App mit dieser E-Mail, tritt bei und schalte unter „Konto“ die Mitteilungen ein.');
                }
                $key = (string) ($b['template'] ?? '');
                $tpl = Push::templates()[$key] ?? null;
                if ($tpl) {
                    $vars = array_fill_keys($tpl['vars'], '…') + ['vorname' => trim((string) ($own['first_name'] ?? '')), 'punkte' => '59', 'kontostand' => '240', 'euro' => '5 €', 'grund' => 'Bestellung #1042', 'stufe' => 'Silber'];
                    $vars['vorname'] = trim((string) ($own['first_name'] ?? ''));
                    return Push::test($own, '[Test] ' . Push::fill((string) ($b['title'] ?? $tpl['title']), $vars), Push::fill((string) ($b['body'] ?? $tpl['body']), $vars));
                }
                return Push::test($own);
            }],

            ['GET', '/admin/surveys', static function () {
                Auth::requireAdmin();
                return self::surveyAdmin();
            }],
            ['PUT', '/admin/surveys', static function () {
                Auth::requireAdmin();
                Surveys::save(Http::body());
                return self::surveyAdmin();
            }],
            ['GET', '/admin/surveys/preview', static fn () => Surveys::preview((string) (Http::query('kind') ?? 'survey'), Auth::requireAdmin())],
            ['POST', '/admin/surveys/test', static function () {
                $a = Auth::requireAdmin();
                Util::limit('surveytest:' . $a['id'], 10, 600, 'Bitte warte ein paar Minuten bis zum nächsten Test.');
                $r = Surveys::test($a, (string) (Http::body()['kind'] ?? 'survey'));
                Push::flush();
                return $r;
            }],
            ['GET', '/admin/referrals', static function () {
                $a = Auth::requireAdmin();
                return self::referralAdmin($a);
            }],
            ['PUT', '/admin/referrals', static function () {
                $a = Auth::requireAdmin();
                Referrals::save(Http::body());
                return self::referralAdmin($a);
            }],
            ['POST', '/admin/referrals/test', static function () {
                $a = Auth::requireAdmin();
                $own = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL AND test = 0', [$a['email']]);
                if (!$own) {
                    throw new HttpError(409, 'Mit ' . $a['email'] . ' bist du kein Club-Mitglied. Tritt dem Club mit dieser Adresse bei, dann bekommst du deinen eigenen Link zum Testen.');
                }
                if (!Referrals::enabled()) {
                    throw new HttpError(409, 'Bitte die Empfehlungslinks erst einschalten und speichern.');
                }
                $row = Referrals::ensureDiscount($own);
                $push = Push::devices($own['id']) > 0
                    ? Push::test($own, '[Test] ' . Push::fill(Push::templates()['referral_order']['title'], []), Push::fill(Push::templates()['referral_order']['body'], ['punkte' => (string) Referrals::pointsFor(5900)]), '/konto')
                    : null;
                return [
                    'link' => Referrals::link($own),
                    'code' => $row['code'],
                    'status' => $row['status'],
                    'error' => $row['error'],
                    'push' => $push,
                    'message' => $row['status'] === 'active'
                        ? 'Dein Code ' . $row['code'] . ' ist in Shopify angelegt. Öffne den Link in einem privaten Fenster – der Rabatt sollte im Warenkorb stehen.'
                        : 'Der Code konnte nicht angelegt werden: ' . $row['error'],
                ];
            }],

            ['GET', '/admin/invites', static function () {
                Auth::requireAdmin();
                return Invites::overview();
            }],
            ['POST', '/admin/invites/load', static function () {
                Auth::requireAdmin();
                return Invites::load();
            }],
            ['PUT', '/admin/invites/template', static function () {
                Auth::requireAdmin();
                Invites::saveTemplate(Http::body());
                return Invites::overview();
            }],
            ['POST', '/admin/invites/test', static fn () => Invites::test(Auth::requireAdmin())],
            ['POST', '/admin/invites/start', static function () {
                Auth::requireAdmin();
                $r = Invites::start();
                Http::defer(static fn () => Invites::run());
                return $r;
            }],
            ['POST', '/admin/invites/stop', static function () {
                Auth::requireAdmin();
                return Invites::stop();
            }],

            ['GET', '/admin/access', static function () {
                Auth::requireAdmin();
                return Admins::overview();
            }],
            ['POST', '/admin/access', static fn () => Admins::createClub(Auth::requireAdmin(), Http::body())],
            ['DELETE', "/admin/access/$uuid", static fn (string $id) => Admins::deleteClub(Auth::requireAdmin(), $id)],
            // Admin-E-Mails: Anmeldung in der Club-App mit dieser Adresse → Admin-Bereich
            ['POST', '/admin/access/emails', static fn () => Admins::addEmail(Auth::requireAdmin(), Http::body())],
            ['POST', '/admin/access/emails/remove', static fn () => Admins::removeEmail(Auth::requireAdmin(), (string) (Http::body()['email'] ?? ''))],
            ['PUT', '/admin/access/team/([0-9a-zA-Z-]{1,36})', static function (string $id) {
                Admins::setTeamAccess(Auth::requireAdmin(), $id, !empty(Http::body()['access']));
                return Admins::overview();
            }],

            ['GET', '/admin/database', static function () {
                Auth::requireAdmin();
                return TeamDb::status();
            }],
            ['POST', '/admin/database/move', static function () {
                $a = Auth::requireAdmin();
                if (!Admins::public($a)['manage']) {
                    throw new HttpError(403, 'Den Umzug der Datenbank darf nur ein Admin starten.');
                }
                $path = Util::str(Http::body()['config'] ?? null, 500);
                return TeamDb::move($path);
            }],

            ['GET', '/admin/settings', static function () {
                Auth::requireAdmin();
                return Admin::settings();
            }],
            ['PUT', '/admin/settings', static function () {
                Auth::requireAdmin();
                return Admin::saveSettings(Http::body());
            }],
            ['POST', '/admin/test/mail', static fn () => Admin::testMail(Auth::requireAdmin())],
            ['POST', '/admin/test/welcome', static function () {
                $a = Auth::requireAdmin();
                // Vorschau der Willkommensmail an die eigene Adresse (mit einem leeren Beispielkonto)
                $fake = ['id' => '00000000-0000-0000-0000-000000000000', 'email' => $a['email'], 'first_name' => explode(' ', (string) $a['name'])[0], 'tier' => Tiers::KEYS[0], 'tier_until' => null];
                return Mailer::welcome($fake);
            }],
            ['POST', '/admin/sync', static function () {
                Auth::requireAdmin();
                $r = Jobs::run('admin');
                if (Shopify::configured()) {
                    try {
                        $r['shop'] = ShopSync::run(true);
                    } catch (\Throwable $e) {
                        $r['shop'] = 'Fehler: ' . $e->getMessage();
                    }
                }
                return $r;
            }],

            // ----- Team-App (Server zu Server, Header X-Club-Key) -----
            ['GET', '/internal/ping', static fn () => ['ok' => true, 'version' => APP_VERSION, 'team_mode' => Db::team(), 'app_url' => Util::baseUrl(), 'program' => Points::program()['name']]],
            ['GET', '/internal/widget', static fn () => Internal::widget()],
            ['GET', '/internal/stats', static fn () => Admin::stats() + ['promotion' => Promotions::publicActive(), 'open_claims' => (int) Db::value("SELECT COUNT(*) FROM club_claims WHERE status = 'open'"), 'app_url' => Util::baseUrl()]],
            ['POST', '/internal/kick', static function () {
                $out = ['broadcasts' => Broadcasts::run(), 'promotions' => Promotions::runStarts(), 'push' => Push::flush()];
                return $out;
            }],
            ['POST', '/internal/migrate', static function () {
                Db::migrate();
                return ['ok' => true, 'version' => APP_VERSION, 'schema' => Settings::get('schema_version')];
            }],
            ['POST', '/internal/sso', static function () {
                $u = self::teamUser();
                return ['url' => Admins::ssoLink($u['id'], $u['email'])];
            }],
            ['GET', '/internal/broadcasts', static fn () => Broadcasts::overview()],
            ['POST', '/internal/broadcasts', static fn () => Broadcasts::save(self::teamUser(), Http::body())],
            ['PUT', "/internal/broadcasts/$uuid", static fn (string $id) => Broadcasts::save(self::teamUser(), Http::body(), $id)],
            ['POST', "/internal/broadcasts/$uuid/submit", static fn (string $id) => Broadcasts::submit(self::teamUser(), $id)],
            ['POST', "/internal/broadcasts/$uuid/approve", static fn (string $id) => Broadcasts::approve(self::teamUser(), $id)],
            ['POST', "/internal/broadcasts/$uuid/reject", static fn (string $id) => Broadcasts::reject(self::teamUser(), $id, (string) (Http::body()['note'] ?? ''))],
            ['POST', "/internal/broadcasts/$uuid/cancel", static fn (string $id) => Broadcasts::cancel($id)],
            ['POST', "/internal/broadcasts/$uuid/test", static fn (string $id) => Broadcasts::test($id, self::teamUser()['email'])],
            ['DELETE', "/internal/broadcasts/$uuid", static function (string $id) {
                Broadcasts::delete($id);
                return ['ok' => true];
            }],

            ['GET', '/internal/customer', static fn () => Internal::customer((string) (Http::query('email') ?? ''))],
            ['GET', '/internal/weekly', static fn () => Internal::weekly((int) (Http::query('from') ?? 0), (int) (Http::query('to') ?? 0))],
            ['POST', '/internal/alerts/claim', static fn () => Internal::claimAlerts()],
            ['GET', '/internal/trial', static fn () => Trial::view()],
            ['POST', '/internal/trial/start', static fn () => Trial::start(self::teamUser(), Http::body())],
            ['POST', '/internal/trial/step', static fn () => Trial::step((string) (Http::body()['step'] ?? ''))],
            ['POST', '/internal/trial/sync', static function () {
                $r = Jobs::run('probelauf');
                return Trial::view(['message' => is_string($r['orders'] ?? null) ? 'Abgleich: ' . $r['orders'] : ($r['skipped'] ?? 'Abgleich gelaufen')]);
            }],
            ['POST', '/internal/trial/cleanup', static fn () => Trial::cleanup()],
            // Fußzeile der Team-Postfächer (Text + Logo) für die Mails des Clubs
            ['POST', '/internal/signature', static fn () => Mailer::saveSignature(Http::body())],

            // ----- Cronjob (netcup: „URL abrufen“ alle 15 Minuten) -----
            ['GET', '/cron', static function () {
                $key = (string) Config::get('cron_key', '');
                if ($key === '' || !hash_equals($key, (string) (Http::query('key') ?? ''))) {
                    throw new HttpError(403, 'Ungültiger Schlüssel.');
                }
                return Jobs::run('cron');
            }],
        ];

        foreach ($routes as [$m, $pattern, $handler]) {
            if ($m === $method && preg_match('#^' . $pattern . '$#', $path, $match)) {
                array_shift($match);
                return [$handler, $match];
            }
        }
        throw new HttpError(404, 'Nicht gefunden.');
    }

    private static function surveyAdmin(): array
    {
        return [
            'config' => Surveys::config(),
            'overview' => Surveys::overview(),
            'defaults' => ['privacy_url' => Surveys::privacyUrl(), 'imprint_url' => Surveys::imprintUrl()],
            'mail_configured' => Mailer::configured(),
            'feedback_email' => Feedback::email(),
            'templates' => array_values(array_filter(Push::templates(), static fn ($t) => in_array($t['key'], ['survey', 'reorder'], true))),
        ];
    }

    private static function referralAdmin(array $admin): array
    {
        $own = Db::one('SELECT * FROM club_members WHERE email = ? AND joined_at IS NOT NULL AND test = 0', [$admin['email']]);
        return [
            'config' => Referrals::config(),
            'overview' => Referrals::overview(),
            'program' => ['redeem_points' => (int) Points::program()['redeem_points'], 'redeem_cents' => (int) Points::program()['redeem_cents'], 'wait_days' => (int) Points::program()['wait_days']],
            'shopify' => Shopify::configured(),
            'own' => $own ? ['link' => Referrals::link($own), 'status' => Referrals::status($own)] : null,
            'templates' => array_values(array_filter(Push::templates(), static fn ($t) => in_array($t['key'], ['referral_pending', 'referral_order'], true))),
        ];
    }

    private static function status(): array
    {
        $installed = Setup::installed();
        $out = ['installed' => $installed, 'version' => APP_VERSION];
        if (!$installed) {
            $out['requirements'] = Setup::requirements();
            $out['configExists'] = Config::exists();
            $out['team_detected'] = Setup::teamDetected() !== null;
            return $out;
        }
        $out['program'] = Points::publicProgram();
        $out['login'] = [
            'shopify' => CustomerAccount::configured(),
            'email' => Auth::emailLoginEnabled(),
        ];
        $out['shop_url'] = Shopify::shopUrl();
        $out['terms_url'] = Settings::get('terms_url');
        return $out;
    }
}
