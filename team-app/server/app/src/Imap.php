<?php
declare(strict_types=1);

namespace PC;

/**
 * Minimaler IMAP-Client – kommt ohne die PHP-IMAP-Erweiterung aus,
 * die auf vielen Webhostings fehlt bzw. seit PHP 8.4 nicht mehr mitgeliefert wird.
 * Liest fast nur; geschrieben wird nur beim Antworten aus der App (Kopie in „Gesendet“, Markierung „beantwortet“).
 */
final class Imap
{
    /** @var resource|null */
    private $fp = null;
    private int $tagNo = 0;
    /** Anzahl Mails im zuletzt geöffneten Ordner (EXISTS). */
    public int $exists = 0;
    /** UID, die die nächste neue Mail im zuletzt geöffneten Ordner bekommt (0 = unbekannt). */
    public int $uidNext = 0;
    /** Tag des laufenden IDLE-Befehls (null = kein IDLE). */
    private ?string $idleTag = null;

    public function __construct(
        private string $host,
        private int $port = 993,
        private string $security = 'ssl', // ssl | starttls | none (nur für Tests)
        private int $timeout = 25,
        private int $connectTimeout = 10,
    ) {
    }

    public function connect(): void
    {
        $ctx = self::tlsContext($this->host);
        $scheme = $this->security === 'ssl' ? 'ssl' : 'tcp';
        $fp = self::socket("$scheme://{$this->host}:{$this->port}", $this->connectTimeout, $ctx);
        stream_set_timeout($fp, $this->timeout);
        $this->fp = $fp;
        $greeting = $this->readLine();
        if (!str_starts_with($greeting, '* OK') && !str_starts_with($greeting, '* PREAUTH')) {
            throw new \RuntimeException('Unerwartete Begrüßung vom Mailserver: ' . mb_substr(trim($greeting), 0, 120));
        }
        if ($this->security === 'starttls') {
            $this->command('STARTTLS');
            self::enableTls($fp);
        }
    }

    /** Verwendete Verschlüsselung, z. B. „TLSv1.3“ (leer = unverschlüsselt). */
    public function tls(): string
    {
        return $this->fp ? self::tlsProtocol($this->fp) : '';
    }

    /**
     * Anmelden. Passwörter mit Umlauten oder Sonderzeichen außerhalb von ASCII gehen als Literal
     * (in Anführungszeichen erlaubt IMAP nur 7-Bit-Zeichen).
     */
    public function login(string $user, string $password): void
    {
        try {
            if (preg_match('/^[\x20-\x7e]*$/', $user . $password)) {
                $this->command('LOGIN ' . self::quote($user) . ' ' . self::quote($password));
            } else {
                $this->command('LOGIN {' . strlen($user) . '}', [$user . ' {' . strlen($password) . '}', $password]);
            }
        } catch (\RuntimeException $e) {
            if (!str_starts_with($e->getMessage(), 'IMAP:')) {
                throw $e; // Verbindung abgebrochen o. Ä. – kein Passwortproblem
            }
            $server = trim((string) preg_replace('/^IMAP:\s*(NO|BAD)\s*/i', '', $e->getMessage()));
            throw new \RuntimeException('Anmeldung am Postfach fehlgeschlagen – Benutzername oder Passwort prüfen.' . ($server !== '' ? " (Server: $server)" : ''));
        }
    }

    /** Ordner schreibgeschützt öffnen (setzt keine Gelesen-Markierung). Gibt UIDVALIDITY zurück. */
    public function examine(string $folder): string
    {
        $res = $this->command('EXAMINE ' . self::quote($folder));
        $validity = '0';
        $this->exists = 0;
        $this->uidNext = 0;
        foreach ($res as $line) {
            if (preg_match('/\[UIDVALIDITY (\d+)\]/i', $line, $m)) {
                $validity = $m[1];
            } elseif (preg_match('/\[UIDNEXT (\d+)\]/i', $line, $m)) {
                $this->uidNext = (int) $m[1];
            } elseif (preg_match('/^\* (\d+) EXISTS/i', $line, $m)) {
                $this->exists = (int) $m[1];
            }
        }
        return $validity;
    }

    /** Ordner zum Schreiben öffnen (für Markierungen). Gibt UIDVALIDITY zurück. */
    public function select(string $folder): string
    {
        $validity = '0';
        foreach ($this->command('SELECT ' . self::quote($folder)) as $line) {
            if (preg_match('/\[UIDVALIDITY (\d+)\]/i', $line, $m)) {
                $validity = $m[1];
            }
        }
        return $validity;
    }

