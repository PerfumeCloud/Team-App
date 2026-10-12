// Integrationstests für das PHP-Backend (SQLite, PHP-Entwicklungsserver).
// Aufruf: node --test team-app/server/tests/   (PHP 8.1+ und Python 3 nötig)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'pc-test-'));
const env = { ...process.env, PC_CONFIG: join(tmp, 'config.php'), PC_STORAGE: tmp };
const PORT = 18000 + Math.floor(Math.random() * 1000);
const IMAP_PORT = PORT + 1000;
const base = `http://127.0.0.1:${PORT}/api`;
let php, imap;

function waitFor(proc, text) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout beim Start')), 8000);
    const onData = (d) => { if (d.toString().includes(text)) { clearTimeout(t); resolve(); } };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
  });
}

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { 'X-PC': '1' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
}

const helper = (...args) => JSON.parse(execFileSync('php', [join(here, 'helper.php'), ...args], { env }).toString());

before(async () => {
  php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', join(serverDir, 'public'), join(serverDir, 'public/router.php')], { env });
  await waitFor(php, 'Development Server');
  imap = spawn('python3', [join(here, 'fake-imap.py'), String(IMAP_PORT)]);
  await waitFor(imap, 'ready');
});

after(() => {
  php?.kill();
  imap?.kill();
  rmSync(tmp, { recursive: true, force: true });
});

const admin = new Client();
const kim = new Client();
let kimId;

test('Status vor der Einrichtung', async () => {
  const r = await admin.req('GET', '/status');
  assert.equal(r.status, 200);
  assert.equal(r.data.installed, false);
  assert.equal(r.data.requirements.php.ok, true);
});

test('Einrichtung ohne Schutz-Header wird abgelehnt', async () => {
  const r = await admin.req('POST', '/setup', { db: { driver: 'sqlite' } }, { 'X-PC': '' });
  assert.equal(r.status, 403);
});

