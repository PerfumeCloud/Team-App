<?php
declare(strict_types=1);

namespace PC;

/**
 * Sofort-Abruf: Ein Hintergrundprozess hält zu jedem Postfach eine Verbindung offen (IMAP IDLE).
 * Der Mailserver meldet eine neue Mail in dem Moment, in dem sie ankommt – die App holt sie und
 * schickt den Push nach wenigen Sekunden. Kann ein Server kein IDLE, fragt die App alle 10 Sekunden nach.
 *
 * Gestartet wird der Prozess vom Cronjob (jede Minute). Läuft schon einer, beendet sich der neue sofort.
 * Er endet von selbst kurz vor einer vollen Minute (CLI nach höchstens 15 Minuten, per URL nach einer),
 * damit der nächste Cronjob nahtlos übernimmt. Mails aus der Lücke holt der nächste sofort nach.
 * Beendet der Hoster den Prozess, startet ihn der Cronjob in der nächsten Minute neu.
 * Nach einem Update (neue Programmdateien) beendet er sich, damit der nächste mit dem neuen Code läuft.
 *
 * Nebenbei: Bestellungen alle 20 Sekunden, Erinnerungen und Termine jede Minute, vollständiger
 * Mail-Abgleich (gelesen, beantwortet, gelöscht) alle 5 Minuten bzw. bald nach Änderungen.
 */
final class Live
{
    public const CLI_SECONDS = 900;
    public const URL_SECONDS = 60;
    private const ORDERS_EVERY = 20;
    private const OTHER_EVERY = 60;
    private const FULL_MAIL_EVERY = 300;
    private const FULL_MAIL_SOON = 60;   // nach Änderungen (gelesen, gelöscht) frühestens so lange nach dem letzten
    private const IDLE_RENEW = 240;      // IDLE regelmäßig erneuern, damit tote Verbindungen auffallen
    private const POLL_EVERY = 10;       // ohne IDLE: so oft nachfragen (NOOP)
    private const CONFIG_EVERY = 30;     // Postfächer neu einlesen (neu, geändert, entfernt)
    private const BEAT_EVERY = 15;
    private const END_SECOND = 57;       // kurz vor der vollen Minute enden, dann startet der nächste Cronjob
    private const ACTIVE_MS = 75_000;    // so lange gilt der Abruf nach dem letzten Lebenszeichen als aktiv

    public static function lockPath(): string
    {
        return Config::storageDir() . '/live.lock';
    }

    /** Läuft gerade ein Sofort-Abruf (in irgendeinem Prozess)? */
    public static function running(): bool
    {
        $fp = @fopen(self::lockPath(), 'c');
        if (!$fp) {
            return false;
        }
        $free = flock($fp, LOCK_EX | LOCK_NB);
        if ($free) {
            flock($fp, LOCK_UN);
        }
        fclose($fp);
        return !$free;
    }

    /** Kann ein Web-Aufruf weiterlaufen, nachdem die Antwort raus ist? (PHP-FPM) */
    public static function background(): bool
    {
        return function_exists('fastcgi_finish_request') && PHP_SAPI !== 'cli-server';
    }

    /** Zustand für die Einstellungen. */
    public static function status(): array
    {
        $s = Settings::get('live');
        $s = is_array($s) ? $s : [];
        $beat = (int) ($s['beat'] ?? 0);
        return [
            'active' => $beat > 0 && Util::now() - $beat < self::ACTIVE_MS,
            'mode' => $s['mode'] ?? null,
            'started' => (int) ($s['started'] ?? 0),
            'beat' => $beat,
            'boxes' => is_array($s['boxes'] ?? null) ? $s['boxes'] : [],
            'lastMail' => is_array($s['last_mail'] ?? null) ? $s['last_mail'] : null,
        ];
    }

    /** Neueste Änderungszeit der Programmdateien – ändert sich, sobald ein Update hochgeladen wurde. */
    private static function codeStamp(): int
    {
        clearstatcache();
        $files = array_merge([APP_ROOT . '/app/bootstrap.php'], glob(APP_ROOT . '/app/src/*.php') ?: []);
        return max(array_map(static fn (string $f) => (int) @filemtime($f), $files));
    }

