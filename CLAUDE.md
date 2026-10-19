# Perfume Cloud – Hinweise für Claude

Drei Oberflächen: Shopify-Theme (`kunden-app/shopify-theme/`, ausgeliefert als ZIP), Club-App (`kunden-app/web/`, React/Vite)
und Team-App (`team-app/web/`, React/Vite/Tailwind). Server jeweils unter `*/server/` (PHP).

## Skills automatisch laden

- **`ui-ux-pro-max`**: vor jeder Änderung an Oberfläche, Layout, Komponenten, Farben, Schrift, Formularen oder
  Interaktion in einer der drei Oberflächen laden (Skill-Tool, ohne dass jemand danach fragt). Seine Daten nur als
  Prüfliste und Nachschlagewerk nutzen; Marke und Design-Regeln unten gehen vor.
- **`gsap-core`**: laden, sobald eine Änderung Bewegung, Übergänge oder Animation betrifft. In der Club-App zusätzlich
  **`gsap-react`** (`useGSAP`, Aufräumen beim Verlassen). GSAP ist nur in der Club-App installiert (`gsap`, `@gsap/react`).
  Im Theme und in der Team-App reichen CSS-Übergänge; GSAP dort nur nach Rückfrage (zusätzliches JavaScript).
- Bei Animation immer `prefers-reduced-motion` beachten (`gsap.matchMedia()` bzw. Media Query): ohne Bewegung muss
  alles genauso funktionieren.

## Design-Regeln (gehen jedem Skill vor)

- Farben bleiben; nur minimal abdunkeln, wenn der Kontrast es verlangt, und das dann nennen.
- Firmenname nur in seinen Schriften (Castoro Marke / Tenor Sans Marke). Sonst Inter und Cormorant Garamond, gerade Ziffern.
- Ruhig, nicht auffällig: keine Effekte, die von selbst laufen und Aufmerksamkeit ziehen (Glitzer, Lichtschweife,
  wandernde Verläufe). Bewegung nur als Antwort auf eine Handlung (öffnen, bestätigen) oder als ein einziger,
  kurzer Moment.
- Bilder hochauflösend, mit festen Maßen gegen Springen.
- Wenig Budget: keine großzügigen Rabatte, Gewinn hoch halten.

## Arbeitsweise

- Live-Theme in Shopify nie ändern; Theme als neue ZIP liefern, die unveröffentlicht hochgeladen wird.
- Nach Oberflächen-Änderungen: bauen (`npm run build`), Tests (`node --test kunden-app/server/tests/*.test.mjs`,
  `node --test team-app/server/tests/backend.test.mjs`), axe und Breiten von 320 bis 2560 px prüfen.
- Neue JS/TS-Dateien mit prettier `--single-quote --print-width 160 --trailing-comma all`; bestehende Dateien von Hand im
  vorhandenen Stil bearbeiten.
- Zugangsdaten nie ins Repo oder in den Chat, nur in die Formulare der Apps oder GitHub Secrets.
- Nichts an Kunden, Warteliste oder Instagram ohne ausdrückliche Freigabe.
