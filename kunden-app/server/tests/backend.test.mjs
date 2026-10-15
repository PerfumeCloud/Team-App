// Integrationstests für die Kunden-App (PHP-Backend mit SQLite und einem Shopify-Nachbau).
// Aufruf: node --test kunden-app/server/tests/*.test.mjs   (PHP 8.1+ nötig)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify as verifySig } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'club-test-'));
const PORT = 19000 + Math.floor(Math.random() * 500);
const MOCK = PORT + 600;
const app = `http://127.0.0.1:${PORT}`;
const mock = `http://127.0.0.1:${MOCK}`;
const mailLog = join(tmp, 'mails.log');
const env = {
  ...process.env,
  CLUB_CONFIG: join(tmp, 'config.php'),
  CLUB_STORAGE: tmp,
  CLUB_SHOPIFY_BASE: mock,
  CLUB_CA_BASE: mock,
  CLUB_MAIL_LOG: mailLog,
  MOCK_STATE: join(tmp, 'mock.json'),
  CLUB_PUSH_TEST: '1',
};
let php, shop;

// Optional gegen MySQL/MariaDB testen (wie bei netcup): CLUB_TEST_MYSQL=host:port:user:passwort
const MY = process.env.CLUB_TEST_MYSQL ? (([host, port, user, pass]) => ({ host, port: Number(port), user, pass }))(process.env.CLUB_TEST_MYSQL.split(':')) : null;
const suffix = Math.random().toString(36).slice(2, 8);
function mysqlDb(name) {
  execFileSync('php', ['-r', '$p = new PDO("mysql:host=" . $argv[1] . ";port=" . $argv[2], $argv[3], $argv[4]); $p->exec("DROP DATABASE IF EXISTS " . $argv[5]); $p->exec("CREATE DATABASE " . $argv[5] . " CHARACTER SET utf8mb4");', MY.host, String(MY.port), MY.user, MY.pass, name]);
  return { driver: 'mysql', host: MY.host, port: MY.port, name, user: MY.user, pass: MY.pass };
}
const DBCFG = MY ? mysqlDb(`club_t_${suffix}`) : { driver: 'sqlite' };

const DAY = 86400 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d+Z$/, 'Z');
const ANNA = 'gid://shopify/Customer/1';
const BEN = 'gid://shopify/Customer/2';

function order(n, { ago, amount, paid = true, shippedAgo = null, delivered = false, cancelled = false, test = false, codes = [], customer = ANNA, tracking = true }) {
  const fulfilled = shippedAgo !== null;
  return {
    id: `gid://shopify/Order/${n}`,
    name: `#${n}`,
    processedAt: iso(ago),
    createdAt: iso(ago),
    updatedAt: iso(Math.min(ago, shippedAgo ?? ago)),
    cancelledAt: cancelled ? iso(ago - 1000) : null,
    test,
    fullyPaid: paid,
    displayFinancialStatus: paid ? 'PAID' : 'PENDING',
    displayFulfillmentStatus: fulfilled ? 'FULFILLED' : 'UNFULFILLED',
    statusPageUrl: `https://www.perfumecloud.de/orders/${n}`,
    discountCodes: codes,
    customer: { id: customer },
    currentSubtotalPriceSet: { shopMoney: { amount: amount.toFixed(2), currencyCode: 'EUR' } },
    currentTotalPriceSet: { shopMoney: { amount: (amount + 4.9).toFixed(2), currencyCode: 'EUR' } },
    totalRefundedSet: { shopMoney: { amount: '0.00' } },
    lineItems: { nodes: [{ title: 'Sunset Dune', variantTitle: '50 ml', quantity: 1, image: { url: 'https://cdn.shopify.com/flakon.webp', altText: null } }] },
    fulfillments: fulfilled
      ? [{
          status: 'SUCCESS',
          displayStatus: delivered ? 'DELIVERED' : 'IN_TRANSIT',
          createdAt: iso(shippedAgo),
          deliveredAt: delivered ? iso(shippedAgo - DAY) : null,
          inTransitAt: iso(shippedAgo),
          estimatedDeliveryAt: null,
          trackingInfo: tracking ? [{ company: 'DHL', number: `00340434${n}`, url: `https://www.dhl.de/de/privatkunden.html?piececode=00340434${n}` }] : [],
        }]
      : [],
  };
}

function waitFor(proc, text) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout beim Start')), 8000);
    const onData = (d) => { if (d.toString().includes(text)) { clearTimeout(t); resolve(); } };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
  });
}

