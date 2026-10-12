// Feiertage (bundesweit + je Bundesland) und Aktionstage für den Shop – für jedes Jahr berechnet.
// Gleiche Regeln wie server/app/src/Holidays.php (Widget, Kalender-Abo); ein Test vergleicht beide.
// Ohne Imports, damit Node-Tests die Datei direkt laden können.

export type SpecialType = 'feiertag' | 'aktion';

export interface SpecialDay {
  date: string;
  title: string;
  type: SpecialType;
}

export const STATES: { code: string; name: string }[] = [
  { code: 'BW', name: 'Baden-Württemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thüringen' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Ostersonntag (gregorianisch, anonymer Algorithmus nach Meeus/Jones/Butcher). */
export function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

/** n-ter Wochentag (0 = So) im Monat */
function nth(y: number, m0: number, wd: number, n: number): Date {
  const first = new Date(y, m0, 1);
  return add(first, ((wd - first.getDay() + 7) % 7) + (n - 1) * 7);
}

/** Alle Feiertage und Aktionstage eines Jahres. state = Kürzel (z. B. „NW“) oder '' für nur bundesweite. */
export function specialDays(year: number, state = '', opts: { holidays?: boolean; shop?: boolean } = {}): SpecialDay[] {
  const out: SpecialDay[] = [];
  const e = easter(year);
  const fixed = (m: number, d: number) => new Date(year, m - 1, d);
  const hol = (d: Date, title: string, states?: string[]) => {
    if (opts.holidays === false) return;
    if (!states || states.includes(state)) out.push({ date: ymd(d), title, type: 'feiertag' });
  };
  const shop = (d: Date, title: string) => {
    if (opts.shop !== false) out.push({ date: ymd(d), title, type: 'aktion' });
  };

  // Bundesweit
  hol(fixed(1, 1), 'Neujahr');
  hol(add(e, -2), 'Karfreitag');
  hol(add(e, 1), 'Ostermontag');
  hol(fixed(5, 1), 'Tag der Arbeit');
  hol(add(e, 39), 'Christi Himmelfahrt');
  hol(add(e, 50), 'Pfingstmontag');
  hol(fixed(10, 3), 'Tag der Deutschen Einheit');
  hol(fixed(12, 25), '1. Weihnachtstag');
  hol(fixed(12, 26), '2. Weihnachtstag');
  // Je Bundesland
  hol(fixed(1, 6), 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
  hol(fixed(3, 8), 'Internationaler Frauentag', ['BE', 'MV']);
  hol(e, 'Ostersonntag', ['BB']);
  hol(add(e, 49), 'Pfingstsonntag', ['BB']);
  hol(add(e, 60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  hol(fixed(8, 15), 'Mariä Himmelfahrt', ['SL', 'BY']);
  hol(fixed(9, 20), 'Weltkindertag', ['TH']);
  hol(fixed(10, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
  hol(fixed(11, 1), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
  // Buß- und Bettag: Mittwoch vor dem 23. November
  const nov23 = fixed(11, 23);
  hol(add(nov23, -(((nov23.getDay() - 3 + 7) % 7) || 7)), 'Buß- und Bettag', ['SN']);

  // Aktionstage für den Shop
  const thanksgiving = nth(year, 10, 4, 4);
  const blackFriday = add(thanksgiving, 1);
  const christmasEve = fixed(12, 24);
  const fourthAdvent = add(christmasEve, -christmasEve.getDay());
  shop(fixed(2, 14), 'Valentinstag');
  if (state !== 'BE' && state !== 'MV') shop(fixed(3, 8), 'Weltfrauentag');
  shop(fixed(3, 21), 'Welttag des Parfums');
  if (state !== 'BB') shop(e, 'Ostersonntag');
  shop(nth(year, 4, 0, 2), 'Muttertag');
  shop(add(e, 39), 'Vatertag');
  shop(fixed(11, 11), 'Singles’ Day');
  shop(add(blackFriday, -4), 'Start Black Week');
  shop(blackFriday, 'Black Friday');
  shop(add(blackFriday, 3), 'Cyber Monday');
  shop(add(fourthAdvent, -21), '1. Advent');
  shop(fixed(12, 6), 'Nikolaus');
  shop(christmasEve, 'Heiligabend');
  shop(fixed(12, 31), 'Silvester');

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'feiertag' ? -1 : 1));
}

/** Alle Tage zwischen zwei Daten (inklusive), über Jahresgrenzen hinweg. */
export function specialDaysBetween(from: string, to: string, state = '', opts: { holidays?: boolean; shop?: boolean } = {}): SpecialDay[] {
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  const out: SpecialDay[] = [];
  for (let y = y0; y <= y1; y++) out.push(...specialDays(y, state, opts).filter((d) => d.date >= from && d.date <= to));
  return out;
}
