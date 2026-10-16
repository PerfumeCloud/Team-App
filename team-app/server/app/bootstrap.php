<?php
declare(strict_types=1);

/*
 * Perfume Cloud Team-App – Backend
 *
 * Verzeichnisstruktur auf dem Server:
 *   public/   Dokumentenstamm (App + api.php)
 *   app/      PHP-Code (nicht öffentlich)
 *   storage/  SQLite-Datenbank, Logs (nicht öffentlich)
 *   config.php wird vom Einrichtungsassistenten erzeugt
 */

define('APP_ROOT', dirname(__DIR__));
define('APP_VERSION', '1.7.0');

spl_autoload_register(static function (string $class): void {
    if (strncmp($class, 'PC\\', 3) !== 0) {
        return;
    }
    $file = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, 3)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

date_default_timezone_set('Europe/Berlin');
mb_internal_encoding('UTF-8');
