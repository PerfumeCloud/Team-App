// Perfume Cloud · Team-Widget für Scriptable (kostenlos im App Store)
// Persönlicher, nur lesender Zugang für __NAME__ – bitte nicht weitergeben.
// Neu erzeugen oder sperren: Team-App → Einstellungen → iPhone-Widget.
// Größe: klein, mittel oder groß – einfach das Widget in der gewünschten Größe hinzufügen.
// Kalender-Widget: Widget lange drücken → „Widget bearbeiten“ → bei Parameter „kalender“ eintragen.
// Club-Widget (Mitglieder, neue Beitritte, Stufen, Bewertungen): bei Parameter „club“ eintragen.

const BASE_URL = '__URL__';
const TOKEN = '__TOKEN__';
const PARAM = typeof args !== 'undefined' && args && args.widgetParameter ? String(args.widgetParameter).toLowerCase() : '';
const CALENDAR = PARAM.includes('kalender') || PARAM.includes('termin');
const CLUB = !CALENDAR && (PARAM.includes('club') || PARAM.includes('mitglied'));

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
// Farben je Art des Termins – wie in der App
const KIND = {
  termin: Color.dynamic(new Color('#2F4E85'), new Color('#B9CBF0')),
  meeting: Color.dynamic(new Color('#3F6B4E'), new Color('#A9D1B4')),
  event: Color.dynamic(new Color('#6B3F7E'), new Color('#D3B2E0')),
  frist: Color.dynamic(new Color('#8E3B36'), new Color('#EDB4AD')),
  // automatisch eingetragen
  feiertag: C.bad,
  aktion: C.warn,
};
const SPECIAL = { feiertag: 'Feiertag', aktion: 'Aktionstag' };
// Club-Stufen
const TIER = {
  bronze: Color.dynamic(new Color('#9A6B3F'), new Color('#D9A877')),
  silber: Color.dynamic(new Color('#7D838C'), new Color('#C3C8CF')),
  gold: Color.dynamic(new Color('#B08A1E'), new Color('#E8C766')),
};
// Eingetragene Termine – Feiertage und Aktionstage nur, wo eine Liste Platz hat
const own = (d) => (d.events || []).filter((e) => !SPECIAL[e.kind]);

const num = (n) => new Intl.NumberFormat('de-DE').format(n || 0);
const stars = (avg) => avg.toFixed(1).replace('.', ',') + ' ★';
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

// ---------- Kalender ----------