/** Browser-Nachbau mit Cookies; Weiterleitungen werden einzeln verfolgt. */
class Client {
  constructor() { this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  take(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair.split('=');
      const expired = attrs.some((a) => /expires=.*1970|max-age=0/i.test(a)) || v === '' || v === 'deleted';
      if (expired) this.jar.delete(k.trim()); else this.jar.set(k.trim(), v);
    }
  }
  async raw(url, opts = {}) {
    const res = await fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers ?? {}), Cookie: this.cookieHeader() } });
    this.take(res);
    return res;
  }
  async req(method, path, body, headers = {}) {
    const res = await this.raw(app + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-PC': '1' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  /** Anmeldung über Shopify durchklicken. Gibt die letzte Weiterleitung der App zurück. */
  async shopifyLogin(next = '/') {
    let res = await this.raw(`${app}/api/auth/shopify/start?next=${encodeURIComponent(next)}`);
    assert.equal(res.status, 302);
    let loc = res.headers.get('location');
    assert.ok(loc.startsWith(mock + '/authentication/oauth/authorize'), loc);
    res = await this.raw(loc);
    assert.equal(res.status, 302);
    loc = res.headers.get('location');
    assert.ok(loc.startsWith(app + '/api/auth/shopify/callback'), loc);
    res = await this.raw(loc);
    assert.equal(res.status, 302);
    return res.headers.get('location');
  }
}

const setMock = (s) => fetch(mock + '/__mock/state', { method: 'POST', body: JSON.stringify(s) }).then((r) => r.json());
const getMock = () => fetch(mock + '/__mock/state').then((r) => r.json());
const sql = (q, params = []) => JSON.parse(execFileSync('php', [join(here, 'helper.php'), 'sql', q, JSON.stringify(params)], { env }).toString());
const cronKey = () => /'cron_key' => '([^']+)'/.exec(readFileSync(env.CLUB_CONFIG, 'utf8'))[1];
const cron = async () => (await fetch(`${app}/api/cron?key=${cronKey()}`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mails = () => (existsSync(mailLog) ? readFileSync(mailLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
async function waitMail(pred, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const found = mails().filter(pred).pop();
    if (found) return found;
    if (Date.now() > end) throw new Error('Mail kam nicht an');
    await sleep(100);
  }
}
const daily = () => sql("DELETE FROM club_settings WHERE k = 'daily_last'");
const setting = (k) => JSON.parse(sql('SELECT v FROM club_settings WHERE k = ?', [k])[0]?.v ?? 'null');

// ----- Web Push wie im Browser: Schlüssel erzeugen, Nachricht entschlüsseln (RFC 8291), VAPID prüfen (RFC 8292) -----
function pushDevice(name) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { name, ecdh, auth, endpoint: `${mock}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}
function decryptPush(dev, bodyB64) {
  const buf = Buffer.from(bodyB64, 'base64');
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  const secret = dev.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), dev.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, dev.auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'Padding-Trenner');
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}
function checkVapid(header, vapidPublic) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[2], vapidPublic);
  const [h, p, sig] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.aud, mock);
  assert.match(claims.sub, /^mailto:/);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 25 * 3600);
  const raw = Buffer.from(vapidPublic, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verifySig('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'VAPID-Signatur');
}
const received = async (dev) => (await getMock()).pushes.filter((x) => x.device === dev.name && x.status < 300).map((x) => ({ ...decryptPush(dev, x.body), auth: x.authorization }));
async function waitPush(dev, pred, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const found = (await received(dev)).filter(pred).pop();
    if (found) return found;
    if (Date.now() > end) throw new Error('Push kam nicht an: ' + JSON.stringify((await received(dev)).map((x) => x.title)));
    await sleep(100);
  }
}
async function waitFor2(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Zeitüberschreitung');
    await sleep(100);
  }
}

before(async () => {
  shop = spawn('php', ['-S', `127.0.0.1:${MOCK}`, join(here, 'mock-shopify.php')], { env });
  await waitFor(shop, 'Development Server');
  php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', join(serverDir, 'public'), join(serverDir, 'public/router.php')], { env });
  await waitFor(php, 'Development Server');
  await setMock({
    customers: {
      [ANNA]: { id: ANNA, email: 'anna@example.de', firstName: 'Anna', lastName: 'Berg', tags: [] },
      [BEN]: { id: BEN, email: 'ben@example.de', firstName: 'Ben', lastName: null, tags: [] },
    },
    orders: [
      order(999, { ago: 60 * DAY, amount: 80, shippedAgo: 58 * DAY, delivered: true }), // vor dem Zeitraum
      order(1001, { ago: 20 * DAY, amount: 59.9, shippedAgo: 18 * DAY, delivered: true }), // verfügbar
      order(1002, { ago: 2 * DAY, amount: 89, shippedAgo: 1 * DAY }), // unterwegs: Wartezeit
      order(1003, { ago: 1 * DAY, amount: 25, paid: false }), // unterwegs: Zahlung
      order(1004, { ago: 3 * DAY, amount: 40, cancelled: true }), // storniert
      order(1005, { ago: 4 * DAY, amount: 30, test: true, shippedAgo: 4 * DAY }), // Testbestellung
    ],
  });
});

after(() => {
  php?.kill();
  shop?.kill();
  rmSync(tmp, { recursive: true, force: true });
});

const admin = new Client();
const anna = new Client();

test('Status und Einrichtung', async () => {
  let r = await admin.req('GET', '/status');
  assert.equal(r.data.installed, false);
  assert.equal(r.data.requirements.curl.ok, true);
  r = await admin.req('POST', '/setup', { db: DBCFG }, { 'X-PC': '' });
  assert.equal(r.status, 403, 'ohne Schutz-Header');
  r = await admin.req('POST', '/setup', { db: DBCFG, admin: { name: 'Marius', email: 'marius@example.de', password: 'kurz' } });
  assert.equal(r.status, 422);
  r = await admin.req('POST', '/setup', { db: DBCFG, admin: { name: 'Marius', email: 'Marius@Example.de', password: 'geheim-12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.admin.email, 'marius@example.de');
  r = await new Client().req('POST', '/setup', { db: DBCFG, admin: { name: 'X', email: 'x@example.de', password: 'geheim-12345' } });
  assert.equal(r.status, 409);
  r = await admin.req('GET', '/admin/me');
  assert.equal(r.data.admin.name, 'Marius');
});

test('Admin: Shopify verbinden und Anmeldung einrichten', async () => {
  let r = await admin.req('PUT', '/admin/settings', { shopify: { shop: 'https://www.perfumecloud.de', client_id: 'x' } });
  assert.equal(r.status, 422, 'Shop-Domain statt myshopify-Adresse');
  r = await admin.req('PUT', '/admin/settings', { shopify: { shop: 'ks8yin-mg', client_id: 'admin-client', client_secret: 'falsch' } });
  assert.equal(r.data.shopify.test.ok, false);
  assert.match(r.data.shopify.test.message, /Client-ID oder Secret falsch/);
  r = await admin.req('PUT', '/admin/settings', { shopify: { shop: 'ks8yin-mg.myshopify.com', client_id: 'admin-client', client_secret: 'admin-secret' } });
  assert.equal(r.data.shopify.test.ok, true, JSON.stringify(r.data.shopify.test));
  assert.equal(r.data.shopify.has_secret, true);
  assert.equal(r.data.shopify.client_secret, undefined, 'Secret wird nie zurückgegeben');

  r = await admin.req('PUT', '/admin/settings', { login_shopify: { client_id: 'ca-client', client_secret: 'ca-secret' } });
  assert.equal(r.data.login_shopify.test.ok, true, JSON.stringify(r.data.login_shopify.test));
  assert.match(r.data.login_shopify.redirect_uri, /\/api\/auth\/shopify\/callback$/);

  r = await admin.req('PUT', '/admin/settings', { program: { redeem_cents: 0 } });
  assert.equal(r.status, 422);
  r = await admin.req('PUT', '/admin/settings', { program: { name: 'Perfume Cloud Club', earn_per_euro: 1, wait_days: 14, welcome_points: 50 } });
  assert.equal(r.data.program.redeem_points, 100);

  const status = await new Client().req('GET', '/status');
  assert.deepEqual(status.data.login, { shopify: true, email: false });
  assert.equal(status.data.program.name, 'Perfume Cloud Club');
});

test('Schutz: ohne Anmeldung kein Zugriff', async () => {
  const guest = new Client();
  assert.equal((await guest.req('GET', '/me')).status, 401);
  assert.equal((await guest.req('GET', '/admin/dashboard')).status, 401);
  assert.equal((await guest.req('GET', '/orders')).status, 401);
  assert.equal((await fetch(`${app}/api/cron?key=falsch`)).status, 403);
  // Rückleitung ohne passendes state-Cookie wird abgelehnt
  const res = await guest.raw(`${app}/api/auth/shopify/callback?code=abc&state=xyz`);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/anmelden\?fehler=/);
});

test('Anmeldung mit dem Shopify-Kundenkonto und Beitritt', async () => {
  await setMock({ login: { customer: ANNA, deny: false } });
  const loc = await anna.shopifyLogin('/bestellungen');
  assert.equal(loc, '/willkommen', 'neue Person kommt zuerst zum Beitritt');
  let r = await anna.req('GET', '/me');
  assert.equal(r.status, 200);
  assert.equal(r.data.member.email, 'anna@example.de');
  assert.equal(r.data.member.joined_at, null);
  assert.equal(r.data.points, undefined);
  assert.equal((await anna.req('GET', '/points')).status, 409);

  r = await anna.req('POST', '/me/join', {});
  assert.equal(r.status, 422, 'Teilnahmebedingungen nötig');
  r = await anna.req('POST', '/me/join', { terms: true });
  assert.equal(r.status, 200);
  assert.ok(r.data.member.joined_at);
  // Willkommensbonus 50 + Bestellung #1001 (59,90 € → 59 Punkte, Wartezeit vorbei)
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.balance, 109);
  assert.equal(r.data.points.pending, 89 + 25);
  assert.equal(r.data.points.to_next, 100 - 9);

  const m = await getMock();
  assert.deepEqual(m.customers[ANNA].tags, ['club']);
  assert.equal(m.metafields[`${ANNA}|club.punkte`], '109');
  assert.equal(m.metafields[`${ANNA}|club.punkte_ausstehend`], '114');

  // Bekannte Person landet direkt auf der gewünschten Seite
  const again = new Client();
  assert.equal(await again.shopifyLogin('/bestellungen'), '/bestellungen');
  // Kein offener Redirect auf fremde Seiten
  assert.equal(await again.shopifyLogin('//evil.example/'), '/');
});

test('Bestellungen mit Status, Sendungsverfolgung und Punkten', async () => {
  const r = await anna.req('GET', '/orders');
  assert.equal(r.status, 200);
  const byName = Object.fromEntries(r.data.orders.map((o) => [o.name, o]));
  assert.equal(byName['#1005'], undefined, 'Testbestellungen werden nicht gezeigt');
  assert.equal(byName['#1001'].status.label, 'Zugestellt');
  assert.equal(byName['#1001'].points.status, 'available');
  assert.equal(byName['#1001'].points.points, 59);
  assert.equal(byName['#1002'].status.label, 'Versendet');
  assert.equal(byName['#1002'].tracking[0].company, 'DHL');
  assert.match(byName['#1002'].tracking[0].url, /^https:\/\/www\.dhl\.de/);
  assert.equal(byName['#1002'].points.reason, 'wait');
  assert.deepEqual(byName['#1002'].steps.map((s) => s.done), [true, true, true, false]);
  assert.equal(byName['#1003'].status.label, 'Zahlung ausstehend');
  assert.equal(byName['#1003'].points.reason, 'payment');
  assert.equal(byName['#1004'].status.label, 'Storniert');
  assert.equal(byName['#1004'].points.status, 'void');
  assert.equal(byName['#999'].points, null, 'vor dem Beitritt (älter als 30 Tage) zählt nicht');
  assert.equal(byName['#1001'].total_cents, 6480);
});

let codeId, code;

test('Punkte einlösen: persönlicher Rabattcode in Shopify', async () => {
  let r = await anna.req('POST', '/codes', { steps: 2 });
  assert.equal(r.status, 422, '200 Punkte reichen nicht');
  r = await anna.req('POST', '/codes', { steps: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ({ id: codeId, code } = r.data.code);
  assert.match(code, /^PC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(r.data.code.value_cents, 500);
  assert.equal(r.data.code.url, `https://www.perfumecloud.de/discount/${code}`);
  assert.equal(r.data.points.balance, 9);

  const m = await getMock();
  const d = Object.values(m.discounts).find((x) => x.code === code);
  assert.ok(d, 'Rabattcode in Shopify angelegt');
  assert.deepEqual(d.input.context, { customers: { add: [ANNA] } });
  assert.equal(d.input.customerGets.value.discountAmount.amount, '5.00');
  assert.equal(d.input.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, '5.00');
  assert.equal(d.input.usageLimit, 1);
  assert.deepEqual(d.input.combinesWith, { shippingDiscounts: true, orderDiscounts: false, productDiscounts: false });
  assert.equal(m.metafields[`${ANNA}|club.punkte`], '9');

  r = await anna.req('GET', '/points');
  assert.equal(r.data.history[0].kind, 'redeem');
  assert.equal(r.data.history[0].points, -100);
  assert.equal(r.data.codes[0].status, 'active');
});

test('Code zurückgeben bucht die Punkte zurück', async () => {
  const r = await anna.req('DELETE', `/codes/${codeId}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.code.status, 'cancelled');
  assert.equal(r.data.points.balance, 109);
  const m = await getMock();
  assert.equal(Object.values(m.discounts).some((x) => x.code === code), false, 'in Shopify gelöscht');
  assert.equal((await anna.req('DELETE', `/codes/${codeId}`)).status, 404);
});

test('Fehler bei Shopify: Punkte bleiben unverändert', async () => {
  await setMock({ failDiscount: true });
  const r = await anna.req('POST', '/codes', { steps: 1 });
  assert.equal(r.status, 502);
  await setMock({ failDiscount: false });
  const p = await anna.req('GET', '/points');
  assert.equal(p.data.points.balance, 109);
  assert.equal(p.data.codes.some((c) => c.status === 'failed'), false);
});

test('Cronjob: Code benutzt, Wartezeit vorbei, Code abgelaufen', async () => {
  // Code erstellen und in einer neuen Bestellung benutzen
  let r = await anna.req('POST', '/codes', { steps: 1 });
  const used = r.data.code;
  const m = await getMock();
  m.orders.push(order(1006, { ago: 1000, amount: 45, codes: [used.code] }));
  // #1002 ist jetzt seit 20 Tagen versendet
  const o2 = m.orders.find((o) => o.name === '#1002');
  o2.fulfillments[0].createdAt = iso(20 * DAY);
  o2.updatedAt = iso(500);
  await setMock({ orders: m.orders });

  let c = await cron();
  assert.match(c.orders, /geändert/);
  r = await anna.req('GET', '/points');
  const usedNow = r.data.codes.find((x) => x.id === used.id);
  assert.equal(usedNow.status, 'used');
  assert.equal(usedNow.order_name, '#1006');
  // 109 - 100 + 89 (#1002 jetzt verfügbar)
  assert.equal(r.data.points.balance, 98);

  // Neuer Code, der abläuft
  sql("UPDATE club_ledger SET points = points + 100 WHERE kind = 'welcome'"); // genug Punkte für einen zweiten Code
  r = await anna.req('POST', '/codes', { steps: 1 });
  const exp = r.data.code;
  sql('UPDATE club_codes SET expires_at = ? WHERE id = ?', [Date.now() - 1000, exp.id]);
  c = await cron();
  assert.match(c.codes, /1 abgelaufen/);
  r = await anna.req('GET', '/points');
  assert.equal(r.data.codes.find((x) => x.id === exp.id).status, 'expired');
  assert.equal(r.data.points.balance, 198);
  assert.equal(r.data.history[0].kind, 'refund');
  const after = await getMock();
  assert.equal(Object.values(after.discounts).some((x) => x.code === exp.code), false);
  assert.equal(after.metafields[`${ANNA}|club.punkte`], '198');
});

test('Admin: Übersicht, Mitglieder und Korrektur', async () => {
  let r = await admin.req('GET', '/admin/dashboard');
  assert.equal(r.status, 200);
  assert.equal(r.data.members, 1);
  assert.equal(r.data.points.available, 198);
  assert.equal(r.data.codes.used.count, 1);
  assert.equal(r.data.codes.expired.count, 1);
  r = await admin.req('GET', '/admin/members?q=anna');
  assert.equal(r.data.members.length, 1);
  const id = r.data.members[0].id;
  assert.match(r.data.members[0].shopify_url, /admin\.shopify\.com\/store\/ks8yin-mg\/customers\/1$/);
  r = await admin.req('POST', `/admin/members/${id}/adjust`, { points: 0 });
  assert.equal(r.status, 422);
  r = await admin.req('POST', `/admin/members/${id}/adjust`, { points: 25, note: 'Danke für die Bewertung' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.balance, 223);
  const me = await anna.req('GET', '/points');
  assert.equal(me.data.history[0].title, 'Gutschrift vom Team');
  assert.equal(me.data.history[0].note, 'Danke für die Bewertung');
  // Kundinnen-Sitzung öffnet den Admin-Bereich nicht
  assert.equal((await anna.req('GET', '/admin/dashboard')).status, 401);
});

test('Anmeldung per E-Mail-Code (Ausweichweg)', async () => {
  const guest = new Client();
  let r = await guest.req('POST', '/auth/code', { email: 'neu@example.de' });
  assert.equal(r.status, 503, 'standardmäßig aus');
  await admin.req('PUT', '/admin/settings', { login_email: true });
  r = await guest.req('POST', '/auth/code', { email: 'keine-mail' });
  assert.equal(r.status, 422);
  r = await guest.req('POST', '/auth/code', { email: 'Neu@Example.de' });
  assert.equal(r.status, 200);
  const mail = readFileSync(mailLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
  assert.equal(mail.to, 'neu@example.de');
  const codeMatch = /(\d{6})/.exec(mail.subject);
  assert.ok(codeMatch);
  r = await guest.req('POST', '/auth/code/verify', { email: 'neu@example.de', code: '000000' === codeMatch[1] ? '111111' : '000000' });
  assert.equal(r.status, 401);
  r = await guest.req('POST', '/auth/code/verify', { email: 'neu@example.de', code: codeMatch[1] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.member.email, 'neu@example.de');
  const m = await getMock();
  assert.ok(Object.values(m.customers).some((c) => c.email === 'neu@example.de'), 'Shopify-Kundenkonto angelegt');
  // derselbe Code gilt nur einmal
  r = await new Client().req('POST', '/auth/code/verify', { email: 'neu@example.de', code: codeMatch[1] });
  assert.equal(r.status, 401);
});

test('Öffentlicher Client ohne Secret (PKCE)', async () => {
  let r = await admin.req('PUT', '/admin/settings', { login_shopify: { client_id: 'ca-client', clear_secret: true } });
  assert.equal(r.data.login_shopify.has_secret, false);
  await setMock({ login: { customer: BEN, deny: false } });
  const ben = new Client();
  assert.equal(await ben.shopifyLogin('/'), '/willkommen');
  r = await ben.req('GET', '/me');
  assert.equal(r.data.member.first_name, 'Ben');
  // Abbruch auf der Shopify-Seite
  await setMock({ login: { customer: BEN, deny: true } });
  const res = await new Client().raw(`${app}/api/auth/shopify/start`);
  const back = await new Client().raw(res.headers.get('location'));
  assert.match(back.headers.get('location'), /error=access_denied/);
});

// ===================== Version 1.1: Push, Stufen, Aktionen, Boni, Verfall, Team-App =====================

const annaPhone = pushDevice('anna');
let annaId, vapid;
const CLARA = 'gid://shopify/Customer/3';
const DORA = 'gid://shopify/Customer/4';
const clara = new Client();
const dora = new Client();

test('Push: Abo, Verschlüsselung und Mitteilung bei jeder Gutschrift und jedem Abzug', async () => {
  // Ruhezeit aus, damit sofort verschickt wird
  let r = await admin.req('PUT', '/admin/push', { quiet: { start: 0, end: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await anna.req('GET', '/push/key');
  vapid = r.data.key;
  assert.equal(Buffer.from(vapid, 'base64url').length, 65);
  r = await anna.req('POST', '/push/subscribe', { endpoint: 'http://evil.example/x', keys: annaPhone.keys });
  assert.equal(r.status, 422);
  r = await anna.req('POST', '/push/subscribe', { endpoint: annaPhone.endpoint, keys: annaPhone.keys }, { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  assert.equal(r.data.devices, 1);

  r = await anna.req('POST', '/push/test');
  assert.equal(r.data.results.length, 1);
  assert.deepEqual(r.data.results[0], { device: 'iPhone Safari', ok: true, status: 201, reason: '' });
  const t = await waitPush(annaPhone, (x) => x.title === 'Push funktioniert');
  checkVapid(t.auth, vapid);
  const raw = (await getMock()).pushes.find((x) => x.device === 'anna');
  assert.equal(raw.encoding, 'aes128gcm');

  const list = await admin.req('GET', '/admin/members?q=anna');
  annaId = list.data.members[0].id;
  assert.equal(list.data.members[0].tier, 'silber', '193,90 € in 12 Monaten');

  await admin.req('POST', `/admin/members/${annaId}/adjust`, { points: 30, note: 'Danke für dein Foto', kind: 'bonus' });
  let p = await waitPush(annaPhone, (x) => x.title === '+30 Punkte');
  assert.equal(p.body, 'Danke für dein Foto. Dein Kontostand: 253 Punkte.');
  assert.equal(p.url, '/praemien');
  await admin.req('POST', `/admin/members/${annaId}/adjust`, { points: -3, note: 'Doppelt gebucht' });
  p = await waitPush(annaPhone, (x) => x.title === '−3 Punkte');
  assert.equal(p.body, 'Doppelt gebucht. Dein Kontostand: 250 Punkte.');

  // Kategorie „Punkte“ abbestellt → keine Mitteilung
  r = await anna.req('PUT', '/push/prefs', { points: false });
  assert.equal(r.data.prefs.points, false);
  const before = (await received(annaPhone)).length;
  await admin.req('POST', `/admin/members/${annaId}/adjust`, { points: 3, note: 'Zurück' });
  await sleep(500);
  assert.equal((await received(annaPhone)).length, before);
  await anna.req('PUT', '/push/prefs', { points: true });
});

test('Push: abgemeldete Geräte verschwinden, Fehler bleiben sichtbar', async () => {
  const gone = pushDevice('gone');
  const bad = pushDevice('bad');
  await setMock({ pushStatus: { gone: 410, bad: 403 } });
  await anna.req('POST', '/push/subscribe', { endpoint: gone.endpoint, keys: gone.keys });
  await anna.req('POST', '/push/subscribe', { endpoint: bad.endpoint, keys: bad.keys });
  let r = await anna.req('POST', '/push/test');
  assert.equal(r.data.devices, 3);
  assert.deepEqual(r.data.results.map((x) => x.reason).sort(), ['', 'BadJwtToken', 'Gerät abgemeldet']);
  r = await admin.req('GET', '/admin/push');
  assert.equal(r.data.stats.devices, 2, 'abgemeldetes Gerät entfernt, fehlerhaftes bleibt');
  assert.equal(r.data.stats.errors[0].error, 'BadJwtToken');
  assert.equal(r.data.stats.errors[0].status, 403);
  await anna.req('POST', '/push/unsubscribe', { endpoint: bad.endpoint });
  assert.equal((await anna.req('GET', '/me')).data.push.devices, 1);
});

test('Push-Vorlagen sind im Admin-Bereich änderbar', async () => {
  let r = await admin.req('GET', '/admin/push');
  const tpl = r.data.templates.find((x) => x.key === 'points_credited');
  assert.deepEqual(tpl.vars, ['vorname', 'punkte', 'grund', 'kontostand']);
  r = await admin.req('PUT', '/admin/push', { templates: { points_credited: { title: 'Juhu, +{punkte}', body: '{grund} – jetzt {kontostand}.', enabled: true } } });
  assert.equal(r.data.templates.find((x) => x.key === 'points_credited').title, 'Juhu, +{punkte}');
  assert.equal(r.data.templates.find((x) => x.key === 'points_deducted').title, '−{punkte} Punkte', 'andere bleiben');
  await admin.req('POST', `/admin/members/${annaId}/adjust`, { points: 7, note: 'Test' });
  const p = await waitPush(annaPhone, (x) => x.title === 'Juhu, +7');
  assert.equal(p.body, 'Test – jetzt 260.');
  // Testnachricht mit Vorlage an die eigenen Geräte (Admin ohne Club-Konto)
  r = await admin.req('POST', '/admin/push/test', { template: 'tier_up' });
  assert.equal(r.status, 409);
  // Leer = Standardtext
  r = await admin.req('PUT', '/admin/push', { templates: { points_credited: { title: '', body: '' } } });
  assert.equal(r.data.templates.find((x) => x.key === 'points_credited').title, '+{punkte} Punkte');
});

test('Stufen: Silber bringt 1,5 Punkte pro Euro', async () => {
  // Die Tests laufen in Sekunden: Beitritt eine Minute zurückdatieren, damit neue Bestellungen „danach“ liegen
  sql('UPDATE club_members SET joined_at = joined_at - 60000 WHERE id = ?', [annaId]);
  let r = await anna.req('GET', '/me');
  assert.equal(r.data.tier.key, 'silber');
  assert.equal(r.data.tier.rate, 1.5);
  assert.equal(r.data.tier.next.key, 'gold');
  assert.equal(r.data.tier.next.missing_cents, 40000 - 19390);
  assert.ok(r.data.tier.until > Date.now() + 360 * DAY);
  const m = await getMock();
  // nach dem Beitritt bestellt (frühere Bestellungen zählen mit dem Grundsatz)
  const o = order(1007, { ago: 1000, amount: 100, shippedAgo: 15 * DAY, delivered: true });
  m.orders.push(o);
  await setMock({ orders: m.orders });
  await cron();
  r = await anna.req('GET', '/points');
  const h = r.data.history.find((x) => x.title === 'Bestellung #1007');
  assert.equal(h.points, 150);
  assert.equal(h.rate, 1.5);
  const p = await waitPush(annaPhone, (x) => x.title === '+150 Punkte');
  // „Prämie bereit“ wird an die Gutschrift angehängt statt einer zweiten Mitteilung
  assert.equal(p.body, 'Bestellung #1007. Dein Kontostand: 410 Punkte. Du hast jetzt 20 € Rabatt bereit.');
  // Kein Versand-Push für alte Sendungen
  assert.equal((await received(annaPhone)).some((x) => /#1007/.test(x.body) && x.title.includes('unterwegs')), false);
  assert.equal((await getMock()).metafields[`${ANNA}|club.stufe`], 'silber', 'Schlüssel (für Segmente), Name kommt aus club.programm');
});

test('Aktion: doppelte Punkte mit Push zum Start und Regeln im Shop', async () => {
  const now = Date.now();
  let r = await admin.req('POST', '/admin/promotions', { name: 'Launch-Woche', factor: 0.5, starts_at: now - 3600e3, ends_at: now + DAY });
  assert.equal(r.status, 422);
  r = await admin.req('POST', '/admin/promotions', { name: 'Launch-Woche', factor: 2, starts_at: now - 3600e3, ends_at: now + 2 * DAY, push: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.promotions[0].state, 'running');
  const p = await waitPush(annaPhone, (x) => x.title === 'Launch-Woche: doppelte Punkte');
  assert.match(p.body, /^Bis \d{2}\.\d{2}\.\d{4} sammelst du doppelte Punkte auf jede Bestellung\.$/);
  r = await new Client().req('GET', '/status');
  assert.equal(r.data.program.promo.factor, 2);

  // 20 € × 1,5 (Silber) × 2 (Aktion) = 60 Punkte
  const m = await getMock();
  const o = order(1008, { ago: 1000, amount: 20 });
  m.orders.push(o);
  await setMock({ orders: m.orders });
  await cron();
  r = await anna.req('GET', '/points');
  const h = r.data.history.find((x) => x.title === 'Bestellung #1008');
  assert.equal(h.points, 60);
  assert.equal(h.factor, 2);
  assert.equal(h.status, 'pending');

  // Shop-Metafeld club.programm: Stufen und Aktion für die Punkteanzeige im Warenkorb
  const prog = await waitFor2(async () => {
    const v = (await getMock()).metafields['gid://shopify/Shop/1|club.programm'];
    return v && JSON.parse(v).promos.length ? JSON.parse(v) : null;
  });
  assert.deepEqual(prog.tiers.map((t) => [t.key, t.rate, t.min_cents]), [['bronze', 1, 0], ['silber', 1.5, 15000], ['gold', 2, 40000]]);
  assert.equal(prog.promos[0].factor, 2);
  // Segment „Club: Prämie einlösbar“ wird angelegt und folgt der Einlöse-Schwelle
  const segment = async (q) => waitFor2(async () => Object.values((await getMock()).segments || {}).find((s) => s.name === 'Club: Prämie einlösbar' && s.query === q));
  assert.ok(await segment("customer_tags CONTAINS 'club' AND metafields.club.punkte >= 100"));
  await admin.req('PUT', '/admin/settings', { program: { redeem_points: 150 } });
  const seg = await segment("customer_tags CONTAINS 'club' AND metafields.club.punkte >= 150");
  assert.ok(seg, 'Segment folgt der neuen Schwelle');
  assert.equal(Object.values((await getMock()).segments).length, 1, 'kein zweites Segment');
  await admin.req('PUT', '/admin/settings', { program: { redeem_points: 100 } });
  await segment("customer_tags CONTAINS 'club' AND metafields.club.punkte >= 100");
  r = await admin.req('GET', '/admin/dashboard');
  assert.equal(r.data.shop_program.ok, true);
  assert.equal(r.data.promotion.name, 'Launch-Woche');
});

test('Warteliste: Einladung per Mail und Startbonus nach der ersten Bestellung', async () => {
  const m = await getMock();
  m.customers[CLARA] = { id: CLARA, email: 'clara@example.de', firstName: 'Clara', lastName: 'Sommer', tags: ['warteliste'], marketing: 'SUBSCRIBED' };
  m.customers[DORA] = { id: DORA, email: 'dora@example.de', firstName: 'Dora', lastName: null, tags: [] };
  await setMock({ customers: m.customers });

  let r = await admin.req('POST', '/admin/invites/load');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.found, 1);
  assert.equal(r.data.counts.new, 1);
  assert.equal(r.data.start_bonus.points, 100);
  r = await admin.req('POST', '/admin/invites/test');
  assert.equal(r.data.sent, true);
  assert.match(mails().pop().subject, /^\[Test\] Der Perfume Cloud Club ist da/);
  r = await admin.req('POST', '/admin/invites/start');
  assert.equal(r.data.queued, 1);
  const mail = await waitMail((x) => x.to === 'clara@example.de');
  assert.match(mail.text, /^Hallo Clara,/);
  assert.match(mail.text, /100 Punkte Startbonus/);
  assert.match(mail.text, /die Punkte werden mit deiner ersten Bestellung frei/);
  assert.match(mail.text, /\/\?von=warteliste/);
  assert.equal(mail.html, true);
  assert.equal((await admin.req('GET', '/admin/invites')).data.counts.sent, 1);

  await setMock({ login: { customer: CLARA, deny: false } });
  assert.equal(await clara.shopifyLogin('/'), '/willkommen');
  r = await clara.req('POST', '/me/join', { terms: true });
  // Willkommen 50 + Newsletter 25; Startbonus wartet auf die erste Bestellung
  assert.equal(r.data.points.balance, 75);
  assert.equal(r.data.points.locked, 100);
  assert.equal(r.data.bonus.newsletter, true);
  assert.equal((await admin.req('GET', '/admin/invites')).data.counts.joined, 1);
  const welcome = await waitMail((x) => x.to === 'clara@example.de' && /^Willkommen/.test(x.subject));
  assert.match(welcome.text, /100 Punkte Startbonus/);

  const m2 = await getMock();
  const o = order(2001, { ago: 20 * DAY, amount: 30, shippedAgo: 18 * DAY, delivered: true, customer: CLARA });
  o.updatedAt = iso(500);
  m2.orders.push(o);
  await setMock({ orders: m2.orders });
  await cron();
  r = await clara.req('GET', '/me');
  assert.equal(r.data.points.balance, 75 + 30 + 100);
  assert.equal(r.data.points.locked, 0);
  assert.equal(r.data.tier.key, 'bronze');
});

test('Empfehlung: Freundin und werbendes Mitglied bekommen Punkte', async () => {
  let r = await anna.req('GET', '/me');
  const code = r.data.bonus.referral.code;
  assert.match(code, /^[A-Z2-9]{6}$/);
  r = await new Client().req('GET', `/einladung/${code}`);
  assert.deepEqual(r.data, { name: 'Anna B.', points: 100 });
  assert.equal((await new Client().req('GET', '/einladung/XXXXXX')).status, 404);

  await setMock({ login: { customer: DORA, deny: false } });
  assert.equal(await dora.shopifyLogin('/'), '/willkommen');
  r = await dora.req('POST', '/me/join', { terms: true, einladung: code.toLowerCase() });
  assert.equal(r.data.points.balance, 50);
  assert.equal(r.data.points.locked, 100);
  const annaBefore = (await anna.req('GET', '/me')).data.points.balance;

  const m = await getMock();
  const o = order(3001, { ago: 16 * DAY, amount: 50, shippedAgo: 15 * DAY, delivered: true, customer: DORA });
  o.updatedAt = iso(500);
  m.orders.push(o);
  await setMock({ orders: m.orders });
  await cron();
  r = await dora.req('GET', '/me');
  assert.equal(r.data.points.balance, 50 + 50 + 100);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.balance, annaBefore + 100);
  assert.equal(r.data.bonus.referral.invited, 1);
  assert.equal(r.data.bonus.referral.rewarded, 1);
  const p = await waitPush(annaPhone, (x) => x.title === 'Danke fürs Weitersagen');
  assert.equal(p.body, 'Dora hat zum ersten Mal bestellt. Dafür bekommst du 100 Punkte.');
});

test('Geburtstag: Bonus einmal im Jahr', async () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const today = `${parts.month}-${parts.day}`;
  let r = await dora.req('POST', '/me/birthday', { birthday: '13-45' });
  assert.equal(r.status, 422);
  r = await dora.req('POST', '/me/birthday', { birthday: today });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.bonus.birthday, today);
  assert.equal((await dora.req('POST', '/me/birthday', { birthday: '01-01' })).status, 409);
  // Frisch eingetragen: noch kein Bonus (sonst könnte man ihn sich jeden Tag holen)
  daily();
  await cron();
  assert.equal((await dora.req('GET', '/me')).data.points.balance, 200);
  sql('UPDATE club_members SET birthday_set_at = ? WHERE email = ?', [Date.now() - 40 * DAY, 'dora@example.de']);
  daily();
  await cron();
  r = await dora.req('GET', '/points');
  assert.equal(r.data.points.balance, 250);
  assert.equal(r.data.history[0].kind, 'birthday');
  daily();
  await cron();
  assert.equal((await dora.req('GET', '/me')).data.points.balance, 250, 'nur einmal im Jahr');
});

test('Bewertung: Anfrage und Freigabe durch das Team', async () => {
  let r = await dora.req('POST', '/me/review', { note: 'x' });
  assert.equal(r.status, 422);
  r = await dora.req('POST', '/me/review', { note: 'Amber Nights bei Google bewertet' });
  assert.equal(r.data.claims[0].status, 'open');
  r = await admin.req('GET', '/admin/claims');
  assert.equal(r.data.claims.length, 1);
  assert.equal(r.data.claims[0].member.email, 'dora@example.de');
  r = await admin.req('POST', `/admin/claims/${r.data.claims[0].id}`, { approve: true });
  assert.deepEqual(r.data.claims, []);
  r = await dora.req('GET', '/me');
  assert.equal(r.data.points.balance, 275);
  assert.equal(r.data.bonus.claims[0].status, 'approved');
  assert.equal(r.data.bonus.claims[0].points, 25);
});

test('Verfall: Punkte verfallen nach der eingestellten Frist, vorher kommt ein Hinweis', async () => {
  let r = await admin.req('PUT', '/admin/settings', { program: { points_expiry_months: 1 } });
  assert.equal(r.data.program.points_expiry_months, 1);
  const doraId = sql('SELECT id FROM club_members WHERE email = ?', ['dora@example.de'])[0].id;
  sql("UPDATE club_ledger SET credited_at = ?, created_at = ? WHERE member_id = ? AND kind = 'welcome'", [Date.now() - 40 * DAY, Date.now() - 40 * DAY, doraId]);
  daily();
  const c = await cron();
  assert.match(c.expiry, /^50 Punkte verfallen/);
  r = await dora.req('GET', '/points');
  assert.equal(r.data.points.balance, 225);
  assert.equal(r.data.history[0].kind, 'expire');
  assert.equal(r.data.history[0].points, -50);
  // Die Bestellung (gestern gutgeschrieben) verfällt in einem Monat – das liegt in der Warnfrist von 30 Tagen
  assert.equal(r.data.points.expiring.points, 50);
  assert.ok(r.data.points.expiring.at < Date.now() + 31 * DAY);
  // Erneuter Lauf bucht nichts doppelt
  daily();
  await cron();
  assert.equal((await dora.req('GET', '/me')).data.points.balance, 225);
  await admin.req('PUT', '/admin/settings', { program: { points_expiry_months: 24 } });
});

test('Admin wird an der E-Mail erkannt und sieht die App wie ein Mitglied', async () => {
  let r = await admin.req('POST', '/admin/access', { name: 'Anna Team', email: 'anna@example.de', password: 'geheim-12345' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const teamAnna = r.data.club.find((x) => x.email === 'anna@example.de');
  await setMock({ login: { customer: ANNA, deny: false } });
  const c = new Client();
  assert.equal(await c.shopifyLogin('/'), '/admin', 'Admin landet direkt im Admin-Bereich');
  r = await c.req('GET', '/admin/me');
  assert.equal(r.data.admin.email, 'anna@example.de');
  assert.equal(r.data.own_member_id, annaId);
  // Mit Wunschziel bleibt es beim Ziel
  assert.equal(await new Client().shopifyLogin('/bestellungen'), '/bestellungen');

  // Vorschau: Admin sieht die App wie Anna – nur lesen
  r = await admin.req('GET', '/me', null, { 'X-Als': annaId });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.email, 'anna@example.de');
  assert.equal(r.data.preview, true);
  assert.equal((await admin.req('POST', '/codes', { steps: 1 }, { 'X-Als': annaId })).status, 403);
  assert.equal((await new Client().req('GET', '/me', null, { 'X-Als': annaId })).status, 401, 'ohne Admin-Sitzung keine Vorschau');
  r = await admin.req('DELETE', `/admin/access/${teamAnna.id}`);
  assert.equal(r.data.club.some((x) => x.email === 'anna@example.de'), false);
  assert.equal((await c.req('GET', '/admin/me')).status, 401);
});

test('Team-App: Statistik, Nachricht an Mitglieder mit Prüfung und Freigabe, Feedback, Einmal-Anmeldung', async () => {
  const key = setting('internal_key');
  const internal = (method, path, body) => fetch(`${app}/api/internal${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Club-Key': key }, body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert.equal((await fetch(`${app}/api/internal/stats`, { headers: { 'X-Club-Key': 'falsch' } })).status, 403);

  let r = await internal('GET', '/stats');
  assert.equal(r.status, 200);
  assert.equal(r.data.members, 3);
  assert.deepEqual(r.data.tiers.map((t) => [t.key, t.count]), [['bronze', 2], ['silber', 1], ['gold', 0]]);
  assert.equal(r.data.bonus.start.count, 1);
  assert.equal(r.data.bonus.referral.points, 100);
  assert.equal(r.data.bonus.birthday.count, 1);
  assert.equal(r.data.points.expired, 50);
  assert.equal(r.data.codes.used.count, 1);
  assert.ok(r.data.points.earned > 0);
  assert.equal(r.data.points.redeemed, 100, 'drei Codes, zwei davon zurückgebucht');

  const lena = { id: 'team-lena', name: 'Lena', email: 'lena@example.de' };
  const tom = { id: 'team-tom', name: 'Tom', email: 'tom@example.de' };
  r = await internal('GET', '/broadcasts');
  assert.ok(r.data.templates.some((t) => t.key === 'release'));
  assert.equal(r.data.audiences.find((a) => a.key === 'all').count, 1, 'nur Anna hat Mitteilungen an');
  r = await internal('POST', '/broadcasts', { user: lena, template: 'release', title: 'Neu: {duft}', body: 'Text', audience: 'all' });
  assert.equal(r.status, 422, 'Platzhalter nicht ausgefüllt');
  r = await internal('POST', '/broadcasts', { user: lena, template: 'release', title: 'Neu: Amber Nights', body: '{vorname}, unser neuer Duft Amber Nights ist da.', url: 'https://www.perfumecloud.de/products/amber-nights', audience: 'all' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.id;
  assert.equal(r.data.status, 'draft');
  r = await internal('POST', `/broadcasts/${id}/submit`, { user: lena });
  assert.equal(r.data.status, 'review');
  r = await internal('POST', `/broadcasts/${id}/reject`, { user: tom, note: 'Bitte mit Preis' });
  assert.equal(r.data.status, 'draft');
  assert.equal(r.data.review_note, 'Tom: Bitte mit Preis');
  r = await internal('PUT', `/broadcasts/${id}`, { user: lena, template: 'release', title: 'Neu: Amber Nights', body: '{vorname}, unser neuer Duft Amber Nights ist da – ab 89 €.', url: 'https://www.perfumecloud.de/products/amber-nights', audience: 'all' });
  await internal('POST', `/broadcasts/${id}/submit`, { user: lena });
  await admin.req('PUT', '/admin/settings', { broadcast_four_eyes: true });
  r = await internal('POST', `/broadcasts/${id}/approve`, { user: lena });
  assert.equal(r.status, 403, 'Vier-Augen-Prinzip');
  r = await internal('POST', `/broadcasts/${id}/approve`, { user: tom });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'sent');
  assert.equal(r.data.recipients, 1);
  assert.equal(r.data.approved_by_name, 'Tom');
  const p = await waitPush(annaPhone, (x) => x.title === 'Neu: Amber Nights');
  assert.equal(p.body, 'Anna, unser neuer Duft Amber Nights ist da – ab 89 €.');
  assert.equal(p.url, 'https://www.perfumecloud.de/products/amber-nights');
  assert.equal((await internal('DELETE', `/broadcasts/${id}`)).status, 409, 'Verschicktes bleibt im Verlauf');

  // Feedback-Anfrage → Seite „Feedback“ in der App → Mail an info@
  r = await internal('POST', '/broadcasts', { user: lena, kind: 'feedback', template: 'feedback', title: 'Wie gefällt dir der Club?', body: 'Sag uns in 10 Sekunden, wie es dir gefällt.', audience: 'all' });
  const fid = r.data.id;
  await internal('POST', `/broadcasts/${fid}/submit`, { user: lena });
  r = await internal('POST', `/broadcasts/${fid}/approve`, { user: tom });
  assert.equal(r.data.status, 'sent');
  const fp = await waitPush(annaPhone, (x) => x.title === 'Wie gefällt dir der Club?');
  assert.equal(fp.url, `/feedback?anfrage=${fid}`);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.feedback.id, fid);
  assert.equal((await anna.req('POST', '/feedback', { rating: 'super' })).status, 422);
  r = await anna.req('POST', '/feedback', { rating: 'gut', text: 'Die Punkte im Warenkorb sind toll', anfrage: fid });
  assert.equal(r.status, 200);
  const fm = await waitMail((x) => x.to === 'info@perfumecloud.de');
  assert.equal(fm.subject, 'Club-Feedback: Gut von Anna Berg');
  assert.equal(fm.reply_to, 'anna@example.de');
  assert.match(fm.text, /Anfrage: Wie gefällt dir der Club\?/);
  assert.match(fm.text, /Die Punkte im Warenkorb sind toll/);
  assert.equal((await anna.req('GET', '/me')).data.feedback, null);
  assert.equal((await anna.req('POST', '/feedback', { rating: 'gut', anfrage: fid })).status, 409);
  r = await internal('GET', '/broadcasts');
  assert.equal(r.data.broadcasts.find((b) => b.id === fid).answers, 1);
  r = await admin.req('GET', '/admin/feedback');
  assert.equal(r.data.items[0].rating, 'gut');
  assert.equal(r.data.stats.gut, 1);
  await admin.req('PUT', '/admin/settings', { broadcast_four_eyes: false });

  // Einmal-Anmeldung aus der Team-App
  r = await internal('POST', '/sso', { user: tom });
  assert.equal(r.status, 403);
  r = await internal('POST', '/sso', { user: { id: 'x', name: 'Marius', email: 'marius@example.de' } });
  const url = r.data.url.replace(/^https?:\/\/[^/]+/, app);
  const c = new Client();
  let res = await c.raw(url);
  assert.equal(res.headers.get('location'), '/admin');
  assert.equal((await c.req('GET', '/admin/me')).data.admin.email, 'marius@example.de');
  res = await new Client().raw(url);
  assert.match(res.headers.get('location'), /^\/admin\/anmelden\?fehler=/, 'Link gilt nur einmal');
});

test('Admin: Mitglied mit Stufe, Boni und Push-Verlauf', async () => {
  let r = await admin.req('GET', '/admin/members?stufe=silber');
  assert.deepEqual(r.data.members.map((x) => x.email), ['anna@example.de']);
  r = await admin.req('GET', `/admin/members/${annaId}`);
  assert.equal(r.data.member.tier, 'silber');
  assert.equal(r.data.member.invited, 1);
  assert.equal(r.data.member.devices, 1);
  assert.ok(r.data.pushes.length > 3);
  r = await admin.req('PUT', `/admin/members/${annaId}`, { tier: 'gold' });
  assert.equal(r.data.member.tier, 'gold');
  r = await admin.req('PUT', `/admin/members/${annaId}`, { birthday: '02-30' });
  assert.equal(r.status, 422);
  r = await admin.req('GET', '/admin/dashboard');
  assert.equal(r.data.open_claims, 0);
  assert.equal(r.data.push.devices, 1);
  assert.ok(r.data.checklist.some((x) => x.key === 'team_db' && x.ok === false));
});

test('Abmelden und Austreten', async () => {
  let r = await anna.req('POST', '/auth/logout');
  assert.equal(r.status, 200);
  assert.match(r.data.logout_url, /\/authentication\/logout\?id_token_hint=/);
  assert.equal((await anna.req('GET', '/me')).status, 401);

  await setMock({ login: { customer: ANNA, deny: false } });
  assert.equal(await anna.shopifyLogin('/'), '/');
  r = await anna.req('DELETE', '/me');
  assert.equal(r.status, 200);
  assert.equal((await anna.req('GET', '/me')).status, 401);
  const m = await getMock();
  assert.deepEqual(m.customers[ANNA].tags, []);
  assert.equal(m.metafields[`${ANNA}|club.punkte`], undefined);
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_ledger WHERE member_id = ?', [annaId])[0].n, 0);
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_push_subs WHERE member_id = ?', [annaId])[0].n, 0);
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_members WHERE referred_by = ?', [annaId])[0].n, 0);
  const d = await admin.req('GET', '/admin/dashboard');
  assert.equal(d.data.members, 2);
});

test('Keine Geheimnisse im Klartext in der Datenbank', () => {
  const rows = sql("SELECT k, v FROM club_settings WHERE k IN ('shopify_secret', 'shopify_token')");
  for (const r of rows) {
    assert.ok(!r.v.includes('admin-secret') && !r.v.includes('shpat_mock'), r.k);
  }
  assert.ok(existsSync(env.CLUB_CONFIG));
});

test('Gemeinsame Datenbank mit der Team-App: Umzug, Anmeldung mit Team-Konten, Rechte', async () => {
  const teamDb = join(tmp, 'team.sqlite');
  const teamCfg = join(tmp, 'team-config.php');
  // Datenbank der Team-App (Tabelle users wie dort, plus eine eigene Tabelle settings ohne Präfix)
  if (!MY) execFileSync('php', ['-r', `
    $pdo = new PDO('sqlite:' . $argv[1]);
    $pdo->exec("CREATE TABLE users (id VARCHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(190) NOT NULL, password_hash VARCHAR(255) NOT NULL, color VARCHAR(20) NOT NULL DEFAULT 'blue', role VARCHAR(20) NOT NULL DEFAULT 'member', prefs TEXT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted SMALLINT NOT NULL DEFAULT 0)");
    $pdo->exec("CREATE TABLE settings (k VARCHAR(100) PRIMARY KEY, v TEXT)");
    $st = $pdo->prepare("INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)");
    $st->execute(['u-lena', 'Lena', 'Lena@Example.de', password_hash('team-pass-123', PASSWORD_DEFAULT), 'admin']);
    $st->execute(['u-tom', 'Tom', 'tom@example.de', password_hash('team-pass-456', PASSWORD_DEFAULT), 'member']);
  `, teamDb]);
  const teamDbCfg = MY ? mysqlDb(`team_t_${suffix}`) : { driver: 'sqlite', path: teamDb };
  if (MY) {
    // Wie die Team-App auf netcup: MySQL, Tabelle users, eigene Tabelle settings
    execFileSync('php', ['-r', `
      $c = json_decode($argv[1], true);
      $pdo = new PDO("mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass']);
      $pdo->exec("CREATE TABLE users (id VARCHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(190) NOT NULL, password_hash VARCHAR(255) NOT NULL, color VARCHAR(20) NOT NULL DEFAULT 'blue', role VARCHAR(20) NOT NULL DEFAULT 'member', prefs TEXT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted SMALLINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
      $pdo->exec("CREATE TABLE settings (k VARCHAR(100) PRIMARY KEY, v TEXT) ENGINE=InnoDB");
      $st = $pdo->prepare("INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)");
      $st->execute(['u-lena', 'Lena', 'Lena@Example.de', password_hash('team-pass-123', PASSWORD_DEFAULT), 'admin']);
      $st->execute(['u-tom', 'Tom', 'tom@example.de', password_hash('team-pass-456', PASSWORD_DEFAULT), 'member']);
    `, JSON.stringify(teamDbCfg)]);
  }
  const phpArr = (o) => '[' + Object.entries(o).map(([k, v]) => `'${k}' => ${typeof v === 'number' ? v : JSON.stringify(String(v)).replace(/\$/g, '\\$')}`).join(', ') + ']';
  writeFileSync(teamCfg, `<?php\nreturn ['db' => ${phpArr(teamDbCfg)}, 'app_key' => 'x', 'cron_key' => 'y', 'base_url' => 'https://team.example.de'];\n`);

  let r = await admin.req('GET', '/admin/database');
  assert.equal(r.data.mode, MY ? 'mysql' : 'sqlite');
  r = await admin.req('POST', '/admin/database/move', { config: join(tmp, 'gibt-es-nicht.php') });
  assert.equal(r.status, 422);
  const before = sql('SELECT COUNT(*) AS n FROM club_members')[0].n;
  r = await admin.req('POST', '/admin/database/move', { config: teamCfg });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.counts.club_members, before);
  assert.equal(r.data.status.mode, 'team');
  assert.equal(r.data.status.team_users, true);
  assert.equal((await admin.req('POST', '/admin/database/move', { config: teamCfg })).status, 409);

  // Alles läuft weiter – jetzt aus der Datenbank der Team-App
  r = await admin.req('GET', '/admin/dashboard');
  assert.equal(r.data.members, 2);
  assert.ok(r.data.checklist.find((x) => x.key === 'team_db').ok);
  r = await clara.req('GET', '/me');
  assert.equal(r.data.points.balance, 205);
  assert.equal(sql('SELECT COUNT(*) AS n FROM users')[0].n, 2, 'helper liest jetzt die Team-Datenbank');
  assert.equal(sql("SELECT v FROM settings WHERE k = 'x'").length, 0, 'Tabelle settings der Team-App unberührt');

  // Team-Admins melden sich mit ihrem Team-Passwort an; Mitglieder brauchen das Club-Recht
  const lena = new Client();
  r = await lena.req('POST', '/admin/login', { email: 'lena@example.de', password: 'team-pass-123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.admin.source, r.data.admin.manage], ['team', true]);
  const tom = new Client();
  assert.equal((await tom.req('POST', '/admin/login', { email: 'tom@example.de', password: 'team-pass-456' })).status, 401);
  r = await lena.req('GET', '/admin/access');
  assert.equal(r.data.team_mode, true);
  assert.equal(r.data.team_url, 'https://team.example.de');
  assert.deepEqual(r.data.team.map((u) => [u.name, u.access]), [['Lena', true], ['Tom', false]]);
  r = await lena.req('PUT', '/admin/access/team/u-tom', { access: true });
  assert.equal(r.data.team.find((u) => u.id === 'u-tom').access, true);
  r = await tom.req('POST', '/admin/login', { email: 'tom@example.de', password: 'team-pass-456' });
  assert.equal(r.status, 200);
  assert.equal(r.data.admin.manage, false, 'Club-Recht ohne Admin-Rolle: keine Zugänge verwalten');
  assert.equal((await tom.req('PUT', '/admin/access/team/u-tom', { access: false })).status, 403);
  assert.equal((await lena.req('PUT', '/admin/access/team/u-lena', { access: false })).status, 422);
  await lena.req('PUT', '/admin/access/team/u-tom', { access: false });
  assert.equal((await tom.req('GET', '/admin/me')).status, 401, 'Sitzung endet beim Entzug');

  // Einmal-Anmeldung aus der Team-App mit der Team-ID
  const key = setting('internal_key');
  r = await fetch(`${app}/api/internal/sso`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Club-Key': key }, body: JSON.stringify({ user: { id: 'u-lena', name: 'Lena', email: 'andere@example.de' } }) }).then((x) => x.json());
  const c = new Client();
  await c.raw(r.url.replace(/^https?:\/\/[^/]+/, app));
  assert.equal((await c.req('GET', '/admin/me')).data.admin.name, 'Lena');
  // Marius (eigener Club-Zugang) kommt weiterhin rein
  assert.equal((await admin.req('GET', '/admin/me')).status, 200);
});

test('Keine unerwarteten Fehler im Protokoll', () => {
  const log = existsSync(join(tmp, 'app.log')) ? readFileSync(join(tmp, 'app.log'), 'utf8') : '';
  const bad = log.split('\n').filter((l) => /API-Fehler|Deferred:|Job:|Warning|Notice/.test(l));
  assert.deepEqual(bad, []);
});
