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
// Schreibzugriffe auf den Test-IMAP-Server (Kopie in „Gesendet“, Markierungen)
const imapEvents = [];
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
const club = { broadcasts: [], denySso: new Set(), fourEyes: true, alerts: [], trial: null };
const TRIAL_STEPS = ['ordered', 'pending', 'shipped', 'delivered', 'survey', 'credited', 'referral', 'tier'];
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
    if (route === 'GET /api/internal/widget') {
      return send(200, {
        members: 42, new_today: 1, new_7: 3,
        tiers: [{ key: 'bronze', name: 'Bronze', count: 30 }, { key: 'silber', name: 'Silber', count: 10 }, { key: 'gold', name: 'Gold', count: 2 }],
        recent: [{ name: 'Anna B.', tier: 'bronze', at: Date.now() }],
        survey: { avg: 4.5, count: 4, low: 0 }, promotion: null,
      });
    }
    if (route === 'POST /api/internal/kick') return send(200, { push: '1 Push-Nachrichten verschickt' });
    if (route === 'POST /api/internal/alerts/claim') return send(200, { alerts: club.alerts.splice(0) });
    // Probelauf (vereinfacht): Zustand im Speicher
    const trialView = () => club.trial ?? { active: false, amount_cents: 5900, steps: TRIAL_STEPS.map((key) => ({ key, label: key, done: false })) };
    if (route === 'GET /api/internal/trial') return send(200, trialView());
    if (route === 'POST /api/internal/trial/start') {
      if (club.trial) return send(409, { error: 'Es läuft schon ein Probelauf. Bitte erst aufräumen.' });
      club.trial = { active: true, mode: body.mode, by: body.user, amount_cents: body.amount_cents, codes: body.mode === 'real' ? ['PROBE-AB12C', 'PROBE-AB12C-VERSAND'] : [], order: null, device_member: false, steps: TRIAL_STEPS.map((key) => ({ key, label: key, done: false })) };
      return send(200, club.trial);
    }
    if (route === 'POST /api/internal/trial/step') {
      if (!club.trial) return send(404, { error: 'Es läuft kein Probelauf.' });
      if (club.trial.mode === 'real' && ['ordered', 'pending', 'shipped'].includes(body.step)) return send(409, { error: 'Die echte Testbestellung bitte in der Team-App unter „Versand“ als versendet markieren.' });
      club.trial.steps.find((x) => x.key === body.step).done = true;
      return send(200, club.trial);
    }
    if (route === 'POST /api/internal/trial/sync') {
      if (club.trial?.mode === 'real') {
        club.trial.order = { id: 'gid://shopify/Order/9001', name: '#9001', real: true };
        club.alerts.push({ id: 'a-test', kind: 'low_rating', test: true, created_at: Date.now(), payload: { survey_id: 's-test', order_id: 'gid://shopify/Order/9001', order_name: '#9001', email: 'probelauf+ab12@club.invalid', name: 'Probelauf', member: true, tier: 'Bronze', stars: 1, avg: 1, items: [{ title: 'Sunset Dune', stars: 1 }], questions: [], comment: null } });
      }
      return send(200, trialView());
    }
    if (route === 'POST /api/internal/trial/cleanup') {
      const order = club.trial?.order?.real ? { id: club.trial.order.id, name: club.trial.order.name } : null;
      club.trial = null;
      return send(200, { ok: true, order, message: 'Testkonto, Punkte, Befragung und Codes sind gelöscht.' });
    }
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

/** Text einer Mail (alle base64-Teile dekodiert). */
function mailText(data) {
  return data
    .split(/\r?\n\r?\n/)
    .map((part) => part.replace(/\r?\n--pc[\s\S]*$/, '').replace(/\s/g, ''))
    .filter((part) => /^[A-Za-z0-9+/=]+$/.test(part))
    .map((part) => Buffer.from(part, 'base64').toString())
    .join('\n');
}

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
    for (const l of lines) {
      if (l.startsWith('MAIL ')) smtpMails.push(JSON.parse(l.slice(5)));
      else if (l.startsWith('APPENDED ') || l.startsWith('STORED ')) imapEvents.push({ kind: l.split(' ')[0], ...JSON.parse(l.slice(l.indexOf(' ') + 1)) });
    }
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

test('Datenbank-Aktualisierung 1.3 läuft mehrfach ohne Fehler', () => {
  const r = helper('migrate');
  assert.ok(r.users.includes('club_access'));
  assert.ok(r.push.includes('last_status') && r.push.includes('last_error'));
});

test('Push-Test: Ergebnis je Gerät, abgemeldete Geräte weg, Fehler bleiben sichtbar', async () => {
  // Gerät aus dem älteren Test (ohne echte Schlüssel) entfernen
  const old = crypto.createHash('sha256').update('https://web.push.apple.com/abc').digest('hex');
  assert.equal((await kim.req('DELETE', `/push/devices/${old}`)).status, 200);
  // Unsichere Adressen außerhalb des Tests bleiben verboten
  assert.equal((await kim.req('POST', '/push/subscribe', { endpoint: 'http://example.com/x', keys: { p256dh: 'x', auth: 'y' } })).status, 422);

  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const sub = async (path) => {
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    const r = await kim.req('POST', '/push/subscribe', { endpoint: `http://127.0.0.1:${pushPort}${path}`, keys }, { 'User-Agent': iphone });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.id;
  };
  const okId = await sub('/ok/1');
  await sub('/gone/1');
  const jwtId = await sub('/jwt/1');
  // Ungültige Kontaktadresse wird nicht an den Push-Dienst geschickt (Apple: BadJwtToken)
  helper('setting', 'push_contact', JSON.stringify('keine-adresse'));

  const t = await kim.req('POST', '/push/test');
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(t.data.devices, 3);
  assert.equal(t.data.sent, 1);
  const by = Object.fromEntries(t.data.results.map((x) => [x.id, x]));
  assert.equal(by[okId].ok, true);
  assert.equal(by[okId].device, 'iPhone Safari');
  assert.equal(by[jwtId].ok, false);
  assert.equal(by[jwtId].status, 403);
  assert.equal(by[jwtId].reason, 'BadJwtToken');
  assert.ok(t.data.results.some((x) => x.reason === 'Gerät abgemeldet'));

  // Anfrage an den Push-Dienst: verschlüsselt, mit VAPID und gültiger mailto-Adresse
  const hit = pushHits.find((h) => h.path === '/ok/1');
  assert.equal(hit.headers['content-encoding'], 'aes128gcm');
  assert.ok(Number(hit.headers.ttl) > 0);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(hit.headers.authorization);
  assert.ok(m, hit.headers.authorization);
  const claims = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, 'mailto:kim@example.de');
  assert.equal(claims.aud, `http://127.0.0.1:${pushPort}`);
  assert.ok(claims.exp > Date.now() / 1000);

  // Geräteliste: abgemeldetes Gerät entfernt, 403 bleibt mit Grund stehen
  const d = await kim.req('GET', '/push/devices');
  assert.equal(d.data.devices.length, 2);
  const jwt = d.data.devices.find((x) => x.id === jwtId);
  assert.equal(jwt.last_status, 403);
  assert.equal(jwt.last_error, 'BadJwtToken');
  assert.equal(jwt.fail_count, 1);
  assert.ok(d.data.devices.find((x) => x.id === okId).last_ok_at > 0);

  // Admin sieht den Fehler in der Diagnose
  const diag = await admin.req('GET', '/admin/maintenance');
  assert.equal(diag.data.people.find((p) => p.id === kimId).pushError, 'BadJwtToken');

  // Gerät entfernen – nur eigene
  assert.equal((await admin.req('DELETE', `/push/devices/${jwtId}`)).data.devices.length, 0);
  assert.equal((await kim.req('GET', '/push/devices')).data.devices.length, 2);
  const del = await kim.req('DELETE', `/push/devices/${jwtId}`);
  assert.deepEqual(del.data.devices.map((x) => x.id), [okId]);
  helper('setting', 'push_contact', 'null');
});

