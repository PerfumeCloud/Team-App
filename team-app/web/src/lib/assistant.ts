// Ideen-Assistent ohne KI: zerlegt deutschen Freitext in eine Notiz und/oder Aufgaben.
// Läuft komplett im Browser (kostenlos, offline) und hat bewusst keine Imports,
// damit die Tests ihn direkt mit Node laden können.

export type Priority = 'low' | 'normal' | 'high';
export type Mode = 'auto' | 'note' | 'tasks' | 'event';
export type EventKind = 'termin' | 'meeting' | 'event' | 'frist';

export interface Person {
  id: string;
  name: string;
}

export interface Context {
  people: Person[];
  meId: string | null;
  /** Heute als JJJJ-MM-TT (Ortszeit). */
  today: string;
  /** Bereits benutzte Kategorien – werden in ihrer Schreibweise wiederverwendet. */
  categories: string[];
}

export interface DraftTask {
  key: string;
  title: string;
  assigneeId: string | null;
  due: string | null;
  priority: Priority;
  category: string | null;
  checklist: string[];
}

export interface DraftNote {
  title: string;
  body: string;
}

export interface DraftEvent {
  key: string;
  title: string;
  kind: EventKind;
  date: string;
  /** Letzter Tag bei mehrtägigen Terminen */
  endDate: string | null;
  /** HH:MM; null = ganztägig */
  start: string | null;
  end: string | null;
  location: string | null;
  /** Teilnehmer; leer = ganzes Team */
  attendees: string[];
}

export interface Draft {
  note: DraftNote | null;
  tasks: DraftTask[];
  /** Fehlt in älteren gespeicherten Verläufen */
  events?: DraftEvent[];
}

/* ───────────────────────── Hilfen ───────────────────────── */

const L = '\\p{L}\\p{N}';
/** Findet `pattern` als ganzes Wort (auch mit Umlauten). Gruppe 1 = Zeichen davor. */
const word = (pattern: string, flags = 'iu') => new RegExp(`(^|[^${L}])(${pattern})(?=$|[^${L}])`, flags);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase('de-DE') + s.slice(1) : s);
const trimPunct = (s: string) => s.replace(/^[\s,;:.!?–—\-/]+|[\s,;:.–—\-/]+$/g, '').replace(/\s*[!?]+$/, '').trim();

function removeSpan(s: string, start: number, end: number): string {
  // Übrig gebliebene Satzzeichen („…, !“) gleich mit entfernen
  return squash(s.slice(0, start) + ' ' + s.slice(end))
    .replace(/(^|\s)[,;:!?.]+(?=\s|$)/g, '$1')
    .replace(/\s+([,;:!?.])/g, '$1')
    .trim();
}

/* ───────────────────────── Datum ───────────────────────── */

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function plus(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}
function lastOfMonth(y: number, m0: number): Date {
  return new Date(y, m0 + 1, 0);
}
/** Nächster Wochentag `wd` (0 = So) strikt nach `from`. */
function nextWeekday(from: Date, wd: number): Date {
  const diff = (wd - from.getDay() + 7) % 7 || 7;
  return plus(from, diff);
}
function mondayOf(d: Date): Date {
  return plus(d, -((d.getDay() + 6) % 7));
}
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  return plus(mondayOf(jan4), (week - 1) * 7);
}
function nthWeekday(year: number, m0: number, wd: number, n: number): Date {
  const first = new Date(year, m0, 1);
  return plus(first, ((wd - first.getDay() + 7) % 7) + (n - 1) * 7);
}

const WEEKDAYS: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6 };
const WEEKDAY_ABBR: Record<string, number> = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 };
const MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6,
  juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};
const NUMBERS: Record<string, number> = { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12 };

const WD_RE = '(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)(?:s|abend|morgen|früh|mittag|nachmittag|vormittag)?';
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

interface DateHit {
  start: number;
  end: number;
  date: Date;
  /** „bis“, „spätestens“ … davor – nur für die Kalenderwoche relevant. */
  deadline: boolean;
}

/** Jahr ergänzen: liegt das Datum mehr als 30 Tage zurück, ist das nächste Jahr gemeint. */
function upcoming(today: Date, m0: number, d: number, year?: number): Date | null {
  if (m0 < 0 || m0 > 11 || d < 1 || d > 31) return null;
  if (year !== undefined) {
    const y = year < 100 ? 2000 + year : year;
    const date = new Date(y, m0, d);
    return date.getMonth() === m0 ? date : null;
  }
  let date = new Date(today.getFullYear(), m0, d);
  if (date.getMonth() !== m0) return null;
  if (date.getTime() < plus(today, -30).getTime()) date = new Date(today.getFullYear() + 1, m0, d);
  return date;
}

function upcomingMonth(today: Date, m0: number): number {
  return m0 < today.getMonth() ? today.getFullYear() + 1 : today.getFullYear();
}

