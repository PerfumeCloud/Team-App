// Prüft das Scriptable-Widget-Skript mit einer nachgebauten Scriptable-Umgebung.
// Aufruf: node --test team-app/web/tests/   (optional WIDGET_URL/WIDGET_TOKEN für echten Server)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, '../src/lib/widget-template.js'), 'utf8');

const SAMPLE = {
  name: 'Marius',
  serverTime: Date.now(),
  shopify: true,
  mail: true,
  today: { revenue: 22680, orders: 2 },
  toShip: 5,
  importantMails: 5,
  mails: [
    { from: 'Julia Weber', subject: 'Bestellung #1042 noch nicht angekommen', mailbox: 'support@', at: Date.now() },
    { from: 'Carla', subject: 'Fotoshooting', mailbox: 'info@', at: Date.now() },
  ],
  tasks: { open: 3, overdue: 1, today: 0, next: [{ title: 'Retoure #1038 prüfen', due: '2020-01-01', high: true }, { title: 'Newsletter', due: null, high: false }] },
};

/** Minimaler Nachbau der Scriptable-API, der mitschreibt, was gezeichnet wird. */
function scriptable({ family, response, status = 200, fail = false }) {
  const texts = [];
  const symbols = [];
  let finalWidget = null;
  let completed = false;
  class Color {
    constructor(hex) { this.hex = hex; }
    static dynamic(a) { return a; }
    static white() { return new Color('#fff'); }
  }
  class Font {
    constructor(name, size) { this.name = name; this.size = size; }
  }
  for (const m of ['systemFont', 'mediumSystemFont', 'semiboldSystemFont', 'boldSystemFont']) Font[m] = (s) => new Font(m, s);
  class Size { constructor(w, h) { Object.assign(this, { w, h }); } }
  class Stack {
    constructor() { this.children = []; }
    addText(v) {
      assert.equal(typeof v, 'string', 'addText braucht einen String');
      const t = { text: v, centerAlignText() {} };
      texts.push(v);
      this.children.push(t);
      return t;
    }
    addStack() { const s = new Stack(); this.children.push(s); return s; }
    addImage(img) { assert.ok(img, 'Bild fehlt'); const i = {}; this.children.push(i); return i; }
    addSpacer() {}
    layoutVertically() {}
    layoutHorizontally() {}
    centerAlignContent() {}
    setPadding(...a) { assert.equal(a.length, 4); }
  }
  class ListWidget extends Stack {
    async presentMedium() { finalWidget = this; }
  }
  const SFSymbol = { named: (n) => { symbols.push(n); return { applyFont() {}, image: { symbol: n } }; } };
  class Request {
    constructor(url) { this.url = url; }
    async loadJSON() {
      if (fail) throw new Error('Die Internetverbindung scheint offline zu sein.');
      this.response = { statusCode: status };
      if (process.env.WIDGET_URL) {
        const r = await fetch(this.url);
        this.response = { statusCode: r.status };
        return r.json();
      }
      return structuredClone(response);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'scriptable-'));
  const files = {};
  const FileManager = {
    local: () => ({
      documentsDirectory: () => dir,
      joinPath: (a, b) => join(a, b),
      writeString: (p, s) => { files[p] = s; },
      readString: (p) => files[p],
      fileExists: (p) => p in files,
    }),
  };
  const Script = { setWidget: (w) => { finalWidget = w; }, complete: () => { completed = true; } };
  const config = { widgetFamily: family, runsInWidget: true };
  const env = { Color, Font, Size, ListWidget, SFSymbol, Request, FileManager, Script, config };
  return { env, result: () => ({ widget: finalWidget, texts, symbols, completed, files }) };
}

async function run(opts) {
  const url = process.env.WIDGET_URL ?? 'https://team.example.de';
  const token = process.env.WIDGET_TOKEN ?? 'pcw_test';
  const code = template.replaceAll('__URL__', url).replaceAll('__TOKEN__', token).replaceAll('__NAME__', 'Test');
  const { env, result } = scriptable(opts);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction(...Object.keys(env), code)(...Object.values(env));
  return result();
}

for (const family of ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
  test(`Widget ${family}`, async () => {
    const r = await run({ family, response: SAMPLE });
    assert.ok(r.widget, 'Widget gesetzt');
    assert.ok(r.completed, 'Script.complete() aufgerufen');
    const all = r.texts.join(' | ');
    if (process.env.WIDGET_URL) console.log(`  ${family}: ${all}`);
    if (!process.env.WIDGET_URL) {
      if (family !== 'accessoryCircular') assert.match(all, /226,80/);
      if (family === 'accessoryCircular') assert.match(all, /^5 \| Mails$/);
      if (family === 'medium' || family === 'large') assert.match(all, /Retoure #1038 prüfen \| überfällig/);
      if (family === 'large') assert.match(all, /Julia Weber/);
    }
  });
}

test('Widget ohne Shopify', { skip: !!process.env.WIDGET_URL }, async () => {
  const r = await run({ family: 'medium', response: { ...SAMPLE, shopify: false, today: null, toShip: null } });
  assert.match(r.texts.join(' | '), /offene Aufgaben/);
});

test('Widget offline mit Zwischenspeicher', { skip: !!process.env.WIDGET_URL }, async () => {
  const s = scriptable({ family: 'medium', response: SAMPLE });
  assert.ok(s);
  const first = await run({ family: 'medium', response: SAMPLE });
  assert.ok(Object.keys(first.files).length === 1, 'Daten werden zwischengespeichert');
});

test('Widget ohne Verbindung und ohne Zwischenspeicher', { skip: !!process.env.WIDGET_URL }, async () => {
  const r = await run({ family: 'medium', fail: true });
  assert.match(r.texts.join(' | '), /Keine Daten/);
});

test('Widget mit ungültigem Schlüssel', { skip: !!process.env.WIDGET_URL }, async () => {
  const r = await run({ family: 'small', status: 401, response: { error: 'Widget-Schlüssel ungültig.' } });
  assert.match(r.texts.join(' | '), /Widget-Schlüssel ungültig/);
});
