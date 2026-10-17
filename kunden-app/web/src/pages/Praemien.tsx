import { useState } from 'react';
import { ExternalLink, Lock, ShoppingBag, Undo2 } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useKunde } from '../lib/kontext';
import { useLoad, useTitel } from '../lib/hooks';
import { toast } from '../lib/toast';
import { datum, euro, punkte, punkteWort, tageBis } from '../lib/format';
import { warenkorbText } from '../lib/regeln';
import type { Code, Points, PointsResponse } from '../lib/types';
import { Dialog, Hb, Hinweis, KopierKnopf, Laden, Seitenkopf } from '../components/ui';
import { codeStatus, FruehereCodes, Verlauf } from '../components/Verlauf';
import { AktionBanner, PunkteFragen, SoFunktionierts, WertTabelle } from '../components/Club';

/** Offene Einlösung im Warenkorb oder ein älterer Code aus der App (bleibt gültig). */
export function CodeKarte({ c, onZurueck }: { c: Code; onZurueck?: (c: Code) => void }) {
  const korb = c.source === 'cart';
  const tage = tageBis(c.expires_at);
  return (
    <div className="karte code-karte">
      <span className="label">{korb ? `Im Warenkorb eingelöst: ${euro(c.value_cents)}` : `Code über ${euro(c.value_cents)}`}</span>
      {!korb && (
        <div className="code">
          <b>{c.code}</b>
          <KopierKnopf text={c.code} nurIcon label="Code kopieren" />
        </div>
      )}
      <p className="klein leise">
        {korb ? (
          <>
            {punkteWort(c.points)} · {codeStatus(c)}. Bestellst du nicht, sind die Punkte danach wieder da.
          </>
        ) : (
          <>
            {codeStatus(c)}
            {tage <= 14 && c.status === 'active' ? ` (noch ${tage} ${tage === 1 ? 'Tag' : 'Tage'})` : ''} · ab {euro(c.min_cents)} Bestellwert · einmal einlösbar
          </>
        )}
      </p>
      <div className="code-reihe">
        <Hb klein dunkel href={c.url} icon={korb ? <ShoppingBag /> : <ExternalLink />}>
          {korb ? 'Zum Warenkorb' : 'Im Shop einlösen'}
        </Hb>
        {onZurueck && (
          <button className="knopf" onClick={() => onZurueck(c)}>
            <Undo2 /> {korb ? 'Zurücknehmen' : 'Zurückgeben'}
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
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zurueck, setZurueck] = useState<Code | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;

  const { points, program: p, history, codes } = data;
  const offen = codes.filter((c) => c.status === 'active' || c.status === 'creating');
  const imKorb = offen.filter((c) => c.source === 'cart');
  const alteCodes = offen.filter((c) => c.source !== 'cart');
  const frueher = codes.filter((c) => c.status !== 'active' && c.status !== 'creating');
  const warenkorb = `${me.shop_url.replace(/\/$/, '')}/cart`;
  const reicht = points.balance >= p.redeem_points;

  function aktualisieren(pts: Points, code: Code) {
    setData((d) => (d ? { ...d, points: pts, codes: [code, ...d.codes.filter((c) => c.id !== code.id)] } : d));
    void reload();
    void reloadMe();
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
        <p>Du löst deine Punkte direkt im Warenkorb des Shops ein. Der Rabatt steht sofort drin, ohne Code zum Abtippen.</p>
      </Seitenkopf>

      {!p.active && <Hinweis>Das Einlösen ist gerade pausiert. Deine Punkte bleiben natürlich erhalten.</Hinweis>}
      <AktionBanner p={p} />
      {points.expiring && (
        <Hinweis>
          {punkteWort(points.expiring.points)} ({euro(points.expiring.cents)}) verfallen am {datum(points.expiring.at, true)}. Löse sie vorher im Warenkorb ein, dann gehen sie nicht verloren.
        </Hinweis>
      )}
      {points.balance < 0 && <Hinweis>Nach einer Rückgabe liegt dein Konto bei {punkteWort(points.balance)}. Neue Punkte gleichen das zuerst aus.</Hinweis>}

      <section className="karte einloesen-karte">
        <div className="karte-kopf">
          <h2>
            {punkte(points.balance)} <em style={{ color: 'var(--em)' }}>{points.balance === 1 ? 'Punkt' : 'Punkte'}</em>
          </h2>
          {points.held > 0 && (
            <span className="unterwegs">
              <Lock className="icon-klein" aria-hidden="true" /> {punkte(points.held)} gesperrt
              {points.unlocks[0] && !points.unlocks[0].payment ? `, ab ${datum(points.unlocks[0].at)} einlösbar` : ''}
            </span>
          )}
        </div>
        <p className="einloesen-wert">
          {reicht ? (
            <>
              Das sind <b>{euro(points.value_cents)}</b> Rabatt{points.value_cents > p.max_cents ? `, je Bestellung bis zu ${euro(p.max_cents)}` : ''}.
            </>
          ) : (
            <>Einlösen kannst du ab {punkteWort(p.redeem_points)}. Noch {punkteWort(Math.max(0, p.redeem_points - points.balance))}.</>
          )}
        </p>
        <ol className="schritte">
          <li>
            <b>Im Shop anmelden</b>
            <p>Mit derselben E-Mail wie hier im Club.</p>
          </li>
          <li>
            <b>Punkte wählen</b>
            <p>
              Im Warenkorb in {p.redeem_points}er-Schritten oder alle auf einmal, höchstens {euro(p.max_cents)} und nie mehr als der Warenwert.
            </p>
          </li>
          <li>
            <b>Einlösen tippen</b>
            <p>Der Rabatt steht sofort im Warenkorb und an der Kasse.</p>
          </li>
        </ol>
        <div className="code-reihe">
          <Hb dunkel href={warenkorb} icon={<ShoppingBag />} disabled={!p.active}>
            Zum Warenkorb
          </Hb>
        </div>
        <p className="klein leise">{warenkorbText(p)}</p>
      </section>

      {imKorb.length > 0 && (
        <section className="raster">
          <h2 className="karte-titel">Gerade im Warenkorb</h2>
          <div className="raster raster-2">
            {imKorb.map((c) => (
              <CodeKarte key={c.id} c={c} onZurueck={c.status === 'active' && !me.preview ? setZurueck : undefined} />
            ))}
          </div>
        </section>
      )}

      {alteCodes.length > 0 && (
        <section className="raster">
          <h2 className="karte-titel">{alteCodes.length === 1 ? 'Dein offener Code' : 'Deine offenen Codes'}</h2>
          <p className="klein leise">Früher in der App erstellt. Sie bleiben gültig, bis sie ablaufen.</p>
          <div className="raster raster-2">
            {alteCodes.map((c) => (
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

      <div id="wert">
        <WertTabelle p={p} aktuell={data.tier?.key} />
      </div>

      <PunkteFragen p={p} tier={data.tier} />

      <SoFunktionierts p={p} rate={data.tier?.rate} />

      {zurueck && (
        <Dialog
          titel={zurueck.source === 'cart' ? 'Aus dem Warenkorb zurücknehmen?' : 'Code zurückgeben?'}
          onClose={() => !busy && setZurueck(null)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setZurueck(null)} disabled={busy}>
                Behalten
              </button>
              <Hb klein dunkel busy={busy} onClick={() => void zurueckgeben()} icon={<Undo2 />}>
                {zurueck.source === 'cart' ? 'Zurücknehmen' : 'Zurückgeben'}
              </Hb>
            </>
          }
        >
          <p>
            {zurueck.source === 'cart'
              ? `Die ${punkteWort(zurueck.points)} gehen zurück auf dein Konto. Der Rabatt verschwindet aus dem Warenkorb.`
              : `Die ${punkteWort(zurueck.points)} gehen zurück auf dein Konto. Der Code ${zurueck.code} ist danach ungültig.`}
          </p>
          {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        </Dialog>
      )}
    </>
  );
}
