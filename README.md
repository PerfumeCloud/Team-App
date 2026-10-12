# Perfume Cloud · Team-App

Die interne App von Perfume Cloud für Marius, Ben und Keanu.

## Team-App

Web-App (PWA) für iPhone, Mac und Windows. Sie ist auf dem Home-Bildschirm installierbar, funktioniert offline und hält alle Geräte automatisch synchron.

- **Übersicht:** Umsatz heute, offener Versand, wichtige Mails, eigene Aufgaben, Team-Verlauf
- **Planung:** Aufgaben mit Zuständigkeit, Fälligkeit, Priorität, Kategorie, Checkliste und Kommentaren (Board am PC, Liste am Handy)
- **Notizen:** gemeinsame Pläne und Ideen mit Autosave
- **Ideen-Assistent:** Idee einfach hinschreiben oder diktieren – daraus werden Notiz, Aufgaben (mit Zuständigkeit, Datum, Priorität, Kategorie, Checkliste) und Termine (Uhrzeit, Zeitraum, Ort, Teilnehmer). Läuft ohne KI direkt in der App, kostenlos und offline
- **Kalender:** Termine, Meetings, Events und Fristen mit Erinnerung und Einladung per Push, Abo für die iPhone-/Outlook-Kalender-App, Feiertage je Bundesland und Shop-Aktionstage (Black Friday, Muttertag …) automatisch für jedes Jahr
- **Postfach:** beliebige Postfächer (info@, support@, persönliche) mit „Sichtbar für“ je Postfach, IMAP, nur lesend
- **Push bei Mails:** wählbar „Jede neue“, „Wirklich alle“ oder „Nur wichtige“ – immer nur an die Personen, die das Postfach sehen
- **Team:** Einladung per Mail mit Link zum Passwort-Festlegen, gelöschte Personen wiederherstellen, Wartung mit „Datenbank aktualisieren“ und Geräte-Status
- **Statistik:** Umsatz, Bestellungen, Ø Warenkorb, Artikel pro Bestellung, bester Tag, Stornos, Erstattungen, Top-Düfte, knapper Bestand – jeweils mit Veränderung in % (grün = besser, rot = schlechter) (Shopify Admin API)
- **Push-Nachrichten:** neue wichtige Mail, neue Bestellung, zugewiesene Aufgabe, Kommentare, Erinnerung am Morgen
- **iPhone-Widget:** über die kostenlose App Scriptable (Home- und Sperrbildschirm), auch als Kalender-Widget

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
node --test team-app/server/tests/backend.test.mjs   # API, Sync, Mail-Erkennung, Push-Verschlüsselung, Widget
node --test team-app/web/tests/widget.test.mjs       # Scriptable-Widget
node --test team-app/web/tests/assistant.test.mjs    # Ideen-Assistent (Text → Notiz/Aufgaben/Termine)
node --test team-app/web/tests/holidays.test.mjs     # Feiertage/Aktionstage, gleich in App und PHP
cd team-app/web && npx tsc -b                         # Typprüfung
```