/** Alle Datumsangaben im Text (auch überlappende). */
function dateHits(text: string, today: Date): DateHit[] {
  const hits: DateHit[] = [];
  const add = (re: RegExp, make: (m: RegExpExecArray) => Date | null) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      const start = m.index + (m[1]?.length ?? 0);
      const date = make(m);
      if (date) hits.push({ start, end: m.index + m[0].length, date, deadline: false });
      if (g.lastIndex === m.index) g.lastIndex++;
    }
  };

  // 2026-11-15
  add(/(^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/u, (m) => upcoming(today, +m[3] - 1, +m[4], +m[2]));
  // 15.11. / 15.11.2026 / 15.11.26
  add(/(^|[^\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/u, (m) => upcoming(today, +m[3] - 1, +m[2], m[4] ? +m[4] : undefined));
  // 3. Dezember (2026)
  add(word(`(\\d{1,2})\\.?\\s*(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?`), (m) => upcoming(today, MONTHS[m[4].toLowerCase()] - 1, +m[3], m[5] ? +m[5] : undefined));
  // Anfang/Mitte/Ende November
  add(word(`(anfang|mitte|ende)\\s+(${MONTH_RE})`), (m) => {
    const m0 = MONTHS[m[4].toLowerCase()] - 1;
    const y = upcomingMonth(today, m0);
    const part = m[3].toLowerCase();
    return part === 'anfang' ? new Date(y, m0, 1) : part === 'mitte' ? new Date(y, m0, 15) : lastOfMonth(y, m0);
  });
  // Monatsende / Ende des Monats / Ende nächsten Monats / Anfang nächsten Monats
  add(word('monatsende|ende\\s+(?:des\\s+|dieses\\s+)?monats|ende\\s+monat'), () => lastOfMonth(today.getFullYear(), today.getMonth()));
  add(word('ende\\s+(?:des\\s+)?(?:nächsten|kommenden)\\s+monats'), () => lastOfMonth(today.getFullYear(), today.getMonth() + 1));
  add(word('(?:anfang\\s+)?(?:des\\s+)?(?:nächsten|kommenden)\\s+monats?|nächsten\\s+monat|monatsanfang'), () => new Date(today.getFullYear(), today.getMonth() + 1, 1));
  // heute / morgen / übermorgen
  add(word('heute|heut'), () => today);
  add(word('morgen(?:\\s+früh)?'), () => plus(today, 1));
  add(word('übermorgen'), () => plus(today, 2));
  // in 3 Tagen / in zwei Wochen / in einem Monat
  add(word(`in\\s+(\\d{1,3}|${Object.keys(NUMBERS).join('|')})\\s+(tagen?|wochen?|monaten?)`), (m) => {
    const n = /^\d+$/.test(m[3]) ? +m[3] : NUMBERS[m[3].toLowerCase()];
    const unit = m[4].toLowerCase();
    if (unit.startsWith('tag')) return plus(today, n);
    if (unit.startsWith('woche')) return plus(today, 7 * n);
    return new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
  });
  // nächste Woche Freitag / Freitag nächste Woche
  add(word(`(?:nächste|kommende)\\s+woche\\s+${WD_RE}`), (m) => plus(mondayOf(plus(today, 7)), (WEEKDAYS[m[3].toLowerCase()] + 6) % 7));
  add(word(`${WD_RE}\\s+(?:nächster|nächste|kommender|kommende)\\s+woche`), (m) => plus(mondayOf(plus(today, 7)), (WEEKDAYS[m[3].toLowerCase()] + 6) % 7));
  add(word('übernächste\\s+woche'), () => mondayOf(plus(today, 14)));
  add(word('(?:nächste|kommende)\\s+woche'), () => mondayOf(plus(today, 7)));
  // Ende der Woche / diese Woche / Wochenende
  add(word('ende\\s+(?:der\\s+|dieser\\s+)?woche|diese\\s+woche'), () => (today.getDay() === 6 || today.getDay() === 0 ? today : plus(mondayOf(today), 4)));
  add(word('(?:am\\s+)?wochenende'), () => (today.getDay() === 6 || today.getDay() === 0 ? today : plus(mondayOf(today), 5)));
  // Freitag / Freitagabend
  add(word(WD_RE), (m) => nextWeekday(today, WEEKDAYS[m[3].toLowerCase()]));
  // Fr. / Mo.
  add(/(^|[^\p{L}])(Mo|Di|Mi|Do|Fr|Sa|So)\.(?=\s|$)/u, (m) => nextWeekday(today, WEEKDAY_ABBR[m[2].toLowerCase()]));
  // KW 47
  add(word('kw\\s?(\\d{1,2})'), (m) => {
    const w = +m[3];
    if (w < 1 || w > 53) return null;
    let y = today.getFullYear();
    if (isoWeekMonday(y, w).getTime() < mondayOf(today).getTime()) y++;
    return isoWeekMonday(y, w);
  });
  // Feiertage und Shop-Termine
  const y = today.getFullYear();
  const yearly = (make: (year: number) => Date) => () => {
    const d = make(y);
    return d.getTime() < today.getTime() ? make(y + 1) : d;
  };
  add(word('heiligabend|weihnachten'), yearly((yr) => new Date(yr, 11, 24)));
  add(word('silvester'), yearly((yr) => new Date(yr, 11, 31)));
  add(word('neujahr'), yearly((yr) => new Date(yr, 0, 1)));
  add(word('valentinstag'), yearly((yr) => new Date(yr, 1, 14)));
  add(word('muttertag'), yearly((yr) => nthWeekday(yr, 4, 0, 2)));
  add(word('black\\s+friday'), yearly((yr) => plus(nthWeekday(yr, 10, 4, 4), 1)));
  add(word('cyber\\s+monday'), yearly((yr) => plus(nthWeekday(yr, 10, 4, 4), 4)));
  return hits;
}

/** Sucht die (längste) Datumsangabe im Text. */
export function findDate(text: string, todayIso: string): DateHit | null {
  const hits = dateHits(text, parseIso(todayIso));
  if (!hits.length) return null;
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const hit = hits[0];

  // Wörter davor mitnehmen („bis zum“, „spätestens am“, „am“ …)
  const before = text.slice(0, hit.start);
  const pre = /(?:(?:^|\s)(?:bis|zum|zur|spätestens|am|ab|für|den|nächsten|nächster|kommenden|diesen|dieser|noch|vor|im|in\s+der)(?=\s))+\s*$/iu.exec(before);
  if (pre) {
    hit.deadline = /bis|spätestens|vor/i.test(pre[0]);
    hit.start = pre.index;
  }
  // „bis KW 47“ = Freitag dieser Woche
  if (hit.deadline && /kw\s?\d/i.test(text.slice(hit.start, hit.end))) hit.date = plus(hit.date, 4);
  return hit;
}

/* ───────────────────────── Uhrzeit, Zeitraum, Ort ───────────────────────── */

interface Span {
  start: number;
  end: number;
}
export interface TimeHit extends Span {
  from: string;
  to: string | null;
}

const HOUR_WORDS: Record<string, number> = { ...NUMBERS, eins: 1 };
const DAYPART = '(?:\\s+(?:uhr\\s+)?(morgens|früh|vormittags|mittags|nachmittags|abends|nachts))?';
// Zahl danach ist eine Menge, keine Uhrzeit („von 10 bis 20 Stück“)
const NO_UNIT = '(?!\\s*(?:%|prozent|euro|eur|€|stück|stk|tage?n?|wochen?|monate?n?|jahre?n?|minuten|min|sekunden|cent|kg|g|ml|l|x|mal|leute|personen|flakons?|proben?)(?![\\p{L}]))';
const T = '(\\d{1,2})(?:([:.])(\\d{2}))?(?!\\d)';
const B = '(^|[^\\p{L}\\p{N}.:])';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Stunde anpassen: „um 3“ und „abends um 8“ meinen den Nachmittag bzw. Abend. */
function hour(h: number, part: string | undefined, hasMinutes: boolean): number {
  const p = part?.toLowerCase();
  if (p && /nachmittags|abends/.test(p) && h < 12) return h + 12;
  if (p === 'nachts' && h === 12) return 0;
  if (!p && !hasMinutes && h >= 1 && h <= 6) return h + 12;
  return h;
}
function hhmm(h: number, m: number): string | null {
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? `${pad2(h)}:${pad2(m)}` : null;
}

/** Sucht eine Uhrzeit („um 14 Uhr“, „14:30“, „von 10 bis 12“, „halb drei“). */
export function findTime(text: string): TimeHit | null {
  const flags = 'iu';
  // von 10 bis 12 Uhr · 10–12 Uhr · 10:00-11:30 · zwischen 10 und 12
  const range = new RegExp(`${B}(?:(von|zwischen)\\s+)?${T}\\s*(?:uhr\\s*)?(-|–|bis|und)\\s*${T}\\s*(uhr)?${DAYPART}${NO_UNIT}`, flags).exec(text);
  if (range) {
    const [, pre, von, h1, s1, m1, sep, h2, s2, m2, uhr, part] = range;
    const dotted = s1 === '.' || s2 === '.';
    const ok = (von || uhr || s1 === ':' || s2 === ':') && (sep.toLowerCase() !== 'und' || von?.toLowerCase() === 'zwischen') && (!dotted || uhr);
    if (ok) {
      const a = hour(+h1, part, !!m1);
      let b = hour(+h2, part, !!m2);
      if (b < a && b + 12 <= 23) b += 12;
      const from = hhmm(a, +(m1 ?? 0));
      const to = hhmm(b, +(m2 ?? 0));
      if (from && to && to > from) return { start: range.index + pre.length, end: range.index + range[0].length, from, to };
    }
  }
  // halb drei · viertel nach 10 · viertel vor 3
  const quarter = new RegExp(`${B}(?:um\\s+)?(halb|viertel\\s+nach|viertel\\s+vor|dreiviertel)\\s+(\\d{1,2}|${Object.keys(HOUR_WORDS).join('|')})(?:\\s+uhr)?${DAYPART}(?![\\p{L}])`, flags).exec(text);
  if (quarter) {
    const [, pre, kind, n, part] = quarter;
    const base = /^\d+$/.test(n) ? +n : HOUR_WORDS[n.toLowerCase()];
    const k = kind.toLowerCase().replace(/\s+/g, ' ');
    const [h, m] = k === 'halb' ? [base - 1, 30] : k === 'viertel nach' ? [base, 15] : [base - 1, 45];
    const t = hhmm(hour(h, part, false), m);
    if (t) return { start: quarter.index + pre.length, end: quarter.index + quarter[0].length, from: t, to: null };
  }
  // um 14 Uhr · ab 10 · gegen 9:30 · 14 Uhr · 14:30
  const single = new RegExp(`${B}(?:(um|ab|gegen|so\\s+um|ca\\.?\\s+um)\\s+)?${T}(\\s*uhr)?${DAYPART}${NO_UNIT}(?![\\p{L}\\p{N}]|[.:]\\d)`, flags);
  const g = new RegExp(single.source, 'giu');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    const [, pre, um, h, sep, min, uhr, part] = m;
    if (g.lastIndex === m.index) g.lastIndex++;
    if (!(um || uhr || sep === ':')) continue;
    if (sep === '.' && !uhr) continue;
    const t = hhmm(hour(+h, part, !!min), +(min ?? 0));
    if (t) return { start: m.index + pre.length, end: m.index + m[0].length, from: t, to: null };
  }
  return null;
}

export interface RangeHit extends Span {
  from: Date;
  to: Date;
}

const RANGE_TAIL = '\\s*(?:-|–|bis(?:\\s+(?:zum|zur|einschließlich))?)\\s*';
const RANGE_FROM = '(?:vom|von|ab)\\s+(?:dem\\s+)?';
const RANGE_HEAD = `(?:${RANGE_FROM})?`;

/** Zeitraum über mehrere Tage („vom 20. bis 24.10.“, „20.–24. Oktober“, „Montag bis Mittwoch“). */
export function findRange(text: string, todayIso: string): RangeHit | null {
  const today = parseIso(todayIso);
  const make = (index: number, pre: string, len: number, from: Date | null, to: Date | null): RangeHit | null => {
    if (!from || !to) return null;
    if (to < from) to = from.getTime() - to.getTime() <= 7 * 864e5 ? plus(to, 7) : new Date(to.getFullYear() + 1, to.getMonth(), to.getDate());
    if (to.getTime() - from.getTime() > 62 * 864e5 || to.getTime() === from.getTime()) return null;
    return { start: index + pre.length, end: index + len, from, to };
  };
  const sameMonth = (d1: number, d2: number, m0: number, year?: number) => {
    const to = upcoming(today, m0, d2, year);
    if (!to) return [null, null];
    const from = d1 <= d2 ? new Date(to.getFullYear(), m0, d1) : new Date(to.getFullYear(), m0 - 1, d1);
    return [from, to];
  };
  // vom 20. bis 24.10.(2026)
  let m = new RegExp(`(^|[^\\p{L}\\p{N}.])${RANGE_HEAD}(\\d{1,2})\\.?${RANGE_TAIL}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?!\\d)`, 'iu').exec(text);
  if (m) {
    const [from, to] = sameMonth(+m[2], +m[3], +m[4] - 1, m[5] ? +m[5] : undefined);
    const hit = make(m.index, m[1], m[0].length, from, to);
    if (hit) return hit;
  }
  // 20. bis 24. Oktober
  m = new RegExp(`(^|[^\\p{L}\\p{N}.])${RANGE_HEAD}(\\d{1,2})\\.?${RANGE_TAIL}(\\d{1,2})\\.?\\s*(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?(?![\\p{L}])`, 'iu').exec(text);
  if (m) {
    const [from, to] = sameMonth(+m[2], +m[3], MONTHS[m[4].toLowerCase()] - 1, m[5] ? +m[5] : undefined);
    const hit = make(m.index, m[1], m[0].length, from, to);
    if (hit) return hit;
  }
  // Zwei Datumsangaben mit „bis“ dazwischen
  const all = dateHits(text, today).sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const picked: DateHit[] = [];
  for (const h of all) if (!picked.some((p) => h.start < p.end && p.start < h.end)) picked.push(h);
  picked.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < picked.length; i++) {
    const [a, b] = [picked[i], picked[i + 1]];
    if (!new RegExp(`^${RANGE_TAIL}$`, 'iu').test(text.slice(a.end, b.start))) continue;
    const head = new RegExp(`(^|\\s)${RANGE_FROM}$`, 'iu').exec(text.slice(0, a.start));
    const start = head ? head.index + head[1].length : a.start;
    const hit = make(start, '', b.end - start, a.date, b.date);
    if (hit) return hit;
  }
  return null;
}

