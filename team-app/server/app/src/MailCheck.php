<?php
declare(strict_types=1);

namespace PC;

/**
 * Verbindungsprüfung für ein Postfach – Schritt für Schritt, damit klar ist, woran es hängt:
 * Server gefunden → Port erreichbar → Verschlüsselung → Anmeldung → Ordner → (Versand: SMTP, Testmail).
 * Jeder Schritt: {label, ok, detail, hint}. Passwörter tauchen nirgends auf.
 */
final class MailCheck
{
    private const WINDOW_DAYS = 14;

    /**
     * @param bool $smtp auch den Versand prüfen (Anmeldung per SMTP + Testmail an das Postfach selbst)
     * @return array{ok:bool, imap:bool, smtp:?bool, message:string, imapMessage:string, steps:array<int, array{label:string, ok:bool, detail:string, hint:?string}>}
     */
    public static function run(array $mb, bool $smtp = false): array
    {
        $steps = [];
        $add = static function (string $label, bool $ok, string $detail, ?string $hint = null) use (&$steps): void {
            $steps[] = ['label' => $label, 'ok' => $ok, 'detail' => $detail, 'hint' => $ok ? null : $hint];
        };
        $imap = self::imap($mb, $add);
        $out = ['ok' => $imap['ok'], 'imap' => $imap['ok'], 'smtp' => null, 'message' => $imap['message'], 'imapMessage' => $imap['message']];
        if ($smtp && MailJob::password($mb['id']) !== null) {
            $to = $mb['email'];
            $smtpHost = Mailer::servers($mb)[0]['host'];
            $report = static function (string $step, string $label, bool $ok, string $detail) use ($add, $smtpHost): void {
                $port = preg_match('/:(\d+)$/', $label, $m) ? (int) $m[1] : 465;
                $label = match ($step) {
                    'auth' => 'SMTP-' . $label,
                    'send' => 'Test' . lcfirst($label),
                    default => $label,
                };
                $add($label, $ok, $detail, $ok ? null : self::hint($detail, $smtpHost, $port, 'smtp'));
            };
            try {
                $from = Mailer::fromAddress($mb);
                $text = "Diese Mail hat die Perfume Cloud Team-App beim Verbindungstest verschickt.\n\nDer Versand über $from funktioniert. Die Mail kann gelöscht werden.";
                Mailer::deliver($mb, $to, Mailer::message($from, $to, 'Testmail der Team-App', $text, null), $report);
                $out['smtp'] = true;
                if ($imap['ok']) {
                    $out['message'] .= ' · Versand klappt';
                }
            } catch (\Throwable $e) {
                $out['smtp'] = false;
                $out['ok'] = false;
                if ($imap['ok']) {
                    $out['message'] = 'Abruf klappt, Versand nicht: ' . $e->getMessage();
                }
            }
        }
        return $out + ['steps' => $steps];
    }

    /** @return array{ok:bool, message:string} */
    private static function imap(array $mb, callable $add): array
    {
        $fail = static fn (string $message) => ['ok' => false, 'message' => $message];
        $pw = MailJob::password($mb['id']);
        if ($pw === null) {
            $add('Passwort', false, 'fehlt', 'Bitte das Passwort des Postfachs eintragen und speichern.');
            return $fail('Passwort fehlt.');
        }
        $host = (string) $mb['host'];
        $port = (int) $mb['port'];
        $security = (string) $mb['security'];
        if (in_array($port, [25, 465, 587], true)) {
            $add('Port ' . $port, false, 'ist für den Versand (SMTP), nicht für den Abruf', 'Für den Abruf (IMAP) bitte Port 993 eintragen.');
            return $fail("Port $port ist für den Versand – für den Abruf bitte 993 nehmen.");
        }

        // 1. Server finden
        $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            $add("Server $host", false, 'nicht gefunden', self::hint('getaddrinfo', $host, $port, 'imap'));
            return $fail("Server $host nicht gefunden.");
        }
        $add("Server $host", true, $ip === $host ? 'ok' : "gefunden ($ip)");

        // 2. Port erreichbar
        try {
            fclose(Imap::socket("tcp://$host:$port", 8));
            $add("Verbindung zu $host:$port", true, 'ok');
        } catch (\RuntimeException $e) {
            $add("Verbindung zu $host:$port", false, $e->getMessage(), self::hint($e->getMessage(), $host, $port, 'imap'));
            return $fail($e->getMessage());
        }

        // 3. Verschlüsselung und Begrüßung
        $imap = new Imap($host, $port, $security, 15, 8);
        $label = match ($security) {
            'ssl' => 'Verschlüsselung (SSL/TLS)',
            'starttls' => 'Verschlüsselung (STARTTLS)',
            default => 'Begrüßung des Servers',
        };
        try {
            $imap->connect();
            $add($label, true, $imap->tls() !== '' ? $imap->tls() : 'unverschlüsselt (nur Test)');
        } catch (\RuntimeException $e) {
            $add($label, false, $e->getMessage(), self::hint($e->getMessage(), $host, $port, 'imap'));
            return $fail($e->getMessage());
        }

