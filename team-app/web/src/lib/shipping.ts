/** Versanddienst an der Sendungsnummer erkennen – gleiche Regeln wie Shipping::guessCarrier auf dem Server. */
export function guessCarrier(number: string): string | null {
  const n = number.replace(/[\s-]/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'UPS';
  if (/^(JJD\d{10,}|JVGL\d+|00340\d{15}|\d{12}|\d{20})$/.test(n)) return 'DHL';
  if (/^[A-Z]{2}\d{9}DE$/.test(n)) return 'Deutsche Post (DE)';
  if (/^(H\d{10,19}|\d{16})$/.test(n)) return 'Hermes';
  if (/^0\d{13}$/.test(n)) return 'DPD';
  if (/^\d{11}$/.test(n)) return 'GLS';
  return null;
}

/** Eindeutige Muster – beim Scannen ohne Rückfrage übernehmen. */
export function isStrongMatch(number: string): boolean {
  return /^(JJD\d{10,}|00340\d{15}|1Z[0-9A-Z]{16}|[A-Z]{2}\d{9}DE|H\d{10,19})$/.test(number);
}

/**
 * Aus dem Inhalt eines Barcodes mögliche Sendungsnummern machen.
 * DPD: „%“ + Postleitzahl + 14-stellige Paketnummer + Service-Code; QR-Codes enthalten oft einen Link mit der Nummer.
 */
export function trackingCandidates(raw: string): string[] {
  const out: string[] = [];
  const s = raw.trim();
  const url = s.match(/[?&#](?:piececode|idc|tracking[-_]?(?:number|id)|tracknum|parcel(?:number)?|match|trackingnumber)=([A-Za-z0-9]{6,40})/i);
  if (url) out.push(url[1].toUpperCase());
  if (/^%[0-9A-Z]{7}\d{14}/.test(s)) out.push(s.slice(8, 22));
  const plain = s.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-Z0-9]{6,40}$/.test(plain)) out.push(plain);
  return [...new Set(out)];
}
