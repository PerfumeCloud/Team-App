/* Perfume Cloud Club im Shop.
   Rechnet die voraussichtlichen Punkte für Warenkorb und Produkte und hält sie aktuell, wenn sich der Warenkorb ändert.
   Regeln aus dem Shop-Metafeld club.programm (pflegt die Club-App), Stufe und Kontostand aus den Kunden-Metafeldern.
   Rechnung wie in der Club-App: abrunden(Warenwert in Euro × Punkte je Euro der Stufe × Aktionsfaktor). */
(() => {
  const quelle = document.getElementById('club-daten');
  if (!quelle) return;
  let daten;
  try {
    daten = JSON.parse(quelle.textContent);
  } catch {
    return;
  }
  const prog = daten.programm;
  if (!prog) return; // Club noch nicht mit dem Shop verbunden

  const zahl = (n) => Number(n).toLocaleString('de-DE');
  const komma = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  const wort = (n) => (n === 1 ? 'Punkt' : 'Punkte');
  const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const euro = (cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',')) + ' €';

  function stufe() {
    if (!prog.tiers_enabled || !Array.isArray(prog.tiers) || prog.tiers.length === 0) return null;
    const key = daten.mitglied && daten.stufe ? daten.stufe : 'bronze';
    return prog.tiers.find((t) => t.key === key) || prog.tiers[0];
  }

  function satz() {
    const t = stufe();
    return Number(t ? t.rate : prog.rate) || 0;
  }

  /** Laufende Aktion mit dem höchsten Faktor (wie in der Club-App) */
  function aktion() {
    const jetzt = Date.now();
    let beste = null;
    for (const a of prog.promos || []) {
      const beginn = Date.parse(a.start);
      const ende = Date.parse(a.end);
      if (beginn <= jetzt && jetzt < ende && Number(a.factor) > (beste ? Number(beste.factor) : 1)) beste = a;
    }
    return beste;
  }

  function punkteFuer(cents) {
    const a = aktion();
    return Math.floor((Math.max(0, cents) * satz() * (a ? Number(a.factor) : 1)) / 100 + 1e-9);
  }

  function zeile(modus, cents) {
    const p = punkteFuer(cents);
    const was = modus === 'produkt' ? 'diesem Duft' : 'dieser Bestellung';
    const satzTeil = daten.mitglied ? `Mit ${was} sammelst du` : `Im Club sammelst du mit ${was}`;
    const unter = [];
    const a = aktion();
    if (a) unter.push(`<span class="club-punkte-aktion">${komma(a.factor)}×</span> ${html(a.name)}`);
    if (daten.mitglied) {
      const t = stufe();
      const r = satz();
      unter.push(`${t ? `${html(t.name)}: ` : ''}${komma(r)} ${r === 1 ? 'Punkt' : 'Punkte'} je Euro`);
      // Reicht es nach dieser Bestellung für eine Prämie?
      const stand = Number(daten.punkte) || 0;
      const schwelle = Number(prog.redeem_points) || 0;
      if (modus === 'warenkorb' && schwelle > 0 && stand < schwelle && stand + p >= schwelle) {
        unter.push(`danach reicht es für ${euro(Number(prog.redeem_cents) || 0)} Rabatt`);
      }
    } else {
      const bonus = Number(prog.welcome_points) || 0;
      unter.push(`<a href="${html(prog.app_url || 'https://app.perfumecloud.de')}">Kostenlos beitreten</a>${bonus > 0 ? `, dazu ${zahl(bonus)} Punkte Willkommensbonus` : ''}`);
    }
    return { punkte: p, html: `<p>${satzTeil} <b>${zahl(p)} ${wort(p)}</b>.</p><p class="club-punkte-unter">${unter.join(' · ')}</p>` };
  }

  let warenkorb = Number(daten.warenkorb) || 0;

  function zeichnen() {
    document.querySelectorAll('[data-club-punkte]').forEach((el) => {
      const modus = el.dataset.clubPunkte;
      if (modus === 'kopf') {
        const plus = el.querySelector('[data-club-plus]');
        const p = punkteFuer(warenkorb);
        if (plus) {
          plus.hidden = p <= 0;
          plus.textContent = `+${zahl(p)}`;
        }
        const stand = el.querySelector('[data-club-stand]');
        if (stand) stand.textContent = zahl(Number(daten.punkte) || 0);
        el.setAttribute('aria-label', daten.mitglied
          ? `Perfume Cloud Club: ${zahl(Number(daten.punkte) || 0)} Punkte${p > 0 ? `, mit deinem Warenkorb ${zahl(p)} dazu` : ''}`
          : `Mit deinem Warenkorb sammelst du im Club ${zahl(p)} Punkte`);
        if (!daten.mitglied) el.hidden = p <= 0;
        return;
      }
      const cents = modus === 'warenkorb' ? warenkorb : Number(el.dataset.cents) || 0;
      const z = zeile(modus, cents);
      el.hidden = z.punkte <= 0;
      const text = el.querySelector('[data-club-text]');
      if (text && text.innerHTML !== z.html) text.innerHTML = z.html;
    });
  }

  // ---------- Warenkorb beobachten ----------

  let laden = null;
  function warenkorbNeu() {
    clearTimeout(laden);
    laden = setTimeout(async () => {
      try {
        const r = await fetch(`${window.Shopify?.routes?.root || '/'}cart.js`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) return;
        const c = await r.json();
        warenkorb = Number(c.total_price) || 0;
        zeichnen();
      } catch {
        /* offline: alte Anzeige bleibt */
      }
    }, 120);
  }

  // Jede Warenkorb-Änderung per fetch (eigene und die von Apps) löst eine Neuberechnung aus
  const WARENKORB = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;
  const original = window.fetch;
  window.fetch = function (eingabe, init) {
    const antwort = original.apply(this, arguments);
    try {
      const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
      if (WARENKORB.test(new URL(url, location.href).pathname)) antwort.then(warenkorbNeu, () => {});
    } catch {
      /* nichts */
    }
    return antwort;
  };
  ['cart:updated', 'cart:refresh', 'cart:change', 'club:warenkorb'].forEach((n) => document.addEventListener(n, warenkorbNeu));
  // Zurück-Taste (bfcache): Warenkorb kann sich in einem anderen Tab geändert haben
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) warenkorbNeu();
  });

  // ---------- Produktpreis beobachten ----------

  document.addEventListener('club:preis', (e) => {
    const cents = Number(e.detail && e.detail.cents);
    if (!Number.isFinite(cents)) return;
    document.querySelectorAll('[data-club-punkte="produkt"]').forEach((el) => (el.dataset.cents = String(cents)));
  });
  new MutationObserver(zeichnen).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-cents'] });

  // ---------- Warenkorb-Seite: Menge ändern ohne Neuladen ----------

  document.addEventListener('click', async (e) => {
    const knopf = e.target instanceof Element ? e.target.closest('[data-menge]') : null;
    if (!knopf) return;
    const bereich = knopf.closest('[data-warenkorb]');
    if (!bereich) return;
    e.preventDefault();
    bereich.setAttribute('aria-busy', 'true');
    try {
      await fetch(`${window.Shopify?.routes?.root || '/'}cart/change.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ line: Number(knopf.dataset.zeile), quantity: Number(knopf.dataset.menge) }),
      });
      const r = await fetch(`${location.pathname}?section_id=${encodeURIComponent(bereich.dataset.warenkorb)}`, { credentials: 'same-origin' });
      if (r.ok) {
        const neu = new DOMParser().parseFromString(await r.text(), 'text/html').querySelector('[data-warenkorb]');
        if (neu) bereich.replaceWith(neu);
        zeichnen();
        (neu || document).querySelector('[data-warenkorb-status]')?.focus?.();
      } else {
        location.reload();
      }
    } catch {
      location.reload();
    } finally {
      bereich.removeAttribute('aria-busy');
    }
  });

  zeichnen();
})();
