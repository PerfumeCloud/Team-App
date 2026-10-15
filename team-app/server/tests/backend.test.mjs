// Integrationstests für das PHP-Backend (SQLite, PHP-Entwicklungsserver).
// Aufruf: node --test team-app/server/tests/   (PHP 8.1+ und Python 3 nötig)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'pc-test-'));
// PC_PUSH_TEST: Push-Adressen dürfen im Test auf http://127.0.0.1 zeigen (Nachbau des Push-Dienstes)
const env = { ...process.env, PC_CONFIG: join(tmp, 'config.php'), PC_STORAGE: tmp, PC_PUSH_TEST: '1' };
const PORT = 18000 + Math.floor(Math.random() * 1000);
const IMAP_PORT = PORT + 1000;
const SMTP_PORT = PORT + 2000;
const CLOSED_PORT = PORT + 3000;
const base = `http://127.0.0.1:${PORT}/api`;
let php, imap;

// Mails, die der Test-SMTP-Server angenommen hat
const smtpMails = [];
let smtpBuf = '';

// Nachbau eines Push-Dienstes: /ok → 201, /gone → 410, /jwt → 403 {"reason":"BadJwtToken"} (wie Apple)
const pushHits = [];
const pushServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    pushHits.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.url.startsWith('/ok')) {
      res.writeHead(201).end();
    } else if (req.url.startsWith('/gone')) {
      res.writeHead(410).end();
    } else if (req.url.startsWith('/jwt')) {
      res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ reason: 'BadJwtToken' }));
    } else {
      res.writeHead(500).end('kaputt');
    }
  });
});

