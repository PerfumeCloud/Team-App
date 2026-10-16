<?php
declare(strict_types=1);

namespace Club;

/** Sitzungen für Kundinnen/Kunden (Cookie pcc_m) und für das Team im Admin-Bereich (Cookie pcc_a). */
final class Auth
{
    private const COOKIES = ['member' => 'pcc_m', 'admin' => 'pcc_a'];
    private const LIFETIME_MS = ['member' => 120 * 24 * 3600 * 1000, 'admin' => 30 * 24 * 3600 * 1000];
    private const CODE_TTL_MS = 10 * 60 * 1000;

    private static array $cache = [];
    private static ?array $preview = null;

    /** @return array{session: array, subject: array}|null */
    private static function current(string $kind): ?array
    {
        if (array_key_exists($kind, self::$cache)) {
            return self::$cache[$kind];
        }
        $token = $_COOKIE[self::COOKIES[$kind]] ?? '';
        if (!is_string($token) || strlen($token) < 32) {
            return self::$cache[$kind] = null;
        }
        $now = Util::now();
        $session = Db::one('SELECT * FROM club_sessions WHERE id = ? AND kind = ?', [hash('sha256', $token), $kind]);
        if (!$session || (int) $session['expires_at'] < $now) {
            return self::$cache[$kind] = null;
        }
        $subject = $kind === 'admin'
            ? Admins::find((string) $session['subject_id'])
            : Db::one('SELECT * FROM club_members WHERE id = ?', [$session['subject_id']]);
        if (!$subject) {
            return self::$cache[$kind] = null;
        }
        if ($now - (int) $session['last_seen_at'] > 3600 * 1000) {
            Db::exec('UPDATE club_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [$now, $now + self::LIFETIME_MS[$kind], $session['id']]);
            if ($kind === 'member') {
                Db::exec('UPDATE club_members SET last_seen_at = ? WHERE id = ?', [$now, $subject['id']]);
            }
        }
        return self::$cache[$kind] = ['session' => $session, 'subject' => $subject];
    }

    /**
     * Vorschau für das Team: Mit Admin-Sitzung und Header „X-Als: <Mitglieds-ID>“ sieht der Admin-Bereich die App
     * genau so, wie dieses Mitglied sie sieht – nur lesend.
     */
    public static function preview(): ?array
    {
        if (self::$preview !== null) {
            return self::$preview ?: null;
        }
        $id = (string) ($_SERVER['HTTP_X_ALS'] ?? '');
        if (!preg_match('/^[0-9a-f-]{36}$/', $id) || !self::admin()) {
            self::$preview = [];
            return null;
        }
        $m = Db::one('SELECT * FROM club_members WHERE id = ?', [$id]);
        self::$preview = $m ?: [];
        return $m;
    }

    public static function member(): ?array
    {
        return self::preview() ?? self::current('member')['subject'] ?? null;
    }

    public static function requireMember(): array
    {
        $m = self::member();
        if (!$m) {
            throw new HttpError(401, 'Bitte melde dich an.');
        }
        return $m;
    }

    /** Angemeldet und dem Club beigetreten. */
    public static function requireJoined(): array
    {
        $m = self::requireMember();
        if (!$m['joined_at']) {
            throw new HttpError(409, 'Bitte tritt zuerst dem Club bei.');
        }
        return $m;
    }

    public static function admin(): ?array
    {
        return self::current('admin')['subject'] ?? null;
    }

    public static function requireAdmin(): array
    {
        $a = self::admin();
        if (!$a) {
            throw new HttpError(401, 'Bitte melde dich im Admin-Bereich an.');
        }
        return $a;
    }

    public static function start(string $kind, string $subjectId, ?string $idToken = null): void
    {
        $token = bin2hex(random_bytes(32));
        $now = Util::now();
        Db::insert('club_sessions', [
            'id' => hash('sha256', $token),
            'kind' => $kind,
            'subject_id' => $subjectId,
            'id_token' => $idToken ? Crypto::encrypt($idToken) : null,
            'user_agent' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250),
            'created_at' => $now,
            'last_seen_at' => $now,
            'expires_at' => $now + self::LIFETIME_MS[$kind],
        ]);
        self::cookie($kind, $token, time() + intdiv(self::LIFETIME_MS[$kind], 1000));
        // Gilt schon in dieser Anfrage (z. B. „admin“ in der Antwort auf die Anmeldung per Code)
        $_COOKIE[self::COOKIES[$kind]] = $token;
        unset(self::$cache[$kind]);
        self::$preview = null;
    }

    /** Beendet die Sitzung. Gibt das Shopify-id_token zurück (für die Abmeldung bei Shopify). */
    public static function end(string $kind): ?string
    {
        $cur = self::current($kind);
        $idToken = null;
        if ($cur) {
            $idToken = $cur['session']['id_token'] ? Crypto::decrypt((string) $cur['session']['id_token']) : null;
            Db::exec('DELETE FROM club_sessions WHERE id = ?', [$cur['session']['id']]);
        }
        self::cookie($kind, '', time() - 3600);
        unset($_COOKIE[self::COOKIES[$kind]]);
        self::$cache[$kind] = null;
        return $idToken;
    }

