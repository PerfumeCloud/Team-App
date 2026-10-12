<?php
declare(strict_types=1);

namespace PC;

/**
 * Minimaler IMAP-Client (nur lesend) – kommt ohne die PHP-IMAP-Erweiterung aus,
 * die auf vielen Webhostings fehlt bzw. seit PHP 8.4 nicht mehr mitgeliefert wird.
 */
final class Imap
{
    /** @var resource|null */
    private $fp = null;
    private int $tagNo = 0;

    public function __construct(
        private string $host,
        private int $port = 993,
        private string $security = 'ssl', // ssl | starttls | none (nur für Tests)
        private int $timeout = 25,
    ) {
    }

    public function connect(): void
    {
        $ctx = stream_context_create(['ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'SNI_enabled' => true,
            'peer_name' => $this->host,
        ]]);
        $scheme = $this->security === 'ssl' ? 'ssl' : 'tcp';
        $fp = @stream_socket_client("$scheme://{$this->host}:{$this->port}", $errno, $errstr, $this->timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new \RuntimeException("Keine Verbindung zu {$this->host}:{$this->port} ($errstr)");
        }
        stream_set_timeout($fp, $this->timeout);
        $this->fp = $fp;
        $greeting = $this->readLine();
        if (!str_starts_with($greeting, '* OK') && !str_starts_with($greeting, '* PREAUTH')) {
            throw new \RuntimeException('Unerwartete Begrüßung vom Mailserver.');
        }
        if ($this->security === 'starttls') {
            $this->command('STARTTLS');
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new \RuntimeException('STARTTLS fehlgeschlagen.');
            }
        }
    }

    public function login(string $user, string $password): void
    {
        try {
            $this->command('LOGIN ' . self::quote($user) . ' ' . self::quote($password));
        } catch (\RuntimeException) {
            throw new \RuntimeException('Anmeldung am Postfach fehlgeschlagen – Benutzername oder Passwort prüfen.');
        }
    }

    /** Ordner schreibgeschützt öffnen (setzt keine Gelesen-Markierung). Gibt UIDVALIDITY zurück. */
    public function examine(string $folder): string
    {
        $res = $this->command('EXAMINE ' . self::quote($folder));
        foreach ($res as $line) {
            if (preg_match('/\[UIDVALIDITY (\d+)\]/i', $line, $m)) {
                return $m[1];
            }
        }
        return '0';
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

    /** @return array<int, array{name:string, flags:string[]}> */
    public function listFolders(): array
    {
        $folders = [];
        foreach ($this->command('LIST "" "*"') as $line) {
            if (!preg_match('/^\* LIST /i', $line, $m)) {
                continue;
            }
            $t = self::parse(substr($line, strlen($m[0])));
            if (count($t) >= 3 && is_array($t[0]) && is_string($t[2])) {
                $folders[] = ['name' => $t[2], 'flags' => array_map('strval', $t[0])];
            }
        }
        return $folders;
    }

    public function logout(): void
    {
        if ($this->fp) {
            try {
                $this->command('LOGOUT');
            } catch (\Throwable) {
            }
            fclose($this->fp);
            $this->fp = null;
        }
    }

    /** @return string[] ungetaggte Antwortzeilen (Literale eingebettet) */
    public function command(string $cmd): array
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