// Nachbau des Clubs (Kunden-App): /api/internal/… mit X-Club-Key
const CLUB_KEY = 'club-test-schluessel-123';
const clubCalls = [];
const club = { broadcasts: [], denySso: new Set(), fourEyes: true };
const CLUB_LABELS = { draft: 'Entwurf', review: 'Zur Prüfung', approved: 'Freigegeben', sending: 'Wird verschickt', sent: 'Verschickt' };
let clubUrl = '';
const clubServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const path = new URL(req.url, 'http://x').pathname;
    clubCalls.push({ method: req.method, path, body, key: req.headers['x-club-key'] });
    const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (req.headers['x-club-key'] !== CLUB_KEY) return send(403, { error: 'Ungültiger Schlüssel.' });
    const row = (b) => ({ ...b, status_label: CLUB_LABELS[b.status] });
    const route = `${req.method} ${path}`;
    if (route === 'GET /api/internal/ping') return send(200, { ok: true, version: '1.4.0', team_mode: false, app_url: clubUrl, program: 'Perfume Cloud Club' });
    if (route === 'GET /api/internal/stats') {
      return send(200, {
        members: 42, new_7: 3, new_30: 9, active_30: 20,
        joins_by_month: [{ month: '2026-09', count: 5 }, { month: '2026-10', count: 4 }],
        tiers: [{ key: 'bronze', name: 'Bronze', count: 30 }, { key: 'silber', name: 'Silber', count: 10 }, { key: 'gold', name: 'Gold', count: 2 }],
        points: { earned: 12000, earned_30: 3000, redeemed: 4000, redeemed_30: 1000, expired: 200, available: 7800, available_value_cents: 3900, pending: 500, locked: 0 },
        bonus: [], codes: { used: { count: 12, cents: 6000 } }, codes_used_30: { count: 4, cents: 2000 },
        orders: { count: 80, revenue_cents: 640000 }, orders_30: { count: 20, revenue_cents: 160000 },
        push_members: 25, feedback: { gut: 10, neutral: 2, schlecht: 1 }, promotion: null, open_claims: 2, app_url: clubUrl, at: Date.now(),
      });
    }
    if (route === 'POST /api/internal/kick') return send(200, { push: '1 Push-Nachrichten verschickt' });
    if (route === 'POST /api/internal/migrate') return send(200, { ok: true, version: '1.4.0', schema: '1.4.0' });
    if (route === 'POST /api/internal/sso') {
      if (club.denySso.has(body.user?.email)) return send(403, { error: 'Kein Zugriff auf den Club-Admin. Ein Admin der Team-App kann ihn unter „Team“ freischalten.' });
      return send(200, { url: `${clubUrl}/api/admin/sso?t=einmal-${body.user?.id}` });
    }
    if (route === 'GET /api/internal/broadcasts') {
      return send(200, {
        broadcasts: club.broadcasts.map(row),
        templates: [{ key: 'release', label: 'Neuer Duft', kind: 'news', title: 'Neu: {duft}', body: '{vorname}, unser neuer Duft {duft} ist da.', url: '', audience: 'all', fields: { duft: 'Name des Dufts' } }],
        audiences: [{ key: 'all', label: 'Alle Mitglieder', count: 25 }, { key: 'silber', label: 'Silber und Gold', count: 8 }, { key: 'gold', label: 'Nur Gold', count: 2 }],
        four_eyes: club.fourEyes, quiet: { start: 21, end: 8 }, app_url: clubUrl,
      });
    }
    const save = (b) => {
      if (/\{(duft|aktion)\}/.test(`${body.title} ${body.body}`)) return send(422, { error: 'Bitte die Platzhalter in geschweiften Klammern ausfüllen (z. B. {duft}).' });
      Object.assign(b, { kind: body.kind, template: body.template, title: body.title, body: body.body, url: body.url, audience: body.audience, scheduled_at: body.scheduled_at, status: 'draft', review_note: null, updated_at: Date.now() });
      return send(200, row(b));
    };
    if (route === 'POST /api/internal/broadcasts') {
      const b = { id: crypto.randomUUID(), created_by: body.user.id, created_by_name: body.user.name, approved_by_name: null, approved_at: null, sent_at: null, recipients: 0, error: null, created_at: Date.now() };
      club.broadcasts.push(b);
      return save(b);
    }
    const m = path.match(/^\/api\/internal\/broadcasts\/([0-9a-f-]{36})(?:\/(\w+))?$/);
    const b = m && club.broadcasts.find((x) => x.id === m[1]);
    if (!b) return send(404, { error: 'Nachricht nicht gefunden.' });
    const action = req.method === 'POST' ? m[2] : req.method;
    if (action === 'PUT') return save(b);
    if (action === 'submit') b.status = 'review';
    if (action === 'approve') {
      if (club.fourEyes && b.created_by === body.user.id) return send(403, { error: 'Vier-Augen-Prinzip: Eine andere Person muss die Nachricht freigeben.' });
      Object.assign(b, { approved_by_name: body.user.name, approved_at: Date.now() });
      if (b.scheduled_at) b.status = 'approved';
      else Object.assign(b, { status: 'sent', sent_at: Date.now(), recipients: 25, delivered: 24, queued: 0 });
    }
    if (action === 'reject') Object.assign(b, { status: 'draft', review_note: `${body.user.name}: ${body.note}` });
    if (action === 'cancel') b.status = 'draft';
    if (action === 'test') return send(409, { error: `Für ${body.user.email} gibt es im Club kein Gerät mit Mitteilungen.` });
    if (action === 'DELETE') {
      club.broadcasts = club.broadcasts.filter((x) => x !== b);
      return send(200, { ok: true });
    }
    return send(200, row(b));
  });
});

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** Wartet, bis fn etwas liefert (z. B. eine Mail beim Test-SMTP-Server). */
async function eventually(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

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
  imap = spawn('python3', [join(here, 'fake-imap.py'), String(IMAP_PORT), String(SMTP_PORT)]);
  imap.stdout.on('data', (d) => {
    smtpBuf += d.toString();
    const lines = smtpBuf.split('\n');
    smtpBuf = lines.pop();
    for (const l of lines) if (l.startsWith('MAIL ')) smtpMails.push(JSON.parse(l.slice(5)));
  });
  await waitFor(imap, 'ready');
  pushPort = await listen(pushServer);
  clubUrl = `http://127.0.0.1:${await listen(clubServer)}`;
});

after(() => {
  php?.kill();
  imap?.kill();
  pushServer.close();
  clubServer.close();
  rmSync(tmp, { recursive: true, force: true });
});

