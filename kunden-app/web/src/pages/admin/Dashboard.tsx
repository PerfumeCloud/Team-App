import { useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datumZeit, euro, kurzdatum, punkte, seit } from '../../lib/format';
import { aktionText, bis } from '../../lib/regeln';
import type { Dashboard as DashboardDaten } from '../../lib/types';
import { Hb, Hinweis, Laden, Seitenkopf } from '../../components/ui';

export function Kennzahl({ wert, titel, unten }: { wert: string; titel: string; unten?: string }) {
  return (
    <div className="kennzahl">
      <span className="label">{titel}</span>
      <b>{wert}</b>
      {unten && <small>{unten}</small>}
    </div>
  );
}

const SCHRITTE: Record<string, string> = {
  orders: 'Bestellungen',
  deliveries: 'Sendungen',
  released: 'Punkte',
  codes: 'Codes',
  expiry: 'Verfall',
  tiers: 'Stufen',
  birthdays: 'Geburtstage',
  newsletter: 'Newsletter',
  promotions: 'Aktionen',
  broadcasts: 'Nachrichten',
  invites: 'Einladungen',
  push: 'Push',
  survey_track: 'Zustellungen (Befragung)',
  surveys: 'Befragungen',
  survey_cleanup: 'Alte Befragungen',
  referrals: 'Empfehlungen',
  referral_codes: 'Empfehlungscodes',
  metafields: 'Metafelder',
  shop: 'Regeln im Shop',
  cleanup: 'Aufräumen',
};

