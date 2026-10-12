<?php
declare(strict_types=1);

namespace PC;

/**
 * Verschickt Mails über ein Team-Postfach (z. B. info@) per SMTP – mit denselben Zugangsdaten
 * wie der IMAP-Abruf. So kommen die Mails vom Mailserver der eigenen Domain und landen nicht im Spam.
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

    /** @return array{sent:bool, message:string} */
    public static function send(string $to, string $subject, string $text, ?string $html = null): array
    {
        $mb = self::sender();
        if (!$mb) {
            return ['sent' => false, 'message' => 'Kein Team-Postfach (z. B. info@) mit Passwort eingerichtet – die Mail konnte nicht verschickt werden.'];
        }
        try {
            self::smtp($mb, $to, self::message($mb['email'], $to, $subject, $text, $html));
            return ['sent' => true, 'message' => 'Mail an ' . $to . ' verschickt (über ' . $mb['email'] . ').'];
        } catch (\Throwable $e) {
            Util::log('SMTP: ' . $e->getMessage());
            return ['sent' => false, 'message' => 'Versand fehlgeschlagen: ' . $e->getMessage()];
        }
    }

    private static function message(string $from, string $to, string $subject, string $text, ?string $html): string
    {
        $boundary = 'pc' . bin2hex(random_bytes(8));
        $host = explode('@', $from)[1] ?? 'perfumecloud.de';
        $headers = [
            'From: =?UTF-8?B?' . base64_encode('Perfume Cloud Team') . "?= <$from>",
            "To: <$to>",
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
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

    /** Minimaler SMTP-Client: SSL auf 465, sonst STARTTLS auf 587. */
    private static function smtp(array $mb, string $to, string $data): void
    {
        $host = (string) (Settings::get('smtp_host') ?: $mb['host']);
        $port = (int) (Settings::get('smtp_port') ?: 465);
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
        $scheme = $port === 465 ? 'ssl' : 'tcp';
        $fp = @stream_socket_client("$scheme://$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new \RuntimeException("Keine Verbindung zu $host:$port ($errstr)");
        }
        stream_set_timeout($fp, 20);
        $read = static function () use ($fp): array {
            $lines = '';
            while (($line = fgets($fp, 1024)) !== false) {
                $lines .= $line;
                if (strlen($line) < 4 || $line[3] === ' ') {
                    break;
                }
            }
            return [(int) substr($lines, 0, 3), trim($lines)];
        };
        $cmd = static function (string $c, array $ok) use ($fp, $read): string {
            fwrite($fp, $c . "\r\n");
            [$code, $text] = $read();
            if (!in_array($code, $ok, true)) {
                $shown = str_starts_with($c, 'AUTH') || strlen($c) > 60 ? strtok($c, ' ') : $c;
                throw new \RuntimeException("$shown → $text");
            }
            return $text;
        };
        [$code, $greet] = $read();
        if ($code !== 220) {
            throw new \RuntimeException('Server antwortet nicht: ' . $greet);
        }
        $me = parse_url(Util::baseUrl(), PHP_URL_HOST) ?: 'localhost';
        $cmd("EHLO $me", [250]);
        if ($scheme === 'tcp') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new \RuntimeException('STARTTLS fehlgeschlagen');
            }
            $cmd("EHLO $me", [250]);
        }
        $cmd('AUTH LOGIN', [334]);
        $cmd(base64_encode($mb['user']), [334]);
        try {
            $cmd(base64_encode((string) MailJob::password($mb['id'])), [235]);
        } catch (\RuntimeException) {
            throw new \RuntimeException('Anmeldung am Mailserver fehlgeschlagen – Passwort von ' . $mb['email'] . ' prüfen.');
        }
        $cmd('MAIL FROM:<' . $mb['email'] . '>', [250]);
        $cmd("RCPT TO:<$to>", [250, 251]);
        $cmd('DATA', [354]);
        // Punkte am Zeilenanfang verdoppeln (RFC 5321)
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data));
        $cmd($body . "\r\n.", [250]);
        @fwrite($fp, "QUIT\r\n");
        fclose($fp);
    }
}