        try {
            // 4. Anmeldung
            try {
                $imap->login((string) $mb['user'], $pw);
                $add("Anmeldung als {$mb['user']}", true, 'ok');
            } catch (\RuntimeException $e) {
                $add("Anmeldung als {$mb['user']}", false, $e->getMessage(), self::hint($e->getMessage(), $host, $port, 'imap'));
                return $fail($e->getMessage());
            }

            // 5. Posteingang (heißt per IMAP immer INBOX, auch wenn das Mailprogramm „Posteingang“ zeigt)
            try {
                $imap->examine('INBOX');
                $total = $imap->exists;
                $recent = count($imap->search('SINCE ' . date('d-M-Y', time() - self::WINDOW_DAYS * 86400)));
                $add('Ordner INBOX', true, "$total Mails, davon $recent aus den letzten " . self::WINDOW_DAYS . ' Tagen');
            } catch (\RuntimeException $e) {
                $add('Ordner INBOX', false, $e->getMessage(), 'Der Posteingang ließ sich nicht öffnen. Bitte beim Anbieter prüfen, ob das Postfach aktiv ist.');
                return $fail($e->getMessage());
            }

            // 6. Gesendet-Ordner (für „beantwortet“)
            try {
                $sent = MailJob::findSentFolder($imap);
            } catch (\RuntimeException) {
                $sent = null;
            }
            $add('Gesendet-Ordner', true, $sent ?? 'nicht gefunden – Antworten werden dann nur an der Markierung „beantwortet“ erkannt');
        } finally {
            $imap->logout();
        }
        return ['ok' => true, 'message' => "Verbunden · $recent Mails der letzten " . self::WINDOW_DAYS . ' Tage' . ($sent ? " · Gesendet-Ordner: $sent" : '')];
    }

    /** Verständlicher Hinweis zu einer Fehlermeldung (falsches Passwort, falscher Server, Port blockiert, Zertifikat). */
    public static function hint(string $error, string $host, int $port, string $kind): ?string
    {
        $e = mb_strtolower($error);
        $ports = $kind === 'smtp' ? 'Für den Versand (SMTP) Port 465 (SSL/TLS) oder 587 (STARTTLS)' : 'Für den Abruf (IMAP) Port 993 (SSL/TLS) oder 143 (STARTTLS)';
        if (str_contains($e, 'anmeldung')) {
            return 'Benutzername oder Passwort stimmt nicht. Bei netcup ist der Benutzername die vollständige E-Mail-Adresse. '
                . 'Im Zweifel das Passwort im netcup-Webhosting-Panel unter E-Mail neu setzen und hier eintragen.';
        }
        if (str_contains($e, 'getaddrinfo') || str_contains($e, 'name or service not known') || str_contains($e, 'no address associated') || str_contains($e, 'nodename')) {
            return "Den Server $host gibt es nicht. Bitte den Namen prüfen – bei netcup steht er im Webhosting-Panel unter E-Mail, z. B. mxf9a2.netcup.net.";
        }
        if (str_contains($e, 'certificate') || str_contains($e, 'did not match expected cn')) {
            $names = $host !== '' && $port > 0 ? Imap::certificateNames($host, $port) : [];
            return 'Das Zertifikat des Servers passt nicht zum eingetragenen Namen. Trag als Server den Namen aus dem Zertifikat ein'
                . ($names ? ': ' . implode(', ', array_slice($names, 0, 3)) : ' (bei netcup z. B. mxf9a2.netcup.net statt mail.eure-domain.de)') . '.';
        }
        if (str_contains($e, 'wrong version number') || str_contains($e, 'unknown protocol') || str_contains($e, 'packet length') || str_contains($e, 'record layer') || str_contains($e, 'unexpected eof') || str_contains($e, 'unerwartete begrüßung')) {
            return "Port und Verschlüsselung passen nicht zusammen. $ports.";
        }
        if (str_contains($e, 'refused')) {
            return "Der Server nimmt auf Port $port keine Verbindung an. $ports.";
        }
        if (str_contains($e, 'timed out') || str_contains($e, 'zeitüberschreitung') || str_contains($e, 'timeout')) {
            return "Keine Antwort auf Port $port – der Port ist falsch oder wird blockiert. $ports.";
        }
        if (str_contains($e, 'absender') || str_contains($e, 'sender') || str_contains($e, 'not owned')) {
            return 'Der Absender muss das angemeldete Postfach sein. Bitte als Benutzernamen die E-Mail-Adresse dieses Postfachs eintragen.';
        }
        return null;
    }
}