    /** Markierungen setzen, z. B. storeFlags([12], '\\Answered'). */
    public function storeFlags(array $uids, string $flags): void
    {
        if ($uids) {
            $this->command('UID STORE ' . implode(',', array_map('intval', $uids)) . ' +FLAGS.SILENT (' . $flags . ')');
        }
    }

    /** Mail in einen Ordner legen (z. B. die eigene Antwort in „Gesendet“). */
    public function append(string $folder, string $message, string $flags = '\\Seen'): void
    {
        $data = str_replace(["\r\n", "\n"], ["\n", "\r\n"], $message);
        $this->command('APPEND ' . self::quote($folder) . ' (' . $flags . ') {' . strlen($data) . '}', [$data]);
    }

    /** @return int[] */
    public function search(string $criteria): array
    {
        $uids = [];
        foreach ($this->command('UID SEARCH ' . $criteria) as $line) {
            if (preg_match('/^\* SEARCH\b(.*)$/i', $line, $m)) {
                foreach (preg_split('/\s+/', trim($m[1])) as $n) {
                    if ($n !== '' && ctype_digit($n)) {
                        $uids[] = (int) $n;
                    }
                }
            }
        }
        sort($uids);
        return $uids;
    }

    /**
     * @param int[] $uids
     * @return array<int, array<string, mixed>> nach UID
     */
    public function fetch(array $uids, string $items): array
    {
        $out = [];
        foreach (array_chunk($uids, 50) as $chunk) {
            foreach ($this->command('UID FETCH ' . implode(',', $chunk) . " ($items)") as $line) {
                if (!preg_match('/^\* \d+ FETCH /i', $line, $m)) {
                    continue;
                }
                $tokens = self::parse(substr($line, strlen($m[0])));
                $list = $tokens[0] ?? [];
                if (!is_array($list)) {
                    continue;
                }
                $data = [];
                for ($i = 0; $i + 1 < count($list); $i += 2) {
                    if (!is_string($list[$i])) {
                        continue;
                    }
                    $key = strtoupper(preg_replace('/<[\d.]+>$/', '', $list[$i]));
                    $data[$key] = $list[$i + 1];
                }
                if (isset($data['UID'])) {
                    $out[(int) $data['UID']] = $data;
                }
            }
        }
        return $out;
    }

    /** Fähigkeiten des Servers in Großbuchstaben, z. B. IDLE. @return string[] */
    public function capabilities(): array
    {
        foreach ($this->command('CAPABILITY') as $line) {
            if (preg_match('/^\* CAPABILITY (.*)$/i', $line, $m)) {
                return array_map('strtoupper', preg_split('/\s+/', trim($m[1])) ?: []);
            }
        }
        return [];
    }

    /** NOOP: der Server meldet dabei Änderungen im geöffneten Ordner (EXISTS, EXPUNGE, FETCH). */
    public function noop(): array
    {
        return $this->command('NOOP');
    }

    /**
     * IDLE (RFC 2177): Der Server meldet neue Mails von sich aus, sobald sie ankommen.
     * Danach mit pending() lesen, was der Server schickt, und mit idleDone() beenden.
     */
    public function idle(): void
    {
        $tag = 'A' . (++$this->tagNo);
        $this->write("$tag IDLE\r\n");
        while (true) {
            $line = $this->readLine();
            if (str_starts_with($line, '+')) {
                $this->idleTag = $tag;
                return;
            }
            if (str_starts_with($line, $tag . ' ')) {
                throw new \RuntimeException('IMAP: ' . trim(substr($line, strlen($tag) + 1)));
            }
        }
    }

    /** IDLE beenden. @return string[] ungetaggte Zeilen, die noch kamen */
    public function idleDone(): array
    {
        $tag = $this->idleTag;
        if ($tag === null) {
            return [];
        }
        $this->idleTag = null;
        $this->write("DONE\r\n");
        $untagged = [];
        while (true) {
            $line = $this->readLine();
            if (str_starts_with($line, $tag . ' ')) {
                if (strtoupper(substr($line, strlen($tag) + 1, 2)) !== 'OK') {
                    throw new \RuntimeException('IMAP: ' . trim(substr($line, strlen($tag) + 1)));
                }
                return $untagged;
            }
            $untagged[] = rtrim($line, "\r\n");
        }
    }

