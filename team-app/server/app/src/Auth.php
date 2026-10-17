<?php
declare(strict_types=1);

namespace PC;

final class Auth
{
    private const COOKIE = 'pc_session';
    private const LIFETIME_MS = 180 * 24 * 3600 * 1000; // 180 Tage
    private const MAX_FAILED = 8;
    private const WINDOW_MS = 15 * 60 * 1000;

    private static ?array $user = null;

    public static function user(): ?array
    {
        if (self::$user !== null) {
            return self::$user;
        }
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (!is_string($token) || strlen($token) < 32) {
            return null;
        }
        $now = Util::now();
        $session = Db::one('SELECT * FROM sessions WHERE id = ?', [hash('sha256', $token)]);
        if (!$session || (int) $session['expires_at'] < $now) {
            return null;
        }
        $user = Db::one('SELECT * FROM users WHERE id = ? AND deleted = 0', [$session['user_id']]);
        if (!$user) {
            return null;
        }
        if ($now - (int) $session['last_seen_at'] > 3600 * 1000) {
            Db::exec('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [$now, $now + self::LIFETIME_MS, $session['id']]);
        }
        return self::$user = $user;
    }

    public static function require(): array
    {
        $user = self::user();
        if (!$user) {
            throw new HttpError(401, 'Bitte melde dich an.');
        }
        return $user;
    }

    public static function requireAdmin(): array
    {
        $user = self::require();
        if ($user['role'] !== 'admin') {
            throw new HttpError(403, 'Nur für Admins.');
        }
        return $user;
    }

    /** Club-Admin (Kunden-App): Admins immer, andere nur mit Freischaltung („Club-Admin“ unter Team). */
    public static function clubAccess(array $user): bool
    {
        return $user['role'] === 'admin' || (int) ($user['club_access'] ?? 0) === 1;
    }

    public static function requireClub(): array
    {
        $user = self::require();
        if (!self::clubAccess($user)) {
            throw new HttpError(403, 'Kein Zugriff auf den Club. Ein Admin kann ihn unter Einstellungen → Team freischalten.');
        }
        return $user;
    }

    public static function login(string $email, string $password): array
    {
        $ip = Util::clientIp();
        $now = Util::now();
        Db::exec('DELETE FROM login_attempts WHERE created_at < ?', [$now - self::WINDOW_MS]);
        $failed = (int) Db::value('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$ip]);
        if ($failed >= self::MAX_FAILED) {
            throw new HttpError(429, 'Zu viele Versuche. Bitte warte 15 Minuten.');
        }

        $user = Db::one('SELECT * FROM users WHERE email = ? AND deleted = 0', [mb_strtolower(trim($email))]);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            Db::insert('login_attempts', ['id' => Util::uuid(), 'ip' => $ip, 'created_at' => $now]);
            usleep(400000);
            throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            Db::update('users', ['password_hash' => password_hash($password, PASSWORD_DEFAULT)], ['id' => $user['id']]);
        }
        self::startSession($user);
        return $user;
    }

    public static function startSession(array $user): void
    {
        $token = bin2hex(random_bytes(32));
        $now = Util::now();
        Db::insert('sessions', [
            'id' => hash('sha256', $token),
            'user_id' => $user['id'],
            'user_agent' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250),
            'created_at' => $now,
            'last_seen_at' => $now,
            'expires_at' => $now + self::LIFETIME_MS,
        ]);
        self::setCookie($token, time() + intdiv(self::LIFETIME_MS, 1000));
        self::$user = $user;
    }

    public static function logout(): void
    {
        $token = $_COOKIE[self::COOKIE] ?? '';
        if (is_string($token) && $token !== '') {
            Db::exec('DELETE FROM sessions WHERE id = ?', [hash('sha256', $token)]);
        }
        self::setCookie('', time() - 3600);
        self::$user = null;
    }

    private static function setCookie(string $value, int $expires): void
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        setcookie(self::COOKIE, $value, [
            'expires' => $expires,
            'path' => '/',
            'secure' => Util::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    public static function hashPassword(string $password): string
    {
        if (mb_strlen($password) < 8) {
            throw new HttpError(422, 'Das Passwort muss mindestens 8 Zeichen haben.');
        }
        return password_hash($password, PASSWORD_DEFAULT);
    }

    /** Öffentliche Felder eines Nutzers. */
    public static function publicUser(array $u): array
    {
        return [
            'id' => $u['id'],
            'name' => $u['name'],
            'email' => $u['email'],
            'color' => $u['color'],
            'role' => $u['role'],
            'club_access' => (int) ($u['club_access'] ?? 0),
            'instagram_access' => (int) ($u['instagram_access'] ?? 0),
            'updated_at' => (int) $u['updated_at'],
            'deleted' => (int) $u['deleted'],
        ];
    }

    public static function prefs(array $u): array
    {
        $defaults = [
            'push' => [
                'mail' => true,
                'orders' => true,
                'tasks' => true,
                'comments' => true,
                'reminders' => true,
                'events' => true,
                'shipping' => true,
                'weekly' => true,
                'feedback' => true,
                // Instagram: Beitrag zur Prüfung/veröffentlicht, Erinnerung zum Posten, neue Kommentare
                'instagram' => true,
            ],
            // Push für Mails: 'all' = jede neue Mail, 'everything' = auch Newsletter/automatische, 'important' = nur wichtige
            'mailScope' => 'all',
            // Signatur unter Antworten aus der App (null = „Viele Grüße / Vorname“)
            'signature' => null,
            // Wochenrückblick zusätzlich an die eigene Adresse
            'weeklyMail' => false,
            // Eigene Reihenfolge der Postfächer (Adressen), gilt in Postfach, Übersicht und Einstellungen (ab 1.9)
            'mailboxOrder' => [],
        ];
        $p = json_decode((string) ($u['prefs'] ?? ''), true);
        if (!is_array($p)) {
            return $defaults;
        }
        $p['push'] = array_merge($defaults['push'], is_array($p['push'] ?? null) ? $p['push'] : []);
        $p['mailScope'] = in_array($p['mailScope'] ?? null, ['all', 'everything', 'important'], true) ? $p['mailScope'] : $defaults['mailScope'];
        $p['signature'] = is_string($p['signature'] ?? null) ? $p['signature'] : null;
        $p['weeklyMail'] = (bool) ($p['weeklyMail'] ?? false);
        $p['mailboxOrder'] = self::mailboxOrder($p['mailboxOrder'] ?? []);
        return $p;
    }

    /** @return string[] Adressen in Kleinschreibung, ohne Doppelte, höchstens 50 */
    public static function mailboxOrder(mixed $list): array
    {
        $out = [];
        foreach (is_array($list) ? $list : [] as $a) {
            if (is_string($a) && ($a = mb_strtolower(trim($a))) !== '' && strlen($a) <= 190 && !in_array($a, $out, true)) {
                $out[] = $a;
            }
        }
        return array_slice($out, 0, 50);
    }
}
