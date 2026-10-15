/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Alle Seiten der App aus dem Cache – die API nie.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  badge?: number;
}

type BadgeNavigator = WorkerNavigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Perfume Cloud', body: event.data?.text() };
  }
  const nav = self.navigator as BadgeNavigator;
  const tasks: Promise<unknown>[] = [
    self.registration.showNotification(data.title ?? 'Perfume Cloud', {
      body: data.body ?? '',
      tag: data.tag,
      icon: '/brand/icon-192.png',
      badge: '/brand/badge-96.png',
      data: { url: data.url ?? '/' },
    }),
    self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((c) => c.postMessage({ type: 'sync' }))),
  ];
  if (typeof data.badge === 'number') {
    tasks.push((data.badge > 0 ? nav.setAppBadge?.(data.badge) : nav.clearAppBadge?.()) ?? Promise.resolve());
  }
  event.waitUntil(Promise.all(tasks).catch(() => undefined));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of list) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Der Browser hat das Abo erneuert (z. B. abgelaufen) → neues Abo beim Server speichern.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & { oldSubscription?: PushSubscription | null };
  e.waitUntil(
    (async () => {
      const res = await fetch('/api/push/key', { credentials: 'same-origin' });
      const { publicKey } = (await res.json()) as { publicKey: string };
      const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
      const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-PC': '1' },
        body: JSON.stringify(sub.toJSON()),
      });
    })().catch(() => undefined),
  );
});