test('Postfach prüfen: Schritt für Schritt, Testmail per SMTP, verständliche Hinweise', async () => {
  helper('mail', String(IMAP_PORT)); // Team-Postfach support@ mit richtigem Passwort
  helper('setting', 'smtp_port', String(SMTP_PORT));
  const before = smtpMails.length;
  const r = await admin.req('POST', '/admin/mailboxes/mb1/check');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true, JSON.stringify(r.data.steps));
  assert.equal(r.data.imap, true);
  assert.equal(r.data.smtp, true);
  const labels = r.data.steps.map((s) => s.label);
  assert.ok(labels.includes('Server 127.0.0.1'));
  assert.ok(labels.some((l) => l.startsWith('Anmeldung als support@')));
  assert.ok(labels.includes('Ordner INBOX'));
  assert.ok(labels.some((l) => l.startsWith('SMTP-Anmeldung')));
  assert.ok(r.data.steps.every((s) => s.ok && s.hint === null));
  assert.match(r.data.message, /Versand klappt/);
  const mail = await eventually(() => smtpMails.length > before && smtpMails.at(-1));
  assert.ok(mail, 'Testmail kam beim SMTP-Server an');
  assert.equal(mail.from, 'support@perfumecloud.de');
  assert.deepEqual(mail.to, ['support@perfumecloud.de']);
  assert.match(mail.data, /Subject: Testmail der Team-App/);
  assert.ok(!JSON.stringify(r.data).includes('secret'), 'Passwort taucht nirgends auf');
  // Mitglieder dürfen fremde Postfächer nicht prüfen; unbekanntes Postfach
  assert.equal((await kim.req('POST', '/admin/mailboxes/mb1/check')).status, 403);
  assert.equal((await admin.req('POST', '/admin/mailboxes/gibtsnicht/check')).status, 404);
  assert.equal((await kim.req('POST', '/me/mailbox/check')).status, 404);

  // Einladungen gehen jetzt wirklich raus
  const inv = await admin.req('POST', '/admin/users', { name: 'Lea', email: 'lea@example.de', invite: true });
  assert.equal(inv.data.invite.sent, true, JSON.stringify(inv.data.invite));
  const invMail = await eventually(() => smtpMails.find((x) => x.to.includes('lea@example.de')));
  assert.ok(invMail);
  assert.match(mailText(invMail.data), /einladung=pci_/);

  // Falsches Passwort → Hinweis zur Anmeldung, der Versand wird gar nicht erst versucht
  helper('mail', String(IMAP_PORT), 'falsch');
  const wrong = await admin.req('POST', '/admin/mailboxes/mb1/check');
  assert.equal(wrong.data.ok, false);
  const failed = wrong.data.steps.find((s) => !s.ok);
  assert.match(failed.label, /^Anmeldung als/);
  assert.match(failed.hint, /Benutzername oder Passwort/);
  assert.equal(wrong.data.smtp, false);
  const status = (await admin.req('GET', '/admin/integrations')).data.mailboxes.find((x) => x.id === 'mb1').status;
  assert.equal(status.ok, false);

  // Abruf ok, aber SMTP-Port zu → Abruf klappt, Versand nicht
  helper('mail', String(IMAP_PORT));
  helper('setting', 'smtp_port', String(CLOSED_PORT));
  const noSmtp = await admin.req('POST', '/admin/mailboxes/mb1/check');
  assert.equal(noSmtp.data.imap, true);
  assert.equal(noSmtp.data.smtp, false);
  assert.match(noSmtp.data.message, /^Abruf klappt, Versand nicht/);
  assert.match(noSmtp.data.steps.find((s) => !s.ok).hint, /keine Verbindung an|blockiert/);

  // Port des Versands beim Abruf eingetragen → klarer Hinweis
  const list = helper('sql', "SELECT v FROM settings WHERE k = 'mailboxes'");
  const boxes = JSON.parse(list[0].v);
  boxes[0].port = 465;
  helper('setting', 'mailboxes', JSON.stringify(boxes));
  const smtpPort = await admin.req('POST', '/admin/mailboxes/mb1/check');
  assert.equal(smtpPort.data.ok, false);
  assert.match(smtpPort.data.steps[0].hint, /993/);

  // Server-Schreibweisen aus Mailprogrammen werden verstanden
  const saved = await admin.req('PUT', '/admin/mailboxes', { mailboxes: [{ id: 'mb1', email: 'support@perfumecloud.de', host: '{mxf9a2.example.invalid:143/imap/tls}INBOX', port: 993, security: 'ssl' }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const mb = saved.data.mailboxes.find((x) => x.id === 'mb1');
  assert.deepEqual([mb.host, mb.port, mb.security], ['mxf9a2.example.invalid', 143, 'starttls']);
  assert.match(saved.data.tests.mb1.steps[0].hint ?? '', /gibt es nicht/);

  // SMTP-Port in den Einstellungen: nur 465, 587 oder automatisch
  await admin.req('PUT', '/admin/settings', { smtp_port: 2525 });
  assert.equal((await admin.req('GET', '/admin/integrations')).data.mail.smtpPort, 0);
  await admin.req('PUT', '/admin/settings', { smtp_port: 587 });
  assert.equal((await admin.req('GET', '/admin/integrations')).data.mail.smtpPort, 587);
  await admin.req('PUT', '/admin/settings', { smtp_port: 0 });
  helper('mail', String(IMAP_PORT));
});

test('Club: Verbindung, Rechte, Statistik, Nachricht an Mitglieder, Club-Admin-Link', async () => {
  // Noch nicht verbunden
  const s0 = await admin.req('GET', '/admin/club');
  assert.equal(s0.data.club.configured, false);
  assert.equal((await admin.req('GET', '/club/stats')).status, 409);
  assert.equal((await kim.req('GET', '/club/stats')).status, 403, 'Mitglied ohne Club-Zugang');
  assert.equal((await kim.req('GET', '/admin/club')).status, 403);
  assert.equal((await admin.req('GET', '/sync?since=0')).data.meta.clubConfigured, false);

  // Adresse prüfen
  assert.equal((await admin.req('PUT', '/admin/club', { url: 'http://club.example.de' })).status, 422);
  // Falscher Schlüssel → verständliche Meldung
  const bad = await admin.req('PUT', '/admin/club', { url: `${clubUrl}/api/`, key: 'falsch' });
  assert.equal(bad.status, 200, JSON.stringify(bad.data));
  assert.equal(bad.data.club.url, clubUrl, '/api am Ende wird entfernt');
  assert.equal(bad.data.test.ok, false);
  assert.match(bad.data.test.message, /Schlüssel stimmt nicht/);
  // Richtiger Schlüssel
  const ok = await admin.req('PUT', '/admin/club', { key: CLUB_KEY });
  assert.equal(ok.data.test.ok, true, ok.data.test.message);
  assert.match(ok.data.test.message, /Version 1\.4\.0/);
  assert.equal(ok.data.club.configured, true);
  assert.equal(ok.data.club.hasKey, true);
  assert.ok(!JSON.stringify(ok.data).includes(CLUB_KEY), 'Schlüssel geht nie an den Browser');
  assert.equal((await admin.req('POST', '/admin/club/ping')).data.club.status.ok, true);
  assert.equal((await admin.req('GET', '/sync?since=0')).data.meta.clubConfigured, true);
  assert.equal((await kim.req('GET', '/sync?since=0')).data.meta.clubConfigured, false);

  // Statistik
  const st = await admin.req('GET', '/club/stats');
  assert.equal(st.status, 200, JSON.stringify(st.data));
  assert.equal(st.data.members, 42);
  assert.equal(st.data.tiers.length, 3);
  assert.ok(clubCalls.every((c) => c.key === CLUB_KEY || c.key === 'falsch'));

  // Kim bekommt Club-Zugang
  const u = await admin.req('PUT', `/admin/users/${kimId}`, { club_access: true });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  assert.equal((await kim.req('GET', '/me')).data.user.club_access, 1);
  assert.equal((await kim.req('GET', '/club/stats')).status, 200);
  assert.equal((await kim.req('GET', '/sync?since=0')).data.meta.clubConfigured, true);
  assert.equal((await admin.req('GET', '/admin/maintenance')).data.people.find((p) => p.id === kimId).clubAccess, true);

  // iPhone-Widget: Club-Zahlen nur mit Club-Zugang, kurz zwischengespeichert
  const { data: wa } = await admin.req('POST', '/widget/token');
  const { data: wk } = await kim.req('POST', '/widget/token');
  const widgetOf = async (t) => (await new Client().req('GET', `/widget?token=${encodeURIComponent(t.token)}`)).data;
  const before = clubCalls.filter((c) => c.path === '/api/internal/widget').length;
  const wAdmin = await widgetOf(wa);
  assert.equal(wAdmin.club.members, 42);
  assert.equal(wAdmin.club.recent[0].name, 'Anna B.');
  assert.equal((await widgetOf(wk)).club.new_today, 1);
  assert.equal(clubCalls.filter((c) => c.path === '/api/internal/widget').length, before + 1, 'zweiter Abruf aus dem Zwischenspeicher');

  // Nachricht an Mitglieder: Vorlagen und Empfänger
  const ov = await kim.req('GET', '/club/broadcasts');
  assert.equal(ov.status, 200);
  assert.equal(ov.data.templates[0].key, 'release');
  assert.equal(ov.data.me.email, 'kim@example.de');
  // Platzhalter nicht ausgefüllt
  const tpl = ov.data.templates[0];
  const unfilled = await kim.req('POST', '/club/broadcasts', { template: 'release', title: tpl.title, body: tpl.body, audience: 'all' });
  assert.equal(unfilled.status, 422);
  assert.match(unfilled.data.error, /Platzhalter/);
  const draft = await kim.req('POST', '/club/broadcasts', { template: 'release', title: 'Neu: Ambre Soir', body: '{vorname}, unser neuer Duft Ambre Soir ist da.', audience: 'all', url: 'https://perfumecloud.de/products/ambre-soir', scheduled_at: 'morgen' });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal(draft.data.status, 'draft');
  const id = draft.data.id;
  const sent = clubCalls.at(-1);
  assert.deepEqual(sent.body.user, { id: kimId, name: 'Kim K.', email: 'kim@example.de' }, 'Person kommt vom Server, nicht aus dem Browser');
  assert.equal(sent.body.scheduled_at, null);

  // Zur Prüfung, eigene Freigabe verboten (Vier-Augen-Prinzip), Admin gibt zurück
  assert.equal((await kim.req('POST', `/club/broadcasts/${id}/submit`)).data.status, 'review');
  const self = await kim.req('POST', `/club/broadcasts/${id}/approve`);
  assert.equal(self.status, 403);
  assert.match(self.data.error, /Vier-Augen/);
  const back = await admin.req('POST', `/club/broadcasts/${id}/reject`, { note: 'Bitte Link prüfen' });
  assert.equal(back.data.status, 'draft');
  assert.equal(back.data.review_note, 'Marius: Bitte Link prüfen');
  // Überarbeiten, erneut einreichen, Admin gibt frei → wird sofort verschickt
  assert.equal((await kim.req('PUT', `/club/broadcasts/${id}`, { template: 'release', title: 'Neu: Ambre Soir', body: 'Unser neuer Duft ist da.', audience: 'silber' })).data.audience, 'silber');
  await kim.req('POST', `/club/broadcasts/${id}/submit`);
  const kicks = clubCalls.filter((c) => c.path === '/api/internal/kick').length;
  const appr = await admin.req('POST', `/club/broadcasts/${id}/approve`);
  assert.equal(appr.status, 200, JSON.stringify(appr.data));
  assert.equal(appr.data.status, 'sent');
  assert.equal(appr.data.approved_by_name, 'Marius');
  assert.equal(clubCalls.filter((c) => c.path === '/api/internal/kick').length, kicks + 1, 'Versand sofort angestoßen');
  // Test an eigene Geräte: Meldung des Clubs kommt durch
  const tst = await kim.req('POST', `/club/broadcasts/${id}/test`);
  assert.equal(tst.status, 409);
  assert.match(tst.data.error, /kein Gerät/);
  // Ungültige ID, Löschen
  assert.equal((await kim.req('POST', '/club/broadcasts/abc/submit')).status, 404);
  const d2 = await kim.req('POST', '/club/broadcasts', { kind: 'feedback', template: 'feedback', title: 'Wie gefällt dir der Club?', body: 'Sag es uns.', audience: 'all' });
  assert.equal(d2.data.kind, 'feedback');
  assert.equal((await kim.req('DELETE', `/club/broadcasts/${d2.data.id}`)).status, 200);

  // Club-Admin per Einmal-Link
  const sso = await kim.req('POST', '/club/sso');
  assert.equal(sso.status, 200, JSON.stringify(sso.data));
  assert.match(sso.data.url, /\/api\/admin\/sso\?t=/);
  club.denySso.add('kim@example.de');
  const denied = await kim.req('POST', '/club/sso');
  assert.equal(denied.status, 403);
  assert.match(denied.data.error, /Kein Zugriff/);

  // Zugang wieder entziehen
  await admin.req('PUT', `/admin/users/${kimId}`, { club_access: false });
  assert.equal((await kim.req('GET', '/club/broadcasts')).status, 403);
  assert.equal((await widgetOf(wk)).club, null, 'ohne Club-Zugang keine Club-Zahlen im Widget');
  assert.equal((await widgetOf(wa)).club.members, 42);
  await admin.req('DELETE', '/widget/token');
  await kim.req('DELETE', '/widget/token');
  assert.equal((await kim.req('POST', '/club/sso')).status, 403);

  // „Datenbank aktualisieren“ bringt auch den Club auf den neuesten Stand
  const fix = await admin.req('POST', '/admin/maintenance');
  assert.ok(fix.data.log.some((l) => /Club-Datenbank auf Version 1\.4\.0/.test(l)), fix.data.log.join('\n'));

  // Club nicht erreichbar → klare Meldung
  await admin.req('PUT', '/admin/club', { url: `http://127.0.0.1:${CLOSED_PORT}` });
  const down = await admin.req('GET', '/club/stats');
  assert.equal(down.status, 502);
  assert.match(down.data.error, /nicht erreichbar/);
});

test('Club: Adresse und Schlüssel aus der gemeinsamen Datenbank erkennen', async () => {
  await admin.req('PUT', '/admin/club', { url: '', clear_key: true });
  assert.equal((await admin.req('GET', '/admin/club')).data.club.configured, false);
  helper('sql', 'CREATE TABLE club_settings (k VARCHAR(100) PRIMARY KEY, v TEXT, updated_at BIGINT)');
  helper('sql', `INSERT INTO club_settings (k, v, updated_at) VALUES ('internal_key', '${JSON.stringify(CLUB_KEY)}', 1), ('app_url', '${JSON.stringify(clubUrl)}', 1)`);
  const s = await admin.req('GET', '/admin/club');
  assert.equal(s.data.club.configured, true);
  assert.equal(s.data.club.urlSource, 'auto');
  assert.equal(s.data.club.keySource, 'auto');
  assert.equal(s.data.club.effectiveUrl, clubUrl);
  assert.equal((await admin.req('POST', '/admin/club/ping')).data.test.ok, true);
  assert.equal((await admin.req('GET', '/club/stats')).data.members, 42);
  // Eigene Angaben haben Vorrang
  const manual = await admin.req('PUT', '/admin/club', { key: 'eigener-schluessel' });
  assert.equal(manual.data.club.keySource, 'manual');
  assert.equal(manual.data.test.ok, false);
  await admin.req('PUT', '/admin/club', { clear_key: true });
  assert.equal((await admin.req('GET', '/admin/club')).data.club.keySource, 'auto');
});

test('Club: schlechte Bewertung wird zur Aufgabe mit Push, Probelauf nur für Admins', async () => {
  assert.equal((await admin.req('GET', '/admin/club')).data.club.configured, true);
  const integ = await admin.req('GET', '/admin/integrations');
  const cronKey = new URL(integ.data.cron.url).searchParams.get('key');
  const runCron = () => new Client().req('GET', `/cron?key=${cronKey}`);
  club.alerts.push({
    id: 'a1', kind: 'low_rating', test: false, created_at: Date.now(),
    payload: {
      survey_id: 's1', order_id: 'gid://shopify/Order/1042', order_name: '#1042', email: 'anna@example.de', name: 'Anna', member: true, tier: 'Gold', stars: 2, avg: 2.5,
      items: [{ title: 'Sunset Dune (50 ml)', stars: 2 }, { title: 'Amber Nights', stars: 3 }],
      questions: [{ question: 'Wie zufrieden bist du mit Versand und Verpackung?', answer: '1', type: 'stars' }, { question: 'Würdest du ihn wieder kaufen?', answer: 'Nein', type: 'choice' }],
      comment: 'Der Flakon kam beschädigt an.',
    },
  });
  const okHits = () => pushHits.filter((h) => h.path.startsWith('/ok/')).length;
  const hitsBefore = okHits();
  const r1 = await runCron();
  assert.equal(r1.data.club_alerts, '1 Hinweis', JSON.stringify(r1.data));
  const [t] = helper('sql', "SELECT * FROM tasks WHERE title = '2 ★ für #1042 – Anna melden'");
  assert.ok(t, 'Aufgabe angelegt');
  assert.equal(t.priority, 'high');
  assert.equal(t.category, 'Kundenservice');
  assert.equal(t.assignee_id, null);
  assert.match(t.description, /Bewertung nach der Lieferung \(Ø 2,5 ★\)/);
  assert.match(t.description, /• Sunset Dune \(50 ml\): ★★☆☆☆/);
  assert.match(t.description, /• Wie zufrieden bist du mit Versand und Verpackung\? 1 ★/);
  assert.match(t.description, /Kommentar: „Der Flakon kam beschädigt an\.“/);
  assert.match(t.description, /anna@example\.de> · Club-Mitglied \(Gold\)/);
  assert.match(t.description, /Vorschlag für die Antwort:\nHallo Anna,/);
  assert.match(t.description, /#1042/);
  assert.equal(JSON.parse(t.checklist).length, 3);
  assert.ok(await eventually(() => okHits() > hitsBefore), 'Push „Unzufriedene Kundin“ ans Team');
  // Abgeholt ist abgeholt: kein zweites Mal
  await runCron();
  assert.equal(helper('sql', "SELECT COUNT(*) AS n FROM tasks WHERE title LIKE '%#1042%'")[0].n, 1);

  // Probelauf: nur Admins
  assert.equal((await kim.req('GET', '/club/trial')).status, 403);
  assert.equal((await kim.req('POST', '/club/trial/start', { mode: 'sim' })).status, 403);
  let r = await admin.req('GET', '/club/trial');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.active, false);
  assert.deepEqual(r.data.cancel, { shopify: false, allowed: false });
  assert.equal((await admin.req('POST', '/club/trial/start', { mode: 'real', amount_cents: 50 })).status, 422);
  r = await admin.req('POST', '/club/trial/start', { mode: 'real', amount_cents: 4000 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.codes.length, 2);
  const startCall = clubCalls.filter((c) => c.path === '/api/internal/trial/start').at(-1);
  assert.equal(startCall.body.user.email, 'marius@example.de');
  assert.equal(startCall.body.amount_cents, 4000);
  assert.equal((await admin.req('POST', '/club/trial/start', { mode: 'sim' })).status, 409);
  r = await admin.req('POST', '/club/trial/step', { step: 'shipped' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Versand/);

  // Testbestellung kommt an: gemerkt (zählt nicht), Hinweis aus dem Probelauf nur an den Admin
  const kimHits = () => pushHits.filter((h) => h.path === '/ok/1').length;
  const kimBefore = kimHits();
  r = await admin.req('POST', '/club/trial/sync');
  assert.equal(r.data.order.name, '#9001');
  assert.deepEqual(helper('sql', "SELECT v FROM settings WHERE k = 'test_orders'").map((x) => JSON.parse(x.v))[0], ['9001']);
  const [tt] = helper('sql', "SELECT * FROM tasks WHERE title = 'Probelauf: 1 ★ für #9001 – Probelauf melden'");
  assert.ok(tt, 'Aufgabe aus dem Probelauf');
  const adminId = helper('sql', "SELECT id FROM users WHERE email = 'marius@example.de'")[0].id;
  assert.equal(tt.assignee_id, adminId);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(kimHits(), kimBefore, 'Probelauf-Hinweis nicht ans ganze Team');

  // Aufräumen: ohne Shopify-Verbindung verständlicher Hinweis zum Stornieren
  r = await admin.req('POST', '/club/trial/cleanup');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.order.name, '#9001');
  assert.equal(r.data.order.cancelled, false);
  assert.match(r.data.order.note, /Shopify ist in der Team-App nicht verbunden/);
  assert.equal(r.data.active, false);
  assert.equal(helper('sql', "SELECT COUNT(*) AS n FROM settings WHERE k = 'club_trial'")[0].n, 0);
});

test('Sofort-Abruf: neue Mail per IDLE in Sekunden gemeldet, Lücken nachgeholt, ohne IDLE alle 10 Sek.', async () => {
  const setup = helper('live-setup', String(IMAP_PORT));
  assert.equal(setup.init, true, JSON.stringify(setup));
  assert.equal(setup.uid.v, '777');
  assert.ok(setup.uid.uid >= 107, JSON.stringify(setup.uid));

  // Eigene Person mit Push-Gerät (keine Aufgaben oder Termine, nur Mails)
  const u = await admin.req('POST', '/admin/users', { name: 'Lia', email: 'lia.live@example.de', password: 'lialialia1' });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  const lea = new Client();
  assert.equal((await lea.req('POST', '/auth/login', { email: 'lia.live@example.de', password: 'lialialia1' })).status, 200);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  assert.equal((await lea.req('POST', '/push/subscribe', { endpoint: `http://127.0.0.1:${pushPort}/ok/lia`, keys })).status, 200);
  const leaHits = () => pushHits.filter((h) => h.path === '/ok/lia');

  const live = () => {
    const v = helper('sql', "SELECT v FROM settings WHERE k = 'live'")[0]?.v;
    return v ? JSON.parse(v) : null;
  };
  const boxState = () => live()?.boxes?.['live@perfumecloud.de']?.state;
  const cron = (seconds) => {
    const p = spawn('php', [join(serverDir, 'app/bin/cron.php'), `--seconds=${seconds}`], { env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    return new Promise((resolve) => p.on('exit', () => resolve(out)));
  };
  const deliver = async (mail) => {
    const added = waitFor(imap, 'ADDED');
    imap.stdin.write(`ADD ${JSON.stringify(mail)}\n`);
    await added;
  };

  // 1) Läuft: Der Server meldet die neue Mail per IDLE, der Push ist nach Sekundenbruchteilen raus
  const run1 = cron(8);
  assert.ok(await eventually(() => boxState() === 'idle', 6000), 'Postfach im IDLE: ' + JSON.stringify(live()));
  const second = JSON.parse(execFileSync('php', [join(serverDir, 'app/bin/cron.php'), '--seconds=5'], { env }).toString());
  assert.equal(second.live, 'läuft bereits', 'ein zweiter Cronjob beendet sich sofort');
  const before = leaHits().length;
  const t0 = Date.now();
  await deliver({ from: 'Lea Kundin <lea.kundin@example.de>', subject: 'Frage zu Bestellung #2001', body: 'Wo ist mein Paket?' });
  assert.ok(await eventually(() => leaHits().length > before, 5000), 'Push kam nicht');
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `Push erst nach ${ms} ms`);
  assert.equal(leaHits().at(-1).headers.urgency, 'high');
  const row = helper('sql', "SELECT notified, mailbox, important FROM emails WHERE subject = 'Frage zu Bestellung #2001'");
  assert.deepEqual(row, [{ notified: 1, mailbox: 'live@perfumecloud.de', important: 1 }]);
  assert.ok(await eventually(() => live()?.last_mail?.delay < 5000, 3000), 'Verzögerung gemessen: ' + JSON.stringify(live()?.last_mail));
  const integ = await admin.req('GET', '/admin/integrations');
  assert.equal(integ.data.cron.live.active, true);
  assert.equal(integ.data.cron.live.boxes['live@perfumecloud.de'].state, 'idle');
  assert.match(integ.data.cron.script, /app\/bin\/cron\.php$/);
  const out1 = JSON.parse((await run1).trim().split('\n').at(-1));
  assert.equal(out1.live, 'beendet');
  assert.ok(out1.new >= 1 && out1.pushed >= 1, JSON.stringify(out1));

  // 2) Mail kommt, während kein Abruf läuft: der nächste holt sie sofort beim Start
  await deliver({ from: 'Max <max@example.de>', subject: 'Retoure aus der Lücke', body: 'Hallo' });
  const b2 = leaHits().length;
  const run2 = cron(3);
  assert.ok(await eventually(() => leaHits().length > b2, 4000), 'Mail aus der Lücke nicht gemeldet');
  await run2;
  assert.equal(helper('sql', "SELECT COUNT(*) AS n FROM emails WHERE subject = 'Retoure aus der Lücke'")[0].n, 1);

  // 3) Server ohne IDLE: Nachfragen per NOOP, die Mail aus der Lücke kommt trotzdem sofort
  const off = waitFor(imap, 'OK NOIDLE');
  imap.stdin.write('NOIDLE\n');
  await off;
  await deliver({ from: 'Ida <ida@example.de>', subject: 'Ohne IDLE', body: 'Hallo' });
  const b3 = leaHits().length;
  const run3 = cron(3);
  assert.ok(await eventually(() => leaHits().length > b3, 4000), 'ohne IDLE nicht gemeldet');
  assert.ok(await eventually(() => boxState() === 'poll', 3000));
  await run3;
  const on = waitFor(imap, 'OK IDLE');
  imap.stdin.write('IDLE\n');
  await on;
  // Jede Mail genau einmal gemeldet
  assert.equal(helper('sql', "SELECT COUNT(*) AS n FROM emails WHERE notified = 0")[0].n, 0);
});

test('1.5 Erinnerung: Aufgabe „Postfach auswertung@… anlegen“ für den Admin', () => {
  helper('migrate');
  const t = helper('sql', "SELECT t.title, t.assignee_id, t.priority, u.email FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.title LIKE 'Postfach auswertung@%'");
  assert.equal(t.length, 1);
  assert.equal(t[0].email, 'marius@example.de');
  assert.equal(t[0].priority, 'high');
  helper('migrate');
  assert.equal(helper('sql', "SELECT COUNT(*) AS n FROM tasks WHERE title LIKE 'Postfach auswertung@%'")[0].n, 1, 'nur einmal');
});

test('Antworten aus der App: voller Text, Bausteine, Test an mich, Versand mit Kopie in Gesendet', async () => {
  helper('mail', String(IMAP_PORT));
  helper('setting', 'smtp_port', String(SMTP_PORT));
  const id = helper('sql', "SELECT id FROM emails WHERE from_email = 'juergen@example.de'")[0].id;

  const msg = await kim.req('GET', `/emails/${id}/message`);
  assert.equal(msg.status, 200, JSON.stringify(msg.data));
  assert.match(msg.data.text, /ich warte seit einer Woche/);
  assert.equal(msg.data.order_number, '1042');
  assert.equal(msg.data.reply_to, 'juergen@example.de');
  assert.equal((await kim.req('GET', '/emails/' + 'f'.repeat(40) + '/message')).status, 404);

  // Bausteine: beim Update angelegt, pflegen nur Admins
  const tpl = await kim.req('GET', '/templates');
  assert.ok(tpl.data.templates.length >= 5);
  assert.ok(tpl.data.placeholders.sendungslink);
  assert.equal((await kim.req('PUT', `/templates/${crypto.randomUUID()}`, { title: 'X', body: 'Y' })).status, 403);
  const tid = crypto.randomUUID();
  const saved = await admin.req('PUT', `/templates/${tid}`, { title: 'Kurz', body: 'Hallo {vorname}, deine Bestellung {bestellnummer} ist unterwegs.' });
  assert.ok(saved.data.templates.some((t) => t.id === tid));

  // Platzhalter: Vorname aus dem Absender, Bestellnummer fehlt ohne Shopify → wird gemeldet
  const fill = await kim.req('POST', `/emails/${id}/fill`, { text: 'Hallo {vorname}, deine Bestellung {bestellnummer} ist unterwegs. {meinvorname}' });
  assert.equal(fill.data.text, 'Hallo Jürgen, deine Bestellung ist unterwegs. Kim');
  assert.deepEqual(fill.data.missing, ['bestellnummer']);

  // Vorschau: Betreff mit Re:, Signatur und Fußzeile, Zitat
  await admin.req('PUT', '/me', { prefs: { signature: 'Liebe Grüße\nMarius' } });
  const pre = await admin.req('POST', `/emails/${id}/reply`, { text: 'Hallo {vorname}, schauen wir nach!', quote: true, mode: 'preview' });
  assert.equal(pre.status, 200, JSON.stringify(pre.data));
  assert.equal(pre.data.to, 'juergen@example.de');
  assert.equal(pre.data.subject, 'Re: Wo bleibt meine Bestellung #1042?');
  assert.match(pre.data.text, /^Hallo Jürgen, schauen wir nach!\n\nLiebe Grüße\nMarius\n\nPerfume Cloud/);
  assert.match(pre.data.text, /schrieb Jürgen Müller <juergen@example.de>:\n> Hallo liebes Team,/);

  // Test an mich: geht an die eigene Adresse, nichts wird markiert
  const before = smtpMails.length;
  const test = await admin.req('POST', `/emails/${id}/reply`, { text: 'Hallo {vorname}', mode: 'test' });
  assert.equal(test.data.sent, true, JSON.stringify(test.data));
  const tm = await eventually(() => smtpMails.slice(before).find((m) => m.to.includes('marius@example.de')));
  assert.ok(tm);
  assert.match(tm.data, /Subject: \[TEST\] Re: Wo bleibt/);
  assert.match(mailText(tm.data), /so käme die Antwort bei juergen@example.de an/);
  assert.equal(helper('sql', `SELECT answered FROM emails WHERE id = '${id}'`)[0].answered, 0);

  // Senden: an die Kundin, mit Bezug auf die Original-Mail, Kopie in „Gesendet“, Original als beantwortet markiert
  const ev = imapEvents.length;
  const sent = await admin.req('POST', `/emails/${id}/reply`, { text: 'Hallo {vorname}, dein Paket ist unterwegs.', mode: 'send', done: true, template_id: tid });
  assert.equal(sent.data.sent, true, JSON.stringify(sent.data));
  assert.deepEqual(sent.data.warnings, []);
  assert.equal(sent.data.email.answered, 1);
  assert.equal(sent.data.email.status, 'done');
  const out = await eventually(() => smtpMails.find((m) => m.to.includes('juergen@example.de')));
  assert.ok(out, 'Antwort kam an');
  assert.equal(out.from, 'support@perfumecloud.de');
  assert.match(out.data, /In-Reply-To: <a1@example.de>/);
  assert.match(out.data, /References: <a1@example.de>/);
  assert.doesNotMatch(out.data, /Auto-Submitted/);
  assert.match(mailText(out.data), /Hallo Jürgen, dein Paket ist unterwegs\.\n\nLiebe Grüße\nMarius/);
  assert.ok(await eventually(() => imapEvents.slice(ev).some((e) => e.kind === 'APPENDED' && e.folder === 'Sent')), 'Kopie in Gesendet');
  assert.ok(await eventually(() => imapEvents.slice(ev).some((e) => e.kind === 'STORED' && e.uids.includes(101) && e.flags.includes('\\Answered'))), 'als beantwortet markiert');
  const row = helper('sql', `SELECT answered_at, replied_by, status FROM emails WHERE id = '${id}'`)[0];
  assert.ok(row.answered_at > 0);
  assert.equal(helper('sql', `SELECT COUNT(*) AS n FROM replies WHERE email_id = '${id}'`)[0].n, 1);
  // Beim nächsten Abruf bleibt sie beantwortet (Flag steht jetzt auch auf dem Server)
  helper('mail', String(IMAP_PORT));
  assert.equal(helper('sql', `SELECT answered FROM emails WHERE id = '${id}'`)[0].answered, 1);
  await admin.req('PUT', '/me', { prefs: { signature: null } });
});

test('Kundeninfos: ohne Shopify verständlich, Notizen des Teams', async () => {
  const r = await kim.req('GET', '/customers?email=Juergen@Example.de&order=1042');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.email, 'juergen@example.de');
  assert.equal(r.data.order, '1042');
  assert.equal(r.data.shopify.configured, false);
  assert.deepEqual(r.data.orders, []);
  assert.equal((await kim.req('GET', '/customers?email=quatsch')).status, 422);
  const n = await kim.req('POST', '/customers/notes', { email: 'juergen@example.de', body: 'Mag holzige Düfte, hat 2× Ambre Soir bestellt' });
  assert.equal(n.data.notes.length, 1);
  const again = await admin.req('GET', '/customers?email=juergen@example.de');
  assert.equal(again.data.notes[0].body, 'Mag holzige Düfte, hat 2× Ambre Soir bestellt');
  const adminNote = await admin.req('POST', '/customers/notes', { email: 'juergen@example.de', body: 'VIP' });
  const vip = adminNote.data.notes.find((x) => x.body === 'VIP');
  assert.equal((await kim.req('DELETE', `/customers/notes/${vip.id}`)).status, 403);
  assert.equal((await admin.req('DELETE', `/customers/notes/${vip.id}`)).data.notes.length, 1);
  assert.equal((await kim.req('POST', '/customers/notes', { email: 'juergen@example.de', body: '  ' })).status, 422);
});

test('Versand: ohne Shopify verständlich, Versanddienst an der Nummer erkennen', async () => {
  const r = await kim.req('GET', '/shipping');
  assert.equal(r.data.configured, false);
  assert.deepEqual(r.data.orders, []);
  assert.ok(r.data.carriers.includes('DHL'));
  assert.equal(r.data.settings.remind_days, 2);
  const guess = async (n) => (await kim.req('GET', '/shipping/guess?number=' + encodeURIComponent(n))).data.carrier;
  assert.equal(await guess('1Z999AA10123456784'), 'UPS');
  assert.equal(await guess('00340434161094042557'), 'DHL');
  assert.equal(await guess('JJD000390007882718'), 'DHL');
  assert.equal(await guess('RR123456785DE'), 'Deutsche Post (DE)');
  assert.equal(await guess('H1234567890123456789'), 'Hermes');
  assert.equal(await guess('abc'), null);
  assert.equal((await kim.req('POST', '/shipping/123', { number: '00340434161094042557' })).status, 409);
  assert.equal((await kim.req('PUT', '/admin/shipping', { remind_days: 3 })).status, 403);
  const s = await admin.req('PUT', '/admin/shipping', { remind_days: 3, default_carrier: 'Hermes', notify: false });
  assert.deepEqual(s.data.settings, { remind_days: 3, default_carrier: 'Hermes', notify: false });
});

test('Datensicherung: Passwort, sichern, prüfen, Mail an Auswertungsadresse, wiederherstellen', async () => {
  assert.equal((await kim.req('POST', '/admin/backup')).status, 403);
  assert.equal((await admin.req('POST', '/admin/backup')).status, 409, 'ohne Passwort');
  assert.equal((await admin.req('PUT', '/admin/backup/password', { password: 'kurz' })).status, 422);
  await admin.req('PUT', '/admin/backup/password', { password: 'sicherung-geheim-1' });
  const b = await admin.req('POST', '/admin/backup');
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.match(b.data.created.name, /^pc-\d{4}-\d{2}-\d{2}-manuell\.pcbak$/);
  assert.ok(b.data.created.rows > 10);
  assert.ok(!b.data.backup.files.some((f) => f.name.includes('upload')));
  const v = await admin.req('POST', '/admin/backup/verify', {});
  assert.equal(v.data.ok, true);
  assert.ok(v.data.tables.some((t) => t.name === 'tasks' && t.rows > 0));
  assert.ok(!v.data.tables.some((t) => t.name === 'sessions'), 'Anmeldungen gehören nicht in die Sicherung');

  // Datei herunterladen: verschlüsselt, kein Klartext
  const dl = await fetch(`${base}/admin/backup/download?name=${b.data.created.name}`, { headers: { Cookie: admin.cookie } });
  const file = Buffer.from(await dl.arrayBuffer());
  assert.equal(file.subarray(0, 4).toString(), 'PCBK');
  assert.ok(!file.includes(Buffer.from('marius@example.de')), 'verschlüsselt');
  assert.equal((await fetch(`${base}/admin/backup/download?name=../config.php`, { headers: { Cookie: admin.cookie } })).status, 404);

  // Wöchentliche Mail an die Auswertungsadresse mit Anhang
  const before = smtpMails.length;
  const m = await admin.req('POST', '/admin/backup/mail', { name: b.data.created.name });
  assert.equal(m.data.sent, true, JSON.stringify(m.data));
  const bm = await eventually(() => smtpMails.slice(before).find((x) => x.to.includes('auswertung@perfumecloud.de')));
  assert.ok(bm);
  assert.match(bm.data, /Content-Disposition: attachment; filename="pc-/);

  // Nach der Sicherung angelegte Aufgabe verschwindet beim Wiederherstellen
  const tid = crypto.randomUUID();
  await admin.req('PUT', `/tasks/${tid}`, { title: 'Nach der Sicherung' });
  assert.equal((await admin.req('POST', '/admin/backup/restore', { name: b.data.created.name, confirm: 'ja' })).status, 422);
  const r = await admin.req('POST', '/admin/backup/restore', { name: b.data.created.name, confirm: 'WIEDERHERSTELLEN' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.before, /-vorher\.pcbak$/, 'vorher automatisch gesichert');
  assert.equal(helper('sql', `SELECT COUNT(*) AS n FROM tasks WHERE id = '${tid}'`)[0].n, 0);
  assert.equal((await admin.req('GET', '/me')).status, 200, 'bleibt angemeldet');

  // Hochladen: falsches Passwort, dann richtig
  const up = (pw) => fetch(`${base}/admin/backup/upload`, { method: 'POST', headers: { Cookie: admin.cookie, 'X-PC': '1', 'Content-Type': 'application/octet-stream', 'X-Backup-Password': encodeURIComponent(pw) }, body: file });
  const wrong = await up('falsch');
  assert.equal(wrong.status, 422);
  assert.match((await wrong.json()).error, /Passwort falsch/);
  const ok = await (await up('sicherung-geheim-1')).json();
  assert.ok(ok.token);
  assert.ok(ok.tables.length > 5);
  const r2 = await admin.req('POST', '/admin/backup/restore', { token: ok.token, confirm: 'WIEDERHERSTELLEN' });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal((await admin.req('POST', '/admin/backup/restore', { token: ok.token, confirm: 'WIEDERHERSTELLEN' })).status, 410);
});

test('Wochenrückblick: Kennzahlen mit Vorwoche, Antwortzeit, Vorschau an mich, Auswertungsadresse', async () => {
  helper('seed-orders', '30');
  const r = await kim.req('GET', '/reports/weekly');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.data.shop.current.orders > 0);
  assert.ok(r.data.data.shop.previous.orders > 0);
  assert.ok(r.data.data.shop.top.length > 0);
  assert.equal(r.data.config.day, 5, 'Freitag');
  assert.match(r.data.html, /Wochenrückblick/);
  assert.match(r.data.html, /Antwortzeit/);
  const mail = r.data.data.mail;
  assert.equal(mail.configured, true);
  // Jürgen: in der App nach ~2 Std. beantwortet, Ben: Antwort im Gesendet-Ordner nach 10 Std. → Median ~6 Std.
  assert.equal(mail.current.measured, 2, JSON.stringify(mail));
  assert.ok(mail.current.median_hours > 5 && mail.current.median_hours < 7, String(mail.current.median_hours));
  assert.equal(mail.current.within_24h, 100);

  const before = smtpMails.length;
  const t = await kim.req('POST', '/reports/weekly/test');
  assert.equal(t.data.sent, true, JSON.stringify(t.data));
  const pm = await eventually(() => smtpMails.slice(before).find((x) => x.to.includes('kim@example.de')));
  assert.ok(pm);
  assert.match(pm.data, /multipart\/alternative/);

  assert.equal((await kim.req('PUT', '/admin/reports', { email: 'x@example.de' })).status, 403);
  assert.equal((await admin.req('PUT', '/admin/reports', { email: 'kein-mail' })).status, 422);
  const s = await admin.req('PUT', '/admin/reports', { email: 'Auswertung@Example.de', weekly: { day: 5, hour: 16, push: false } });
  assert.equal(s.data.reports.email, 'auswertung@example.de');
  assert.equal(s.data.reports.weekly.hour, 16);
  const tm = await admin.req('POST', '/admin/reports/test-mail');
  assert.equal(tm.data.sent, true);
  const now = await admin.req('POST', '/admin/reports/weekly/send');
  assert.match(now.data.message, /auswertung@example.de: ok/);
  assert.ok(await eventually(() => smtpMails.filter((x) => x.to.includes('auswertung@example.de')).length >= 2));
  await admin.req('PUT', '/admin/reports', { email: '' });
  assert.equal((await admin.req('GET', '/admin/reports')).data.reports.email, 'auswertung@perfumecloud.de', 'leer = Standardadresse');
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
