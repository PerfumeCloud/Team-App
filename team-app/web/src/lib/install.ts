import { useEffect, useReducer } from 'react';
import { isIos, isStandalone } from './push';

/**
 * App installieren: Edge, Chrome und Android melden einmal kurz nach dem Laden, dass die Seite
 * installierbar ist. Das fangen wir hier sofort ab (Modul wird in main.tsx geladen), damit ein
 * „App installieren“-Knopf auch auf später geladenen Seiten funktioniert.
 */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  emit();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  installed = true;
  emit();
});

export function useInstall() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => void listeners.delete(rerender);
  }, []);
  return {
    canPrompt: deferred !== null,
    installed,
    /** Zeigt den Installieren-Dialog des Browsers. true = installiert. */
    async prompt(): Promise<boolean> {
      const p = deferred;
      if (!p) return false;
      deferred = null;
      await p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === 'accepted') installed = true;
      emit();
      return outcome === 'accepted';
    },
  };
}

export type Platform = 'installed' | 'ios' | 'android' | 'mac-safari' | 'desktop' | 'firefox' | 'other';

export function platform(): Platform {
  const ua = navigator.userAgent;
  if (isStandalone()) return 'installed';
  if (isIos()) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/firefox\//i.test(ua)) return 'firefox';
  if (/chrome\/|chromium\/|edg\//i.test(ua)) return 'desktop';
  if (/macintosh/i.test(ua) && /safari\//i.test(ua)) return 'mac-safari';
  return 'other';
}

/** Auf dem iPhone in Safari (und nicht in Chrome, Gmail, Instagram usw.)? */
export const iosSafari = () => !/crios|fxios|edgios|opios|gsa\/|fban|fbav|instagram|line\//i.test(navigator.userAgent);

export const isEdge = () => /edg\//i.test(navigator.userAgent);

export const installUrl = () => `${window.location.origin}/app`;