    public function idling(): bool
    {
        return $this->idleTag !== null;
    }

    /**
     * Liest alle Zeilen, die schon da sind, ohne zu warten (nach stream_select).
     * Endet die Verbindung, wird eine Ausnahme geworfen.
     * @return string[]
     */
    public function pending(): array
    {
        $lines = [];
        do {
            $line = $this->readLine();
            $lines[] = rtrim($line, "\r\n");
            if (preg_match('/^\* BYE\b/i', $line)) {
                throw new \RuntimeException('Der Mailserver hat die Verbindung beendet.');
            }
        } while ($this->fp && (int) (stream_get_meta_data($this->fp)['unread_bytes'] ?? 0) > 0);
        return $lines;
    }

    /** Liegen schon gelesene, aber noch nicht abgeholte Daten im Puffer? (stream_select sieht die nicht) */
    public function buffered(): bool
    {
        return $this->fp !== null && (int) (stream_get_meta_data($this->fp)['unread_bytes'] ?? 0) > 0;
    }

    /** Die Verbindung selbst (für stream_select). @return resource|null */
    public function stream()
    {
        return $this->fp;
    }

    /** Verbindung ohne LOGOUT schließen (z. B. nach einem Fehler). */
    public function close(): void
    {
        if ($this->fp) {
            @fclose($this->fp);
            $this->fp = null;
        }
        $this->idleTag = null;
    }

    /** @return array<int, array{name:string, flags:string[], delim:string}> */
    public function listFolders(): array
    {
        $folders = [];
        foreach ($this->command('LIST "" "*"') as $line) {
            if (!preg_match('/^\* LIST /i', $line, $m)) {
                continue;
            }
            $t = self::parse(substr($line, strlen($m[0])));
            if (count($t) >= 3 && is_array($t[0]) && is_string($t[2])) {
                $folders[] = ['name' => $t[2], 'flags' => array_map('strval', $t[0]), 'delim' => is_string($t[1]) ? $t[1] : ''];
            }
        }
        return $folders;
    }

    /** Persönlicher Bereich des Postfachs, z. B. ["INBOX.", "."] bei netcup/Dovecot – oder null. @return array{0:string,1:string}|null */
    public function personalNamespace(): ?array
    {
        try {
            foreach ($this->command('NAMESPACE') as $line) {
                if (preg_match('/^\* NAMESPACE \(\("([^"]*)" (?:"([^"]*)"|NIL)\)/i', $line, $m)) {
                    return [$m[1], $m[2] ?? ''];
                }
            }
        } catch (\RuntimeException) {
            return null;
        }
        return null;
    }

    public function createFolder(string $folder): void
    {
        $this->command('CREATE ' . self::quote($folder));
        try {
            $this->command('SUBSCRIBE ' . self::quote($folder)); // damit Outlook und iPhone ihn auch zeigen
        } catch (\RuntimeException) {
        }
    }

    public function renameFolder(string $from, string $to): void
    {
        $this->command('RENAME ' . self::quote($from) . ' ' . self::quote($to));
        try {
            $this->command('UNSUBSCRIBE ' . self::quote($from));
            $this->command('SUBSCRIBE ' . self::quote($to));
        } catch (\RuntimeException) {
        }
    }

    /** Ordner abonnieren (Outlook und iPhone zeigen oft nur abonnierte); Fehler sind egal. */
    public function subscribe(string $folder): void
    {
        try {
            $this->command('SUBSCRIBE ' . self::quote($folder));
        } catch (\RuntimeException) {
        }
    }

    public function deleteFolder(string $folder): void
    {
        try {
            $this->command('UNSUBSCRIBE ' . self::quote($folder));
        } catch (\RuntimeException) {
        }
        $this->command('DELETE ' . self::quote($folder));
    }

    /**
     * Mails im (mit select geöffneten) Ordner in einen anderen verschieben.
     * Mit MOVE (RFC 6851), sonst kopieren, als gelöscht markieren und entfernen.
     */
    public function moveUids(array $uids, string $to): void
    {
        $set = implode(',', array_map('intval', $uids));
        if ($set === '') {
            return;
        }
        $caps = $this->capabilities();
        if (in_array('MOVE', $caps, true)) {
            $this->command("UID MOVE $set " . self::quote($to));
            return;
        }
        $this->command("UID COPY $set " . self::quote($to));
        $this->command("UID STORE $set +FLAGS.SILENT (\\Deleted)");
        $this->command(in_array('UIDPLUS', $caps, true) ? "UID EXPUNGE $set" : 'EXPUNGE');
    }

