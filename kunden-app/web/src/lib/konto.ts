import { api } from './api';

/** Abmelden – bei Shopify-Anmeldung auch dort, damit niemand anderes auf dem Gerät weiter angemeldet bleibt. */
export async function abmelden(): Promise<void> {
  try {
    const r = await api<{ logout_url: string | null }>('POST', '/auth/logout');
    window.location.href = r.logout_url || '/anmelden';
  } catch {
    window.location.href = '/anmelden';
  }
}
