<?php
declare(strict_types=1);

namespace PC;

/**
 * Team verwalten: Personen anlegen (auch wieder anlegen nach dem Löschen), Einladungen per Mail
 * mit persönlichem Link zum Passwort-Festlegen, Wartung („Datenbank aktualisieren“).
 */
final class Team
{
    private const COLORS = ['blue', 'sage', 'rose', 'amber', 'plum', 'slate'];
    private const INVITE_DAYS = 14;

    // ---------- Anlegen / Wiederherstellen ----------

    /** @return array{user:array, restored:bool, invite:?array} */
    public static function create(array $me, array $b): array
    {
        $name = Util::str($b['name'] ?? '', 100, false);
        $email = mb_strtolower(trim((string) ($b['email'] ?? '')));
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new HttpError(422, 'Bitte Name und gültige E-Mail-Adresse angeben.');
        }
        $password = (string) ($b['password'] ?? '');
        $invite = !empty($b['invite']);
        if ($password === '' && !$invite) {
            throw new HttpError(422, 'Bitte ein Startpasswort eingeben oder eine Einladung per Mail schicken.');
        }
        // Ohne Startpasswort: zufälliges, das niemand kennt – die Person legt ihr eigenes über den Link fest
        $hash = Auth::hashPassword($password !== '' ? $password : bin2hex(random_bytes(16)));
        $role = Util::oneOf($b['role'] ?? 'member', ['admin', 'member'], 'member');
        $now = Util::now();

