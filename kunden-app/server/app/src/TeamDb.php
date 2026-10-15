<?php
declare(strict_types=1);

namespace Club;

/**
 * Umzug in die Datenbank der Team-App: alle club_-Tabellen werden kopiert, danach liest der Club die
 * Zugangsdaten aus der config.php der Team-App. Die alte SQLite-Datei bleibt als Sicherung liegen.
 */
final class TeamDb
{
    public static function status(): array
    {
        $cfg = Config::get('db');
        $path = Db::team() ? Db::teamConfigPath(Config::get('db.config')) : Db::teamConfigPath();
        return [
            'mode' => Db::team() ? 'team' : (is_array($cfg) && ($cfg['driver'] ?? '') === 'sqlite' ? 'sqlite' : 'mysql'),
            'team_config' => $path,
            'team_users' => Admins::teamUsers(),
            'previous' => is_array(Config::get('db_previous')) ? (Config::get('db_previous')['driver'] ?? null) : null,
        ];
    }

    public static function move(?string $configPath): array
    {
        if (Db::team()) {
            throw new HttpError(409, 'Der Club nutzt bereits die Datenbank der Team-App.');
        }
        $path = Db::teamConfigPath($configPath);
        if ($path === null) {
            throw new HttpError(422, 'Die config.php der Team-App wurde nicht gefunden. Bitte den vollständigen Pfad angeben.');
        }
        $teamCfg = Db::teamConfig($path);
        try {
            $target = Db::connect($teamCfg['db']);
        } catch (\Throwable $e) {
            throw new HttpError(502, 'Keine Verbindung zur Datenbank der Team-App: ' . $e->getMessage());
        }
        $targetDriver = Db::driverOf($teamCfg['db']);

        $source = Db::pdo();
        $sourceDriver = Db::driver();
        $sourceTables = [];
        foreach (Db::TABLES as $t) {
            if (Db::tableExists($t)) {
                $sourceTables[] = $t;
            }
        }
        $data = [];
        foreach ($sourceTables as $t) {
            $data[$t] = $source->query("SELECT * FROM $t")->fetchAll(\PDO::FETCH_ASSOC);
        }

        // Zieldatenbank vorbereiten
        Db::use($target, $targetDriver, true);
        try {
            if (!Db::tableExists('users')) {
                throw new HttpError(422, 'Das ist nicht die Datenbank der Team-App (Tabelle „users“ fehlt).');
            }
            Db::migrate();
            if ((int) Db::value('SELECT COUNT(*) FROM club_members') > 0) {
                throw new HttpError(409, 'In der Team-Datenbank gibt es schon Club-Mitglieder. Der Umzug wurde abgebrochen.');
            }
            $counts = Db::tx(static function () use ($data): array {
                $counts = [];
                foreach ($data as $table => $rows) {
                    Db::exec("DELETE FROM $table");
                    foreach ($rows as $row) {
                        Db::insert($table, $row);
                    }
                    $counts[$table] = count($rows);
                }
                return $counts;
            });
            Settings::clearCache();
            Settings::set('schema_version', APP_VERSION);
        } catch (\Throwable $e) {
            Db::use($source, $sourceDriver, false);
            throw $e;
        }

        $cfg = Config::all();
        $cfg['db_previous'] = $cfg['db'];
        $cfg['db'] = ['driver' => 'team', 'config' => $path];
        Config::write($cfg);
        if ($sourceDriver === 'sqlite') {
            try {
                $source->exec('PRAGMA wal_checkpoint(TRUNCATE)');
            } catch (\Throwable) {
                // nur Aufräumen
            }
        }
        Util::log('Club-Daten in die Team-Datenbank umgezogen: ' . Util::json($counts));
        return ['ok' => true, 'counts' => $counts, 'status' => self::status()];
    }
}
