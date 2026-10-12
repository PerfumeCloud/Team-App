<?php
declare(strict_types=1);

namespace PC;

/** Verschickt Push-Nachrichten an Teammitglieder – unter Beachtung ihrer Einstellungen. */
final class Notify
{
    /**
     * @param string[]|null $userIds null = alle
     * @param string $kind mail | orders | tasks | comments | reminders
     * @param array{title:string,body:string,url?:string,tag?:string} $payload
     */
    public static function users(?array $userIds, string $kind, array $payload): int
    {
        $users = Db::all('SELECT * FROM users WHERE deleted = 0');
        $sent = 0;
        foreach ($users as $u) {
            if ($userIds !== null && !in_array($u['id'], $userIds, true)) {
                continue;
            }
            if (empty(Auth::prefs($u)['push'][$kind])) {
                continue;
            }
            $sent += self::toUser($u, $payload);
        }
        return $sent;
    }

    public static function toUser(array $user, array $payload): int
    {
        $subs = Db::all('SELECT * FROM push_subscriptions WHERE user_id = ?', [$user['id']]);
        if (!$subs) {
            return 0;
        }
        $payload['badge'] = self::badgeCount($user['id']);
        $subject = 'mailto:' . (Settings::get('push_contact') ?: $user['email']);
        $ok = 0;
        foreach ($subs as $s) {
            try {
                $status = WebPush::send($s, $payload, (string) $subject);
            } catch (\Throwable $e) {
                Util::log('Push-Fehler: ' . $e->getMessage());
                $status = 0;
            }
            if ($status >= 200 && $status < 300) {
                $ok++;
                Db::update('push_subscriptions', ['last_ok_at' => Util::now(), 'fail_count' => 0], ['id' => $s['id']]);
            } elseif (in_array($status, [400, 403, 404, 410], true)) {
                Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$s['id']]);
            } else {
                $fails = (int) $s['fail_count'] + 1;
                if ($fails >= 10) {
                    Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$s['id']]);
                } else {
                    Db::update('push_subscriptions', ['fail_count' => $fails], ['id' => $s['id']]);
                }
            }
        }
        return $ok;
    }

    /** Zahl auf dem App-Icon: wichtige offene Mails, die diese Person sehen darf (Team + eigenes Postfach). */
    public static function badgeCount(string $userId): int
    {
        return (int) Db::value(
            "SELECT COUNT(*) FROM emails WHERE deleted = 0 AND important = 1 AND answered = 0 AND status = 'open' AND (owner_id IS NULL OR owner_id = ?)",
            [$userId]
        );
    }

    public static function quietHours(): bool
    {
        $h = (int) date('G');
        return $h >= 22 || $h < 7;
    }
}
