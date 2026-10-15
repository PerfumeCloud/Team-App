import { useEffect, useState } from 'react';
import { Download, ExternalLink, LogOut, Share, ShoppingBag, Trash2 } from 'lucide-react';
import { useLocation } from 'react-router';
import { api, fehlertext, vorschauBeenden } from '../lib/api';
import { useKunde, useStatus } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { abmelden } from '../lib/konto';
import { datum, punkteWort } from '../lib/format';
import { Dialog, Hb, Hinweis, Seitenkopf } from '../components/ui';
import { ExtraPunkte, FeedbackLink, Mitteilungen } from '../components/KontoExtras';
import { StufenZeichen } from '../components/Club';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let gemerkt: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  gemerkt = e as InstallEvent;
});

function AppInstallieren() {
  const [ereignis, setEreignis] = useState<InstallEvent | null>(gemerkt);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const f = (e: Event) => {
      e.preventDefault();
      gemerkt = e as InstallEvent;
      setEreignis(gemerkt);
    };
    window.addEventListener('beforeinstallprompt', f);
    return () => window.removeEventListener('beforeinstallprompt', f);
  }, []);

  if (standalone) return <p className="klein leise">Du nutzt den Club schon als App. Schön!</p>;
  if (ereignis) {
    return (
      <div>
        <Hb
          klein
          icon={<Download />}
          onClick={async () => {
            await ereignis.prompt();
            await ereignis.userChoice;
            gemerkt = null;
            setEreignis(null);
          }}
        >
          App installieren
        </Hb>
      </div>
    );
  }
  if (ios) {
    return (
      <p className="klein">
        Tippe in Safari unten auf <Share className="icon" style={{ verticalAlign: '-.25em', width: '1.05rem' }} aria-label="Teilen" /> und dann auf „Zum Home-Bildschirm“.
      </p>
    );
  }
  return <p className="klein leise">Öffne das Browser-Menü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.</p>;
}

export default function Konto() {
  useTitel('Konto');
  const { me } = useKunde();
  const status = useStatus();
  const m = me.member;
  const [austreten, setAustreten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ');
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(t);
  }, [hash]);

  async function verlassen() {
    setBusy(true);
    setFehler(null);
    try {
      const r = await api<{ logout_url: string | null }>('DELETE', '/me');
      window.location.href = r.logout_url || '/anmelden';
    } catch (e) {
      setFehler(fehlertext(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Seitenkopf label="Konto" titel={<>Dein <em>Konto</em></>} />

      <section className="karte">
        <div className="karte-kopf">
          <div>
            <h2>{name || m.email}</h2>
            {name && <p className="leise">{m.email}</p>}
          </div>
          {me.tier && (
            <span className="stufe-titel klein">
              <StufenZeichen stufe={me.tier.key} klein /> {me.tier.name}
            </span>
          )}
        </div>
        <ul className="verlauf">
          <li>
            <span className="was">Mitglied seit</span>
            <span>{datum(m.joined_at, true)}</span>
          </li>
          {me.points && (
            <li>
              <span className="was">Insgesamt gesammelt</span>
              <span>{punkteWort(me.points.lifetime)}</span>
            </li>
          )}
        </ul>
        <div className="code-reihe">
          <a className="knopf" href={me.account_url}>
            <ExternalLink /> Adressen &amp; Daten im Shop
          </a>
          <a className="knopf" href={me.shop_url}>
            <ShoppingBag /> Zum Shop
          </a>
        </div>
      </section>

      <Mitteilungen />

      <ExtraPunkte />

      <section className="karte">
        <h2 className="karte-titel">Als App auf dem Handy</h2>
        <p className="klein">Leg dir den Club auf den Home-Bildschirm: Punkte und Pakete sind dann nur einen Tipp entfernt.</p>
        <AppInstallieren />
      </section>

      <FeedbackLink />

      {me.preview ? (
        <section className="karte">
          <h2 className="karte-titel">Kundenansicht</h2>
          <p className="klein">Du siehst die App so, wie dieses Mitglied sie sieht. Ändern kannst du hier nichts.</p>
          <div>
            <button className="knopf" onClick={() => vorschauBeenden(`/admin/mitglieder/${m.id}`)}>
              <LogOut /> Zurück zum Admin-Bereich
            </button>
          </div>
        </section>
      ) : (
      <section className="karte">
        <h2 className="karte-titel">Abmelden</h2>
        <p className="klein">Deine Punkte bleiben erhalten. Du meldest dich auch im Shop ab.</p>
        <div>
          <button className="knopf" onClick={() => void abmelden()}>
            <LogOut /> Abmelden
          </button>
        </div>
        <details className="mehr" style={{ marginTop: '.6rem' }}>
          <summary>Club verlassen</summary>
          <p className="klein">
            Wenn du austrittst, verfallen deine Punkte und offenen Codes, und wir löschen deine Club-Daten. Dein Kundenkonto im Shop bleibt bestehen.
          </p>
          <button className="knopf knopf-gefahr" style={{ marginTop: '.8rem' }} onClick={() => setAustreten(true)}>
            <Trash2 /> Club verlassen
          </button>
        </details>
      </section>
      )}

      <p className="kleingedruckt">
        {status.terms_url && (
          <>
            <a href={status.terms_url} target="_blank" rel="noopener">
              Teilnahmebedingungen
            </a>{' '}
            ·{' '}
          </>
        )}
        <a href={`${me.shop_url}/policies/privacy-policy`} target="_blank" rel="noopener">
          Datenschutz
        </a>{' '}
        ·{' '}
        <a href={`${me.shop_url}/policies/legal-notice`} target="_blank" rel="noopener">
          Impressum
        </a>{' '}
        · Version {status.version}
      </p>

      {austreten && (
        <Dialog
          titel="Club wirklich verlassen?"
          onClose={() => !busy && setAustreten(false)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setAustreten(false)} disabled={busy}>
                Doch bleiben
              </button>
              <button className="knopf knopf-gefahr" onClick={() => void verlassen()} disabled={busy}>
                <Trash2 /> Verlassen
              </button>
            </>
          }
        >
          <p>
            {me.points && me.points.balance > 0 ? `Deine ${punkteWort(me.points.balance)} ` : 'Deine Punkte '}
            {me.codes && me.codes.length > 0 ? 'und offenen Codes ' : ''}verfallen. Das lässt sich nicht rückgängig machen.
          </p>
          {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        </Dialog>
      )}
    </>
  );
}
