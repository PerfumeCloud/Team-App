<?php
declare(strict_types=1);

// Cronjob für netcup (Plesk → Geplante Aufgaben → „PHP-Skript ausführen“), alle 5 Minuten.
// Alternativ kann die Cron-URL aus den Einstellungen der App per „URL abrufen“ genutzt werden.

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

try {
    $summary = PC\Jobs::run('cron');
    echo PC\Util::json($summary), "\n";
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
