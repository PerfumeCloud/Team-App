// Integrationstests für die Kunden-App (PHP-Backend mit SQLite und einem Shopify-Nachbau).
// Aufruf: node --test kunden-app/server/tests/*.test.mjs   (PHP 8.1+ nötig)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify as verifySig, createHmac } from 'node:crypto';
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
    lineItems: { nodes: [{ title: 'Sunset Dune', variantTitle: '50 ml', quantity: 1, currentQuantity: 1, isGiftCard: false, image: { url: 'https://cdn.shopify.com/flakon.webp', altText: null }, product: { id: 'gid://shopify/Product/77', handle: 'sunset-dune', onlineStoreUrl: 'https://www.perfumecloud.de/products/sunset-dune' } }] },
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

// ----- Shop → Club über den Shopify App-Proxy (perfumecloud.de/apps/club/* → /api/proxy/*), signiert wie bei Shopify -----
const PROXY_SECRET = 'admin-secret';
async function proxy(method, path, { customer = '', body, query = {}, secret = PROXY_SECRET, ts = Math.floor(Date.now() / 1000), type = 'application/json', shopDomain = 'ks8yin-mg.myshopify.com', sign = true } = {}) {
  const params = { ...query, shop: shopDomain, logged_in_customer_id: customer, path_prefix: '/apps/club', timestamp: String(ts) };
  const pairs = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort();
  const signature = createHmac('sha256', secret).update(pairs.join('')).digest('hex');
  const qs = new URLSearchParams(sign ? { ...params, signature } : params).toString();
  const res = await fetch(`${app}/api/proxy${path}?${qs}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': type } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const ANNA_NR = '1';
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
  assert.deepEqual(status.data.login, { shopify: true, email: true });
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
  // 1.4: sofort gutgeschrieben, einlösbar 14 Tage nach der Bestellung (#1002) bzw. nach der Zahlung (#1003)
  assert.equal(r.data.points.held, 89 + 25);
  assert.equal(r.data.points.total, 109 + 89 + 25);
  assert.equal(r.data.points.unlocks[0].points, 89);
  assert.equal(r.data.points.unlocks[0].payment, false);
  assert.ok(Math.abs(r.data.points.unlocks[0].at - (Date.now() + 12 * DAY)) < 120000, 'Bestellung vor 2 Tagen → in 12 Tagen einlösbar');
  assert.equal(r.data.points.unlocks[1].payment, true);

  const m = await getMock();
  assert.deepEqual(m.customers[ANNA].tags, ['club']);
  assert.equal(m.metafields[`${ANNA}|club.punkte`], '109');
  assert.equal(m.metafields[`${ANNA}|club.punkte_ausstehend`], '114');
  const status = JSON.parse(m.metafields[`${ANNA}|club.status`]);
  assert.equal(status.punkte, 109);
  assert.equal(status.gesperrt, 114);
  assert.equal(status.nutzbar_ab_punkte, 89);
  assert.equal(status.nutzbar_zahlung, false);
  assert.match(status.nutzbar_ab, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(status.stufe, 'bronze');
  assert.equal(status.naechste_stufe, 'Silber');

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

let cartCode;

test('Shop-Verbindung (App-Proxy): Signatur, Alter, Shop und JSON werden geprüft', async () => {
  assert.equal((await proxy('GET', '/punkte', { customer: ANNA_NR, sign: false })).status, 401);
  assert.equal((await proxy('GET', '/punkte', { customer: ANNA_NR, secret: 'falsch' })).status, 401);
  assert.equal((await proxy('GET', '/punkte', { customer: ANNA_NR, ts: Math.floor(Date.now() / 1000) - 600 })).status, 401, 'zu alt');
  assert.equal((await proxy('GET', '/punkte', { customer: ANNA_NR, shopDomain: 'fremd.myshopify.com' })).status, 401);
  // Ein Formular einer fremden Seite (ohne JSON) kann nichts einlösen
  assert.equal((await proxy('POST', '/einloesen', { customer: ANNA_NR, body: { alle: true, cents: 8900 }, type: 'application/x-www-form-urlencoded' })).status, 415);
  // Mehrfache Parameter verbindet Shopify mit Komma – die Signatur muss trotzdem passen
  const params = { extra: ['1', '2'], shop: 'ks8yin-mg.myshopify.com', logged_in_customer_id: ANNA_NR, path_prefix: '/apps/club', timestamp: String(Math.floor(Date.now() / 1000)) };
  const sig = createHmac('sha256', PROXY_SECRET).update(Object.entries(params).map(([k, v]) => `${k}=${[].concat(v).join(',')}`).sort().join('')).digest('hex');
  const res = await fetch(`${app}/api/proxy/punkte?extra=1&extra=2&shop=${params.shop}&logged_in_customer_id=1&path_prefix=%2Fapps%2Fclub&timestamp=${params.timestamp}&signature=${sig}`);
  assert.equal(res.status, 200);

  let r = await proxy('GET', '/punkte');
  assert.equal(r.data.zustand, 'gast');
  r = await proxy('GET', '/punkte', { customer: '2' });
  assert.equal(r.data.zustand, 'kein_mitglied', 'Ben hat ein Kundenkonto, ist aber nicht im Club');
  assert.equal((await proxy('POST', '/einloesen', { customer: '2', body: { alle: true, cents: 8900 } })).status, 409);
  assert.equal((await proxy('POST', '/einloesen', { body: { alle: true, cents: 8900 } })).status, 401);
});

test('Punkte im Warenkorb einlösen: einmaliger Rabatt nur für das eigene Kundenkonto', async () => {
  // Der Code-Umtausch in der App ist weg
  assert.equal((await anna.req('POST', '/codes', { steps: 1 })).status, 410);

  let r = await proxy('GET', '/punkte', { customer: ANNA_NR, query: { cents: '8900' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.zustand, 'mitglied');
  assert.equal(r.data.punkte, 109);
  assert.equal(r.data.wert_cents, 545, '109 Punkte = 5,45 €');
  assert.equal(r.data.schritt_punkte, 100);
  assert.equal(r.data.max_punkte, 109);
  assert.equal(r.data.gesperrt, 114);
  assert.equal(r.data.freigaben[0].punkte, 89);
  assert.match(r.data.freigaben[0].ab, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.data.freigaben[1].zahlung, true);
  assert.equal(r.data.einloesung, null);
  assert.equal(r.data.stunden, 24);

  const redeem = (body) => proxy('POST', '/einloesen', { customer: ANNA_NR, body });
  assert.equal((await redeem({ punkte: 200, cents: 8900 })).status, 422, '200 Punkte reichen nicht');
  assert.equal((await redeem({ punkte: 150, cents: 8900 })).status, 422, 'nur 100er-Schritte');
  r = await redeem({ punkte: 100, cents: 300 });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /Warenkorb/);

  // „Alle“: 109 Punkte = 5,45 €
  r = await redeem({ alle: true, cents: 8900 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.code, /^CLUB-PUNKTE-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(r.data.punkte, 0);
  assert.deepEqual({ ...r.data.einloesung, bis: 0 }, { code: r.data.code, punkte: 109, wert_cents: 545, bis: 0 });
  assert.ok(Math.abs(r.data.einloesung.bis - (Date.now() + DAY)) < 120000, 'gilt 24 Stunden');
  assert.equal(r.data.max_punkte, 109, 'die aktive Einlösung zählt zum Spielraum');
  const first = r.data.code;
  let m = await getMock();
  let d = Object.values(m.discounts).find((x) => x.code === first);
  assert.ok(d, 'Rabatt in Shopify angelegt');
  assert.deepEqual(d.input.context, { customers: { add: [ANNA] } });
  assert.equal(d.input.customerGets.value.discountAmount.amount, '5.45');
  assert.equal(d.input.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, '5.45');
  assert.equal(d.input.usageLimit, 1);
  assert.match(d.input.title, /^Club-Punkte 5,45 € · Anna B\. · CLUB-PUNKTE-/);

  // Neu wählen ersetzt die Einlösung: alter Rabatt gelöscht, Punkte ohne Mitteilung zurück
  r = await redeem({ punkte: 100, cents: 8900 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.notEqual(r.data.code, first);
  assert.equal(r.data.punkte, 9);
  assert.equal(r.data.einloesung.wert_cents, 500);
  cartCode = r.data.code;
  m = await getMock();
  assert.equal(Object.values(m.discounts).some((x) => x.code === first), false);
  assert.ok(Object.values(m.discounts).some((x) => x.code === cartCode));
  assert.equal(m.metafields[`${ANNA}|club.punkte`], '9');

  r = await anna.req('GET', '/points');
  assert.equal(r.data.history[0].kind, 'redeem');
  assert.equal(r.data.history[0].points, -100);
  assert.equal(r.data.codes[0].source, 'cart');
  assert.equal(r.data.codes[0].status, 'active');
  assert.equal(r.data.codes[0].url, `https://www.perfumecloud.de/discount/${cartCode}?redirect=/cart`);
  assert.equal(r.data.codes.filter((c) => c.status === 'active').length, 1, 'höchstens eine Einlösung im Warenkorb');
  assert.equal(r.data.program.cart_hours, 24);
});

