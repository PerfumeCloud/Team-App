<?php
declare(strict_types=1);

namespace Club;

/**
 * Warteliste mit Höchstzahl (waitlist_max, 0 = unbegrenzt).
 *
 * Gezählt werden die Kundenkonten mit dem Tag der Warteliste in Shopify (alle 10 Minuten neu). Ist die Liste voll,
 * steht das im Shop-Metafeld club.programm – das Theme zeigt dann statt des Formulars den eingestellten Text.
 * Restplätze werden bewusst nicht angezeigt.
 */
final class Waitlist
{
    private const FRESH_MS = 10 * 60 * 1000;

    /** @return array{max:int, count:?int, full:bool, text:string, counted_at:?int} */
    public static function status(bool $refresh = false): array
    {
        $p = Points::program();
        $max = (int) $p['waitlist_max'];
        $c = Settings::get('waitlist_count');
        $c = is_array($c) ? $c : null;
        if ($max > 0 && ($refresh || !$c || Util::now() - (int) $c['at'] > self::FRESH_MS)) {
            $c = self::count() ?? $c;
        }
        $count = $c ? (int) $c['n'] : null;
        return [
            'max' => $max,
            'count' => $count,
            'full' => $max > 0 && $count !== null && $count >= $max,
            'text' => (string) $p['waitlist_full_text'],
            'counted_at' => $c ? (int) $c['at'] : null,
        ];
    }

    /** Kundenkonten mit dem Tag in Shopify zählen (ohne Shopify: die zuletzt geladene Liste). */
    public static function count(): ?array
    {
        $n = null;
        if (Shopify::configured()) {
            try {
                $tag = (string) Points::program()['waitlist_tag'];
                $d = Shopify::graphql('query ClubWaitlistCount($q: String!) { customersCount(query: $q) { count } }', ['q' => 'tag:"' . addcslashes($tag, '"\\') . '"']);
                if (isset($d['customersCount']['count'])) {
                    $n = (int) $d['customersCount']['count'];
                }
            } catch (\Throwable $e) {
                Util::log('Warteliste zählen: ' . $e->getMessage());
            }
        }
        if ($n === null) {
            if (!Settings::get('invites_loaded_at')) {
                return null;
            }
            $n = (int) Db::value('SELECT COUNT(*) FROM club_invites');
        }
        $before = Settings::get('waitlist_count');
        $c = ['n' => $n, 'at' => Util::now()];
        Settings::set('waitlist_count', $c);
        // „voll“ hat sich geändert → Shop-Metafeld neu schreiben
        $max = (int) Points::program()['waitlist_max'];
        $wasFull = is_array($before) && $max > 0 && (int) $before['n'] >= $max;
        if ($max > 0 && $wasFull !== ($n >= $max)) {
            ShopSync::markDirty();
        }
        return $c;
    }

    /**
     * Vor dem Eintragen (Theme über den App-Proxy): Ist noch Platz? Nahe an der Grenze wird höchstens alle 15 Sekunden
     * neu gezählt, sonst reicht der Stand der letzten 10 Minuten. Restplätze werden nicht verraten.
     * @return array{voll:bool, text:?string}
     */
    public static function check(): array
    {
        $p = Points::program();
        $max = (int) $p['waitlist_max'];
        if ($max <= 0) {
            return ['voll' => false, 'text' => null];
        }
        $c = Settings::get('waitlist_count');
        $c = is_array($c) ? $c : null;
        $age = $c ? Util::now() - (int) $c['at'] : PHP_INT_MAX;
        $near = !$c || (int) $c['n'] >= $max - 25;
        if ($age > self::FRESH_MS || ($near && $age > 15000)) {
            $c = self::count() ?? $c;
        }
        $full = $c !== null && (int) $c['n'] >= $max;
        return ['voll' => $full, 'text' => $full ? (string) $p['waitlist_full_text'] : null];
    }

    /** Stündlich (Cronjob): Zahl aktualisieren, solange eine Höchstzahl eingestellt ist. */
    public static function run(): string
    {
        if ((int) Points::program()['waitlist_max'] <= 0) {
            return 'unbegrenzt';
        }
        $s = self::status(true);
        return ($s['count'] ?? '?') . ' von ' . $s['max'] . ($s['full'] ? ' (voll)' : '');
    }
}
