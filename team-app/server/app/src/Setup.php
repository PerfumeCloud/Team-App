<?php
declare(strict_types=1);

namespace PC;

/** Einrichtungsassistent beim ersten Aufruf. */
final class Setup
{
    public static function requirements(): array
    {
        return [
            'php' => ['ok' => PHP_VERSION_ID >= 80100, 'label' => 'PHP ' . PHP_VERSION . ' (mind. 8.1)'],
            'pdo_mysql' => ['ok' => extension_loaded('pdo_mysql'), 'label' => 'MySQL-Treiber (pdo_mysql)'],
            'pdo_sqlite' => ['ok' => extension_loaded('pdo_sqlite'), 'label' => 'SQLite-Treiber (pdo_sqlite)'],
            'openssl' => ['ok' => extension_loaded('openssl'), 'label' => 'OpenSSL'],
            'curl' => ['ok' => extension_loaded('curl'), 'label' => 'cURL'],
            'mbstring' => ['ok' => extension_loaded('mbstring'), 'label' => 'mbstring'],
            'writable' => ['ok' => is_writable(APP_ROOT), 'label' => 'App-Ordner beschreibbar'],
        ];
    }

    public static function status(): array
    {
        $installed = false;
        $dbError = null;
        if (Config::exists()) {
            try {
                Db::pdo();
                $installed = (int) Db::value('SELECT COUNT(*) FROM users WHERE deleted = 0') > 0;
            } catch (\Throwable $e) {
                $dbError = 'Datenbank nicht erreichbar.';
            }
        }
        return [
            'installed' => $installed,
            'configExists' => Config::exists(),
            'dbError' => $dbError,
            'version' => APP_VERSION,
            'requirements' => $installed ? null : self::requirements(),
        ];
    }

    public static function install(array $in): array
    {
        if (self::status()['installed']) {
            throw new HttpError(409, 'Die App ist bereits eingerichtet.');
        }
        $db = is_array($in['db'] ?? null) ? $in['db'] : [];
        $admin = is_array($in['admin'] ?? null) ? $in['admin'] : [];

        $name = Util::str($admin['name'] ?? '', 100, false);
        $email = mb_strtolower(trim((string) ($admin['email'] ?? '')));
        $password = (string) ($admin['password'] ?? '');
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Bitte Name und gültige E-Mail-Adresse angeben.');
        }
        $hash = Auth::hashPassword($password);

        $existing = Config::all();
        if (Config::exists() && is_array($existing['db'] ?? null)) {
            $dbCfg = $existing['db'];
        } elseif (($db['driver'] ?? 'mysql') === 'sqlite') {
            $dbCfg = ['driver' => 'sqlite', 'path' => Config::storageDir() . '/app.sqlite'];
        } else {
            $dbCfg = [
                'driver' => 'mysql',
                'host' => Util::str($db['host'] ?? 'localhost', 190, false) ?: 'localhost',
                'port' => (int) ($db['port'] ?? 3306) ?: 3306,
                'name' => Util::str($db['name'] ?? '', 100, false),
                'user' => Util::str($db['user'] ?? '', 100, false),
                'pass' => (string) ($db['pass'] ?? ''),
            ];
        }

        try {
            $pdo = Db::connect($dbCfg);
        } catch (\Throwable $e) {
            throw new HttpError(422, 'Keine Verbindung zur Datenbank. Bitte Zugangsdaten prüfen. (' . $e->getMessage() . ')');
        }

        if (!Config::exists()) {
            Config::write([
                'db' => $dbCfg,
                'app_key' => Crypto::randomKey(32),
                'cron_key' => Crypto::randomKey(24),
                'base_url' => '',
            ]);
        }
        Db::use($pdo, $dbCfg['driver'] === 'sqlite' ? 'sqlite' : 'mysql');
        Db::migrate();

        $now = Util::now();
        $user = [
            'id' => Util::uuid(),
            'name' => $name,
            'email' => $email,
            'password_hash' => $hash,
            'color' => 'blue',
            'role' => 'admin',
            'prefs' => null,
            'created_at' => $now,
            'updated_at' => $now,
            'deleted' => 0,
        ];
        Db::insert('users', $user);
        Settings::set('push_contact', $email);
        WebPush::keys();
        Activity::log($user['id'], 'setup', null, null, 'hat die Team-App eingerichtet');
        Auth::startSession($user);
        return Auth::publicUser($user);
    }
}
