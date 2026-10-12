<?php
// Nur für die lokale Entwicklung mit `php -S` – ersetzt die .htaccess.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/api(/|$)#', $path)) {
    require __DIR__ . '/api.php';
    return true;
}
if ($path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}
if (is_file(__DIR__ . '/index.html')) {
    readfile(__DIR__ . '/index.html');
    return true;
}
echo 'Frontend noch nicht gebaut (npm run build im Ordner web).';
return true;
