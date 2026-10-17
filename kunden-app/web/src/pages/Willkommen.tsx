import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { BadgePercent, Gift, Truck } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useKunde, useStatus } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { abmelden } from '../lib/konto';
import { punkteWort } from '../lib/format';
import { codeText, einloesenText, sammelText, verfallText } from '../lib/regeln';
import { einladung, einladungVergessen } from '../lib/einladung';
import { AktionBanner } from '../components/Club';
import type { Me } from '../lib/types';
import { Erfolg, Hb, Hinweis, Seitenkopf } from '../components/ui';
import { KundenShell } from '../components/Shell';

export default function Willkommen() {
  useTitel('Willkommen');
  const { me, setMe } = useKunde();
  const status = useStatus();
  const navigate = useNavigate();
  const p = me.program;
  const name = me.member.first_name;
  const [vorname, setVorname] = useState(name ?? '');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [beigetreten, setBeigetreten] = useState<Me | null>(null);
  const [code] = useState(() => einladung());
  const [gast, setGast] = useState<{ name: string; points: number } | null>(null);
  useEffect(() => {
    if (!code) return;
    api<{ name: string; points: number }>('GET', `/einladung/${encodeURIComponent(code)}`)
      .then(setGast)
      .catch(() => setGast(null));
  }, [code]);

  async function beitreten(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      setBeigetreten(await api<Me>('POST', '/me/join', { terms: ok, first_name: vorname.trim(), einladung: gast ? code : undefined }));
      einladungVergessen();
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KundenShell shopUrl={me.shop_url} ohneDock>
      <Seitenkopf label="Willkommen" titel={<>Schön, dass du <em>da bist{name ? `, ${name}` : ''}</em></>}>
        <p>Ein Schritt noch, dann sammelst du mit jeder Bestellung Punkte.</p>
      </Seitenkopf>

      {gast && (
        <Hinweis>
          <b style={{ fontWeight: 400, fontStyle: 'italic' }}>{gast.name}</b> hat dich eingeladen.
          {gast.points > 0 && ` Nach deiner ersten Bestellung bekommst du ${punkteWort(gast.points)} extra.`}
        </Hinweis>
      )}
      <AktionBanner p={p} />

      <form className="karte formular" onSubmit={beitreten} style={{ maxWidth: '36rem' }}>
        <h2 className="karte-titel">Dem Club beitreten</h2>
        <label className="feld">
          <span>Dein Vorname</span>
          <input
            required
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            value={vorname}
            onChange={(e) => setVorname(e.target.value)}
            placeholder="z. B. Anna"
            maxLength={60}
          />
          <small>So begrüßen wir dich in der App: „Guten Morgen, {vorname.trim() || 'Anna'}“.</small>
        </label>
        <label className="haken-zeile">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>
            Ich möchte mitmachen und akzeptiere die{' '}
            {status.terms_url ? (
              <a href={status.terms_url} target="_blank" rel="noopener">
                Teilnahmebedingungen
              </a>
            ) : (
              'Teilnahmebedingungen'
            )}
            . Punkte werden {p.wait_days > 0 ? `${p.wait_days} Tage nach dem Versand` : 'nach dem Versand'} gutgeschrieben. {codeText(p)} {verfallText(p)} Austreten kann ich jederzeit.
          </span>
        </label>
        {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        <div>
          <Hb dunkel type="submit" busy={busy} disabled={!ok || !vorname.trim()}>
            Jetzt beitreten
          </Hb>
        </div>
      </form>

      <ul className="vorteile">
        <li>
          <span className="symbol">
            <Gift />
          </span>
          <h2 className="karte-titel">{p.welcome_points > 0 ? `${punkteWort(p.welcome_points)} geschenkt` : 'Punkte sammeln'}</h2>
          <p>
            {p.welcome_points > 0 ? 'Gleich zum Start. ' : ''}{sammelText(p)}
            {p.retro_days > 0 && ` Bestellungen der letzten ${p.retro_days} Tage zählen schon mit.`}
          </p>
        </li>
        <li>
          <span className="symbol">
            <BadgePercent />
          </span>
          <h2 className="karte-titel">Als Rabatt einlösen</h2>
          <p>{einloesenText(p)}</p>
        </li>
        <li>
          <span className="symbol">
            <Truck />
          </span>
          <h2 className="karte-titel">Bestellungen verfolgen</h2>
          <p>Du siehst jederzeit, wo dein Paket gerade ist.</p>
        </li>
      </ul>

      <p className="klein leise umbruch">
        Angemeldet mit {me.member.email} · Nicht du?{' '}
        <button className="textlink" onClick={() => void abmelden()}>
          Abmelden
        </button>
      </p>

      {beigetreten && (
        <Erfolg name="WILLKOMMEN" titel="Du bist im Club">
          <p>
            {beigetreten.points && beigetreten.points.balance > 0
              ? `${punkteWort(beigetreten.points.balance)} sind schon auf deinem Konto.`
              : 'Ab jetzt sammelst du mit jeder Bestellung Punkte.'}
            {beigetreten.points && beigetreten.points.locked > 0 && ` Dazu warten ${punkteWort(beigetreten.points.locked)} Bonus auf deine erste Bestellung.`}
          </p>
          <Hb
            dunkel
            onClick={() => {
              navigate('/', { replace: true });
              setMe(beigetreten);
            }}
          >
            Zu meinen Punkten
          </Hb>
        </Erfolg>
      )}
    </KundenShell>
  );
}
