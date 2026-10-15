<?php
declare(strict_types=1);

namespace Club;

use PDO;

/**
 * Dünne PDO-Schicht für MySQL/MariaDB (netcup) und SQLite (lokal, Tests).
 *
 * Alle Tabellen des Clubs beginnen mit „club_“. So kann der Club dieselbe Datenbank wie die Team-App nutzen
 * (config.php: 'db' => ['driver' => 'team', 'config' => '/pfad/zur/team-app/config.php']). Die Zugangsdaten
 * kommen dann aus der Team-App, und Team-Mitglieder mit Admin-Rechten sind automatisch Club-Admins.
 */
final class Db
{
    private static ?PDO $pdo = null;
    private static string $driver = '';
    private static bool $team = false;

    /** Tabellen der Version 1.0 hießen ohne Präfix. */
    private const LEGACY = ['settings', 'admins', 'members', 'sessions', 'oauth_states', 'login_codes', 'attempts', 'ledger', 'codes', 'order_cache'];
    private const LEGACY_INDEXES = [
        'admins_email' => 'admins', 'members_shopify' => 'members', 'members_email' => 'members', 'sessions_subject' => 'sessions',
        'login_codes_email' => 'login_codes', 'attempts_bucket' => 'attempts', 'ledger_member' => 'ledger',
        'codes_member' => 'codes', 'codes_code' => 'codes', 'codes_status' => 'codes',
    ];

    /** Alle Tabellen des Clubs (für den Umzug in die Team-Datenbank). */
    public const TABLES = [
        'club_settings', 'club_admins', 'club_members', 'club_sessions', 'club_oauth_states', 'club_login_codes', 'club_attempts',
        'club_orders', 'club_ledger', 'club_codes', 'club_order_cache', 'club_push_subs', 'club_push_queue', 'club_promotions',
        'club_broadcasts', 'club_feedback', 'club_invites', 'club_claims', 'club_sso',
        'club_surveys', 'club_survey_optout', 'club_referral_codes', 'club_referral_clicks', 'club_referral_orders', 'club_alerts',
    ];

