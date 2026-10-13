const zahl = new Intl.NumberFormat('de-DE');

export function punkte(n: number): string {
  return zahl.format(n);
}

/** 500 → „5 €“, 1290 → „12,90 €“ (wie im Shop: glatte Beträge ohne Nachkommastellen) */
export function euro(cents: number, currency = 'EUR'): string {
  const glatt = cents % 100 === 0;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: glatt ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function datum(ms: number | null | undefined, lang = false): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('de-DE', lang ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function kurzdatum(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

export function datumZeit(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** „vor 5 Minuten“, „gestern“ … */
export function seit(ms: number | null | undefined): string {
  if (!ms) return 'noch nie';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'gerade eben';
  const min = Math.round(s / 60);
  if (min < 60) return `vor ${min} Minute${min === 1 ? '' : 'n'}`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Stunde${h === 1 ? '' : 'n'}`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}

export function tageBis(ms: number): number {
  return Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
}

/** „1 Punkt“ / „3 Punkte“ */
export function punkteWort(n: number): string {
  return `${punkte(n)} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
}
