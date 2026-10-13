import { useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datumZeit, euro, punkte, seit } from '../../lib/format';
import type { Dashboard as DashboardDaten } from '../../lib/types';
import { Hb, Hinweis, Laden, Seitenkopf } from '../../components/ui';

function Kennzahl({ wert, titel, unten }: { wert: string; titel: string; unten?: string }) {
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
  released: 'Punkte',
  codes: 'Codes',
  metafields: 'Metafelder',
  cleanup: 'Aufräumen',
};

export default function Dashboard() {
  useTitel('Admin');
  const { data, error, reload } = useLoad<DashboardDaten>('/admin/dashboard');
  const [busy, setBusy] = useState(false);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const offen = data.checklist.filter((c) => !c.ok);
  const codes = data.codes;

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
        <Kennzahl titel="Mitglieder" wert={punkte(data.members)} unten={`+${punkte(data.new_30)} in 30 Tagen`} />
        <Kennzahl titel="Offene Punkte" wert={punkte(data.points_available)} unten={`≙ ${euro(data.points_value_cents)} Rabatt`} />
        <Kennzahl titel="Unterwegs" wert={punkte(data.points_pending)} unten="noch in der Rückgabefrist" />
        <Kennzahl titel="Club-Umsatz" wert={euro(data.club_revenue_cents)} unten={`${punkte(data.club_orders)} Bestellungen`} />
        <Kennzahl titel="Codes eingelöst" wert={punkte(codes.used?.count ?? 0)} unten={euro(codes.used?.cents ?? 0)} />
        <Kennzahl titel="Codes offen" wert={punkte(codes.active?.count ?? 0)} unten={euro(codes.active?.cents ?? 0)} />
        <Kennzahl titel="Abgelaufen" wert={punkte(codes.expired?.count ?? 0)} unten="Punkte zurückgebucht" />
        <Kennzahl titel="Zurückgegeben" wert={punkte(codes.cancelled?.count ?? 0)} unten="von Mitgliedern" />
      </div>

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
            {data.jobs.errors.map((e, i) => (
              <Hinweis fehler key={i}>
                {e}
              </Hinweis>
            ))}
          </>
        ) : (
          <p className="leise">Noch kein Abgleich gelaufen.</p>
        )}
        <p className="klein leise">
          Cronjob zuletzt: {seit(data.cron_last_run)}. Er gleicht alle 15 Minuten neue Bestellungen ab, schreibt Punkte gut und lässt abgelaufene Codes verfallen.{' '}
          <Link to="/admin/einstellungen">Einrichten</Link>
        </p>
      </section>
    </>
  );
}
