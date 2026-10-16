<?php
declare(strict_types=1);

namespace PC;

/**
 * Zusammenfassung für das iPhone-Widget (Scriptable).
 * Zugriff nur lesend über einen persönlichen Widget-Schlüssel, der jederzeit neu erzeugt werden kann.
 */
final class Widget
{
    public static function createToken(array $user): string
    {
        $token = 'pcw_' . Crypto::randomKey(24);
        $tokens = Settings::get('widget_tokens', []);
        $tokens = is_array($tokens) ? $tokens : [];
        $tokens[$user['id']] = hash('sha256', $token);
        Settings::set('widget_tokens', $tokens);
        return $token;
    }

    public static function revoke(array $user): void
    {
        $tokens = Settings::get('widget_tokens', []);
        if (is_array($tokens)) {
            unset($tokens[$user['id']]);
            Settings::set('widget_tokens', $tokens);
        }
    }

    public static function hasToken(array $user): bool
    {
        $tokens = Settings::get('widget_tokens', []);
        return is_array($tokens) && isset($tokens[$user['id']]);
    }

    public static function userForToken(string $token): ?array
    {
        if (!str_starts_with($token, 'pcw_')) {
            return null;
        }
        $hash = hash('sha256', $token);
        foreach ((array) Settings::get('widget_tokens', []) as $userId => $stored) {
            if (is_string($stored) && hash_equals($stored, $hash)) {
                return Db::one('SELECT * FROM users WHERE id = ? AND deleted = 0', [$userId]);
            }
        }
        return null;
    }

    public static function summary(array $user): array
    {
        $today = date('Y-m-d');
        $tasks = Db::all(
            "SELECT id, title, due_date, priority FROM tasks WHERE deleted = 0 AND status <> 'done' AND assignee_id = ?",
            [$user['id']]
        );
        usort($tasks, static function ($a, $b) {
            $ad = $a['due_date'] ?? '9999';
            $bd = $b['due_date'] ?? '9999';
            if ($ad !== $bd) {
                return $ad <=> $bd;
            }
            return ($a['priority'] === 'high' ? 0 : 1) <=> ($b['priority'] === 'high' ? 0 : 1);
        });
        $boxes = MailJob::visibleAddresses($user['id']);
        $mails = $boxes ? Db::all(
            "SELECT from_name, from_email, subject, mailbox, received_at FROM emails
             WHERE deleted = 0 AND important = 1 AND answered = 0 AND status = 'open' AND mailbox IN (" . implode(',', array_fill(0, count($boxes), '?')) . ')
             ORDER BY score DESC, received_at DESC',
            $boxes
        ) : [];
        $shopify = Shopify::configured() || (int) Db::value('SELECT COUNT(*) FROM orders') > 0;

        return [
            'name' => explode(' ', trim($user['name']))[0],
            'serverTime' => Util::now(),
            'shopify' => $shopify,
            'mail' => count($boxes) > 0,
            'today' => $shopify ? Stats::today() : null,
            'toShip' => $shopify ? count(Stats::toShip()) : null,
            'importantMails' => count($mails),
            // Nur für Admins und Personen mit Club-Zugang
            'club' => Auth::clubAccess($user) && Club::configured() ? self::club() : null,
            'events' => Calendar::upcoming($user),
            'mails' => array_map(static fn ($m) => [
                'from' => (string) ($m['from_name'] ?: $m['from_email']),
                'subject' => (string) $m['subject'],
                'mailbox' => explode('@', (string) $m['mailbox'])[0] . '@',
                'at' => (int) $m['received_at'],
            ], array_slice($mails, 0, 4)),
            'tasks' => [
                'open' => count($tasks),
                'overdue' => count(array_filter($tasks, static fn ($t) => $t['due_date'] !== null && $t['due_date'] < $today)),
                'today' => count(array_filter($tasks, static fn ($t) => $t['due_date'] === $today)),
                'next' => array_map(static fn ($t) => [
                    'title' => $t['title'],
                    'due' => $t['due_date'],
                    'high' => $t['priority'] === 'high',
                ], array_slice($tasks, 0, 4)),
            ],
        ];
    }

    /**
     * Club-Zahlen fürs Widget, 5 Minuten zwischengespeichert – auch Fehlversuche, damit das Widget nie auf
     * einen nicht erreichbaren Club wartet. Dann bis zu einer Stunde der letzte gute Stand.
     */
    private static function club(): ?array
    {
        $cached = Settings::get('widget_club');
        $cached = is_array($cached) ? $cached : ['at' => 0, 'data' => null, 'data_at' => 0];
        $now = Util::now();
        if ($now - (int) $cached['at'] < 5 * 60000) {
            return $now - (int) ($cached['data_at'] ?? 0) < 3600000 ? $cached['data'] : null;
        }
        try {
            $cached = ['at' => $now, 'data' => Club::request('GET', '/internal/widget'), 'data_at' => $now];
        } catch (\Throwable) {
            $cached['at'] = $now;
        }
        Settings::set('widget_club', $cached);
        return $now - (int) ($cached['data_at'] ?? 0) < 3600000 ? $cached['data'] : null;
    }
}
