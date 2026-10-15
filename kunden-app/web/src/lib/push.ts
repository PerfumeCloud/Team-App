import { api } from './api';
import type { PushState } from './types';

/** Kann dieses Gerät überhaupt Push empfangen? */
export function pushMoeglich(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function istIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Als App vom Home-Bildschirm geöffnet (auf dem iPhone nur dann gibt es Push) */
export function alsApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function erlaubnis(): NotificationPermission | 'nicht-moeglich' {
  return pushMoeglich() ? Notification.permission : 'nicht-moeglich';
}

/** Der Service Worker wird beim Start registriert (main.tsx); hier nur darauf warten. */
async function registrierung(): Promise<ServiceWorkerRegistration> {
  const vorhanden = await navigator.serviceWorker.getRegistration('/');
  if (vorhanden?.active) return vorhanden;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, nein) => setTimeout(() => nein(new Error('Die App lädt noch. Bitte versuche es in ein paar Sekunden noch einmal.')), 10000)),
  ]);
}

/** Ist auf diesem Gerät ein Abo aktiv? */
export async function aboAufGeraet(): Promise<PushSubscription | null> {
  if (!pushMoeglich()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Mitteilungen einschalten: Erlaubnis holen, beim Browser abonnieren, beim Server anmelden. */
export async function pushEinschalten(): Promise<PushState> {
  if (!pushMoeglich()) {
    throw new Error(istIos() && !alsApp() ? 'Auf dem iPhone gehen Mitteilungen nur, wenn du die App zum Home-Bildschirm hinzufügst.' : 'Dieser Browser kann keine Mitteilungen empfangen.');
  }
  const p = await Notification.requestPermission();
  if (p !== 'granted') {
    throw new Error(p === 'denied' ? 'Mitteilungen sind blockiert. Erlaube sie in den Einstellungen deines Geräts für diese App.' : 'Ohne Erlaubnis können wir dir keine Mitteilungen schicken.');
  }
  const reg = await registrierung();
  const { key } = await api<{ key: string }>('GET', '/push/key');
  let sub = await reg.pushManager.getSubscription();
  // Ein altes Abo mit anderem Schlüssel ersetzen
  if (sub) {
    const alt = sub.options.applicationServerKey;
    const neu = bytes(key);
    const gleich = alt && new Uint8Array(alt).length === neu.length && new Uint8Array(alt).every((b, i) => b === neu[i]);
    if (!gleich) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) });
  return api<PushState>('POST', '/push/subscribe', sub.toJSON());
}

export async function pushAusschalten(): Promise<PushState | null> {
  const sub = await aboAufGeraet();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  return api<PushState>('POST', '/push/unsubscribe', { endpoint });
}