test('Einrichtung mit SQLite und Admin-Konto', async () => {
  const bad = await admin.req('POST', '/setup', { db: { driver: 'sqlite' }, admin: { name: 'Marius', email: 'marius@example.de', password: 'kurz' } });
  assert.equal(bad.status, 422);
  const r = await admin.req('POST', '/setup', { db: { driver: 'sqlite' }, admin: { name: 'Marius', email: 'Marius@Example.de', password: 'geheim1234' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.email, 'marius@example.de');
  const again = await new Client().req('POST', '/setup', { db: { driver: 'sqlite' }, admin: { name: 'X', email: 'x@example.de', password: 'geheim1234' } });
  assert.equal(again.status, 409);
});

test('Admin legt Teammitglieder an', async () => {
  const r = await admin.req('POST', '/admin/users', { name: 'Kim', email: 'kim@example.de', password: 'kimkimkim1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  kimId = r.data.user.id;
  const dup = await admin.req('POST', '/admin/users', { name: 'Kim2', email: 'kim@example.de', password: 'kimkimkim1' });
  assert.equal(dup.status, 422);
});

test('Login, falsches Passwort, Mitglied ist kein Admin', async () => {
  const wrong = await kim.req('POST', '/auth/login', { email: 'kim@example.de', password: 'falsch123' });
  assert.equal(wrong.status, 401);
  const r = await kim.req('POST', '/auth/login', { email: 'kim@example.de', password: 'kimkimkim1' });
  assert.equal(r.status, 200);
  const forbidden = await kim.req('GET', '/admin/integrations');
  assert.equal(forbidden.status, 403);
  const anon = await new Client().req('GET', '/sync');
  assert.equal(anon.status, 401);
});

test('Aufgaben synchronisieren zwischen Geräten', async () => {
  const full = await kim.req('GET', '/sync?since=0');
  assert.equal(full.status, 200);
  assert.equal(full.data.users.length, 2);
  const cursor = full.data.serverTime;

  const id = crypto.randomUUID();
  const save = await admin.req('PUT', `/tasks/${id}`, {
    title: 'Herbst-Kampagne planen', status: 'todo', priority: 'high', assignee_id: kimId,
    due_date: '2026-10-20', category: 'Marketing', checklist: [{ id: 'a', text: 'Fotos', done: false }],
  });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal(save.data.created_by, save.data.updated_by);
  assert.equal(save.data.checklist.length, 1);

  const inc = await kim.req('GET', `/sync?since=${cursor}`);
  const t = inc.data.tasks.find((x) => x.id === id);
  assert.ok(t, 'Aufgabe kommt beim anderen Gerät an');
  assert.equal(t.assignee_id, kimId);
  assert.ok(inc.data.activity.some((a) => a.entity_id === id));

  const done = await kim.req('PUT', `/tasks/${id}`, { ...t, status: 'done' });
  assert.equal(done.data.status, 'done');
  assert.ok(done.data.completed_at > 0);
  assert.ok(done.data.updated_at > t.updated_at);

  const c = await kim.req('PUT', `/comments/${crypto.randomUUID()}`, { task_id: id, body: 'Erledigt ✓' });
  assert.equal(c.status, 200);
  const foreign = await admin.req('DELETE', `/comments/${c.data.id}`);
  assert.equal(foreign.status, 403);

  const del = await admin.req('DELETE', `/tasks/${id}`);
  assert.equal(del.status, 200);
  const after = await kim.req('GET', `/sync?since=${cursor}`);
  assert.equal(after.data.tasks.find((x) => x.id === id).deleted, 1);
  const fresh = await kim.req('GET', '/sync?since=0');
  assert.equal(fresh.data.tasks.find((x) => x.id === id), undefined);
});

test('Ungültige Eingaben', async () => {
  const r = await admin.req('PUT', '/tasks/not-a-uuid', { title: 'x' });
  assert.equal(r.status, 404);
  const empty = await admin.req('PUT', `/tasks/${crypto.randomUUID()}`, { title: '   ' });
  assert.equal(empty.status, 422);
  const t = await admin.req('PUT', `/tasks/${crypto.randomUUID()}`, { title: 'Test', status: 'quatsch', priority: 'x', due_date: 'morgen', assignee_id: 'unbekannt' });
  assert.equal(t.data.status, 'todo');
  assert.equal(t.data.priority, 'normal');
  assert.equal(t.data.due_date, null);
  assert.equal(t.data.assignee_id, null);
});

test('Notizen', async () => {
  const id = crypto.randomUUID();
  const r = await kim.req('PUT', `/notes/${id}`, { title: 'Ideen Weihnachten', body: '- Geschenkset\n- Proben', pinned: true, color: 'sage' });
  assert.equal(r.status, 200);
  assert.equal(r.data.pinned, 1);
  assert.equal(r.data.color, 'sage');
  const s = await admin.req('GET', '/sync?since=0');
  assert.ok(s.data.notes.some((n) => n.id === id));
});

test('Eigenes Profil und Passwort ändern', async () => {
  const r = await kim.req('PUT', '/me', { name: 'Kim K.', color: 'rose', prefs: { push: { orders: false } } });
  assert.equal(r.data.user.name, 'Kim K.');
  assert.equal(r.data.prefs.push.orders, false);
  assert.equal(r.data.prefs.push.mail, true);
  const wrong = await kim.req('PUT', '/me', { currentPassword: 'nein', newPassword: 'neuespasswort' });
  assert.equal(wrong.status, 422);
});

test('Mail-Abruf erkennt wichtige offene Mails', async () => {
  const out = helper('mail', String(IMAP_PORT));
  assert.equal(out.status.ok, true, JSON.stringify(out));
  const bySubject = Object.fromEntries(out.emails.map((e) => [e.subject, e]));
  // ignoriert: Newsletter + Shopify
  assert.equal(bySubject['Unsere Herbst-Angebote'], undefined);
  assert.equal(Object.keys(bySubject).some((s) => s.includes('#1043')), false);
  // Kundin mit kodiertem Betreff + Absender
  const j = bySubject['Wo bleibt meine Bestellung #1042?'];
  assert.ok(j, 'Betreff dekodiert: ' + Object.keys(bySubject).join(' | '));
  assert.equal(j.from_name, 'Jürgen Müller');
  assert.equal(j.important, 1);
  assert.ok(j.reasons.includes('Kundenanliegen'));
  assert.ok(j.reasons.includes('Ungelesen'));
  assert.match(j.snippet, /Könnt ihr nachsehen\?$/);
  // beantwortet per Flag bzw. Gesendet-Ordner
  assert.equal(bySubject['Kooperation?'].answered, 1);
  assert.equal(bySubject['Kooperation?'].important, 0);
  assert.equal(bySubject['Retoure'].answered, 1);
  assert.equal(bySubject['Retoure'].important, 0);
  // markiert + multipart/base64
  const c = bySubject['Fotoshooting nächste Woche'];
  assert.equal(c.from_name, 'Carla, Studio');
  assert.ok(c.reasons.includes('Markiert'));
  assert.equal(c.snippet, 'Hallo, passt euch Dienstag um 10 Uhr?');
  // alt + HTML + ISO-8859-1
  const d = bySubject['Kurze Rückmeldung'];
  assert.ok(d.reasons.includes('Über 24 Std. offen'));
  assert.equal(d.snippet, 'Schöne Grüße');

  // App-Status bleibt beim erneuten Abruf erhalten
  const r = await admin.req('PATCH', `/emails/${j.id}`, { status: 'done', assignee_id: kimId });
  assert.equal(r.data.status, 'done');
  const again = helper('mail', String(IMAP_PORT));
  assert.equal(again.emails.find((e) => e.id === j.id).status, 'done');
  assert.equal(again.emails.find((e) => e.id === j.id).assignee_id, kimId);
});

test('Falsches Mail-Passwort wird gemeldet', () => {
  const out = helper('mail', String(IMAP_PORT), 'falsch');
  assert.equal(out.status.ok, false);
  assert.match(out.status.message, /Anmeldung am Postfach fehlgeschlagen/);
});

test('Statistik aus Bestellungen', () => {
  const s = helper('seed-orders', '30');
  assert.equal(s.days, 30);
  assert.equal(s.series.length, 30);
  assert.ok(s.current.orders > 0);
  assert.ok(s.previous.orders > 0);
  assert.equal(s.current.aov, Math.round(s.current.revenue / s.current.orders));
  assert.equal(s.toShip.count, 3);
  assert.equal(s.topProducts.length, 3);
  const sumSeries = s.series.reduce((a, d) => a + d.revenue, 0);
  assert.equal(sumSeries, s.current.revenue);
});

test('Web-Push-Verschlüsselung (RFC 8291) und VAPID-Signatur', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const b64u = (b) => b.toString('base64url');
  const payload = JSON.stringify({ title: 'Neue Bestellung #1042', body: '49,90 € · Noire Eclat', url: '/statistik' });
  const out = helper('push-encrypt', b64u(ua.getPublicKey()), b64u(auth), payload);

  const body = Buffer.from(out.body, 'base64');
  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096);
  const idlen = body[20];
  const keyid = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(keyid);
  const hkdf = (salt_, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt_, info, len));
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), keyid]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dec.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(plain.subarray(0, -1).toString(), payload);

  const [h, c, sig] = out.jwt.split('.');
  const pub = Buffer.from(out.pub, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  assert.ok(ok, 'JWT-Signatur gültig');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claims.aud, 'https://push.example.com');
});