    private static function cookie(string $kind, string $value, int $expires): void
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        setcookie(self::COOKIES[$kind], $value, [
            'expires' => $expires,
            'path' => '/',
            'secure' => Util::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    // ---------- Admin ----------

    public static function adminLogin(string $email, string $password): array
    {
        Util::limit('admin:' . Util::clientIp(), 8, 900, 'Zu viele Versuche. Bitte warte 15 Minuten.');
        try {
            $admin = Admins::login($email, $password);
        } catch (HttpError $e) {
            usleep(400000);
            throw $e;
        }
        Db::exec('DELETE FROM club_attempts WHERE bucket = ?', ['admin:' . Util::clientIp()]);
        self::start('admin', $admin['id']);
        return $admin;
    }

    /**
     * Nach der Anmeldung als Kundin/Kunde: Gehört die (von Shopify bzw. per Code bestätigte) E-Mail-Adresse
     * zu einem Admin, gibt es gleich auch die Admin-Sitzung. Ausschaltbar in den Einstellungen.
     */
    public static function adminFromMember(array $member): bool
    {
        if (!(bool) Settings::get('admin_by_email', true)) {
            return false;
        }
        $admin = Admins::byEmail((string) $member['email']);
        if (!$admin) {
            return false;
        }
        $cur = self::admin();
        if (!$cur || $cur['id'] !== $admin['id']) {
            self::start('admin', $admin['id']);
        }
        return true;
    }

    public static function hashPassword(string $password): string
    {
        if (mb_strlen($password) < 10) {
            throw new HttpError(422, 'Das Passwort muss mindestens 10 Zeichen haben.');
        }
        return password_hash($password, PASSWORD_DEFAULT);
    }

    public static function publicAdmin(array $a): array
    {
        return Admins::public($a);
    }

    // ---------- Anmeldung per E-Mail-Code direkt in der App (Standard; Shopify-Anmeldeseite als zweiter Weg) ----------

    public static function emailLoginEnabled(): bool
    {
        return (bool) Settings::get('login_email', true) && Mailer::configured();
    }

    public static function requestCode(string $email): void
    {
        if (!self::emailLoginEnabled()) {
            throw new HttpError(503, 'Die Anmeldung per E-Mail-Code ist nicht eingeschaltet.');
        }
        $email = Util::email($email);
        $msg = 'Zu viele Codes angefordert. Bitte warte ein paar Minuten.';
        Util::limit('code-ip:' . Util::clientIp(), 10, 900, $msg);
        Util::limit('code-mail:' . $email, 3, 900, $msg);

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $now = Util::now();
        Db::exec('DELETE FROM club_login_codes WHERE email = ? OR expires_at < ?', [$email, $now]);
        Db::insert('club_login_codes', [
            'id' => Util::uuid(),
            'email' => $email,
            'code_hash' => self::codeHash($email, $code),
            'attempts' => 0,
            'created_at' => $now,
            'expires_at' => $now + self::CODE_TTL_MS,
        ]);
        $name = Points::program()['name'];
        $sent = Mailer::send(
            $email,
            "$code ist dein Code für den $name",
            "Hallo,\n\ndein Anmeldecode für den $name lautet:\n\n$code\n\nDer Code gilt 10 Minuten. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.\n\nPerfume Cloud",
            Mailer::codeHtml($code, $name)
        );
        if (!$sent['sent']) {
            throw new HttpError(502, 'Die E-Mail konnte gerade nicht verschickt werden. Bitte versuche es später noch einmal.');
        }
    }

    /** Prüft den Code und gibt die bestätigte E-Mail-Adresse zurück. */
    public static function verifyCode(string $email, string $code): string
    {
        $email = Util::email($email);
        $code = preg_replace('/\D/', '', $code) ?? '';
        Util::limit('verify-ip:' . Util::clientIp(), 30, 900, 'Zu viele Versuche. Bitte warte 15 Minuten.');
        $row = Db::one('SELECT * FROM club_login_codes WHERE email = ? AND expires_at > ? ORDER BY created_at DESC', [$email, Util::now()]);
        if (!$row || (int) $row['attempts'] >= 5) {
            throw new HttpError(401, 'Der Code ist abgelaufen. Bitte fordere einen neuen an.');
        }
        if (!hash_equals((string) $row['code_hash'], self::codeHash($email, $code))) {
            Db::exec('UPDATE club_login_codes SET attempts = attempts + 1 WHERE id = ?', [$row['id']]);
            throw new HttpError(401, 'Der Code stimmt nicht. Bitte prüfe ihn noch einmal.');
        }
        Db::exec('DELETE FROM club_login_codes WHERE email = ?', [$email]);
        return $email;
    }

    private static function codeHash(string $email, string $code): string
    {
        return hash_hmac('sha256', $email . '|' . $code, (string) Config::get('app_key'));
    }
}
