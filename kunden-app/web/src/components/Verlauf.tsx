import { datum, euro, punkte } from '../lib/format';
import type { Code, HistoryItem } from '../lib/types';

function detail(i: HistoryItem): string {
  const wann = datum(i.at, true);
  if (i.kind !== 'order') return i.note ? `${wann} · ${i.note}` : wann;
  if (i.status === 'available') return `${wann} · ${euro(i.amount_cents ?? 0)}`;
  if (i.status === 'pending') {
    if (i.reason === 'payment') return `${wann} · wartet auf die Zahlung`;
    if (i.reason === 'shipping') return `${wann} · kommt nach dem Versand`;
    return `${wann} · verfügbar ab ${datum(i.available_at, true)}`;
  }
  const grund: Record<string, string> = { cancelled: 'storniert', refunded: 'erstattet', test: 'Testbestellung', zero: 'ohne Punkte' };
  return `${wann} · ${grund[i.reason ?? ''] ?? 'zählt nicht'}`;
}

function zahl(i: HistoryItem): { text: string; cls: string; sr: string } {
  const betrag = `${i.points > 0 ? '+' : i.points < 0 ? '−' : ''}${punkte(Math.abs(i.points))}`;
  if (i.status === 'void') return { text: betrag, cls: 'weg', sr: 'verfallen' };
  if (i.status === 'pending') return { text: betrag, cls: 'offen', sr: 'unterwegs' };
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

export function codeStatus(c: Code): string {
  switch (c.status) {
    case 'active':
      return `gültig bis ${datum(c.expires_at, true)}`;
    case 'used':
      return c.order_name ? `eingelöst bei Bestellung ${c.order_name}` : `eingelöst am ${datum(c.used_at, true)}`;
    case 'expired':
      return 'abgelaufen, Punkte zurückgebucht';
    case 'cancelled':
      return 'zurückgegeben';
    default:
      return 'wird erstellt';
  }
}

export function FruehereCodes({ codes }: { codes: Code[] }) {
  if (codes.length === 0) return null;
  return (
    <details className="mehr">
      <summary>Frühere Codes ({codes.length})</summary>
      <ul className="verlauf">
        {codes.map((c) => (
          <li key={c.id}>
            <span className="was">
              <span style={{ fontFamily: '"Tenor Sans", sans-serif', letterSpacing: '.08em' }}>{c.code}</span>
              <small>{codeStatus(c)}</small>
            </span>
            <span className="zahl">{euro(c.value_cents)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
