<?php
declare(strict_types=1);

namespace PC;

/**
 * Verschickt Mails über ein Team-Postfach (z. B. info@) per SMTP – mit denselben Zugangsdaten
 * wie der IMAP-Abruf. So kommen die Mails vom Mailserver der eigenen Domain und landen nicht im Spam.
 *
 * netcup: SMTP auf demselben Server wie IMAP (mxXXXX.netcup.net), Port 465 (SSL/TLS) oder 587 (STARTTLS),
 * Benutzername = vollständige E-Mail-Adresse. Der Absender muss das angemeldete Postfach sein.
 */
final class Mailer
{
    /** Absender: info@ bevorzugt, sonst das erste Team-Postfach (für alle sichtbar) mit Passwort. */
    public static function sender(): ?array
    {
        $team = array_values(array_filter(MailJob::mailboxes(), static fn ($m) => !$m['visible_to'] && MailJob::password($m['id'])));
        usort($team, static fn ($a, $b) => (str_starts_with($a['email'], 'info@') ? 0 : 1) <=> (str_starts_with($b['email'], 'info@') ? 0 : 1));
        return $team[0] ?? null;
    }

    /**
     * @param array<int, array{name:string, type:string, data:string}> $attachments
     * @return array{sent:bool, message:string}
     */
    public static function send(string $to, string $subject, string $text, ?string $html = null, array $attachments = []): array
    {
        $mb = self::sender();
        if (!$mb) {
            return ['sent' => false, 'message' => 'Kein Team-Postfach (z. B. info@) mit Passwort eingerichtet – die Mail konnte nicht verschickt werden.'];
        }
        $from = self::fromAddress($mb);
        try {
            $data = $attachments
                ? self::compose(['from' => $from, 'fromName' => 'Perfume Cloud Team', 'to' => $to, 'subject' => $subject, 'text' => $text, 'html' => $html, 'attachments' => $attachments, 'auto' => true])
                : self::message($from, $to, $subject, $text, $html);
            self::deliver($mb, $to, $data);
            return ['sent' => true, 'message' => 'Mail an ' . $to . ' verschickt (über ' . $from . ').'];
        } catch (\Throwable $e) {
            Util::log('SMTP: ' . $e->getMessage());
            return ['sent' => false, 'message' => 'Versand fehlgeschlagen: ' . $e->getMessage()];
        }
    }

    /** Absender = angemeldetes Postfach. netcup lehnt Mails ab, deren Absender nicht zur Anmeldung passt. */
    public static function fromAddress(array $mb): string
    {
        $user = mb_strtolower(trim((string) ($mb['user'] ?? '')));
        return filter_var($user, FILTER_VALIDATE_EMAIL) ? $user : $mb['email'];
    }

    /**
     * SMTP-Server und Ports in der Reihenfolge, in der sie probiert werden:
     * eingestellter Port, sonst 465 (SSL/TLS) und bei Verbindungsproblemen 587 (STARTTLS).
     * @return array<int, array{host:string, port:int, mode:string}>
     */
    public static function servers(array $mb): array
    {
        $host = (string) (Settings::get('smtp_host') ?: $mb['host']);
        $port = (int) Settings::get('smtp_port', 0);
        $ports = $port > 0 ? [$port] : ((int) Settings::get('smtp_port_auto', 465) === 587 ? [587, 465] : [465, 587]);
        return array_map(static fn (int $p) => [
            'host' => $host,
            'port' => $p,
            // 'none' gibt es nur in den Tests (Test-Server ohne Verschlüsselung)
            'mode' => ($mb['security'] ?? '') === 'none' ? 'none' : ($p === 465 ? 'ssl' : 'starttls'),
        ], $ports);
    }

