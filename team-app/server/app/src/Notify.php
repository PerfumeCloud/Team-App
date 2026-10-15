<?php
declare(strict_types=1);

namespace PC;

/** Verschickt Push-Nachrichten an Teammitglieder – unter Beachtung ihrer Einstellungen. */
final class Notify
{
    /**
     * @param string[]|null $userIds null = alle
     * @param string $kind mail | orders | tasks | comments | reminders | events
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

    /** Nach so vielen Fehlschlägen hintereinander wird ein Gerät entfernt (404/410 sofort). */
    public const MAX_FAILS = 30;

    public static function toUser(array $user, array $payload): int
    {
        $subs = Db::all('SELECT * FROM push_subscriptions WHERE user_id = ?', [$user['id']]);
        if (!$subs) {
            return 0;
        }
        $payload['badge'] = self::badgeCount($user['id']);
        $subject = self::subject($user);
        $ok = 0;
        foreach ($subs as $s) {
            if (self::sendTo($s, $payload, $subject)['ok']) {
                $ok++;
            }
        }
        return $ok;
    }

    /** Testnachricht an alle Geräte einer Person – mit Ergebnis je Gerät. */
    public static function test(array $user): array
    {
        $subs = Db::all('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at', [$user['id']]);
        $payload = [
            'title' => 'Push funktioniert ✓',
            'body' => 'So sehen Benachrichtigungen der Team-App aus.',
            'url' => '/einstellungen',
            'tag' => 'test',
            'badge' => self::badgeCount($user['id']),
        ];
        $subject = self::subject($user);
        $results = [];
        foreach ($subs as $s) {
            $res = self::sendTo($s, $payload, $subject);
            $results[] = ['id' => $s['id'], 'device' => self::deviceName((string) $s['user_agent']), 'ok' => $res['ok'], 'status' => $res['status'], 'reason' => $res['reason']];
        }
        return ['devices' => count($subs), 'sent' => count(array_filter($results, static fn ($r) => $r['ok'])), 'results' => $results];
    }

    /** Geräte einer Person mit letztem Ergebnis (für die Einstellungen). */
    public static function devices(string $userId): array
    {
        return array_map(static fn ($s) => [
            'id' => $s['id'],
            'device' => self::deviceName((string) $s['user_agent']),
            'created_at' => (int) $s['created_at'],
            'last_ok_at' => $s['last_ok_at'] !== null ? (int) $s['last_ok_at'] : null,
            'last_status' => $s['last_status'] !== null ? (int) $s['last_status'] : null,
            'last_error' => $s['last_error'],
            'fail_count' => (int) $s['fail_count'],
        ], Db::all('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at', [$userId]));
    }

    /**
     * An ein Gerät senden und das Ergebnis am Abo vermerken.
     * Gelöscht wird ein Abo nur, wenn der Push-Dienst sagt, dass es es nicht mehr gibt (404/410),
     * oder nach MAX_FAILS Fehlschlägen hintereinander. Ein 400/403 (z. B. „BadJwtToken“) kann am
     * Server liegen – dann soll das Gerät nach der Reparatur wieder Nachrichten bekommen.
     * @return array{ok:bool, status:int, reason:string}
     */
    private static function sendTo(array $s, array $payload, string $subject): array
    {
        try {
            $res = WebPush::send($s, $payload, $subject);
        } catch (\Throwable $e) {
            Util::log('Push-Fehler: ' . $e->getMessage());
            $res = ['status' => 0, 'reason' => $e->getMessage()];
        }
        $status = $res['status'];
        $ok = $status >= 200 && $status < 300;
        if ($ok) {
            Db::update('push_subscriptions', ['last_ok_at' => Util::now(), 'fail_count' => 0, 'last_status' => $status, 'last_error' => null], ['id' => $s['id']]);
        } elseif ($status === 404 || $status === 410) {
            // Abo gibt es nicht mehr (App gelöscht, Mitteilungen ausgeschaltet, Abo abgelaufen)
            Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$s['id']]);
            $res['reason'] = 'Gerät abgemeldet';
        } else {
            $fails = (int) $s['fail_count'] + 1;
            if ($fails >= self::MAX_FAILS) {
                Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$s['id']]);
            } else {
                Db::update('push_subscriptions', ['fail_count' => $fails, 'last_status' => $status, 'last_error' => mb_substr($res['reason'], 0, 250)], ['id' => $s['id']]);
            }
        }
        return ['ok' => $ok, 'status' => $status, 'reason' => $res['reason']];
    }

    /** Kontakt für den Push-Dienst (VAPID „sub“): muss eine gültige mailto:-Adresse sein, sonst lehnt Apple ab. */
    private static function subject(array $user): string
    {
        $contact = Settings::get('push_contact');
        if (!is_string($contact) || !filter_var($contact, FILTER_VALIDATE_EMAIL)) {
            $contact = $user['email'];
        }
        return 'mailto:' . $contact;
    }

    /** „iPhone Safari“, „Mac Chrome“ … aus dem User-Agent. */
    public static function deviceName(string $ua): string
    {
        $os = match (true) {
            str_contains($ua, 'iPhone') => 'iPhone',
            str_contains($ua, 'iPad') => 'iPad',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Mac OS') => 'Mac',
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Linux') => 'Linux',
            default => 'Gerät',
        };
        $browser = match (true) {
            str_contains($ua, 'Edg/') => 'Edge',
            str_contains($ua, 'Firefox') => 'Firefox',
            str_contains($ua, 'Chrome') => 'Chrome',
            str_contains($ua, 'Safari') => 'Safari',
            default => '',
        };
        return trim("$os $browser");
    }

    /** Zahl auf dem App-Icon: wichtige offene Mails, die diese Person sehen darf (Team + eigenes Postfach). */
    public static function badgeCount(string $userId): int
    {
        $boxes = MailJob::visibleAddresses($userId);
        if (!$boxes) {
            return 0;
        }
        return (int) Db::value(
            "SELECT COUNT(*) FROM emails WHERE deleted = 0 AND important = 1 AND answered = 0 AND status = 'open' AND mailbox IN (" . implode(',', array_fill(0, count($boxes), '?')) . ')',
            $boxes
        );
    }

    public static function quietHours(): bool
    {
        $h = (int) date('G');
        return $h >= 22 || $h < 7;
    }
}
