const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euroRound = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat('de-DE');
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const euro = (cents: number) => euroFmt.format(cents / 100);
export const euroShort = (cents: number) => (Math.abs(cents) >= 100000 ? euroRound.format(cents / 100) : euroFmt.format(cents / 100));
export const int = (n: number) => intFmt.format(n);
export const longDay = (d = new Date()) => longDayFmt.format(d);
export const time = (ms: number) => timeFmt.format(new Date(ms));
export const dateTime = (ms: number) => dateTimeFmt.format(new Date(ms));
export const shortDay = (ms: number) => shortDate.format(new Date(ms));

/** Achsenbeschriftung: 0 €, 250 €, 1,2 Tsd. € */
export function euroAxis(cents: number): string {
  const e = cents / 100;
  if (e >= 1000) return `${(e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tsd. €`;
  return `${Math.round(e)} €`;
}

export function relative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${d} Tagen`;
  return shortDate.format(new Date(ms));
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function dueInfo(iso: string | null): { label: string; state: DueState } | null {
  if (!iso) return null;
  const today = todayISO();
  if (iso < today) {
    const days = Math.round((isoToDate(today).getTime() - isoToDate(iso).getTime()) / 86400000);
    return { label: days <= 1 ? 'Gestern' : `vor ${days} Tagen`, state: 'overdue' };
  }
  if (iso === today) return { label: 'Heute', state: 'today' };
  if (iso === addDays(today, 1)) return { label: 'Morgen', state: 'soon' };
  return { label: dayFmt.format(isoToDate(iso)), state: iso <= addDays(today, 7) ? 'soon' : 'later' };
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Hallo';
  if (h < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}
