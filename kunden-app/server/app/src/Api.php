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
            // Schutz gegen Anfragen von fremden Seiten: Schreibende Anfragen brauchen den eigenen Header
            if ($method !== 'GET' && $method !== 'HEAD' && ($_SERVER['HTTP_X_PC'] ?? '') !== '1') {
                throw new HttpError(403, 'Ungültige Anfrage.');
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
                return Club::me($m);
            }],

            ['POST', '/auth/logout', static function () {
                $idToken = Auth::end('member');
                return ['ok' => true, 'logout_url' => CustomerAccount::logoutUrl($idToken)];
            }],

            // ----- Kundinnen und Kunden -----
            ['GET', '/me', static function () {
                $m = Auth::requireMember();
                Jobs::pokeIfDue();
                return Club::me($m);
            }],
            ['POST', '/me/join', static function () {
                $m = Club::join(Auth::requireMember(), Http::body());
                return Club::me($m);
            }],
            ['DELETE', '/me', static function () {
                $m = Auth::requireMember();
                $idToken = Auth::end('member');
                Club::leave($m);
                return ['ok' => true, 'logout_url' => CustomerAccount::logoutUrl($idToken)];
            }],
            ['GET', '/orders', static function () {
                $m = Auth::requireMember();
                return Orders::list($m, Http::query('fresh') === '1');
            }],
            ['GET', '/points', static function () {
                $m = Auth::requireJoined();
                return [
                    'points' => Points::summary($m),
                    'history' => Points::history($m['id']),
                    'codes' => Points::codes($m['id']),
                    'program' => Points::publicProgram(),
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

            // ----- Admin-Bereich -----
            ['POST', '/admin/login', static function () {
                $b = Http::body();
                return ['admin' => Auth::publicAdmin(Auth::adminLogin((string) ($b['email'] ?? ''), (string) ($b['password'] ?? '')))];
            }],
            ['POST', '/admin/logout', static function () {
                Auth::end('admin');
                return ['ok' => true];
            }],
            ['GET', '/admin/me', static fn () => ['admin' => Auth::publicAdmin(Auth::requireAdmin())]],
            ['GET', '/admin/dashboard', static function () {
                Auth::requireAdmin();
                return Admin::dashboard();
            }],
            ['GET', '/admin/members', static function () {
                Auth::requireAdmin();
                return ['members' => Admin::members(trim((string) (Http::query('q') ?? '')))];
            }],
            ['GET', "/admin/members/$uuid", static function (string $id) {
                Auth::requireAdmin();
                return Admin::member($id);
            }],
            ['POST', "/admin/members/$uuid/adjust", static function (string $id) {
                $admin = Auth::requireAdmin();
                $b = Http::body();
                Points::adjust($admin, $id, (int) ($b['points'] ?? 0), (string) (Util::str($b['note'] ?? '', 200) ?? ''));
                Http::defer(static fn () => Points::pushMetafields());
                return Admin::member($id);
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
            ['POST', '/admin/sync', static function () {
                Auth::requireAdmin();
                return Jobs::run('admin');
            }],

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

    private static function status(): array
    {
        $installed = Setup::installed();
        $out = ['installed' => $installed, 'version' => APP_VERSION];
        if (!$installed) {
            $out['requirements'] = Setup::requirements();
            $out['configExists'] = Config::exists();
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
