<?php
declare(strict_types=1);

namespace Club;

/** Einrichtungsassistent beim ersten Aufruf: Datenbank und erster Admin-Zugang. */
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

    public static function installed(): bool
    {
        if (!Config::exists()) {
            return false;
        }
        try {
            return (int) Db::value('SELECT COUNT(*) FROM admins') > 0;
        } catch (\Throwable) {
            return false;
        }
    }

    public static function install(array $in): array
    {
        if (self::installed()) {
            throw new HttpError(409, 'Die App ist bereits eingerichtet.');
        }
        $db = is_array($in['db'] ?? null) ? $in['db'] : [];
        $admin = is_array($in['admin'] ?? null) ? $in['admin'] : [];

        $name = Util::str($admin['name'] ?? '', 100, false);
        $email = Util::email($admin['email'] ?? '');
        if ($name === '') {
            throw new HttpError(422, 'Bitte deinen Namen angeben.');
        }
        $hash = Auth::hashPassword((string) ($admin['password'] ?? ''));

        $existing = Config::all();
        if (Config::exists() && is_array($existing['db'] ?? null)) {
            $dbCfg = $existing['db'];
        } elseif (($db['driver'] ?? 'mysql') === 'sqlite') {
            // Für Pakete mit nur einer MySQL-Datenbank (z. B. netcup Webhosting 1000, wenn die Team-App sie nutzt)
            if (!extension_loaded('pdo_sqlite')) {
                throw new HttpError(422, 'SQLite ist auf diesem Server nicht verfügbar. Bitte MySQL wählen.');
            }
            $dbCfg = ['driver' => 'sqlite', 'path' => Config::storageDir() . '/club.sqlite'];
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

        $id = Util::uuid();
        Db::insert('admins', [
            'id' => $id,
            'name' => $name,
            'email' => $email,
            'password_hash' => $hash,
            'created_at' => Util::now(),
            'last_login_at' => Util::now(),
        ]);
        Auth::start('admin', $id);
        return Auth::publicAdmin(Db::one('SELECT * FROM admins WHERE id = ?', [$id]));
    }
}
