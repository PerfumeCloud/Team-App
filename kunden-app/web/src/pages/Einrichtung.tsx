import { useState, type FormEvent } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useStatus } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { Duenen, Hb, Hinweis, Seitenkopf } from '../components/ui';
import { Logo } from '../components/Shell';

/** Einmalige Einrichtung: Datenbank verbinden, ersten Admin anlegen */
export default function Einrichtung() {
  useTitel('Einrichtung');
  const status = useStatus();
  const [treiber, setTreiber] = useState<'mysql' | 'sqlite'>('mysql');
  const [db, setDb] = useState({ host: 'mysqlf937.netcup.net', port: '3306', name: '', user: '', pass: '' });
  const [admin, setAdmin] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  // Nur der Treiber der gewählten Datenbank muss vorhanden sein
  const reqs = Object.entries(status.requirements ?? {})
    .filter(([k]) => status.configExists || k !== (treiber === 'mysql' ? 'pdo_sqlite' : 'pdo_mysql'))
    .map(([, r]) => r);
  const allesOk = reqs.every((r) => r.ok);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      await api('POST', '/setup', { db: treiber === 'sqlite' ? { driver: 'sqlite' } : { ...db, driver: 'mysql', port: Number(db.port) || 3306 }, admin });
      window.location.href = '/admin/einstellungen';
    } catch (err) {
      setFehler(fehlertext(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo to="/einrichtung" zusatz="Club" />
      </header>
      <main className="app" style={{ paddingBottom: '3rem' }}>
        <div className="app-innen" style={{ maxWidth: '44rem' }}>
          <Seitenkopf label="Einrichtung" titel={<>Club <em>einrichten</em></>}>
            <p>Einmalig: Datenbank verbinden und deinen Admin-Zugang anlegen. Danach verbindest du die App im Admin-Bereich mit Shopify.</p>
          </Seitenkopf>

          <section className="karte">
            <h2 className="karte-titel">Server</h2>
            {reqs.map((r) => (
              <p key={r.label} className={`check ${r.ok ? 'ok' : 'nein'}`}>
                {r.ok ? <CircleCheck /> : <CircleX />} {r.label}
              </p>
            ))}
            {!allesOk && <Hinweis fehler>Bitte zuerst die rot markierten Punkte in Plesk beheben (PHP-Einstellungen bzw. Dateirechte).</Hinweis>}
          </section>

          <form className="karte formular" onSubmit={absenden}>
            {!status.configExists && (
              <>
                <h2 className="karte-titel">Datenbank</h2>
                <div className="reiter" role="group" aria-label="Datenbank wählen">
                  {(['mysql', 'sqlite'] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={treiber === t} onClick={() => setTreiber(t)}>
                      {t === 'mysql' ? 'MySQL' : 'SQLite'}
                    </button>
                  ))}
                </div>
                {treiber === 'sqlite' ? (
                  <p className="klein leise">
                    Für Pakete mit nur einer MySQL-Datenbank (netcup Webhosting 1000), wenn die Team-App sie schon nutzt. Die Daten liegen dann in einer Datei im geschützten Ordner <code>storage</code>, nichts weiter einzutragen.
                  </p>
                ) : (
                  <>
                    <p className="klein leise">In Plesk unter „Datenbanken“ eine neue Datenbank anlegen (z. B. „club“) und die Zugangsdaten hier eintragen. Der Server steht dort bei der Datenbank, wie bei der Team-App (z. B. mysqlf937.netcup.net).</p>
                    <div className="formular-reihe">
                      <label className="feld">
                        <span>Server</span>
                        <input value={db.host} onChange={(e) => setDb({ ...db, host: e.target.value })} required />
                      </label>
                      <label className="feld">
                        <span>Port</span>
                        <input value={db.port} inputMode="numeric" onChange={(e) => setDb({ ...db, port: e.target.value })} />
                      </label>
                    </div>
                    <label className="feld">
                      <span>Name der Datenbank</span>
                      <input value={db.name} onChange={(e) => setDb({ ...db, name: e.target.value })} required />
                    </label>
                    <div className="formular-reihe">
                      <label className="feld">
                        <span>Benutzer</span>
                        <input value={db.user} autoComplete="off" onChange={(e) => setDb({ ...db, user: e.target.value })} required />
                      </label>
                      <label className="feld">
                        <span>Passwort</span>
                        <input type="password" value={db.pass} autoComplete="new-password" onChange={(e) => setDb({ ...db, pass: e.target.value })} />
                      </label>
                    </div>
                  </>
                )}
              </>
            )}

            <h2 className="karte-titel">Dein Admin-Zugang</h2>
            <label className="feld">
              <span>Name</span>
              <input value={admin.name} autoComplete="name" onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required />
            </label>
            <label className="feld">
              <span>E-Mail</span>
              <input type="email" value={admin.email} autoComplete="email" onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required />
            </label>
            <label className="feld">
              <span>Passwort</span>
              <input type="password" minLength={10} value={admin.password} autoComplete="new-password" onChange={(e) => setAdmin({ ...admin, password: e.target.value })} required />
              <small>Mindestens 10 Zeichen.</small>
            </label>
            {fehler && <Hinweis fehler>{fehler}</Hinweis>}
            <div>
              <Hb dunkel type="submit" busy={busy} disabled={!allesOk}>
                Einrichten
              </Hb>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
