import { useState } from 'react';
import { ExternalLink, Lock, Undo2 } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useKunde } from '../lib/kontext';
import { useLoad, useTitel } from '../lib/hooks';
import { toast } from '../lib/toast';
import { datum, euro, punkte, punkteWort, tageBis } from '../lib/format';
import type { Code, Points, PointsResponse } from '../lib/types';
import { Dialog, Erfolg, Hb, Hinweis, KopierKnopf, Laden, Seitenkopf } from '../components/ui';
import { codeStatus, FruehereCodes, Verlauf } from '../components/Verlauf';
import { AktionBanner, SoFunktionierts } from '../components/Club';

export function CodeKarte({ c, onZurueck }: { c: Code; onZurueck?: (c: Code) => void }) {
  const tage = tageBis(c.expires_at);
  return (
    <div className="karte code-karte">
      <span className="label">Code über {euro(c.value_cents)}</span>
      <div className="code">
        <b>{c.code}</b>
        <KopierKnopf text={c.code} nurIcon label="Code kopieren" />
      </div>
      <p className="klein leise">
        {codeStatus(c)}
        {tage <= 14 && c.status === 'active' ? ` (noch ${tage} ${tage === 1 ? 'Tag' : 'Tage'})` : ''} · ab {euro(c.min_cents)} Bestellwert · einmal einlösbar
      </p>
      <div className="code-reihe">
        <Hb klein dunkel href={c.url} icon={<ExternalLink />}>
          Im Shop einlösen
        </Hb>
        {onZurueck && (
          <button className="knopf" onClick={() => onZurueck(c)}>
            <Undo2 /> Zurückgeben
          </button>
        )}
      </div>
    </div>
  );
}

