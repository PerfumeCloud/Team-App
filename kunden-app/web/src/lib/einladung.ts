/* Einladung eines Freundes: Der Link (…/?einladung=CODE) kann auf jeder Seite landen.
   Wir merken uns den Code 30 Tage, bis zum Beitritt – auch über die Anmeldung bei Shopify hinweg. */
const KEY = 'pc-einladung';
const TAGE = 30;

export function einladungMerken(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('einladung');
    if (code && /^[A-Za-z0-9-]{3,20}$/.test(code)) {
      localStorage.setItem(KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
    }
  } catch {
    /* ohne Speicher geht es auch: dann zählt die Einladung nur, wenn der Link direkt zum Beitritt führt */
  }
}

export function einladung(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code: string; at: number };
    if (Date.now() - at > TAGE * 86400000) {
      localStorage.removeItem(KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function einladungVergessen(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
}

export function einladungsLink(code: string): string {
  return `${window.location.origin}/?einladung=${encodeURIComponent(code)}`;
}