test('Push-Abo speichern und Schlüssel abrufen', async () => {
  const k = await kim.req('GET', '/push/key');
  assert.equal(Buffer.from(k.data.publicKey, 'base64url').length, 65);
  const bad = await kim.req('POST', '/push/subscribe', { endpoint: 'http://unsicher', keys: {} });
  assert.equal(bad.status, 422);
  const ok = await kim.req('POST', '/push/subscribe', { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'x', auth: 'y' } });
  assert.equal(ok.status, 200);
});

test('iPhone-Widget: Schlüssel, Zusammenfassung, Sperren', async () => {
  const none = await new Client().req('GET', '/widget?token=pcw_falsch');
  assert.equal(none.status, 401);
  const status0 = await kim.req('GET', '/widget/status');
  assert.equal(status0.data.active, false);
  const { data } = await kim.req('POST', '/widget/token');
  assert.match(data.token, /^pcw_/);
  const w = await new Client().req('GET', `/widget?token=${encodeURIComponent(data.token)}`);
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.equal(w.data.name, 'Kim');
  assert.equal(typeof w.data.tasks.open, 'number');
  assert.ok(Array.isArray(w.data.mails));
  assert.ok(w.data.today === null || typeof w.data.today.revenue === 'number');
  // neuer Schlüssel ersetzt den alten
  const second = await kim.req('POST', '/widget/token');
  assert.equal((await new Client().req('GET', `/widget?token=${encodeURIComponent(data.token)}`)).status, 401);
  assert.equal((await new Client().req('GET', `/widget?token=${encodeURIComponent(second.data.token)}`)).status, 200);
  await kim.req('DELETE', '/widget/token');
  assert.equal((await new Client().req('GET', `/widget?token=${encodeURIComponent(second.data.token)}`)).status, 401);
});

test('Cron-URL nur mit Schlüssel', async () => {
  const r = await new Client().req('GET', '/cron?key=falsch');
  assert.equal(r.status, 403);
  const integ = await admin.req('GET', '/admin/integrations');
  const url = new URL(integ.data.cron.url);
  const ok = await new Client().req('GET', `/cron?key=${url.searchParams.get('key')}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.trigger, 'cron');
});

test('Shopify-Domain wird geprüft', async () => {
  const r = await admin.req('PUT', '/admin/shopify', { shop: 'www.perfumecloud.de', client_id: 'abc', client_secret: 'x' });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /myshopify/);
});

test('Login-Sperre nach zu vielen Versuchen', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 9; i++) last = await c.req('POST', '/auth/login', { email: 'kim@example.de', password: 'falsch' + i });
  assert.equal(last.status, 429);
});

test('Abmelden', async () => {
  await admin.req('POST', '/auth/logout');
  const r = await admin.req('GET', '/me');
  assert.equal(r.status, 401);
});