let pushPort;

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
  // Newsletter + Shopify: gespeichert, aber als automatisch markiert und nie wichtig
  assert.equal(bySubject['Unsere Herbst-Angebote'].auto, 1);
  assert.equal(bySubject['Unsere Herbst-Angebote'].important, 0);
  const shop = out.emails.find((e) => (e.subject ?? '').includes('#1043'));
  assert.ok(!shop || (shop.auto === 1 && shop.important === 0));
  assert.ok(out.emails.filter((e) => !e.auto).every((e) => e.subject !== 'Unsere Herbst-Angebote'));
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

test('Persönliche Postfächer: nur wer darf, sieht Mails und bekommt Push', async () => {
  const me = (await admin.req('GET', '/me')).data.user;
  const empty = await kim.req('GET', '/me/mailbox');
  assert.equal(empty.data.mailbox, null);

  // Selbst eintragen (der Verbindungstest darf hier scheitern – der Test-Server spricht kein SSL)
  const noPw = await kim.req('PUT', '/me/mailbox', { email: 'kim@perfumecloud.de', host: '127.0.0.1', port: IMAP_PORT });
  assert.equal(noPw.status, 422);
  const k = await kim.req('PUT', '/me/mailbox', { email: 'Kim@PerfumeCloud.de', host: '127.0.0.1', port: IMAP_PORT, password: 'secret' });
  assert.equal(k.status, 200, JSON.stringify(k.data));
  assert.equal(k.data.mailbox.email, 'kim@perfumecloud.de');
  assert.equal(k.data.mailbox.hasPassword, true);
  assert.equal(k.data.mailbox.password, undefined);
  const m = await admin.req('PUT', '/me/mailbox', { email: 'marius.heub@perfumecloud.de', host: '127.0.0.1', port: IMAP_PORT, password: 'secret' });
  assert.equal(m.status, 200);
  // Fremdes oder Team-Postfach geht nicht
  assert.equal((await admin.req('PUT', '/me/mailbox', { email: 'kim@perfumecloud.de', host: 'x', password: 'y' })).status, 422);
  assert.equal((await admin.req('PUT', '/me/mailbox', { email: 'support@perfumecloud.de', host: 'x', password: 'y' })).status, 422);
  // Admin sieht alle Konten mit „Sichtbar für“ – aber keine Passwörter
  const integ = await admin.req('GET', '/admin/integrations');
  assert.deepEqual(
    integ.data.mailboxes.map((x) => [x.email, x.visible_to]),
    [['support@perfumecloud.de', []], ['kim@perfumecloud.de', [kimId]], ['marius.heub@perfumecloud.de', [me.id]]],
  );
  assert.ok(integ.data.mailboxes.every((x) => x.password === undefined && x.hasPassword === true));

  const out = helper('personal-run', String(IMAP_PORT));
  const kimMails = out.emails.filter((e) => e.mailbox === 'kim@perfumecloud.de');
  const myMails = out.emails.filter((e) => e.mailbox === 'marius.heub@perfumecloud.de');
  assert.ok(kimMails.length > 0 && myMails.length > 0, JSON.stringify(out.summary));
  // Newsletter werden jetzt mitgespeichert, aber als automatisch markiert und nie wichtig
  const news = out.emails.filter((e) => e.subject === 'Unsere Herbst-Angebote');
  assert.ok(news.length > 0 && news.every((e) => e.auto === 1 && e.important === 0));

  // Sync: jeder sieht Team-Mails + nur die eigenen
  const ks = await kim.req('GET', '/sync?since=0');
  assert.ok(ks.data.emails.some((e) => e.mailbox === 'kim@perfumecloud.de'));
  assert.ok(ks.data.emails.some((e) => e.mailbox === 'support@perfumecloud.de' && e.visible_to.length === 0));
  assert.equal(ks.data.emails.filter((e) => e.mailbox === 'marius.heub@perfumecloud.de').length, 0);
  assert.deepEqual(ks.data.meta.mailboxes, ['support@perfumecloud.de', 'kim@perfumecloud.de']);
  assert.equal(ks.data.meta.myMailbox, 'kim@perfumecloud.de');
  const ms = await admin.req('GET', '/sync?since=0');
  assert.equal(ms.data.emails.filter((e) => e.mailbox === 'kim@perfumecloud.de').length, 0);

  // Fremde private Mail: nicht änderbar; eigene private Mail: nicht an Unberechtigte weitergeben
  assert.equal((await kim.req('PATCH', `/emails/${myMails[0].id}`, { status: 'done' })).status, 404);
  assert.equal((await admin.req('PATCH', `/emails/${myMails[0].id}`, { assignee_id: kimId })).status, 422);
  const done = await admin.req('PATCH', `/emails/${myMails[0].id}`, { status: 'done' });
  assert.equal(done.status, 200);
  const activity = (await kim.req('GET', '/sync?since=0')).data.activity;
  assert.equal(activity.some((a) => a.entity_id === myMails[0].id), false, 'private Mail taucht nicht im Team-Verlauf auf');

  // Push: nur Mails aus sichtbaren Postfächern, ohne Newsletter (Standard)
  const plan = out.plan;
  assert.ok((plan[kimId] ?? []).length > 0 && (plan[me.id] ?? []).length > 0);
  assert.ok(plan[kimId].every((x) => ['support@perfumecloud.de', 'kim@perfumecloud.de'].includes(x.mailbox)));
  assert.ok(plan[me.id].every((x) => ['support@perfumecloud.de', 'marius.heub@perfumecloud.de'].includes(x.mailbox)));
  assert.ok(plan[kimId].every((x) => x.auto === 0 && x.seen === 0));

  // „Wirklich alle“: auch Newsletter und gelesene Mails
  await kim.req('PUT', '/me', { prefs: { mailScope: 'everything' } });
  const all = helper('personal-run', String(IMAP_PORT)).plan[kimId];
  assert.ok(all.some((x) => x.auto === 1), 'Newsletter dabei');
  assert.ok(all.some((x) => x.seen === 1), 'gelesene dabei');
  assert.ok(all.length > plan[kimId].length);
  const pref = await kim.req('PUT', '/me', { prefs: { mailScope: 'important' } });
  assert.equal(pref.data.prefs.mailScope, 'important');
  assert.ok(helper('personal-run', String(IMAP_PORT)).plan[kimId].every((x) => x.auto === 0));

  // Widget zeigt keine fremden privaten Mails
  const { data: tok } = await kim.req('POST', '/widget/token');
  const w = await new Client().req('GET', `/widget?token=${encodeURIComponent(tok.token)}`);
  assert.equal(w.data.mails.some((x) => x.mailbox === 'marius.heub@'), false);
  await kim.req('DELETE', '/widget/token');

  // Admin gibt sein Postfach zusätzlich für Kim frei → Kim bekommt die Mails beim nächsten Abgleich
  const cursor = (await kim.req('GET', '/sync?since=0')).data.serverTime;
  const boxes = integ.data.mailboxes.map(({ status, hasPassword, ...b }) => b);
  boxes[2].visible_to = [me.id, kimId];
  const saved = await admin.req('PUT', '/admin/mailboxes', { mailboxes: boxes });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const inc = await kim.req('GET', `/sync?since=${cursor}`);
  assert.ok(inc.data.emails.some((e) => e.mailbox === 'marius.heub@perfumecloud.de'));
  assert.ok(inc.data.meta.mailboxes.includes('marius.heub@perfumecloud.de'));
  // … und jetzt darf die Mail Kim auch zugewiesen werden
  assert.equal((await admin.req('PATCH', `/emails/${myMails[1].id}`, { assignee_id: kimId })).status, 200);

  // Entfernen: Postfach weg, Mails ausgeblendet
  const del = await kim.req('DELETE', '/me/mailbox');
  assert.equal(del.data.mailbox, null);
  const after = await kim.req('GET', '/sync?since=0');
  assert.equal(after.data.emails.filter((e) => e.mailbox === 'kim@perfumecloud.de').length, 0);
  assert.equal(after.data.meta.myMailbox, null);
});