const ONLINE: Record<string, string> = { zoom: 'Zoom', teams: 'Teams', 'google meet': 'Google Meet', meet: 'Google Meet', skype: 'Skype', facetime: 'FaceTime', whatsapp: 'WhatsApp', telefon: 'Telefon', video: 'Videocall' };

/** Ort: „in Düsseldorf“, „im Büro“, „bei Flakon & Co“, „in der Halle 3“, „per Zoom“. */
export function findLocation(text: string, ctx: Context): (Span & { location: string; bei: boolean }) | null {
  const online = /(^|[\s,(])(?:per|über|via|im|auf|in)\s+(google\s+meet|zoom|teams|meet|skype|facetime|whatsapp|telefon|video)(?![\p{L}])/iu.exec(text);
  if (online) return { start: online.index + online[1].length, end: online.index + online[0].length, location: ONLINE[online[2].toLowerCase().replace(/\s+/g, ' ')], bei: false };
  const re = /(^|[\s,(])(in|im|bei|beim|auf\s+der|auf\s+dem|ort:)\s+(?:der\s+|dem\s+|den\s+)?((?:[A-ZÄÖÜ][\p{L}\d.&'’-]*)(?:\s+(?:&\s+)?(?:[A-ZÄÖÜ\d][\p{L}\d.&'’-]*))*)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const place = m[3].replace(/[.,]+$/, '');
    const first = place.split(/\s+/)[0];
    if (!isPersonName(first, ctx) && !eventKind(first.toLowerCase()) && !/^(?:KW|Ruhe|Zukunft|Kürze|Gold|Silber|Schwarz|Weiß)$/u.test(place)) {
      return { start: m.index + m[1].length, end: m.index + m[0].length - (m[3].length - place.length), location: place, bei: /^bei/i.test(m[2]) };
    }
  }
  return null;
}

/* ───────────────────────── Priorität, Kategorie ───────────────────────── */

