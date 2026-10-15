<?php
declare(strict_types=1);

namespace Club;

/**
 * Wer den Admin-Bereich öffnen darf.
 *
 * Mit der Datenbank der Team-App (empfohlen) sind das alle Team-Mitglieder mit der Rolle „Admin“ oder mit
 * „Club-Admin“-Recht (users.club_access). Angelegt, eingeladen und verwaltet werden sie in der Team-App –
 * mit demselben Passwort. Eigene Club-Zugänge (club_admins) gibt es weiterhin für den Betrieb ohne Team-App.
 */
final class Admins
{
    private static ?bool $teamUsers = null;

    /** Gibt es die Benutzer der Team-App in dieser Datenbank? */
    public static function teamUsers(): bool
    {
        if (self::$teamUsers === null) {
            self::$teamUsers = Db::team() && Db::tableExists('users') && Db::hasColumn('users', 'club_access');
        }
        return self::$teamUsers;
    }

    public static function resetCache(): void
    {
        self::$teamUsers = null;
    }

    private static function fromTeam(array $u): array
    {
        return [
            'id' => $u['id'],
            'name' => $u['name'],
            'email' => mb_strtolower((string) $u['email']),
            'password_hash' => $u['password_hash'],
            'source' => 'team',
            'team_role' => $u['role'],
            'club_access' => (int) $u['club_access'] === 1,
        ];
    }

    private static function fromClub(array $a): array
    {
        return [
            'id' => $a['id'],
            'name' => $a['name'],
            'email' => $a['email'],
            'password_hash' => $a['password_hash'],
            'source' => 'club',
            'team_role' => null,
            'club_access' => true,
            'last_login_at' => $a['last_login_at'] !== null ? (int) $a['last_login_at'] : null,
        ];
    }

    private const TEAM_WHERE = "deleted = 0 AND (role = 'admin' OR club_access = 1)";

    public static function find(string $id): ?array
    {
        $a = Db::one('SELECT * FROM club_admins WHERE id = ?', [$id]);
        if ($a) {
            return self::fromClub($a);
        }
        if (self::teamUsers()) {
            $u = Db::one('SELECT * FROM users WHERE id = ? AND ' . self::TEAM_WHERE, [$id]);
            return $u ? self::fromTeam($u) : null;
        }
        return null;
    }

    public static function byEmail(string $email): ?array
    {
        $email = mb_strtolower(trim($email));
        if ($email === '') {
            return null;
        }
        if (self::teamUsers()) {
            $u = Db::one('SELECT * FROM users WHERE LOWER(email) = ? AND ' . self::TEAM_WHERE, [$email]);
            if ($u) {
                return self::fromTeam($u);
            }
        }
        $a = Db::one('SELECT * FROM club_admins WHERE email = ?', [$email]);
        return $a ? self::fromClub($a) : null;
    }

    public static function count(): int
    {
        $n = (int) Db::value('SELECT COUNT(*) FROM club_admins');
        if (self::teamUsers()) {
            $n += (int) Db::value('SELECT COUNT(*) FROM users WHERE ' . self::TEAM_WHERE);
        }
        return $n;
    }

    public static function login(string $email, string $password): array
    {
        $admin = self::byEmail($email);
        if (!$admin || !password_verify($password, (string) $admin['password_hash'])) {
            throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
        }
        if ($admin['source'] === 'club') {
            Db::update('club_admins', ['last_login_at' => Util::now()], ['id' => $admin['id']]);
        }
        return $admin;
    }

    public static function public(array $a): array
    {
        return [
            'id' => $a['id'],
            'name' => $a['name'],
            'email' => $a['email'],
            'source' => $a['source'],
            // Rechte verwalten dürfen Team-Admins und eigene Club-Zugänge
            'manage' => $a['source'] === 'club' || $a['team_role'] === 'admin',
        ];
    }

    /** Übersicht für die Seite „Zugänge“. */
    public static function overview(): array
    {
        $club = array_map(static fn ($a) => [
            'id' => $a['id'],
            'name' => $a['name'],
            'email' => $a['email'],
            'source' => 'club',
            'access' => true,
            'role' => 'club',
            'last_login_at' => $a['last_login_at'] !== null ? (int) $a['last_login_at'] : null,
        ], Db::all('SELECT * FROM club_admins ORDER BY name'));
        $team = [];
        if (self::teamUsers()) {
            foreach (Db::all('SELECT id, name, email, role, club_access FROM users WHERE deleted = 0 ORDER BY name') as $u) {
                $team[] = [
                    'id' => $u['id'],
                    'name' => $u['name'],
                    'email' => mb_strtolower((string) $u['email']),
                    'source' => 'team',
                    'role' => $u['role'],
                    'access' => $u['role'] === 'admin' || (int) $u['club_access'] === 1,
                ];
            }
        }
        $teamUrl = null;
        if (Db::team()) {
            $cfg = Db::teamConfig(Config::get('db.config'));
            $teamUrl = is_string($cfg['base_url'] ?? null) && $cfg['base_url'] !== '' ? rtrim($cfg['base_url'], '/') : null;
            // Die Team-App merkt sich ihre Adresse hier, sobald sie die Club-Daten liest
            $teamUrl ??= is_string(Settings::get('team_url')) ? Settings::get('team_url') : null;
        }
        return ['team_mode' => Db::team(), 'team' => $team, 'club' => $club, 'team_url' => $teamUrl];
    }

