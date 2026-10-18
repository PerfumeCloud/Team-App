// Update einer bestehenden Installation (Version 1.0, Tabellen ohne Präfix) auf 1.1.
// So läuft es auf app.perfumecloud.de: neue Dateien hochladen, beim ersten Aufruf wird die Datenbank umgebaut.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'club-migrate-'));
const PORT = 19500 + Math.floor(Math.random() * 400);
const app = `http://127.0.0.1:${PORT}`;
const dbFile = join(tmp, 'club.sqlite');
const APP_VERSION = readFileSync(join(serverDir, 'app', 'bootstrap.php'), 'utf8').match(/define\('APP_VERSION', '([^']+)'\)/)[1];
const env = { ...process.env, CLUB_CONFIG: join(tmp, 'config.php'), CLUB_STORAGE: tmp, CLUB_MAIL_LOG: join(tmp, 'mails.log') };
let php;

// Optional mit MySQL/MariaDB: CLUB_TEST_MYSQL=host:port:user:passwort
const MY = process.env.CLUB_TEST_MYSQL ? (([host, port, user, pass]) => ({ host, port: Number(port), user, pass }))(process.env.CLUB_TEST_MYSQL.split(':')) : null;
const dbName = `club_m_${Math.random().toString(36).slice(2, 8)}`;
const dbCfg = MY ? { driver: 'mysql', host: MY.host, port: MY.port, name: dbName, user: MY.user, pass: MY.pass } : { driver: 'sqlite', path: dbFile };
const phpArr = (o) => '[' + Object.entries(o).map(([k, v]) => `'${k}' => ${typeof v === 'number' ? v : JSON.stringify(String(v)).replace(/\$/g, '\\$')}`).join(', ') + ']';
const tableList = () => (MY
  ? sql('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()')
  : sql("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
const indexList = () => (MY
  ? sql("SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'")
  : sql("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);

const sql = (q, params = []) => JSON.parse(execFileSync('php', [join(here, 'helper.php'), 'sql', q, JSON.stringify(params)], { env }).toString());

before(async () => {
  const fixture = readFileSync(join(here, 'fixtures/club-1.0.sql'), 'utf8').replaceAll('__NOW__', String(Date.now()));
  writeFileSync(join(tmp, 'fixture.sql'), fixture);
  execFileSync('php', ['-r', `
    $c = json_decode($argv[1], true);
    if ($c['driver'] === 'sqlite') {
        $pdo = new PDO('sqlite:' . $c['path']);
    } else {
        $root = new PDO("mysql:host={$c['host']};port={$c['port']}", $c['user'], $c['pass']);
        $root->exec("CREATE DATABASE {$c['name']} CHARACTER SET utf8mb4");
        $pdo = new PDO("mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass']);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    foreach (array_filter(array_map('trim', explode(";\n", file_get_contents($argv[2])))) as $stmt) {
        if (!str_starts_with($stmt, '--') || str_contains($stmt, "\n")) {
            $pdo->exec(preg_replace('/^(--[^\n]*\n)+/', '', $stmt));
        }
    }
  `, JSON.stringify(dbCfg), join(tmp, 'fixture.sql')]);
  writeFileSync(env.CLUB_CONFIG, `<?php\nreturn ['db' => ${phpArr(dbCfg)}, 'app_key' => 'alt-schluessel', 'cron_key' => 'cron-alt', 'base_url' => ''];\n`);
  php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', join(serverDir, 'public'), join(serverDir, 'public/router.php')], { env });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout beim Start')), 8000);
    const on = (d) => { if (d.toString().includes('Development Server')) { clearTimeout(t); resolve(); } };
    php.stdout.on('data', on);
    php.stderr.on('data', on);
  });
});

after(() => {
  php?.kill();
  rmSync(tmp, { recursive: true, force: true });
});

test('Version 1.0 wird beim ersten Aufruf auf 1.1 umgebaut – ohne Datenverlust', async () => {
  const status = await (await fetch(`${app}/api/status`)).json();
  assert.equal(status.installed, true, JSON.stringify(status));
  assert.equal(status.version, APP_VERSION);

  const tables = tableList();
  for (const old of ['settings', 'admins', 'members', 'sessions', 'ledger', 'codes', 'order_cache']) {
    assert.ok(!tables.includes(old), `alte Tabelle ${old} umbenannt`);
    assert.ok(tables.includes(`club_${old}`), `club_${old} vorhanden`);
  }
  for (const t of ['club_push_subs', 'club_push_queue', 'club_promotions', 'club_broadcasts', 'club_feedback', 'club_invites', 'club_claims', 'club_sso']) {
    assert.ok(tables.includes(t), `${t} angelegt`);
  }
  const indexes = indexList();
  assert.deepEqual(indexes.filter((n) => !n.startsWith('club_')), [], 'keine alten Indexnamen');

  // Daten sind noch da, neue Spalten haben sinnvolle Werte
  const m = sql('SELECT * FROM club_members')[0];
  assert.equal(m.email, 'anna@example.de');
  assert.equal(m.tier, 'bronze');
  const o = sql('SELECT * FROM club_orders')[0];
  assert.equal(o.rate, 1, 'Satz der alten Bestellungen aus den Regeln');
  assert.equal(o.factor, 1);
  const l = sql('SELECT * FROM club_ledger')[0];
  assert.equal(l.status, 'available');
  assert.equal(l.credited_at, l.created_at);
  const program = JSON.parse(sql("SELECT v FROM club_settings WHERE k = 'program'")[0].v);
  assert.equal(program.welcome_points, 50, 'Einstellungen bleiben erhalten');
  assert.equal(JSON.parse(sql("SELECT v FROM club_settings WHERE k = 'schema_version'")[0].v), APP_VERSION);
  assert.ok(JSON.parse(sql("SELECT v FROM club_settings WHERE k = 'internal_key'")[0].v).length > 20);
});

test('Admin-Anmeldung und Kontostand wie vorher', async () => {
  let res = await fetch(`${app}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PC': '1' },
    body: JSON.stringify({ email: 'marius@example.de', password: 'geheim-12345' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  res = await fetch(`${app}/api/admin/members`, { headers: { Cookie: cookie } });
  const data = await res.json();
  assert.equal(data.members.length, 1);
  assert.equal(data.members[0].balance, 50 + 129);
  assert.equal(data.members[0].tier, 'bronze');
  // Zweiter Aufruf baut nichts mehr um
  const before = sql("SELECT v FROM club_settings WHERE k = 'internal_key'")[0].v;
  await fetch(`${app}/api/status`);
  assert.equal(sql("SELECT v FROM club_settings WHERE k = 'internal_key'")[0].v, before);
});