    /** Ordnernamen in IMAP stehen in „modifiziertem UTF-7“ (RFC 3501) – z. B. „Entw&APw-rfe“ für „Entwürfe“. */
    public static function decodeFolder(string $name): string
    {
        if (!str_contains($name, '&')) {
            return $name;
        }
        $s = @mb_convert_encoding($name, 'UTF-8', 'UTF7-IMAP');
        return is_string($s) && $s !== '' ? $s : $name;
    }

    public static function encodeFolder(string $name): string
    {
        $s = @mb_convert_encoding($name, 'UTF7-IMAP', 'UTF-8');
        return is_string($s) && $s !== '' ? $s : $name;
    }

    public function logout(): void
    {
        if ($this->fp) {
            try {
                if ($this->idleTag !== null) {
                    $this->idleDone();
                }
                $this->command('LOGOUT');
            } catch (\Throwable) {
            }
            fclose($this->fp);
            $this->fp = null;
        }
    }

    /**
     * @param string[] $continuations werden der Reihe nach auf „+“ des Servers geschickt (Literale)
     * @return string[] ungetaggte Antwortzeilen (Literale eingebettet)
     */
    public function command(string $cmd, array $continuations = []): array
    {
        $tag = 'A' . (++$this->tagNo);
        $this->write("$tag $cmd\r\n");
        $untagged = [];
        while (true) {
            $line = $this->readLine();
            $buf = $line;
            $last = $line;
            while (preg_match('/\{(\d+)\}\r\n$/', $last, $m)) {
                $buf .= $this->readBytes((int) $m[1]);
                $last = $this->readLine();
                $buf .= $last;
            }
            if (str_starts_with($buf, $tag . ' ')) {
                $status = strtoupper(substr($buf, strlen($tag) + 1, 2));
                if ($status !== 'OK') {
                    throw new \RuntimeException('IMAP: ' . trim(substr($buf, strlen($tag) + 1)));
                }
                return $untagged;
            }
            if (str_starts_with($buf, '+')) {
                if ($continuations) {
                    $this->write(array_shift($continuations) . "\r\n");
                }
                continue;
            }
            $untagged[] = rtrim($buf, "\r\n");
        }
    }

    private function write(string $data): void
    {
        if (!$this->fp || fwrite($this->fp, $data) === false) {
            throw new \RuntimeException('Verbindung zum Mailserver unterbrochen.');
        }
    }

    private function readLine(): string
    {
        $line = $this->fp ? fgets($this->fp) : false;
        if ($line === false) {
            throw new \RuntimeException('Keine Antwort vom Mailserver (Zeitüberschreitung).');
        }
        return $line;
    }

    private function readBytes(int $n): string
    {
        $data = '';
        while (strlen($data) < $n) {
            $chunk = fread($this->fp, $n - strlen($data));
            if ($chunk === false || ($chunk === '' && feof($this->fp))) {
                throw new \RuntimeException('Verbindung zum Mailserver unterbrochen.');
            }
            $data .= $chunk;
        }
        return $data;
    }