test('Kalender: Termine, Einladung, Erinnerung, Abo-Link, Widget', async () => {
  const me = (await admin.req('GET', '/me')).data.user;
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const id = crypto.randomUUID();
  assert.equal((await kim.req('PUT', `/events/${id}`, { title: '', start_date: tomorrow })).status, 422);
  assert.equal((await kim.req('PUT', `/events/${id}`, { title: 'X', start_date: '2026-02-30' })).status, 422);
  const r = await kim.req('PUT', `/events/${id}`, {
    title: 'Meeting Lieferant', kind: 'meeting', start_date: tomorrow, start_time: '14:00', end_time: '15:00',
    location: 'Düsseldorf, Halle 3', attendees: [me.id, 'gibtsnicht'], remind_minutes: 60, notes: 'Preise; Flakons',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.attendees, [me.id]);
  assert.equal(r.data.end_time, '15:00');
  // Endzeit vor Start wird verworfen
  const id2 = crypto.randomUUID();
  const bad = await admin.req('PUT', `/events/${id2}`, { title: 'Messe', start_date: tomorrow, end_date: tomorrow, start_time: '10:00', end_time: '09:00' });
  assert.equal(bad.data.end_time, null);
  const allday = await admin.req('PUT', `/events/${id2}`, { title: 'Messe Beauty', kind: 'event', start_date: tomorrow, end_date: tomorrow, start_time: null });
  assert.equal(allday.data.start_time, null);
  assert.equal(allday.data.end_date, null);

  const s = await admin.req('GET', '/sync?since=0');
  assert.ok(s.data.events.some((e) => e.id === id && e.title === 'Meeting Lieferant'));
  assert.ok(s.data.activity.some((a) => a.entity_id === id));

  // Erinnerung: 2 Std. vorher noch nicht, 59 Min. vorher ja
  assert.equal(helper('event-remind', id, '-120').reminded, false);
  assert.equal(helper('event-remind', id, '-59').reminded, true);

  // Abo-Link (iCalendar)
  assert.equal((await kim.req('GET', '/kalender/abo')).data.active, false);
  const abo = await kim.req('POST', '/kalender/abo');
  assert.match(abo.data.webcal, /^webcal:\/\/.+\/api\/kalender\/feed\?token=pck_/);
  const feed = await fetch(`${base}/kalender/feed?token=${abo.data.token}`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  const ics = await feed.text();
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Meeting Lieferant\r\n/);
  assert.match(ics, /LOCATION:Düsseldorf\\, Halle 3\r\n/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:\d{8}\r\n/);
  assert.match(ics, /TRIGGER:-PT60M/);
  // Aktionstage fürs nächste Jahr stehen automatisch im Abo (Feiertage hat jedes Handy selbst)
  assert.match(ics, /SUMMARY:🛍 Black Friday\r\n/);
  assert.doesNotMatch(ics, /SUMMARY:Neujahr/);
  assert.equal((await fetch(`${base}/kalender/feed?token=pck_falsch`)).status, 401);
  await kim.req('DELETE', '/kalender/abo');
  assert.equal((await fetch(`${base}/kalender/feed?token=${abo.data.token}`)).status, 401);

  // Widget: nur Termine, bei denen man dabei ist (oder fürs ganze Team)
  const { data: wa } = await admin.req('POST', '/widget/token');
  const wAdmin = await new Client().req('GET', `/widget?token=${encodeURIComponent(wa.token)}`);
  assert.ok(wAdmin.data.events.some((e) => e.title === 'Meeting Lieferant' && e.start === '14:00'));
  const { data: wk } = await kim.req('POST', '/widget/token');
  const wKim = await new Client().req('GET', `/widget?token=${encodeURIComponent(wk.token)}`);
  assert.equal(wKim.data.events.some((e) => e.title === 'Meeting Lieferant'), false);
  assert.ok(wKim.data.events.some((e) => e.title === 'Messe Beauty'));
  await admin.req('DELETE', '/widget/token');
  await kim.req('DELETE', '/widget/token');

  // Feiertage: Bundesland und Schalter (nur Admin)
  assert.equal((await kim.req('PUT', '/admin/settings', { holiday_state: 'NW' })).status, 403);
  let integ = await admin.req('PUT', '/admin/settings', { holiday_state: 'NW', shop_days_on: false });
  assert.equal(integ.data.settings.holiday_state, 'NW');
  assert.equal(integ.data.settings.holidays_on, true);
  assert.equal(integ.data.settings.shop_days_on, false);
  const m = (await kim.req('GET', '/sync?since=0')).data.meta;
  assert.equal(m.holidayState, 'NW');
  assert.equal(m.shopDays, false);
  integ = await admin.req('PUT', '/admin/settings', { holiday_state: 'XX', shop_days_on: true });
  assert.equal(integ.data.settings.holiday_state, '');
  assert.equal(integ.data.settings.shop_days_on, true);

  // Löschen wird synchronisiert
  const cursor = s.data.serverTime;
  await kim.req('DELETE', `/events/${id}`);
  const inc = await admin.req('GET', `/sync?since=${cursor}`);
  assert.equal(inc.data.events.find((e) => e.id === id)?.deleted, 1);
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

test('Team: Einladung per Link, löschen und wieder anlegen, Wartung', async () => {
  // Anlegen ohne Passwort nur mit Einladung
  assert.equal((await admin.req('POST', '/admin/users', { name: 'Ben', email: 'ben@example.de' })).status, 422);
  const r = await admin.req('POST', '/admin/users', { name: 'Ben', email: 'Ben@Example.de', invite: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.restored, false);
  // Kein echter Mailserver im Test → nicht verschickt, aber Link zum Weitergeben
  assert.equal(r.data.invite.sent, false);
  const token = new URL(r.data.invite.link).searchParams.get('einladung');
  assert.match(token, /^pci_/);
  const benId = r.data.user.id;

  // Doppelt anlegen geht nicht, solange die Person aktiv ist
  const dup = await admin.req('POST', '/admin/users', { name: 'Ben', email: 'ben@example.de', password: 'irgendwas1' });
  assert.equal(dup.status, 422);
  assert.match(dup.data.error, /gehört schon zu Ben/);

  // Einladung annehmen
  const ben = new Client();
  assert.equal((await ben.req('GET', '/auth/invite?token=pci_falsch')).status, 404);
  const info = await ben.req('GET', `/auth/invite?token=${token}`);
  assert.deepEqual(info.data, { name: 'Ben', email: 'ben@example.de' });
  assert.equal((await ben.req('POST', '/auth/invite', { token, password: 'kurz' })).status, 422);
  const acc = await ben.req('POST', '/auth/invite', { token, password: 'benspasswort1' });
  assert.equal(acc.status, 200);
  assert.equal((await ben.req('GET', '/me')).data.user.name, 'Ben');
  assert.equal((await new Client().req('GET', `/auth/invite?token=${token}`)).status, 404, 'Link nur einmal gültig');

  // Neue Einladung erzeugt neuen Link
  const again = await admin.req('POST', `/admin/users/${benId}/invite`);
  assert.equal(again.status, 200);
  assert.notEqual(new URL(again.data.link).searchParams.get('einladung'), token);

  // Löschen und mit derselben E-Mail wieder anlegen → wiederhergestellt statt Fehler
  await admin.req('DELETE', `/admin/users/${benId}`);
  assert.equal((await ben.req('GET', '/me')).status, 401, 'Abgemeldet nach dem Entfernen');
  const back = await admin.req('POST', '/admin/users', { name: 'Ben B.', email: 'ben@example.de', password: 'neuesstart1' });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(back.data.restored, true);
  assert.equal(back.data.user.id, benId);
  assert.equal((await new Client().req('POST', '/auth/login', { email: 'ben@example.de', password: 'neuesstart1' })).status, 200);

  // Wartung: Diagnose, Datenbank aktualisieren, Wiederherstellen
  const diag = await admin.req('GET', '/admin/maintenance');
  assert.equal(diag.status, 200);
  assert.ok(diag.data.people.some((p) => p.name === 'Ben B.' && p.deleted === 0));
  assert.equal((await kim.req('GET', '/admin/maintenance')).status, 403);
  const epoch0 = (await admin.req('GET', '/sync?since=0')).data.meta.syncEpoch;
  const fix = await admin.req('POST', '/admin/maintenance');
  assert.equal(fix.status, 200, JSON.stringify(fix.data));
  assert.ok(fix.data.log.length >= 2);
  const epoch1 = (await admin.req('GET', '/sync?since=0')).data.meta.syncEpoch;
  assert.ok(epoch1 > epoch0);
  await admin.req('DELETE', `/admin/users/${benId}`);
  const res = await admin.req('POST', `/admin/users/${benId}/restore`);
  assert.equal(res.data.user.name, 'Ben B.');
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
