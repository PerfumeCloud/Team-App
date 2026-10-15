<?php
declare(strict_types=1);

// Cronjob für netcup (Plesk → Geplante Aufgaben → „PHP-Skript ausführen“), jede Minute (* * * * *).
// Startet den Sofort-Abruf (Push wenige Sekunden nach einer neuen Mail) bzw. hält ihn am Laufen.
//   --once        nur einmal alles abgleichen und beenden (alter Ablauf, ohne Sofort-Abruf)
//   --seconds=N   Laufzeit des Sofort-Abrufs (Standard 900, endet kurz vor einer vollen Minute)
// Alternativ kann die Cron-URL aus den Einstellungen der App per „URL abrufen“ genutzt werden.

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$opts = getopt('', ['once', 'seconds:']);

try {
    if (isset($opts['once'])) {
        $summary = PC\Jobs::run('cron');
    } else {
        PC\Settings::set('cron_last_run', PC\Util::now());
        $summary = PC\Live::run('cli', max(1, (int) ($opts['seconds'] ?? PC\Live::CLI_SECONDS)));
    }
    echo PC\Util::json($summary), "\n";
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
