import { specialDaysBetween, type SpecialDay } from './holidays';
import type { CalEvent, EventKind, Meta } from './types';

/** Art des Termins: Beschriftung und Farbklasse (Paletten-Klassen u-* aus styles.css). */
export const KINDS: { value: EventKind; label: string; tone: string }[] = [
  { value: 'termin', label: 'Termin', tone: 'u-blue' },
  { value: 'meeting', label: 'Meeting', tone: 'u-sage' },
  { value: 'event', label: 'Event', tone: 'u-plum' },
  { value: 'frist', label: 'Frist', tone: 'u-rose' },
];
export const kindInfo = (k: EventKind) => KINDS.find((x) => x.value === k) ?? KINDS[0];

export const REMINDERS_TIMED: { value: number | null; label: string }[] = [
  { value: null, label: 'Keine' },
  { value: 0, label: 'Zur Startzeit' },
  { value: 10, label: '10 Min. vorher' },
  { value: 15, label: '15 Min. vorher' },
  { value: 30, label: '30 Min. vorher' },
  { value: 60, label: '1 Std. vorher' },
  { value: 120, label: '2 Std. vorher' },
  { value: 1440, label: '1 Tag vorher' },
  { value: 2880, label: '2 Tage vorher' },
];
export const REMINDERS_ALLDAY: { value: number | null; label: string }[] = [
  { value: null, label: 'Keine' },
  { value: 0, label: 'Am Tag um 8 Uhr' },
  { value: 1440, label: '1 Tag vorher, 8 Uhr' },
  { value: 2880, label: '2 Tage vorher, 8 Uhr' },
];

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parse(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDaysIso(isoDate: string, n: number): string {
  const d = parse(isoDate);
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** 6 Wochen (Mo–So) rund um den Monat. */
export function monthGrid(year: number, month0: number): string[][] {
  const first = new Date(year, month0, 1);
  const start = new Date(year, month0, 1 - ((first.getDay() + 6) % 7));
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) week.push(iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)));
    weeks.push(week);
  }
  return weeks;
}

export const endDate = (e: CalEvent) => e.end_date ?? e.start_date;
export const onDay = (e: CalEvent, day: string) => e.start_date <= day && endDate(e) >= day;

/** Ganztägige zuerst, dann nach Uhrzeit. */
export function sortEvents(list: CalEvent[]): CalEvent[] {
  return [...list].sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1;
    if (!a.start_time !== !b.start_time) return a.start_time ? 1 : -1;
    return (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.title.localeCompare(b.title);
  });
}

const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
export const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

export function dayLabel(day: string, today: string, long = false): string {
  if (day === today) return 'Heute';
  if (day === addDaysIso(today, 1)) return 'Morgen';
  return (long ? longFmt : dayFmt).format(parse(day));
}
export const longDayLabel = (day: string) => longFmt.format(parse(day));

/** „14:00–15:00“, „ab 14:00“, „Ganztägig“, „bis Fr., 18. Okt.“ */
export function timeLabel(e: CalEvent): string {
  const multi = e.end_date && e.end_date !== e.start_date;
  if (!e.start_time) return multi ? `Ganztägig bis ${dayFmt.format(parse(e.end_date!))}` : 'Ganztägig';
  const t = e.end_time ? `${e.start_time}–${e.end_time}` : `${e.start_time} Uhr`;
  return multi ? `${t}, bis ${dayFmt.format(parse(e.end_date!))}` : t;
}

/** Endzeit = Start + 1 Std. (max. 23:59) */
export function plusHour(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Feiertage und Aktionstage im Zeitraum – mit Bundesland und Schaltern aus den Admin-Einstellungen. */
export function specialsBetween(from: string, to: string, meta: Meta | null | undefined): SpecialDay[] {
  return specialDaysBetween(from, to, meta?.holidayState ?? '', { holidays: meta?.holidaysOn !== false, shop: meta?.shopDays !== false });
}

/** Termine und besondere Tage gemeinsam, nach Datum sortiert (besondere Tage vor Uhrzeit-Terminen). */
export type AgendaItem = { type: 'event'; date: string; e: CalEvent } | { type: 'special'; date: string; s: SpecialDay };
export function agenda(events: CalEvent[], specials: SpecialDay[], dateOf: (e: CalEvent) => string = (e) => e.start_date): AgendaItem[] {
  const items: AgendaItem[] = [
    ...specials.map((s) => ({ type: 'special' as const, date: s.date, s })),
    ...sortEvents(events).map((e) => ({ type: 'event' as const, date: dateOf(e), e })),
  ];
  // stabil: gleiche Tage behalten die Reihenfolge (besondere Tage zuerst, Termine wie sortiert)
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