const LOW_RE = word('nicht\\s+(?:so\\s+)?(?:wichtig|dringend|eilig)|unwichtig|irgendwann(?:\\s+mal)?|kein\\s+stress|keine\\s+eile|wenn\\s+(?:wir\\s+)?zeit\\s+(?:ist|haben)|niedrige\\s+priorität|nice\\s+to\\s+have|optional');
const HIGH_RE = word('wichtig|dringend|eilig|asap|sofort|unbedingt|schnellstmöglich|so\\s+schnell\\s+wie\\s+möglich|hohe\\s+priorität|prio');

function findPriority(text: string): { priority: Priority; text: string } {
  let s = text;
  let priority: Priority = 'normal';
  const low = LOW_RE.exec(s);
  if (low) {
    priority = 'low';
    s = removeSpan(s, low.index + low[1].length, low.index + low[0].length);
  } else {
    const marks = /(^|\s)(!{2,}|\(!\)|!)(?=\s|$)/.exec(s);
    const high = HIGH_RE.exec(s);
    if (marks) {
      priority = 'high';
      s = removeSpan(s, marks.index + marks[1].length, marks.index + marks[0].length);
    }
    if (high) {
      priority = 'high';
      const h = HIGH_RE.exec(s);
      if (h) s = removeSpan(s, h.index + h[1].length, h.index + h[0].length).replace(/^:\s*/, '');
    }
  }
  return { priority, text: s };
}

const CATEGORY_WORDS: Record<string, { exact: string[]; prefix: string[] }> = {
  Marketing: {
    exact: ['post', 'posts', 'reel', 'reels', 'story', 'storys', 'stories', 'blog', 'insta', 'foto', 'fotos', 'content', 'ads', 'werbung'],
    prefix: ['instagram', 'tiktok', 'newsletter', 'kampagne', 'influencer', 'gewinnspiel', 'shooting', 'fotoshooting', 'posten', 'werbe'],
  },
  Versand: { exact: ['dhl', 'dpd', 'gls', 'hermes', 'paket', 'pakete', 'porto', 'sendung'], prefix: ['versand', 'versend', 'verschick', 'verpack', 'retoure'] },
  Einkauf: { exact: ['einkauf', 'einkaufen'], prefix: ['bestell', 'nachbestell', 'lieferant', 'großhandel', 'rohstoff'] },
  Produkt: {
    exact: ['duft', 'düfte', 'probe', 'proben', 'parfum', 'parfüm', 'parfums', 'flakon', 'flakons', 'rezeptur'],
    prefix: ['abfüll', 'etikett', 'sortiment', 'zerstäuber', 'duftprobe'],
  },
  Shop: { exact: ['shop', 'website', 'webseite', 'seo', 'theme', 'checkout'], prefix: ['shopify', 'produktseite', 'rabatt', 'gutschein', 'startseite'] },
  Finanzen: { exact: ['steuer', 'steuern', 'preis', 'preise', 'zahlung'], prefix: ['rechnung', 'buchhaltung', 'überweis', 'kalkulation', 'umsatzsteuer'] },
  Kunden: { exact: ['kunde', 'kunden', 'kundin', 'anfrage', 'support'], prefix: ['reklamation', 'bewertung', 'kundenanfrage'] },
};

function canonicalCategory(name: string, known: string[]): string {
  return known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? capitalize(name);
}

function guessCategory(text: string, known: string[]): string | null {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const k of known) {
    if (words.includes(k.toLowerCase())) return k;
  }
  let best: { name: string; score: number; first: number } | null = null;
  for (const [name, { exact, prefix }] of Object.entries(CATEGORY_WORDS)) {
    let score = 0;
    let first = Infinity;
    words.forEach((w, i) => {
      if (exact.includes(w) || prefix.some((p) => w.startsWith(p))) {
        score++;
        first = Math.min(first, i);
      }
    });
    if (score && (!best || score > best.score || (score === best.score && first < best.first))) best = { name, score, first };
  }
  return best ? canonicalCategory(best.name, known) : null;
}

/* ───────────────────────── Personen, Verben ───────────────────────── */

/** 3. Person → Infinitiv („Ben macht die Fotos“ → „Fotos machen“). Leerer Wert = Verb entfällt. */
const VERB3: Record<string, string> = {
  macht: 'machen', schreibt: 'schreiben', bestellt: 'bestellen', prüft: 'prüfen', checkt: 'checken', plant: 'planen', postet: 'posten',
  erstellt: 'erstellen', organisiert: 'organisieren', besorgt: 'besorgen', kauft: 'kaufen', gestaltet: 'gestalten', designt: 'designen',
  bucht: 'buchen', klärt: 'klären', testet: 'testen', fotografiert: 'fotografieren', packt: 'packen', verpackt: 'verpacken',
  versendet: 'versenden', verschickt: 'verschicken', schickt: 'schicken', sendet: 'senden', aktualisiert: 'aktualisieren',
  überarbeitet: 'überarbeiten', recherchiert: 'recherchieren', kalkuliert: 'kalkulieren', berechnet: 'berechnen', beantwortet: 'beantworten',
  bezahlt: 'bezahlen', zahlt: 'zahlen', überweist: 'überweisen', holt: 'holen', druckt: 'drucken', füllt: 'füllen', etikettiert: 'etikettieren',
  pflegt: 'pflegen', telefoniert: 'telefonieren', kontaktiert: 'kontaktieren', informiert: 'informieren', startet: 'starten', dreht: 'drehen',
  filmt: 'filmen', schneidet: 'schneiden', übersetzt: 'übersetzen', baut: 'bauen', fragt: 'fragen', sucht: 'suchen', textet: 'texten',
  übernimmt: '', erledigt: '', soll: '', sollte: '', muss: '', kann: '', könnte: '', wird: '', will: '', möchte: '', darf: '',
};
/** 1. Person → Infinitiv („ich mache den Newsletter“ → „Newsletter machen“). */
const VERB1: Record<string, string> = {
  mache: 'machen', mach: 'machen', schreibe: 'schreiben', schreib: 'schreiben', bestelle: 'bestellen', prüfe: 'prüfen', checke: 'checken',
  plane: 'planen', poste: 'posten', erstelle: 'erstellen', organisiere: 'organisieren', besorge: 'besorgen', kaufe: 'kaufen', gestalte: 'gestalten',
  buche: 'buchen', kläre: 'klären', teste: 'testen', packe: 'packen', schicke: 'schicken', verschicke: 'verschicken', frage: 'fragen',
  kontaktiere: 'kontaktieren', drehe: 'drehen', filme: 'filmen', suche: 'suchen', texte: 'texten', überarbeite: 'überarbeiten',
  übernehme: '', erledige: '', muss: '', soll: '', sollte: '', kann: '', werde: '', will: '', möchte: '',
};

const INFINITIVES = new Set([
  ...Object.values(VERB3), ...Object.values(VERB1), 'erstellen', 'nachbestellen', 'anfragen', 'anrufen', 'hochladen', 'vorbereiten', 'shooten',
  'einpflegen', 'anlegen', 'ändern', 'abfüllen', 'antworten', 'abholen', 'liefern', 'erledigen', 'einrichten', 'launchen', 'veröffentlichen',
  'besprechen', 'abstimmen', 'auswerten', 'aufräumen', 'sortieren', 'zählen', 'erinnern', 'melden', 'absagen', 'zusagen', 'kündigen',
  'verlängern', 'reservieren', 'vereinbaren', 'ausdrucken', 'mitbringen', 'abschicken', 'rausschicken', 'reklamieren', 'tauschen',
  'umtauschen', 'erstatten', 'nachfragen', 'nachhaken', 'verbessern', 'optimieren', 'einstellen', 'hinzufügen', 'löschen', 'entfernen',
  'anpassen', 'festlegen', 'entscheiden', 'überlegen', 'finden', 'ausprobieren', 'vergleichen', 'einholen', 'beauftragen', 'bewerben',
  'verlinken', 'abgeben', 'einreichen', 'anmelden', 'abmelden', 'registrieren', 'beantragen', 'aufnehmen', 'vorstellen', 'umsetzen',
].filter(Boolean));