function dayName(iso) {
  if (iso === isoToday(0)) return 'Heute';
  if (iso === isoToday(1)) return 'Morgen';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function eventTime(e) {
  if (SPECIAL[e.kind]) return SPECIAL[e.kind];
  if (!e.start) return e.endDate && e.endDate !== e.date ? 'ganztägig, bis ' + dayName(e.endDate) : 'ganztägig';
  return e.end ? e.start + '–' + e.end : e.start + ' Uhr';
}

function eventLine(stack, e, opts) {
  const row = stack.addStack();
  row.spacing = 7;
  const bar = row.addStack();
  bar.size = new Size(3, opts.tall ? 30 : 24);
  bar.cornerRadius = 1.5;
  bar.backgroundColor = KIND[e.kind] || C.accent;
  const col = row.addStack();
  col.layoutVertically();
  const top = col.addStack();
  text(top, (opts.withDay ? dayName(e.date) + ' · ' : '') + eventTime(e), Font.mediumSystemFont(10), C.ink3);
  text(col, e.title, Font.semiboldSystemFont(opts.big ? 14 : 12), C.ink, opts.big ? 2 : 1);
  if (opts.tall && e.location) text(col, e.location, Font.systemFont(10), C.ink2);
  row.addSpacer();
  stack.addSpacer(opts.gap || 6);
}

function calSmall(widget, d) {
  const events = d.events || [];
  const row = widget.addStack();
  row.centerAlignContent();
  symbol(row, 'calendar', 12, C.accent);
  row.addSpacer(5);
  text(row, 'Termine', new Font('Georgia-Bold', 13), C.ink);
  widget.addSpacer(8);
  if (!events.length) {
    text(widget, 'Nichts geplant', Font.semiboldSystemFont(14), C.ink);
    text(widget, 'in den nächsten 14 Tagen', Font.systemFont(11), C.ink2, 2);
    widget.addSpacer();
    return;
  }
  const e = own(d)[0] || events[0];
  text(widget, dayName(e.date).toUpperCase(), Font.semiboldSystemFont(10), KIND[e.kind] || C.accent);
  text(widget, eventTime(e), Font.mediumSystemFont(11), C.ink2);
  widget.addSpacer(2);
  text(widget, e.title, Font.boldSystemFont(15), C.ink, 3);
  if (e.location) text(widget, e.location, Font.systemFont(10), C.ink2);
  widget.addSpacer();
  if (events.length > 1) text(widget, '+ ' + (events.length - 1) + ' weitere', Font.systemFont(10), C.ink3);
}

function calList(widget, d, max) {
  header(widget, d.name);
  widget.addSpacer(8);
  const events = (d.events || []).slice(0, max);
  if (!events.length) {
    text(widget, 'Keine Termine in den nächsten 14 Tagen.', Font.systemFont(12), C.ink2, 2);
    return;
  }
  let lastDay = null;
  for (const e of events) {
    if (max > 4 && e.date !== lastDay) {
      if (lastDay !== null) widget.addSpacer(2);
      text(widget, dayName(e.date).toUpperCase(), Font.semiboldSystemFont(9), C.ink3);
      widget.addSpacer(4);
      lastDay = e.date;
    }
    eventLine(widget, e, { withDay: max <= 4, tall: max > 4 });
  }
}

function calLock(widget, family, d) {
  const events = d.events || [];
  const today = own(d).filter((e) => e.date <= isoToday(0));
  if (family === 'accessoryInline') {
    const e = own(d)[0] || events[0];
    text(widget, e ? '📅 ' + (e.date === isoToday(0) ? '' : dayName(e.date) + ' ') + (e.start || '') + ' ' + e.title : '📅 Keine Termine', Font.systemFont(12), Color.white());
    return;
  }
  if (family === 'accessoryCircular') {
    widget.addSpacer();
    const t = text(widget, today.length, Font.boldSystemFont(22), Color.white());
    t.centerAlignText();
    const l = text(widget, 'heute', Font.systemFont(10), Color.white());
    l.centerAlignText();
    widget.addSpacer();
    return;
  }
  if (!events.length) {
    text(widget, 'Keine Termine', Font.semiboldSystemFont(12), Color.white());
    return;
  }
  for (const e of events.slice(0, 2)) {
    text(widget, (e.date === isoToday(0) ? '' : dayName(e.date) + ' ') + (e.start || SPECIAL[e.kind] || 'ganztägig'), Font.systemFont(11), Color.white());
    text(widget, e.title, Font.semiboldSystemFont(12), Color.white());
  }
}

// ---------- Members Club ----------

function isoOf(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function joined(ms) {
  const iso = isoOf(ms);
  if (iso === isoToday(0)) return 'heute';
  if (iso === isoToday(-1)) return 'gestern';
  return dayName(iso);
}

function clubNew(c) {
  return c.new_today ? '+' + c.new_today + ' heute' : '+' + c.new_7 + ' in 7 Tagen';
}

function noClub(widget) {
  header(widget, null);
  widget.addSpacer(8);
  text(widget, 'Members Club', Font.semiboldSystemFont(14), C.ink);
  text(widget, 'Kein Club-Zugang oder Club nicht verbunden.', Font.systemFont(11), C.ink2, 3);
  widget.addSpacer();
}

function memberList(stack, c, max) {
  const list = (c.recent || []).slice(0, max);
  if (!list.length) {
    text(stack, 'Noch keine Mitglieder.', Font.systemFont(12), C.ink2);
    return;
  }
  for (const m of list) {
    const row = stack.addStack();
    row.centerAlignContent();
    row.spacing = 6;
    symbol(row, 'circle.fill', 7, TIER[m.tier] || C.accent);
    text(row, m.name, Font.mediumSystemFont(12), C.ink);
    row.addSpacer();
    text(row, joined(m.at), Font.systemFont(11), C.ink3);
    stack.addSpacer(5);
  }
}

function clubSmall(widget, c) {
  const row = widget.addStack();
  row.centerAlignContent();
  symbol(row, 'crown.fill', 12, C.accent);
  row.addSpacer(5);
  text(row, 'Club', new Font('Georgia-Bold', 13), C.ink);
  widget.addSpacer(8);
  text(widget, num(c.members), Font.boldSystemFont(26), C.ink);
  text(widget, 'Mitglieder', Font.systemFont(11), C.ink2);
  widget.addSpacer();
  metric(widget, 'person.badge.plus', '+' + c.new_today, 'heute', c.new_today ? C.accent : C.ink3);
  widget.addSpacer(3);
  metric(widget, 'calendar', '+' + c.new_7, '7 Tage', C.accent);
  if (c.survey && c.survey.avg) {
    widget.addSpacer(3);
    metric(widget, 'star.fill', stars(c.survey.avg), 'Ø', C.warn);
  }
}

function clubMedium(widget, d, c) {
  header(widget, d.name);
  widget.addSpacer(8);
  const body = widget.addStack();
  body.spacing = 12;
  const left = body.addStack();
  left.layoutVertically();
  text(left, num(c.members), Font.boldSystemFont(20), C.ink);
  text(left, 'im Members Club', Font.systemFont(11), C.ink2);
  left.addSpacer(4);
  metric(left, 'person.badge.plus', '+' + c.new_today, 'heute', c.new_today ? C.accent : C.ink3);
  left.addSpacer(3);
  metric(left, 'calendar', '+' + c.new_7, '7 Tage', C.accent);
  if (c.survey && c.survey.avg) {
    left.addSpacer(3);
    metric(left, 'star.fill', stars(c.survey.avg), 'Ø', C.warn);
  }
  const right = body.addStack();
  right.layoutVertically();
  text(right, 'NEU IM CLUB', Font.semiboldSystemFont(9), C.ink3);
  right.addSpacer(5);
  memberList(right, c, 3);
}

function clubLarge(widget, d, c) {
  header(widget, d.name);
  widget.addSpacer(10);
  const tiles = widget.addStack();
  tiles.spacing = 8;
  tile(tiles, 'crown.fill', num(c.members), 'Mitglieder');
  tile(tiles, 'person.badge.plus', '+' + c.new_today, 'neu heute', c.new_today ? C.accent : C.ink3);
  tile(tiles, 'calendar', '+' + c.new_7, 'in 7 Tagen');
  if (c.survey && c.survey.avg) tile(tiles, 'star.fill', stars(c.survey.avg), c.survey.count + ' Bewert.', C.warn);
  widget.addSpacer(12);
  text(widget, 'STUFEN', Font.semiboldSystemFont(9), C.ink3);
  widget.addSpacer(6);
  const tiers = widget.addStack();
  tiers.centerAlignContent();
  tiers.spacing = 5;
  for (const t of c.tiers || []) {
    symbol(tiers, 'circle.fill', 7, TIER[t.key] || C.accent);
    text(tiers, t.name, Font.systemFont(12), C.ink2);
    text(tiers, num(t.count), Font.semiboldSystemFont(12), C.ink);
    tiers.addSpacer(8);
  }
  widget.addSpacer(12);
  text(widget, 'NEU IM CLUB', Font.semiboldSystemFont(9), C.ink3);
  widget.addSpacer(6);
  memberList(widget, c, 5);
  if (c.promotion) {
    widget.addSpacer(4);
    text(widget, 'AKTION LÄUFT', Font.semiboldSystemFont(9), C.ink3);
    widget.addSpacer(4);
    const until = dayName(isoOf(c.promotion.ends_at - 1));
    const label = until === 'Heute' || until === 'Morgen' ? until.toLowerCase() : until;
    text(widget, c.promotion.name + ' · ' + String(c.promotion.factor).replace('.', ',') + '× Punkte bis ' + label, Font.mediumSystemFont(12), C.warn);
  }
  widget.addSpacer();
}

function clubLock(widget, family, c) {
  if (family === 'accessoryInline') {
    text(widget, '👑 ' + num(c.members) + ' im Club · ' + clubNew(c), Font.systemFont(12), Color.white());
    return;
  }
  if (family === 'accessoryCircular') {
    widget.addSpacer();
    const t = text(widget, num(c.members), Font.boldSystemFont(20), Color.white());
    t.centerAlignText();
    const l = text(widget, 'Club', Font.systemFont(10), Color.white());
    l.centerAlignText();
    widget.addSpacer();
    return;
  }
  text(widget, 'Members Club', Font.semiboldSystemFont(12), Color.white());
  text(widget, num(c.members) + ' Mitglieder · ' + clubNew(c), Font.systemFont(12), Color.white());
  if (c.survey && c.survey.avg) text(widget, 'Ø ' + stars(c.survey.avg) + ' · ' + c.survey.count + ' Bewertungen', Font.systemFont(12), Color.white());
  else if (c.recent && c.recent[0]) text(widget, 'Neu: ' + c.recent[0].name, Font.systemFont(12), Color.white());
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
  if (d.club) {
    widget.addSpacer(3);
    metric(widget, 'crown.fill', num(d.club.members), d.club.new_today ? 'Club · +' + d.club.new_today : 'im Club', C.accent);
  }
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
    left.addSpacer(d.club ? 4 : 6);
    metric(left, 'shippingbox.fill', d.toShip, 'zu versenden', C.accent);
  } else {
    text(left, d.tasks.open, Font.boldSystemFont(22), C.ink);
    text(left, 'offene Aufgaben', Font.systemFont(11), C.ink2);
  }
  left.addSpacer(3);
  if (d.mail) metric(left, 'envelope.fill', d.importantMails, 'Mails', C.accent);
  if (d.club) {
    left.addSpacer(3);
    metric(left, 'crown.fill', num(d.club.members), d.club.new_today ? 'Club · +' + d.club.new_today : 'im Club', C.accent);
  }
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
  if (d.club) {
    widget.addSpacer(8);
    const club = widget.addStack();
    club.centerAlignContent();
    club.spacing = 6;
    symbol(club, 'crown.fill', 11, C.accent);
    text(club, num(d.club.members), Font.semiboldSystemFont(13), C.ink);
    text(club, 'im Club · ' + clubNew(d.club), Font.systemFont(12), C.ink2);
    club.addSpacer();
    if (d.club.survey && d.club.survey.avg) text(club, 'Ø ' + stars(d.club.survey.avg), Font.systemFont(12), C.warn);
  }
  widget.addSpacer(12);
  text(widget, 'FÜR DICH', Font.semiboldSystemFont(9), C.ink3);
  widget.addSpacer(6);
  taskList(widget, d.tasks, 4);
  const next = own(d)[0];
  if (next) {
    widget.addSpacer(4);
    text(widget, 'NÄCHSTER TERMIN', Font.semiboldSystemFont(9), C.ink3);
    widget.addSpacer(6);
    eventLine(widget, next, { withDay: true });
  }
  if (d.mail && d.mails && d.mails.length) {
    widget.addSpacer(6);
    text(widget, 'WICHTIGE MAILS', Font.semiboldSystemFont(9), C.ink3);
    widget.addSpacer(6);
    mailList(widget, d.mails, d.club ? 2 : 3);
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
  widget.url = BASE_URL + (CALENDAR ? '/kalender' : CLUB ? '/club' : '/');
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (family.startsWith('accessory')) {
    if (res.data && CALENDAR) calLock(widget, family, res.data);
    else if (res.data && CLUB) {
      if (res.data.club) clubLock(widget, family, res.data.club);
      else text(widget, 'Club: kein Zugang', Font.systemFont(12), Color.white());
    } else if (res.data) lockscreen(widget, family, res.data);
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
  const c = res.data.club;
  if (CALENDAR) {
    if (family === 'small') calSmall(widget, res.data);
    else calList(widget, res.data, family === 'large' || family === 'extraLarge' ? 7 : 3);
  } else if (CLUB) {
    if (!c) noClub(widget);
    else if (family === 'small') clubSmall(widget, c);
    else if (family === 'large' || family === 'extraLarge') clubLarge(widget, res.data, c);
    else clubMedium(widget, res.data, c);
  } else if (family === 'small') small(widget, res.data);
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
