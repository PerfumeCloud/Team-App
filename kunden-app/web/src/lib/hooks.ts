import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fehlertext } from './api';

/** Lädt einen GET-Endpunkt; reload() lädt neu, ohne den alten Stand zu verwerfen. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const aktuell = useRef(path);
  aktuell.current = path;

  const reload = useCallback(
    async () => {
      if (!path) return;
      setLoading(true);
      try {
        const d = await api<T>('GET', path);
        if (aktuell.current === path) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (aktuell.current === path) setError(fehlertext(e));
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

export function useTitel(titel: string): void {
  useEffect(() => {
    document.title = titel ? `${titel} · Perfume Cloud Club` : 'Perfume Cloud Club';
  }, [titel]);
}

export async function kopieren(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Ältere Browser: über ein unsichtbares Feld
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    t.remove();
    return ok;
  }
}
