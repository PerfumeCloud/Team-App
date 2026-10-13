import { Package } from 'lucide-react';
import { Link } from 'react-router';
import { useTitel } from '../lib/hooks';
import { euro, punkteWort } from '../lib/format';
import { Hb, Hinweis, Leer, PunkteKarte, Seitenkopf } from '../components/ui';
import { BestellungKarte, useBestellungen } from './Bestellungen';
import { CodeKarte } from './Praemien';

function gruss(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h >= 18) return 'Guten Abend';
  return 'Hallo';
}

export default function Uebersicht() {
  useTitel('Übersicht');
  const { me, orders, ordersLoading, ordersError } = useBestellungen();
  const p = me.program;
  const points = me.points;
  const codes = me.codes ?? [];
  const name = me.member.first_name;
  const letzte = orders?.orders.slice(0, 2) ?? [];

  return (
    <>
      <Seitenkopf label={p.name} titel={name ? <>{gruss()}, <em>{name}</em></> : <>{gruss()}, <em>schön dich zu sehen</em></>} />

      {points && (
        <PunkteKarte points={points} program={p}>
          {points.value_cents > 0 && p.active ? (
            <Hb dunkel to="/praemien">
              {euro(points.value_cents)} einlösen
            </Hb>
          ) : (
            <Hb to="/praemien">Prämien ansehen</Hb>
          )}
        </PunkteKarte>
      )}

      {!p.active && <Hinweis>Das Einlösen ist gerade pausiert. Deine Punkte bleiben natürlich erhalten.</Hinweis>}

      {codes.length > 0 && (
        <section className="raster">
          <h2 className="karte-titel">{codes.length === 1 ? 'Dein offener Code' : 'Deine offenen Codes'}</h2>
          <div className="raster raster-2">
            {codes.map((c) => (
              <CodeKarte key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      <section className="raster">
        <div className="karte-kopf">
          <h2 className="karte-titel">{letzte.length > 1 ? 'Deine letzten Bestellungen' : 'Deine letzte Bestellung'}</h2>
          {letzte.length > 0 && (
            <Link className="klein" to="/bestellungen">
              Alle ansehen
            </Link>
          )}
        </div>
        {ordersError && <Hinweis fehler>{ordersError}</Hinweis>}
        {!orders && ordersLoading && <div className="skelett" />}
        {orders && letzte.length === 0 && (
          <div className="karte">
            <Leer icon={<Package />} titel="Noch keine Bestellung">
              <p>Für jeden Euro deiner ersten Bestellung bekommst du {punkteWort(p.earn_per_euro)}.</p>
              <Hb href={me.shop_url}>Zum Shop</Hb>
            </Leer>
          </div>
        )}
        {letzte.length > 0 && (
          <div className="raster raster-2">
            {letzte.map((o) => (
              <BestellungKarte key={o.id} o={o} />
            ))}
          </div>
        )}
      </section>

      <section className="raster">
        <h2 className="karte-titel">So funktioniert’s</h2>
        <ol className="schritte">
          <li>
            <b>Bestellen</b>
            <p>Für jeden Euro Warenwert bekommst du {punkteWort(p.earn_per_euro)}.</p>
          </li>
          <li>
            <b>Sammeln</b>
            <p>
              {p.wait_days > 0
                ? `Deine Punkte kommen ${p.wait_days} Tage nach dem Versand auf dein Konto, so lange läuft die Rückgabefrist.`
                : 'Deine Punkte kommen nach dem Versand auf dein Konto.'}
            </p>
          </li>
          <li>
            <b>Einlösen</b>
            <p>
              Je {punkteWort(p.redeem_points)} gibt es {euro(p.redeem_cents)} Rabatt, als Code für deinen nächsten Einkauf.
            </p>
          </li>
        </ol>
      </section>
    </>
  );
}
