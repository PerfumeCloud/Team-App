import { useEffect, useState } from 'react';
import { Cake, Check, Eye, Gift, MessageSquareHeart, Newspaper, Sparkles, Users } from 'lucide-react';
import { euro, datum } from '../lib/format';
import { ab, aktionText, bis, einloesenText, sammelText, satz, verfallText, wartenText } from '../lib/regeln';
import { vorschauBeenden } from '../lib/api';
import type { Program, Tier, TierInfo } from '../lib/types';
import { vars } from './ui';

/* ---------- Aktion mit mehr Punkten (z. B. Launch-Woche, Black Friday) ---------- */

export function AktionBanner({ p }: { p: Program }) {
  if (p.promo) {
    return (
      <div className="aktion" role="status">
        <span className="live" aria-hidden="true" />
        <p>
          <b>{p.promo.name}:</b> {aktionText(p.promo)} auf jede Bestellung, nur bis {bis(p.promo.ends_at)}.
        </p>
      </div>
    );
  }
  const n = p.next_promo;
  if (n && n.starts_at - Date.now() < 14 * 86400000) {
    return (
      <div className="aktion leise-aktion" role="status">
        <Sparkles aria-hidden="true" />
        <p>
          <b>Bald: {n.name}.</b> Ab {ab(n.starts_at)} gibt es {aktionText(n)}.
        </p>
      </div>
    );
  }
  return null;
}

/* ---------- Stufen ---------- */

export function StufenZeichen({ stufe, klein }: { stufe: string; klein?: boolean }) {
  return (
    <span className={`stufe-zeichen stufe-${stufe}${klein ? ' klein' : ''}`} aria-hidden="true">
      {stufe.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Die eigene Stufe mit Fortschritt zur nächsten */
export function StufenKarte({ tier, p }: { tier: TierInfo; p: Program }) {
  const next = tier.next;
  const anteil = next ? Math.min(100, Math.round((tier.spend_cents / Math.max(1, next.min_cents)) * 100)) : 100;
  const [breite, setBreite] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setBreite(anteil));
    return () => cancelAnimationFrame(t);
  }, [anteil]);

  return (
    <section className="karte stufe-karte" aria-label="Deine Stufe">
      <div className="karte-kopf">
        <div className="stufe-titel">
          <StufenZeichen stufe={tier.key} />
          <div>
            <span className="label">Deine Stufe</span>
            <h2>{tier.name}</h2>
          </div>
        </div>
        <span className="satz">{satz(tier.rate)} pro €</span>
      </div>
      {next ? (
        <div className="fortschritt">
          <div className="balken holz" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={anteil} aria-label={`Fortschritt bis ${next.name}`}>
            <i style={vars({ '--w': `${breite}%` })} />
          </div>
          <p className="klein">
            Noch {euro(next.missing_cents)} Einkaufswert bis <b>{next.name}</b>, dann sammelst du {satz(next.rate)} pro Euro.
          </p>
        </div>
      ) : (
        <p className="klein">Du bist in der höchsten Stufe. Danke, dass du so oft bei uns bist!</p>
      )}
      {tier.keep_cents > 0 && tier.until && (
        <p className="klein leise">
          Kaufe bis {datum(tier.until, true)} noch für {euro(tier.keep_cents)} ein, dann bleibst du in {tier.name}.
        </p>
      )}
      {tier.benefits.length > 0 && (
        <ul className="haken-liste">
          {tier.benefits.map((b) => (
            <li key={b}>
              <Check aria-hidden="true" /> {b}
            </li>
          ))}
        </ul>
      )}
      <details className="mehr">
        <summary>Alle Stufen ansehen</summary>
        <StufenListe p={p} aktuell={tier.key} />
      </details>
    </section>
  );
}

export function StufenListe({ p, aktuell }: { p: Program; aktuell?: string }) {
  if (!p.tiers_enabled || p.tiers.length === 0) return null;
  return (
    <>
      <ul className="stufen">
        {p.tiers.map((t: Tier) => (
          <li key={t.key} className={t.key === aktuell ? 'aktuell' : undefined} aria-current={t.key === aktuell ? 'true' : undefined}>
            <div className="stufe-titel">
              <StufenZeichen stufe={t.key} klein />
              <b>{t.name}</b>
            </div>
            <span className="satz">{satz(t.rate)} pro €</span>
            <small>{t.min_cents > 0 ? `ab ${euro(t.min_cents)} Einkaufswert in ${p.tier_months} Monaten` : 'für alle Mitglieder'}</small>
            {t.benefits.length > 0 && (
              <ul className="haken-liste">
                {t.benefits.map((b) => (
                  <li key={b}>
                    <Check aria-hidden="true" /> {b}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="kleingedruckt" style={{ marginTop: '.6rem' }}>
        Es zählt dein Einkaufswert der letzten {p.tier_months} Monate. Eine erreichte Stufe gilt mindestens {p.tier_months} Monate.
      </p>
    </>
  );
}

/* ---------- So funktioniert's (aus den Regeln) ---------- */

export function SoFunktionierts({ p, rate }: { p: Program; rate?: number }) {
  const verfall = verfallText(p);
  return (
    <section className="raster">
      <h2 className="karte-titel">So funktioniert’s</h2>
      <ol className="schritte">
        <li>
          <b>Bestellen</b>
          <p>{sammelText(p, rate)} Versand zählt nicht mit.</p>
        </li>
        <li>
          <b>Sammeln</b>
          <p>{wartenText(p)}</p>
        </li>
        <li>
          <b>Einlösen</b>
          <p>{einloesenText(p)}</p>
        </li>
      </ol>
      {verfall && <p className="kleingedruckt">{verfall} Wir erinnern dich rechtzeitig per Mitteilung.</p>}
    </section>
  );
}

/* ---------- Kundenansicht des Teams ---------- */

export function VorschauLeiste({ name }: { name: string }) {
  return (
    <div className="vorschau-leiste" role="status">
      <Eye aria-hidden="true" />
      <span>
        Kundenansicht von <b>{name}</b> · nur ansehen
      </span>
      <button className="knopf knopf-klein" onClick={() => vorschauBeenden()}>
        Beenden
      </button>
    </div>
  );
}

/* ---------- Extra-Punkte ---------- */

const BONUS_ICON: Record<string, typeof Gift> = { welcome: Gift, birthday: Cake, referral: Users, newsletter: Newspaper, review: MessageSquareHeart };

export function BoniListe({ items }: { items: { key: string; titel: string; text: string }[] }) {
  return (
    <ul className="boni">
      {items.map((b) => {
        const Icon = BONUS_ICON[b.key] ?? Gift;
        return (
          <li key={b.key}>
            <span className="symbol">
              <Icon />
            </span>
            <div>
              <b>{b.titel}</b>
              <p>{b.text}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
