export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Der Server nimmt schreibende Anfragen nur mit diesem Header an (Schutz gegen fremde Seiten)
        ...(method === 'GET' ? {} : { 'X-PC': '1' }),
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
