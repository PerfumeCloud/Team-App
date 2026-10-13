<?php
declare(strict_types=1);

namespace Club;

/**
 * Verschickt E-Mails per SMTP über ein eigenes Postfach (z. B. info@perfumecloud.de bei netcup).
 * Nur für den Anmeldecode, falls die Anmeldung per E-Mail-Code eingeschaltet ist.
 */
final class Mailer
{
    public static function config(): array
    {
        $c = Settings::get('smtp', []);
        $c = is_array($c) ? $c : [];
        return [
            'host' => (string) ($c['host'] ?? ''),
            'port' => (int) ($c['port'] ?? 465),
            'user' => (string) ($c['user'] ?? ''),
            'from_email' => (string) ($c['from_email'] ?? ''),
            'from_name' => (string) ($c['from_name'] ?? 'Perfume Cloud'),
        ];
    }

    public static function configured(): bool
    {
        if (self::logFile()) {
            return true;
        }
        $c = self::config();
        return $c['host'] !== '' && $c['user'] !== '' && Settings::getSecret('smtp_password') !== null;
    }

    public static function save(array $in): void
    {
        $user = Util::str($in['user'] ?? '', 190, false);
        $port = (int) ($in['port'] ?? 465);
        Settings::set('smtp', [
            'host' => Util::str($in['host'] ?? '', 190, false),
            'port' => in_array($port, [465, 587], true) ? $port : 465,
            'user' => $user,
            'from_email' => Util::str($in['from_email'] ?? '', 190, false) ?: $user,
            'from_name' => Util::str($in['from_name'] ?? '', 100, false) ?: 'Perfume Cloud',
        ]);
        if (!empty($in['password'])) {
            Settings::setSecret('smtp_password', (string) $in['password']);
        }
    }

    /** In Tests landen Mails in einer Datei statt im Postfach. */
    private static function logFile(): ?string
    {
        $env = getenv('CLUB_MAIL_LOG');
        return $env !== false && $env !== '' ? $env : null;
    }

    /** @return array{sent:bool, message:string} */
    public static function send(string $to, string $subject, string $text, ?string $html = null): array
    {
        if ($log = self::logFile()) {
            @file_put_contents($log, Util::json(['to' => $to, 'subject' => $subject, 'text' => $text]) . "\n", FILE_APPEND | LOCK_EX);
            return ['sent' => true, 'message' => 'Mail protokolliert.'];
        }
        if (!self::configured()) {
            return ['sent' => false, 'message' => 'Kein Postfach für den Versand eingerichtet.'];
        }
        $c = self::config();
        try {
            self::smtp($c, $to, self::message($c, $to, $subject, $text, $html));
            return ['sent' => true, 'message' => 'Mail an ' . $to . ' verschickt.'];
        } catch (\Throwable $e) {
            Util::log('SMTP: ' . $e->getMessage());
            return ['sent' => false, 'message' => 'Versand fehlgeschlagen: ' . $e->getMessage()];
        }
    }

    /** E-Mail mit dem Anmeldecode im Stil des Shops (Elfenbein, Castoro/Georgia). */
    public static function codeHtml(string $code, string $program): string
    {
        $p = htmlspecialchars($program, ENT_QUOTES);
        return '<!doctype html><html lang="de"><body style="margin:0;background:#F4EFE6;font-family:Georgia,serif;color:#2E2A27">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6;padding:32px 12px"><tr><td align="center">'
            . '<table role="presentation" width="100%" style="max-width:460px;background:#FFFFFF;border-radius:24px;border:1px solid #DDD3C5;padding:32px">'
            . '<tr><td style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#80562F">Perfume Cloud</td></tr>'
            . '<tr><td style="padding-top:12px;font-size:26px;color:#232120">Dein Anmeldecode</td></tr>'
            . '<tr><td style="padding-top:12px;font-size:16px;line-height:1.5">Mit diesem Code meldest du dich im ' . $p . ' an:</td></tr>'
            . '<tr><td style="padding:22px 0;font-size:38px;letter-spacing:.3em;color:#232120;font-weight:bold">' . $code . '</td></tr>'
            . '<tr><td style="font-size:14px;line-height:1.5;color:#6b625b">Der Code gilt 10 Minuten. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.</td></tr>'
            . '</table></td></tr></table></body></html>';
    }

    private static function message(array $c, string $to, string $subject, string $text, ?string $html): string
    {
        $from = $c['from_email'] ?: $c['user'];
        $boundary = 'pcc' . bin2hex(random_bytes(8));
        $host = explode('@', $from)[1] ?? 'perfumecloud.de';
        $headers = [
            'From: =?UTF-8?B?' . base64_encode($c['from_name']) . "?= <$from>",
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
    private static function smtp(array $c, string $to, string $data): void
    {
        $host = $c['host'];
        $port = $c['port'];
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
        $cmd = static function (string $cmd, array $ok) use ($fp, $read): string {
            fwrite($fp, $cmd . "\r\n");
            [$code, $text] = $read();
            if (!in_array($code, $ok, true)) {
                $shown = str_starts_with($cmd, 'AUTH') || strlen($cmd) > 60 ? strtok($cmd, ' ') : $cmd;
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
        $cmd(base64_encode($c['user']), [334]);
        try {
            $cmd(base64_encode((string) Settings::getSecret('smtp_password')), [235]);
        } catch (\RuntimeException) {
            throw new \RuntimeException('Anmeldung am Mailserver fehlgeschlagen – Benutzer und Passwort prüfen.');
        }
        $cmd('MAIL FROM:<' . ($c['from_email'] ?: $c['user']) . '>', [250]);
        $cmd("RCPT TO:<$to>", [250, 251]);
        $cmd('DATA', [354]);
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data));
        $cmd($body . "\r\n.", [250]);
        @fwrite($fp, "QUIT\r\n");
        fclose($fp);
    }
}
