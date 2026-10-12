import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router';
import { AppShell } from './components/AppShell';
import { Logo, Spinner, Toasts } from './components/ui';
import { useStore } from './lib/store';
import Home from './pages/Home';
import { Login, Setup } from './pages/Auth';

const Tasks = lazy(() => import('./pages/Tasks'));
const Notes = lazy(() => import('./pages/Notes'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Statistics = lazy(() => import('./pages/Statistics'));
const Settings = lazy(() => import('./pages/Settings'));

const SYNC_MS = 4000;

/** Hält die Daten aktuell: regelmäßig, beim Zurückkehren in die App und wenn das Netz zurückkommt. */
function SyncLoop() {
  const sync = useStore((s) => s.sync);
  const navigate = useNavigate();
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

  if (phase === 'boot') return <Splash />;
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
                <Route path="/notizen" element={<Notes />} />
                <Route path="/notizen/:id" element={<Notes />} />
                <Route path="/postfach" element={<Inbox />} />
                <Route path="/statistik" element={<Statistics />} />
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
