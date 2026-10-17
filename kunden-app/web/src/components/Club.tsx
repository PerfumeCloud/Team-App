import { useEffect, useState } from 'react';
import { Cake, Check, Eye, Gift, MessageSquareHeart, Newspaper, Sparkles, Users } from 'lucide-react';
import { euro, punkte, punkteWort } from '../lib/format';
import { ab, aktionText, bis, einloesenText, prozentText, sammelText, satz, verfallText, wartenText, wertCent, wertText } from '../lib/regeln';
import { vorschauBeenden } from '../lib/api';
import type { Points, Program, Tier, TierInfo } from '../lib/types';
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

const METALL = ['bronze', 'silber', 'gold', 'platin'];

export function StufenZeichen({ stufe, klein }: { stufe: string; klein?: boolean }) {
  return (
    <span className={`stufe-zeichen stufe-${METALL.includes(stufe) ? stufe : 'eigen'}${klein ? ' klein' : ''}`} aria-hidden="true">
      {stufe.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Die Stufe als Karte aus Metall: Bronze, Silber, Gold, Platin (eigene Stufen in Sand) */
export function StufenMetall({ tier, p, points }: { tier: TierInfo; p: Program; points?: Points }) {
  return (
    <div className={`metallkarte k-${METALL.includes(tier.key) ? tier.key : 'eigen'}`} aria-hidden="true">
      <div className="oben">
        <span>{p.name}</span>
        <span>Stufe {tier.level}</span>
      </div>
      <div className="name">{tier.name}</div>
      <div className="unten">
        {points ? (
          <>
            <span>{punkteWort(points.balance)}</span>
            <span>{euro(wertCent(points.balance, p))}</span>
          </>
        ) : (
          <span>{satz(tier.rate)} pro €</span>
        )}
      </div>
    </div>
  );
}

/** Die eigene Stufe mit Fortschritt zur nächsten */
export function StufenKarte({ tier, p, points }: { tier: TierInfo; p: Program; points?: Points }) {
  const next = tier.next;
  const anteil = next ? next.progress : 100;
  const [breite, setBreite] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setBreite(anteil));
    return () => cancelAnimationFrame(t);
  }, [anteil]);

  return (
    <section className="karte stufe-karte" aria-labelledby="stufe-titel">
      <div className="stufe-oben">
        <StufenMetall tier={tier} p={p} points={points} />
        <div className="stufe-text">
          <span className="label">Deine Stufe</span>
          <h2 id="stufe-titel">{tier.name}</h2>
          <span className="satz">
            {satz(tier.rate)} pro € · {prozentText(tier.rate, p)} zurück
          </span>
        </div>
      </div>
      {next ? (
        <div className="fortschritt">
          <div className="balken holz" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={anteil} aria-label={`Fortschritt bis ${next.name}`}>
            <i style={vars({ '--w': `${breite}%` })} />
          </div>
          <p className="klein">
            Noch {euro(next.missing_cents)} Einkaufswert bis <b>{next.name}</b>, dann sammelst du {satz(next.rate)} pro Euro ({prozentText(next.rate, p)} zurück).
          </p>
        </div>
      ) : (
        <p className="klein">Du bist in der höchsten Stufe. Danke, dass du so oft bei uns bist!</p>
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
            <span className="satz">
              {satz(t.rate)} pro € · {prozentText(t.rate, p)}
            </span>
            <small>{t.min_cents > 0 ? `ab ${euro(t.min_cents)} Einkaufswert seit dem Beitritt` : 'für alle Mitglieder'}</small>
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
        Es zählt dein gesamter Einkaufswert seit dem Beitritt, ohne Versand. Eine erreichte Stufe bleibt, nur eine Rückgabe senkt den Einkaufswert wieder.
      </p>
    </>
  );
}

/** „Was sind meine Punkte wert?“: alle Stufen mit Prozent zurück und einem Rechenbeispiel */
export function WertTabelle({ p, aktuell }: { p: Program; aktuell?: string }) {
  const stufen: Tier[] = p.tiers_enabled && p.tiers.length > 0 ? p.tiers : [{ key: 'alle', name: 'Alle', min_cents: 0, rate: p.earn_per_euro, benefits: [] }];
  const einkauf = 80;
  const eigene = stufen.find((t) => t.key === aktuell) ?? stufen[0];
  const n = Math.floor(einkauf * eigene.rate);
  return (
    <section className="karte wert" aria-labelledby="wert-titel">
      <h2 id="wert-titel">Was sind meine Punkte wert?</h2>
      <p>
        {punkteWort(p.redeem_points)} sind {euro(p.redeem_cents)} wert. Wie viele Punkte du für jeden Euro bekommst, hängt von deiner Stufe ab.
      </p>
      <div className="tabelle-rahmen">
        <table className="wert-tabelle">
          <thead>
            <tr>
              <th scope="col">Stufe</th>
              <th scope="col" className="zahl">
                je 1 €
              </th>
              <th scope="col" className="zahl">
                zurück
              </th>
              <th scope="col" className="zahl">
                bei {einkauf} €
              </th>
            </tr>
          </thead>
          <tbody>
            {stufen.map((t) => {
              const pkt = Math.floor(einkauf * t.rate);
              return (
                <tr key={t.key} className={t.key === aktuell ? 'aktuell' : undefined} aria-current={t.key === aktuell ? 'true' : undefined}>
                  <th scope="row">
                    <span className="stufe-titel klein">
                      {p.tiers_enabled && <StufenZeichen stufe={t.key} klein />}
                      {t.name}
                    </span>
                  </th>
                  <td className="zahl">{punkte(t.rate)}</td>
                  <td className="zahl">{prozentText(t.rate, p)}</td>
                  <td className="zahl">
                    {punkte(pkt)} P = {euro(wertCent(pkt, p))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="kleingedruckt">
        Beispiel{p.tiers_enabled ? ` für ${eigene.name}` : ''}: Du kaufst für {einkauf} € ein (ohne Versand) und bekommst {punkteWort(n)}. Die sind {euro(wertCent(n, p))} wert,
        also {prozentText(eigene.rate, p)} zurück. Aktionen mit doppelten Punkten kommen noch dazu.
      </p>
    </section>
  );
}

/** Kurze Antworten zu den Punkten (aus den Regeln) */
export function PunkteFragen({ p, tier }: { p: Program; tier?: TierInfo | null }) {
  const verfall = verfallText(p);
  const fragen: { f: string; a: string }[] = [
    { f: 'Wie viel sind meine Punkte wert?', a: wertText(p, tier) },
    { f: 'Wann kann ich meine Punkte einlösen?', a: wartenText(p) },
    {
      f: 'Was passiert bei einer Rückgabe?',
      a: 'Für zurückgeschickte oder stornierte Artikel werden die Punkte wieder abgezogen. Hast du sie schon eingelöst, kann dein Konto kurz ins Minus gehen. Neue Punkte gleichen das zuerst aus.',
    },
  ];
  if (verfall) fragen.push({ f: 'Verfallen meine Punkte?', a: verfall });
  if (p.bonus.referrer > 0) {
    fragen.push({
      f: 'Wann bekomme ich die Punkte fürs Weitersagen?',
      a: `Sobald deine Freundin oder dein Freund zum ersten Mal bestellt, sind dir ${punkteWort(p.bonus.referrer)} gutgeschrieben. Einlösbar sind sie wie die Punkte der Bestellung${p.wait_days > 0 ? `, also nach ${p.wait_days} Tagen` : ''}. Wird die Bestellung storniert, fällt der Bonus weg.`,
    });
  }
  return (
    <section className="karte fragen" aria-labelledby="fragen-titel">
      <h2 id="fragen-titel">Fragen zu deinen Punkten</h2>
      {fragen.map((x) => (
        <details key={x.f} className="mehr">
          <summary>{x.f}</summary>
          <p className="klein">{x.a}</p>
        </details>
      ))}
    </section>
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
      {verfall && <p className="kleingedruckt">{verfall}</p>}
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
