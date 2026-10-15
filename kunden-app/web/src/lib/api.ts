export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/* Kundenansicht für das Team: Admins sehen die App als ein bestimmtes Mitglied (nur ansehen).
   Gilt nur in diesem Tab (sessionStorage), damit niemand versehentlich darin hängen bleibt. */
const ALS = 'pc-als';

export function vorschauId(): string | null {
  try {
    return sessionStorage.getItem(ALS);
  } catch {
    return null;
  }
}

export function vorschauStarten(memberId: string): void {
  try {
    sessionStorage.setItem(ALS, memberId);
  } catch {
    /* ohne Speicher keine Vorschau */
  }
  window.location.href = '/';
}

export function vorschauBeenden(zurueck = '/admin'): void {
  try {
    sessionStorage.removeItem(ALS);
  } catch {
    /* egal */
  }
  window.location.href = zurueck;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const als = path.startsWith('/admin') ? null : vorschauId();
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Der Server nimmt schreibende Anfragen nur mit diesem Header an (Schutz gegen fremde Seiten)
        ...(method === 'GET' ? {} : { 'X-PC': '1' }),
        ...(als ? { 'X-Als': als } : {}),
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung. Bitte prüfe dein Internet.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* leer */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Fehler ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export function fehlertext(e: unknown): string {
  return e instanceof Error ? e.message : 'Da ist etwas schiefgelaufen.';
}
