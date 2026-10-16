import { api } from './api';

/**
 * Abmelden in der App. Danach geht es immer zurück auf die Startseite der App (app.perfumecloud.de),
 * nicht auf eine Seite von Shopify.
 */
export async function abmelden(): Promise<void> {
  try {
    await api('POST', '/auth/logout');
  } catch {
    /* Sitzung ist trotzdem beendet oder war es schon */
  }
  window.location.replace('/');
}
