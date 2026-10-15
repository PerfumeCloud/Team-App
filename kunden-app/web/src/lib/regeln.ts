/* Alle Texte zu den Regeln entstehen hier aus den Einstellungen im Admin-Bereich.
   Ändert das Team dort etwas, stimmen Startseite, Übersicht, Prämien und Beitritt sofort. */
import { datum, euro, punkte, punkteWort } from './format';
import type { Program, Promo, Tier } from './types';

/** 1 → „1 Punkt“, 1.5 → „1,5 Punkte“ (je Euro) */
export function satz(rate: number): string {
  return `${punkte(rate)} ${rate === 1 ? 'Punkt' : 'Punkte'}`;
}

/** 2 → „doppelte“, 3 → „dreifache“, 1.5 → „1,5-fache“ */
export function faktorWort(f: number): string {
  const worte: Record<number, string> = { 2: 'doppelte', 3: 'dreifache', 4: 'vierfache', 5: 'fünffache' };
  return worte[f] ?? `${punkte(f)}-fache`;
}

export function grundstufe(p: Program): Tier | null {
  return p.tiers_enabled && p.tiers.length > 0 ? p.tiers[0] : null;
}

export function hoechsteStufe(p: Program): Tier | null {
  return p.tiers_enabled && p.tiers.length > 0 ? p.tiers[p.tiers.length - 1] : null;
}

/** „Für jeden Euro bekommst du 1 Punkt“ – mit Stufen: „… je nach Stufe 1 bis 2 Punkte“ */
export function sammelText(p: Program, eigeneRate?: number): string {
  if (eigeneRate !== undefined) return `Für jeden Euro Warenwert bekommst du ${satz(eigeneRate)}.`;
  const top = hoechsteStufe(p);
  if (top && top.rate > p.earn_per_euro) {
    return `Für jeden Euro Warenwert bekommst du ${satz(p.earn_per_euro)}, in höheren Stufen bis zu ${satz(top.rate)}.`;
  }
  return `Für jeden Euro Warenwert bekommst du ${satz(p.earn_per_euro)}.`;
}

export function wartenText(p: Program): string {
  return p.wait_days > 0
    ? `Deine Punkte kommen ${p.wait_days} Tage nach dem Versand auf dein Konto, so lange läuft die Rückgabefrist.`
    : 'Deine Punkte kommen nach dem Versand auf dein Konto.';
}

export function einloesenText(p: Program): string {
  return `Je ${punkteWort(p.redeem_points)} gibt es ${euro(p.redeem_cents)} Rabatt, als Code für deinen nächsten Einkauf.`;
}

/** „Punkte verfallen 24 Monate nach der Gutschrift.“ oder null */
export function verfallText(p: Program): string | null {
  if (p.points_expiry_months <= 0) return null;
  const m = p.points_expiry_months;
  const dauer = m % 12 === 0 ? `${m / 12} ${m === 12 ? 'Jahr' : 'Jahre'}` : `${m} Monate`;
  return `Nicht eingelöste Punkte verfallen ${dauer} nach der Gutschrift.`;
}

export function codeText(p: Program): string {
  return `Codes gelten ${p.code_days} Tage${p.code_expiry_refund ? '; läuft einer ungenutzt ab, bekommst du die Punkte zurück' : ' und verfallen danach mit ihren Punkten'}.`;
}

export function aktionText(a: Promo): string {
  return `${faktorWort(a.factor)} Punkte`;
}

/** „bis 30. November“ */
export function bis(ms: number): string {
  return new Date(ms - 1).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
}

export function ab(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Alle Wege zu Bonuspunkten, die gerade aktiv sind (für Übersicht und Startseite). */
export function boni(p: Program): { key: string; titel: string; text: string }[] {
  const out: { key: string; titel: string; text: string }[] = [];
  if (p.welcome_points > 0) out.push({ key: 'welcome', titel: `${punkteWort(p.welcome_points)} zum Start`, text: 'Gleich beim Beitritt geschenkt.' });
  if (p.bonus.birthday > 0) out.push({ key: 'birthday', titel: `${punkteWort(p.bonus.birthday)} zum Geburtstag`, text: 'Trag deinen Geburtstag ein, wir melden uns pünktlich.' });
  if (p.bonus.referrer > 0 || p.bonus.referred > 0) {
    const beide = p.bonus.referrer > 0 && p.bonus.referred > 0;
    out.push({
      key: 'referral',
      titel: beide && p.bonus.referrer === p.bonus.referred ? `${punkteWort(p.bonus.referrer)} für euch beide` : `${punkteWort(Math.max(p.bonus.referrer, p.bonus.referred))} fürs Weitersagen`,
      text: beide
        ? `Lade Freunde ein: Du bekommst ${punkteWort(p.bonus.referrer)}, sie ${punkteWort(p.bonus.referred)}, sobald sie zum ersten Mal bestellen.`
        : 'Lade Freunde ein, Punkte gibt es nach ihrer ersten Bestellung.',
    });
  }
  if (p.bonus.newsletter > 0) out.push({ key: 'newsletter', titel: `${punkteWort(p.bonus.newsletter)} für den Newsletter`, text: 'Einmalig, wenn du dich im Shop für unseren Newsletter anmeldest.' });
  if (p.bonus.review > 0) out.push({ key: 'review', titel: `${punkteWort(p.bonus.review)} für eine Bewertung`, text: 'Bewerte einen Duft und sag uns kurz Bescheid.' });
  return out;
}

export function startBonusText(p: Program): string | null {
  const sb = p.start_bonus;
  if (!sb) return null;
  const bedingung = sb.requires_order ? ` Er wird mit deiner ersten Bestellung${sb.min_cents > 0 ? ` ab ${euro(sb.min_cents)}` : ''} freigeschaltet.` : '';
  const frist = sb.until ? ` Gilt bei Anmeldung bis ${datum(sb.until, true)}.` : '';
  return `Du warst auf unserer Warteliste: Dafür bekommst du ${punkteWort(sb.points)} Startbonus.${bedingung}${frist}`;
}
