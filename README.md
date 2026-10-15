# Perfume Cloud · Apps

- **[Team-App](#team-app)** – die interne App für Marius, Ben und Keanu (`team.perfumecloud.de`)
- **[Kunden-App „Perfume Cloud Club“](#kunden-app-perfume-cloud-club)** – Treuepunkte und Bestellverfolgung für Kundinnen und Kunden (`app.perfumecloud.de`)

## Team-App

Web-App (PWA) für iPhone, Mac und Windows. Sie ist auf dem Home-Bildschirm installierbar, funktioniert offline und hält alle Geräte automatisch synchron.

- **Übersicht:** Umsatz heute, offener Versand, wichtige Mails, eigene Aufgaben, Team-Verlauf
- **Planung:** Aufgaben mit Zuständigkeit, Fälligkeit, Priorität, Kategorie, Checkliste und Kommentaren (Board am PC, Liste am Handy)
- **Notizen:** gemeinsame Pläne und Ideen mit Autosave
- **Ideen-Assistent:** Idee einfach hinschreiben oder diktieren – daraus werden Notiz, Aufgaben (mit Zuständigkeit, Datum, Priorität, Kategorie, Checkliste) und Termine (Uhrzeit, Zeitraum, Ort, Teilnehmer). Läuft ohne KI direkt in der App, kostenlos und offline
- **Kalender:** Termine, Meetings, Events und Fristen mit Erinnerung und Einladung per Push, Abo für die iPhone-/Outlook-Kalender-App, Feiertage je Bundesland und Shop-Aktionstage (Black Friday, Muttertag …) automatisch für jedes Jahr
- **Postfach:** beliebige Postfächer (info@, support@, persönliche) mit „Sichtbar für“ je Postfach, IMAP, nur lesend
- **Push bei Mails:** wenige Sekunden nach dem Eingang (Sofort-Abruf per IMAP IDLE, vom Cronjob jede Minute am Laufen gehalten), wählbar „Jede neue“, „Wirklich alle“ oder „Nur wichtige“ – immer nur an die Personen, die das Postfach sehen
- **Team:** Einladung per Mail mit Link zum Passwort-Festlegen, gelöschte Personen wiederherstellen, Wartung mit „Datenbank aktualisieren“ und Geräte-Status
- **Statistik:** Umsatz, Bestellungen, Ø Warenkorb, Artikel pro Bestellung, bester Tag, Stornos, Erstattungen, Top-Düfte, knapper Bestand – jeweils mit Veränderung in % (grün = besser, rot = schlechter) (Shopify Admin API)
- **Push-Nachrichten:** neue Mail, neue Bestellung (alle 20 Sekunden geprüft), zugewiesene Aufgabe, Kommentare, Erinnerung am Morgen
- **iPhone-Widget:** über die kostenlose App Scriptable (Home- und Sperrbildschirm), auch als Kalender-Widget
- **Members Club:** Statistik zum Club (Mitglieder, Bronze/Silber/Gold, Punkte, Prämien, Feedback), „Nachricht an Mitglieder senden“ mit Vorlagen, Prüfung und Freigabe, Club-Admin mit einem Klick, Club-Zugang je Person
- **Diagnose:** Testmail über „Mails verschicken“ (Port 465/587), Push-Test je Gerät

**Kosten:** keine. Die App läuft auf dem vorhandenen netcup-Webhosting (PHP + MySQL + Cronjob) und nutzt den Shopify-Zugang aus dem bestehenden Abo.

➡️ **Schritt-für-Schritt-Anleitung (online stellen + aufs Handy):** [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

### Aufbau

```
team-app/
  web/       React + Vite + Tailwind (PWA, Service Worker, Push)
  server/
    public/  api.php + .htaccess  → Dokumentenstamm
    app/     PHP-Backend ohne externe Abhängigkeiten (Sync, IMAP, Shopify, Web Push)
    tests/   Integrationstests inkl. Test-IMAP-Server
  package.sh baut das Upload-Paket nach team-app/build/
.github/workflows/team-app.yml   Tests + Build + FTP-Upload zu netcup
```

### Lokal entwickeln

```bash
# Backend (PHP 8.1+) mit SQLite
cd team-app/server
PC_CONFIG=$PWD/storage/config.php PC_STORAGE=$PWD/storage php -S 127.0.0.1:8080 -t public public/router.php

# Frontend
cd team-app/web && npm install && npm run dev   # http://localhost:5173, /api wird an :8080 weitergeleitet
```

Beispieldaten für eine Vorschau: `PC_CONFIG=… PC_STORAGE=… php team-app/server/tests/seed-demo.php` (Login `marius@perfumecloud.de` / `demo1234`, nur lokal).

### Tests

```bash
node --test team-app/server/tests/backend.test.mjs   # API, Sync, Mail-Erkennung, Sofort-Abruf (IDLE), Push-Verschlüsselung, Widget
node --test team-app/web/tests/widget.test.mjs       # Scriptable-Widget
node --test team-app/web/tests/assistant.test.mjs    # Ideen-Assistent (Text → Notiz/Aufgaben/Termine)
node --test team-app/web/tests/holidays.test.mjs     # Feiertage/Aktionstage, gleich in App und PHP
cd team-app/web && npx tsc -b                         # Typprüfung
```

## Kunden-App „Perfume Cloud Club“

Web-App (PWA) für Kundinnen und Kunden im Design des Shops (Elfenbein, Dünen, Castoro, Glas-Dock).

- **Anmeldung mit dem Shopify-Kundenkonto** (Customer Account API, Code per Mail, kein Passwort). Ausweichweg: E-Mail-Code über info@. Team-Mitglieder werden an der E-Mail erkannt und landen direkt im Admin-Bereich
- **Treuepunkte:** 1 Punkt je Euro Warenwert, Willkommensbonus, Gutschrift nach der Rückgabefrist, Storno/Erstattung werden verrechnet
- **Stufen Bronze, Silber, Gold:** mehr Punkte je Euro und eigene Vorteile je Stufe, nach Einkaufswert der letzten 12 Monate
- **Bonuspunkte:** Geburtstag, Newsletter, Bewertung, Empfehlung (beide bekommen Punkte), Startbonus für die Warteliste, Aktionen mit doppelten Punkten (z. B. Black Friday) samt Push
- **Verfall:** Punkte und Codes verfallen nach einstellbarer Frist, mit Push-Erinnerung vorher
- **Prämien:** Punkte gegen Rabattcodes tauschen (100 Punkte = 5 €), Code nur für das eigene Kundenkonto, „Im Shop einlösen“ legt ihn direkt in den Warenkorb, ungenutzte Codes zurückgeben
- **Bestellungen:** Status, Zeitleiste, Sendungsnummer mit Link, Artikel, Punkte je Bestellung
- **Push-Mitteilungen:** Versand, Zustellung, jede Punktegutschrift und jeder Abzug mit Grund, Prämie bereit, Verfall, neue Stufe, Aktionen, Nachrichten aus der Team-App. Texte im Admin editierbar, Ruhezeit
- **Feedback:** Gut / Neutral / Schlecht mit optionaler Begründung, Weiterleitung an info@
- **Club-Admin** (`/admin`): Kennzahlen, Mitglieder, Punkte buchen, Regeln, Stufen, Verfall, Boni, Aktionen, Warteliste-Einladungen, Push-Texte, Feedback, Zugänge (Benutzer der Team-App), Kundenansicht
- **Gemeinsame Datenbank** mit der Team-App (Tabellen `club_…`), Umzug per Knopf
- **Shopify:** Tag `club`, Kunden-Metafelder `club.punkte`, `club.punkte_ausstehend`, `club.mitglied_seit`, `club.stufe`, Shop-Metafeld `club.programm` (alle Regeln für Theme und Mails), Segment „Club: Prämie einlösbar“ folgt der Einlöse-Schwelle
- **Im Shop:** „Mit dieser Bestellung sammelst du 59 Punkte“ in Warenkorb und Header, live mit dem Warenkorb, Abschnitt „Club-Regeln“ (`kunden-app/shopify-theme/`)
- **Mails über Shopify Messaging:** Willkommen im Club, „Du hast 5 € Rabatt bereit“ (`kunden-app/shopify-mails/`)

➡️ **Anleitung (online stellen, Shopify verbinden):** [docs/KUNDEN-APP.md](docs/KUNDEN-APP.md)

### Aufbau

```
kunden-app/
  web/       React + Vite (PWA), eigenes CSS nach dem Shop-Theme
  server/
    public/  api.php + .htaccess  → Dokumentenstamm
    app/     PHP-Backend ohne externe Abhängigkeiten (Shopify Admin API, Customer Account API, Punkte, Codes)
    tests/   Integrationstests mit Shopify-Nachbau (mock-shopify.php)
  shopify-theme/  Punkteanzeige und Club-Regeln fürs Shop-Theme (Liquid, CSS, JS)
  shopify-mails/  Vorlagen für Shopify Messaging (Willkommen, Prämie bereit)
  package.sh baut das Upload-Paket nach kunden-app/build/
.github/workflows/kunden-app.yml   Tests + Build + FTP-Upload zu netcup
```

### Lokal entwickeln

```bash
# Shopify-Nachbau und Backend (PHP 8.1+) mit SQLite
cd kunden-app/server
export CLUB_CONFIG=$PWD/storage/config.php CLUB_STORAGE=$PWD/storage MOCK_STATE=$PWD/storage/mock.json \
       CLUB_SHOPIFY_BASE=http://127.0.0.1:8095 CLUB_CA_BASE=http://127.0.0.1:8095 CLUB_MAIL_LOG=$PWD/storage/mails.log
php -S 127.0.0.1:8095 tests/mock-shopify.php &
php -S 127.0.0.1:8094 -t public public/router.php

# Frontend
cd kunden-app/web && npm install && npm run dev   # http://localhost:5174, /api geht an :8094
```

Einrichten mit **SQLite**, dann im Club-Admin die Zugänge des Nachbaus eintragen: Shopify-App `admin-client`/`admin-secret` (Shop `ks8yin-mg.myshopify.com`), Kundenkonto-Client `ca-client`/`ca-secret`. Kundinnen, Bestellungen und wer sich gerade „bei Shopify anmeldet“ legt `POST http://127.0.0.1:8095/__mock/state` fest (Beispiele in `server/tests/backend.test.mjs`).

### Tests

```bash
node --test kunden-app/server/tests/*.test.mjs   # Login, Beitritt, Punkte, Stufen, Verfall, Boni, Aktionen, Push, Warteliste, Team-DB, Admin
cd kunden-app/web && npx tsc -b                         # Typprüfung
```
