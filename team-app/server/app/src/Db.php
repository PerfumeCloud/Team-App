<?php
declare(strict_types=1);

namespace PC;

use PDO;

/** Dünne PDO-Schicht, die mit MySQL/MariaDB (netcup) und SQLite (lokal) funktioniert. */
final class Db
{
    private static ?PDO $pdo = null;
    private static string $driver = '';

    public static function connect(array $cfg): PDO
    {
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        if (($cfg['driver'] ?? '') === 'sqlite') {
            $path = $cfg['path'] ?? (Config::storageDir() . '/app.sqlite');
            $pdo = new PDO('sqlite:' . $path, null, null, $options);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            $pdo->exec('PRAGMA foreign_keys = OFF');
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

    /**
     * Für lang laufende Prozesse (Sofort-Abruf): Hat der Datenbankserver die Verbindung nach einer
     * Pause geschlossen („MySQL server has gone away“), beim nächsten Zugriff neu verbinden.
     */
    public static function keepAlive(): void
    {
        if (self::$pdo === null || self::$driver === 'sqlite') {
            return;
        }
        try {
            @self::$pdo->query('SELECT 1');
        } catch (\Throwable) {
            self::$pdo = null;
        }
    }

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $cfg = Config::get('db');
            if (!is_array($cfg)) {
                throw new HttpError(503, 'Die App ist noch nicht eingerichtet.');
            }
            self::$pdo = self::connect($cfg);
            self::$driver = ($cfg['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
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
            return; // noch nicht eingerichtet
        }
        if ($version !== null && $version !== APP_VERSION) {
            self::migrate();
        }
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

    /** Gibt es diese Tabelle? (z. B. club_settings, wenn der Club seine Tabellen in diese Datenbank gelegt hat) */
    public static function tableExists(string $table): bool
    {
        if (self::driver() === 'mysql') {
            return (bool) self::value(
                'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                [$table]
            );
        }
        return (bool) self::value("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [$table]);
    }

    public static function use(PDO $pdo, string $driver): void
    {
        self::$pdo = $pdo;
        self::$driver = $driver;
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

    /** Fügt ein oder aktualisiert anhand des Primärschlüssels. */
    public static function upsert(string $table, array $row, string $key = 'id'): void
    {
        $exists = self::value("SELECT 1 FROM $table WHERE $key = ?", [$row[$key]]);
        if ($exists) {
            $data = $row;
            unset($data[$key]);
            if ($data) {
                self::update($table, $data, [$key => $row[$key]]);
            }
        } else {
            self::insert($table, $row);
        }
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

    private static function bind(array $row): array
    {
        $out = [];
        foreach ($row as $k => $v) {
            $out[$k] = is_bool($v) ? (int) $v : $v;
        }
        return $out;
    }

    /** Legt alle Tabellen an (idempotent). */
    public static function migrate(): void
    {
        $mysql = self::driver() === 'mysql';
        $long = $mysql ? 'MEDIUMTEXT' : 'TEXT';
        $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';

        $tables = [
            'users' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(190) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                color VARCHAR(20) NOT NULL DEFAULT 'blue',
                role VARCHAR(20) NOT NULL DEFAULT 'member',
                prefs TEXT NULL,
                club_access SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            'sessions' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                user_agent VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                last_seen_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL",
            'login_attempts' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                ip VARCHAR(64) NOT NULL,
                created_at BIGINT NOT NULL",
            'tasks' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                title VARCHAR(300) NOT NULL,
                description $long NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'todo',
                priority VARCHAR(20) NOT NULL DEFAULT 'normal',
                category VARCHAR(60) NULL,
                assignee_id VARCHAR(36) NULL,
                due_date VARCHAR(10) NULL,
                position DOUBLE PRECISION NOT NULL DEFAULT 0,
                checklist TEXT NULL,
                source_email_id VARCHAR(40) NULL,
                completed_at BIGINT NULL,
                created_by VARCHAR(36) NULL,
                updated_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            'notes' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                title VARCHAR(300) NOT NULL DEFAULT '',
                body $long NULL,
                pinned SMALLINT NOT NULL DEFAULT 0,
                color VARCHAR(20) NULL,
                created_by VARCHAR(36) NULL,
                updated_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            'comments' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                task_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                body TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            'emails' => "id VARCHAR(40) NOT NULL PRIMARY KEY,
                mailbox VARCHAR(190) NOT NULL,
                message_id VARCHAR(255) NULL,
                from_name VARCHAR(255) NULL,
                from_email VARCHAR(255) NULL,
                subject VARCHAR(500) NULL,
                snippet TEXT NULL,
                received_at BIGINT NOT NULL,
                seen SMALLINT NOT NULL DEFAULT 0,
                flagged SMALLINT NOT NULL DEFAULT 0,
                answered SMALLINT NOT NULL DEFAULT 0,
                important SMALLINT NOT NULL DEFAULT 0,
                reasons VARCHAR(255) NULL,
                score INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'open',
                assignee_id VARCHAR(36) NULL,
                done_by VARCHAR(36) NULL,
                done_at BIGINT NULL,
                notified SMALLINT NOT NULL DEFAULT 0,
                owner_id VARCHAR(36) NULL,
                auto SMALLINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            'orders' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                name VARCHAR(40) NOT NULL,
                created_at BIGINT NOT NULL,
                shop_updated_at BIGINT NOT NULL,
                total_cents BIGINT NOT NULL DEFAULT 0,
                currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
                financial_status VARCHAR(40) NULL,
                fulfillment_status VARCHAR(40) NULL,
                cancelled SMALLINT NOT NULL DEFAULT 0,
                item_count INTEGER NOT NULL DEFAULT 0,
                items TEXT NULL,
                synced_at BIGINT NOT NULL",
            'events' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                title VARCHAR(300) NOT NULL DEFAULT '',
                kind VARCHAR(20) NOT NULL DEFAULT 'termin',
                start_date VARCHAR(10) NOT NULL,
                start_time VARCHAR(5) NULL,
                end_date VARCHAR(10) NULL,
                end_time VARCHAR(5) NULL,
                location VARCHAR(300) NULL,
                notes TEXT NULL,
                attendees TEXT NULL,
                remind_minutes INTEGER NULL,
                reminded_at BIGINT NULL,
                created_by VARCHAR(36) NULL,
                updated_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                deleted SMALLINT NOT NULL DEFAULT 0",
            'activity' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                user_id VARCHAR(36) NULL,
                type VARCHAR(40) NOT NULL,
                entity_type VARCHAR(20) NULL,
                entity_id VARCHAR(40) NULL,
                text VARCHAR(500) NOT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL",
            'push_subscriptions' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh VARCHAR(200) NOT NULL,
                auth VARCHAR(100) NOT NULL,
                user_agent VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                last_ok_at BIGINT NULL,
                last_status INTEGER NULL,
                last_error VARCHAR(255) NULL,
                fail_count INTEGER NOT NULL DEFAULT 0",
            'settings' => "k VARCHAR(100) NOT NULL PRIMARY KEY,
                v $long NULL,
                updated_at BIGINT NOT NULL",
        ];

        $pdo = self::pdo();
        foreach ($tables as $name => $cols) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS $name ($cols)$suffix");
        }

        // 1.1: persönliche Postfächer. Bisher nicht gemeldete Mails gelten als bekannt,
        // damit nach dem Update keine Flut an Push-Nachrichten kommt.
        if (!self::hasColumn('emails', 'owner_id')) {
            $pdo->exec('ALTER TABLE emails ADD COLUMN owner_id VARCHAR(36) NULL');
            $pdo->exec('UPDATE emails SET notified = 2 WHERE notified = 0');
        }
        // 1.2: Newsletter/automatische Mails werden mitgespeichert (für „Push bei wirklich allen Mails“),
        // Postfächer haben „Sichtbar für“
        if (!self::hasColumn('emails', 'auto')) {
            $pdo->exec('ALTER TABLE emails ADD COLUMN auto SMALLINT NOT NULL DEFAULT 0');
        }
        // 1.3: Push-Fehler je Gerät merken (statt Geräte sofort zu löschen), Club-Zugang für Personen.
        // club_access legt auch der Club selbst an, wenn er seine Tabellen in diese Datenbank legt.
        foreach (['last_status' => 'INTEGER NULL', 'last_error' => 'VARCHAR(255) NULL'] as $col => $type) {
            if (!self::hasColumn('push_subscriptions', $col)) {
                $pdo->exec("ALTER TABLE push_subscriptions ADD COLUMN $col $type");
            }
        }
        if (!self::hasColumn('users', 'club_access')) {
            $pdo->exec('ALTER TABLE users ADD COLUMN club_access SMALLINT NOT NULL DEFAULT 0');
        }
        MailJob::migrateLegacy();

        $indexes = [
            ['users_email', 'users', 'email', true],
            ['tasks_updated', 'tasks', 'updated_at', false],
            ['notes_updated', 'notes', 'updated_at', false],
            ['comments_updated', 'comments', 'updated_at', false],
            ['comments_task', 'comments', 'task_id', false],
            ['emails_updated', 'emails', 'updated_at', false],
            ['emails_received', 'emails', 'received_at', false],
            ['emails_owner', 'emails', 'owner_id', false],
            ['emails_mailbox', 'emails', 'mailbox', false],
            ['events_updated', 'events', 'updated_at', false],
            ['events_start', 'events', 'start_date', false],
            ['orders_created', 'orders', 'created_at', false],
            ['activity_updated', 'activity', 'updated_at', false],
            ['sessions_user', 'sessions', 'user_id', false],
            ['push_user', 'push_subscriptions', 'user_id', false],
            ['login_ip', 'login_attempts', 'ip', false],
        ];
        foreach ($indexes as [$idx, $table, $col, $unique]) {
            $u = $unique ? 'UNIQUE ' : '';
            if ($mysql) {
                $exists = self::value(
                    'SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
                    [$table, $idx]
                );
                if (!$exists) {
                    $pdo->exec("CREATE {$u}INDEX $idx ON $table ($col)");
                }
            } else {
                $pdo->exec("CREATE {$u}INDEX IF NOT EXISTS $idx ON $table ($col)");
            }
        }

        if (!self::value("SELECT 1 FROM settings WHERE k = 'jobs_lock'")) {
            self::insert('settings', ['k' => 'jobs_lock', 'v' => '0', 'updated_at' => Util::now()]);
        }
        Settings::set('schema_version', APP_VERSION);
    }
}
