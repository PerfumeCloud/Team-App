/* Perfume Cloud Club im Shop.
   Rechnet die voraussichtlichen Punkte für Warenkorb und Produkte und hält sie aktuell, wenn sich der Warenkorb ändert.
   Im Warenkorb löst es Punkte direkt ein (ab Club 1.4, über den App-Proxy /apps/club).
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

  // ---------- Warenkorb-Seite: Abschnitt neu laden, Menge ändern ohne Neuladen ----------

  const ROOT = window.Shopify?.routes?.root || '/';
  const JSON_KOPF = { 'Content-Type': 'application/json', Accept: 'application/json' };

  async function warenkorbHolen() {
    const r = await fetch(`${ROOT}cart.js`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('warenkorb');
    return r.json();
  }

  /** Lädt den Warenkorb-Abschnitt neu (Zeilen, Rabatte, Summe) und füllt das Einlösen wieder aus */
  async function abschnittNeu() {
    const bereich = document.querySelector('[data-warenkorb]');
    if (!bereich) return null;
    const r = await fetch(`${location.pathname}?section_id=${encodeURIComponent(bereich.dataset.warenkorb)}`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('abschnitt');
    const neu = new DOMParser().parseFromString(await r.text(), 'text/html').querySelector('[data-warenkorb]');
    if (neu) bereich.replaceWith(neu);
    zeichnen();
    einloesenZeigen();
    return neu;
  }

  document.addEventListener('click', async (e) => {
    const knopf = e.target instanceof Element ? e.target.closest('[data-menge]') : null;
    if (!knopf) return;
    const bereich = knopf.closest('[data-warenkorb]');
    if (!bereich) return;
    e.preventDefault();
    bereich.setAttribute('aria-busy', 'true');
    try {
      await fetch(`${ROOT}cart/change.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: JSON_KOPF,
        body: JSON.stringify({ line: Number(knopf.dataset.zeile), quantity: Number(knopf.dataset.menge) }),
      });
      const neu = await abschnittNeu();
      (neu || document).querySelector('[data-warenkorb-status]')?.focus?.();
      // Anderer Warenwert: neu fragen, wie viele Punkte passen und ob der Rabatt noch gilt
      einloesenLaden();
    } catch {
      location.reload();
    } finally {
      bereich.removeAttribute('aria-busy');
    }
  });

  // ---------- Warenkorb-Seite: Punkte direkt einlösen (ab Club 1.4) ----------
  // Der Shop leitet /apps/club/* an die Club-App weiter (App-Proxy) und sagt ihr, wer angemeldet ist.
  // Eingelöste Punkte werden ein einmaliger Rabatt nur für dieses Kundenkonto, den wir in den Warenkorb setzen.

  const PRAEFIX = 'CLUB-PUNKTE-';
  const MONATE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
  let stand = null; // letzte Antwort des Clubs
  let wahl = 0; // gewählte Punkte
  let aendern = false;
  let beschaeftigt = false;

  const box = () => document.querySelector('[data-club-einloesen]');
  const teil = (name) => box()?.querySelector(`[data-club-e-${name}]`);
  const tag = (iso) => {
    const [, m, t] = String(iso).split('-').map(Number);
    return `${t}. ${MONATE[m - 1]}`;
  };
  const bisText = (ms) => {
    const d = new Date(ms);
    const morgen = new Date();
    morgen.setDate(morgen.getDate() + 1);
    const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return `heute, ${uhr} Uhr`;
    if (d.toDateString() === morgen.toDateString()) return `morgen, ${uhr} Uhr`;
    return `${d.getDate()}. ${MONATE[d.getMonth()]}, ${uhr} Uhr`;
  };
  const wertVon = (p) => (stand ? Math.floor((p * stand.schritt_cents) / Math.max(1, stand.schritt_punkte)) : 0);

  async function club(pfad, body) {
    const basis = String(box()?.dataset.proxy || '/apps/club').replace(/^\/+|\/+$/g, '');
    const r = await fetch(`${ROOT}${basis}${pfad}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? JSON_KOPF : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let d = null;
    try {
      d = await r.json();
    } catch {
      /* keine JSON-Antwort: App-Proxy nicht eingerichtet oder der Club nicht erreichbar */
    }
    if (!r.ok || !d) {
      const f = new Error(d && d.error ? d.error : '');
      f.verbindung = !d || r.status >= 500;
      throw f;
    }
    return d;
  }

  function melden(text, art) {
    const el = teil('meldung');
    if (!el) return;
    el.hidden = !text;
    el.className = `club-einloesen-meldung${art === 'fehler' || art === 'verbindung' ? ' ist-fehler' : ''}`;
    el.textContent = text || '';
    if (art === 'verbindung') {
      const a = document.createElement('a');
      a.href = box()?.dataset.app || prog.app_url || 'https://app.perfumecloud.de';
      a.className = 'club-textlink';
      a.textContent = 'Club-App öffnen';
      el.append(' ', a);
    }
  }

  // Während einer Anfrage nimmt das Einlösen keine Klicks an (der Abschnitt kann dabei neu geladen werden)
  function beschaeftigtSetzen(an) {
    beschaeftigt = an;
    box()?.toggleAttribute('aria-busy', an);
  }

  const imWarenkorb = (c, code) => (c.discount_codes || []).find((d) => String(d.code).toUpperCase() === String(code).toUpperCase());

  /** Club-Rabatt in den Warenkorb setzen (code) oder herausnehmen (null). Fremde Rabattcodes bleiben drin. */
  async function codeSetzen(code) {
    let c = null;
    try {
      const alt = await warenkorbHolen();
      const fremde = (alt.discount_codes || []).map((d) => d.code).filter((k) => !String(k).toUpperCase().startsWith(PRAEFIX));
      const r = await fetch(`${ROOT}cart/update.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: JSON_KOPF,
        body: JSON.stringify({ discount: (code ? [...fremde, code] : fremde).join(',') }),
      });
      if (r.ok) c = await r.json();
    } catch {
      c = null;
    }
    if (code) {
      const drin = c && imWarenkorb(c, code);
      if (!drin) {
        // Ältere Warenkörbe kennen discount in cart/update.js nicht: einmal über den Rabatt-Link setzen
        const merk = `club-rabatt:${code}`;
        let schon = false;
        try {
          schon = sessionStorage.getItem(merk) === '1';
          sessionStorage.setItem(merk, '1');
        } catch {
          schon = true;
        }
        if (!schon) {
          location.href = `${ROOT}discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(`${ROOT}cart`)}`;
          return false;
        }
      }
      if (stand) stand.passt = drin ? drin.applicable !== false : false;
    }
    await abschnittNeu();
    return true;
  }

  async function einloesenLaden() {
    const b = box();
    if (!b) return;
    try {
      stand = await club(`/punkte?cents=${encodeURIComponent(b.dataset.cents || '0')}`);
    } catch (f) {
      stand = null;
      einloesenZeigen();
      melden(f.verbindung || !f.message ? 'Einlösen im Warenkorb ist gerade nicht erreichbar. Deine Punkte sind sicher.' : f.message, f.verbindung ? 'verbindung' : 'fehler');
      return;
    }
    if (stand.einloesung) {
      // Eingelöste Punkte gehören in den Warenkorb, auch nach dem Zurück von der Kasse oder auf einem anderen Gerät
      try {
        const drin = imWarenkorb(await warenkorbHolen(), stand.einloesung.code);
        if (!drin) {
          await codeSetzen(stand.einloesung.code);
          return;
        }
        stand.passt = drin.applicable !== false;
      } catch {
        /* Anzeige ohne Prüfung */
      }
    }
    einloesenZeigen();
  }

  function einloesenZeigen() {
    const b = box();
    if (!b) return;
    const wahlTeil = teil('wahl');
    const aktiv = teil('aktiv');
    const gesperrt = teil('gesperrt');
    if (!stand) {
      wahlTeil.hidden = aktiv.hidden = gesperrt.hidden = true;
      return;
    }
    if (stand.zustand !== 'mitglied') {
      wahlTeil.hidden = aktiv.hidden = gesperrt.hidden = true;
      b.hidden = stand.zustand === 'kein_mitglied';
      if (stand.zustand === 'gast') melden('Melde dich im Shop noch einmal an, dann kannst du hier einlösen.', 'fehler');
      return;
    }
    daten.punkte = stand.punkte;
    zeichnen();
    teil('stand').textContent = `${zahl(stand.punkte)} ${wort(stand.punkte)}${stand.wert_cents > 0 ? ` · ${euro(stand.wert_cents)}` : ''}`;

    const e = stand.einloesung;
    aktiv.hidden = !e;
    if (e) {
      teil('aktiv-punkte').textContent = `${zahl(e.punkte)} ${wort(e.punkte)}`;
      teil('aktiv-wert').textContent = `−${euro(e.wert_cents)}`;
      teil('aktiv-bis').textContent =
        stand.passt === false
          ? 'Der Rabatt passt gerade nicht zum Warenkorb, zum Beispiel weil der Warenwert jetzt niedriger ist. Wähle eine andere Menge oder nimm ihn zurück.'
          : `Reserviert bis ${bisText(e.bis)}. Bestellst du bis dahin nicht, sind die Punkte wieder auf deinem Konto.`;
      aktiv.classList.toggle('passt-nicht', stand.passt === false);
    }

    // Auswahl: in Schritten (z. B. 100 Punkte = 5 €), höchstens so viel, wie Konto und Warenkorb hergeben
    const schritt = Math.max(1, Number(stand.schritt_punkte) || 1);
    const oben = Math.floor(stand.max_punkte / schritt) * schritt;
    let hinweis = '';
    if (!stand.aktiv) hinweis = 'Einlösen ist gerade pausiert. Deine Punkte bleiben dir.';
    else if (stand.verfuegbar < schritt) hinweis = `Einlösen kannst du ab ${zahl(schritt)} Punkten.${stand.verfuegbar > 0 ? ` Dir fehlen noch ${zahl(schritt - stand.verfuegbar)}.` : ''}`;
    else if (oben < schritt) hinweis = `Für diesen Warenkorb reicht es noch nicht: ${zahl(schritt)} Punkte löst du ab ${euro(stand.schritt_cents)} Warenwert ein.`;
    const zeigen = !hinweis && (!e || aendern || stand.passt === false);
    wahlTeil.hidden = !zeigen;
    if (zeigen) {
      if (!wahl || wahl > oben || wahl % schritt) wahl = e && e.punkte <= oben && e.punkte % schritt === 0 ? e.punkte : oben;
      teil('punkte').textContent = zahl(wahl);
      teil('wert').textContent = euro(wertVon(wahl));
      wahlTeil.querySelector('[data-club-e-schritt="-1"]').disabled = wahl <= schritt;
      wahlTeil.querySelector('[data-club-e-schritt="1"]').disabled = wahl + schritt > oben;
      const alle = teil('alle');
      alle.hidden = stand.max_punkte <= oben;
      alle.textContent = `Alle ${zahl(stand.max_punkte)} = ${euro(wertVon(stand.max_punkte))}`;
      teil('los').textContent = e ? 'Übernehmen' : 'Einlösen';
    }
    teil('aendern').hidden = !!hinweis || stand.passt === false;
    teil('aendern').textContent = aendern ? 'Abbrechen' : 'Andere Menge';
    if (!e && hinweis) melden(hinweis);
    else if (!teil('meldung').classList.contains('ist-fehler')) melden('');

    // Noch gesperrte Punkte mit Datum
    const liste = Array.isArray(stand.freigaben) ? stand.freigaben : [];
    gesperrt.hidden = !(stand.gesperrt > 0 && liste.length);
    gesperrt.innerHTML = liste
      .map((f) => `<li>${zahl(f.punkte)} ${wort(f.punkte)} ${f.zahlung ? 'einlösbar nach der Zahlung' : f.ab ? `ab ${tag(f.ab)}` : 'bald'}</li>`)
      .join('');
    if (!gesperrt.hidden) gesperrt.insertAdjacentHTML('afterbegin', '<li class="club-label">Noch gesperrt</li>');
  }

  async function einloesen(alle) {
    if (beschaeftigt || !stand) return;
    beschaeftigtSetzen(true);
    melden('');
    try {
      const r = await club('/einloesen', { punkte: alle ? stand.max_punkte : wahl, alle: !!alle, cents: Number(box()?.dataset.cents) || 0 });
      stand = r;
      aendern = false;
      if (await codeSetzen(r.code)) melden(stand.passt === false ? '' : `${euro(r.einloesung.wert_cents)} Rabatt steht im Warenkorb.`);
    } catch (f) {
      melden(f.message || 'Das hat gerade nicht geklappt. Bitte versuch es noch einmal.', f.verbindung ? 'verbindung' : 'fehler');
    } finally {
      beschaeftigtSetzen(false);
    }
  }

  async function zuruecknehmen() {
    if (beschaeftigt) return;
    beschaeftigtSetzen(true);
    melden('');
    try {
      stand = await club('/zuruecknehmen', { cents: Number(box()?.dataset.cents) || 0 });
      aendern = false;
      wahl = 0;
      await codeSetzen(null);
      if (stand.zurueck) melden('Zurückgenommen. Die Punkte sind wieder auf deinem Konto.');
    } catch (f) {
      melden(f.message || 'Das hat gerade nicht geklappt. Bitte versuch es noch einmal.', f.verbindung ? 'verbindung' : 'fehler');
    } finally {
      beschaeftigtSetzen(false);
    }
  }

  document.addEventListener('click', (e) => {
    const k = e.target instanceof Element ? e.target.closest('[data-club-einloesen] button') : null;
    if (!k || k.disabled || beschaeftigt) return;
    if (k.dataset.clubESchritt && stand) {
      const schritt = Math.max(1, Number(stand.schritt_punkte) || 1);
      wahl = Math.max(schritt, wahl + Number(k.dataset.clubESchritt) * schritt);
      einloesenZeigen();
    } else if (k.hasAttribute('data-club-e-alle')) einloesen(true);
    else if (k.hasAttribute('data-club-e-los')) einloesen(false);
    else if (k.hasAttribute('data-club-e-zurueck')) zuruecknehmen();
    else if (k.hasAttribute('data-club-e-aendern')) {
      aendern = !aendern;
      einloesenZeigen();
    }
  });

  einloesenLaden();
  zeichnen();
})();