    /** Ende des Laufs: kurz vor einer vollen Minute (bei kurzen Testläufen genau nach $seconds). */
    public static function endTime(int $start, int $seconds): int
    {
        if ($seconds < 60) {
            return $start + max(1, $seconds);
        }
        $end = intdiv($start + $seconds - 60, 60) * 60 + self::END_SECOND;
        return $end - $start < 20 ? $end + 60 : $end;
    }

    /**
     * Läuft bis kurz vor der vollen Minute nach $seconds Sekunden.
     * @param string $mode cli | url
     */
    public static function run(string $mode, int $seconds): array
    {
        $lock = @fopen(self::lockPath(), 'c');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
            if ($lock) {
                fclose($lock);
            }
            return ['live' => 'läuft bereits'];
        }
        @set_time_limit(0);
        ignore_user_abort(true);

        $start = time();
        $end = self::endTime($start, $seconds);
        $boxes = [];
        $next = ['orders' => 0, 'other' => 0, 'config' => 0, 'beat' => 0];
        $fullSoon = false;
        $stats = ['new' => 0, 'pushed' => 0];
        $state = ['mode' => $mode, 'started' => Util::now(), 'beat' => Util::now(), 'boxes' => []];
        $code = self::codeStamp();
        $old = Settings::get('live');
        if (is_array($old) && isset($old['last_mail'])) {
            $state['last_mail'] = $old['last_mail'];
        }