const FILLER_START = /^(?:(?:und|dann|danach|außerdem|ausserdem|zudem|also|noch|bitte|mal|auch|evtl\.?|eventuell|ggf\.?|vielleicht)\s+)+/iu;
const FILLER_INNER = word('noch|bitte|mal|eben|kurz', 'giu');
const ARTICLE = /^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer)\s+(?=\S+\s|\S{3,})/iu;
const IDEA_OPENER = /^(?:(?:neue\s+)?idee\b|(?:ziele?|hintergrund|infos?|notiz|kontext|zielgruppe|budget|warum)\s*:|ich\s+hätte\b|wir\s+(?:sollten|könnten|müssten\s+mal\s+überlegen)\b|(?:man|es)\s+könnte\b|könnte\s+man\b|(?:es\s+)?wäre\s+(?:schön|cool|gut|toll|super)\b|wie\s+wäre\s+es\b|was\s+wäre,?\s+wenn\b|vielleicht\b|lass(?:t)?\s+uns\s+(?:mal\s+)?(?:überlegen|nachdenken)\b|könnten\s+wir\b|sollten\s+wir\b)/iu;
const EXPLICIT = /^(?:aufgaben?|to-?dos?|todo|nicht\s+vergessen|denk(?:t)?\s+(?:dran|daran)|dran\s+denken|erinnerung)\s*[:,]?\s*/iu;

interface Who {
  id: string | null;
  text: string;
  /** Person wurde ausdrücklich genannt (Name, @, „ich“). */
  explicit: boolean;
}

function lastWord(s: string): string {
  const m = /([\p{L}-]+)[^\p{L}]*$/u.exec(s);
  return m ? m[1] : '';
}
function firstWord(s: string): string {
  const m = /^[^\p{L}]*([\p{L}-]+)/u.exec(s);
  return m ? m[1] : '';
}
/** Kleingeschriebene Wörter auf -en, die keine Verben sind. */
const NOT_VERBS = new Set([
  'wegen', 'zwischen', 'oben', 'unten', 'neben', 'gegen', 'eben', 'morgen', 'übermorgen', 'innen', 'außen', 'hinten', 'drinnen', 'einen',
  'keinen', 'meinen', 'deinen', 'seinen', 'ihren', 'unseren', 'euren', 'diesen', 'jenen', 'allen', 'vielen', 'anderen', 'beiden', 'welchen',
  'solchen', 'manchen', 'denen', 'ihnen', 'neuen', 'alten', 'guten', 'großen', 'kleinen', 'nächsten', 'letzten', 'ersten', 'kommenden',
]);

function looksLikeInfinitive(w: string): boolean {
  const lower = w.toLowerCase();
  if (INFINITIVES.has(lower)) return true;
  if (NOT_VERBS.has(lower)) return false;
  // Deutsche Substantive werden großgeschrieben – kleingeschriebenes „…en“ am Ende ist fast immer ein Verb.
  return w === lower && /(?:en|ern|eln)$/.test(lower) && lower.length > 3;
}

function findPerson(text: string, ctx: Context): Who {
  let s = text;
  const me = ctx.meId;

  // @ich / @mir
  const atMe = word('@(?:ich|mir|mich)').exec(s);
  if (atMe && me) return { id: me, text: removeSpan(s, atMe.index + atMe[1].length, atMe.index + atMe[0].length), explicit: true };

  for (const p of ctx.people) {
    const names = [...new Set([p.name, p.name.split(/\s+/)[0]])].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
    for (const n of names) {
      const at = word(`@${escape(n)}`).exec(s);
      if (at) return { id: p.id, text: removeSpan(s, at.index + at[1].length, at.index + at[0].length), explicit: true };
      const re = word(escape(n));
      const m = re.exec(s);
      if (!m) continue;
      const start = m.index + m[1].length;
      const end = m.index + m[0].length;
      const before = s.slice(0, start).trim();
      const after = s.slice(end).trim();

      // Am Anfang: „Ben kümmert sich um …“, „Ben: …“, „Ben macht …“, „Keanu um die Verpackung“
      if (!(before + ' ').replace(FILLER_START, '').trim()) {
        const rest = after.replace(/^[:,–—-]\s*/, '');
        const care = /^(?:kümmert\s+sich\s+(?:noch\s+|bitte\s+|mal\s+)*(?:um|darum,?)?|ist\s+zuständig\s+für|übernimmt\s+(?:noch\s+)?|nimmt\s+sich)\s*/iu.exec(rest);
        if (care) return { id: p.id, text: rest.slice(care[0].length), explicit: true };
        const verb = firstWord(rest);
        const inf = VERB3[verb.toLowerCase()];
        if (inf !== undefined) {
          const body = trimPunct(rest.slice(rest.indexOf(verb) + verb.length));
          return { id: p.id, text: inf ? `${body} ${inf}` : body, explicit: true };
        }
        if (/^um\s/i.test(rest)) return { id: p.id, text: rest.slice(3), explicit: true };
        // „Ben fragen wegen …“ – Ben ist hier das Objekt, nicht zuständig
        if (looksLikeInfinitive(verb)) return { id: null, text: s, explicit: false };
        return { id: p.id, text: rest, explicit: true };
      }
      // Am Ende: „… (Ben)“, „… – Ben“, „… von Ben“, „…: Ben“
      if (!after.replace(/^[).,;:!?]+/, '').trim()) {
        const tail = /(?:\s*(?:[–—:(-]|→|->)\s*|\s+(?:von|durch|an|für)\s+)$/iu.exec(before);
        if (tail) return { id: p.id, text: squash(before.slice(0, tail.index)), explicit: true };
        // „Fotos macht Ben“
        const v = lastWord(before);
        const inf = VERB3[v.toLowerCase()];
        if (inf !== undefined) return { id: p.id, text: squash(before.slice(0, before.length - v.length) + (inf ? ' ' + inf : '')), explicit: true };
      }
      // Mitten im Satz: Text bleibt, Zuständigkeit nur wenn kein Infinitiv direkt folgt
      if (looksLikeInfinitive(firstWord(after))) return { id: null, text: s, explicit: false };
      return { id: p.id, text: s, explicit: true };
    }
  }

  // ich …
  const ich = /^(?:(?:und|dann|außerdem|ausserdem|zudem|also)\s+)*ich\s+(kümmere\s+mich\s+(?:noch\s+)?(?:um|darum,?)?|[\p{L}]+)\s*/iu.exec(s);
  if (ich && me) {
    const v = ich[1].toLowerCase();
    if (v.startsWith('kümmere')) return { id: me, text: s.slice(ich[0].length), explicit: true };
    const inf = VERB1[v];
    if (inf !== undefined) return { id: me, text: (trimPunct(s.slice(ich[0].length)) + (inf ? ' ' + inf : '')).trim(), explicit: true };
    return { id: me, text: s, explicit: true };
  }
  // „Fotos mach ich“
  const inv = /\s+(mach|mache|übernehme|erledige|schreib|schreibe|bestelle|kläre|plane)\s+ich\s*[.!]?$/iu.exec(s);
  if (inv && me) {
    const inf = VERB1[inv[1].toLowerCase()];
    return { id: me, text: s.slice(0, inv.index) + (inf ? ' ' + inf : ''), explicit: true };
  }
  return { id: null, text: s, explicit: false };
}