export default function Praemien() {
  useTitel('Prämien');
  const { me, reloadMe } = useKunde();
  const { data, setData, error, reload } = useLoad<PointsResponse>('/points');
  const [auswahl, setAuswahl] = useState<number | null>(null);
  const [fragen, setFragen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neu, setNeu] = useState<Code | null>(null);
  const [zurueck, setZurueck] = useState<Code | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;

  const { points, program: p, history, codes } = data;
  const offen = codes.filter((c) => c.status === 'active' || c.status === 'creating');
  const frueher = codes.filter((c) => c.status !== 'active' && c.status !== 'creating');
  const stufe = points.steps.find((s) => s.steps === auswahl) ?? null;
  // Alle erreichbaren Stufen und die nächsten zwei als Ansporn – nicht gleich zehn gesperrte Kacheln
  const sichtbar = [...points.steps.filter((s) => s.affordable), ...points.steps.filter((s) => !s.affordable).slice(0, 2)];

  function aktualisieren(pts: Points, code: Code) {
    setData((d) => (d ? { ...d, points: pts, codes: [code, ...d.codes.filter((c) => c.id !== code.id)] } : d));
    void reload();
    void reloadMe();
  }

  async function erstellen() {
    if (!stufe) return;
    setBusy(true);
    setFehler(null);
    try {
      const r = await api<{ code: Code; points: Points }>('POST', '/codes', { steps: stufe.steps });
      setFragen(false);
      setAuswahl(null);
      aktualisieren(r.points, r.code);
      setNeu(r.code);
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  async function zurueckgeben() {
    if (!zurueck) return;
    setBusy(true);
    setFehler(null);
    try {
      const r = await api<{ code: Code; points: Points }>('DELETE', `/codes/${zurueck.id}`);
      setZurueck(null);
      aktualisieren(r.points, r.code);
      toast(`${punkteWort(zurueck.points)} sind zurück auf deinem Konto`);
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Seitenkopf label="Prämien" titel={<>Punkte <em>einlösen</em></>}>
        <p>Wähle, wie viel Rabatt du möchtest. Du bekommst einen Code für deinen nächsten Einkauf im Shop.</p>
      </Seitenkopf>

      {!p.active && <Hinweis>Das Einlösen ist gerade pausiert. Deine Punkte bleiben natürlich erhalten.</Hinweis>}
      <AktionBanner p={p} />
      {points.expiring && (
        <Hinweis>
          {punkteWort(points.expiring.points)} verfallen am {datum(points.expiring.at, true)}. Löse sie vorher ein, dann gehen sie nicht verloren.
        </Hinweis>
      )}

      <section className="karte">
        <div className="karte-kopf">
          <h2>
            {punkte(points.balance)} <em style={{ color: 'var(--em)' }}>{points.balance === 1 ? 'Punkt' : 'Punkte'}</em>
          </h2>
          {points.pending + points.locked > 0 && (
            <span className="unterwegs">
              <span className="live" aria-hidden="true" /> {punkte(points.pending + points.locked)} unterwegs
            </span>
          )}
        </div>
        <div className="praemien" role="group" aria-label="Prämie wählen">
          {sichtbar.map((s) => (
            <button
              key={s.steps}
              type="button"
              className="praemie"
              aria-pressed={auswahl === s.steps}
              disabled={!s.affordable || !p.active}
              onClick={() => setAuswahl(auswahl === s.steps ? null : s.steps)}
            >
              {!s.affordable && <Lock className="schloss" aria-hidden="true" />}
              <b>
                {(s.cents / 100).toLocaleString('de-DE')}
                <em> €</em>
              </b>
              <span>{punkteWort(s.points)}</span>
            </button>
          ))}
        </div>
        {points.to_next > 0 && (
          <p className="klein leise">
            Noch {punkteWort(points.to_next)} bis {euro(points.next_cents)}.
          </p>
        )}
        <div>
          <Hb dunkel disabled={!stufe || me.preview} onClick={() => setFragen(true)}>
            {stufe ? `Code über ${euro(stufe.cents)} erstellen` : 'Prämie wählen'}
          </Hb>
        </div>
      </section>

      {offen.length > 0 && (
        <section className="raster">
          <h2 className="karte-titel">Deine offenen Codes</h2>
          <div className="raster raster-2">
            {offen.map((c) => (
              <CodeKarte key={c.id} c={c} onZurueck={c.status === 'active' && !me.preview ? setZurueck : undefined} />
            ))}
          </div>
        </section>
      )}

      <section className="karte">
        <div className="karte-kopf">
          <h2>Verlauf</h2>
          <span className="klein leise">insgesamt {punkteWort(points.lifetime)} gesammelt</span>
        </div>
        <Verlauf items={history} />
        <FruehereCodes codes={frueher} zurueck={p.code_expiry_refund} />
      </section>

      <SoFunktionierts p={p} rate={data.tier?.rate} />

      {fragen && stufe && (
        <Dialog
          titel={`Code über ${euro(stufe.cents)} erstellen?`}
          onClose={() => !busy && setFragen(false)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setFragen(false)} disabled={busy}>
                Abbrechen
              </button>
              <Hb dunkel klein busy={busy} onClick={() => void erstellen()}>
                Code erstellen
              </Hb>
            </>
          }
        >
          <p>Dafür werden {punkteWort(stufe.points)} von deinem Konto abgebucht.</p>
          <ul className="klein" style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--amber-hell)' }}>
            <li>gültig {p.code_days} Tage, bis {datum(Date.now() + p.code_days * 86400000, true)}</li>
            <li>ab einem Bestellwert von {euro(stufe.cents)}</li>
            <li>einmal einlösbar, nur mit deinem Kundenkonto</li>
            <li>du kannst ihn zurückgeben, solange er nicht benutzt ist</li>
          </ul>
          {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        </Dialog>
      )}

      {zurueck && (
        <Dialog
          titel="Code zurückgeben?"
          onClose={() => !busy && setZurueck(null)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setZurueck(null)} disabled={busy}>
                Behalten
              </button>
              <Hb klein dunkel busy={busy} onClick={() => void zurueckgeben()} icon={<Undo2 />}>
                Zurückgeben
              </Hb>
            </>
          }
        >
          <p>
            Die {punkteWort(zurueck.points)} gehen zurück auf dein Konto. Der Code {zurueck.code} ist danach ungültig.
          </p>
          {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        </Dialog>
      )}

      {neu && (
        <Erfolg name={neu.code} titel={`Dein Code über ${euro(neu.value_cents)} ist bereit`}>
          <p>Gib ihn an der Kasse ein oder tippe auf „Im Shop einlösen“, dann ist er schon hinterlegt.</p>
          <div className="code-reihe" style={{ justifyContent: 'center', marginTop: '.4rem' }}>
            <KopierKnopf text={neu.code} label="Code kopieren" />
            <Hb dunkel klein href={neu.url} icon={<ExternalLink />}>
              Im Shop einlösen
            </Hb>
          </div>
          <button className="textlink klein" onClick={() => setNeu(null)} style={{ marginTop: '.4rem' }}>
            Schließen
          </button>
        </Erfolg>
      )}
    </>
  );
}
