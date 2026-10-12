// Prüft Feiertage und Aktionstage – und dass App und Server (PHP) dieselben Tage berechnen.
// Aufruf: node --test team-app/web/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { easter, specialDays, specialDaysBetween, STATES } from '../src/lib/holidays.ts';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (list, title) => list.find((d) => d.title === title)?.date;

test('Ostersonntag', () => {
  assert.equal(ymd(easter(2024)), '2024-03-31');
  assert.equal(ymd(easter(2025)), '2025-04-20');
  assert.equal(ymd(easter(2026)), '2026-04-05');
  assert.equal(ymd(easter(2027)), '2027-03-28');
  assert.equal(ymd(easter(2038)), '2038-04-25');
});

test('bewegliche Feiertage und Aktionstage 2026', () => {
  const y = specialDays(2026, 'NW');
  assert.equal(dateOf(y, 'Karfreitag'), '2026-04-03');
  assert.equal(dateOf(y, 'Ostermontag'), '2026-04-06');
  assert.equal(dateOf(y, 'Christi Himmelfahrt'), '2026-05-14');
  assert.equal(dateOf(y, 'Pfingstmontag'), '2026-05-25');
  assert.equal(dateOf(y, 'Fronleichnam'), '2026-06-04');
  assert.equal(dateOf(y, 'Muttertag'), '2026-05-10');
  assert.equal(dateOf(y, 'Vatertag'), '2026-05-14');
  assert.equal(dateOf(y, 'Start Black Week'), '2026-11-23');
  assert.equal(dateOf(y, 'Black Friday'), '2026-11-27');
  assert.equal(dateOf(y, 'Cyber Monday'), '2026-11-30');
  assert.equal(dateOf(y, '1. Advent'), '2026-11-29');
  assert.equal(dateOf(specialDays(2025), 'Black Friday'), '2025-11-28');
  assert.equal(dateOf(specialDays(2027), 'Black Friday'), '2027-11-26');
});

test('Buß- und Bettag und 1. Advent in Grenzfällen', () => {
  assert.equal(dateOf(specialDays(2026, 'SN'), 'Buß- und Bettag'), '2026-11-18');
  // 23. November ist ein Mittwoch → eine Woche davor
  assert.equal(dateOf(specialDays(2022, 'SN'), 'Buß- und Bettag'), '2022-11-16');
  // Heiligabend ist ein Sonntag → 1. Advent am 3. Dezember
  assert.equal(dateOf(specialDays(2023), '1. Advent'), '2023-12-03');
});

test('Bundesländer', () => {
  const titles = (state) => specialDays(2026, state, { shop: false }).map((d) => d.title);
  assert.equal(titles('').length, 9, 'nur die 9 bundesweiten');
  assert.ok(titles('NW').includes('Fronleichnam'));
  assert.ok(titles('NW').includes('Allerheiligen'));
  assert.ok(!titles('NW').includes('Reformationstag'));
  assert.ok(titles('NI').includes('Reformationstag'));
  assert.ok(titles('BY').includes('Mariä Himmelfahrt'));
  assert.ok(titles('TH').includes('Weltkindertag'));
  // Berlin: Frauentag ist Feiertag – kein doppelter Aktionstag am selben Tag
  const be = specialDays(2026, 'BE').filter((d) => d.date === '2026-03-08');
  assert.deepEqual(be.map((d) => d.type), ['feiertag']);
  // Brandenburg: Ostersonntag ist Feiertag – nicht zusätzlich als Aktionstag
  const bb = specialDays(2026, 'BB').filter((d) => d.date === '2026-04-05');
  assert.deepEqual(bb.map((d) => d.type), ['feiertag']);
});

test('Schalter und Zeiträume über den Jahreswechsel', () => {
  assert.ok(specialDays(2026, '', { holidays: false }).every((d) => d.type === 'aktion'));
  assert.ok(specialDays(2026, '', { shop: false }).every((d) => d.type === 'feiertag'));
  const range = specialDaysBetween('2026-12-20', '2027-01-07', 'BY');
  assert.deepEqual(
    range.map((d) => d.title),
    ['Heiligabend', '1. Weihnachtstag', '2. Weihnachtstag', 'Silvester', 'Neujahr', 'Heilige Drei Könige'],
  );
  // sortiert, Feiertage vor Aktionstagen am selben Tag
  const all = specialDays(2026, 'NW');
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].date <= all[i].date);
  const may14 = all.filter((d) => d.date === '2026-05-14');
  assert.deepEqual(may14.map((d) => d.type), ['feiertag', 'aktion']);
});

test('App und Server berechnen dieselben Tage (2024–2035, alle Bundesländer)', (t) => {
  const php = fileURLToPath(new URL('../../server/app/src/Holidays.php', import.meta.url));
  const states = ['', ...STATES.map((s) => s.code)];
  let out;
  try {
    out = execFileSync(
      'php',
      [
        '-r',
        `require $argv[1]; $r = []; foreach (json_decode($argv[2]) as $st) { for ($y = 2024; $y <= 2035; $y++) { $r[$st . $y] = PC\\Holidays::year($y, $st); } } echo json_encode($r, JSON_UNESCAPED_UNICODE);`,
        php,
        JSON.stringify(states),
      ],
      { encoding: 'utf8' },
    );
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('php nicht installiert');
    throw e;
  }
  const server = JSON.parse(out);
  for (const st of states) {
    for (let y = 2024; y <= 2035; y++) {
      assert.deepEqual(specialDays(y, st), server[st + y], `${st || 'bundesweit'} ${y}`);
    }
  }
});
