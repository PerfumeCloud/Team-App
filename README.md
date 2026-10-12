# Perfume Cloud · Apps

Interne Apps für Perfume Cloud. Aktuell: die **Team-App** für Marius, Ben und Keanu.

## Team-App

Web-App (PWA) für iPhone, Mac und Windows. Sie ist auf dem Home-Bildschirm installierbar, funktioniert offline und hält alle Geräte automatisch synchron.

- **Übersicht:** Umsatz heute, offener Versand, wichtige Mails, eigene Aufgaben, Team-Verlauf
- **Planung:** Aufgaben mit Zuständigkeit, Fälligkeit, Priorität, Kategorie, Checkliste und Kommentaren (Board am PC, Liste am Handy)
- **Notizen:** gemeinsame Pläne und Ideen mit Autosave
- **Postfach:** wichtige offene Mails aus info@ und support@ (IMAP, nur lesend)
- **Statistik:** Umsatz, Bestellungen, Ø Warenkorb, Top-Düfte, knapper Bestand (Shopify Admin API)
- **Push-Nachrichten:** neue wichtige Mail, neue Bestellung, zugewiesene Aufgabe, Kommentare, Erinnerung am Morgen
- **iPhone-Widget:** über die kostenlose App Scriptable (Home- und Sperrbildschirm)

**Kosten:** keine. Die App läuft auf dem vorhandenen netcup-Webhosting (PHP + MySQL + Cronjob) und nutzt den Shopify-Zugang aus dem bestehenden Abo.

➡️ **Einrichtung:** [docs/ANLEITUNG.md](docs/ANLEITUNG.md)

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
cd team-app/web && npx tsc -b                         # Typprüfung
```
