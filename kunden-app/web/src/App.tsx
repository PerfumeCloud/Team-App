import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { api, ApiError, fehlertext, vorschauBeenden, vorschauId } from './lib/api';
import { KundeCtx, StatusCtx } from './lib/kontext';
import type { Me, OrdersResponse, Status } from './lib/types';
import { Duenen, Hinweis, Laden } from './components/ui';
import { KundenShell } from './components/Shell';
import Anmelden from './pages/Anmelden';
import Willkommen from './pages/Willkommen';
import Uebersicht from './pages/Uebersicht';
import { Bestellung, Bestellungen } from './pages/Bestellungen';
import Praemien from './pages/Praemien';
import Konto from './pages/Konto';
import Feedback from './pages/Feedback';
import { VorschauLeiste } from './components/Club';
import Einrichtung from './pages/Einrichtung';
import AdminApp from './pages/admin/AdminApp';

export default function App() {
  return (
    <BrowserRouter>
      <StatusGate />
    </BrowserRouter>
  );
}

/** Lädt einmal den Zustand der App; solange sie nicht eingerichtet ist, geht alles zur Einrichtung. */
function StatusGate() {
  const [status, setStatus] = useState<Status | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const { pathname } = useLocation();

  const laden = useCallback(async () => {
    try {
      setStatus(await api<Status>('GET', '/status'));
      setFehler(null);
    } catch (e) {
      setFehler(fehlertext(e));
    }
  }, []);
  useEffect(() => {
    void laden();
  }, [laden]);

  if (fehler && !status) {
    return (
      <>
        <Duenen />
        <main className="app">
          <div className="app-innen">
            <Hinweis fehler>
              {fehler}{' '}
              <button className="textlink" onClick={() => void laden()}>
                Nochmal versuchen
              </button>
            </Hinweis>
          </div>
        </main>
      </>
    );
  }
  if (!status) {
    return (
      <>
        <Duenen />
        <Laden />
      </>
    );
  }
  if (!status.installed && pathname !== '/einrichtung') {
    return <Navigate to="/einrichtung" replace />;
  }
  return (
    <StatusCtx.Provider value={status}>
      <Routes>
        <Route path="/einrichtung" element={status.installed ? <Navigate to="/admin" replace /> : <Einrichtung />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/*" element={<KundenApp status={status} />} />
      </Routes>
    </StatusCtx.Provider>
  );
}

function KundenApp({ status }: { status: Status }) {
  const [me, setMe] = useState<Me | null | 'laden'>('laden');
  const [fehler, setFehler] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const { pathname, search } = useLocation();

  const reloadMe = useCallback(async () => {
    try {
      const neu = await api<Me>('GET', '/me');
      // Kundenansicht abgelaufen (keine Admin-Sitzung mehr): Merker entfernen
      if (vorschauId() && !neu.preview) {
        try {
          sessionStorage.removeItem('pc-als');
        } catch {
          /* egal */
        }
      }
      setMe(neu);
      setFehler(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Kundenansicht ohne gültige Admin-Sitzung: zurück in den Admin-Bereich
        if (vorschauId()) {
          vorschauBeenden('/admin/anmelden');
          return;
        }
        setMe(null);
        setOrders(null);
      } else {
        setFehler(fehlertext(e));
      }
    }
  }, []);
  useEffect(() => {
    void reloadMe();
  }, [reloadMe]);

  const loadOrders = useCallback(async (fresh = false) => {
    setOrdersLoading(true);
    try {
      setOrders(await api<OrdersResponse>('GET', '/orders' + (fresh ? '?fresh=1' : '')));
      setOrdersError(null);
    } catch (e) {
      setOrdersError(fehlertext(e));
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  if (me === 'laden') {
    if (fehler) {
      return (
        <KundenShell shopUrl={status.shop_url ?? '/'} ohneDock>
          <Hinweis fehler>
            {fehler}{' '}
            <button className="textlink" onClick={() => void reloadMe()}>
              Nochmal versuchen
            </button>
          </Hinweis>
        </KundenShell>
      );
    }
    return (
      <>
        <Duenen />
        <Laden />
      </>
    );
  }

  // Abgemeldet: nur die Startseite mit der Anmeldung
  if (me === null) {
    return (
      <Routes>
        <Route path="/anmelden" element={<Anmelden onLogin={setMe} />} />
        <Route path="*" element={<Navigate to={pathname === '/' ? '/anmelden' : `/anmelden?next=${encodeURIComponent(pathname + search)}`} replace />} />
      </Routes>
    );
  }

  const ctx = { me, setMe, reloadMe, orders, ordersLoading, ordersError, loadOrders };

  // Angemeldet, aber noch nicht beigetreten
  if (!me.member.joined_at) {
    return (
      <KundeCtx.Provider value={ctx}>
        <Routes>
          <Route path="/willkommen" element={<Willkommen />} />
          <Route path="*" element={<Navigate to="/willkommen" replace />} />
        </Routes>
      </KundeCtx.Provider>
    );
  }

  return (
    <KundeCtx.Provider value={ctx}>
      {me.preview && <VorschauLeiste name={[me.member.first_name, me.member.last_name].filter(Boolean).join(' ') || me.member.email} />}
      <KundenShell shopUrl={me.shop_url}>
        <Routes>
          <Route path="/" element={<Uebersicht />} />
          <Route path="/bestellungen" element={<Bestellungen />} />
          <Route path="/bestellungen/:id" element={<Bestellung />} />
          <Route path="/praemien" element={<Praemien />} />
          <Route path="/konto" element={<Konto />} />
          <Route path="/feedback" element={<Feedback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </KundenShell>
    </KundeCtx.Provider>
  );
}