    public static function connect(array $cfg): PDO
    {
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        if (($cfg['driver'] ?? '') === 'team') {
            $cfg = self::teamConfig($cfg['config'] ?? null)['db'];
        }
        if (($cfg['driver'] ?? '') === 'sqlite') {
            $path = $cfg['path'] ?? (Config::storageDir() . '/club.sqlite');
            $pdo = new PDO('sqlite:' . $path, null, null, $options);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            return $pdo;
        }
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $cfg['host'] ?? 'localhost',
            (int) ($cfg['port'] ?? 3306),
            $cfg['name'] ?? ''
        );
        $pdo = new PDO($dsn, (string) ($cfg['user'] ?? ''), (string) ($cfg['pass'] ?? ''), $options);
        $pdo->exec("SET time_zone = '+00:00'");
        return $pdo;
    }

    /** Treiber (sqlite|mysql) zu einer Konfiguration, auch für 'team'. */
    public static function driverOf(array $cfg): string
    {
        if (($cfg['driver'] ?? '') === 'team') {
            $cfg = self::teamConfig($cfg['config'] ?? null)['db'];
        }
        return ($cfg['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    }

    // ---------- Team-App ----------

    /** Wo die config.php der Team-App liegt. Auf netcup liegen beide Subdomains im selben Webspace. */
    public static function teamConfigPath(?string $configured = null): ?string
    {
        $candidates = [];
        if (is_string($configured) && $configured !== '') {
            $candidates[] = $configured;
        }
        $env = getenv('CLUB_TEAM_CONFIG');
        if ($env !== false && $env !== '') {
            $candidates[] = $env;
        }
        // app.perfumecloud.de/httpdocs → team.perfumecloud.de/httpdocs/config.php
        $candidates[] = dirname(APP_ROOT, 2) . '/team.perfumecloud.de/httpdocs/config.php';
        $candidates[] = dirname(APP_ROOT, 2) . '/team.perfumecloud.de/config.php';
        $candidates[] = dirname(APP_ROOT) . '/team.perfumecloud.de/httpdocs/config.php';
        foreach ($candidates as $c) {
            if (@is_file($c) && @is_readable($c)) {
                return $c;
            }
        }
        return null;
    }

    public static function teamConfig(?string $configured = null): array
    {
        $path = self::teamConfigPath($configured);
        if ($path === null) {
            throw new HttpError(503, 'Die Einstellungen der Team-App (config.php) wurden nicht gefunden.');
        }
        $cfg = (static fn (string $p): mixed => require $p)($path);
        if (!is_array($cfg) || !is_array($cfg['db'] ?? null)) {
            throw new HttpError(503, 'In der config.php der Team-App fehlt die Datenbank.');
        }
        $cfg['__path'] = $path;
        return $cfg;
    }

    /** Läuft der Club in der Datenbank der Team-App? */
    public static function team(): bool
    {
        self::pdo();
        return self::$team;
    }

    // ---------- Verbindung ----------

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $cfg = Config::get('db');
            if (!is_array($cfg)) {
                throw new HttpError(503, 'Die App ist noch nicht eingerichtet.');
            }
            self::$pdo = self::connect($cfg);
            self::$driver = self::driverOf($cfg);
            self::$team = ($cfg['driver'] ?? '') === 'team';
            self::upgradeIfNeeded();
        }
        return self::$pdo;
    }

    /** Nach einem Update (neue APP_VERSION) Tabellen und Spalten nachziehen. */
    private static function upgradeIfNeeded(): void
    {
        static $checked = false;
        if ($checked) {
            return;
        }
        $checked = true;
        try {
            $version = Settings::get('schema_version');
        } catch (\Throwable) {
            // Noch nicht eingerichtet – oder eine Datenbank aus Version 1.0 (Tabellen ohne Präfix)
            if (self::tableExists('members') && !self::tableExists('club_members') && !self::tableExists('users')) {
                self::migrate();
            }
            return;
        }
        if ($version !== null && $version !== APP_VERSION) {
            self::migrate();
        }
    }

    public static function use(PDO $pdo, string $driver, bool $team = false): void
    {
        self::$pdo = $pdo;
        self::$driver = $driver;
        self::$team = $team;
        Settings::clearCache();
        Admins::resetCache();
    }

    public static function driver(): string
    {
        self::pdo();
        return self::$driver;
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function value(string $sql, array $params = []): mixed
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $table, array $row): void
    {
        $cols = array_keys($row);
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $table,
            implode(', ', $cols),
            implode(', ', array_map(static fn ($c) => ':' . $c, $cols))
        );
        self::exec($sql, self::bind($row));
    }

    public static function update(string $table, array $row, array $where): int
    {
        $set = implode(', ', array_map(static fn ($c) => "$c = :$c", array_keys($row)));
        $cond = implode(' AND ', array_map(static fn ($c) => "$c = :w_$c", array_keys($where)));
        $params = self::bind($row);
        foreach ($where as $k => $v) {
            $params['w_' . $k] = $v;
        }
        return self::exec("UPDATE $table SET $set WHERE $cond", $params);
    }

    /** „?, ?, ?“ für IN (…) */
    public static function marks(array $values): string
    {
        return implode(',', array_fill(0, max(1, count($values)), '?'));
    }

    public static function tx(callable $fn): mixed
    {
        $pdo = self::pdo();
        if ($pdo->inTransaction()) {
            return $fn();
        }
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Sperrt eine Zeile bis zum Ende der Transaktion (MySQL). SQLite sperrt beim Schreiben ohnehin die ganze Datei. */
    public static function lockRow(string $table, string $id): void
    {
        if (self::driver() === 'mysql') {
            self::value("SELECT id FROM $table WHERE id = ? FOR UPDATE", [$id]);
        } else {
            self::exec("UPDATE $table SET id = id WHERE id = ?", [$id]);
        }
    }

    private static function bind(array $row): array
    {
        $out = [];
        foreach ($row as $k => $v) {
            $out[$k] = is_bool($v) ? (int) $v : $v;
        }
        return $out;
    }

    public static function tableExists(string $table): bool
    {
        if (self::driver() === 'mysql') {
            return (bool) self::value('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [$table]);
        }
        return (bool) self::value("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [$table]);
    }

    public static function hasColumn(string $table, string $column): bool
    {
        if (self::driver() === 'mysql') {
            return (bool) self::value(
                'SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
                [$table, $column]
            );
        }
        foreach (self::all("PRAGMA table_info($table)") as $col) {
            if ($col['name'] === $column) {
                return true;
            }
        }
        return false;
    }

    private static function indexExists(string $table, string $index): bool
    {
        if (self::driver() === 'mysql') {
            return (bool) self::value(
                'SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
                [$table, $index]
            );
        }
        return (bool) self::value("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?", [$index]);
    }

    /** Version 1.0 → 1.1: Tabellen bekommen das Präfix club_. Nie in der Team-Datenbank (dort heißen eigene Tabellen so). */
    private static function renameLegacy(): void
    {
        if (!self::tableExists('members') || self::tableExists('club_members') || self::tableExists('users')) {
            return;
        }
        $pdo = self::pdo();
        $mysql = self::driver() === 'mysql';
        foreach (self::LEGACY as $old) {
            if (!self::tableExists($old) || self::tableExists('club_' . $old)) {
                continue;
            }
            $pdo->exec($mysql ? "RENAME TABLE $old TO club_$old" : "ALTER TABLE $old RENAME TO club_$old");
        }
        // Alte Indexnamen entfernen, die neuen heißen club_…
        foreach (self::LEGACY_INDEXES as $idx => $old) {
            if ($mysql) {
                $table = 'club_' . $old;
                if (self::tableExists($table) && self::indexExists($table, $idx)) {
                    $pdo->exec("ALTER TABLE $table DROP INDEX $idx");
                }
            } else {
                $pdo->exec("DROP INDEX IF EXISTS $idx");
            }
        }
        Settings::clearCache();
    }

    /** Legt alle Tabellen an und ergänzt neue Spalten (idempotent). */
    public static function migrate(): void
    {
        self::renameLegacy();
        $mysql = self::driver() === 'mysql';
        $long = $mysql ? 'MEDIUMTEXT' : 'TEXT';
        $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';

        $tables = [
            'club_settings' => "k VARCHAR(100) NOT NULL PRIMARY KEY,
                v $long NULL,
                updated_at BIGINT NOT NULL",
            // Eigene Zugänge für den Admin-Bereich (ohne Team-App). Mit Team-Datenbank kommen Admins aus der Team-App.
            'club_admins' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(190) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at BIGINT NOT NULL,
                last_login_at BIGINT NULL",
            // Kundinnen und Kunden: eine Zeile je Shopify-Kundenkonto
            'club_members' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                shopify_id VARCHAR(64) NOT NULL,
                email VARCHAR(190) NOT NULL,
                first_name VARCHAR(100) NULL,
                last_name VARCHAR(100) NULL,
                joined_at BIGINT NULL,
                last_seen_at BIGINT NULL,
                orders_synced_at BIGINT NULL,
                meta_dirty SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL",
            'club_sessions' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                kind VARCHAR(10) NOT NULL,
                subject_id VARCHAR(36) NOT NULL,
                id_token TEXT NULL,
                user_agent VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                last_seen_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL",
            // Anmeldung über Shopify: state, nonce und PKCE-Schlüssel für maximal 15 Minuten
            'club_oauth_states' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                verifier VARCHAR(128) NULL,
                nonce VARCHAR(64) NOT NULL,
                next_path VARCHAR(200) NULL,
                created_at BIGINT NOT NULL",
            // Anmeldung per E-Mail-Code (Ausweichweg)
            'club_login_codes' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                email VARCHAR(190) NOT NULL,
                code_hash VARCHAR(64) NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL",
            'club_attempts' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                bucket VARCHAR(200) NOT NULL,
                created_at BIGINT NOT NULL",
            // Punkte je Bestellung. Werden bei jedem Abgleich aus dem aktuellen Stand der Bestellung neu berechnet.
            'club_orders' => "order_id VARCHAR(64) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                name VARCHAR(40) NOT NULL,
                ordered_at BIGINT NOT NULL,
                amount_cents INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(12) NOT NULL,
                reason VARCHAR(20) NULL,
                shipped_at BIGINT NULL,
                available_at BIGINT NULL,
                updated_at BIGINT NOT NULL",
            // Alle anderen Buchungen: Boni, Einlösen, Rückbuchung, Verfall, Korrektur durch das Team
            'club_ledger' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                kind VARCHAR(20) NOT NULL,
                points INTEGER NOT NULL,
                note VARCHAR(255) NULL,
                ref VARCHAR(64) NULL,
                created_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL",
            // Eingelöste Punkte als persönlicher Shopify-Rabattcode
            'club_codes' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                code VARCHAR(40) NOT NULL,
                discount_id VARCHAR(80) NULL,
                points INTEGER NOT NULL,
                value_cents INTEGER NOT NULL,
                min_cents INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(12) NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                used_at BIGINT NULL,
                order_name VARCHAR(40) NULL,
                updated_at BIGINT NOT NULL",
            // Zwischenspeicher der Bestellliste je Kunde (spart Anfragen an Shopify)
            'club_order_cache' => "member_id VARCHAR(36) NOT NULL PRIMARY KEY,
                data $long NOT NULL,
                fetched_at BIGINT NOT NULL",
            // Push-Abos der Mitglieder (je Gerät eins)
            'club_push_subs' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh VARCHAR(200) NOT NULL,
                auth VARCHAR(100) NOT NULL,
                user_agent VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                last_ok_at BIGINT NULL,
                last_status INTEGER NULL,
                last_error VARCHAR(255) NULL,
                fail_count INTEGER NOT NULL DEFAULT 0",
            // Warteschlange: Push-Nachrichten warten hier auf das Ende der Ruhezeit und werden nie doppelt verschickt (dedupe)
            'club_push_queue' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                kind VARCHAR(30) NOT NULL,
                title VARCHAR(200) NOT NULL,
                body VARCHAR(500) NOT NULL,
                url VARCHAR(255) NULL,
                dedupe VARCHAR(120) NULL,
                broadcast_id VARCHAR(36) NULL,
                not_before BIGINT NOT NULL,
                status VARCHAR(12) NOT NULL,
                devices INTEGER NOT NULL DEFAULT 0,
                error VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                sent_at BIGINT NULL",
            // Aktionen mit mehrfachen Punkten (z. B. Launch-Woche, Black Friday)
            'club_promotions' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                factor DOUBLE PRECISION NOT NULL DEFAULT 2,
                starts_at BIGINT NOT NULL,
                ends_at BIGINT NOT NULL,
                push SMALLINT NOT NULL DEFAULT 1,
                push_title VARCHAR(120) NULL,
                push_body VARCHAR(300) NULL,
                pushed_at BIGINT NULL,
                created_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            // Nachrichten an Mitglieder aus der Team-App (Entwurf → Prüfung → Freigabe → Versand)
            'club_broadcasts' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                kind VARCHAR(20) NOT NULL DEFAULT 'news',
                template VARCHAR(30) NULL,
                title VARCHAR(120) NOT NULL,
                body VARCHAR(400) NOT NULL,
                url VARCHAR(255) NULL,
                audience VARCHAR(20) NOT NULL DEFAULT 'all',
                status VARCHAR(12) NOT NULL DEFAULT 'draft',
                scheduled_at BIGINT NULL,
                created_by VARCHAR(36) NULL,
                created_by_name VARCHAR(100) NULL,
                approved_by VARCHAR(36) NULL,
                approved_by_name VARCHAR(100) NULL,
                approved_at BIGINT NULL,
                sent_at BIGINT NULL,
                recipients INTEGER NOT NULL DEFAULT 0,
                review_note VARCHAR(255) NULL,
                error VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL",
            // Feedback von Mitgliedern (Gut/Neutral/Schlecht + Text)
            'club_feedback' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NULL,
                broadcast_id VARCHAR(36) NULL,
                rating VARCHAR(10) NOT NULL,
                text TEXT NULL,
                name VARCHAR(200) NULL,
                email VARCHAR(190) NULL,
                mailed SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL",
            // Einladungen an die Warteliste
            'club_invites' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                customer_id VARCHAR(64) NOT NULL,
                email VARCHAR(190) NOT NULL,
                first_name VARCHAR(100) NULL,
                status VARCHAR(12) NOT NULL DEFAULT 'new',
                error VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                queued_at BIGINT NULL,
                sent_at BIGINT NULL",
            // Bonus-Anfragen von Mitgliedern (z. B. „Ich habe eine Bewertung geschrieben“)
            'club_claims' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                kind VARCHAR(20) NOT NULL,
                note VARCHAR(500) NULL,
                status VARCHAR(12) NOT NULL DEFAULT 'open',
                points INTEGER NULL,
                decided_by VARCHAR(36) NULL,
                decided_at BIGINT NULL,
                created_at BIGINT NOT NULL",
            // Einmal-Anmeldung aus der Team-App (60 Sekunden gültig)
            'club_sso' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL",
            // Version 1.2: Befragung nach der Zustellung (je Bestellung eine Zeile, auch für Nicht-Mitglieder)
            'club_surveys' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                token VARCHAR(40) NOT NULL,
                order_id VARCHAR(64) NOT NULL,
                order_name VARCHAR(40) NOT NULL,
                member_id VARCHAR(36) NULL,
                customer_id VARCHAR(64) NULL,
                email VARCHAR(190) NULL,
                first_name VARCHAR(100) NULL,
                consent SMALLINT NOT NULL DEFAULT 0,
                items TEXT NOT NULL,
                status VARCHAR(12) NOT NULL,
                reason VARCHAR(30) NULL,
                channel VARCHAR(20) NULL,
                shipped_at BIGINT NULL,
                delivered_at BIGINT NULL,
                send_at BIGINT NULL,
                sent_at BIGINT NULL,
                answered_at BIGINT NULL,
                rating_min INTEGER NULL,
                rating_avg DOUBLE PRECISION NULL,
                answers TEXT NULL,
                comment TEXT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                alerted SMALLINT NOT NULL DEFAULT 0,
                reorder_at BIGINT NULL,
                reorder_sent_at BIGINT NULL,
                test SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL",
            // Widerspruch gegen Bewertungs- und Nachkauf-Mails (nur der Hash der Adresse)
            'club_survey_optout' => "email_hash VARCHAR(64) NOT NULL PRIMARY KEY,
                source VARCHAR(20) NULL,
                created_at BIGINT NOT NULL",
            // Empfehlungslinks: je Mitglied ein Rabattcode in Shopify für Freunde
            'club_referral_codes' => "member_id VARCHAR(36) NOT NULL PRIMARY KEY,
                code VARCHAR(40) NOT NULL,
                discount_id VARCHAR(80) NULL,
                config_hash VARCHAR(40) NULL,
                status VARCHAR(12) NOT NULL,
                error VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL",
            // Klicks auf Empfehlungslinks: nur Anzahl je Tag, keine Daten der Besucher
            'club_referral_clicks' => "id VARCHAR(60) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                day VARCHAR(10) NOT NULL,
                n INTEGER NOT NULL DEFAULT 0",
            // Bestellungen über einen Empfehlungscode (auch von Nicht-Mitgliedern)
            'club_referral_orders' => "order_id VARCHAR(64) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                code VARCHAR(40) NOT NULL,
                order_name VARCHAR(40) NOT NULL,
                friend_customer_id VARCHAR(64) NULL,
                ordered_at BIGINT NOT NULL,
                amount_cents INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(12) NOT NULL,
                reason VARCHAR(30) NULL,
                shipped_at BIGINT NULL,
                available_at BIGINT NULL,
                credited_at BIGINT NULL,
                ledger_id VARCHAR(36) NULL,
                test SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL",
            // Hinweise an das Team (z. B. schlechte Bewertung) – die Team-App holt sie ab und legt Aufgaben an
            'club_alerts' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                kind VARCHAR(20) NOT NULL,
                payload TEXT NOT NULL,
                test SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                claimed_at BIGINT NULL",
        ];

        $pdo = self::pdo();
        foreach ($tables as $name => $cols) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS $name ($cols)$suffix");
        }

        // Version 1.1: Stufen, Boni, Empfehlungen, Push, Verfall
        $columns = [
            'club_members' => [
                'tier' => "VARCHAR(20) NOT NULL DEFAULT 'bronze'",
                'tier_until' => 'BIGINT NULL',
                'tier_spend_cents' => 'INTEGER NOT NULL DEFAULT 0',
                'birthday' => 'VARCHAR(5) NULL',
                'birthday_set_at' => 'BIGINT NULL',
                'ref_code' => 'VARCHAR(12) NULL',
                'referred_by' => 'VARCHAR(36) NULL',
                'waitlist' => 'SMALLINT NOT NULL DEFAULT 0',
                'push_prefs' => 'VARCHAR(255) NULL',
                'newsletter_at' => 'BIGINT NULL',
                'newsletter_checked_at' => 'BIGINT NULL',
                'reward_level' => 'INTEGER NOT NULL DEFAULT 0',
                // Version 1.2
                'test' => 'SMALLINT NOT NULL DEFAULT 0',
                'survey_mail' => 'SMALLINT NULL',
            ],
            'club_orders' => [
                'rate' => 'DOUBLE PRECISION NULL',
                'factor' => 'DOUBLE PRECISION NOT NULL DEFAULT 1',
                'promo_id' => 'VARCHAR(36) NULL',
                'delivered_at' => 'BIGINT NULL',
            ],
            'club_ledger' => [
                'status' => "VARCHAR(12) NOT NULL DEFAULT 'available'",
                'unlock_rule' => 'VARCHAR(20) NULL',
                'unlock_min_cents' => 'INTEGER NULL',
                'expires_days' => 'INTEGER NULL',
                'expires_at' => 'BIGINT NULL',
                'credited_at' => 'BIGINT NULL',
            ],
        ];
        foreach ($columns as $table => $cols) {
            foreach ($cols as $col => $def) {
                if (!self::hasColumn($table, $col)) {
                    $pdo->exec("ALTER TABLE $table ADD COLUMN $col $def");
                }
            }
        }
        // Gemeinsame Benutzerverwaltung: In der Team-App kann jede Person zusätzlich Club-Admin sein
        if (self::$team && self::tableExists('users') && !self::hasColumn('users', 'club_access')) {
            $pdo->exec('ALTER TABLE users ADD COLUMN club_access SMALLINT NOT NULL DEFAULT 0');
        }
        // Bestellungen aus 1.0 behalten ihre Punkte: Satz = damaliger Punkte-je-Euro-Wert
        if ((int) self::value('SELECT COUNT(*) FROM club_orders WHERE rate IS NULL') > 0) {
            $p = Settings::get('program', []);
            $rate = is_array($p) && is_numeric($p['earn_per_euro'] ?? null) ? (float) $p['earn_per_euro'] : 1.0;
            self::exec('UPDATE club_orders SET rate = ?, factor = 1 WHERE rate IS NULL', [$rate]);
        }
        self::exec('UPDATE club_ledger SET credited_at = created_at WHERE credited_at IS NULL');

        $indexes = [
            ['club_admins_email', 'club_admins', 'email', true],
            ['club_members_shopify', 'club_members', 'shopify_id', true],
            ['club_members_email', 'club_members', 'email', false],
            ['club_members_ref', 'club_members', 'ref_code', true],
            ['club_sessions_subject', 'club_sessions', 'subject_id', false],
            ['club_login_codes_email', 'club_login_codes', 'email', false],
            ['club_attempts_bucket', 'club_attempts', 'bucket', false],
            ['club_orders_member', 'club_orders', 'member_id', false],
            ['club_ledger_member', 'club_ledger', 'member_id', false],
            ['club_codes_member', 'club_codes', 'member_id', false],
            ['club_codes_code', 'club_codes', 'code', true],
            ['club_codes_status', 'club_codes', 'status', false],
            ['club_push_subs_member', 'club_push_subs', 'member_id', false],
            ['club_push_queue_status', 'club_push_queue', 'status', false],
            ['club_push_queue_dedupe', 'club_push_queue', 'dedupe', true],
            ['club_push_queue_member', 'club_push_queue', 'member_id', false],
            ['club_broadcasts_status', 'club_broadcasts', 'status', false],
            ['club_invites_customer', 'club_invites', 'customer_id', true],
            ['club_invites_status', 'club_invites', 'status', false],
            ['club_claims_member', 'club_claims', 'member_id', false],
            ['club_feedback_created', 'club_feedback', 'created_at', false],
            ['club_surveys_token', 'club_surveys', 'token', true],
            ['club_surveys_order', 'club_surveys', 'order_id', true],
            ['club_surveys_status', 'club_surveys', 'status', false],
            ['club_surveys_email', 'club_surveys', 'email', false],
            ['club_surveys_member', 'club_surveys', 'member_id', false],
            ['club_referral_codes_code', 'club_referral_codes', 'code', true],
            ['club_referral_clicks_member', 'club_referral_clicks', 'member_id', false],
            ['club_referral_orders_member', 'club_referral_orders', 'member_id', false],
            ['club_referral_orders_status', 'club_referral_orders', 'status', false],
            ['club_alerts_claimed', 'club_alerts', 'claimed_at', false],
        ];
        foreach ($indexes as [$idx, $table, $col, $unique]) {
            $u = $unique ? 'UNIQUE ' : '';
            if ($mysql) {
                if (!self::indexExists($table, $idx)) {
                    $pdo->exec("CREATE {$u}INDEX $idx ON $table ($col)");
                }
            } else {
                $pdo->exec("CREATE {$u}INDEX IF NOT EXISTS $idx ON $table ($col)");
            }
        }

        if (!self::value("SELECT 1 FROM club_settings WHERE k = 'jobs_lock'")) {
            self::insert('club_settings', ['k' => 'jobs_lock', 'v' => '0', 'updated_at' => Util::now()]);
        }
        // Schlüssel, mit dem die Team-App den Versand anstößt (liegt nur in der gemeinsamen Datenbank)
        if (!is_string(Settings::get('internal_key')) || Settings::get('internal_key') === '') {
            Settings::set('internal_key', Crypto::randomKey(24));
        }
        Settings::set('schema_version', APP_VERSION);
    }
}
