<?php
declare(strict_types=1);

// Cronjob für netcup (Plesk → Geplante Aufgaben → „PHP-Skript ausführen“), alle 15 Minuten.
// Alternativ den Cron-Link aus dem Admin-Bereich per „URL abrufen“ nutzen.

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

try {
    echo Club\Util::json(Club\Jobs::run('cron')), "\n";
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