        $existing = Db::one('SELECT * FROM users WHERE email = ?', [$email]);
        if ($existing && !(int) $existing['deleted']) {
            throw new HttpError(422, 'Diese E-Mail-Adresse gehört schon zu ' . $existing['name'] . '. Über „Einladung erneut senden“ bekommt die Person einen neuen Link.');
        }
        if ($existing) {
            // Früher gelöscht → wieder ins Team holen (Aufgaben, Kommentare usw. bleiben erhalten)
            Db::update('users', ['name' => $name, 'password_hash' => $hash, 'role' => $role, 'deleted' => 0, 'updated_at' => $now], ['id' => $existing['id']]);
            Db::exec('DELETE FROM sessions WHERE user_id = ?', [$existing['id']]);
            $user = Db::one('SELECT * FROM users WHERE id = ?', [$existing['id']]);
            Activity::log($me['id'], 'user_added', null, null, "hat {$name} wieder ins Team geholt");
            $restored = true;
        } else {
            $count = (int) Db::value('SELECT COUNT(*) FROM users');
            $user = [
                'id' => Util::uuid(),
                'name' => $name,
                'email' => $email,
                'password_hash' => $hash,
                'color' => self::COLORS[$count % count(self::COLORS)],
                'role' => $role,
                'prefs' => null,
                'created_at' => $now,
                'updated_at' => $now,
                'deleted' => 0,
            ];
            Db::insert('users', $user);
            Activity::log($me['id'], 'user_added', null, null, "hat {$name} zum Team hinzugefügt");
            $restored = false;
        }
        return ['user' => $user, 'restored' => $restored, 'invite' => $invite ? self::invite($me, $user) : null];
    }

    public static function restore(array $me, string $id): array
    {
        $u = Db::one('SELECT * FROM users WHERE id = ? AND deleted = 1', [$id]);
        if (!$u) {
            throw new HttpError(404, 'Person nicht gefunden.');
        }
        Db::update('users', ['deleted' => 0, 'updated_at' => Util::now()], ['id' => $id]);
        Activity::log($me['id'], 'user_added', null, null, "hat {$u['name']} wieder ins Team geholt");
        return Db::one('SELECT * FROM users WHERE id = ?', [$id]);
    }

    // ---------- Einladung ----------

    /** Neuer Einladungslink (alter wird ungültig) + Mail. @return array{sent:bool, message:string, link:string} */
    public static function invite(array $me, array $user): array
    {
        $token = 'pci_' . Crypto::randomKey(24);
        $tokens = Settings::get('invite_tokens', []);
        $tokens = is_array($tokens) ? $tokens : [];
        $tokens[$user['id']] = ['hash' => hash('sha256', $token), 'expires' => Util::now() + self::INVITE_DAYS * 86400000];
        Settings::set('invite_tokens', $tokens);

        $link = Util::baseUrl() . '/?einladung=' . $token;
        $first = explode(' ', trim($user['name']))[0];
        $from = explode(' ', trim($me['name']))[0];
        $text = "Hallo {$first},\n\n{$from} hat dich zur Perfume Cloud Team-App eingeladen – Planung, Notizen, Kalender, Postfach und Statistiken für unser Team.\n\n"
            . "1. Öffne diesen Link und leg dein eigenes Passwort fest:\n{$link}\n\n"
            . "2. Auf dem iPhone: In Safari auf „Teilen“ → „Zum Home-Bildschirm“ tippen. Danach die App über das neue Icon öffnen und einmal anmelden.\n\n"
            . "Deine Anmeldung: {$user['email']}\nDer Link gilt " . self::INVITE_DAYS . " Tage und nur einmal.\n\nBis gleich!\nPerfume Cloud Team";
        $safeLink = htmlspecialchars($link, ENT_QUOTES);
        $html = '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1e2024;max-width:520px">'
            . '<p style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px">Perfume Cloud · Team</p>'
            . '<p>Hallo ' . htmlspecialchars($first) . ',</p>'
            . '<p>' . htmlspecialchars($from) . ' hat dich zur <b>Perfume Cloud Team-App</b> eingeladen – Planung, Notizen, Kalender, Postfach und Statistiken für unser Team.</p>'
            . '<p style="margin:24px 0"><a href="' . $safeLink . '" style="background:#2f4e85;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;display:inline-block;font-weight:600">Passwort festlegen &amp; loslegen</a></p>'
            . '<p>Danach auf dem iPhone in Safari auf <b>Teilen → Zum Home-Bildschirm</b> tippen und die App über das neue Icon öffnen.</p>'
            . '<p style="color:#6e7177;font-size:13px">Deine Anmeldung: ' . htmlspecialchars($user['email']) . '<br>Der Link gilt ' . self::INVITE_DAYS . ' Tage und nur einmal.<br>Falls der Knopf nicht geht: ' . $safeLink . '</p>'
            . '</div>';
        $result = Mailer::send($user['email'], 'Deine Einladung zur Perfume Cloud Team-App', $text, $html);
        return $result + ['link' => $link];
    }

    private static function inviteUser(string $token): ?array
    {
        if (!str_starts_with($token, 'pci_')) {
            return null;
        }
        $hash = hash('sha256', $token);
        foreach ((array) Settings::get('invite_tokens', []) as $userId => $t) {
            if (is_array($t) && hash_equals((string) ($t['hash'] ?? ''), $hash)) {
                if ((int) ($t['expires'] ?? 0) < Util::now()) {
                    throw new HttpError(410, 'Dieser Einladungslink ist abgelaufen. Bitte um eine neue Einladung.');
                }
                return Db::one('SELECT * FROM users WHERE id = ? AND deleted = 0', [$userId]);
            }
        }
        return null;
    }

    public static function inviteInfo(string $token): array
    {
        $u = self::inviteUser($token);
        if (!$u) {
            throw new HttpError(404, 'Dieser Einladungslink ist ungültig oder wurde schon benutzt.');
        }
        return ['name' => explode(' ', trim($u['name']))[0], 'email' => $u['email']];
    }

    public static function acceptInvite(string $token, string $password): array
    {
        $u = self::inviteUser($token);
        if (!$u) {
            throw new HttpError(404, 'Dieser Einladungslink ist ungültig oder wurde schon benutzt.');
        }
        Db::update('users', ['password_hash' => Auth::hashPassword($password), 'updated_at' => Util::now()], ['id' => $u['id']]);
        $tokens = (array) Settings::get('invite_tokens', []);
        unset($tokens[$u['id']]);
        Settings::set('invite_tokens', $tokens);
        Auth::startSession($u);
        return $u;
    }

    public static function invitePending(string $userId): bool
    {
        $t = ((array) Settings::get('invite_tokens', []))[$userId] ?? null;
        return is_array($t) && (int) ($t['expires'] ?? 0) > Util::now();
    }

    // ---------- Wartung ----------

    /** „Datenbank aktualisieren“: Tabellen nachziehen, Hänger lösen, alle Geräte neu laden lassen. */
    public static function repair(): array
    {
        $log = [];
        Db::migrate();
        $log[] = 'Datenbank auf Version ' . APP_VERSION . ' gebracht (Tabellen, Spalten, Indizes geprüft).';

        $lock = (int) Db::value("SELECT v FROM settings WHERE k = 'jobs_lock'");
        if ($lock > 0) {
            Db::exec("UPDATE settings SET v = '0' WHERE k = 'jobs_lock'");
            $log[] = 'Hängende Hintergrundaufgabe freigegeben.';
        }

        $deleted = array_column(Db::all('SELECT id FROM users WHERE deleted = 1'), 'id');
        if ($deleted) {
            $in = implode(',', array_fill(0, count($deleted), '?'));
            $s = Db::exec("DELETE FROM sessions WHERE user_id IN ($in)", $deleted);
            $p = Db::exec("DELETE FROM push_subscriptions WHERE user_id IN ($in)", $deleted);
            foreach ($deleted as $id) {
                MailJob::removePersonal($id);
            }
            if ($s || $p) {
                $log[] = "Anmeldungen ($s) und Push-Geräte ($p) gelöschter Personen entfernt.";
            }
        }
        $expired = Db::exec('DELETE FROM sessions WHERE expires_at < ?', [Util::now()]);
        if ($expired) {
            $log[] = "$expired abgelaufene Anmeldungen aufgeräumt.";
        }
        $broken = Db::exec('DELETE FROM push_subscriptions WHERE fail_count >= ?', [Notify::MAX_FAILS]);
        if ($broken) {
            $log[] = "$broken nicht mehr erreichbare Push-Geräte entfernt.";
        }
        // Der Club (Kunden-App) bringt seine Tabellen auf demselben Weg auf den neuesten Stand.
        // Klappt das nicht, bleibt die Team-Datenbank trotzdem aktualisiert.
        $club = Club::migrate();
        if ($club !== null) {
            $log[] = $club;
        }
        Settings::set('sync_epoch', Util::now());
        $log[] = 'Alle Geräte laden ihre Daten beim nächsten Öffnen komplett neu.';
        Settings::clearCache();
        return $log;
    }

    public static function diagnostics(): array
    {
        $now = Util::now();
        $people = [];
        foreach (Db::all('SELECT * FROM users ORDER BY deleted, created_at') as $u) {
            $people[] = [
                'id' => $u['id'],
                'name' => $u['name'],
                'email' => $u['email'],
                'role' => $u['role'],
                'deleted' => (int) $u['deleted'],
                'lastSeen' => (int) Db::value('SELECT MAX(last_seen_at) FROM sessions WHERE user_id = ?', [$u['id']]) ?: null,
                'pushDevices' => (int) Db::value('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?', [$u['id']]),
                'pushLastOk' => (int) Db::value('SELECT MAX(last_ok_at) FROM push_subscriptions WHERE user_id = ?', [$u['id']]) ?: null,
                'pushError' => Db::value('SELECT last_error FROM push_subscriptions WHERE user_id = ? AND fail_count > 0 ORDER BY fail_count DESC', [$u['id']]),
                'clubAccess' => Auth::clubAccess($u),
                'instagramAccess' => Instagram::access($u),
                'mailPush' => !empty(Auth::prefs($u)['push']['mail']),
                'mailboxes' => MailJob::visibleAddresses($u['id']),
                'invitePending' => self::invitePending($u['id']),
            ];
        }
        return [
            'version' => APP_VERSION,
            'schema' => Settings::get('schema_version'),
            'driver' => Db::driver(),
            'php' => PHP_VERSION,
            'counts' => [
                'tasks' => (int) Db::value('SELECT COUNT(*) FROM tasks WHERE deleted = 0'),
                'notes' => (int) Db::value('SELECT COUNT(*) FROM notes WHERE deleted = 0'),
                'events' => (int) Db::value('SELECT COUNT(*) FROM events WHERE deleted = 0'),
                'emails' => (int) Db::value('SELECT COUNT(*) FROM emails WHERE deleted = 0'),
                'orders' => (int) Db::value('SELECT COUNT(*) FROM orders'),
            ],
            'cronLastRun' => (int) Settings::get('cron_last_run', 0),
            'jobsLastRun' => (int) Settings::get('jobs_last_run', 0),
            'mailLastFetch' => (int) Settings::get('mail_last_fetch', 0),
            'mailSender' => Mailer::sender()['email'] ?? null,
            'now' => $now,
            'people' => $people,
        ];
    }
}
