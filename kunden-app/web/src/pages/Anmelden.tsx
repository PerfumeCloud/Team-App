import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BadgePercent, Gift, Mail, ShoppingBag, Truck } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useStatus } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { euro, punkteWort } from '../lib/format';
import type { Me, Points, Program } from '../lib/types';
import { Duenen, flakon, Hb, Hinweis, PunkteKarte, Toaster } from '../components/ui';
import { Logo } from '../components/Shell';

const STANDARD: Program = {
  name: 'Perfume Cloud Club',
  active: true,
  earn_per_euro: 1,
  redeem_points: 100,
  redeem_cents: 500,
  max_cents: 5000,
  code_days: 90,
  wait_days: 14,
  welcome_points: 50,
  retro_days: 30,
};

/** Beispielstand für die Vorschau-Karte, passend zu den eingestellten Regeln */
function beispiel(p: Program): Points {
  const balance = Math.round(p.redeem_points * 2.4);
  const maxSteps = Math.max(1, Math.floor(p.max_cents / p.redeem_cents));
  const affordable = Math.min(maxSteps, Math.floor(balance / p.redeem_points));
  return {
    balance,
    pending: Math.round(p.redeem_points * 0.85),
    value_cents: affordable * p.redeem_cents,
    to_next: affordable >= maxSteps ? 0 : p.redeem_points - (balance % p.redeem_points),
    next_cents: Math.min(maxSteps, affordable + 1) * p.redeem_cents,
    steps: [],
    lifetime: balance,
  };
}

export default function Anmelden({ onLogin }: { onLogin: (me: Me) => void }) {
  useTitel('Anmelden');
  const status = useStatus();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const program = status.program ?? STANDARD;
  const next = params.get('next') ?? '/';
  const fehler = params.get('fehler');
  const shopify = !!status.login?.shopify;
  const email = !!status.login?.email;
  const [mitCode, setMitCode] = useState(!shopify && email);

  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo to="/anmelden" />
        <div className="kopf-rechts">
          <a className="knopf" href={status.shop_url ?? '/'}>
            <ShoppingBag /> Shop
          </a>
        </div>
      </header>
      <main className="app" style={{ paddingBottom: '3rem' }}>
        <div className="app-innen">
          <section className="start">
            <div>
              <span className="label">Treueprogramm · Bestellungen</span>
              <h1 style={{ marginTop: '.9rem' }}>
                Perfume <em>Cloud</em> Club
              </h1>
              <p className="intro">
                Sammle mit jeder Bestellung Punkte und löse sie beim nächsten Einkauf als Rabatt ein. Und behalte deine Bestellungen im Blick, vom Versand bis an deine Tür.
              </p>
              <div className="aktionen">
                {fehler && <Hinweis fehler>{fehler}</Hinweis>}
                {shopify && !mitCode && (
                  <>
                    <Hb dunkel href={`/api/auth/shopify/start?next=${encodeURIComponent(next)}`}>
                      Anmelden oder Konto erstellen
                    </Hb>
                    <p className="kleingedruckt">
                      Mit deinem Perfume-Cloud-Kundenkonto. Du bekommst einen Code per E-Mail, ein Passwort brauchst du nicht. Neu hier? Dann wird dein Konto dabei erstellt.
                    </p>
                    {email && (
                      <button className="textlink klein" onClick={() => setMitCode(true)}>
                        Lieber direkt hier mit E-Mail-Code anmelden
                      </button>
                    )}
                  </>
                )}
                {mitCode && (
                  <CodeAnmeldung
                    onLogin={(me) => {
                      navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
                      onLogin(me);
                    }}
                    zurueck={shopify ? () => setMitCode(false) : undefined}
                  />
                )}
                {!shopify && !email && <Hinweis>Die Anmeldung wird gerade eingerichtet. Schau bald wieder vorbei.</Hinweis>}
              </div>
            </div>
            <div className="vorschau" aria-hidden="true">
              <PunkteKarte points={beispiel(program)} program={program} />
              <img className="schwebe" src={flakon} alt="" />
            </div>
          </section>

          <ul className="vorteile">
            <li>
              <span className="symbol">
                <Gift />
              </span>
              <h2 className="karte-titel">Punkte für jede Bestellung</h2>
              <p>
                Für jeden Euro bekommst du {punkteWort(program.earn_per_euro)}.{' '}
                {program.welcome_points > 0 && <>Zum Start schenken wir dir {punkteWort(program.welcome_points)}.</>}
              </p>
            </li>
            <li>
              <span className="symbol">
                <BadgePercent />
              </span>
              <h2 className="karte-titel">Punkte werden Rabatt</h2>
              <p>
                {punkteWort(program.redeem_points)} sind {euro(program.redeem_cents)} wert. Du löst sie mit einem Tipp als Code für deinen nächsten Einkauf ein.
              </p>
            </li>
            <li>
              <span className="symbol">
                <Truck />
              </span>
              <h2 className="karte-titel">Bestellungen im Blick</h2>
              <p>Status, Sendungsnummer und Zustellung: alles an einem Ort, auch als App auf deinem Handy.</p>
            </li>
          </ul>

          <p className="kleingedruckt">
            Punkte werden {program.wait_days > 0 ? `${program.wait_days} Tage nach dem Versand` : 'nach dem Versand'} gutgeschrieben.{' '}
            {status.terms_url && (
              <>
                Es gelten die{' '}
                <a href={status.terms_url} target="_blank" rel="noopener">
                  Teilnahmebedingungen
                </a>
                .
              </>
            )}
          </p>
        </div>
      </main>
      <Toaster />
    </>
  );
}

