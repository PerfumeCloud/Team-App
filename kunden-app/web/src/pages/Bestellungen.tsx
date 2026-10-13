import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ExternalLink, Package, RefreshCw, Sparkles, Truck } from 'lucide-react';
import { useKunde } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { datum, datumZeit, euro, punkteWort, seit } from '../lib/format';
import type { Order, OrderPoints, Program } from '../lib/types';
import { Chip, Hb, Hinweis, Laden, Leer, ProduktBild, Seitenkopf } from '../components/ui';

/** Bestellungen einmal laden, sobald eine Seite sie braucht */
export function useBestellungen() {
  const k = useKunde();
  const { orders, ordersLoading, loadOrders } = k;
  useEffect(() => {
    // nur beim ersten Anzeigen; danach lädt „Aktualisieren“ neu
    if (!orders && !ordersLoading) void loadOrders();
  }, []);
  return k;
}

export function Zeitleiste({ steps }: { steps: Order['steps'] }) {
  const jetzt = steps.findIndex((s) => !s.done);
  return (
    <ol className="zeitleiste" aria-label="Bestellstatus">
      {steps.map((s, i) => (
        <li key={s.key} className={s.done ? 'fertig' : i === jetzt ? 'jetzt' : undefined}>
          <span className="strich" aria-hidden="true" />
          <span>
            {s.label}
            <span className="sr">{s.done ? ' (erledigt)' : ' (offen)'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PunkteChip({ p }: { p: OrderPoints | null }) {
  if (!p || p.points <= 0) return null;
  if (p.status === 'available') {
    return (
      <span className="punkte-chip">
        <Sparkles /> +{punkteWort(p.points)}
      </span>
    );
  }
  if (p.status === 'pending') {
    return (
      <span className="punkte-chip unterwegs-chip">
        <Sparkles /> +{punkteWort(p.points)} unterwegs
      </span>
    );
  }
  return <span className="punkte-chip weg">{punkteWort(p.points)}</span>;
}

/** Ein Satz, wann und warum es Punkte gibt (oder nicht) */
export function punkteText(p: OrderPoints | null, prog: Program): string {
  if (!p) return 'Diese Bestellung liegt vor deinem Club-Beitritt und zählt deshalb nicht.';
  const n = punkteWort(p.points);
  if (p.status === 'available') return `${n} sind auf deinem Konto.`;
  if (p.status === 'pending') {
    if (p.reason === 'payment') return `${n} kommen, sobald deine Zahlung eingegangen ist.`;
    if (p.reason === 'shipping')
      return prog.wait_days > 0
        ? `${n} kommen ${prog.wait_days} Tage nach dem Versand auf dein Konto, wenn die Rückgabefrist vorbei ist.`
        : `${n} kommen auf dein Konto, sobald deine Bestellung versendet ist.`;
    return `${n} kommen am ${datum(p.available_at, true)} auf dein Konto, wenn die Rückgabefrist vorbei ist.`;
  }
  if (p.reason === 'cancelled') return 'Für stornierte Bestellungen gibt es keine Punkte.';
  if (p.reason === 'refunded') return 'Die Bestellung wurde erstattet, deshalb gibt es dafür keine Punkte.';
  if (p.reason === 'test') return 'Testbestellung, sie zählt nicht.';
  return 'Für diese Bestellung gibt es keine Punkte.';
}

export function BestellungKarte({ o }: { o: Order }) {
  const mehr = o.items.length - 4;
  return (
    <Link className="karte bestellung" to={`/bestellungen/${o.id}`} aria-label={`Bestellung ${o.name}, ${o.status.label}`}>
      <div className="bestellung-kopf">
        <p className="bestellung-nr">
          Bestellung {o.name}
          <small>
            {datum(o.date, true)} · {o.item_count} Artikel
          </small>
        </p>
        <Chip tone={o.status.tone}>{o.status.label}</Chip>
      </div>
      {o.items.length > 0 && (
        <div className="bilder">
          {o.items.slice(0, 4).map((it, i) => (
            <ProduktBild key={i} src={it.image} />
          ))}
          {mehr > 0 && <span className="mehr-bilder">+{mehr}</span>}
        </div>
      )}
      {o.steps.length > 0 && <Zeitleiste steps={o.steps} />}
      <div className="bestellung-fuss">
        <span>{euro(o.total_cents, o.currency)}</span>
        <PunkteChip p={o.points} />
      </div>
    </Link>
  );
}

export function Bestellungen() {
  useTitel('Bestellungen');
  const { me, orders, ordersLoading, ordersError, loadOrders } = useBestellungen();

  return (
    <>
      <Seitenkopf label="Bestellungen" titel={<>Deine <em>Bestellungen</em></>}>
        <p>Status, Sendungsverfolgung und Punkte zu jeder Bestellung.</p>
      </Seitenkopf>
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="knopf knopf-klein" onClick={() => void loadOrders(true)} disabled={ordersLoading}>
          <RefreshCw style={ordersLoading ? { animation: 'atmen 1s linear infinite' } : undefined} /> Aktualisieren
        </button>
        {orders && orders.fetched_at > 0 && <span className="winzig leise">Stand: {seit(orders.fetched_at)}</span>}
      </div>
      {ordersError && <Hinweis fehler>{ordersError}</Hinweis>}
      {orders?.error && <Hinweis>{orders.error}</Hinweis>}
      {!orders && ordersLoading && (
        <div className="raster">
          <div className="skelett" />
          <div className="skelett" />
        </div>
      )}
      {orders && orders.orders.length === 0 && (
        <div className="karte">
          <Leer icon={<Package />} titel="Noch keine Bestellungen">
            <p>Sobald du im Shop bestellst, siehst du hier, wo dein Paket gerade ist, und wie viele Punkte du dafür bekommst.</p>
            <Hb href={me.shop_url}>Zum Shop</Hb>
          </Leer>
        </div>
      )}
      {orders && orders.orders.length > 0 && (
        <div className="raster">
          {orders.orders.map((o) => (
            <BestellungKarte key={o.id} o={o} />
          ))}
        </div>
      )}
    </>
  );
}

export function Bestellung() {
  const { id } = useParams();
  const { me, orders, ordersLoading, ordersError } = useBestellungen();
  const o = orders?.orders.find((x) => x.id === id);
  useTitel(o ? `Bestellung ${o.name}` : 'Bestellung');

  if (!orders) {
    return ordersError ? <Hinweis fehler>{ordersError}</Hinweis> : <Laden />;
  }
  if (!o) {
    return (
      <div className="karte">
        <Leer icon={<Package />} titel="Bestellung nicht gefunden">
          <p>{ordersLoading ? 'Wird geladen …' : 'Vielleicht gehört sie zu einem anderen Kundenkonto.'}</p>
          <Hb to="/bestellungen">Alle Bestellungen</Hb>
        </Leer>
      </div>
    );
  }

  const nachVersand = o.steps.find((s) => s.key === 'shipped')?.done;

  return (
    <>
      <Seitenkopf zurueck={{ to: '/bestellungen', text: 'Alle Bestellungen' }} label={datum(o.date, true)} titel={<>Bestellung <em>{o.name}</em></>}>
        <div>
          <Chip tone={o.status.tone}>{o.status.label}</Chip>
        </div>
      </Seitenkopf>

      <div className="raster raster-2">
        <section className="karte">
          <div className="karte-kopf">
            <h2>Sendung</h2>
            <span className="symbol">
              <Truck />
            </span>
          </div>
          {o.cancelled ? (
            <p className="leise">Diese Bestellung wurde storniert.</p>
          ) : (
            <ol className="zeitleiste gross">
              {o.steps.map((s) => (
                <li key={s.key} className={s.done ? 'fertig' : undefined}>
                  <span className="knoten" aria-hidden="true" />
                  <span className="text">
                    {s.label}
                    <small>{s.done ? (s.at ? datumZeit(s.at) : 'erledigt') : s.key === 'delivered' && o.eta ? `voraussichtlich ${datum(o.eta, true)}` : 'noch offen'}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {o.tracking.map((t, i) => (
            <div className="sendung" key={i}>
              <div>
                <span className="label">{t.company || 'Sendungsnummer'}</span>
                <br />
                <b>{t.number || 'Link zur Sendung'}</b>
              </div>
              {t.url && (
                <Hb klein href={t.url} neuesFenster icon={<ExternalLink />}>
                  Sendung verfolgen
                </Hb>
              )}
            </div>
          ))}
          {!o.cancelled && o.tracking.length === 0 && (
            <p className="klein leise">{nachVersand ? 'Für diese Sendung gibt es keine Sendungsnummer.' : 'Sobald dein Paket unterwegs ist, findest du hier die Sendungsnummer.'}</p>
          )}
        </section>

        <section className="karte">
          <div className="karte-kopf">
            <h2>Punkte</h2>
            <span className="symbol">
              <Sparkles />
            </span>
          </div>
          {o.points && o.points.points > 0 && (
            <p className="stand" style={{ gap: '.4rem' }}>
              <b style={{ fontSize: 'clamp(2.6rem, 2rem + 3vw, 3.6rem)' }} className={o.points.status === 'void' ? 'leise' : undefined}>
                +{o.points.points}
              </b>
              <span>{o.points.status === 'available' ? 'gutgeschrieben' : o.points.status === 'pending' ? 'unterwegs' : 'verfallen'}</span>
            </p>
          )}
          <p>{punkteText(o.points, me.program)}</p>
          {o.points?.status === 'available' && (
            <div>
              <Hb klein to="/praemien">
                Punkte einlösen
              </Hb>
            </div>
          )}
        </section>
      </div>

      <section className="karte">
        <div className="karte-kopf">
          <h2>Artikel</h2>
          <span className="leise klein">{o.item_count} Stück</span>
        </div>
        <ul className="artikel">
          {o.items.map((it, i) => (
            <li key={i}>
              <ProduktBild src={it.image} />
              <span className="name">
                {it.title}
                <small>
                  {[it.variant, `${it.quantity} ×`].filter(Boolean).join(' · ')}
                </small>
              </span>
            </li>
          ))}
        </ul>
        <div className="bestellung-fuss" style={{ borderTop: '1px solid var(--linie)', paddingTop: '.9rem' }}>
          <span>Gesamt</span>
          <strong style={{ fontWeight: 400, fontSize: '1.25rem' }}>{euro(o.total_cents, o.currency)}</strong>
        </div>
        {o.status_url && (
          <div>
            <a className="knopf knopf-klein" href={o.status_url} target="_blank" rel="noopener">
              <ExternalLink /> Bestellung im Shop ansehen
            </a>
          </div>
        )}
      </section>
    </>
  );
}
