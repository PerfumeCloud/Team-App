/**
 * Links zu anderen Seiten (Shop, Shopify-Admin, Instagram, Sendungsverfolgung …) öffnen immer in einem neuen Tab.
 * So verlässt man die installierte App auf dem Handy und am Computer nie. Interne Links und Anmeldungen
 * (/api/…, z. B. „Instagram verbinden“) bleiben im selben Fenster, damit die Rückkehr in die App klappt.
 */
export function externeLinksImNeuenTab(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    let url: URL;
    try {
      url = new URL(a.href, window.location.href);
    } catch {
      return;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin === window.location.origin) return;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
}
