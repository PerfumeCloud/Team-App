import { datum, datumZeit, euro, punkte } from '../lib/format';
import type { Code, HistoryItem } from '../lib/types';

function faktorText(f: number): string {
  const worte: Record<number, string> = { 2: 'doppelte', 3: 'dreifache', 4: 'vierfache', 5: 'fünffache' };
  return worte[f] ?? `${String(f).replace('.', ',')}-fache`;
}

function detail(i: HistoryItem): string {
  const wann = datum(i.at, true);
  if (i.kind !== 'order') {
    if (i.status === 'pending' && i.reason === 'first_order') {
      const ab = i.min_cents ? ` ab ${euro(i.min_cents)}` : '';
      return `${wann} · wird mit deiner ersten Bestellung${ab} gutgeschrieben`;
    }
    if (i.status === 'pending' && i.reason === 'payment') return `${wann} · gutgeschrieben, einlösbar nach der Zahlung`;
    if (i.status === 'pending' && i.available_at) return `${wann} · gutgeschrieben, einlösbar ab ${datum(i.available_at, true)}`;
    return i.note ? `${wann} · ${i.note}` : wann;
  }
  const aktion = i.factor && i.factor > 1 ? ` · ${faktorText(i.factor)} Punkte` : '';
  if (i.status === 'available') return `${wann} · ${euro(i.amount_cents ?? 0)}${aktion}`;
  if (i.status === 'pending') {
    if (i.reason === 'payment') return `${wann} · gutgeschrieben, einlösbar nach der Zahlung${aktion}`;
    return `${wann} · gutgeschrieben, einlösbar ab ${datum(i.available_at, true)}${aktion}`;
  }
  const grund: Record<string, string> = { cancelled: 'storniert', refunded: 'erstattet', test: 'Testbestellung', zero: 'ohne Punkte' };
  return `${wann} · ${grund[i.reason ?? ''] ?? 'zählt nicht'}`;
}

function zahl(i: HistoryItem): { text: string; cls: string; sr: string } {
  const betrag = `${i.points > 0 ? '+' : i.points < 0 ? '−' : ''}${punkte(Math.abs(i.points))}`;
  if (i.status === 'void') return { text: betrag, cls: 'weg', sr: 'verfallen' };
  if (i.status === 'pending') return { text: betrag, cls: 'offen', sr: 'gesperrt' };
  return { text: betrag, cls: i.points < 0 ? 'minus' : 'plus', sr: '' };
}

/** Alle Buchungen: Bestellungen, Bonus, Einlösungen, Gutschriften */
export function Verlauf({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) return <p className="leise klein">Noch keine Buchungen.</p>;
  return (
    <ul className="verlauf">
      {items.map((i) => {
        const z = zahl(i);
        return (
          <li key={i.id}>
            <span className="was">
              {i.title}
              <small>{detail(i)}</small>
            </span>
            <span className={`zahl ${z.cls}`}>
              {z.text}
              {z.sr && <span className="sr"> ({z.sr})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function codeStatus(c: Code, zurueck = true): string {
  const korb = c.source === 'cart';
  switch (c.status) {
    case 'active':
      return korb ? `im Warenkorb bis ${datumZeit(c.expires_at)}` : `gültig bis ${datum(c.expires_at, true)}`;
    case 'used':
      return c.order_name ? `eingelöst bei Bestellung ${c.order_name}` : `eingelöst am ${datum(c.used_at, true)}`;
    case 'expired':
      return korb ? 'nicht bestellt, Punkte zurückgebucht' : zurueck ? 'abgelaufen, Punkte zurückgebucht' : 'abgelaufen';
    case 'cancelled':
      return korb ? 'aus dem Warenkorb zurückgenommen' : 'zurückgegeben';
    default:
      return 'wird erstellt';
  }
}

export function FruehereCodes({ codes, zurueck = true }: { codes: Code[]; zurueck?: boolean }) {
  if (codes.length === 0) return null;
  return (
    <details className="mehr">
      <summary>Frühere Einlösungen ({codes.length})</summary>
      <ul className="verlauf">
        {codes.map((c) => (
          <li key={c.id}>
            <span className="was">
              <span className="code-text">{c.code}</span>
              <small>{codeStatus(c, zurueck)}</small>
            </span>
            <span className="zahl">{euro(c.value_cents)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
