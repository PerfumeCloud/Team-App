// Integrationstests für die Kunden-App (PHP-Backend mit SQLite und einem Shopify-Nachbau).
// Aufruf: node --test kunden-app/server/tests/*.test.mjs   (PHP 8.1+ nötig)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
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
};
let php, shop;

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
  r = await admin.req('POST', '/setup', { db: { driver: 'sqlite' } }, { 'X-PC': '' });
  assert.equal(r.status, 403, 'ohne Schutz-Header');
  r = await admin.req('POST', '/setup', { db: { driver: 'sqlite' }, admin: { name: 'Marius', email: 'marius@example.de', password: 'kurz' } });
  assert.equal(r.status, 422);
  r = await admin.req('POST', '/setup', { db: { driver: 'sqlite' }, admin: { name: 'Marius', email: 'Marius@Example.de', password: 'geheim-12345' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.admin.email, 'marius@example.de');
  r = await new Client().req('POST', '/setup', { db: { driver: 'sqlite' }, admin: { name: 'X', email: 'x@example.de', password: 'geheim-12345' } });
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
  sql("UPDATE ledger SET points = points + 100 WHERE kind = 'welcome'"); // genug Punkte für einen zweiten Code
  r = await anna.req('POST', '/codes', { steps: 1 });
  const exp = r.data.code;
  sql('UPDATE codes SET expires_at = ? WHERE id = ?', [Date.now() - 1000, exp.id]);
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
  assert.equal(r.data.points_available, 198);
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
  assert.equal(sql("SELECT COUNT(*) AS n FROM ledger")[0].n, 0);
  const d = await admin.req('GET', '/admin/dashboard');
  assert.equal(d.data.members, 0);
});

test('Keine Geheimnisse im Klartext in der Datenbank', () => {
  const rows = sql("SELECT k, v FROM settings WHERE k IN ('shopify_secret', 'shopify_token')");
  for (const r of rows) {
    assert.ok(!r.v.includes('admin-secret') && !r.v.includes('shpat_mock'), r.k);
  }
  assert.ok(existsSync(env.CLUB_CONFIG));
});