    /** TLS-Einstellungen: Zertifikat und Servername werden immer geprüft. */
    public static function tlsContext(string $host)
    {
        return stream_context_create(['ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'SNI_enabled' => true,
            'peer_name' => $host,
        ]]);
    }

    /**
     * Verbindung öffnen (auch für SMTP). PHP meldet TLS- und DNS-Fehler nur als Warnung –
     * die wird hier aufgefangen, damit die Meldung (z. B. „certificate verify failed“) beim Nutzer ankommt.
     * @return resource
     */
    public static function socket(string $uri, int $timeout, $ctx = null)
    {
        $warnings = [];
        set_error_handler(static function (int $no, string $msg) use (&$warnings): bool {
            $warnings[] = preg_replace('/^stream_socket_client\(\): /', '', $msg);
            return true;
        });
        try {
            $fp = stream_socket_client($uri, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx ?? stream_context_create());
        } finally {
            restore_error_handler();
        }
        if (!$fp) {
            $detail = trim(implode(' · ', array_unique(array_filter([...$warnings, (string) $errstr]))));
            $target = (string) preg_replace('#^[a-z]+://#', '', $uri);
            throw new \RuntimeException("Keine Verbindung zu $target" . ($detail !== '' ? " ($detail)" : ''));
        }
        return $fp;
    }

    /** STARTTLS: Verschlüsselung auf einer bestehenden Verbindung einschalten (TLS 1.2 oder 1.3). */
    public static function enableTls($fp): void
    {
        $warnings = [];
        set_error_handler(static function (int $no, string $msg) use (&$warnings): bool {
            $warnings[] = preg_replace('/^stream_socket_enable_crypto\(\): /', '', $msg);
            return true;
        });
        try {
            $ok = stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT);
        } finally {
            restore_error_handler();
        }
        if ($ok !== true) {
            throw new \RuntimeException('STARTTLS fehlgeschlagen' . ($warnings ? ' (' . implode(' · ', array_unique($warnings)) . ')' : '.'));
        }
    }

    public static function tlsProtocol($fp): string
    {
        $meta = stream_get_meta_data($fp);
        return (string) ($meta['crypto']['protocol'] ?? '');
    }

    /**
     * Nur für die Diagnose: Für welche Namen gilt das Zertifikat des Servers? (ohne Prüfung, ohne Anmeldung)
     * @return string[]
     */
    public static function certificateNames(string $host, int $port): array
    {
        $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'capture_peer_cert' => true, 'SNI_enabled' => true, 'peer_name' => $host]]);
        $fp = @stream_socket_client("ssl://$host:$port", $errno, $errstr, 8, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            return [];
        }
        $cert = stream_context_get_params($fp)['options']['ssl']['peer_certificate'] ?? null;
        fclose($fp);
        $info = $cert ? openssl_x509_parse($cert) : false;
        if (!is_array($info)) {
            return [];
        }
        $names = [];
        if (!empty($info['subject']['CN'])) {
            $names[] = (string) $info['subject']['CN'];
        }
        foreach (explode(',', (string) ($info['extensions']['subjectAltName'] ?? '')) as $alt) {
            if (preg_match('/DNS:\s*(\S+)/', $alt, $m)) {
                $names[] = $m[1];
            }
        }
        return array_values(array_unique($names));
    }

    public static function quote(string $s): string
    {
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }

    /** Zerlegt eine IMAP-Antwort in Listen, Strings und Atome. */
    public static function parse(string $s): array
    {
        $pos = 0;
        $out = [];
        $len = strlen($s);
        while (true) {
            self::skipSpace($s, $pos);
            if ($pos >= $len) {
                break;
            }
            if ($s[$pos] === ')') {
                $pos++;
                continue;
            }
            $out[] = self::token($s, $pos);
        }
        return $out;
    }

    private static function skipSpace(string $s, int &$pos): void
    {
        $len = strlen($s);
        while ($pos < $len && ($s[$pos] === ' ' || $s[$pos] === "\r" || $s[$pos] === "\n")) {
            $pos++;
        }
    }

    private static function token(string $s, int &$pos): mixed
    {
        $len = strlen($s);
        $c = $s[$pos];
        if ($c === '(') {
            $pos++;
            $list = [];
            while (true) {
                self::skipSpace($s, $pos);
                if ($pos >= $len) {
                    return $list;
                }
                if ($s[$pos] === ')') {
                    $pos++;
                    return $list;
                }
                $list[] = self::token($s, $pos);
            }
        }
        if ($c === '"') {
            $pos++;
            $str = '';
            while ($pos < $len) {
                $ch = $s[$pos++];
                if ($ch === '\\' && $pos < $len) {
                    $str .= $s[$pos++];
                    continue;
                }
                if ($ch === '"') {
                    break;
                }
                $str .= $ch;
            }
            return $str;
        }
        if ($c === '{' && preg_match('/\G\{(\d+)\}\r\n/', $s, $m, 0, $pos)) {
            $pos += strlen($m[0]);
            $str = substr($s, $pos, (int) $m[1]);
            $pos += (int) $m[1];
            return $str;
        }
        $start = $pos;
        $depth = 0;
        while ($pos < $len) {
            $ch = $s[$pos];
            if ($ch === '[') {
                $depth++;
            } elseif ($ch === ']') {
                $depth--;
            } elseif ($depth <= 0 && ($ch === ' ' || $ch === '(' || $ch === ')' || $ch === "\r" || $ch === "\n")) {
                break;
            }
            $pos++;
        }
        if ($pos === $start) {
            $pos++;
            return null;
        }
        $atom = substr($s, $start, $pos - $start);
        return strtoupper($atom) === 'NIL' ? null : $atom;
    }
}
