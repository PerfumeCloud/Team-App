# Perfume Cloud Team-App – Einrichtung Schritt für Schritt

Diese Anleitung ist auf **netcup Webhosting 1000** zugeschnitten. Es entstehen **keine zusätzlichen Kosten**: Alles läuft auf eurem vorhandenen Webhosting und im vorhandenen Shopify-Abo.

| Was die App braucht | Webhosting 1000 bietet | Passt? |
|---|---|---|
| PHP 8.1 oder neuer | PHP 8.x | ✅ |
| 1 Datenbank | 1 MySQL-Datenbank (alternativ: SQLite, braucht gar keine) | ✅ |
| 1 Cronjob alle 5 Minuten | Cronjobs in Plesk | ✅ |
| 1 Subdomain (`team.perfumecloud.de`) | 100 Subdomains | ✅ – verbraucht **keine** eurer Domains |
| Kostenloses SSL-Zertifikat | Let's Encrypt | ✅ |
| Node.js | nicht nötig | – |

Die App läuft unter einer **Subdomain eurer offiziellen Domain**, z. B. `https://team.perfumecloud.de`. Der Shop unter `www.perfumecloud.de` bleibt unverändert bei Shopify.

> **Wichtig:** Passwörter und Zugangsdaten nie in den Chat oder ins Repo schreiben. Sie gehören nur in die Formulare der App bzw. in die GitHub-Secrets.

---

## 1. GitHub-Repo anlegen (1 Minute)

1. Auf <https://github.com/new> gehen.
2. **Repository name:** `perfumecloud-apps`, **Private** auswählen, **ohne** README/.gitignore/Lizenz.
3. **Create repository** – den Rest (Code hochladen) erledigt Claude.

## 2. Subdomain bei netcup anlegen

1. Im **Webhosting Control Panel** (Plesk) anmelden – erreichbar über das netcup Customer Control Panel (CCP) → *Produkte* → euer Webhosting → *Login WCP*.
2. **Websites & Domains → Subdomain hinzufügen**
   - Subdomain-Name: `team`
   - Übergeordnete Domain: `perfumecloud.de`
   - **Dokumentenstamm:** `team.perfumecloud.de/public` ← wichtig, mit `/public`
3. **DNS-Eintrag prüfen:** Die Subdomain muss auf euer Webhosting zeigen.
   - Liegt die Domain bei netcup, legt Plesk/netcup den Eintrag meist selbst an. Sonst im CCP unter *Domains → perfumecloud.de → DNS* einen **A-Eintrag** `team` → IP-Adresse eures Webhostings hinzufügen (die IP steht in Plesk bei der Domain unter *Hosting-Einstellungen*).
   - Wird die Domain bei Shopify oder einem anderen Anbieter verwaltet, kommt derselbe **A-Eintrag** `team` → IP dort hinein (Shopify: *Einstellungen → Domains → perfumecloud.de → Domaineinstellungen → DNS-Einstellungen bearbeiten*).
   - **Die bestehenden Shopify-Einträge (`@` und `www`) nicht ändern.**
4. **SSL:** Bei `team.perfumecloud.de` → *SSL/TLS-Zertifikate* → **Let's Encrypt** → installieren (kostenlos, verlängert sich automatisch).
5. **PHP:** Bei `team.perfumecloud.de` → *PHP-Einstellungen* → **PHP 8.3** (mindestens 8.1) wählen.

## 3. Datenbank anlegen

Plesk → **Datenbanken → Datenbank hinzufügen**: Name, Benutzername und Passwort festlegen und notieren.

*Ist die eine Datenbank im Paket schon belegt?* Dann im Einrichtungsassistenten einfach **SQLite** wählen – das braucht keine Datenbank.

## 4. App hochladen

### Automatisch über GitHub (empfohlen)

Bei jeder Änderung testet GitHub die App und lädt sie per verschlüsseltem FTP zu netcup hoch – kostenlos.

1. In Plesk unter **FTP-Zugang** den FTP-Server, Benutzer und das Passwort nachsehen (oder einen eigenen FTP-Benutzer anlegen).
2. Auf GitHub im Repo: **Settings → Secrets and variables → Actions**
   - Tab **Secrets** → *New repository secret*:
     - `FTP_SERVER` – z. B. der Hostname aus Plesk
     - `FTP_USERNAME`
     - `FTP_PASSWORD`
   - Tab **Variables** → *New repository variable*:
     - `FTP_DIR` = `team.perfumecloud.de/` (der Ordner der Subdomain, mit `/` am Ende)
     - `DEPLOY_ENABLED` = `true`
3. **Actions → Team-App → Run workflow.** Nach ca. 2 Minuten ist die App online.

### Manuell

1. GitHub → **Actions** → letzter erfolgreicher Lauf „Team-App“ → unten das Paket **team-app-upload** herunterladen und entpacken.
2. Den **Inhalt** (Ordner `public`, `app`, `storage`) mit dem Plesk-**Dateimanager** in den Ordner `team.perfumecloud.de` hochladen.

## 5. Einrichtungsassistent

1. `https://team.perfumecloud.de` öffnen.
2. Datenbank auswählen (MySQL mit den Daten aus Schritt 3 oder SQLite).
3. Dein Admin-Konto anlegen (Marius). **Fertig – du bist angemeldet.**

> Den Assistenten direkt nach dem Hochladen abschließen – solange kein Konto existiert, könnte ihn sonst jemand anderes aufrufen.

