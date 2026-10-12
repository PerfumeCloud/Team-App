// Perfume Cloud · Team-Widget für Scriptable (kostenlos im App Store)
// Persönlicher, nur lesender Zugang für __NAME__ – bitte nicht weitergeben.
// Neu erzeugen oder sperren: Team-App → Einstellungen → iPhone-Widget.
// Größe: klein, mittel oder groß – einfach das Widget in der gewünschten Größe hinzufügen.

const BASE_URL = '__URL__';
const TOKEN = '__TOKEN__';

const C = {
  bg: Color.dynamic(new Color('#F6F2EB'), new Color('#121315')),
  card: Color.dynamic(new Color('#FFFDF9'), new Color('#1B1D21')),
  ink: Color.dynamic(new Color('#1E2024'), new Color('#F1EDE6')),
  ink2: Color.dynamic(new Color('#565A61'), new Color('#BAB6AE')),
  ink3: Color.dynamic(new Color('#6E7177'), new Color('#8F8C86')),
  accent: Color.dynamic(new Color('#2F4E85'), new Color('#9DB5E8')),
  bad: Color.dynamic(new Color('#B4443A'), new Color('#E57A6E')),
  warn: Color.dynamic(new Color('#A8661A'), new Color('#E0A050')),
};

const euro = (cents) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), 'perfume-cloud-widget.json');

