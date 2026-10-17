/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Alle Seiten der App kommen aus dem Cache – die API (Punkte, Bestellungen, Anmeldung) nie.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Hintergrundbilder: nur die Größe, die das Gerät braucht, nach dem ersten Abruf aus dem Cache.
// Die Dateinamen tragen einen Hash, ein neuer Stand lädt also neue Dateien; alte fallen nach 12 Einträgen raus.
const BILDER = 'pc-bilder-1';
registerRoute(
  ({ request, url }) => request.destination === 'image' && url.origin === self.location.origin && url.pathname.startsWith('/assets/'),
  async ({ request }) => {
    const cache = await caches.open(BILDER);
    const da = await cache.match(request);
    if (da) return da;
    const antwort = await fetch(request);
    if (antwort.ok) {
      await cache.put(request, antwort.clone());
      const alle = await cache.keys();
      for (const alt of alle.slice(0, Math.max(0, alle.length - 12))) await cache.delete(alt);
    }
    return antwort;
  },
);

/* ---------- Push-Mitteilungen ---------- */

interface Nachricht {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let n: Nachricht = {};
  try {
    n = event.data?.json() ?? {};
  } catch {
    n = { body: event.data?.text() };
  }
  const title = n.title || 'Perfume Cloud Club';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: n.body ?? '',
      icon: '/brand/icon-192.png',
      badge: '/brand/favicon-32.png',
      tag: n.tag,
      data: { url: n.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = new URL((event.notification.data as { url?: string } | null)?.url || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Offenes Fenster der App nach vorne holen, sonst ein neues öffnen
      for (const c of fenster) {
        if (new URL(c.url).origin === ziel.origin && 'focus' in c) {
          await c.focus();
          if (ziel.origin === self.location.origin && 'navigate' in c) {
            await (c as WindowClient).navigate(ziel.href).catch(() => undefined);
          }
          return;
        }
      }
      await self.clients.openWindow(ziel.href);
    })(),
  );
});

// Der Browser hat das Abo erneuert (z. B. nach einem Update): neu anmelden, damit Nachrichten weiter ankommen
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { waitUntil: (p: Promise<unknown>) => void; oldSubscription?: PushSubscription | null };
  e.waitUntil(
    (async () => {
      const r = await fetch('/api/push/key', { credentials: 'same-origin' });
      if (!r.ok) return;
      const { key } = (await r.json()) as { key: string };
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-PC': '1' },
        body: JSON.stringify(sub.toJSON()),
      });
    })().catch(() => undefined),
  );
});

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
