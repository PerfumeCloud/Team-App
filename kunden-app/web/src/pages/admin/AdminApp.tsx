import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router';
import { BellRing, Eye, LayoutDashboard, LogOut, Megaphone, Settings, SquareArrowOutUpRight, Users } from 'lucide-react';
import { api, ApiError, fehlertext, vorschauStarten } from '../../lib/api';
import { useTitel } from '../../lib/hooks';
import type { AdminMe } from '../../lib/types';
import { Duenen, Hb, Hinweis, Laden, Seitenkopf, Toaster } from '../../components/ui';
import { Logo } from '../../components/Shell';
import Dashboard from './Dashboard';
import { Mitglied, Mitglieder } from './Mitglieder';
import Einstellungen from './Einstellungen';
import Aktionen from './Aktionen';
import PushSeite from './Push';

const AdminCtx = createContext<{ me: AdminMe; reload: () => Promise<void> } | null>(null);

export function useAdmin() {
  const c = useContext(AdminCtx);
  if (!c) throw new Error('Nicht angemeldet');
  return c;
}

export default function AdminApp() {
  const [me, setMe] = useState<AdminMe | null | 'laden'>('laden');
  const [fehler, setFehler] = useState<string | null>(null);
  const { pathname } = useLocation();

  const laden = useCallback(async () => {
    try {
      setMe(await api<AdminMe>('GET', '/admin/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setFehler(fehlertext(e));
    }
  }, []);
  useEffect(() => {
    void laden();
  }, [laden]);

  if (me === 'laden') {
    return (
      <>
        <Duenen />
        {fehler ? (
          <main className="app">
            <div className="app-innen">
              <Hinweis fehler>{fehler}</Hinweis>
            </div>
          </main>
        ) : (
          <Laden />
        )}
      </>
    );
  }
  if (!me) {
    return (
      <Routes>
        <Route path="anmelden" element={<AdminLogin onLogin={() => void laden()} />} />
        <Route path="*" element={<Navigate to="/admin/anmelden" replace />} />
      </Routes>
    );
  }
  if (pathname === '/admin/anmelden') return <Navigate to="/admin" replace />;

  async function abmelden() {
    try {
      await api('POST', '/admin/logout');
    } finally {
      setMe(null);
    }
  }

  return (
    <AdminCtx.Provider value={{ me, reload: laden }}>
      <Duenen />
      <header className="kopf">
        <Logo to="/admin" zusatz="Admin" />
        <div className="kopf-rechts">
          {me.team_url && (
            <a className="knopf kopf-text" href={me.team_url} title="Zur Team-App">
              <SquareArrowOutUpRight /> <span>Team-App</span>
            </a>
          )}
          <button
            className="knopf kopf-text"
            onClick={() => (me.own_member_id ? vorschauStarten(me.own_member_id) : (window.location.href = '/admin/mitglieder?ansicht=1'))}
            title="Die App so sehen, wie Mitglieder sie sehen"
          >
            <Eye /> <span>Kundenansicht</span>
          </button>
          <button className="knopf knopf-rund" onClick={() => void abmelden()} aria-label="Abmelden" title={`Abmelden (${me.admin.email})`}>
            <LogOut />
          </button>
        </div>
      </header>
      <div className="dock-rand rand glas admin-dock">
        <nav className="dock" aria-label="Admin-Menü">
          <NavLink to="/admin" end>
            <LayoutDashboard /> Übersicht
          </NavLink>
          <NavLink to="/admin/mitglieder">
            <Users /> Mitglieder
          </NavLink>
          <NavLink to="/admin/aktionen">
            <Megaphone /> Aktionen
            {me.open_claims > 0 && <span className="zaehler" aria-label={`${me.open_claims} offene Anfragen`}>{me.open_claims}</span>}
          </NavLink>
          <NavLink to="/admin/push">
            <BellRing /> Push
          </NavLink>
          <NavLink to="/admin/einstellungen">
            <Settings /> Einstellungen
          </NavLink>
        </nav>
      </div>
      <main className="app admin">
        <div className="app-innen">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="mitglieder" element={<Mitglieder />} />
            <Route path="mitglieder/:id" element={<Mitglied />} />
            <Route path="aktionen/*" element={<Aktionen />} />
            <Route path="push" element={<PushSeite />} />
            <Route path="einstellungen/*" element={<Einstellungen />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </main>
      <Toaster />
    </AdminCtx.Provider>
  );
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  useTitel('Admin');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(params.get('fehler'));

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      await api('POST', '/admin/login', { email, password });
      navigate('/admin', { replace: true });
      onLogin();
    } catch (err) {
      setFehler(fehlertext(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo to="/admin" zusatz="Admin" />
      </header>
      <main className="app" style={{ paddingBottom: '3rem' }}>
        <div className="app-innen" style={{ maxWidth: '30rem' }}>
          <Seitenkopf label="Für das Team" titel={<>Club <em>Admin</em></>}>
            <p>Am schnellsten geht es über die Team-App (Club → Admin-Bereich) oder mit deinem Shopify-Kundenkonto in der Club-App, wenn deine E-Mail dort als Admin eingetragen ist.</p>
          </Seitenkopf>
          <div className="code-reihe">
            <Hb dunkel live href="/api/auth/shopify/start?next=%2Fadmin">
              Mit Kundenkonto anmelden
            </Hb>
          </div>
          <form className="karte formular" onSubmit={absenden}>
            <h2 className="karte-titel">Mit Club-Zugang</h2>
            <label className="feld">
              <span>E-Mail</span>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="feld">
              <span>Passwort</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {fehler && <Hinweis fehler>{fehler}</Hinweis>}
            <div>
              <Hb dunkel type="submit" busy={busy}>
                Anmelden
              </Hb>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
