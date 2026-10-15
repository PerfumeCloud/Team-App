import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router';
import { AppShell } from './components/AppShell';
import { Logo, Spinner, Toasts } from './components/ui';
import { useStore } from './lib/store';
import Home from './pages/Home';
import { Invite, Login, Setup } from './pages/Auth';
import { isStandalone, refreshPush } from './lib/push';

const Tasks = lazy(() => import('./pages/Tasks'));
const Notes = lazy(() => import('./pages/Notes'));
const Ideas = lazy(() => import('./pages/Ideas'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Statistics = lazy(() => import('./pages/Statistics'));
const Settings = lazy(() => import('./pages/Settings'));
const Club = lazy(() => import('./pages/Club'));
const Install = lazy(() => import('./pages/Install'));
const Shipping = lazy(() => import('./pages/Shipping'));

const SYNC_MS = 4000;

/** Hält die Daten aktuell: regelmäßig, beim Zurückkehren in die App und wenn das Netz zurückkommt. */
function SyncLoop() {
  const sync = useStore((s) => s.sync);
  const navigate = useNavigate();
  useEffect(() => {
    // Push-Abo dieses Geräts beim Server auffrischen (falls es dort fehlt oder der Schlüssel neu ist)
    void refreshPush().catch(() => undefined);
  }, []);
  useEffect(() => {
    // Installierte App am Computer: Kurzbefehl (z. B. „Postfach“) bei schon offenem Fenster
    const queue = (window as Window & { launchQueue?: { setConsumer: (cb: (p: { targetURL?: string }) => void) => void } }).launchQueue;
    queue?.setConsumer(({ targetURL }) => {
      if (!targetURL) return;
      const path = new URL(targetURL).pathname;
      if (path !== '/' && path !== window.location.pathname) navigate(path);
    });
  }, [navigate]);
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && sync();
    const t = window.setInterval(tick, SYNC_MS);
    const onVisible = () => document.visibilityState === 'visible' && sync();
    const onOnline = () => sync();
    const onOffline = () => useStore.setState({ online: false });
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') navigate(e.data.url);
      if (e.data?.type === 'sync') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [sync, navigate]);
  return null;
}

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
      <Logo className="h-16 w-16 animate-pulse" />
    </div>
  );
}

export default function App() {
  const phase = useStore((s) => s.phase);
  const boot = useStore((s) => s.boot);
  useEffect(() => {
    void boot();
  }, [boot]);

  // Installations-Seite /app: ohne Anmeldung erreichbar; in der installierten App gleich zur Übersicht
  if (window.location.pathname === '/app') {
    if (!isStandalone()) {
      return (
        <Suspense fallback={<Splash />}>
          <Install />
        </Suspense>
      );
    }
    window.history.replaceState(null, '', '/');
  }
  if (phase === 'boot') return <Splash />;
  // Einladungslink aus der Mail: /?einladung=pci_…
  const invite = new URLSearchParams(window.location.search).get('einladung');
  if (invite) return <Invite token={invite} />;
  return (
    <BrowserRouter>
      {phase === 'setup' && <Setup />}
      {phase === 'login' && <Login />}
      {phase === 'ready' && (
        <>
          <SyncLoop />
          <AppShell>
            <Suspense
              fallback={
                <div className="flex justify-center py-24">
                  <Spinner />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/planung" element={<Tasks />} />
                <Route path="/planung/:id" element={<Tasks />} />
                <Route path="/ideen" element={<Ideas />} />
                <Route path="/kalender" element={<Calendar />} />
                <Route path="/notizen" element={<Notes />} />
                <Route path="/notizen/:id" element={<Notes />} />
                <Route path="/postfach" element={<Inbox />} />
                <Route path="/versand" element={<Shipping />} />
                <Route path="/statistik" element={<Statistics />} />
                <Route path="/club" element={<Club />} />
                <Route path="/club/:tab" element={<Club />} />
                <Route path="/einstellungen" element={<Settings />} />
                <Route path="/einstellungen/:tab" element={<Settings />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </AppShell>
        </>
      )}
      <Toasts />
    </BrowserRouter>
  );
}
