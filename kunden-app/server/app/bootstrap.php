<?php
declare(strict_types=1);

/*
 * Perfume Cloud Club – Kunden-App (Treuepunkte, Bestellungen, Sendungsverfolgung)
 *
 * Verzeichnisstruktur auf dem Server:
 *   public/   Dokumentenstamm (App + api.php)
 *   app/      PHP-Code (nicht öffentlich)
 *   storage/  Logs (nicht öffentlich)
 *   config.php wird vom Einrichtungsassistenten erzeugt
 */

define('APP_ROOT', dirname(__DIR__));
define('APP_VERSION', '1.5.1');

spl_autoload_register(static function (string $class): void {
    if (strncmp($class, 'Club\\', 5) !== 0) {
        return;
    }
    $file = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, 5)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

date_default_timezone_set('Europe/Berlin');
mb_internal_encoding('UTF-8');