        try {
            while (time() < $end) {
                $now = time();
                Settings::clearCache(); // Änderungen aus der App (Postfächer, Einstellungen) sehen
                Db::keepAlive();

                if ($now >= $next['config']) {
                    if (self::codeStamp() !== $code) {
                        break; // App wurde aktualisiert: der nächste Cronjob startet mit dem neuen Code
                    }
                    self::syncBoxes($boxes);
                    $next['config'] = $now + self::CONFIG_EVERY;
                }

                // Verbinden, IDLE erneuern, ohne IDLE nachfragen
                foreach ($boxes as &$b) {
                    if (!$b['imap']) {
                        if ($now >= $b['retry']) {
                            self::open($b);
                        }
                        continue;
                    }
                    try {
                        if ($b['idle'] && $now - $b['idleSince'] >= self::IDLE_RENEW) {
                            $fullSoon = self::analyze($b, $b['imap']->idleDone()) || $fullSoon;
                            $b['imap']->idle();
                            $b['idleSince'] = $now;
                        } elseif (!$b['idle'] && $now >= $b['nextPoll']) {
                            $fullSoon = self::analyze($b, $b['imap']->noop()) || $fullSoon;
                            $b['nextPoll'] = $now + self::POLL_EVERY;
                        }
                    } catch (\Throwable $e) {
                        self::fail($b, $e);
                    }
                }
                unset($b);

                // Geplante Arbeit (Bestellungen, Erinnerungen, vollständiger Mail-Abgleich)
                $parts = [];
                if ($now >= $next['orders']) {
                    $parts['orders'] = true;
                    $next['orders'] = $now + self::ORDERS_EVERY;
                }
                if ($now >= $next['other']) {
                    $parts['other'] = true;
                    $next['other'] = $now + self::OTHER_EVERY;
                }
                $sinceFull = $now - intdiv((int) Settings::get('mail_last_fetch', 0), 1000);
                $uninitialized = array_filter($boxes, static fn ($b) => !Settings::get('mail_init_' . $b['mb']['id']));
                // Neue Postfächer und Änderungen bald, sonst alle 5 Minuten – nie öfter als jede Minute
                if ($boxes && ($sinceFull >= self::FULL_MAIL_EVERY || (($fullSoon || $uninitialized) && $sinceFull >= self::FULL_MAIL_SOON))) {
                    $parts['mail'] = true;
                    $fullSoon = false;
                }
                if ($parts) {
                    Jobs::run('live', $parts);
                    @set_time_limit(0);
                }

                if (time() >= $next['beat']) {
                    self::beat($state, $boxes);
                    $next['beat'] = time() + self::BEAT_EVERY;
                }

                // Warten: auf den Mailserver oder bis zur nächsten geplanten Arbeit
                $until = $next['beat'];
                $until = min($until, $next['orders'], $next['other'], $next['config'], $end);
                foreach ($boxes as $b) {
                    $until = min($until, !$b['imap'] ? max($b['retry'], $now + 1) : ($b['idle'] ? $b['idleSince'] + self::IDLE_RENEW : $b['nextPoll']));
                }
                $ready = array_keys(array_filter($boxes, static fn ($b) => $b['dirty'] || ($b['imap'] && $b['imap']->buffered())));
                $wait = $ready ? 0 : max(1, $until - time());
                $streams = [];
                foreach ($boxes as $id => $b) {
                    if ($b['imap'] && $b['idle'] && $b['imap']->idling() && $b['imap']->stream()) {
                        $streams[$id] = $b['imap']->stream();
                    }
                }
                if ($streams) {
                    $read = array_values($streams);
                    $w = null;
                    $x = null;
                    if (@stream_select($read, $w, $x, $wait) > 0) {
                        foreach ($streams as $id => $st) {
                            if (in_array($st, $read, true) && !in_array($id, $ready, true)) {
                                $ready[] = $id;
                            }
                        }
                    }
                } elseif ($wait > 0) {
                    sleep(min($wait, max(1, $end - time())));
                }

                // Was der Server gemeldet hat, auswerten; neue Mails holen und melden
                $changed = false;
                foreach ($ready as $id) {
                    $b = &$boxes[$id];
                    try {
                        if ($b['imap'] && $b['imap']->idling() && ($b['imap']->buffered() || in_array($b['imap']->stream(), $read ?? [], true))) {
                            $fullSoon = self::analyze($b, $b['imap']->pending()) || $fullSoon;
                        }
                        if ($b['dirty'] && $b['imap']) {
                            if ($b['imap']->idling()) {
                                $fullSoon = self::analyze($b, $b['imap']->idleDone()) || $fullSoon;
                            }
                            $b['dirty'] = false;
                            $r = MailJob::fetchNew($b['imap'], $b['mb'], $b['validity'], $b['uid']);
                            $b['uid'] = $r['uid'];
                            if ($r['new'] > 0) {
                                $stats['new'] += $r['new'];
                                $changed = true;
                            }
                            if ($b['idle']) {
                                $b['imap']->idle();
                                $b['idleSince'] = time();
                            }
                        }
                    } catch (\Throwable $e) {
                        self::fail($b, $e);
                    }
                    unset($b);
                }
                $read = null;
                if ($changed) {
                    $fresh = MailJob::notify();
                    if ($fresh) {
                        $stats['pushed'] += count($fresh);
                        $newest = max(array_map(static fn ($m) => (int) $m['received_at'], $fresh));
                        $state['last_mail'] = ['at' => Util::now(), 'delay' => max(0, Util::now() - $newest)];
                        $next['beat'] = 0; // Zustand gleich speichern
                    }
                }
            }
        } finally {
            foreach ($boxes as $b) {
                self::close($b);
            }
            try {
                self::beat($state, $boxes);
            } catch (\Throwable) {
            }
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        return ['live' => 'beendet', 'mode' => $mode, 'seconds' => time() - $start, 'new' => $stats['new'], 'pushed' => $stats['pushed'], 'boxes' => $state['boxes']];
    }

    // ---------- Postfächer ----------