test('Zurücknehmen im Warenkorb oder in der App bucht die Punkte zurück', async () => {
  let r = await proxy('POST', '/zuruecknehmen', { customer: ANNA_NR, body: { cents: 8900 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.zurueck, cartCode);
  assert.equal(r.data.punkte, 109);
  assert.equal(r.data.einloesung, null);
  assert.equal(Object.values((await getMock()).discounts).some((x) => x.code === cartCode), false, 'in Shopify gelöscht');
  r = await proxy('POST', '/zuruecknehmen', { customer: ANNA_NR, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.zurueck, null, 'zweimal tippen schadet nicht');

  // In der App: „Zurückgeben“ für eine offene Einlösung
  r = await proxy('POST', '/einloesen', { customer: ANNA_NR, body: { punkte: 100, cents: 8900 } });
  const id = (await anna.req('GET', '/points')).data.codes.find((c) => c.code === r.data.code).id;
  r = await anna.req('DELETE', `/codes/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.code.status, 'cancelled');
  assert.equal(r.data.points.balance, 109);
  assert.equal((await anna.req('DELETE', `/codes/${id}`)).status, 404);
});

test('Fehler bei Shopify: Punkte bleiben unverändert', async () => {
  await setMock({ failDiscount: true });
  const r = await proxy('POST', '/einloesen', { customer: ANNA_NR, body: { punkte: 100, cents: 8900 } });
  assert.equal(r.status, 502);
  await setMock({ failDiscount: false });
  const p = await anna.req('GET', '/points');
  assert.equal(p.data.points.balance, 109);
  assert.equal(p.data.codes.some((c) => c.status === 'failed'), false);
});

test('Cronjob: Rabatt bestellt, Wartezeit vorbei, im Warenkorb nicht bestellt', async () => {
  // Einlösen und in einer neuen Bestellung benutzen
  let r = await proxy('POST', '/einloesen', { customer: ANNA_NR, body: { punkte: 100, cents: 6000 } });
  const used = r.data.code;
  const m = await getMock();
  m.orders.push(order(1006, { ago: 1000, amount: 60, codes: [used] }));
  // #1002 ist jetzt 20 Tage alt: die Sperrfrist (14 Tage ab der Bestellung) ist vorbei
  const o2 = m.orders.find((o) => o.name === '#1002');
  o2.processedAt = o2.createdAt = iso(20 * DAY);
  o2.fulfillments[0].createdAt = iso(19 * DAY);
  o2.updatedAt = iso(500);
  await setMock({ orders: m.orders });

  let c = await cron();
  assert.match(c.orders, /geändert/);
  r = await anna.req('GET', '/points');
  const usedNow = r.data.codes.find((x) => x.code === used);
  assert.equal(usedNow.status, 'used');
  assert.equal(usedNow.order_name, '#1006');
  // 109 - 100 + 89 (#1002 jetzt verfügbar)
  assert.equal(r.data.points.balance, 98);

  // Im Warenkorb eingelöst, aber nicht bestellt: nach 24 Stunden sind die Punkte wieder da – auch wenn abgelaufene
  // Codes aus der App sonst verfallen würden
  await admin.req('PUT', '/admin/settings', { program: { code_expiry_refund: false } });
  sql("UPDATE club_ledger SET points = points + 100 WHERE kind = 'welcome'"); // genug Punkte für eine zweite Einlösung
  r = await proxy('POST', '/einloesen', { customer: ANNA_NR, body: { punkte: 100, cents: 6000 } });
  const exp = r.data.code;
  sql('UPDATE club_codes SET expires_at = ? WHERE code = ?', [Date.now() - 1000, exp]);
  c = await cron();
  assert.match(c.codes, /1 abgelaufen/);
  r = await anna.req('GET', '/points');
  assert.equal(r.data.codes.find((x) => x.code === exp).status, 'expired');
  assert.equal(r.data.points.balance, 198);
  assert.equal(r.data.history[0].kind, 'refund');
  assert.match(r.data.history[0].note, /nicht bestellt/);
  const after = await getMock();
  assert.equal(Object.values(after.discounts).some((x) => x.code === exp), false);
  assert.equal(after.metafields[`${ANNA}|club.punkte`], '198');
  await admin.req('PUT', '/admin/settings', { program: { code_expiry_refund: true } });
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

test('Anmeldung per E-Mail-Code auf der eigenen Seite (Standard) und Vorname', async () => {
  const guest = new Client();
  assert.equal((await guest.req('GET', '/status')).data.login.email, true, 'standardmäßig an, sobald Mails gehen');
  await admin.req('PUT', '/admin/settings', { login_email: false });
  let r = await guest.req('POST', '/auth/code', { email: 'neu@example.de' });
  assert.equal(r.status, 503, 'im Admin-Bereich ausschaltbar');
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

  // Ohne Namen aus Shopify fragt der Beitritt nach dem Vornamen (für „Guten Morgen, …“ statt der Mailadresse)
  r = await guest.req('POST', '/me/join', { terms: true });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /Vornamen/);
  r = await guest.req('PUT', '/me/name', { first_name: 'neu@example.de' });
  assert.equal(r.status, 422, 'keine Mailadresse als Name');
  r = await guest.req('PUT', '/me/name', { first_name: '  Nele  ' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.first_name, 'Nele');
  assert.equal((await guest.req('GET', '/me')).data.member.joined_at, null, 'Name ändern tritt nicht bei');
  const after = await getMock();
  assert.equal(Object.values(after.customers).find((c) => c.email === 'neu@example.de').firstName, 'Nele', 'Vorname steht auch im Shopify-Kundenkonto');
  r = await guest.req('POST', '/auth/logout');
  assert.equal(r.status, 200);
  assert.equal((await guest.req('GET', '/me')).status, 401);
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
  assert.equal(list.data.members[0].tier, 'silber', '208,90 € Einkaufswert seit dem Beitritt');

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
  assert.equal(r.data.tier.next.missing_cents, 50000 - 20890);
  assert.equal(r.data.tier.level, 2);
  assert.equal(r.data.tier.next.progress, 2, '8,90 € von 300 € zwischen Silber und Gold');
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
  // Sofort gutgeschrieben, aber gesperrt: einlösbar 14 Tage nach der Bestellung
  assert.equal(h.status, 'pending');
  assert.equal(h.reason, 'wait');
  assert.ok(Math.abs(h.available_at - (Date.now() + 14 * DAY)) < 120000);
  let p = await waitPush(annaPhone, (x) => x.title === '+150 Punkte gutgeschrieben');
  assert.match(p.body, /^Bestellung #1007\. Ab \d{2}\.\d{2}\.\d{4} kannst du sie einlösen\.$/);
  assert.equal(r.data.points.balance, 260, 'noch nicht einlösbar');
  assert.equal(r.data.points.total, 260 + 150 + 60 + 25, 'gesamt mit den gesperrten Punkten (#1007, #1006, #1003)');
  // 14 Tage später: einlösbar (Bestellung zurückdatiert, der Satz der Stufe bleibt)
  const m2 = await getMock();
  const o7 = m2.orders.find((x) => x.name === '#1007');
  o7.processedAt = o7.createdAt = iso(15 * DAY); // updatedAt bleibt: der Abgleich holt sie ohnehin wieder (>= Zeiger)
  await setMock({ orders: m2.orders });
  await cron();
  p = await waitPush(annaPhone, (x) => x.title === 'Deine 150 Punkte sind jetzt einlösbar');
  // „Prämie bereit“ wird an die Freigabe angehängt statt einer zweiten Mitteilung
  assert.equal(p.body, 'Bestellung #1007. Einlösbar: 410 Punkte, direkt im Warenkorb. Du hast jetzt 20 € Rabatt bereit.');
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
  assert.deepEqual(prog.tiers.map((t) => [t.key, t.rate, t.min_cents]), [['bronze', 1, 0], ['silber', 1.5, 20000], ['gold', 2, 50000], ['platin', 3, 100000]]);
  assert.equal(prog.tier_basis, 'lifetime');
  assert.deepEqual(prog.waitlist, { full: false, text: 'Die Warteliste ist gerade voll. Schau bald wieder vorbei!', limited: false });
  assert.deepEqual(prog.cart, { proxy: '/apps/club', hours: 24 });
  // Bewertungsbonus einmalig, Empfehlungsbonus nur sichtbar, wenn Empfehlungen an sind (Standard: aus)
  assert.equal(prog.review_once, true);
  assert.equal(prog.referral, false);
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
  assert.equal(p.body, 'Dora hat zum ersten Mal bestellt. Dafür sind dir 100 Punkte gutgeschrieben, einlösbar ab sofort. Du hast jetzt 25 € Rabatt bereit.');
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
  assert.equal(await c.shopifyLogin('/admin'), '/admin', 'vom Admin-Bereich aus geht es zurück dorthin');
  assert.equal(await new Client().shopifyLogin('/'), '/', 'von der Startseite aus in die Club-App (Name, Beitritt) – nicht in den Admin-Bereich');
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

test('Admin-E-Mails: private Adresse als Admin eintragen (mit Rechten der Person oder allein)', async () => {
  const ich = (await admin.req('GET', '/admin/me')).data.admin;
  // Anna meldet sich mit ihrem Kundenkonto an – noch kein Admin
  await setMock({ login: { customer: ANNA, deny: false } });
  const anna = new Client();
  assert.equal(await anna.shopifyLogin('/'), '/');
  assert.equal((await anna.req('GET', '/me')).data.admin, false);
  assert.equal((await anna.req('POST', '/admin/access/emails', { email: 'x@example.de' })).status, 401, 'nur für Admins');

  let r = await admin.req('POST', '/admin/access/emails', { email: ' Anna@Example.de ', admin_id: ich.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.emails.map((e) => [e.email, e.person, e.valid]), [['anna@example.de', ich.name, true]]);
  assert.equal((await admin.req('POST', '/admin/access/emails', { email: 'anna@example.de' })).status, 409, 'schon eingetragen');
  assert.equal((await admin.req('POST', '/admin/access/emails', { email: ich.email })).status, 409, 'hat schon Zugriff');
  assert.equal((await admin.req('POST', '/admin/access/emails', { email: 'y@example.de', admin_id: 'gibt-es-nicht' })).status, 422);
  assert.equal((await admin.req('POST', '/admin/access/emails', { email: 'keine-mail' })).status, 422);

  // Schon angemeldet: beim nächsten Öffnen der App ist der Admin-Bereich da – mit den Rechten der verknüpften Person
  r = await anna.req('GET', '/me');
  assert.equal(r.data.admin, true);
  r = await anna.req('GET', '/admin/me');
  assert.equal(r.data.admin.id, ich.id);
  assert.equal(r.data.admin.manage, true);

  // Ohne Person: eigener Admin-Zugang ohne „Zugänge verwalten“, gilt auch mit ausgeschalteter Team-Erkennung
  await admin.req('PUT', '/admin/settings', { admin_by_email: false });
  r = await admin.req('POST', '/admin/access/emails', { email: 'gast-admin@example.de', admin_id: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const gast = new Client();
  assert.equal((await gast.req('POST', '/auth/code', { email: 'gast-admin@example.de' })).status, 200);
  const code = /(\d{6})/.exec(mails().filter((m) => m.to === 'gast-admin@example.de').pop().subject)[1];
  r = await gast.req('POST', '/auth/code/verify', { email: 'gast-admin@example.de', code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.admin, true, 'Admin-E-Mail gilt sofort nach der Anmeldung');
  r = await gast.req('GET', '/admin/me');
  assert.equal(r.data.admin.source, 'email');
  assert.equal(r.data.admin.manage, false);
  assert.equal((await gast.req('GET', '/admin/dashboard')).status, 200, 'Admin-Bereich offen');
  assert.equal((await gast.req('POST', '/admin/access/emails', { email: 'z@example.de' })).status, 403, 'darf keine Zugänge verwalten');
  const andere = new Client();
  assert.equal(await andere.shopifyLogin('/'), '/');
  assert.equal((await andere.req('GET', '/admin/me')).data.admin.id, ich.id, 'auch mit ausgeschalteter Team-Erkennung');
  await admin.req('PUT', '/admin/settings', { admin_by_email: true });

  // Entfernen: Sitzung der Adresse ohne Person endet sofort
  r = await admin.req('POST', '/admin/access/emails/remove', { email: 'gast-admin@example.de' });
  assert.equal(r.status, 200);
  assert.equal((await gast.req('GET', '/admin/me')).status, 401);
  assert.equal((await admin.req('POST', '/admin/access/emails/remove', { email: 'gast-admin@example.de' })).status, 404);
  r = await admin.req('POST', '/admin/access/emails/remove', { email: 'anna@example.de' });
  assert.deepEqual(r.data.emails, []);
  const wieder = new Client();
  await wieder.shopifyLogin('/');
  assert.equal((await wieder.req('GET', '/me')).data.admin, false, 'Anna ist wieder nur Mitglied');
  assert.equal((await wieder.req('GET', '/admin/me')).status, 401);
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
  assert.deepEqual(r.data.tiers.map((t) => [t.key, t.count]), [['bronze', 2], ['silber', 1], ['gold', 0], ['platin', 0]]);
  assert.equal(r.data.bonus.start.count, 1);
  assert.equal(r.data.bonus.referral.points, 100);
  assert.equal(r.data.bonus.birthday.count, 1);
  assert.equal(r.data.points.expired, 50);
  assert.equal(r.data.codes.used.count, 1);
  assert.ok(r.data.points.earned > 0);
  assert.equal(r.data.points.redeemed, 100, 'drei Codes, zwei davon zurückgebucht');

  // Zahlen fürs iPhone-Widget der Team-App: nur Vorname und Initial, keine Mail-Adressen
  r = await internal('GET', '/widget');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.members, 3);
  assert.deepEqual(r.data.tiers.map((t) => [t.key, t.count]), [['bronze', 2], ['silber', 1], ['gold', 0], ['platin', 0]]);
  assert.ok(r.data.new_7 >= r.data.new_today);
  assert.equal(r.data.recent.length, 3);
  assert.ok(r.data.recent.some((m) => m.name === 'Anna B.'), JSON.stringify(r.data.recent));
  assert.doesNotMatch(JSON.stringify(r.data), /@|Berg/);
  assert.ok('avg' in r.data.survey && 'count' in r.data.survey);
  assert.equal((await fetch(`${app}/api/internal/widget`, { headers: { 'X-Club-Key': 'falsch' } })).status, 403);

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

// ---------- Club 1.2: Befragung, Empfehlungslinks, Testbestellung ----------

const GAST = 'gid://shopify/Customer/50';
const NEU = 'gid://shopify/Customer/60';
const ALT = 'gid://shopify/Customer/61';
async function addOrders(list) {
  const m = await getMock();
  for (const o of list) {
    o.updatedAt = iso(500);
    const i = m.orders.findIndex((x) => x.id === o.id);
    if (i >= 0) m.orders[i] = o; else m.orders.push(o);
  }
  await setMock({ orders: m.orders });
}
const internalReq = (method, path, body) => fetch(`${app}/api/internal${path}`, {
  method, headers: { 'Content-Type': 'application/json', 'X-Club-Key': setting('internal_key') }, body: body ? JSON.stringify(body) : undefined,
}).then(async (res) => ({ status: res.status, data: await res.json() }));
const surveyOf = (orderId) => sql('SELECT * FROM club_surveys WHERE order_id = ?', [orderId])[0];
const annaPoints = async () => (await anna.req('GET', '/me')).data.points.balance;

test('Befragung: Einstellungen werden geprüft, aus ist aus', async () => {
  let r = await admin.req('GET', '/admin/surveys');
  assert.equal(r.status, 200);
  assert.equal(r.data.config.enabled, false);
  assert.equal(r.data.config.questions.length, 2);
  assert.match(r.data.defaults.privacy_url, /\/policies\/privacy-policy$/);
  const q = (text, type = 'stars', options = []) => ({ text, type, options });
  r = await admin.req('PUT', '/admin/surveys', { questions: [q('a'), q('b'), q('c'), q('d')] });
  assert.equal(r.status, 422, 'höchstens drei Fragen');
  r = await admin.req('PUT', '/admin/surveys', { questions: [q('Wieder kaufen?', 'choice', ['Ja'])] });
  assert.equal(r.status, 422, 'Auswahl braucht zwei Antworten');
  r = await admin.req('PUT', '/admin/surveys', { review_url: 'http://unsicher.example' });
  assert.equal(r.status, 422);

  // Ausgeschaltet: neue Bestellungen bekommen keine Befragung
  await addOrders([order(4000, { ago: 12 * DAY, amount: 30, shippedAgo: 2 * DAY, delivered: true })]);
  await cron();
  assert.equal(surveyOf('gid://shopify/Order/4000'), undefined);

  r = await admin.req('PUT', '/admin/surveys', {
    enabled: true, delay_days: 0, min_gap_days: 0, points: 10, mail_newsletter: true,
    review_url: 'https://www.perfumecloud.de/pages/bewertungen',
    questions: [q('Wie zufrieden bist du mit Versand und Verpackung?'), q('Würdest du ihn wieder kaufen?', 'choice', ['Ja', 'Vielleicht', 'Nein'])],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.config.enabled, true);
  assert.ok(r.data.config.since > Date.now() - 60000);
  // Für die Tests: Bestellungen der letzten Tage zählen schon
  const cfg = setting('survey');
  cfg.since = Date.now() - 10 * DAY;
  sql("UPDATE club_settings SET v = ? WHERE k = 'survey'", [JSON.stringify(cfg)]);
});

test('Befragung: nach der Zustellung per Push bzw. nur mit Einwilligung per Mail', async () => {
  await setMock({
    customers: {
      ...(await getMock()).customers,
      [GAST]: { id: GAST, email: 'gast@example.de', firstName: 'Gerd', tags: [], marketing: 'SUBSCRIBED' },
    },
  });
  const still = order(4003, { ago: 3 * DAY, amount: 20, shippedAgo: 2 * DAY, delivered: true, customer: 'gid://shopify/Customer/51' });
  still.email = 'still@example.de';
  await addOrders([
    order(4001, { ago: 3 * DAY, amount: 49, shippedAgo: 2 * DAY, delivered: true }),
    order(4002, { ago: 3 * DAY, amount: 35, shippedAgo: 2 * DAY, delivered: true, customer: GAST }),
    still,
    order(4004, { ago: 1 * DAY, amount: 25 }),
  ]);
  await cron();
  const a = surveyOf('gid://shopify/Order/4001');
  assert.equal(a.status, 'sent', JSON.stringify(a));
  assert.equal(a.channel, 'push', 'Anna: Push, keine Mail ohne Einwilligung');
  const p = await waitPush(annaPhone, (x) => x.title === 'Wie gefällt dir Sunset Dune?');
  assert.equal(p.url, `/bewertung/${a.token}`);

  const g = surveyOf('gid://shopify/Order/4002');
  assert.equal(g.channel, 'mail', 'Newsletter-Abonnent: Mail');
  const mail = await waitMail((x) => x.to === 'gast@example.de');
  assert.equal(mail.subject, 'Gerd, wie gefällt dir dein Duft?');
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(mail.headers['List-Unsubscribe'], new RegExp(`/api/abmelden/${g.token}>$`));
  assert.match(mail.text, /Keine Bewertungsanfragen mehr: http.*\/abmelden\//);
  assert.match(mail.body, new RegExp(`/bewertung/${g.token}\\?s=5&amp;p=0`), 'Sterne direkt in der Mail');
  assert.match(mail.body, /Impressum/);

  const n = surveyOf('gid://shopify/Order/4003');
  assert.equal(n.status, 'skipped');
  assert.equal(n.reason, 'no_consent', 'ohne Einwilligung keine Mail');
  assert.equal(surveyOf('gid://shopify/Order/4004').status, 'waiting');
  assert.equal(surveyOf('gid://shopify/Order/4000'), undefined);
});

test('Befragung: Sterne, Danke-Punkte, Hinweis ans Team bei schlechter Bewertung', async () => {
  const a = surveyOf('gid://shopify/Order/4001');
  const guest = new Client();
  let r = await guest.req('GET', `/bewertung/${a.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.state, 'open');
  assert.equal(r.data.items[0].title, 'Sunset Dune');
  assert.equal(r.data.points, 10);
  assert.equal(r.data.questions.length, 2);
  assert.equal((await guest.req('GET', '/bewertung/' + 'f'.repeat(32))).status, 404);
  const key = r.data.items[0].key;

  r = await guest.req('POST', `/bewertung/${a.token}`, { ratings: { [key]: 4 } });
  assert.equal(r.data.state, 'open', 'Zwischenspeichern');
  r = await guest.req('POST', `/bewertung/${a.token}`, { ratings: { [key]: 9 } });
  assert.equal(r.status, 422);
  r = await guest.req('POST', `/bewertung/${a.token}`, { answers: { wieder: 'Vielleicht' } }, { 'X-PC': '' });
  assert.equal(r.status, 403, 'Schutz-Header nötig');

  const before = await annaPoints();
  const fbBefore = mails().filter((x) => x.to === 'info@perfumecloud.de').length;
  const qid = r.data?.questions?.[1]?.id ?? (await guest.req('GET', `/bewertung/${a.token}`)).data.questions[1].id;
  r = await guest.req('POST', `/bewertung/${a.token}`, { ratings: { [key]: 2 }, answers: { [qid]: 'Nein' }, comment: 'Der Flakon kam beschädigt an.', done: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state, 'answered');
  assert.equal(r.data.thanks.points, 10, 'Punkte unabhängig von der Bewertung');
  assert.equal(r.data.thanks.low, true);
  assert.equal(r.data.thanks.review.url, 'https://www.perfumecloud.de/pages/bewertungen', 'Shop-Bewertung für alle (kein Aussortieren)');
  assert.equal(r.data.thanks.referral, null);
  assert.equal(await annaPoints(), before + 10);
  // Nochmal abschicken: keine doppelten Punkte
  await guest.req('POST', `/bewertung/${a.token}`, { ratings: { [key]: 2 }, done: true });
  assert.equal(await annaPoints(), before + 10);
  assert.equal(sql("SELECT COUNT(*) AS n FROM club_ledger WHERE kind = 'survey'")[0].n, 1);

  const fb = await waitMail((x) => x.to === 'info@perfumecloud.de' && /Bewertung 2 ★ zu #4001/.test(x.subject));
  assert.equal(fb.reply_to, 'anna@example.de');
  assert.match(fb.text, /Der Flakon kam beschädigt an/);
  assert.equal(mails().filter((x) => x.to === 'info@perfumecloud.de').length, fbBefore + 1, 'nur ein Hinweis');

  // Team-App holt den Hinweis ab (einmal)
  r = await internalReq('POST', '/alerts/claim', {});
  assert.equal(r.data.alerts.length, 1);
  assert.equal(r.data.alerts[0].kind, 'low_rating');
  assert.equal(r.data.alerts[0].payload.order_name, '#4001');
  assert.equal(r.data.alerts[0].payload.stars, 2);
  assert.equal(r.data.alerts[0].payload.tier, 'Gold');
  assert.deepEqual(r.data.alerts[0].payload.items, [{ title: 'Sunset Dune (50 ml)', stars: 2 }]);
  r = await internalReq('POST', '/alerts/claim', {});
  assert.equal(r.data.alerts.length, 0);
  assert.equal(surveyOf('gid://shopify/Order/4001').reorder_at, null, 'keine Nachkauf-Erinnerung nach Enttäuschung');
});

test('Befragung: Gast mit 5 Sternen, Abmelden mit einem Klick, Kundeninfos und Wochenzahlen', async () => {
  const g = surveyOf('gid://shopify/Order/4002');
  const c = new Client();
  const v = (await c.req('GET', `/bewertung/${g.token}`)).data;
  assert.equal(v.member, false);
  assert.equal(v.points, 0);
  let r = await c.req('POST', `/bewertung/${g.token}`, { ratings: { [v.items[0].key]: 5 }, done: true });
  assert.equal(r.data.thanks.points, 0);
  assert.equal(r.data.thanks.review.label, 'Bewertung im Shop schreiben');
  assert.equal(r.data.thanks.join.welcome_points, 50, 'Nicht-Mitglieder sehen den Club');
  assert.equal(r.data.thanks.referral, null);

  // Abmelden aus dem Mailprogramm (ohne Schutz-Header, RFC 8058)
  const res = await fetch(`${app}/api/abmelden/${g.token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 200);
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_survey_optout')[0].n, 1);
  assert.equal(sql("SELECT COUNT(*) AS n FROM club_survey_optout WHERE email_hash LIKE '%@%'")[0].n, 0, 'nur der Hash');
  const get = await fetch(`${app}/api/abmelden/${g.token}`, { redirect: 'manual' });
  assert.equal(get.status, 302, 'Link-Vorschau meldet nicht ab');
  assert.equal(get.headers.get('location'), `/abmelden/${g.token}`);
  // Neue Bestellung derselben Person: keine Anfrage mehr
  await addOrders([order(4012, { ago: 2 * DAY, amount: 35, shippedAgo: 2 * DAY, delivered: true, customer: GAST })]);
  await cron();
  assert.equal(surveyOf('gid://shopify/Order/4012').reason, 'optout');

  r = await internalReq('GET', '/customer?email=ANNA@example.de');
  assert.equal(r.status, 200);
  assert.equal(r.data.member, true);
  assert.equal(r.data.tier.name, 'Gold');
  assert.equal(r.data.ratings.count, 1);
  assert.equal(r.data.ratings.last.comment, 'Der Flakon kam beschädigt an.');
  assert.match(r.data.admin_url, /\/admin\/mitglieder\/[0-9a-f-]{36}$/);
  r = await internalReq('GET', '/customer?email=gast@example.de');
  assert.equal(r.data.member, false);
  assert.equal(r.data.ratings.avg, 5);

  r = await internalReq('GET', `/weekly?from=${Date.now() - 7 * DAY}&to=${Date.now() + 1000}`);
  assert.equal(r.data.survey.count, 2);
  assert.equal(r.data.survey.avg, 3.5);
  assert.equal(r.data.survey.low, 1);
  assert.equal(typeof r.data.members_total, 'number');

  r = await admin.req('GET', '/admin/surveys');
  assert.equal(r.data.overview.answered, 2);
  assert.equal(r.data.overview.optouts, 1);
  assert.equal(r.data.overview.products[0].title, 'Sunset Dune');
});

test('Befragung: Schalter in der App, Test an mich, Vorschau, Nachkauf-Erinnerung', async () => {
  let r = await anna.req('PUT', '/me/survey-mail', { on: true });
  assert.equal(r.data.mail, true);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.survey.mail, true);
  assert.equal(r.data.survey.enabled, true);

  r = await admin.req('GET', '/admin/surveys/preview?kind=survey');
  assert.match(r.data.html, /&#9733;/);
  assert.match(r.data.subject, /wie gefällt dir dein Duft\?$/);
  const week = () => internalReq('GET', `/weekly?from=${Date.now() - DAY}&to=${Date.now() + 1000}`).then((x) => x.data.survey.sent);
  const sentBefore = await week();
  r = await admin.req('POST', '/admin/surveys/test', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.message, /Mail an marius@example\.de/);
  assert.match(r.data.link, /\/bewertung\/[0-9a-f]{32}$/);
  await waitMail((x) => x.to === 'marius@example.de' && /wie gefällt dir dein Duft/.test(x.subject));
  assert.equal(await week(), sentBefore, 'Tests zählen nicht');

  // Zweite Bestellung von Anna kommt an → Anfrage jetzt auch per Mail (Schalter an)
  await addOrders([order(4004, { ago: 1 * DAY, amount: 25, shippedAgo: 1 * DAY, delivered: true })]);
  await cron();
  const s = surveyOf('gid://shopify/Order/4004');
  assert.equal(s.channel, 'push+mail');
  r = await new Client().req('POST', `/bewertung/${s.token}`, { ratings: { p77: 5 }, done: true });
  assert.equal(r.data.thanks.points, 10);

  // Nachkauf-Erinnerung: fällig → Push mit Link zum Duft
  await admin.req('PUT', '/admin/surveys', { reorder: true, reorder_days: 60 });
  sql('UPDATE club_surveys SET reorder_at = ? WHERE id = ?', [Date.now() - 1000, s.id]);
  await cron();
  const p = await waitPush(annaPhone, (x) => x.title === 'Zeit für Nachschub?');
  assert.equal(p.url, 'https://www.perfumecloud.de/products/sunset-dune');
  assert.ok(surveyOf('gid://shopify/Order/4004').reorder_sent_at);
  await admin.req('PUT', '/admin/surveys', { reorder: false });
});

test('Empfehlungslink: Rabatt für Freunde, Punkte je Bestellung – auch ohne Beitritt', async () => {
  let r = await admin.req('PUT', '/admin/referrals', { friend_type: 'percent', friend_value: 150 });
  assert.equal(r.status, 422);
  r = await admin.req('PUT', '/admin/referrals', {
    enabled: true, friend_type: 'percent', friend_value: 15, reward_type: 'percent', reward_percent: 10, reward_min_cents: 2000, new_customers_only: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.overview.friend_text, '15 % Rabatt auf die erste Bestellung');
  assert.equal(r.data.overview.reward_text, '10 % des Bestellwerts als Punkte (ab 20 € Bestellwert)');

  r = await anna.req('GET', '/me');
  const ref = r.data.bonus.referral.link;
  assert.match(ref.link, /\/r\/[A-Z2-9]{6}$/);
  assert.equal(ref.friend_text, '15 % Rabatt auf die erste Bestellung');
  const refCode = ref.link.split('/r/')[1];

  // Klick: Code in Shopify anlegen und in den Shop weiterleiten
  const ua = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' };
  let res = await fetch(`${app}/r/${refCode}`, { redirect: 'manual', headers: ua });
  assert.equal(res.status, 302);
  const loc = res.headers.get('location');
  assert.match(loc, /^https:\/\/www\.perfumecloud\.de\/discount\/ANNA-[A-Z2-9]{6}\?redirect=%2F$/);
  const code = decodeURIComponent(loc.split('/discount/')[1].split('?')[0]);
  let disc = Object.values((await getMock()).discounts).find((d) => d.code === code);
  assert.equal(disc.input.customerGets.value.percentage, 0.15);
  assert.equal(disc.input.appliesOncePerCustomer, true);
  assert.deepEqual(disc.input.context, { all: 'ALL' });
  await fetch(`${app}/r/${refCode}`, { redirect: 'manual', headers: { 'User-Agent': 'WhatsApp/2.23' } });
  await fetch(`${app}/r/${refCode.toLowerCase()}/`, { redirect: 'manual', headers: ua });
  assert.equal(Object.values((await getMock()).discounts).filter((d) => d.code === code).length, 1, 'Code nur einmal angelegt');
  assert.equal(sql('SELECT SUM(n) AS n FROM club_referral_clicks')[0].n, 2, 'Vorschau-Bots zählen nicht');
  res = await fetch(`${app}/r/UNBEKANNT`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), 'https://www.perfumecloud.de/');

  await setMock({
    customers: {
      ...(await getMock()).customers,
      [NEU]: { id: NEU, email: 'neu@example.de', firstName: 'Nina', tags: [], numberOfOrders: 1 },
      [ALT]: { id: ALT, email: 'alt@example.de', firstName: 'Olaf', tags: [], numberOfOrders: 4 },
    },
  });
  const before = await annaPoints();
  await addOrders([
    order(5001, { ago: 17 * DAY, amount: 60, shippedAgo: 16 * DAY, delivered: true, customer: NEU, codes: [code] }),
    order(5002, { ago: 2 * DAY, amount: 80, shippedAgo: 1 * DAY, customer: ANNA, codes: [code.toLowerCase()] }),
    order(5003, { ago: 2 * DAY, amount: 80, customer: ALT, codes: [code] }),
    order(5004, { ago: 2 * DAY, amount: 15, customer: 'gid://shopify/Customer/62', codes: [code] }),
  ]);
  await cron();
  const rows = Object.fromEntries(sql('SELECT order_name, status, reason, points FROM club_referral_orders').map((x) => [x.order_name, x]));
  assert.equal(rows['#5001'].status, 'credited');
  assert.equal(rows['#5001'].points, 120, '10 % von 60 € = 6 € = 120 Punkte');
  assert.equal(rows['#5002'].reason, 'self');
  assert.equal(rows['#5003'].reason, 'existing');
  assert.equal(rows['#5004'].reason, 'min');
  assert.equal(await annaPoints(), before + 120);
  const p = await waitPush(annaPhone, (x) => x.title === 'Danke fürs Weitersagen' && /deinen Link/.test(x.body));
  assert.equal(p.body, 'Deine 120 Punkte für die Bestellung über deinen Link sind jetzt einlösbar.');
  await waitPush(annaPhone, (x) => x.title === 'Über deinen Link wurde bestellt');

  r = await anna.req('GET', '/me');
  assert.equal(r.data.bonus.referral.link.orders, 1);
  assert.equal(r.data.bonus.referral.link.earned_points, 120);
  assert.equal(r.data.bonus.referral.link.clicks, 2);
  r = await internalReq('GET', `/weekly?from=${Date.now() - 30 * DAY}&to=${Date.now() + 1000}`);
  assert.equal(r.data.referrals.orders, 1);
  assert.equal(r.data.referrals.clicks, 2);
  r = await internalReq('GET', '/customer?email=anna@example.de');
  assert.equal(r.data.referrals.orders, 1);
  assert.match(r.data.ref_link, /\/r\//);
  r = await admin.req('GET', '/admin/referrals');
  assert.equal(r.data.overview.orders_90, 1);
  assert.equal(r.data.overview.top[0].name, 'Anna Berg');

  // Dankeseite nach 5 Sternen zeigt den Empfehlungslink
  await addOrders([order(4005, { ago: 2 * DAY, amount: 25, shippedAgo: 2 * DAY, delivered: true })]);
  await cron();
  r = await new Client().req('POST', `/bewertung/${surveyOf('gid://shopify/Order/4005').token}`, { ratings: { p77: 5 }, done: true });
  assert.equal(r.data.thanks.referral.link, ref.link);

  // Rabatt geändert → Code wird neu angelegt; ausgeschaltet → Code gelöscht, Link führt zur Club-Einladung
  await admin.req('PUT', '/admin/referrals', { friend_value: 20 });
  await cron();
  disc = Object.values((await getMock()).discounts).filter((d) => d.code === code);
  assert.equal(disc.length, 1);
  assert.equal(disc[0].input.customerGets.value.percentage, 0.2);
  await admin.req('PUT', '/admin/referrals', { enabled: false });
  await cron();
  assert.equal(Object.values((await getMock()).discounts).filter((d) => d.code === code).length, 0);
  res = await fetch(`${app}/r/${refCode}`, { redirect: 'manual', headers: ua });
  assert.match(res.headers.get('location'), new RegExp(`/\\?einladung=${refCode}$`));
  await admin.req('PUT', '/admin/referrals', { enabled: true });
});

test('Testbestellung: simuliert mit allen Schritten, Push auf die Geräte des Admins, Aufräumen', async () => {
  const user = { id: 'team-marius', name: 'Anna Admin', email: 'anna@example.de' };
  const statsBefore = (await internalReq('GET', '/stats')).data;
  let r = await internalReq('GET', '/trial');
  assert.equal(r.data.active, false);
  r = await internalReq('POST', '/trial/start', { user, mode: 'sim', amount_cents: 5900 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.device_member, true);
  assert.equal((await internalReq('POST', '/trial/start', { user, mode: 'sim' })).status, 409);
  assert.equal((await internalReq('POST', '/trial/step', { step: 'delivered' })).status, 409, 'erst bestellen');

  for (const step of ['ordered', 'pending', 'shipped', 'delivered', 'survey', 'credited', 'referral', 'tier']) {
    r = await internalReq('POST', '/trial/step', { step });
    assert.equal(r.status, 200, step + ': ' + JSON.stringify(r.data));
  }
  const done = Object.fromEntries(r.data.steps.map((s) => [s.key, s.done]));
  assert.deepEqual(Object.values(done), [true, true, true, true, true, true, true, true], JSON.stringify(r.data.steps));
  // Punkte der Testbestellung (eine laufende Aktion verdoppelt sie) + Empfehlung (10 % von 59 € = 118 Punkte)
  const orderPts = sql("SELECT points FROM club_orders WHERE order_id LIKE 'probelauf:%'")[0].points;
  assert.ok(orderPts >= 59);
  assert.equal(r.data.balance, orderPts + 118);
  for (const title of ['Testbestellung · Dein Paket ist unterwegs', 'Testbestellung · Dein Duft ist angekommen', 'Testbestellung · Wie gefällt dir Sunset Dune?', `Testbestellung · +${orderPts} Punkte gutgeschrieben`, `Testbestellung · Deine ${orderPts} Punkte sind jetzt einlösbar`, 'Testbestellung · Danke fürs Weitersagen', 'Testbestellung · Willkommen in Silber']) {
    await waitPush(annaPhone, (x) => x.title === title);
  }
  assert.ok(r.data.steps.find((s) => s.key === 'shipped').push.status === 'sent');
  await waitMail((x) => x.to === 'anna@example.de' && /wie gefällt dir dein Duft/.test(x.subject));

  // Testkonto zählt nirgends mit
  const stats = (await internalReq('GET', '/stats')).data;
  assert.equal(stats.members, statsBefore.members);
  assert.equal(stats.points.earned, statsBefore.points.earned);
  assert.ok(!(await admin.req('GET', '/admin/members')).data.members.some((m) => /Testbestellung/.test(m.name)));

  r = await internalReq('POST', '/trial/cleanup', {});
  assert.equal(r.data.ok, true);
  assert.equal(r.data.order, null);
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_members WHERE test = 1')[0].n, 0);
  assert.equal(sql("SELECT COUNT(*) AS n FROM club_orders WHERE order_id LIKE 'probelauf:%'")[0].n, 0);
  assert.equal((await internalReq('GET', '/trial')).data.active, false);
});

test('Testbestellung: echt im Shop (0 €) mit Einmal-Codes', async () => {
  const user = { id: 'team-marius', name: 'Anna Admin', email: 'anna@example.de' };
  let r = await internalReq('POST', '/trial/start', { user, mode: 'real', amount_cents: 4000 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.codes.length, 2);
  assert.match(r.data.shop_link, /\/discount\/TEST-[A-F0-9]{5}\?redirect=%2F$/);
  const disc = Object.values((await getMock()).discounts).filter((d) => r.data.codes.includes(d.code));
  assert.equal(disc.length, 2);
  assert.equal(disc.find((d) => d.op === 'ClubTrialCode').input.customerGets.value.percentage, 1);
  assert.equal(disc.find((d) => d.op === 'ClubTrialCode').input.usageLimit, 1);
  assert.equal((await internalReq('POST', '/trial/step', { step: 'ordered' })).status, 409, 'echte Bestellung kommt aus dem Shop');

  const annaOrdersBefore = sql('SELECT COUNT(*) AS n FROM club_orders WHERE member_id = ?', [annaId])[0].n;
  const o = order(6001, { ago: 1000, amount: 0, codes: [r.data.codes[0]] });
  await addOrders([o]);
  r = await internalReq('POST', '/trial/sync', {});
  assert.equal(r.data.order.name, '#6001');
  assert.equal(r.data.order.real, true);
  const pending = r.data.steps.find((s) => s.key === 'pending');
  assert.equal(pending.done, true);
  assert.match(pending.detail, /^80 Punkte/, 'zählt wie 40 € (laufende Aktion: doppelte Punkte)');
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_orders WHERE member_id = ?', [annaId])[0].n, annaOrdersBefore, 'echtes Konto bleibt unberührt');

  r = await internalReq('POST', '/trial/cleanup', {});
  assert.deepEqual(r.data.order, { id: 'gid://shopify/Order/6001', name: '#6001' });
  assert.equal(Object.values((await getMock()).discounts).filter((d) => /^TEST-/.test(d.code)).length, 0, 'Codes gelöscht');
  assert.equal(sql("SELECT COUNT(*) AS n FROM club_surveys WHERE order_id = 'gid://shopify/Order/6001'")[0].n, 0);
});

test('Push-Check: private Adresse eintragen, Testpush, Testbestellung auch in der Ruhezeit, Grund auf der Admin-Anmeldung', async () => {
  // Lea meldet sich in der Team-App mit lea@team.de an, im Shop kauft sie als anna@example.de (Annas Telefon steht für Leas Handy)
  const user = { id: 'team-lea', name: 'Lea Team', email: 'lea@team.de' };
  let r = await internalReq('POST', '/access', { user });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.version.length > 0, true);
  assert.deepEqual(r.data.accounts.map((a) => [a.email, a.team, a.member, a.devices, a.admin]), [['lea@team.de', true, null, 0, false]]);
  assert.match(r.data.accounts[0].reasons.join(' '), /eigene Datenbank/);

  r = await internalReq('POST', '/access/emails', { user, email: 'Anna@Example.de' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const privat = r.data.accounts.find((a) => a.email === 'anna@example.de');
  assert.equal(privat.team, false);
  assert.equal(privat.member.id, annaId);
  assert.ok(privat.devices >= 1);
  assert.equal(privat.admin, true, 'mit der eingetragenen Adresse als Admin erkannt');
  assert.equal((await internalReq('POST', '/access/emails', { user, email: 'anna@example.de' })).status, 409);

  // Testpush an das eigene Club-Konto, nicht an fremde
  r = await internalReq('POST', '/push/test', { user, member_id: annaId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.results.some((x) => x.ok));
  await waitPush(annaPhone, (x) => x.title === 'Testpush vom Club');
  const fremd = sql("SELECT id FROM club_members WHERE email <> 'anna@example.de' AND joined_at IS NOT NULL AND test = 0 LIMIT 1")[0].id;
  assert.equal((await internalReq('POST', '/push/test', { user, member_id: fremd })).status, 422);

  // Ruhezeit jetzt: die Pushs der Testbestellung kommen trotzdem sofort
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).formatToParts(new Date()).find((x) => x.type === 'hour').value);
  assert.equal((await admin.req('PUT', '/admin/push', { quiet: { start: hour, end: (hour + 2) % 24 } })).status, 200);
  r = await internalReq('POST', '/trial/start', { user, mode: 'sim', amount_cents: 3000 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.device_member_id, annaId, 'ohne Wahl: das erste eigene Konto mit Gerät');
  assert.equal(r.data.device_email, 'anna@example.de');
  for (const step of ['ordered', 'pending', 'shipped']) r = await internalReq('POST', '/trial/step', { step });
  assert.equal(r.data.steps.find((s) => s.key === 'shipped').push.status, 'sent', JSON.stringify(r.data.steps));
  await waitPush(annaPhone, (x) => x.title === 'Testbestellung · Dein Paket ist unterwegs');
  assert.equal((await internalReq('POST', '/trial/device', { user, member_id: fremd })).status, 422);
  r = await internalReq('POST', '/trial/device', { user, member_id: annaId });
  assert.equal(r.status, 200);
  await internalReq('POST', '/trial/cleanup', {});
  await admin.req('PUT', '/admin/push', { quiet: { start: 21, end: 8 } });

  // Admin-Anmeldung: Grund statt stiller Rückkehr
  assert.deepEqual((await new Client().req('GET', '/admin/why')).data, { member: null });
  await setMock({ login: { customer: ANNA, deny: false } });
  const anna = new Client();
  assert.equal(await anna.shopifyLogin('/admin'), '/admin', 'mit eingetragener Adresse direkt in den Admin-Bereich');
  r = await anna.req('GET', '/admin/why');
  assert.equal(r.data.member.recognized, true);
  assert.match(r.data.member.reasons[0], /Admin-E-Mails/);

  r = await internalReq('POST', '/access/emails/remove', { user, email: 'anna@example.de' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accounts.length, 1);
  assert.equal((await internalReq('POST', '/access/emails/remove', { user, email: 'anna@example.de' })).status, 404, 'gehört nicht (mehr) zu Lea');
  const wieder = new Client();
  assert.equal(await wieder.shopifyLogin('/admin'), '/admin/anmelden?pruefen=1', 'nicht erkannt: zur Anmeldung mit Grund');
  r = await wieder.req('GET', '/admin/why');
  assert.equal(r.data.member.email, 'anna@example.de');
  assert.equal(r.data.member.recognized, false);
  assert.match(r.data.member.reasons.join(' '), /eigene Datenbank/);
  assert.equal((await wieder.req('GET', '/admin/me')).status, 401);
});

test('Fußzeile der Team-App (Text + Logo) steht unter den Mails des Clubs', async () => {
  const png = execFileSync('php', ['-r', '$i = imagecreatetruecolor(200, 50); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());']).toString();
  assert.equal((await internalReq('POST', '/signature', { text: 'x', image: 'data:image/png;base64,AAAA' })).status, 422);
  let r = await internalReq('POST', '/signature', { text: 'Perfume Cloud\nwww.perfumecloud.de', image: `data:image/png;base64,${png}`, width: 150 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const before = mails().length;
  assert.equal((await admin.req('POST', '/admin/test/welcome')).status, 200);
  const m = mails().slice(before).pop();
  assert.ok(m, 'Mail protokolliert');
  assert.match(m.body, /<!--pc-signatur-->/);
  assert.match(m.body, /<img src="cid:pc-signatur@perfumecloud" width="150" height="38"/);
  assert.match(m.body, /Perfume Cloud<br>/);
  assert.match(m.text, /\n\nPerfume Cloud\nwww\.perfumecloud\.de$/);
  // Entfernen: leer schicken
  r = await internalReq('POST', '/signature', { text: '', image: null });
  assert.equal(r.status, 200);
  assert.equal(setting('mail_signature'), null);
});

test('Abgleich: ohne Freigabe für Name und E-Mail laufen die Punkte weiter', async () => {
  await setMock({ denyCustomerData: true });
  await addOrders([order(4100, { ago: 4 * DAY, amount: 30, shippedAgo: 3 * DAY, delivered: true })]);
  let r = await cron();
  assert.match(JSON.stringify(r), /nicht alle Kundendaten/);
  const row = sql("SELECT * FROM club_orders WHERE order_id = 'gid://shopify/Order/4100'")[0];
  assert.ok(row && row.points > 0, 'Bestellung trotz fehlender Kundendaten übernommen');
  r = await admin.req('GET', '/admin/dashboard');
  assert.equal(r.data.checklist.find((x) => x.key === 'customer_data').ok, false, 'Hinweis im Admin');
  await setMock({ denyCustomerData: false });
  await addOrders([order(4101, { ago: 2 * DAY, amount: 20 })]);
  await cron();
  r = await admin.req('GET', '/admin/dashboard');
  assert.equal(r.data.checklist.find((x) => x.key === 'customer_data').ok, true, 'Hinweis verschwindet wieder');
});

const EMIL = 'gid://shopify/Customer/70';
const emil = new Client();
const emilPhone = pushDevice('emil');
const berlinDay = (ms) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(ms));
test('1.4: Empfehlung erst mit der Bestellung, Storno, Rückgabe, Verfall-Erinnerung, Bewertung einmal, Warteliste, Umstellung', async () => {
  await admin.req('PUT', '/admin/push', { quiet: { start: 0, end: 0 } });
  let m = await getMock();
  m.customers[EMIL] = { id: EMIL, email: 'emil@example.de', firstName: 'Emil', lastName: 'Kraus', tags: [] };
  await setMock({ customers: m.customers, login: { customer: EMIL, deny: false } });
  assert.equal(await emil.shopifyLogin('/'), '/willkommen');
  const refCode = (await anna.req('GET', '/me')).data.bonus.referral.code;
  let r = await emil.req('POST', '/me/join', { terms: true, einladung: refCode });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.points.balance, 50);
  assert.equal(r.data.points.waiting, 100, 'Einladungsbonus wartet auf die erste Bestellung');
  r = await emil.req('POST', '/push/subscribe', { endpoint: emilPhone.endpoint, keys: emilPhone.keys });
  assert.equal(r.data.devices, 1);
  const emilId = sql('SELECT id FROM club_members WHERE email = ?', ['emil@example.de'])[0].id;
  const annaMe = (await anna.req('GET', '/me')).data;
  const annaBefore = annaMe.points;
  const annaSeen = (await received(annaPhone)).length;

  // Erste Bestellung: Punkte sofort gutgeschrieben, einlösbar in 14 Tagen – der Bonus fürs werbende Mitglied auch
  await addOrders([order(7001, { ago: 5000, amount: 40, customer: EMIL })]);
  await cron();
  r = await emil.req('GET', '/points');
  const p7001 = r.data.history.find((x) => x.title === 'Bestellung #7001').points;
  assert.equal(r.data.points.held, p7001 + 100);
  assert.equal(r.data.points.waiting, 0);
  assert.equal(r.data.points.balance, 50);
  const unlockDay = berlinDay(Date.now() - 5000 + 14 * DAY);
  let p = await waitPush(emilPhone, (x) => x.title === `+${p7001} Punkte gutgeschrieben`);
  assert.match(p.body, new RegExp(`Ab ${unlockDay.replace(/\./g, '\\.')} kannst du sie einlösen\\.$`));
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.balance, annaBefore.balance, 'noch nicht einlösbar');
  assert.equal(r.data.points.held, annaBefore.held + 100);
  p = await waitPush(annaPhone, (x) => x.title === 'Danke fürs Weitersagen' && x.body.startsWith('Emil'));
  assert.equal(p.body, `Emil hat zum ersten Mal bestellt. Dafür sind dir 100 Punkte gutgeschrieben, einlösbar ab ${unlockDay}.`);

  // Storniert: Bonus fällt weg, Einladungsbonus wartet wieder
  await addOrders([order(7001, { ago: 5000, amount: 40, customer: EMIL, cancelled: true })]);
  await cron();
  r = await emil.req('GET', '/me');
  assert.equal(r.data.points.held, 0);
  assert.equal(r.data.points.waiting, 100);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.held, annaBefore.held);
  p = await waitPush(annaPhone, (x) => x.title === '−100 Punkte' && x.body.startsWith('Die Bestellung deiner Empfehlung'));
  assert.equal(p.body, `Die Bestellung deiner Empfehlung wurde storniert. Dein Kontostand: ${annaBefore.balance.toLocaleString('de-DE')} Punkte.`);
  assert.equal(sql("SELECT COUNT(*) AS n FROM club_ledger WHERE kind = 'referral' AND ref = ? AND status = 'void'", [emilId])[0].n, 1);

  // Neue Bestellung (vor 15 Tagen, also schon frei): beide Boni sofort einlösbar
  await addOrders([order(7002, { ago: 15 * DAY, amount: 150, customer: EMIL })]);
  await cron();
  r = await emil.req('GET', '/me');
  assert.equal(r.data.points.balance, 50 + 150 + 100);
  assert.equal(r.data.points.held, 0);
  p = await waitPush(emilPhone, (x) => x.title === 'Deine 100 Punkte sind jetzt einlösbar');
  assert.match(p.body, /^Dein Bonus für die Einladung\. Einlösbar: \d+ Punkte, direkt im Warenkorb\./);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.balance, annaBefore.balance + 100);
  p = await waitPush(annaPhone, (x) => x.title === 'Danke fürs Weitersagen' && x.body.includes('einlösbar ab sofort.') && x.body.startsWith('Emil'));
  assert.equal(r.data.bonus.referral.rewarded, annaMe.bonus.referral.rewarded + 1);

  // Eingelöst und danach zurückgeschickt: Kontostand darf ins Minus, der Empfehlungsbonus wird abgezogen
  r = await proxy('POST', '/einloesen', { customer: '70', body: { punkte: 200, cents: 9000 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.punkte, 100);
  const refunded = order(7002, { ago: 15 * DAY, amount: 150, customer: EMIL });
  refunded.currentSubtotalPriceSet.shopMoney.amount = '0.00';
  refunded.totalRefundedSet.shopMoney.amount = '154.90';
  await addOrders([refunded]);
  await cron();
  r = await emil.req('GET', '/me');
  assert.equal(r.data.points.balance, -50);
  assert.equal(r.data.points.value_cents, 0);
  p = await waitPush(emilPhone, (x) => x.title === '−150 Punkte');
  assert.match(p.body, /Dein Kontostand: -50 Punkte\.$/);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.balance, annaBefore.balance);
  p = await waitPush(annaPhone, (x) => x.title === '−100 Punkte' && x.body.startsWith('Empfehlung: Die Bestellung wurde storniert'));
  assert.equal(sql("SELECT COUNT(*) AS n FROM club_ledger WHERE kind = 'adjust' AND member_id = ? AND ref LIKE 'void:%'", [annaId])[0].n, 1);
  // Zweite Stornomeldung bucht nichts doppelt
  await addOrders([refunded]);
  await cron();
  assert.equal((await anna.req('GET', '/me')).data.points.balance, annaBefore.balance);
  const annaNew = (await received(annaPhone)).slice(annaSeen);
  assert.equal(annaNew.length, 4, JSON.stringify(annaNew.map((x) => [x.title, x.body])));

  // Verfall-Erinnerung: 60 und 30 Tage vorher je einmal, nur Push (keine Mail)
  assert.equal((await admin.req('PUT', '/admin/settings', { program: { expiry_warn_list: '30, 0' } })).status, 422);
  r = await admin.req('PUT', '/admin/settings', { program: { expiry_warn_list: '30, 60, 60' } });
  assert.deepEqual(r.data.program.expiry_warn_list, [60, 30]);
  const now = Date.now();
  const lot = globalThis.crypto.randomUUID();
  sql("INSERT INTO club_ledger (id, member_id, kind, points, note, created_at, status, credited_at, expires_at) VALUES (?, ?, 'bonus', 120, 'Test', ?, 'available', ?, ?)", [lot, annaId, now, now, now + 50 * DAY]);
  const remind = (at) => JSON.parse(execFileSync('php', [join(here, 'helper.php'), 'expiry-remind', annaId, String(at)], { env }).toString()).sent;
  const mailsBefore = mails().length;
  assert.equal(remind(now), true, '50 Tage vorher: Stufe 60');
  assert.equal(remind(now + DAY), false, 'nur einmal je Stufe');
  assert.equal(remind(now + 25 * DAY), true, '25 Tage vorher: Stufe 30');
  assert.equal(remind(now + 45 * DAY), false);
  await cron();
  const expDay = berlinDay(now + 50 * DAY);
  p = await waitPush(annaPhone, (x) => x.title === `120 Punkte verfallen am ${expDay}`);
  assert.equal(p.body, 'Das sind 6 €. Löse sie vorher im Warenkorb ein, dann gehen sie nicht verloren.');
  assert.equal((await received(annaPhone)).filter((x) => x.title === `120 Punkte verfallen am ${expDay}`).length, 2);
  assert.equal(mails().length, mailsBefore);
  r = await anna.req('GET', '/me');
  assert.equal(r.data.points.expiring.points, 120);
  assert.equal(r.data.points.expiring.cents, 600);
  sql('DELETE FROM club_ledger WHERE id = ?', [lot]);

  // Bewertungsbonus nur einmal je Mitglied
  r = await emil.req('POST', '/me/review', { note: 'Sunset Dune bei Google bewertet' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await emil.req('POST', '/me/review', { note: 'Noch eine Bewertung' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'Deine Bewertung liegt uns schon vor, wir prüfen sie gerade.');
  const claim = (await admin.req('GET', '/admin/claims')).data.claims.find((c) => c.member.email === 'emil@example.de');
  r = await admin.req('POST', `/admin/claims/${claim.id}`, { approve: true });
  assert.equal(r.status, 200);
  assert.equal((await admin.req('POST', `/admin/claims/${claim.id}`, { approve: true })).status, 404, 'schon erledigt');
  // Ältere zweite Anfrage (aus der Zeit vor 1.4) lässt sich nicht mehr freigeben
  const old = globalThis.crypto.randomUUID();
  sql("INSERT INTO club_claims (id, member_id, kind, note, status, created_at) VALUES (?, ?, 'review', 'alt', 'open', ?)", [old, emilId, Date.now()]);
  r = await admin.req('POST', `/admin/claims/${old}`, { approve: true });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /einmal je Mitglied/);
  assert.equal((await admin.req('POST', `/admin/claims/${old}`, { approve: false })).status, 200);
  r = await emil.req('POST', '/me/review', { note: 'Und noch eine' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'Du hast den Bonus für deine Bewertung schon bekommen. Danke dir!');
  r = await emil.req('GET', '/me');
  assert.equal(r.data.points.balance, -50 + 25);
  assert.deepEqual(r.data.bonus.review, { once: true, state: 'approved' });

  // Warteliste mit Höchstzahl: voll → Hinweis im Admin und im Shop, Restplätze werden nicht gezeigt
  r = await admin.req('PUT', '/admin/settings', { program: { waitlist_max: -1 } });
  assert.equal(r.status, 422);
  r = await admin.req('PUT', '/admin/settings', { program: { waitlist_max: 1, waitlist_full_text: 'Gerade voll – bald gibt es neue Plätze.' } });
  assert.equal(r.data.program.waitlist_max, 1);
  r = await admin.req('GET', '/admin/invites');
  assert.equal(r.data.limit.max, 1);
  assert.ok(r.data.limit.count >= 1, 'Clara hat den Tag der Warteliste');
  assert.equal(r.data.limit.full, true);
  const shopWaitlist = (full) => waitFor2(async () => {
    const v = (await getMock()).metafields['gid://shopify/Shop/1|club.programm'];
    const w = v && JSON.parse(v).waitlist;
    return w && w.full === full ? w : null;
  });
  assert.deepEqual(await shopWaitlist(true), { full: true, text: 'Gerade voll – bald gibt es neue Plätze.', limited: true });
  assert.equal(JSON.stringify(await getMock()).includes('"remaining"'), false);
  // Vor dem Eintragen fragt das Theme beim Club nach (zählt frisch, verrät keine Restplätze)
  assert.deepEqual((await proxy('GET', '/warteliste')).data, { voll: true, text: 'Gerade voll – bald gibt es neue Plätze.' });
  await admin.req('PUT', '/admin/settings', { program: { waitlist_max: 5 } });
  assert.deepEqual((await proxy('GET', '/warteliste')).data, { voll: false, text: null });
  await admin.req('PUT', '/admin/settings', { program: { waitlist_max: 0, waitlist_full_text: 'Die Warteliste ist gerade voll. Schau bald wieder vorbei!' } });
  assert.deepEqual((await proxy('GET', '/warteliste')).data, { voll: false, text: null });
  await shopWaitlist(false);
  assert.equal((await admin.req('GET', '/admin/invites')).data.limit.full, false);

  // Umstellung auf 1.4: bisherige Stufe bleibt als Untergrenze, ohne Mitteilungen
  sql("UPDATE club_members SET tier = 'gold', tier_floor = NULL WHERE id = ?", [emilId]);
  sql("DELETE FROM club_settings WHERE k = 'rules_14'");
  sql("UPDATE club_settings SET v = ? WHERE k = 'schema_version'", [JSON.stringify('1.3.2')]);
  const queued = sql('SELECT COUNT(*) AS n FROM club_push_queue')[0].n;
  r = await emil.req('GET', '/me');
  assert.equal(r.status, 200);
  assert.equal(setting('schema_version'), '1.5.1');
  assert.ok(setting('rules_14'));
  assert.deepEqual(sql('SELECT tier, tier_floor FROM club_members WHERE id = ?', [emilId])[0], { tier: 'gold', tier_floor: 'gold' });
  assert.equal(r.data.tier.key, 'gold', 'Stufe bleibt trotz Rückgabe');
  assert.equal(sql('SELECT COUNT(*) AS n FROM club_push_queue')[0].n, queued, 'keine Mitteilungen durch die Umstellung');
  const prog = Object.fromEntries(setting('program').tiers.map((t) => [t.key, t.min_cents]));
  assert.deepEqual(prog, { bronze: 0, silber: 20000, gold: 50000, platin: 100000 });

  // Emil tritt wieder aus (Zahlen der folgenden Tests bleiben gleich)
  assert.equal((await emil.req('DELETE', '/me')).status, 200);
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