const STUFEN_FARBE: Record<string, string> = { bronze: 'var(--wood)', silber: 'var(--tea)', gold: 'var(--amber)' };
const MONAT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Stufen als gestapelter Balken mit Legende (Zahl immer dabei, nicht nur Farbe) */
function StufenVerteilung({ tiers, gesamt }: { tiers: DashboardDaten['tiers']; gesamt: number }) {
  return (
    <div className="raster" style={{ gap: '.7rem' }}>
      <div className="verteilung" role="img" aria-label={tiers.map((t) => `${t.name}: ${t.count}`).join(', ')}>
        {tiers.map((t) =>
          t.count > 0 ? <span key={t.key} title={`${t.name}: ${t.count}`} style={{ flexGrow: t.count, background: STUFEN_FARBE[t.key] ?? 'var(--carbon)' }} /> : null,
        )}
        {gesamt === 0 && <span style={{ flexGrow: 1, background: 'var(--carbon)' }} />}
      </div>
      <ul className="legende">
        {tiers.map((t) => (
          <li key={t.key}>
            <i style={{ background: STUFEN_FARBE[t.key] ?? 'var(--carbon)', boxShadow: t.key === 'silber' ? 'inset 0 0 0 1px rgba(35,33,32,.3)' : undefined }} />
            {t.name} <b style={{ fontWeight: 400 }}>{punkte(t.count)}</b>
            <span className="leise">{gesamt > 0 ? `${Math.round((t.count / gesamt) * 100)} %` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Beitritte({ monate }: { monate: DashboardDaten['joins_by_month'] }) {
  const max = Math.max(1, ...monate.map((m) => m.count));
  return (
    <div>
      <div className="saeulen" role="img" aria-label={`Beitritte je Monat: ${monate.map((m) => `${m.month} ${m.count}`).join(', ')}`}>
        {monate.map((m) => (
          <span key={m.month} title={`${MONAT[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}: ${m.count}`} style={{ height: `${(m.count / max) * 100}%` }} />
        ))}
      </div>
      <div className="saeulen-achse" aria-hidden="true">
        {monate.map((m) => (
          <span key={m.month}>{MONAT[Number(m.month.slice(5)) - 1]}</span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  useTitel('Admin');
  const { data, error, reload } = useLoad<DashboardDaten>('/admin/dashboard');
  const [busy, setBusy] = useState(false);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const offen = data.checklist.filter((c) => !c.ok);
  const codes = data.codes;
  const pts = data.points;
  const fb = data.feedback;
  const fbGesamt = fb.gut + fb.neutral + fb.schlecht;
  const boni = Object.entries(data.bonus).sort((a, b) => b[1].points - a[1].points);

  async function abgleichen() {
    setBusy(true);
    try {
      await api('POST', '/admin/sync');
      toast('Abgleich erledigt');
      await reload();
    } catch (e) {
      toast(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Seitenkopf label="Admin" titel={<>Club-<em>Übersicht</em></>} />

      {data.promotion && (
        <div className="aktion" role="status">
          <span className="live" aria-hidden="true" />
          <p>
            <b>{data.promotion.name}</b> läuft: {aktionText(data.promotion)} bis {bis(data.promotion.ends_at)}. <Link to="/admin/aktionen">Ansehen</Link>
          </p>
        </div>
      )}
      {!data.promotion && data.next_promotion && (
        <p className="klein leise">
          Nächste Aktion: {data.next_promotion.name} ab {kurzdatum(data.next_promotion.starts_at)} ({aktionText(data.next_promotion)}).
        </p>
      )}
      {data.open_claims > 0 && (
        <Hinweis>
          {data.open_claims === 1 ? 'Eine Bewertung wartet' : `${data.open_claims} Bewertungen warten`} auf deine Bestätigung. <Link to="/admin/aktionen/anfragen">Jetzt prüfen</Link>
        </Hinweis>
      )}

      {offen.length > 0 && (
        <section className="karte">
          <div className="karte-kopf">
            <h2>Noch einzurichten</h2>
            <Hb klein dunkel to="/admin/einstellungen">
              Einstellungen
            </Hb>
          </div>
          {data.checklist.map((c) => (
            <p key={c.key} className={`check ${c.ok ? 'ok' : 'nein'}`}>
              {c.ok ? <CircleCheck /> : <CircleX />} {c.label}
            </p>
          ))}
        </section>
      )}

      <div className="kennzahlen">
        <Kennzahl titel="Mitglieder" wert={punkte(data.members)} unten={`+${punkte(data.new_30)} in 30 Tagen · +${punkte(data.new_7)} in 7`} />
        <Kennzahl titel="Aktiv" wert={punkte(data.active_30)} unten="in den letzten 30 Tagen in der App" />
        <Kennzahl titel="Push" wert={punkte(data.push_members)} unten={`Mitglieder mit Mitteilungen · ${data.push.devices} Geräte`} />
        <Kennzahl titel="Club-Umsatz" wert={euro(data.orders.revenue_cents)} unten={`${punkte(data.orders.count)} Bestellungen · ${euro(data.orders_30.revenue_cents)} in 30 Tagen`} />
      </div>

      <section className="raster raster-2">
        <div className="karte">
          <h2 className="karte-titel">Stufen</h2>
          <StufenVerteilung tiers={data.tiers} gesamt={data.members} />
        </div>
        <div className="karte">
          <h2 className="karte-titel">Beitritte der letzten 12 Monate</h2>
          <Beitritte monate={data.joins_by_month} />
        </div>
      </section>

      <h2 className="karte-titel">Punkte</h2>
      <div className="kennzahlen">
        <Kennzahl titel="Gesammelt" wert={punkte(pts.earned)} unten={`+${punkte(pts.earned_30)} in 30 Tagen`} />
        <Kennzahl titel="Eingelöst" wert={punkte(pts.redeemed)} unten={`${punkte(pts.redeemed_30)} in 30 Tagen`} />
        <Kennzahl titel="Offen" wert={punkte(pts.available)} unten={`≙ ${euro(pts.available_value_cents)} Rabatt`} />
        <Kennzahl titel="Unterwegs" wert={punkte(pts.pending + pts.locked)} unten={pts.locked > 0 ? `davon ${punkte(pts.locked)} Startbonus o. Ä.` : 'noch in der Rückgabefrist'} />
        <Kennzahl titel="Verfallen" wert={punkte(pts.expired)} unten="nach Ablauf der Frist" />
        <Kennzahl titel="Prämien eingelöst" wert={punkte(codes.used?.count ?? 0)} unten={`${euro(codes.used?.cents ?? 0)} · ${data.codes_used_30.count} in 30 Tagen`} />
        <Kennzahl titel="Codes offen" wert={punkte(codes.active?.count ?? 0)} unten={euro(codes.active?.cents ?? 0)} />
        <Kennzahl titel="Codes abgelaufen" wert={punkte(codes.expired?.count ?? 0)} unten={`${punkte(codes.cancelled?.count ?? 0)} zurückgegeben`} />
      </div>

      <section className="raster raster-2">
        <div className="karte">
          <h2 className="karte-titel">Bonuspunkte</h2>
          {boni.length === 0 ? (
            <p className="leise klein">Noch keine Boni vergeben.</p>
          ) : (
            <ul className="tabelle">
              {boni.map(([k, b]) => (
                <li key={k}>
                  <span>
                    {b.title} <small className="leise">· {punkte(b.count)}×</small>
                  </span>
                  <span className="rechts">{punkte(b.points)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="karte">
          <div className="karte-kopf">
            <h2 className="karte-titel">Feedback (90 Tage)</h2>
            <Link className="klein" to="/admin/aktionen/feedback">
              Alle Antworten
            </Link>
          </div>
          {fbGesamt === 0 ? (
            <p className="leise klein">Noch kein Feedback.</p>
          ) : (
            <ul className="tabelle">
              {(['gut', 'neutral', 'schlecht'] as const).map((k) => (
                <li key={k}>
                  <span>{k === 'gut' ? 'Gut' : k === 'neutral' ? 'Neutral' : 'Schlecht'}</span>
                  <span className="rechts">
                    {punkte(fb[k])} <small className="leise">· {Math.round((fb[k] / fbGesamt) * 100)} %</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="karte">
        <div className="karte-kopf">
          <h2>Abgleich mit Shopify</h2>
          <button className="knopf knopf-klein" onClick={() => void abgleichen()} disabled={busy}>
            <RefreshCw /> {busy ? 'Läuft …' : 'Jetzt abgleichen'}
          </button>
        </div>
        {data.jobs ? (
          <>
            <p className={`check ${data.jobs.ok ? 'ok' : 'nein'}`}>
              {data.jobs.ok ? <CircleCheck /> : <CircleX />} Zuletzt {seit(data.jobs.at)} ({datumZeit(data.jobs.at)}) ·{' '}
              {data.jobs.trigger === 'cron' ? 'Cronjob' : data.jobs.trigger === 'admin' ? 'von Hand' : 'beim Öffnen der App'}
            </p>
            <details className="mehr">
              <summary>Einzelne Schritte</summary>
              <ul className="tabelle">
                {Object.entries(data.jobs.summary)
                  .filter(([k]) => SCHRITTE[k])
                  .map(([k, v]) => (
                    <li key={k}>
                      <span>{SCHRITTE[k]}</span>
                      <span className="rechts leise klein">{String(v)}</span>
                    </li>
                  ))}
              </ul>
            </details>
            {data.jobs.errors.map((e, i) => (
              <Hinweis fehler key={i}>
                {e}
              </Hinweis>
            ))}
          </>
        ) : (
          <p className="leise">Noch kein Abgleich gelaufen.</p>
        )}
        {data.shop_program && (
          <p className={`check ${data.shop_program.ok ? 'ok' : 'nein'}`}>
            {data.shop_program.ok ? <CircleCheck /> : <CircleX />} Regeln im Shop: {data.shop_program.message} ({seit(data.shop_program.at)})
          </p>
        )}
        <p className="klein leise">
          Cronjob zuletzt: {seit(data.cron_last_run)}. Er gleicht alle 15 Minuten Bestellungen ab, schreibt Punkte gut, verschickt Mitteilungen und lässt abgelaufene Codes und Punkte verfallen.{' '}
          <Link to="/admin/einstellungen/system">Einrichten</Link>
        </p>
      </section>
    </>
  );
}
