<?php
declare(strict_types=1);

namespace Club;

use PDO;

/** Dünne PDO-Schicht, die mit MySQL/MariaDB (netcup) und SQLite (lokal, Tests) funktioniert. */
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

    /** Legt alle Tabellen an (idempotent). */
    public static function migrate(): void
    {
        $mysql = self::driver() === 'mysql';
        $long = $mysql ? 'MEDIUMTEXT' : 'TEXT';
        $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';

        $tables = [
            'settings' => "k VARCHAR(100) NOT NULL PRIMARY KEY,
                v $long NULL,
                updated_at BIGINT NOT NULL",
            // Zugänge für den Admin-Bereich (Perfume Cloud Team)
            'admins' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(190) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at BIGINT NOT NULL,
                last_login_at BIGINT NULL",
            // Kundinnen und Kunden: eine Zeile je Shopify-Kundenkonto
            'members' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
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
            'sessions' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                kind VARCHAR(10) NOT NULL,
                subject_id VARCHAR(36) NOT NULL,
                id_token TEXT NULL,
                user_agent VARCHAR(255) NULL,
                created_at BIGINT NOT NULL,
                last_seen_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL",
            // Anmeldung über Shopify: state, nonce und PKCE-Schlüssel für maximal 15 Minuten
            'oauth_states' => "id VARCHAR(64) NOT NULL PRIMARY KEY,
                verifier VARCHAR(128) NULL,
                nonce VARCHAR(64) NOT NULL,
                next_path VARCHAR(200) NULL,
                created_at BIGINT NOT NULL",
            // Anmeldung per E-Mail-Code (Ausweichweg)
            'login_codes' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                email VARCHAR(190) NOT NULL,
                code_hash VARCHAR(64) NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL",
            'attempts' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
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
            // Alle anderen Buchungen: Willkommensbonus, Einlösen, Rückbuchung, Korrektur durch das Team
            'ledger' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
                member_id VARCHAR(36) NOT NULL,
                kind VARCHAR(20) NOT NULL,
                points INTEGER NOT NULL,
                note VARCHAR(255) NULL,
                ref VARCHAR(64) NULL,
                created_by VARCHAR(36) NULL,
                created_at BIGINT NOT NULL",
            // Eingelöste Punkte als persönlicher Shopify-Rabattcode
            'codes' => "id VARCHAR(36) NOT NULL PRIMARY KEY,
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
            'order_cache' => "member_id VARCHAR(36) NOT NULL PRIMARY KEY,
                data $long NOT NULL,
                fetched_at BIGINT NOT NULL",
        ];

        $pdo = self::pdo();
        foreach ($tables as $name => $cols) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS $name ($cols)$suffix");
        }

        $indexes = [
            ['admins_email', 'admins', 'email', true],
            ['members_shopify', 'members', 'shopify_id', true],
            ['members_email', 'members', 'email', false],
            ['sessions_subject', 'sessions', 'subject_id', false],
            ['login_codes_email', 'login_codes', 'email', false],
            ['attempts_bucket', 'attempts', 'bucket', false],
            ['club_orders_member', 'club_orders', 'member_id', false],
            ['ledger_member', 'ledger', 'member_id', false],
            ['codes_member', 'codes', 'member_id', false],
            ['codes_code', 'codes', 'code', true],
            ['codes_status', 'codes', 'status', false],
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