    public static function message(string $from, string $to, string $subject, string $text, ?string $html): string
    {
        $boundary = 'pc' . bin2hex(random_bytes(8));
        $host = explode('@', $from)[1] ?? 'perfumecloud.de';
        $headers = [
            'From: =?UTF-8?B?' . base64_encode('Perfume Cloud Team') . "?= <$from>",
            "To: <$to>",
            'Subject: ' . mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n", 9),
            'Date: ' . date('r'),
            'Message-ID: <' . bin2hex(random_bytes(12)) . "@$host>",
            'MIME-Version: 1.0',
            'Auto-Submitted: auto-generated',
        ];
        if ($html === null) {
            $headers[] = 'Content-Type: text/plain; charset=utf-8';
            $headers[] = 'Content-Transfer-Encoding: base64';
            return implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($text));
        }
        $headers[] = "Content-Type: multipart/alternative; boundary=\"$boundary\"";
        return implode("\r\n", $headers) . "\r\n\r\n"
            . "--$boundary\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
            . "--$boundary\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html))
            . "--$boundary--\r\n";
    }

    /**
     * Mail zusammensetzen. $o: from, fromName, to, subject, text, html?, headers? (z. B. In-Reply-To),
     * attachments? [[name, type, data]], auto? (true = automatische Mail, Auto-Submitted).
     */
    public static function compose(array $o): string
    {
        $from = (string) $o['from'];
        $host = explode('@', $from)[1] ?? 'perfumecloud.de';
        $name = trim((string) ($o['fromName'] ?? ''));
        $headers = [
            'From: ' . ($name !== '' ? '=?UTF-8?B?' . base64_encode($name) . '?= ' : '') . "<$from>",
            'To: <' . $o['to'] . '>',
        ];
        $headers[] = 'Subject: ' . mb_encode_mimeheader((string) $o['subject'], 'UTF-8', 'B', "\r\n", 9);
        $headers[] = 'Date: ' . date('r');
        $headers[] = 'Message-ID: ' . ($o['messageId'] ?? '<' . bin2hex(random_bytes(12)) . "@$host>");
        foreach ((array) ($o['headers'] ?? []) as $k => $v) {
            $v = trim((string) preg_replace('/[\r\n]+/', ' ', (string) $v));
            if ($v !== '') {
                $headers[] = "$k: $v";
            }
        }
        $headers[] = 'MIME-Version: 1.0';
        if (!empty($o['auto'])) {
            $headers[] = 'Auto-Submitted: auto-generated';
        }
        $part = static fn (string $type, string $data): string => "Content-Type: $type; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($data));
        $html = $o['html'] ?? null;
        $b1 = 'pc' . bin2hex(random_bytes(8));
        $content = $html === null
            ? $part('text/plain', (string) $o['text'])
            : "Content-Type: multipart/alternative; boundary=\"$b1\"\r\n\r\n--$b1\r\n" . $part('text/plain', (string) $o['text']) . "--$b1\r\n" . $part('text/html', (string) $html) . "--$b1--\r\n";
        // Eingebettete Bilder (Signatur, Logo): multipart/related, im HTML als <img src="cid:…">
        $inline = $html !== null ? array_values(array_filter((array) ($o['inline'] ?? []), static fn ($i) => str_contains((string) $html, 'cid:' . $i['cid']))) : [];
        if ($inline) {
            $b3 = 'pc' . bin2hex(random_bytes(8));
            $related = "Content-Type: multipart/related; boundary=\"$b3\"; type=\"multipart/alternative\"\r\n\r\n--$b3\r\n" . $content;
            foreach ($inline as $i) {
                $fn = (string) preg_replace('/[^A-Za-z0-9._-]/', '_', (string) $i['name']);
                $related .= "--$b3\r\nContent-Type: {$i['type']}; name=\"$fn\"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <{$i['cid']}>\r\nContent-Disposition: inline; filename=\"$fn\"\r\n\r\n" . chunk_split(base64_encode((string) $i['data']));
            }
            $content = $related . "--$b3--\r\n";
        }
        $attachments = (array) ($o['attachments'] ?? []);
        if (!$attachments) {
            return implode("\r\n", $headers) . "\r\n" . $content;
        }
        $b2 = 'pc' . bin2hex(random_bytes(8));
        $out = implode("\r\n", $headers) . "\r\nContent-Type: multipart/mixed; boundary=\"$b2\"\r\n\r\n--$b2\r\n" . $content;
        foreach ($attachments as $a) {
            $fn = (string) preg_replace('/[^A-Za-z0-9._-]/', '_', (string) $a['name']);
            $out .= "--$b2\r\nContent-Type: {$a['type']}; name=\"$fn\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$fn\"\r\n\r\n" . chunk_split(base64_encode((string) $a['data']));
        }
        return $out . "--$b2--\r\n";
    }

    /**
     * Mail per SMTP abgeben. Ohne $to nur verbinden und anmelden.
     * $report(step, label, ok, detail) bekommt jeden Schritt für die Verbindungsprüfung
     * (step: connect | auth | from | send). Zugangsdaten tauchen nie in Meldungen auf.
     */
    public static function deliver(array $mb, ?string $to, ?string $data, ?callable $report = null): void
    {
        $report ??= static function (): void {
        };
        $pw = MailJob::password($mb['id']);
        if ($pw === null) {
            throw new \RuntimeException('Passwort fehlt.');
        }
        $servers = self::servers($mb);
        $fp = null;
        $caps = [];
        $error = null;
        foreach ($servers as $i => $srv) {
            $label = "Versand (SMTP) {$srv['host']}:{$srv['port']}";
            try {
                [$fp, $caps] = self::open($srv);
                $tls = Imap::tlsProtocol($fp);
                $report('connect', $label, true, $tls !== '' ? "verbunden, verschlüsselt ($tls)" : 'verbunden (unverschlüsselt, nur Test)');
                if ((int) Settings::get('smtp_port', 0) === 0 && (int) Settings::get('smtp_port_auto', 465) !== $srv['port']) {
                    Settings::set('smtp_port_auto', $srv['port']); // beim nächsten Mal gleich den Port nehmen, der geht
                }
                break;
            } catch (\RuntimeException $e) {
                $error = $e;
                $next = $servers[$i + 1] ?? null;
                $report('connect', $label, false, $e->getMessage() . ($next ? " – versuche Port {$next['port']}" : ''));
            }
        }
        if (!$fp) {
            throw $error ?? new \RuntimeException('Keine Verbindung zum Mailserver.');
        }
        try {
            $user = (string) $mb['user'];
            try {
                self::auth($fp, $caps, $user, $pw);
                $report('auth', "Anmeldung als $user", true, 'ok');
            } catch (\RuntimeException $e) {
                $report('auth', "Anmeldung als $user", false, $e->getMessage());
                throw $e;
            }
            if ($to === null || $data === null) {
                return;
            }
            $from = self::fromAddress($mb);
            try {
                self::cmd($fp, "MAIL FROM:<$from>", [250]);
            } catch (\RuntimeException $e) {
                $report('from', "Absender $from", false, $e->getMessage());
                throw new \RuntimeException("Der Server lehnt den Absender $from ab: " . $e->getMessage());
            }
            try {
                self::cmd($fp, "RCPT TO:<$to>", [250, 251]);
                self::cmd($fp, 'DATA', [354]);
                // Punkte am Zeilenanfang verdoppeln (RFC 5321)
                $body = (string) preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data));
                $answer = self::cmd($fp, rtrim($body, "\r\n") . "\r\n.", [250], 'Nachricht');
                $report('send', "Mail an $to", true, 'verschickt · ' . mb_substr($answer, 0, 120));
            } catch (\RuntimeException $e) {
                $report('send', "Mail an $to", false, $e->getMessage());
                throw $e;
            }
        } finally {
            @fwrite($fp, "QUIT\r\n");
            fclose($fp);
        }
    }

    /** @return array{0:resource, 1:string[]} Verbindung und Fähigkeiten des Servers (EHLO) */
    private static function open(array $srv): array
    {
        $scheme = $srv['mode'] === 'ssl' ? 'ssl' : 'tcp';
        $fp = Imap::socket("$scheme://{$srv['host']}:{$srv['port']}", 10, Imap::tlsContext($srv['host']));
        stream_set_timeout($fp, 20);
        try {
            [$code, $greet] = self::read($fp);
            if ($code !== 220) {
                throw new \RuntimeException('Server antwortet nicht wie erwartet: ' . ($greet !== '' ? $greet : 'keine Begrüßung (Zeitüberschreitung)'));
            }
            $me = parse_url(Util::baseUrl(), PHP_URL_HOST) ?: 'localhost';
            $caps = self::ehlo($fp, $me);
            if ($srv['mode'] === 'starttls') {
                self::cmd($fp, 'STARTTLS', [220]);
                Imap::enableTls($fp);
                $caps = self::ehlo($fp, $me);
            }
        } catch (\RuntimeException $e) {
            fclose($fp);
            throw $e;
        }
        return [$fp, $caps];
    }

    /** @return array{0:int, 1:string} */
    private static function read($fp): array
    {
        $lines = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $lines .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return [(int) substr($lines, 0, 3), trim($lines)];
    }

    /** Befehl senden. $shown erscheint statt des Befehls in Fehlermeldungen (nie Zugangsdaten zeigen). */
    private static function cmd($fp, string $c, array $ok, ?string $shown = null): string
    {
        if (@fwrite($fp, $c . "\r\n") === false) {
            throw new \RuntimeException('Verbindung zum Mailserver unterbrochen.');
        }
        [$code, $text] = self::read($fp);
        if (!in_array($code, $ok, true)) {
            throw new \RuntimeException(($shown ?? $c) . ' → ' . ($text !== '' ? $text : 'keine Antwort (Zeitüberschreitung)'));
        }
        return $text;
    }

    /** @return string[] z. B. ["AUTH PLAIN LOGIN", "STARTTLS", …] */
    private static function ehlo($fp, string $me): array
    {
        $caps = [];
        foreach (preg_split('/\r?\n/', self::cmd($fp, "EHLO $me", [250])) as $line) {
            $caps[] = strtoupper(trim(substr($line, 4)));
        }
        return $caps;
    }

    /** AUTH PLAIN (eine Zeile, auch für Umlaute im Passwort), sonst AUTH LOGIN. */
    private static function auth($fp, array $caps, string $user, string $pw): void
    {
        $mechs = [];
        foreach ($caps as $c) {
            if (preg_match('/^AUTH[ =](.+)$/', $c, $m)) {
                $mechs = [...$mechs, ...preg_split('/\s+/', trim($m[1]))];
            }
        }
        try {
            if (in_array('PLAIN', $mechs, true) || !in_array('LOGIN', $mechs, true)) {
                self::cmd($fp, 'AUTH PLAIN ' . base64_encode("\0$user\0$pw"), [235], 'AUTH PLAIN');
            } else {
                self::cmd($fp, 'AUTH LOGIN', [334]);
                self::cmd($fp, base64_encode($user), [334], 'Benutzername');
                self::cmd($fp, base64_encode($pw), [235], 'Passwort');
            }
        } catch (\RuntimeException $e) {
            $server = (string) preg_replace('/^.*?→\s*/u', '', $e->getMessage());
            throw new \RuntimeException('Anmeldung am Mailserver fehlgeschlagen – Benutzername oder Passwort prüfen. (Server: ' . $server . ')');
        }
    }
}
