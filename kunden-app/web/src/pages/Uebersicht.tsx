import { Calculator, MessageCircleHeart, Package, Star } from 'lucide-react';
import { Link } from 'react-router';
import { useTitel } from '../lib/hooks';
import { euro, punkteWort } from '../lib/format';
import { boni, sammelText, wertText } from '../lib/regeln';
import { Hb, Hinweis, Leer, PunkteKarte, Seitenkopf } from '../components/ui';
import { BestellungKarte, useBestellungen } from './Bestellungen';
import { CodeKarte } from './Praemien';
import { AktionBanner, BoniListe, SoFunktionierts, StufenKarte } from '../components/Club';

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
  const tier = me.tier ?? null;
  // Extra-Punkte, die noch offen sind (Geburtstag nicht eingetragen, Newsletter fehlt …)
  const link = me.bonus?.referral.link;
  const offen = boni(p)
    .filter((b) => {
      if (b.key === 'welcome') return false;
      if (b.key === 'birthday') return !me.bonus?.birthday;
      if (b.key === 'newsletter') return !me.bonus?.newsletter;
      return true;
    })
    // Mit Empfehlungslink: Rabatt für Freunde, Punkte je Bestellung (statt Punkte beim Beitritt)
    .map((b) => (b.key === 'referral' && link ? { ...b, titel: 'Freunde einladen', text: `Mit deinem Link bekommen sie ${link.friend_text}, du ${link.reward_text}.` } : b));
  if (link && !offen.some((b) => b.key === 'referral')) {
    offen.push({ key: 'referral', titel: 'Freunde einladen', text: `Mit deinem Link bekommen sie ${link.friend_text}, du ${link.reward_text}.` });
  }

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

      {points && (
        <Link className="karte wert-kurz" to="/praemien#wert">
          <span className="symbol">
            <Calculator />
          </span>
          <p className="klein">
            {wertText(p, tier)} <span className="textlink">So rechnen wir</span>
          </p>
        </Link>
      )}

      <AktionBanner p={p} />

      {me.feedback && (
        <Link className="karte feedback-frage" to={`/feedback?anfrage=${me.feedback.id}`}>
          <span className="symbol">
            <MessageCircleHeart />
          </span>
          <div>
            <h2 className="karte-titel">{me.feedback.title}</h2>
            <p className="klein">{me.feedback.body}</p>
          </div>
        </Link>
      )}

      {me.survey?.open && (
        <Link className="karte feedback-frage" to={`/bewertung/${me.survey.open.token}`}>
          <span className="symbol">
            <Star />
          </span>
          <div>
            <h2 className="karte-titel">Wie gefällt dir {me.survey.open.title ?? 'deine Bestellung'}?</h2>
            <p className="klein">
              Ein Tipp auf die Sterne genügt{me.survey.open.points > 0 ? ` – als Dankeschön gibt es ${punkteWort(me.survey.open.points)}` : ''}.
            </p>
          </div>
        </Link>
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
              <p>{sammelText(p, tier?.rate)}</p>
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

      {tier && <StufenKarte tier={tier} p={p} points={points} />}

      {offen.length > 0 && (
        <section className="raster">
          <div className="karte-kopf">
            <h2 className="karte-titel">Extra-Punkte</h2>
            <Link className="klein" to="/konto#extra">
              Im Konto erledigen
            </Link>
          </div>
          <BoniListe items={offen} />
        </section>
      )}

      <SoFunktionierts p={p} rate={tier?.rate} />
    </>
  );
}
