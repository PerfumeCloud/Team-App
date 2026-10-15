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

    /** Wurde die config.php der Team-App gefunden? (für den Assistenten) */
    public static function teamDetected(): ?string
    {
        return Db::teamConfigPath();
    }

    public static function installed(): bool
    {
        if (!Config::exists()) {
            return false;
        }
        try {
            return Settings::get('schema_version') !== null && Admins::count() > 0;
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
        $driver = (string) ($db['driver'] ?? 'mysql');

        $existing = Config::all();
        if (Config::exists() && is_array($existing['db'] ?? null)) {
            $dbCfg = $existing['db'];
        } elseif ($driver === 'team') {
            // Empfohlen: dieselbe Datenbank wie die Team-App. Admins sind dann die Admins der Team-App.
            $path = Db::teamConfigPath(Util::str($db['config'] ?? null, 300));
            if ($path === null) {
                throw new HttpError(422, 'Die config.php der Team-App wurde nicht gefunden. Bitte den Pfad angeben.');
            }
            $dbCfg = ['driver' => 'team', 'config' => $path];
        } elseif ($driver === 'sqlite') {
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
        $team = ($dbCfg['driver'] ?? '') === 'team';

        // Ohne Team-App: erster eigener Admin-Zugang
        if (!$team) {
            $name = Util::str($admin['name'] ?? '', 100, false);
            $email = Util::email($admin['email'] ?? '');
            if ($name === '') {
                throw new HttpError(422, 'Bitte deinen Namen angeben.');
            }
            $hash = Auth::hashPassword((string) ($admin['password'] ?? ''));
        }

        try {
            $pdo = Db::connect($dbCfg);
            $driverName = Db::driverOf($dbCfg);
        } catch (HttpError $e) {
            throw new HttpError(422, $e->getMessage());
        } catch (\Throwable $e) {
            throw new HttpError(422, 'Keine Verbindung zur Datenbank. Bitte Zugangsdaten prüfen. (' . $e->getMessage() . ')');
        }

        $newConfig = !Config::exists();
        $cfg = $newConfig ? [
            'db' => $dbCfg,
            'app_key' => Crypto::randomKey(32),
            'cron_key' => Crypto::randomKey(24),
            'base_url' => '',
        ] : $existing;
        // Der App-Schlüssel muss stehen, bevor Geheimnisse verschlüsselt werden
        Config::write($cfg);
        Db::use($pdo, $driverName, $team);
        Db::migrate();

        if ($team) {
            // Anmelden mit dem Zugang aus der Team-App – beweist, dass hier jemand aus dem Team einrichtet
            try {
                $a = Admins::login((string) ($admin['email'] ?? ''), (string) ($admin['password'] ?? ''));
            } catch (HttpError $e) {
                if ($newConfig) {
                    @unlink(Config::path());
                }
                throw new HttpError(401, 'Bitte mit E-Mail und Passwort eines Admins der Team-App anmelden.');
            }
            Auth::start('admin', $a['id']);
            return Auth::publicAdmin($a);
        }

        $id = Util::uuid();
        Db::insert('club_admins', [
            'id' => $id,
            'name' => $name,
            'email' => $email,
            'password_hash' => $hash,
            'created_at' => Util::now(),
            'last_login_at' => Util::now(),
        ]);
        Auth::start('admin', $id);
        return Auth::publicAdmin(Admins::find($id));
    }
}
