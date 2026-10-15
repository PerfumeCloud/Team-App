<?php
declare(strict_types=1);

namespace PC;

/**
 * Datensicherung: jede Nacht eine verschlüsselte Kopie der Datenbank (Team-App und Club, falls er hier liegt).
 * Aufbewahrt werden die letzten 14 Tage und 8 Wochen (die wöchentliche geht zusätzlich per Mail an die
 * Auswertungsadresse, z. B. auswertung@perfumecloud.de – so liegt immer eine Kopie außerhalb des Servers).
 *
 * Verschlüsselung: AES-256-GCM, Schlüssel aus dem Sicherungs-Passwort (PBKDF2-SHA256, 200 000 Runden).
 * Ohne das Passwort lässt sich eine Sicherung nicht öffnen – auch nicht von uns.
 *
 * Dateiformat: „PCBK“ · Version (1 Byte) · Salt (16) · IV (12) · Tag (16) · verschlüsseltes gzip(JSON)
 */
final class Backup
{
    private const MAGIC = 'PCBK';
    private const ITERATIONS = 200000;
    private const KEEP_DAYS = 14;
    private const KEEP_WEEKS = 8;
    private const MAIL_MAX_BYTES = 15 * 1024 * 1024;

    /** Diese Tabellen sind nur kurzlebig (Anmeldungen, Sperren) und kommen nicht in die Sicherung. */
    private const SKIP = ['sessions', 'login_attempts', 'email_bodies', 'club_sessions', 'club_attempts', 'club_oauth_states', 'club_login_codes', 'club_sso', 'club_order_cache'];

