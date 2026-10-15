<?php
declare(strict_types=1);

namespace Club;

/**
 * Verschickt E-Mails per SMTP über ein eigenes Postfach (z. B. info@perfumecloud.de bei netcup).
 * Nur Bestätigungen und Einladungen: Anmeldecode, Willkommen im Club, Einladung an die Warteliste,
 * Feedback an das Team. Alles andere (Punkte, Versand, Aktionen) kommt per Push.
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

    /**
     * @param array<string,string> $headers zusätzliche Kopfzeilen, z. B. List-Unsubscribe
     * @return array{sent:bool, message:string}
     */
    public static function send(string $to, string $subject, string $text, ?string $html = null, ?string $replyTo = null, array $headers = []): array
    {
        if ($log = self::logFile()) {
            @file_put_contents($log, Util::json(['to' => $to, 'subject' => $subject, 'text' => $text, 'reply_to' => $replyTo, 'html' => $html !== null, 'headers' => $headers ?: null, 'body' => $html]) . "\n", FILE_APPEND | LOCK_EX);
            return ['sent' => true, 'message' => 'Mail protokolliert.'];
        }
        if (!self::configured()) {
            return ['sent' => false, 'message' => 'Kein Postfach für den Versand eingerichtet.'];
        }
        $c = self::config();
        try {
            self::smtp($c, $to, self::message($c, $to, $subject, $text, $html, $replyTo, $headers));
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

    /**
     * Gerüst für alle Mails im Stil der App: Elfenbein, weiße Karte, Holzbraun, Castoro/Georgia.
     * $button: ['label' => …, 'url' => …]
     */
    public static function layout(string $label, string $title, string $contentHtml, ?array $button = null, string $footer = ''): string
    {
        $btn = '';
        if ($button) {
            $btn = '<tr><td style="padding-top:26px"><a href="' . htmlspecialchars((string) $button['url'], ENT_QUOTES) . '" '
                . 'style="display:inline-block;background:#232120;color:#F4EFE6;text-decoration:none;border-radius:999px;padding:14px 26px;font-size:16px;font-family:Georgia,serif">'
                . '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#8BC49E;margin-right:10px;vertical-align:1px"></span>'
                . htmlspecialchars((string) $button['label']) . '</a></td></tr>';
        }
        return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>'
            . '<body style="margin:0;background:#F4EFE6;font-family:Georgia,\'Times New Roman\',serif;color:#2E2A27">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6;padding:32px 12px"><tr><td align="center">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:24px;border:1px solid #CDBFAD;padding:34px 30px">'
            . '<tr><td style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#80562F">' . htmlspecialchars($label) . '</td></tr>'
            . '<tr><td style="padding-top:12px;font-size:27px;line-height:1.2;color:#232120">' . $title . '</td></tr>'
            . '<tr><td style="padding-top:16px;font-size:16px;line-height:1.6">' . $contentHtml . '</td></tr>'
            . $btn
            . '</table>'
            . ($footer !== '' ? '<p style="max-width:520px;margin:18px auto 0;font-size:12px;line-height:1.5;color:#6b625b;text-align:center">' . $footer . '</p>' : '')
            . '</td></tr></table></body></html>';
    }

    /** Willkommensmail nach dem Beitritt (Bestätigung, geht an alle neuen Mitglieder). */
    public static function welcome(array $member): array
    {
        if (!(bool) Settings::get('welcome_mail', true) || !self::configured()) {
            return ['sent' => false, 'message' => 'aus'];
        }
        $p = Points::program();
        $name = trim((string) ($member['first_name'] ?? ''));
        $balance = Points::balance($member['id']);
        $locked = Points::locked($member['id']);
        $tier = Tiers::of($member, $p);
        $hallo = $name !== '' ? 'Hallo ' . $name : 'Hallo';
        $rate = Tiers::rateText((float) $tier['rate']);
        $lines = [
            'Für jeden Euro bekommst du ' . $rate . '.',
            'Je ' . $p['redeem_points'] . ' Punkte gibt es ' . Util::euro((int) $p['redeem_cents']) . ' Rabatt – als Code für deinen nächsten Einkauf.',
        ];
        if ($p['tiers_enabled']) {
            $up = array_slice($p['tiers'], 1);
            $lines[] = 'Mit mehr Einkäufen steigst du auf: ' . implode(' und ', array_map(static fn ($t) => $t['name'] . ' ab ' . Util::euro((int) $t['min_cents']) . ' (' . Tiers::rateText((float) $t['rate']) . ')', $up)) . '.';
        }
        $intro = $balance > 0
            ? "<b>$balance Punkte</b> liegen schon auf deinem Konto."
            : 'Ab jetzt sammelst du mit jeder Bestellung Punkte.';
        if ($locked > 0) {
            $intro .= " Dazu warten <b>$locked Punkte</b> Startbonus auf dich – sie werden mit deiner ersten Bestellung frei.";
        }
        $list = '<ul style="margin:14px 0 0;padding-left:20px">' . implode('', array_map(static fn ($l) => '<li style="margin:6px 0">' . htmlspecialchars($l) . '</li>', $lines)) . '</ul>';
        $tip = '<p style="margin:18px 0 0;padding:14px 16px;background:#F4EFE6;border-radius:14px;font-size:15px">Tipp: Leg dir den Club als App auf den Home-Bildschirm und schalte unter „Konto“ die Mitteilungen ein. Dann erfährst du sofort, wenn dein Paket unterwegs ist oder Punkte ankommen.</p>';
        $html = self::layout(
            $p['name'],
            'Willkommen im <i style="color:#80562F">Club</i>',
            '<p style="margin:0">' . htmlspecialchars($hallo) . ', schön, dass du dabei bist. ' . $intro . '</p>' . $list . $tip,
            ['label' => 'Zu meinen Punkten', 'url' => Util::baseUrl() . '/'],
            'Perfume Cloud · Du bekommst diese E-Mail, weil du dem ' . htmlspecialchars($p['name']) . ' beigetreten bist.'
        );
        $text = "$hallo, schön, dass du dabei bist.\n\n" . strip_tags(str_replace('<b>', '', $intro)) . "\n\n- " . implode("\n- ", $lines)
            . "\n\nZu deinen Punkten: " . Util::baseUrl() . "/\n\nPerfume Cloud";
        return self::send((string) $member['email'], 'Willkommen im ' . $p['name'], $text, $html);
    }

    private static function message(array $c, string $to, string $subject, string $text, ?string $html, ?string $replyTo = null, array $extra = []): string
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
        if ($replyTo !== null && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            $headers[] = "Reply-To: <$replyTo>";
        }
        foreach ($extra as $name => $value) {
            // Nur einfache Kopfzeilen ohne Zeilenumbrüche
            if (preg_match('/^[A-Za-z][A-Za-z0-9-]{1,40}$/', (string) $name) && !preg_match('/[\r\n]/', (string) $value)) {
                $headers[] = $name . ': ' . $value;
            }
        }
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
