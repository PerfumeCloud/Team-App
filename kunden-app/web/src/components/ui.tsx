import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CircleAlert, Copy, Gift, Hourglass, Info, Lock, Undo2 } from 'lucide-react';
import zeichen from '../assets/zeichen.svg';
import karteBild from '../assets/wueste-karte.jpg';
import duenenBreit from '../assets/wueste-hell.jpg';
import duenenMobil from '../assets/wueste-hell-mobil.jpg';
import flakon from '../assets/sunset-dune-360.webp';
import { onToast, toast } from '../lib/toast';
import { kopieren } from '../lib/hooks';
import { datum, euro, punkte, punkteWort } from '../lib/format';
import type { Points, Program, Tone } from '../lib/types';

export { zeichen, flakon };

/** CSS-Variablen im style-Attribut */
export function vars(v: Record<string, string>): CSSProperties {
  return v as CSSProperties;
}

/* ---------- Knopf mit Bewegung (wie im Shop) ---------- */

interface HbProps {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  to?: string;
  type?: 'button' | 'submit';
  dunkel?: boolean;
  klein?: boolean;
  voll?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  neuesFenster?: boolean;
  /** grüner, pulsierender Punkt statt Holzbraun */
  live?: boolean;
}

export function Hb({ children, onClick, href, to, type = 'button', dunkel, klein, voll, disabled, busy, icon, neuesFenster, live }: HbProps) {
  const cls = ['hb', dunkel && 'hb-dunkel', klein && 'hb-klein', voll && 'hb-voll', live && 'hb-live'].filter(Boolean).join(' ');
  const inhalt = (
    <>
      <span className="hb-punkt" aria-hidden="true" />
      <span className="hb-text">{children}</span>
      <span className="hb-hover" aria-hidden="true">
        {children}
        {icon ?? <ArrowRight />}
      </span>
    </>
  );
  if (to) {
    return (
      <Link className={cls} to={to}>
        {inhalt}
      </Link>
    );
  }
  if (href) {
    return (
      <a className={cls} href={href} {...(neuesFenster ? { target: '_blank', rel: 'noopener' } : {})}>
        {inhalt}
      </a>
    );
  }
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {inhalt}
    </button>
  );
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip ton-${tone}`}>{children}</span>;
}

export function Hinweis({ fehler, children }: { fehler?: boolean; children: ReactNode }) {
  return (
    <div className={fehler ? 'hinweis fehler' : 'hinweis'} role={fehler ? 'alert' : 'status'}>
      {fehler ? <CircleAlert /> : <Info />}
      <div>{children}</div>
    </div>
  );
}

export function Leer({ icon, titel, children }: { icon: ReactNode; titel: string; children?: ReactNode }) {
  return (
    <div className="leer">
      <span className="symbol">{icon}</span>
      <h2 className="karte-titel">{titel}</h2>
      {children}
    </div>
  );
}

export function Laden() {
  return (
    <div className="laden" role="status" aria-label="Lädt">
      <img src={zeichen} alt="" />
    </div>
  );
}

export function Seitenkopf({ label, titel, children, zurueck }: { label?: string; titel: ReactNode; children?: ReactNode; zurueck?: { to: string; text: string } }) {
  return (
    <header className="seitenkopf">
      {zurueck && (
        <Link className="zurueck" to={zurueck.to}>
          <ArrowRight style={{ transform: 'rotate(180deg)' }} /> {zurueck.text}
        </Link>
      )}
      {label && <span className="label">{label}</span>}
      <h1>{titel}</h1>
      {children}
    </header>
  );
}

/* ---------- Hintergrund ---------- */

export function Duenen() {
  return <div className="duenen" aria-hidden="true" style={vars({ '--bild-mobil': `url(${duenenMobil})`, '--bild-breit': `url(${duenenBreit})` })} />;
}

/* ---------- Toast ---------- */

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onToast(setMsg), []);
  if (!msg) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={msg}>
      {msg}
    </div>
  );
}

/* ---------- Dialog zum Bestätigen ---------- */

export function Dialog({ titel, children, onClose, knoepfe }: { titel: string; children: ReactNode; onClose: () => void; knoepfe: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vorher = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, a, input')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      vorher?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="schleier"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog rand glas" role="dialog" aria-modal="true" aria-labelledby="dialog-titel" ref={ref}>
        <div className="dialog-innen">
          <h2 id="dialog-titel">{titel}</h2>
          {children}
          <div className="dialog-knoepfe">{knoepfe}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Erfolg: Name Buchstabe für Buchstabe, darunter das Glas-Banner ---------- */

export function Erfolg({ name, titel, children }: { name: string; titel: string; children: ReactNode }) {
  return (
    <div className="erfolg" role="dialog" aria-modal="true" aria-label={titel}>
      <div className="erfolg-schleier" />
      <div className="erfolg-mitte">
        <p className="erfolg-name" aria-hidden="true">
          {[...name].map((ch, i) =>
            ch === ' ' ? (
              <span key={i} className="lz" style={vars({ '--b': String(i) })} />
            ) : (
              <span key={i} style={vars({ '--b': String(i) })}>
                {ch}
              </span>
            ),
          )}
        </p>
        <span className="erfolg-balken" aria-hidden="true" />
        <div className="erfolg-banner rand glas">
          <div className="erfolg-innen">
            <span className="erfolg-haken" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <h2>{titel}</h2>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Produktbild mit Flakon als Platzhalter ---------- */

export function ProduktBild({ src, alt = '' }: { src: string | null; alt?: string }) {
  const [kaputt, setKaputt] = useState(false);
  return (
    <span className="bild">
      {src && !kaputt ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setKaputt(true)} />
      ) : (
        <img className="flakon" src={flakon} alt={alt} />
      )}
    </span>
  );
}

/* ---------- Kopieren ---------- */

export function KopierKnopf({ text, label = 'Kopieren', klein, nurIcon }: { text: string; label?: string; klein?: boolean; nurIcon?: boolean }) {
  const cls = ['knopf', klein && 'knopf-klein', nurIcon && 'knopf-rund'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={nurIcon ? label : undefined}
      title={nurIcon ? label : undefined}
      onClick={async () => toast((await kopieren(text)) ? 'Kopiert' : 'Kopieren hat nicht geklappt')}
    >
      <Copy /> {!nurIcon && label}
    </button>
  );
}

export function Kopierfeld({ label, wert, hilfe }: { label: string; wert: string; hilfe?: ReactNode }) {
  return (
    <div className="feld">
      <span>{label}</span>
      <div className="kopierfeld">
        <input readOnly value={wert} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <KopierKnopf text={wert} nurIcon />
      </div>
      {hilfe && <small>{hilfe}</small>}
    </div>
  );
}

/* ---------- Zählt eine Zahl hoch (einmal beim Erscheinen) ---------- */

function useHochzaehlen(ziel: number): number {
  const [wert, setWert] = useState(ziel);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || ziel <= 0) {
      setWert(ziel);
      return;
    }
    let frame = 0;
    const von = start.current === null ? 0 : wert;
    const t0 = performance.now();
    start.current = ziel;
    const schritt = (t: number) => {
      const p = Math.min(1, (t - t0) / 1100);
      const e = 1 - Math.pow(1 - p, 4);
      setWert(Math.round(von + (ziel - von) * e));
      if (p < 1) frame = requestAnimationFrame(schritt);
    };
    frame = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(frame);
  }, [ziel]);
  return wert;
}

/* ---------- Die Punktekarte ---------- */

export function PunkteKarte({ points, program, children, marke }: { points: Points; program: Program; children?: ReactNode; marke?: string }) {
  const stand = useHochzaehlen(points.balance);
  const maxErreicht = points.to_next === 0;
  const anteil = maxErreicht ? 100 : Math.max(0, Math.round(((program.redeem_points - points.to_next) / program.redeem_points) * 100));
  const [breite, setBreite] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setBreite(anteil));
    return () => cancelAnimationFrame(t);
  }, [anteil]);

  return (
    <section className="punktekarte" style={vars({ '--karte-bild': `url(${karteBild})` })} aria-label="Dein Punktestand">
      <span className="sonne" aria-hidden="true" />
      <div className="punktekarte-kopf">
        <span className="marke">{marke ?? program.name}</span>
        <img className="zeichen" src={zeichen} alt="" />
      </div>
      <div>
        <p className="stand">
          <b>{punkte(stand)}</b>
          <span>{points.balance === 1 ? 'Punkt' : 'Punkte'} einlösbar</span>
        </p>
        <p className="wert">
          {points.value_cents > 0 ? (
            <>
              Das sind <strong>{euro(points.value_cents)}</strong> Rabatt, einzulösen im Warenkorb.
            </>
          ) : (
            <>
              Ab {punkteWort(program.redeem_points)} gibt es {euro(program.redeem_cents)} Rabatt.
            </>
          )}
        </p>
      </div>
      <div className="fortschritt">
        <div className="balken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={anteil} aria-label="Fortschritt bis zur nächsten Prämie">
          <i style={vars({ '--w': `${breite}%` })} />
        </div>
        <p className="klein">
          {maxErreicht ? `Du kannst bis zu ${euro(program.max_cents)} je Bestellung im Warenkorb einlösen.` : `Noch ${punkteWort(points.to_next)} bis ${euro(points.next_cents)} Rabatt`}
        </p>
      </div>
      {(points.held > 0 || points.waiting > 0 || points.expiring || points.balance < 0) && (
        <div className="karte-zusatz">
          {points.balance < 0 && (
            <p className="unterwegs">
              <Undo2 className="icon-klein" aria-hidden="true" /> Nach einer Rückgabe liegt dein Konto im Minus. Neue Punkte gleichen das zuerst aus.
            </p>
          )}
          {points.held > 0 && (
            <p className="unterwegs">
              <span className="live" aria-hidden="true" /> Insgesamt {punkteWort(points.total)}, davon {punkte(points.held)} noch gesperrt
            </p>
          )}
          {points.unlocks.slice(0, 3).map((u) => (
            <p className="unterwegs eingerueckt" key={`${u.at}-${u.payment}`}>
              <Lock className="icon-klein" aria-hidden="true" /> {punkteWort(u.points)} {u.payment ? 'einlösbar nach der Zahlung' : `einlösbar ab ${datum(u.at)}`}
            </p>
          ))}
          {points.waiting > 0 && (
            <p className="unterwegs">
              <Gift className="icon-klein" aria-hidden="true" /> {punkteWort(points.waiting)} Bonus warten auf deine erste Bestellung
            </p>
          )}
          {points.expiring && (
            <p className="unterwegs">
              <Hourglass className="icon-klein" aria-hidden="true" /> {punkteWort(points.expiring.points)} ({euro(points.expiring.cents)}) verfallen am {datum(points.expiring.at, true)}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