    /** Team-Mitglied als Club-Admin freischalten oder sperren (Team-Admins haben immer Zugriff). */
    public static function setTeamAccess(array $by, string $userId, bool $access): void
    {
        self::requireManage($by);
        if (!self::teamUsers()) {
            throw new HttpError(409, 'Der Club nutzt noch nicht die Datenbank der Team-App.');
        }
        $u = Db::one('SELECT id, role FROM users WHERE id = ? AND deleted = 0', [$userId]);
        if (!$u) {
            throw new HttpError(404, 'Diese Person gibt es in der Team-App nicht.');
        }
        if ($u['role'] === 'admin' && !$access) {
            throw new HttpError(422, 'Admins der Team-App haben immer Zugriff. Die Rolle änderst du in der Team-App.');
        }
        Db::exec('UPDATE users SET club_access = ?, updated_at = ? WHERE id = ?', [$access ? 1 : 0, Util::now(), $userId]);
        if (!$access) {
            Db::exec("DELETE FROM club_sessions WHERE kind = 'admin' AND subject_id = ?", [$userId]);
        }
    }

    public static function createClub(array $by, array $in): array
    {
        self::requireManage($by);
        $name = Util::str($in['name'] ?? '', 100, false);
        $email = Util::email($in['email'] ?? '');
        if ($name === '') {
            throw new HttpError(422, 'Bitte einen Namen angeben.');
        }
        if (self::byEmail($email)) {
            throw new HttpError(409, 'Diese E-Mail-Adresse hat schon Zugriff.');
        }
        $id = Util::uuid();
        Db::insert('club_admins', [
            'id' => $id,
            'name' => $name,
            'email' => $email,
            'password_hash' => Auth::hashPassword((string) ($in['password'] ?? '')),
            'created_at' => Util::now(),
            'last_login_at' => null,
        ]);
        return self::overview();
    }

    public static function deleteClub(array $by, string $id): array
    {
        self::requireManage($by);
        if ($id === $by['id']) {
            throw new HttpError(422, 'Du kannst deinen eigenen Zugang nicht löschen.');
        }
        if (self::count() <= 1) {
            throw new HttpError(422, 'Der letzte Zugang kann nicht gelöscht werden.');
        }
        Db::exec('DELETE FROM club_admins WHERE id = ?', [$id]);
        Db::exec("DELETE FROM club_sessions WHERE kind = 'admin' AND subject_id = ?", [$id]);
        return self::overview();
    }

    private static function requireManage(array $a): void
    {
        if (!self::public($a)['manage']) {
            throw new HttpError(403, 'Zugänge verwalten dürfen nur Admins der Team-App.');
        }
    }

    /**
     * Link für die Einmal-Anmeldung aus der Team-App (über /api/internal/sso).
     * Mit gemeinsamer Datenbank zählt die Team-ID (Rolle Admin oder Club-Recht), sonst die E-Mail eines Club-Zugangs.
     */
    public static function ssoLink(string $userId, string $email): string
    {
        $admin = (self::teamUsers() && $userId !== '' ? self::find($userId) : null) ?? self::byEmail($email);
        if (!$admin) {
            throw new HttpError(403, 'Kein Zugriff auf den Club-Admin. Ein Admin der Team-App kann ihn unter „Team“ freischalten.');
        }
        $token = bin2hex(random_bytes(32));
        $now = Util::now();
        Db::insert('club_sso', ['id' => hash('sha256', $token), 'user_id' => $admin['id'], 'created_at' => $now, 'expires_at' => $now + 60000]);
        return Util::baseUrl() . '/api/admin/sso?t=' . $token;
    }

    /** Einmal-Anmeldung aus der Team-App: Token liegt 60 Sekunden in club_sso. */
    public static function sso(string $token): array
    {
        if (strlen($token) < 32) {
            throw new HttpError(401, 'Der Link ist ungültig.');
        }
        $id = hash('sha256', $token);
        $row = Db::one('SELECT * FROM club_sso WHERE id = ?', [$id]);
        Db::exec('DELETE FROM club_sso WHERE id = ? OR expires_at < ?', [$id, Util::now()]);
        if (!$row || (int) $row['expires_at'] < Util::now()) {
            throw new HttpError(401, 'Der Link ist abgelaufen. Bitte öffne den Club-Admin noch einmal aus der Team-App.');
        }
        $admin = self::find((string) $row['user_id']);
        if (!$admin) {
            throw new HttpError(403, 'Du hast keinen Zugriff auf den Club-Admin. Ein Admin der Team-App kann ihn freischalten.');
        }
        return $admin;
    }
}
