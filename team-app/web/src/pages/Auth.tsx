import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Database, Download, KeyRound } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { User } from '../lib/types';
import { Button, cx, Logo, Segmented, Spinner } from '../components/ui';
import { isStandalone } from '../lib/push';

function AuthFrame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="safe-top flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className={cx('w-full', wide ? 'max-w-[520px]' : 'max-w-[400px]')}>
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 h-20 w-20" />
          <h1 className="font-display text-[38px] font-semibold leading-none text-ink">Perfume Cloud</h1>
          <p className="eyebrow mt-2.5">Team-App</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-bad/10 px-3.5 py-3 text-[14px] text-bad">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function Login() {
  const setSession = useStore((s) => s.setSession);
  const bootError = useStore((s) => s.bootError);
  const boot = useStore((s) => s.boot);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: User }>('POST', '/auth/login', { email, password });
      await setSession(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Keine Verbindung zum Server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      {bootError && (
        <div className="mb-4 space-y-3">
          <ErrorBox text={bootError} />
          <Button variant="secondary" className="w-full" onClick={() => void boot()}>
            Erneut versuchen
          </Button>
        </div>
      )}
      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="email">
            E-Mail
          </label>
          <input id="email" className="field" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw">
            Passwort
          </label>
          <input id="pw" className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <ErrorBox text={error} />}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Anmelden
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-ink-3">Passwort vergessen? Ein Admin kann es unter Einstellungen → Team neu setzen.</p>
      {!isStandalone() && (
        <p className="mt-4 text-center">
          <a href="/app" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline">
            <Download className="h-4 w-4" />
            Als App installieren
          </a>
        </p>
      )}
    </AuthFrame>
  );
}

/** Einladungslink aus der Mail: eigenes Passwort festlegen und direkt angemeldet sein. */
export function Invite({ token }: { token: string }) {
  const setSession = useStore((s) => s.setSession);
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string; email: string }>('GET', `/auth/invite?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Keine Verbindung zum Server.'));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.a !== pw.b) {
      setError('Die beiden Passwörter sind nicht gleich.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: User }>('POST', '/auth/invite', { token, password: pw.a });
      window.history.replaceState(null, '', '/');
      await setSession(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Keine Verbindung zum Server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      {!info && !error && (
        <div className="flex justify-center">
          <Spinner />
        </div>
      )}
      {!info && error && (
        <div className="card space-y-4 p-6">
          <ErrorBox text={error} />
          <Button className="w-full" variant="secondary" onClick={() => (window.location.href = '/')}>
            Zur Anmeldung
          </Button>
        </div>
      )}
      {info && (
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <p className="font-display text-[24px] font-semibold leading-tight text-ink">Willkommen, {info.name}!</p>
            <p className="mt-1 text-[14px] text-ink-2">Leg dein Passwort fest – danach bist du direkt angemeldet. Deine Anmeldung: {info.email}</p>
          </div>
          <div>
            <label className="label" htmlFor="pw1">
              Neues Passwort
            </label>
            <input id="pw1" className="field" type="password" autoComplete="new-password" minLength={8} required value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pw2">
              Passwort wiederholen
            </label>
            <input id="pw2" className="field" type="password" autoComplete="new-password" minLength={8} required value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
          </div>
          <input type="email" autoComplete="username" value={info.email} readOnly hidden />
          {error && <ErrorBox text={error} />}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Passwort speichern & loslegen
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function Setup() {
  const status = useStore((s) => s.status);
  const setSession = useStore((s) => s.setSession);
  const [driver, setDriver] = useState<'mysql' | 'sqlite'>('mysql');
  const [db, setDb] = useState({ host: 'mysqlf937.netcup.net', port: '3306', name: '', user: '', pass: '' });
  const [admin, setAdmin] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reqs = status?.requirements ? Object.values(status.requirements) : [];
  const dbFromConfig = status?.configExists;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ user: User }>('POST', '/setup', {
        db: { driver, ...db, port: Number(db.port) || 3306 },
        admin,
      });
      await setSession(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Keine Verbindung zum Server.');
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof typeof db>(k: K) => (e: ChangeEvent<HTMLInputElement>) => setDb({ ...db, [k]: e.target.value });

  return (
    <AuthFrame wide>
      <form onSubmit={submit} className="space-y-5">
        <div className="card p-6">
          <h2 className="font-display text-[26px] font-semibold text-ink">Willkommen!</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-2">
            Einmalige Einrichtung – danach meldet ihr euch nur noch an. Alles weitere (Team, Shopify, Postfächer) stellst du anschließend in den Einstellungen ein.
          </p>
          {reqs.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {reqs.map((r) => (
                <li key={r.label} className={cx('flex items-center gap-2 text-[13px]', r.ok ? 'text-ink-2' : 'text-bad')}>
                  {r.ok ? <CircleCheck className="h-4 w-4 text-good" /> : <CircleAlert className="h-4 w-4" />}
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!dbFromConfig && (
          <div className="card space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-accent" />
              <h3 className="section-title">1 · Datenbank</h3>
            </div>
            <Segmented
              value={driver}
              onChange={setDriver}
              className="w-full"
              options={[
                { value: 'mysql', label: 'MySQL (empfohlen)' },
                { value: 'sqlite', label: 'SQLite (ohne Einrichtung)' },
              ]}
            />
            {driver === 'mysql' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="label">Server</label>
                  <input className="field" value={db.host} onChange={set('host')} required />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="field" value={db.port} onChange={set('port')} inputMode="numeric" />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Datenbankname</label>
                  <input className="field" value={db.name} onChange={set('name')} required />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Benutzer</label>
                  <input className="field" value={db.user} onChange={set('user')} required autoComplete="off" />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Passwort</label>
                  <input className="field" type="password" value={db.pass} onChange={set('pass')} autoComplete="new-password" />
                </div>
                <p className="text-[13px] text-ink-3 sm:col-span-3">Bei netcup steht der Server im Webhosting-Panel unter „Domain-Einstellungen → MySQL-Server“ (z. B. mysqlf937.netcup.net).</p>
              </div>
            ) : (
              <p className="text-[14px] text-ink-2">Die Daten liegen in einer Datei im geschützten Ordner „storage“. Gut zum Ausprobieren – für den Alltag ist MySQL robuster.</p>
            )}
          </div>
        )}

        <div className="card space-y-4 p-6">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-accent" />
            <h3 className="section-title">{dbFromConfig ? 'Dein Admin-Konto' : '2 · Dein Admin-Konto'}</h3>
          </div>
          <div>
            <label className="label">Name</label>
            <input className="field" placeholder="Marius" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required autoComplete="name" />
          </div>
          <div>
            <label className="label">E-Mail</label>
            <input className="field" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required autoComplete="username" />
          </div>
          <div>
            <label className="label">Passwort (mind. 8 Zeichen)</label>
            <input
              className="field"
              type="password"
              minLength={8}
              value={admin.password}
              onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
              required
              autoComplete="new-password"
            />
          </div>
        </div>

        {error && <ErrorBox text={error} />}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          App einrichten
        </Button>
      </form>
    </AuthFrame>
  );
}