function CodeAnmeldung({ onLogin, zurueck }: { onLogin: (me: Me) => void; zurueck?: () => void }) {
  const [schritt, setSchritt] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function senden(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      await api('POST', '/auth/code', { email: email.trim() });
      setSchritt('code');
      setCode('');
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  async function pruefen(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      onLogin(await api<Me>('POST', '/auth/code/verify', { email: email.trim(), code: code.trim() }));
    } catch (err) {
      setFehler(fehlertext(err));
      setBusy(false);
    }
  }

  if (schritt === 'email') {
    return (
      <form className="formular" style={{ width: 'min(100%, 26rem)' }} onSubmit={senden}>
        <p className="form-titel">
          <Mail className="icon" /> Anmelden mit E-Mail-Code
        </p>
        <label className="feld">
          <span>Deine E-Mail-Adresse</span>
          <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@beispiel.de" />
        </label>
        {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        <Hb dunkel type="submit" busy={busy}>
          Code senden
        </Hb>
        {zurueck && (
          <button type="button" className="textlink klein" onClick={zurueck} style={{ justifySelf: 'start' }}>
            Zurück zur Anmeldung mit Kundenkonto
          </button>
        )}
      </form>
    );
  }

  return (
    <form className="formular" style={{ width: 'min(100%, 26rem)' }} onSubmit={pruefen}>
      <p className="klein">
        Wir haben dir einen sechsstelligen Code an <strong>{email}</strong> geschickt. Er gilt 10 Minuten.
      </p>
      <label className="feld">
        <span>Code aus der E-Mail</span>
        <input
          className="code-feld"
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      {fehler && <Hinweis fehler>{fehler}</Hinweis>}
      <Hb dunkel type="submit" busy={busy} disabled={code.length !== 6}>
        Anmelden
      </Hb>
      <p className="klein leise">
        Nichts angekommen? Schau im Spam-Ordner nach oder{' '}
        <button type="button" className="textlink" onClick={() => void senden()} disabled={busy}>
          sende den Code erneut
        </button>{' '}
        ·{' '}
        <button type="button" className="textlink" onClick={() => setSchritt('email')}>
          andere E-Mail
        </button>
      </p>
    </form>
  );
}
