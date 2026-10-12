import { useEffect, useState } from 'react';

/** Aktuelle Zeit, aktualisiert sich jede Minute (für „vor 5 Min.“). */
export function useNow(intervalMs = 60000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const useIsDesktop = () => useMedia('(min-width: 1024px)');

/** Ruft fn verzögert auf, solange sich value ändert (Autosave). */
export function useDebounced<T>(value: T, delay: number, fn: (v: T) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => fn(value), delay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay, enabled]);
}