    public static function dir(): string
    {
        $dir = Config::storageDir() . '/backups';
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
            @file_put_contents($dir . '/.htaccess', "Require all denied\n");
        }
        return $dir;
    }

    public static function hasPassword(): bool
    {
        return Settings::getSecret('backup_password') !== null;
    }

    public static function setPassword(string $pw): void
    {
        if (mb_strlen($pw) < 10) {
            throw new HttpError(422, 'Das Sicherungs-Passwort braucht mindestens 10 Zeichen.');
        }
        Settings::setSecret('backup_password', $pw);
    }

    /** Für die Einstellungen. */
    public static function status(): array
    {
        return [
            'hasPassword' => self::hasPassword(),
            'last' => Settings::get('backup_last'),
            'lastMail' => Settings::get('backup_last_mail'),
            'files' => self::files(),
            'email' => Reports::email(),
        ];
    }

    /** @return array<int, array{name:string, size:int, at:int, weekly:bool}> neueste zuerst */
    public static function files(): array
    {
        $out = [];
        foreach (glob(self::dir() . '/pc-*.pcbak') ?: [] as $f) {
            $out[] = ['name' => basename($f), 'size' => (int) filesize($f), 'at' => (int) filemtime($f) * 1000, 'weekly' => str_contains(basename($f), '-woche')];
        }
        usort($out, static fn ($a, $b) => $b['at'] <=> $a['at']);
        return $out;
    }

    public static function path(string $name): string
    {
        if (!preg_match('/^pc-[0-9-]+(-woche|-manuell|-vorher)?(-\d+)?\.pcbak$/', $name) || !is_file(self::dir() . '/' . $name)) {
            throw new HttpError(404, 'Sicherung nicht gefunden.');
        }
        return self::dir() . '/' . $name;
    }

    // ---------- Sichern ----------

    /** Tabellen der Datenbank, die gesichert werden (Team-App + club_…). */
    public static function tables(): array
    {
        $names = Db::driver() === 'mysql'
            ? array_column(Db::all('SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()'), 'n')
            : array_column(Db::all("SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"), 'n');
        $team = ['users', 'tasks', 'notes', 'comments', 'emails', 'orders', 'events', 'activity', 'push_subscriptions', 'settings', 'customer_notes', 'reply_templates', 'replies', 'shipments'];
        $out = array_values(array_filter($names, static fn ($n) =>
            !in_array($n, self::SKIP, true) && (in_array($n, $team, true) || str_starts_with((string) $n, 'club_'))));
        sort($out);
        return $out;
    }

    /** Alle Daten als JSON (Zeilen als Listen, Spaltennamen einmal je Tabelle). */
    public static function export(): string
    {
        $data = ['format' => 'perfumecloud-backup', 'version' => 1, 'app' => APP_VERSION, 'created_at' => Util::now(), 'driver' => Db::driver(), 'tables' => []];
        foreach (self::tables() as $t) {
            $rows = Db::all("SELECT * FROM $t");
            if ($t === 'settings') {
                $rows = array_values(array_filter($rows, static fn ($r) => !in_array($r['k'], ['jobs_lock', 'live'], true)));
            }
            $cols = $rows ? array_keys($rows[0]) : [];
            $data['tables'][$t] = ['columns' => $cols, 'rows' => array_map('array_values', $rows)];
        }
        // App-Schlüssel mitsichern: damit lassen sich die gespeicherten Passwörter auch auf einem neuen Server wieder lesen
        $data['app_key'] = (string) Config::get('app_key', '');
        return Util::json($data);
    }

    public static function encrypt(string $plain, string $password): string
    {
        $salt = random_bytes(16);
        $iv = random_bytes(12);
        $key = hash_pbkdf2('sha256', $password, $salt, self::ITERATIONS, 32, true);
        $tag = '';
        $cipher = openssl_encrypt((string) gzencode($plain, 6), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new \RuntimeException('Verschlüsselung fehlgeschlagen.');
        }
        return self::MAGIC . chr(1) . $salt . $iv . $tag . $cipher;
    }

    /** Entschlüsseln und prüfen. Falsches Passwort oder beschädigte Datei → HttpError 422. */
    public static function decrypt(string $raw, string $password): array
    {
        if (strlen($raw) < 50 || !str_starts_with($raw, self::MAGIC) || ord($raw[4]) !== 1) {
            throw new HttpError(422, 'Das ist keine Sicherung der Team-App (.pcbak).');
        }
        $salt = substr($raw, 5, 16);
        $iv = substr($raw, 21, 12);
        $tag = substr($raw, 33, 16);
        $key = hash_pbkdf2('sha256', $password, $salt, self::ITERATIONS, 32, true);
        $zip = openssl_decrypt(substr($raw, 49), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($zip === false) {
            throw new HttpError(422, 'Passwort falsch oder Datei beschädigt.');
        }
        $json = @gzdecode($zip);
        $data = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($data) || ($data['format'] ?? '') !== 'perfumecloud-backup' || !is_array($data['tables'] ?? null)) {
            throw new HttpError(422, 'Die Sicherung ist beschädigt.');
        }
        return $data;
    }

    /** Übersicht für die Vorschau: Datum, Version, Zeilen je Tabelle. */
    public static function summary(array $data): array
    {
        $tables = [];
        foreach ($data['tables'] as $name => $t) {
            $tables[] = ['name' => $name, 'rows' => count($t['rows'] ?? [])];
        }
        return ['created_at' => (int) ($data['created_at'] ?? 0), 'app' => (string) ($data['app'] ?? '?'), 'tables' => $tables];
    }

    /**
     * Sicherung anlegen. $kind: nacht | woche | manuell | vorher (automatisch vor einer Wiederherstellung)
     * @return array{name:string, size:int, tables:int, rows:int}
     */
    public static function create(string $kind = 'manuell'): array
    {
        $pw = Settings::getSecret('backup_password');
        if ($pw === null) {
            throw new HttpError(409, 'Bitte zuerst ein Sicherungs-Passwort festlegen.');
        }
        @set_time_limit(170);
        $json = self::export();
        $data = json_decode($json, true);
        $rows = array_sum(array_map(static fn ($t) => count($t['rows']), $data['tables']));
        $suffix = match ($kind) {
            'woche' => '-woche',
            'manuell' => '-manuell',
            'vorher' => '-vorher',
            default => '',
        };
        $base = 'pc-' . date('Y-m-d') . $suffix;
        $name = $base . '.pcbak';
        for ($i = 2; $kind !== 'nacht' && is_file(self::dir() . '/' . $name); $i++) {
            $name = "$base-$i.pcbak";
        }
        $file = self::dir() . '/' . $name;
        if (@file_put_contents($file, self::encrypt($json, $pw), LOCK_EX) === false) {
            throw new \RuntimeException('Sicherung konnte nicht gespeichert werden (Schreibrechte im Ordner storage prüfen).');
        }
        @chmod($file, 0600);
        $result = ['name' => $name, 'size' => (int) filesize($file), 'tables' => count($data['tables']), 'rows' => $rows];
        Settings::set('backup_last', $result + ['ok' => true, 'at' => Util::now(), 'kind' => $kind]);
        self::prune();
        return $result;
    }

    /** Alte Sicherungen löschen: Tages-Sicherungen nach 14 Tagen, Wochen-Sicherungen nach 8 Wochen. */
    public static function prune(): void
    {
        $now = time();
        foreach (self::files() as $f) {
            $age = $now - intdiv($f['at'], 1000);
            $limit = $f['weekly'] ? self::KEEP_WEEKS * 7 * 86400 : self::KEEP_DAYS * 86400;
            if ($age > $limit) {
                @unlink(self::dir() . '/' . $f['name']);
            }
        }
    }

    /** Neueste Sicherung entschlüsseln und prüfen. */
    public static function verify(?string $name = null): array
    {
        $name ??= self::files()[0]['name'] ?? null;
        if ($name === null) {
            throw new HttpError(404, 'Es gibt noch keine Sicherung.');
        }
        $pw = Settings::getSecret('backup_password');
        if ($pw === null) {
            throw new HttpError(409, 'Kein Sicherungs-Passwort festgelegt.');
        }
        $data = self::decrypt((string) file_get_contents(self::path($name)), $pw);
        return ['name' => $name, 'ok' => true] + self::summary($data);
    }

    /**
     * Nachts (ab 2 Uhr) sichern; freitags ist es die Wochen-Sicherung und geht per Mail an die Auswertungsadresse.
     * Schlägt etwas fehl, bekommen die Admins eine Push-Nachricht.
     */
    public static function nightly(): string
    {
        $today = date('Y-m-d');
        if ((int) date('G') < 2 || Settings::get('backup_date') === $today || !self::hasPassword()) {
            return '–';
        }
        Settings::set('backup_date', $today);
        $weekly = (int) date('N') === Reports::weeklyConfig()['day'];
        try {
            $r = self::create($weekly ? 'woche' : 'nacht');
            if ($weekly) {
                $mail = self::mail($r['name']);
                if (!$mail['sent']) {
                    self::alert('Wochen-Sicherung nicht verschickt', $mail['message']);
                }
            }
            return $r['name'];
        } catch (\Throwable $e) {
            Settings::set('backup_last', ['ok' => false, 'at' => Util::now(), 'message' => $e->getMessage()]);
            Util::log('Sicherung: ' . $e->getMessage());
            self::alert('Datensicherung fehlgeschlagen', $e->getMessage());
            return 'Fehler: ' . $e->getMessage();
        }
    }

    /** Sicherung per Mail an die Auswertungsadresse (Anhang, solange sie nicht zu groß ist). */
    public static function mail(string $name, ?string $to = null): array
    {
        $to ??= Reports::email();
        $file = self::path($name);
        $size = (int) filesize($file);
        $text = "Hallo,\n\nanbei die wöchentliche Datensicherung der Perfume-Cloud-Team-App ($name, " . self::mb($size) . ").\n\n"
            . "Sie ist verschlüsselt und lässt sich nur mit dem Sicherungs-Passwort öffnen. Wiederherstellen: Team-App → Einstellungen → Auswertungen → Datensicherung → „Aus Datei wiederherstellen“.\n\n"
            . "Bitte diese Mail nicht löschen – sie ist die Kopie außerhalb des Servers.\n";
        $attach = $size <= self::MAIL_MAX_BYTES ? [['name' => $name, 'type' => 'application/octet-stream', 'data' => (string) file_get_contents($file)]] : [];
        if (!$attach) {
            $text .= "\nAchtung: Die Sicherung ist zu groß für eine Mail (" . self::mb($size) . "). Bitte in der App herunterladen und extern speichern.\n";
        }
        $r = Mailer::send($to, 'Datensicherung Team-App · ' . date('d.m.Y'), $text, null, $attach);
        Settings::set('backup_last_mail', ['ok' => $r['sent'], 'at' => Util::now(), 'to' => $to, 'message' => $r['message']]);
        return $r;
    }

    private static function alert(string $title, string $body): void
    {
        $admins = array_column(Db::all("SELECT id FROM users WHERE role = 'admin' AND deleted = 0"), 'id');
        foreach (Db::all('SELECT * FROM users WHERE deleted = 0') as $u) {
            if (in_array($u['id'], $admins, true)) {
                Notify::toUser($u, ['title' => $title, 'body' => mb_substr($body, 0, 180), 'url' => '/einstellungen/auswertungen', 'tag' => 'backup']);
            }
        }
    }

    private static function mb(int $bytes): string
    {
        return number_format($bytes / 1048576, 1, ',', '.') . ' MB';
    }

    // ---------- Wiederherstellen ----------

    /** Hochgeladene Datei prüfen und für die Wiederherstellung bereitlegen (15 Minuten). */
    public static function stage(string $raw, string $password): array
    {
        if ($raw === '') {
            throw new HttpError(422, 'Keine Datei empfangen.');
        }
        $data = self::decrypt($raw, $password);
        $token = bin2hex(random_bytes(16));
        foreach (glob(self::dir() . '/upload-*.tmp') ?: [] as $old) {
            if (filemtime($old) < time() - 900) {
                @unlink($old);
            }
        }
        file_put_contents(self::dir() . "/upload-$token.tmp", Crypto::encrypt(Util::json(['raw' => base64_encode($raw), 'pw' => $password])), LOCK_EX);
        return ['token' => $token] + self::summary($data);
    }

    /** Vorschau einer Sicherung vom Server. */
    public static function preview(string $name): array
    {
        $pw = Settings::getSecret('backup_password');
        if ($pw === null) {
            throw new HttpError(409, 'Kein Sicherungs-Passwort festgelegt.');
        }
        return ['name' => $name] + self::summary(self::decrypt((string) file_get_contents(self::path($name)), $pw));
    }

    /**
     * Wiederherstellen (ersetzt alle gesicherten Tabellen!). Vorher wird automatisch der jetzige Stand gesichert.
     * $source: ['name' => Datei auf dem Server] oder ['token' => hochgeladene Datei]
     */
    public static function restore(array $me, array $source, string $confirm): array
    {
        if ($confirm !== 'WIEDERHERSTELLEN') {
            throw new HttpError(422, 'Bitte zur Bestätigung WIEDERHERSTELLEN eintippen.');
        }
        @set_time_limit(300);
        if (!empty($source['token'])) {
            $tmp = self::dir() . '/upload-' . preg_replace('/[^a-f0-9]/', '', (string) $source['token']) . '.tmp';
            $staged = is_file($tmp) ? json_decode((string) Crypto::decrypt((string) file_get_contents($tmp)), true) : null;
            if (!is_array($staged)) {
                throw new HttpError(410, 'Die hochgeladene Datei ist abgelaufen – bitte noch einmal hochladen.');
            }
            $data = self::decrypt((string) base64_decode((string) $staged['raw']), (string) $staged['pw']);
            @unlink($tmp);
        } else {
            $pw = Settings::getSecret('backup_password');
            if ($pw === null) {
                throw new HttpError(409, 'Kein Sicherungs-Passwort festgelegt.');
            }
            $data = self::decrypt((string) file_get_contents(self::path((string) ($source['name'] ?? ''))), $pw);
        }
        $before = self::hasPassword() ? self::create('vorher')['name'] : null;
        $oldKey = (string) ($data['app_key'] ?? '');
        $current = array_flip(self::tables());
        $restored = [];
        Db::tx(static function () use ($data, $current, &$restored): void {
            foreach ($data['tables'] as $table => $t) {
                if (!isset($current[$table]) || !preg_match('/^[a-z0-9_]+$/', (string) $table)) {
                    continue;
                }
                $have = array_flip(array_column(Db::driver() === 'mysql'
                    ? Db::all('SELECT column_name AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?', [$table])
                    : Db::all("PRAGMA table_info($table)"), Db::driver() === 'mysql' ? 'n' : 'name'));
                $cols = array_values(array_filter((array) $t['columns'], static fn ($c) => isset($have[$c])));
                if ($table === 'settings') {
                    // Sperre und Live-Status gehören zum laufenden Server
                    Db::exec("DELETE FROM settings WHERE k NOT IN ('jobs_lock', 'live')");
                } else {
                    Db::exec("DELETE FROM $table");
                }
                foreach ($t['rows'] as $row) {
                    $assoc = [];
                    foreach ((array) $t['columns'] as $i => $c) {
                        if (isset($have[$c])) {
                            $assoc[$c] = $row[$i] ?? null;
                        }
                    }
                    if ($table === 'settings' && in_array($assoc['k'] ?? '', ['jobs_lock', 'live'], true)) {
                        continue;
                    }
                    if ($assoc) {
                        Db::insert($table, $assoc);
                    }
                }
                $restored[] = ['name' => $table, 'rows' => count($t['rows'])];
            }
        });
        Settings::clearCache();
        $rekeyed = self::rekey($oldKey);
        Settings::set('sync_epoch', (int) Settings::get('sync_epoch', 0) + 1);
        Util::log('Wiederherstellung durch ' . $me['email'] . ': ' . count($restored) . ' Tabellen');
        return ['restored' => $restored, 'before' => $before, 'rekeyed' => $rekeyed, 'created_at' => (int) ($data['created_at'] ?? 0)];
    }

    /**
     * Stammt die Sicherung von einem anderen Server (anderer App-Schlüssel), die gespeicherten Passwörter
     * (Postfächer, Shopify, Club) mit dem jetzigen Schlüssel neu verschlüsseln.
     */
    private static function rekey(string $oldKey): int
    {
        $newKey = (string) Config::get('app_key', '');
        if ($oldKey === '' || $oldKey === $newKey) {
            return 0;
        }
        $old = hash('sha256', $oldKey, true);
        $count = 0;
        foreach (Db::all('SELECT k, v FROM settings') as $r) {
            $v = json_decode((string) $r['v'], true);
            $changed = false;
            $fix = static function (mixed $val) use ($old, &$changed): mixed {
                if (!is_string($val) || !str_starts_with($val, 'v1:')) {
                    return $val;
                }
                $raw = base64_decode(substr($val, 3), true);
                if ($raw === false || strlen($raw) < 28) {
                    return $val;
                }
                $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $old, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
                if ($plain === false) {
                    return $val;
                }
                $changed = true;
                return Crypto::encrypt($plain);
            };
            $v = is_array($v) ? array_map($fix, $v) : $fix($v);
            if ($changed) {
                Db::exec('UPDATE settings SET v = ? WHERE k = ?', [Util::json($v), $r['k']]);
                $count++;
            }
        }
        Settings::clearCache();
        return $count;
    }
}
