import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { LayoutDashboard, LogOut, Settings, Users } from 'lucide-react';
import { api, ApiError, fehlertext } from '../../lib/api';
import { useTitel } from '../../lib/hooks';
import type { Admin } from '../../lib/types';
import { Duenen, Hb, Hinweis, Laden, Seitenkopf, Toaster } from '../../components/ui';
import { Logo } from '../../components/Shell';
import Dashboard from './Dashboard';
import { Mitglied, Mitglieder } from './Mitglieder';
import Einstellungen from './Einstellungen';

export default function AdminApp() {
  const [admin, setAdmin] = useState<Admin | null | 'laden'>('laden');
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      setAdmin((await api<{ admin: Admin }>('GET', '/admin/me')).admin);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAdmin(null);
      else setFehler(fehlertext(e));
    }
  }, []);
  useEffect(() => {
    void laden();
  }, [laden]);

  if (admin === 'laden') {
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
  if (!admin) return <AdminLogin onLogin={setAdmin} />;

  async function abmelden() {
    try {
      await api('POST', '/admin/logout');
    } finally {
      setAdmin(null);
    }
  }

  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo to="/admin" zusatz="Admin" />
        <div className="kopf-rechts">
          <button className="knopf" onClick={() => void abmelden()} aria-label="Abmelden" title={`Abmelden (${admin.email})`}>
            <LogOut />
          </button>
        </div>
      </header>
      <div className="dock-rand rand glas">
        <nav className="dock" aria-label="Admin-Menü" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <NavLink to="/admin" end>
            <LayoutDashboard /> Übersicht
          </NavLink>
          <NavLink to="/admin/mitglieder">
            <Users /> Mitglieder
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
            <Route path="einstellungen" element={<Einstellungen />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </main>
      <Toaster />
    </>
  );
}

function AdminLogin({ onLogin }: { onLogin: (a: Admin) => void }) {
  useTitel('Admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      onLogin((await api<{ admin: Admin }>('POST', '/admin/login', { email, password })).admin);
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
          <Seitenkopf label="Für das Team" titel={<>Club <em>Admin</em></>} />
          <form className="karte formular" onSubmit={absenden}>
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