/* ───────────────────────── Einzelne Abschnitte ───────────────────────── */

interface Analysis {
  isTask: boolean;
  task: Omit<DraftTask, 'key'>;
}

function cleanTitle(s: string): string {
  let t = s.replace(EXPLICIT, '');
  t = t.replace(/^wir\s+(?:müssen|sollen|brauchen|wollen)\s+/iu, '').replace(/^(?:man|es)\s+(?:muss|sollte|soll)\s+/iu, '');
  t = t.replace(FILLER_START, '');
  t = t.replace(FILLER_INNER, '$1');
  t = squash(t);
  for (let i = 0; i < 2; i++) t = t.replace(ARTICLE, '');
  t = trimPunct(t);
  return capitalize(t);
}

function splitChecklist(title: string): { title: string; items: string[] } {
  const i = title.indexOf(':');
  if (i < 1) return { title, items: [] };
  const items = title
    .slice(i + 1)
    .split(/,|;|\s+und\s+|\s+sowie\s+/iu)
    .map((x) => capitalize(trimPunct(x)))
    .filter(Boolean);
  if (items.length < 2) return { title, items: [] };
  return { title: trimPunct(title.slice(0, i)), items };
}

function analyze(raw: string, ctx: Context, opts: { bullet: boolean; children: string[] }): Analysis {
  const original = squash(raw);
  let s = original;
  const explicitMarker = EXPLICIT.test(s);
  const idea = IDEA_OPENER.test(s.replace(FILLER_START, ''));

  // Kategorie per #Hashtag
  let category: string | null = null;
  const tag = /(^|\s)#([\p{L}\p{N}_-]+)/u.exec(s);
  if (tag) {
    category = canonicalCategory(tag[2], ctx.categories);
    s = removeSpan(s, tag.index + tag[1].length, tag.index + tag[0].length);
  }
  s = s.replace(/(^|\s)#(?=[\p{L}])/gu, '$1');

  const pr = findPriority(s);
  s = pr.text;

  const date = findDate(s, ctx.today);
  if (date) s = removeSpan(s, date.start, date.end);

  const who = findPerson(s, ctx);
  s = who.text;

  const modal = /(?:^|\s)(?:muss|müssen|soll|sollen)(?=\s|$)/iu.test(original) && !idea;
  const verb =
    looksLikeInfinitive(lastWord(trimPunct(s))) || s.toLowerCase().split(/[^\p{L}]+/u).some((w) => INFINITIVES.has(w));
  const words = original.split(/\s+/).length;

  const strong = opts.bullet || explicitMarker || who.explicit || (date?.deadline ?? false) || pr.priority === 'high' || modal;
  const isTask = !idea && (strong || (verb && words <= 10) || (date !== null && verb));

  const cl = splitChecklist(cleanTitle(s));
  const title = cl.title || cleanTitle(original) || original;
  return {
    isTask: opts.bullet || isTask,
    task: {
      title,
      assigneeId: who.id,
      due: date ? iso(date.date) : null,
      priority: pr.priority,
      category: category ?? guessCategory(original, ctx.categories),
      checklist: [...cl.items, ...opts.children.map((c) => capitalize(trimPunct(c))).filter(Boolean)],
    },
  };
}

/* ───────────────────────── Termine ───────────────────────── */

const KIND_LABEL: Record<EventKind, string> = { termin: 'Termin', meeting: 'Meeting', event: 'Event', frist: 'Frist' };

/** Art des Termins aus einem Wort – auch zusammengesetzt („Teammeeting“, „Zahnarzttermin“, „Parfummesse“). */
function eventKind(w: string): EventKind | null {
  if (/^frist|frist$|fristende|^deadline$|stichtag|abgabeschluss|abgabetermin/.test(w)) return 'frist';
  if (/meeting|besprechung|^call$|call$|telefonat|^telko$|^jour$|^kick-?off$|^stand-?up$|treffen$|^zoom$/.test(w)) return 'meeting';
  if ((/^messe|messe$/.test(w) && !/^messe[nr]/.test(w)) || /workshop|webinar|konferenz|seminar|veranstaltung|^event|event$|shooting|^drehtag$|^launch$|party$|feier$|festival|^pop-?up/.test(w)) return 'event';
  if (/termin|interview|präsentation|^(?:abend|mittag|geschäfts|arbeits)essen$|geburtstag|urlaub|besuch$|sprechstunde/.test(w)) return 'termin';
  return null;
}

/** Verben, die den Termin selbst beschreiben – „Ben treffen“ ist ein Termin, „Meeting vorbereiten“ eine Aufgabe. */
const MEET_VERBS = new Set(['treffen', 'telefonieren', 'sprechen', 'besprechen', 'essen', 'feiern', 'zoomen', 'callen', 'reden', 'sehen', 'kommen', 'vorbeikommen', 'fahren', 'fliegen']);
const EVENT_PREFIX = /^(termin|meeting|event|frist|deadline|kalender)\s*:\s*/iu;

function plusHour(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return h >= 23 ? '23:59' : `${pad2(h + 1)}:${pad2(m)}`;
}

/** Teilnehmer: genannte Personen; „mit Ben“ oder „wir“ heißt: ich bin auch dabei. Leer = ganzes Team. */
function findAttendees(text: string, ctx: Context): { ids: string[]; text: string } {
  let s = text;
  const ids = new Set<string>();
  let withMe = /(^|[^\p{L}])(?:wir|uns)(?=$|[^\p{L}])/iu.test(s);
  const self = /(^|[^\p{L}])(?:ich|mir|mich)(?=$|[^\p{L}])/iu.test(s);
  for (const p of ctx.people) {
    const names = [...new Set([p.name, p.name.split(/\s+/)[0]])].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
    for (const n of names) {
      const m = word(`@?${escape(n)}`).exec(s);
      if (!m) continue;
      ids.add(p.id);
      const start = m.index + m[1].length;
      const end = m.index + m[0].length;
      if (/(?:^|\s)mit\s+(?:@?[\p{L}]+(?:,\s*|\s+und\s+))*$/iu.test(s.slice(0, start))) withMe = true;
      // „Ben: Zahnarzt“ → Titel ohne Namen
      if (!s.slice(0, start).trim() && /^\s*:/.test(s.slice(end))) s = s.slice(end).replace(/^\s*:\s*/, '');
      else if (m[2].startsWith('@')) s = s.slice(0, start) + m[2].slice(1) + s.slice(end);
      break;
    }
  }
  if (/(^|[^\p{L}])(?:team|alle|allen)(?=$|[^\p{L}])/iu.test(s)) return { ids: [], text: s };
  if (!ids.size) return { ids: self && !withMe && ctx.meId ? [ctx.meId] : [], text: s };
  if ((withMe || self) && ctx.meId) ids.add(ctx.meId);
  if (ctx.people.length > 1 && ctx.people.every((p) => ids.has(p.id))) return { ids: [], text: s };
  return { ids: [...ids], text: s };
}

/**
 * Ein Abschnitt als Termin – oder null, wenn es keiner ist.
 * Termin = Uhrzeit („um 14 Uhr“) oder Termin-Wort mit Datum („Messe vom 20. bis 24.10.“).
 * „bis Freitag“ und „Meeting vorbereiten“ bleiben Aufgaben.
 */
function eventFrom(raw: string, ctx: Context, forced: boolean): Omit<DraftEvent, 'key'> | null {
  let s = squash(raw).replace(/(^|\s)#(?=[\p{L}])/gu, '$1');
  if (!forced && IDEA_OPENER.test(s.replace(FILLER_START, ''))) return null;
  let kind: EventKind | null = null;
  const prefix = EVENT_PREFIX.exec(s);
  if (prefix) {
    const p = prefix[1].toLowerCase();
    kind = p === 'deadline' ? 'frist' : p === 'kalender' ? null : (p as EventKind);
    s = s.slice(prefix[0].length);
    forced = true;
  }
  const allDay = word('ganztägig|ganztags|den\\s+ganzen\\s+tag').exec(s);
  if (allDay) s = removeSpan(s, allDay.index + allDay[1].length, allDay.index + allDay[0].length);
  const time = allDay ? null : findTime(s);
  // „bis 12 Uhr“ ist eine Frist für eine Aufgabe
  const timeDeadline = !!time && /(?:^|\s)(?:bis|spätestens|vor)\s+(?:um\s+)?$/iu.test(s.slice(0, time.start));
  if (time) s = removeSpan(s, time.start, time.end);
  const range = findRange(s, ctx.today);
  const date = range ? null : findDate(s, ctx.today);
  if (range) s = removeSpan(s, range.start, range.end);
  else if (date) s = removeSpan(s, date.start, date.end);

  const found = s.toLowerCase().split(/[^\p{L}-]+/u).map(eventKind).find(Boolean) ?? null;
  kind ??= found;
  let loc = findLocation(s, ctx);
  if (loc) {
    // „Termin beim Steuerberater“: ohne den Zusatz bliebe nur „Termin“ – dann gehört er in den Titel
    const rest = removeSpan(s, loc.start, loc.end);
    if (loc.bei && (!trimPunct(rest) || eventKind(trimPunct(rest).toLowerCase()))) loc = null;
    else s = rest;
  }

  if (!forced) {
    const last = lastWord(trimPunct(s));
    const taskVerb = looksLikeInfinitive(last) && !MEET_VERBS.has(last.toLowerCase());
    const timed = !!time && !timeDeadline && !date?.deadline;
    const keyword = !!found && !!(range || date) && (!date?.deadline || found === 'frist') && !taskVerb;
    if (!timed && !keyword) return null;
  }

  const who = findAttendees(s, ctx);
  let title = who.text
    .replace(/^wir\s+treffen\s+uns\b/iu, 'Treffen')
    .replace(/^(?:ich|wir)\s+(?:habe|hab|haben)\s+(?:noch\s+)?(?:(?:einen|ein|eine)\s+)?/iu, '')
    .replace(/^(?:da\s+)?(?:ist|gibt\s+es)\s+(?:noch\s+)?(?:(?:einen|ein|eine)\s+)?/iu, '');
  title = cleanTitle(title)
    .replace(/(?:^|\s)(?:am|um|ab|vom|von|bis|im|in|zum|zur|an|für|mit|jeden|jede|jedes|immer)$/iu, '')
    .replace(/^(?:am|um|ab|vom|von|im|in|zum|zur)\s+/iu, '');
  const k = kind ?? 'termin';
  const from = time?.from ?? null;
  return {
    title: capitalize(trimPunct(title)) || KIND_LABEL[k],
    kind: k,
    date: iso(range ? range.from : date ? date.date : parseIso(ctx.today)),
    endDate: range ? iso(range.to) : null,
    start: from,
    end: from ? (time?.to ?? (k === 'frist' ? null : plusHour(from))) : null,
    location: loc?.location ?? null,
    attendees: who.ids,
  };
}

/* ───────────────────────── Zerlegen in Abschnitte ───────────────────────── */

interface Segment {
  text: string;
  bullet: boolean;
  children: string[];
  /** Trennzeichen vor diesem Abschnitt im Original (für die Notiz). */
  glue: string;
  indent: number;
}

// „3. Dezember …“ ist ein Datum, keine Aufzählung
const BULLET = new RegExp(`^(\\s*)(?:[-*•–·]|\\d{1,2}[.)](?!\\s*(?:${MONTH_RE})(?:$|[^\\p{L}]))|\\[\\s?[xX]?\\s?\\]|☐|☑)\\s+(.*)$`, 'iu');

/** Teilt eine Zeile in Sätze – ohne Lookbehind, damit auch ältere Safaris den Code laden. */
function sentences(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    cur += c;
    if ((c === '.' || c === '!' || c === '?') && /\s/.test(line[i + 1] ?? '') && /[A-ZÄÖÜ@]/.test(line.slice(i + 1).trimStart()[0] ?? '')) {
      // „15.11. Ben …“ oder „3. Dezember“: Punkt nach Ziffer trennt keinen Satz
      if (c === '.' && /\d/.test(line[i - 1] ?? '')) continue;
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function personAhead(ctx: Context): string {
  const names = ctx.people.flatMap((p) => [p.name, p.name.split(/\s+/)[0]]).filter((n) => n.length >= 2).map(escape);
  return [...names, 'ich'].join('|');
}

function isPersonName(s: string, ctx: Context): boolean {
  const t = s.trim().replace(/^@/, '').toLowerCase();
  return t === 'ich' || ctx.people.some((p) => p.name.toLowerCase() === t || p.name.split(/\s+/)[0].toLowerCase() === t);
}

/** Nur Priorität, Datum oder Uhrzeit („nicht dringend“, „bis Freitag“, „14 Uhr“) – gehört zum Satzteil davor. */
function onlyModifier(text: string, ctx: Context): boolean {
  let s = findPriority(text).text;
  const time = findTime(s);
  if (time) s = removeSpan(s, time.start, time.end);
  const date = findDate(s, ctx.today);
  if (date) s = removeSpan(s, date.start, date.end);
  return !trimPunct(s);
}

function clauses(sentence: string, ctx: Context): { text: string; glue: string }[] {
  // „Wenn Ben Zeit hat, macht er die Fotos“: Nebensatz nicht abtrennen
  if (/^(?:wenn|falls|sobald|weil|da|ob|dass|obwohl|damit|nachdem|bevor|sofern)\s/iu.test(sentence)) return [{ text: sentence, glue: '' }];
  // „Shooting vorbereiten: Flakons, Licht und Hintergrund“ bleibt zusammen (Checkliste)
  const colon = /^([^:]{3,60}):\s+(.+)$/u.exec(sentence);
  if (colon && !isPersonName(colon[1], ctx) && /,|\sund\s/u.test(colon[2])) return [{ text: sentence, glue: '' }];
  const ahead = personAhead(ctx);
  const re = new RegExp(`\\s*[,;]\\s+|\\s+(?:und|sowie|außerdem|ausserdem)\\s+(?=@?(?:${ahead})(?:$|[^\\p{L}]))`, 'giu');
  const out: { text: string; glue: string }[] = [];
  let last = 0;
  let glue = '';
  let m: RegExpExecArray | null;
  const nextPerson = new RegExp(`^@?(?:${ahead})(?:$|[^\\p{L}])`, 'iu');
  while ((m = re.exec(sentence))) {
    // „Meeting mit Ben, Keanu und …“: Aufzählung der Teilnehmer bleibt zusammen
    if (/(?:^|\s)mit\s+@?[\p{L}]+(?:,\s*@?[\p{L}]+)*$/iu.test(sentence.slice(last, m.index)) && nextPerson.test(sentence.slice(m.index + m[0].length))) continue;
    out.push({ text: sentence.slice(last, m.index), glue });
    glue = m[0];
    last = m.index + m[0].length;
  }
  out.push({ text: sentence.slice(last), glue });
  const merged: { text: string; glue: string }[] = [];
  for (const c of out.filter((x) => x.text.trim())) {
    const prev = merged[merged.length - 1];
    if (prev && onlyModifier(c.text, ctx)) prev.text += c.glue + c.text;
    else merged.push(c);
  }
  return merged;
}

function segments(text: string, ctx: Context): Segment[] {
  const out: Segment[] = [];
  let lastBullet: Segment | null = null;
  text.split('\n').forEach((line, li) => {
    if (!line.trim()) {
      lastBullet = null;
      return;
    }
    const expanded = line.replace(/\t/g, '    ');
    const b = BULLET.exec(expanded);
    if (b) {
      const indent = b[1].length;
      if (lastBullet && indent >= lastBullet.indent + 2) {
        lastBullet.children.push(b[2]);
        return;
      }
      const seg: Segment = { text: b[2], bullet: true, children: [], glue: li ? '\n' : '', indent };
      out.push(seg);
      lastBullet = seg;
      return;
    }
    lastBullet = null;
    sentences(line).forEach((sentence, si) => {
      clauses(sentence, ctx).forEach((c, ci) => {
        out.push({ text: c.text, bullet: false, children: [], glue: ci ? c.glue : si ? ' ' : li ? '\n' : '', indent: 0 });
      });
    });
  });
  return out;
}

/* ───────────────────────── Notiz ───────────────────────── */

function noteFrom(text: string): DraftNote {
  const clean = text.replace(/^\s*(?:neue\s+)?(?:idee|notiz)\s*[:\-–]\s*/iu, '').trim();
  const lines = clean.split('\n');
  const first = lines[0].trim();
  if (lines.length > 1 && first.length <= 60) {
    return { title: capitalize(trimPunct(first)), body: lines.slice(1).join('\n').trim() };
  }
  const sentence = sentences(first)[0] ?? first;
  if (lines.length === 1 && sentence === first && first.length <= 60) return { title: capitalize(trimPunct(first)), body: '' };
  // „Neuer Duft: Vanille, Tonka …“ → Titel „Neuer Duft“
  const lead = /^([^:\n]{3,40}):\s+\S/u.exec(sentence);
  if (lead) return { title: capitalize(trimPunct(lead[1])), body: clean };
  let title = trimPunct(sentence);
  if (title.length > 60) {
    const cut = title.slice(0, 60);
    title = cut.slice(0, Math.max(cut.lastIndexOf(' '), 30)).replace(/[\s,;:–-]+$/, '') + ' …';
  }
  return { title: capitalize(title), body: clean };
}

/* ───────────────────────── Einstieg ───────────────────────── */

let counter = 0;
const key = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;

export function parseIdea(input: string, ctx: Context, mode: Mode = 'auto'): Draft {
  let text = input.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
  if (!text) return { note: null, tasks: [], events: [] };

  if (mode === 'auto' && /^\s*notiz\s*:/iu.test(text)) mode = 'note';
  if (mode === 'auto' && /^\s*(?:aufgaben|to-?dos)\s*:\s*\n/iu.test(text)) {
    mode = 'tasks';
    text = text.replace(/^\s*(?:aufgaben|to-?dos)\s*:\s*\n/iu, '');
  }
  if (mode === 'note') return { note: noteFrom(text), tasks: [], events: [] };
  if (mode === 'event') {
    return { note: null, tasks: [], events: [{ key: key(), ...eventFrom(text.replace(/\s*\n\s*/g, ' '), ctx, true)! }] };
  }

  const segs = segments(text, ctx);
  const analyzed = segs.map((s) => ({
    seg: s,
    a: analyze(s.text, ctx, s),
    ev: mode === 'auto' && !s.children.length ? eventFrom(s.text, ctx, false) : null,
  }));

  if (mode === 'tasks') {
    return { note: null, tasks: analyzed.map(({ a }) => ({ key: key(), ...a.task })), events: [] };
  }

  const events = analyzed.filter((x) => x.ev).map((x) => ({ key: key(), ...x.ev! }));
  const tasks = analyzed.filter((x) => !x.ev && x.a.isTask);
  if (!tasks.length && !events.length) return { note: noteFrom(text), tasks: [], events: [] };

  const narrative = analyzed
    .filter((x) => !x.ev && !x.a.isTask)
    .map((x, i) => (i ? x.seg.glue.replace(/^\s*[,;]\s*$/, ', ') : '') + x.seg.text.trim())
    .join('')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();

  // Kurze Überschrift über einer Liste („Adventskalender:“) wird zur Kategorie der Aufgaben
  const firstLine = narrative.split('\n')[0];
  const heading =
    !analyzed[0].a.isTask && !analyzed[0].ev && !analyzed[0].seg.bullet && firstLine === analyzed[0].seg.text.trim() && firstLine.split(/\s+/).length <= 4 && !/[!?.]$/.test(firstLine)
      ? trimPunct(firstLine)
      : null;

  return {
    note: narrative.replace(/[\s,;:.!?–-]/g, '').length >= 3 ? noteFrom(narrative) : null,
    tasks: tasks.map(({ a }) => ({
      key: key(),
      ...a.task,
      category: heading && !/(^|\s)#/.test(text) ? canonicalCategory(heading, ctx.categories) : a.task.category,
    })),
    events,
  };
}

/** Kurze, menschliche Zusammenfassung für die Antwort im Chat. */
export function summary(d: Draft): string {
  const n = d.tasks.length;
  const e = d.events?.length ?? 0;
  const t = n === 1 ? 'eine Aufgabe' : `${n} Aufgaben`;
  if (e && !n && !d.note) return e === 1 ? 'Das trage ich in den Kalender ein:' : `${e} Termine für den Kalender:`;
  if (e) {
    const parts = [d.note ? 'eine Notiz' : '', n ? t : '', e === 1 ? 'einen Termin' : `${e} Termine`].filter(Boolean);
    return `Daraus mache ich ${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}:`;
  }
  if (d.note && n) return `Daraus mache ich eine Notiz und ${t}:`;
  if (d.note) return 'Das klingt nach einer Idee – ich lege eine Notiz an:';
  if (n) return `Ich habe ${t} erkannt:`;
  return 'Dazu habe ich nichts gefunden. Schreib einfach etwas mehr.';
}