async function load() {
  try {
    const req = new Request(BASE_URL + '/api/widget?token=' + encodeURIComponent(TOKEN));
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    const status = req.response ? req.response.statusCode : 200;
    if (status !== 200) throw new Error((data && data.error) || 'Fehler ' + status);
    fm.writeString(cachePath, JSON.stringify(data));
    return { data, stale: false, error: null };
  } catch (e) {
    const error = String((e && e.message) || e);
    if (fm.fileExists(cachePath)) return { data: JSON.parse(fm.readString(cachePath)), stale: true, error };
    return { data: null, stale: true, error };
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoToday(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function dueLabel(iso) {
  if (!iso) return null;
  if (iso < isoToday(0)) return { text: 'überfällig', color: C.bad };
  if (iso === isoToday(0)) return { text: 'heute', color: C.warn };
  if (iso === isoToday(1)) return { text: 'morgen', color: C.ink3 };
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return { text: date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }), color: C.ink3 };
}

function text(stack, value, font, color, lines) {
  const t = stack.addText(String(value));
  t.font = font;
  t.textColor = color;
  t.lineLimit = lines || 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

function symbol(stack, name, size, color) {
  const sym = SFSymbol.named(name);
  if (!sym) return;
  sym.applyFont(Font.mediumSystemFont(size));
  const img = stack.addImage(sym.image);
  img.imageSize = new Size(size + 2, size + 2);
  img.tintColor = color;
}

function header(widget, name) {
  const row = widget.addStack();
  row.centerAlignContent();
  text(row, 'Perfume Cloud', new Font('Georgia-Bold', 13), C.ink);
  row.addSpacer();
  if (name) text(row, name, Font.mediumSystemFont(11), C.ink3);
}

function metric(stack, icon, value, label, color) {
  const row = stack.addStack();
  row.centerAlignContent();
  row.spacing = 6;
  symbol(row, icon, 11, color || C.accent);
  text(row, value, Font.semiboldSystemFont(13), C.ink);
  text(row, label, Font.systemFont(12), C.ink2);
}

function tile(stack, icon, value, label, color) {
  const t = stack.addStack();
  t.layoutVertically();
  t.backgroundColor = C.card;
  t.cornerRadius = 12;
  t.setPadding(8, 10, 8, 10);
  const top = t.addStack();
  top.centerAlignContent();
  symbol(top, icon, 10, color || C.accent);
  top.addSpacer();
  t.addSpacer(4);
  text(t, value, Font.semiboldSystemFont(17), C.ink);
  text(t, label, Font.systemFont(10), C.ink2);
  return t;
}

function taskList(stack, tasks, max) {
  const list = (tasks.next || []).slice(0, max);
  if (!list.length) {
    text(stack, 'Nichts offen – schön!', Font.systemFont(12), C.ink2);
    return;
  }
  for (const t of list) {
    const row = stack.addStack();
    row.centerAlignContent();
    row.spacing = 6;
    symbol(row, t.high ? 'flag.fill' : 'circle', 10, t.high ? C.bad : C.ink3);
    text(row, t.title, Font.mediumSystemFont(12), C.ink);
    row.addSpacer();
    const due = dueLabel(t.due);
    if (due) text(row, due.text, Font.systemFont(11), due.color);
    stack.addSpacer(5);
  }
}

function mailList(stack, mails, max) {
  for (const m of (mails || []).slice(0, max)) {
    const row = stack.addStack();
    row.layoutVertically();
    const top = row.addStack();
    text(top, m.from, Font.semiboldSystemFont(12), C.ink);
    top.addSpacer();
    text(top, m.mailbox, Font.systemFont(10), C.accent);
    text(row, m.subject, Font.systemFont(11), C.ink2);
    stack.addSpacer(6);
  }
}

function footer(widget, res) {
  const row = widget.addStack();
  row.addSpacer();
  const at = res.data && res.data.serverTime ? new Date(res.data.serverTime) : new Date();
  const label = (res.stale ? 'Offline · Stand ' : 'Stand ') + pad(at.getHours()) + ':' + pad(at.getMinutes());
  text(row, label, Font.systemFont(9), res.stale ? C.warn : C.ink3);
}

function small(widget, d) {
  header(widget, null);
  widget.addSpacer(6);
  if (d.shopify && d.today) {
    text(widget, euro(d.today.revenue), Font.boldSystemFont(22), C.ink);
    text(widget, 'heute · ' + d.today.orders + ' Best.', Font.systemFont(11), C.ink2);
  } else {
    text(widget, d.tasks.open, Font.boldSystemFont(24), C.ink);
    text(widget, 'offene Aufgaben', Font.systemFont(11), C.ink2);
  }
  widget.addSpacer();
  if (d.mail) metric(widget, 'envelope.fill', d.importantMails, 'wichtige Mails', d.importantMails ? C.accent : C.ink3);
  widget.addSpacer(3);
  metric(widget, 'checklist', d.tasks.open, d.tasks.overdue ? d.tasks.overdue + ' überfällig' : 'Aufgaben', d.tasks.overdue ? C.bad : C.accent);
}

function medium(widget, d) {
  header(widget, d.name);
  widget.addSpacer(8);
  const body = widget.addStack();
  body.spacing = 12;
  const left = body.addStack();
  left.layoutVertically();
  if (d.shopify && d.today) {
    text(left, euro(d.today.revenue), Font.boldSystemFont(20), C.ink);
    text(left, 'heute · ' + d.today.orders + ' Best.', Font.systemFont(11), C.ink2);
    left.addSpacer(6);
    metric(left, 'shippingbox.fill', d.toShip, 'zu versenden', C.accent);
  } else {
    text(left, d.tasks.open, Font.boldSystemFont(22), C.ink);
    text(left, 'offene Aufgaben', Font.systemFont(11), C.ink2);
  }
  left.addSpacer(3);
  if (d.mail) metric(left, 'envelope.fill', d.importantMails, 'Mails', C.accent);
  const right = body.addStack();
  right.layoutVertically();
  text(right, 'FÜR DICH', Font.semiboldSystemFont(9), C.ink3);
  right.addSpacer(5);
  taskList(right, d.tasks, 3);
}

function large(widget, d) {
  header(widget, d.name);
  widget.addSpacer(10);
  const tiles = widget.addStack();
  tiles.spacing = 8;
  if (d.shopify && d.today) {
    tile(tiles, 'eurosign.circle.fill', euro(d.today.revenue), 'Umsatz heute');
    tile(tiles, 'shippingbox.fill', String(d.toShip), 'zu versenden');
  }
  if (d.mail) tile(tiles, 'envelope.fill', String(d.importantMails), 'wichtige Mails');
  tile(tiles, 'checklist', String(d.tasks.open), d.tasks.overdue ? d.tasks.overdue + ' überfällig' : 'Aufgaben', d.tasks.overdue ? C.bad : C.accent);
  widget.addSpacer(12);
  text(widget, 'FÜR DICH', Font.semiboldSystemFont(9), C.ink3);
  widget.addSpacer(6);
  taskList(widget, d.tasks, 4);
  if (d.mail && d.mails && d.mails.length) {
    widget.addSpacer(6);
    text(widget, 'WICHTIGE MAILS', Font.semiboldSystemFont(9), C.ink3);
    widget.addSpacer(6);
    mailList(widget, d.mails, 3);
  }
  widget.addSpacer();
}

// Sperrbildschirm-Widgets (iOS 16+)
function lockscreen(widget, family, d) {
  const mails = d.mail ? d.importantMails : null;
  if (family === 'accessoryInline') {
    text(widget, (mails !== null ? '✉︎ ' + mails + '  ' : '') + '☑︎ ' + d.tasks.open + (d.shopify && d.today ? '  ' + euro(d.today.revenue) : ''), Font.systemFont(12), Color.white());
    return;
  }
  if (family === 'accessoryCircular') {
    widget.addSpacer();
    const n = mails !== null ? mails : d.tasks.open;
    const t = text(widget, n, Font.boldSystemFont(22), Color.white());
    t.centerAlignText();
    const l = text(widget, mails !== null ? 'Mails' : 'Aufg.', Font.systemFont(10), Color.white());
    l.centerAlignText();
    widget.addSpacer();
    return;
  }
  text(widget, 'Perfume Cloud', Font.semiboldSystemFont(12), Color.white());
  if (d.shopify && d.today) text(widget, euro(d.today.revenue) + ' heute · ' + d.today.orders + ' Best.', Font.systemFont(12), Color.white());
  text(widget, (mails !== null ? mails + ' Mails · ' : '') + d.tasks.open + ' Aufgaben' + (d.tasks.overdue ? ' (' + d.tasks.overdue + ' überf.)' : ''), Font.systemFont(12), Color.white());
}

async function build() {
  const res = await load();
  const widget = new ListWidget();
  const family = config.widgetFamily || 'medium';
  widget.url = BASE_URL + '/';
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (family.startsWith('accessory')) {
    if (res.data) lockscreen(widget, family, res.data);
    else text(widget, 'Perfume Cloud: offline', Font.systemFont(12), Color.white());
    return widget;
  }
  widget.backgroundColor = C.bg;
  widget.setPadding(14, 14, 12, 14);

  if (!res.data) {
    header(widget, null);
    widget.addSpacer(8);
    text(widget, 'Keine Daten', Font.semiboldSystemFont(14), C.ink);
    text(widget, res.error || 'Bitte Internetverbindung prüfen.', Font.systemFont(11), C.ink2, 4);
    widget.addSpacer();
    return widget;
  }
  if (family === 'small') small(widget, res.data);
  else if (family === 'large' || family === 'extraLarge') large(widget, res.data);
  else medium(widget, res.data);
  if (family !== 'small') {
    widget.addSpacer();
    footer(widget, res);
  }
  return widget;
}

const widget = await build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
