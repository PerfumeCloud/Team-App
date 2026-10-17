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
            // Bild unter der eigenen Signatur
            ['GET', '/me/signature', static fn () => Signature::view((string) Auth::require()['id'])],
            ['PUT', '/me/signature', static fn () => Signature::save((string) Auth::require()['id'], Http::body())],

            // Persönliches Postfach – nur für die angemeldete Person sichtbar
            ['GET', '/me/mailbox', static fn () => self::myMailbox(Auth::require())],
            ['PUT', '/me/mailbox', static function () {
                $me = Auth::require();
                $mb = MailJob::savePersonal($me, Http::body());
                $test = self::checkMailbox($mb, false);
                if ($test['ok']) {
                    Http::defer(static fn () => Jobs::run('setup'));
                }
                return ['test' => $test] + self::myMailbox($me);
            }],
            // Verbindung prüfen: Abruf und Versand Schritt für Schritt, mit Testmail an das Postfach selbst
            ['POST', '/me/mailbox/check', static function () {
                $mb = MailJob::personal(Auth::require()['id']);
                if (!$mb) {
                    throw new HttpError(404, 'Du hast noch kein eigenes Postfach eingetragen.');
                }
                return self::checkMailbox($mb, true);
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

            // ---- Mail lesen und beantworten (1.5) ----
            ['GET', '/emails/([0-9a-f]{40})/message', static fn (string $id) => Replies::message(Auth::require(), $id, Http::query('fresh') === '1')],
            ['POST', '/emails/([0-9a-f]{40})/fill', static function (string $id) {
                $me = Auth::require();
                $mail = Replies::mail($me, $id);
                $b = Http::body();
                return Replies::fill($me, $mail, (string) ($b['text'] ?? ''), isset($b['order']) && is_string($b['order']) ? $b['order'] : null);
            }],
            ['POST', '/emails/([0-9a-f]{40})/reply', static fn (string $id) => Replies::reply(Auth::require(), $id, Http::body())],
            // Ordner wie in Outlook (direkt auf dem Mailserver), Gesendet
            ['POST', '/emails/([0-9a-f]{40})/move', static fn (string $id) => MailFolders::moveEmail(Auth::require(), $id, (string) (Http::body()['to'] ?? ''))],
            ['GET', '/mail/folders', static fn () => MailFolders::folders(Auth::require(), (string) Http::query('box', ''), Http::query('fresh') === '1')],
            ['POST', '/mail/folders', static function () {
                $b = Http::body();
                return MailFolders::create(Auth::require(), (string) ($b['box'] ?? ''), is_string($b['parent'] ?? null) ? $b['parent'] : null, $b['name'] ?? '');
            }],
            ['PATCH', '/mail/folders', static function () {
                $b = Http::body();
                return MailFolders::rename(Auth::require(), (string) ($b['box'] ?? ''), (string) ($b['path'] ?? ''), $b['name'] ?? '');
            }],
            ['POST', '/mail/folders/delete', static function () {
                $b = Http::body();
                return MailFolders::delete(Auth::require(), (string) ($b['box'] ?? ''), (string) ($b['path'] ?? ''));
            }],
            ['GET', '/mail/folder', static fn () => MailFolders::messages(Auth::require(), (string) Http::query('box', ''), (string) Http::query('path', ''), (int) Http::query('page', '1'), (string) Http::query('q', ''))],
            ['GET', '/mail/folder/message', static fn () => MailFolders::message(Auth::require(), (string) Http::query('box', ''), (string) Http::query('path', ''), (int) Http::query('uid', '0'))],
            ['POST', '/mail/folder/move', static function () {
                $b = Http::body();
                return MailFolders::move(Auth::require(), (string) ($b['box'] ?? ''), (string) ($b['from'] ?? ''), is_array($b['uids'] ?? null) ? $b['uids'] : [], (string) ($b['to'] ?? ''));
            }],
            ['GET', '/templates', static function () {
                Auth::require();
                return ['templates' => Replies::templates(), 'placeholders' => Replies::PLACEHOLDERS, 'footer' => Replies::footer(), 'fromName' => Replies::fromName(), 'footerImage' => Signature::view('team')];
            }],
            ['PUT', "/templates/$uuid", static fn (string $id) => ['templates' => Replies::saveTemplate(Auth::requireAdmin(), $id, Http::body())]],
            ['DELETE', "/templates/$uuid", static function (string $id) {
                Auth::requireAdmin();
                return ['templates' => Replies::deleteTemplate($id)];
            }],

            // ---- Kundeninfos (1.5) ----
            ['GET', '/customers', static function () {
                Auth::require();
                return Customers::lookup((string) (Http::query('email') ?? ''), Http::query('order'));
            }],
            ['POST', '/customers/notes', static fn () => Customers::addNote(Auth::require(), Http::body())],
            ['DELETE', "/customers/notes/$uuid", static fn (string $id) => Customers::deleteNote(Auth::require(), $id)],

            // ---- Versand (1.5) ----
            ['GET', '/shipping', static function () {
                Auth::require();
                return Shipping::list();
            }],
            ['POST', '/shipping/(\d{1,20})', static fn (string $id) => Shipping::ship(Auth::require(), $id, Http::body())],
            ['GET', '/shipping/guess', static function () {
                Auth::require();
                $n = (string) (Http::query('number') ?? '');
                $c = Shipping::guessCarrier($n);
                return ['carrier' => $c];
            }],

            // ---- Wochenrückblick (1.5) ----
            ['GET', '/reports/weekly', static function () {
                Auth::require();
                $data = Reports::compute();
                $r = Reports::render($data);
                return ['data' => $data, 'subject' => $r['subject'], 'html' => $r['html'], 'config' => Reports::weeklyConfig()];
            }],
            ['POST', '/reports/weekly/test', static fn () => Reports::send(Auth::require())],

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
            // Testnachricht an alle eigenen Geräte – Ergebnis je Gerät (z. B. „iPhone Safari: BadJwtToken“)
            ['POST', '/push/test', static fn () => Notify::test(Auth::require())],
            ['GET', '/push/devices', static fn () => ['devices' => Notify::devices(Auth::require()['id'])]],
            ['DELETE', '/push/devices/([0-9a-f]{64})', static function (string $id) {
                $me = Auth::require();
                Db::exec('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', [$id, $me['id']]);
                return ['devices' => Notify::devices($me['id'])];
            }],

            // ---- Members Club (Kunden-App) – nur mit Club-Zugang, der Schlüssel bleibt auf dem Server ----
            ['GET', '/club/stats', static function () {
                Auth::requireClub();
                return Club::request('GET', '/internal/stats');
            }],
            ['GET', '/club/broadcasts', static fn () => Club::broadcasts(Auth::requireClub())],
            ['POST', '/club/broadcasts', static fn () => Club::saveBroadcast(Auth::requireClub(), Http::body(), null)],
            ['PUT', "/club/broadcasts/$uuid", static fn (string $id) => Club::saveBroadcast(Auth::requireClub(), Http::body(), $id)],
            ['POST', "/club/broadcasts/$uuid/(submit|approve|reject|cancel|test)", static fn (string $id, string $action) => Club::broadcastAction(Auth::requireClub(), $id, $action, Http::body())],
            ['DELETE', "/club/broadcasts/$uuid", static function (string $id) {
                Auth::requireClub();
                return Club::request('DELETE', "/internal/broadcasts/$id");
            }],
            // Testbestellung: kompletter Bestellverlauf im Club – nur Admins
            ['GET', '/club/trial', static function () {
                Auth::requireAdmin();
                return ClubTrial::view();
            }],
            ['POST', '/club/trial/start', static fn () => ClubTrial::start(Auth::requireAdmin(), Http::body())],
            ['POST', '/club/trial/step', static function () {
                Auth::requireAdmin();
                return ClubTrial::step(Http::body());
            }],
            ['POST', '/club/trial/sync', static function () {
                Auth::requireAdmin();
                return ClubTrial::sync();
            }],
            ['POST', '/club/trial/cleanup', static function () {
                Auth::requireAdmin();
                return ClubTrial::cleanup();
            }],
            ['GET', '/club/trial/check', static fn () => ClubTrial::check(Auth::requireAdmin())],
            ['POST', '/club/trial/test-push', static fn () => ClubTrial::testPush(Auth::requireAdmin(), Http::body())],
            ['POST', '/club/trial/device', static fn () => ClubTrial::device(Auth::requireAdmin(), Http::body())],
            ['POST', '/club/access/emails', static fn () => ClubTrial::email(Auth::requireAdmin(), Http::body())],
            ['POST', '/club/access/emails/remove', static fn () => ClubTrial::email(Auth::requireAdmin(), Http::body(), true)],
            // Einmal-Link (60 Sekunden) in den Club-Admin
            ['POST', '/club/sso', static fn () => Club::request('POST', '/internal/sso', ['user' => Club::user(Auth::requireClub())])],

            // ---- Instagram (1.7) – nur mit Instagram-Zugang, Verbinden nur Admins; der Zugang bleibt auf dem Server ----
            ['GET', '/instagram', static fn () => Instagram::overview(Instagram::requireAccess())],
            ['POST', '/instagram/sync', static function () {
                $me = Instagram::requireAccess();
                if (Util::now() - (int) Settings::get('instagram_sync_at', 0) < 60000) {
                    throw new HttpError(429, 'Gerade erst abgeglichen – bitte eine Minute warten.');
                }
                @set_time_limit(170);
                try {
                    $msg = Instagram::sync();
                } catch (HttpError $e) {
                    throw $e;
                } catch (\Throwable $e) {
                    throw new HttpError(502, $e->getMessage());
                }
                return ['message' => $msg] + Instagram::overview($me);
            }],
            ['GET', '/instagram/export', static fn () => ['text' => Instagram::export(Instagram::requireAccess())]],
            // Anmeldung bei Instagram (Weiterleitung im Browser, daher GET)
            ['GET', '/instagram/connect', static function () {
                $me = Auth::user();
                $target = '/einstellungen/integrationen?instagram=' . rawurlencode('Nur Admins können Instagram verbinden.') . '#instagram';
                if ($me && $me['role'] === 'admin') {
                    try {
                        $target = Instagram::authorizeUrl($me);
                    } catch (HttpError $e) {
                        $target = '/einstellungen/integrationen?instagram=' . rawurlencode($e->getMessage()) . '#instagram';
                    }
                }
                header('Cache-Control: no-store');
                header('Location: ' . $target, true, 302);
                return null;
            }],
            ['GET', '/instagram/callback', static function () {
                header('Cache-Control: no-store');
                header('Location: ' . Instagram::callback($_GET), true, 302);
                return null;
            }],
            ['GET', '/instagram/posts', static fn () => InstagramPosts::list(Instagram::requireAccess())],
            ['POST', '/instagram/posts', static fn () => InstagramPosts::save(Instagram::requireAccess(), Http::body(), null)],
            ['POST', '/instagram/posts/import', static fn () => InstagramPosts::import(Instagram::requireAccess(), Http::body())],
            ['PUT', "/instagram/posts/$uuid", static fn (string $id) => InstagramPosts::save(Instagram::requireAccess(), Http::body(), $id)],
            ['DELETE', "/instagram/posts/$uuid", static function (string $id) {
                Instagram::requireAccess();
                InstagramPosts::delete($id);
                return ['ok' => true];
            }],
            ['POST', "/instagram/posts/$uuid/(submit|approve|reject|cancel|retry|done)", static fn (string $id, string $action) => InstagramPosts::action(Instagram::requireAccess(), $id, $action, Http::body())],
            // Bild als JPEG im Rumpf der Anfrage (die App wandelt Fotos vorher um)
            ['POST', "/instagram/posts/$uuid/images", static function (string $id) {
                Instagram::requireAccess();
                return InstagramPosts::addImage($id, (string) file_get_contents('php://input'));
            }],
            ['GET', '/instagram/bild/([a-f0-9]{32})\.jpg', static function (string $token) {
                InstagramPosts::serve($token);
                return null;
            }],
            ['GET', '/instagram/products', static function () {
                Instagram::requireAccess();
                return InstagramPosts::products();
            }],
            ['GET', '/instagram/shopify-image', static function () {
                Instagram::requireAccess();
                $img = InstagramPosts::fetchShopifyImage((string) (Http::query('url') ?? ''));
                header('Content-Type: ' . $img['type']);
                header('Cache-Control: private, max-age=3600');
                header('X-Content-Type-Options: nosniff');
                echo $img['raw'];
                return null;
            }],
            ['GET', '/instagram/comments', static function () {
                Instagram::requireAccess();
                return InstagramPosts::comments();
            }],
            ['POST', '/instagram/comments/(\d{5,30})/reply', static fn (string $id) => InstagramPosts::reply(Instagram::requireAccess(), $id, Http::body())],
            ['POST', '/instagram/comments/(\d{5,30})/(done|open)', static function (string $id, string $what) {
                Instagram::requireAccess();
                return InstagramPosts::markDone($id, $what === 'done');
            }],
            ['PUT', '/admin/instagram', static function () {
                $me = Auth::requireAdmin();
                $b = Http::body();
                Instagram::save($me, $b);
                if (!empty($b['token'])) {
                    Http::defer(static fn () => Instagram::sync());
                }
                return ['instagram' => Instagram::adminSettings()];
            }],
            ['POST', '/admin/instagram/test', static function () {
                Auth::requireAdmin();
                @set_time_limit(170);
                try {
                    Instagram::sync();
                } catch (\Throwable) {
                    // steht im Status
                }
                return ['instagram' => Instagram::adminSettings()];
            }],
            ['DELETE', '/admin/instagram', static function () {
                Auth::requireAdmin();
                Instagram::disconnect();
                return ['instagram' => Instagram::adminSettings()];
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
                // Mit PHP-FPM: Antwort sofort, danach eine Minute Sofort-Abruf (Cronjob jede Minute)
                if (Live::background()) {
                    Settings::set('cron_last_run', Util::now());
                    if (Live::running()) {
                        return ['trigger' => 'cron', 'live' => 'läuft'];
                    }
                    Http::defer(static fn () => Live::run('url', Live::URL_SECONDS));
                    return ['trigger' => 'cron', 'live' => 'gestartet'];
                }
                return Jobs::run('cron');
            }],

            // ---- Admin ----
            ['GET', '/admin/integrations', static function () {
                Auth::requireAdmin();
                // Fehlen Berechtigungen, beim Öffnen neu prüfen (höchstens alle 2 Minuten): so erscheint die Bestätigung
                // aus Shopify ohne Knopfdruck, und der Link „In Shopify bestätigen“ ist frisch.
                $check = Settings::get('shopify_check');
                if (Shopify::configured() && is_array($check) && !empty($check['missing']) && ($check['at'] ?? 0) < Util::now() - 120_000) {
                    Settings::set('shopify_check', Shopify::test() + ['at' => Util::now()]);
                }
                return self::integrations();
            }],
            ['PUT', '/admin/shopify', static function () {
                Auth::requireAdmin();
                Shopify::save(Http::body());
                $test = Shopify::test();
                Settings::set('shopify_check', $test + ['at' => Util::now()]);
                if ($test['ok']) {
                    Settings::delete('orders_cursor');
                    Http::defer(static fn () => Jobs::run('setup'));
                }
                return ['test' => $test] + self::integrations();
            }],
            // Berechtigungen neu prüfen (z. B. nachdem die neue App-Version im Shop bestätigt wurde)
            ['POST', '/admin/shopify/check', static function () {
                Auth::requireAdmin();
                if (!Shopify::configured()) {
                    throw new HttpError(409, 'Shopify ist noch nicht verbunden.');
                }
                $test = Shopify::test();
                Settings::set('shopify_check', $test + ['at' => Util::now()]);
                return ['test' => $test] + self::integrations();
            }],
            ['DELETE', '/admin/shopify', static function () {
                Auth::requireAdmin();
                foreach (['shopify', 'shopify_secret', 'shopify_token', 'shopify_scopes', 'shopify_check'] as $k) {
                    Settings::delete($k);
                }
                return self::integrations();
            }],
            ['PUT', '/admin/mailboxes', static function () {
                Auth::requireAdmin();
                @set_time_limit(170);
                $list = MailJob::save(is_array(Http::body()['mailboxes'] ?? null) ? Http::body()['mailboxes'] : []);
                $tests = [];
                foreach ($list as $mb) {
                    $tests[$mb['id']] = self::checkMailbox($mb, false);
                }
                if ($list) {
                    Http::defer(static fn () => Jobs::run('setup'));
                }
                return ['tests' => $tests] + self::integrations();
            }],
            ['POST', '/admin/mailboxes/([A-Za-z0-9_-]{1,40})/check', static function (string $id) {
                Auth::requireAdmin();
                $mb = MailJob::byId($id);
                if (!$mb) {
                    throw new HttpError(404, 'Postfach nicht gefunden.');
                }
                return self::checkMailbox($mb, true);
            }],
            ['GET', '/admin/club', static function () {
                Auth::requireAdmin();
                return Club::settings();
            }],
            ['PUT', '/admin/club', static function () {
                Auth::requireAdmin();
                Club::save(Http::body());
                return ['test' => Club::configured() ? Club::test() : null] + Club::settings();
            }],
            ['POST', '/admin/club/ping', static function () {
                Auth::requireAdmin();
                return ['test' => Club::test()] + Club::settings();
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
                // Versand: Port 465 (SSL/TLS) oder 587 (STARTTLS), 0 = automatisch; Server leer = wie IMAP
                if (array_key_exists('smtp_port', $b)) {
                    $port = (int) $b['smtp_port'];
                    Settings::set('smtp_port', in_array($port, [465, 587], true) ? $port : 0);
                }
                if (array_key_exists('smtp_host', $b)) {
                    Settings::set('smtp_host', MailJob::server(Util::str($b['smtp_host'], 190) ?? '', 465, 'ssl')['host']);
                }
                if (array_key_exists('base_url', $b)) {
                    $cfg = Config::all();
                    $cfg['base_url'] = rtrim(Util::str($b['base_url'], 190) ?? '', '/');
                    Config::write($cfg);
                }
                return self::integrations();
            }],
            ['PUT', '/admin/mail-settings', static function () {
                Auth::requireAdmin();
                $b = Http::body();
                if (array_key_exists('footer', $b)) {
                    Settings::set('mail_footer', Util::str($b['footer'], 1000) ?? '');
                }
                if (array_key_exists('from_name', $b)) {
                    Settings::set('mail_from_name', Util::str($b['from_name'], 80) ?? '');
                }
                Club::pushSignature();
                return ['footer' => Replies::footer(), 'fromName' => Replies::fromName()];
            }],
            // Bild unter der Fußzeile der Team-Postfächer (Logo) – geht auch an den Club für dessen Mails
            ['GET', '/admin/mail-signature', static function () {
                Auth::requireAdmin();
                return Signature::view('team');
            }],
            ['PUT', '/admin/mail-signature', static function () {
                Auth::requireAdmin();
                $r = Signature::save('team', Http::body());
                return $r + ['club' => Club::pushSignature()];
            }],
            ['PUT', '/admin/shipping', static function () {
                Auth::requireAdmin();
                return ['settings' => Shipping::saveSettings(Http::body())];
            }],

            // ---- Auswertungen & Datensicherung (1.5, nur Admins) ----
            ['GET', '/admin/reports', static function () {
                Auth::requireAdmin();
                return ['reports' => Reports::settings(), 'backup' => Backup::status(), 'shipping' => Shipping::settings()];
            }],
            ['PUT', '/admin/reports', static function () {
                Auth::requireAdmin();
                Reports::save(Http::body());
                return ['reports' => Reports::settings(), 'backup' => Backup::status(), 'shipping' => Shipping::settings()];
            }],
            ['POST', '/admin/reports/test-mail', static function () {
                Auth::requireAdmin();
                return Reports::testMail();
            }],
            ['POST', '/admin/reports/weekly/send', static function () {
                Auth::requireAdmin();
                return Reports::send(null);
            }],
            ['PUT', '/admin/backup/password', static function () {
                Auth::requireAdmin();
                Backup::setPassword((string) (Http::body()['password'] ?? ''));
                return ['backup' => Backup::status()];
            }],
            ['POST', '/admin/backup', static function () {
                Auth::requireAdmin();
                $r = Backup::create('manuell');
                return ['created' => $r, 'backup' => Backup::status()];
            }],
            ['POST', '/admin/backup/verify', static function () {
                Auth::requireAdmin();
                $name = Http::body()['name'] ?? null;
                return Backup::verify(is_string($name) ? $name : null);
            }],
            ['POST', '/admin/backup/mail', static function () {
                Auth::requireAdmin();
                $name = (string) (Http::body()['name'] ?? (Backup::files()[0]['name'] ?? ''));
                return Backup::mail($name) + ['backup' => Backup::status()];
            }],
            ['GET', '/admin/backup/download', static function () {
                Auth::requireAdmin();
                $file = Backup::path((string) (Http::query('name') ?? ''));
                header('Content-Type: application/octet-stream');
                header('Content-Disposition: attachment; filename="' . basename($file) . '"');
                header('Content-Length: ' . filesize($file));
                header('Cache-Control: no-store');
                readfile($file);
                return null;
            }],
            ['GET', '/admin/backup/preview', static function () {
                Auth::requireAdmin();
                return Backup::preview((string) (Http::query('name') ?? ''));
            }],
            ['POST', '/admin/backup/upload', static function () {
                Auth::requireAdmin();
                $raw = (string) file_get_contents('php://input');
                return Backup::stage($raw, rawurldecode((string) ($_SERVER['HTTP_X_BACKUP_PASSWORD'] ?? '')));
            }],
            ['POST', '/admin/backup/restore', static function () {
                $me = Auth::requireAdmin();
                $b = Http::body();
                return Backup::restore($me, ['name' => $b['name'] ?? null, 'token' => $b['token'] ?? null], (string) ($b['confirm'] ?? '')) + ['backup' => Backup::status()];
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
            if (array_key_exists('signature', $b['prefs'])) {
                $prefs['signature'] = Util::str($b['prefs']['signature'], 1000);
            }
            if (isset($b['prefs']['weeklyMail'])) {
                $prefs['weeklyMail'] = (bool) $b['prefs']['weeklyMail'];
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
            'cronLastRun' => (int) Settings::get('cron_last_run', 0),
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
        // „Club-Admin“: Zugang zum Members Club (Admins haben ihn immer)
        if (array_key_exists('club_access', $b)) {
            $row['club_access'] = !empty($b['club_access']) ? 1 : 0;
        }
        // „Instagram-Zugang“: Auswertung, Planer, Kommentare (Admins haben ihn immer)
        if (array_key_exists('instagram_access', $b)) {
            $row['instagram_access'] = !empty($b['instagram_access']) ? 1 : 0;
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
        if (!WebPush::validEndpoint($endpoint) || strlen($endpoint) > 2000 || $p256dh === '' || $auth === '') {
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
            'last_status' => null,
            'last_error' => null,
            'fail_count' => 0,
        ]);
        return ['ok' => true, 'id' => $id];
    }

    /** Postfach prüfen und das Ergebnis des Abrufs als Status merken (der Versand ändert den Status nicht). */
    private static function checkMailbox(array $mb, bool $smtp): array
    {
        @set_time_limit(120);
        $r = MailCheck::run($mb, $smtp);
        Settings::set('mail_status_' . $mb['id'], ['ok' => $r['imap'], 'at' => Util::now(), 'message' => $r['imapMessage']]);
        return $r;
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
                'check' => Settings::get('shopify_check'),
                'lastSync' => (int) Settings::get('orders_last_sync', 0),
                'apiVersion' => Shopify::API_VERSION,
            ],
            'mailboxes' => $mailboxes,
            'mail' => [
                'lastFetch' => (int) Settings::get('mail_last_fetch', 0),
                'lastError' => Settings::get('mail_last_error'),
                'smtpHost' => (string) (Settings::get('smtp_host') ?? ''),
                'smtpPort' => (int) Settings::get('smtp_port', 0),
                'sender' => Mailer::sender()['email'] ?? null,
            ],
            'cron' => [
                'url' => Util::baseUrl() . '/api/cron?key=' . $cronKey,
                'lastRun' => (int) Settings::get('cron_last_run', 0),
                'jobsLastRun' => (int) Settings::get('jobs_last_run', 0),
                'script' => APP_ROOT . '/app/bin/cron.php',
                'live' => Live::status(),
            ],
            'settings' => [
                'low_stock_threshold' => (int) Settings::get('low_stock_threshold', 5),
                'holiday_state' => Holidays::config()['state'],
                'holidays_on' => Holidays::config()['holidays'],
                'shop_days_on' => Holidays::config()['shop'],
                'base_url' => (string) Config::get('base_url', ''),
            ],
            'pushDevices' => (int) Db::value('SELECT COUNT(*) FROM push_subscriptions'),
            'instagram' => Instagram::adminSettings(),
        ];
    }
}