    /** Liste der Postfächer abgleichen: neue verbinden, geänderte neu verbinden, entfernte schließen. */
    private static function syncBoxes(array &$boxes): void
    {
        $want = [];
        foreach (MailJob::mailboxes() as $mb) {
            $id = $mb['id'];
            $want[$id] = true;
            // Geändertes Passwort oder geänderter Server → neu verbinden
            $sig = sha1(Util::json([$mb['email'], $mb['host'], $mb['port'], $mb['security'], $mb['user'], Settings::get('mailbox_pw_' . $id)]));
            if (isset($boxes[$id]) && $boxes[$id]['sig'] === $sig) {
                $boxes[$id]['mb'] = $mb;
                continue;
            }
            if (isset($boxes[$id])) {
                self::close($boxes[$id]);
            }
            $boxes[$id] = [
                'mb' => $mb, 'sig' => $sig, 'imap' => null, 'retry' => 0, 'fails' => 0, 'state' => 'connecting', 'message' => null,
                'dirty' => false, 'uid' => 0, 'validity' => '', 'idle' => false, 'idleSince' => 0, 'nextPoll' => 0,
            ];
        }
        foreach (array_keys($boxes) as $id) {
            if (!isset($want[$id])) {
                self::close($boxes[$id]);
                unset($boxes[$id]);
            }
        }
    }

    private static function open(array &$b): void
    {
        $mb = $b['mb'];
        try {
            $pw = MailJob::password($mb['id']);
            if (!$pw) {
                throw new \RuntimeException('Passwort fehlt.');
            }
            $imap = new Imap($mb['host'], (int) $mb['port'], $mb['security']);
            $b['imap'] = $imap;
            $imap->connect();
            $imap->login($mb['user'], $pw);
            $caps = $imap->capabilities();
            $validity = $imap->examine('INBOX');
            $known = MailJob::knownUid($mb, $validity);
            $b['validity'] = $validity;
            $b['uid'] = $known ?? max(0, $imap->uidNext - 1);
            // Was zwischen zwei Läufen ankam, gleich nachholen
            $b['dirty'] = $known !== null && ($imap->uidNext === 0 || $imap->uidNext - 1 > $known);
            $b['idle'] = in_array('IDLE', $caps, true);
            $b['fails'] = 0;
            $b['message'] = null;
            if ($b['idle']) {
                $imap->idle();
                $b['idleSince'] = time();
                $b['state'] = 'idle';
            } else {
                $b['nextPoll'] = time() + self::POLL_EVERY;
                $b['state'] = 'poll';
            }
        } catch (\Throwable $e) {
            self::fail($b, $e);
        }
    }

    /** Verbindung weg: später neu versuchen (15 s, 30 s, 1 Min. … höchstens 5 Min.; falsches Passwort: 5 Min.). */
    private static function fail(array &$b, \Throwable $e): void
    {
        $b['imap']?->close();
        $b['imap'] = null;
        $b['dirty'] = false;
        $b['fails']++;
        $msg = $e->getMessage();
        $delay = str_contains($msg, 'Anmeldung') || str_contains($msg, 'Passwort') ? 300 : min(300, 15 * 2 ** min(5, $b['fails'] - 1));
        $b['retry'] = time() + $delay;
        $b['state'] = 'error';
        $b['message'] = mb_substr($msg, 0, 200);
        Util::log('Sofort-Abruf ' . $b['mb']['email'] . ': ' . $msg);
    }

    private static function close(array $b): void
    {
        if ($b['imap']) {
            try {
                $b['imap']->logout();
            } catch (\Throwable) {
                $b['imap']->close();
            }
        }
    }

    /**
     * Antwortzeilen des Servers auswerten. EXISTS = neue Mail → holen.
     * @return bool true, wenn sich Bestehendes geändert hat (gelesen, markiert, gelöscht) → bald vollständig abgleichen
     */
    private static function analyze(array &$b, array $lines): bool
    {
        $changed = false;
        foreach ($lines as $line) {
            if (preg_match('/^\* \d+ EXISTS/i', $line)) {
                $b['dirty'] = true;
            } elseif (preg_match('/^\* \d+ (EXPUNGE|FETCH)\b/i', $line)) {
                $changed = true;
            }
        }
        return $changed;
    }

    private static function beat(array &$state, array $boxes): void
    {
        $state['beat'] = Util::now();
        $state['boxes'] = [];
        foreach ($boxes as $b) {
            $state['boxes'][$b['mb']['email']] = ['state' => $b['state'], 'message' => $b['message']];
        }
        Settings::set('live', $state);
    }
}