## 6. Team einladen

**Einstellungen → Team → Person hinzufügen** für **Ben** und **Keanu**: Name, E-Mail und ein Startpasswort. Das Passwort persönlich weitergeben – jede:r kann es danach unter *Einstellungen* ändern.

## 7. Shopify verbinden (kostenlos)

Seit 2026 erstellt man den API-Zugang im **Shopify Dev Dashboard**:

1. <https://dev.shopify.com> mit dem Shopify-Konto des Shop-Inhabers öffnen.
2. **Apps → App erstellen** → Name `Perfume Cloud Team`.
3. In der App-Version unter **Zugriffsbereiche (Scopes)** auswählen: `read_orders`, `read_products`, `read_inventory` → Version **freigeben**.
4. Die App im Shop **Perfume Cloud** installieren.
5. Unter **Einstellungen** der App **Client-ID** und **Client-Secret** kopieren.
6. In der Team-App: **Einstellungen → Integrationen → Shopify**
   - myshopify-Adresse: `ks8yin-mg.myshopify.com` (ist schon vorausgefüllt)
   - Client-ID und Client-Secret einfügen → **Speichern & testen**.

Der erste Abgleich lädt die Bestellungen der letzten 60–90 Tage. Danach baut die App die Historie selbst weiter auf.

*Meldet der Test fehlende Berechtigungen?* Dann die Scopes in Schritt 3 prüfen, eine neue Version freigeben und die Änderung im Shop bestätigen.

## 8. Postfächer verbinden

**Einstellungen → Integrationen → Postfächer** – `info@perfumecloud.de` und `support@perfumecloud.de` sind schon eingetragen.

- **IMAP-Server:** steht in Plesk unter *E-Mail → Adresse → Mail-Client einrichten* (bei netcup in der Form `mxXXXXXX.netcup.net`), Port **993**.
- **Benutzername:** die E-Mail-Adresse
- **Passwort:** das Passwort des Postfachs

**Speichern & testen.** Die App liest nur – sie verändert, verschiebt oder löscht keine Mails und markiert nichts als gelesen.

## 9. Cronjob (alle 5 Minuten)

Damit Mails, Bestellungen und Push-Nachrichten auch aktuell sind, wenn niemand die App geöffnet hat:

1. In der App: **Einstellungen → Integrationen → Cronjob** → Adresse **kopieren**.
2. Plesk → **Geplante Aufgaben → Aufgabe hinzufügen**
   - Aufgabentyp: **URL abrufen**
   - URL: die kopierte Adresse
   - Ausführen: **Cron-Stil** `*/5 * * * *`
   - Benachrichtigung: keine
3. Speichern. In der App erscheint nach ein paar Minuten „Cronjob lief zuletzt vor … Min.“

*Ohne Cronjob* funktioniert die App trotzdem: Sie holt Mails und Bestellungen ab, sobald jemand sie öffnet. Nur Push-Nachrichten bei geschlossener App brauchen den Cronjob.

## 10. Auf euren Geräten installieren

**iPhone (jede:r einmal):**
1. `https://team.perfumecloud.de` in **Safari** öffnen und anmelden.
2. **Teilen** → **Zum Home-Bildschirm** → Hinzufügen.
3. Die App **über das neue Icon** öffnen → **Einstellungen → Benachrichtigungen → Aktivieren** → Mitteilungen erlauben.
4. *Test senden* – die Nachricht sollte sofort ankommen.

**Mac:** Safari → *Ablage* → **Zum Dock hinzufügen**.
**Windows-PC:** In **Edge** oder **Chrome** öffnen → in der Adressleiste auf das Installieren-Symbol klicken (oder Menü → *App installieren*) → danach in der App Benachrichtigungen aktivieren.

## 11. iPhone-Widget (optional, kostenlos)

1. Die kostenlose App **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** installieren.
2. Team-App → **Einstellungen → iPhone-Widget → Widget-Skript erstellen → Skript kopieren.**
3. In Scriptable oben rechts **+**, einfügen, als Namen **Perfume Cloud** eintragen.
4. Home-Bildschirm lange drücken → **Bearbeiten → Widget hinzufügen → Scriptable** → Größe wählen.
5. Widget antippen und halten → **Widget bearbeiten** → Script: **Perfume Cloud**.

Funktioniert auch auf dem Sperrbildschirm. Das Widget ist nur lesend; der Zugang lässt sich in den Einstellungen jederzeit sperren.

---

## Wenn etwas hakt

| Problem | Lösung |
|---|---|
| Seite zeigt „Forbidden“ oder eine Ordnerliste | Dokumentenstamm muss auf `…/public` zeigen (Schritt 2). |
| „Interner Fehler“ | Fehlermeldung steht in `storage/app.log` (Plesk-Dateimanager). |
| Push kommt auf dem iPhone nicht an | App muss vom Home-Bildschirm geöffnet sein (nicht Safari); iOS 16.4 oder neuer; in den iPhone-Einstellungen unter *Mitteilungen → PC Team* erlauben. |
| Passwort vergessen | Ein Admin setzt unter *Einstellungen → Team → Passwort* ein neues. |
| Mail-Test schlägt fehl | IMAP-Server und Passwort prüfen; Port 993. |
| Shopify-Test schlägt fehl | Client-ID/Secret neu kopieren; Scopes prüfen; App im Shop installiert? |
