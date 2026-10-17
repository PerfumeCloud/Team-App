<?php
declare(strict_types=1);

// Hilfsskript für die Tests: SQL direkt auf der Test-Datenbank ausführen.
// php helper.php sql "<SQL>" '[params]'
require dirname(__DIR__) . '/app/bootstrap.php';

[$cmd, $sql, $params] = [$argv[1] ?? '', $argv[2] ?? '', json_decode($argv[3] ?? '[]', true) ?: []];
if ($cmd === 'sql') {
    if (preg_match('/^\s*select/i', $sql)) {
        echo json_encode(Club\Db::all($sql, $params));
    } else {
        echo json_encode(['changed' => Club\Db::exec($sql, $params)]);
    }
} elseif ($cmd === 'expiry-remind') {
    // php helper.php expiry-remind <member_id> <now_ms>: Verfall-Erinnerung zu einem späteren Zeitpunkt prüfen
    echo json_encode(['sent' => Club\Expiry::remind($sql, (int) ($argv[3] ?? 0), Club\Points::warnDays())]);
}
