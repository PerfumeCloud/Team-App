import { api } from './api';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'subscribed' | 'off';

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'subscribed' : 'off';
}

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  await subscribe(await ready());
  return 'subscribed';
}

/** Wartet auf den Service Worker – höchstens 10 Sekunden (sonst hängt „Aktivieren“ für immer). */
async function ready(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    window.setTimeout(() => reject(new Error('Die App ist noch nicht fertig installiert. Bitte einmal komplett schließen, neu öffnen und nochmal versuchen.')), 10000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Abo anlegen (oder bei neuem Server-Schlüssel ersetzen) und beim Server speichern. */
async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const { publicKey } = await api<{ publicKey: string }>('GET', '/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const current = sub.options.applicationServerKey;
    const same = current && btoa(String.fromCharCode(...new Uint8Array(current))) === btoa(String.fromCharCode(...keyToBytes(publicKey)));
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api('POST', '/push/subscribe', sub.toJSON());
  return sub;
}

/**
 * Beim Start der App: Ist Push auf diesem Gerät an, das Abo beim Server auffrischen.
 * So kommt ein Gerät zurück, das der Server entfernt hat, und ein neuer Server-Schlüssel wird übernommen.
 */
export async function refreshPush(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || !(await reg.pushManager.getSubscription())) return;
  await subscribe(reg);
}

/** ID des Abos auf diesem Gerät (wie auf dem Server: SHA-256 der Push-Adresse) – oder null. */
export async function thisDeviceId(): Promise<string | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || !crypto.subtle) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
}
