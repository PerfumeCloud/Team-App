# Team-App aufs Handy bringen – Schritt für Schritt

Die App ist eine **Web-App**: Sie liegt auf eurem netcup-Webhosting unter `https://team.perfumecloud.de` und wird von dort auf iPhone, Mac und Windows-PC installiert. Es gibt keinen App Store, kein Apple-Entwicklerkonto und **keine Zusatzkosten**.

| Teil | Wer | Dauer |
|---|---|---|
| **A – App online stellen** | Marius, einmalig am Computer | ca. 30–45 Min. |
| **B – App aufs iPhone** | jede:r auf dem eigenen iPhone | ca. 2 Min. |
| **C – Windows-PC / Mac** | wer möchte | ca. 1 Min. |
| **D – iPhone-Widget** | optional | ca. 3 Min. |
| **E – Updates automatisch** | optional, einmalig | ca. 10 Min. |

**Bereitlegen:**
- Zugang zum netcup **Customer Control Panel (CCP)**: <https://www.customercontrolpanel.de>
- Die Datei **`perfumecloud-team-app-upload.zip`**. Ihr findet sie im Chat mit Claude oder auf GitHub unter **Actions** → letzter grüner Lauf „Team-App“ → unten **team-app-upload**.

> 🔐 Passwörter nie in Chats oder ins Repo schreiben. Am besten in eurer Notion-Passwortliste ablegen.

---

## Teil A – App online stellen (Marius, einmalig)

### A1 · Subdomain anlegen
1. Im **CCP** anmelden.
2. Links auf **Produkte** und dann bei eurem **Webhosting 1000** auf **Login WCP**. Das öffnet Plesk, die Verwaltung eures Webhostings.
3. In Plesk auf **Websites & Domains** und dann auf **Subdomain hinzufügen**.
4. Eintragen:
   - **Subdomain-Name:** `team`
   - **Domain:** `perfumecloud.de`
   - **Dokumentenstamm:** `team.perfumecloud.de/public` ← wichtig: mit `/public` am Ende
5. **OK** klicken.

> Taucht `perfumecloud.de` in Plesk nicht auf, ist die Domain dem Webhosting noch nicht zugeordnet. Dann kurz Claude fragen.

### A2 · DNS-Eintrag setzen (bei netcup)
Damit `team.perfumecloud.de` auf euer Webhosting zeigt, während der Shop bei Shopify bleibt:

1. Im **CCP** links auf **Produkte** und dann auf euer **Webhosting 1000**. Unter **Übersicht** steht die **IPv4-Adresse**: notieren.
2. Im **CCP** links auf **Domains** und dann neben **perfumecloud.de** auf die **Lupe**. Dort den Reiter **DNS** öffnen.
3. Zur Orientierung: Dort stehen die Einträge für den Shop (`@` → `23.227.38.65`, `www` → `shops.myshopify.com`) und für die Mails (MX). **Diese nicht verändern!**
4. Gibt es schon einen Eintrag mit **Host `team`** oder **Host `*`**, Typ **A**, Ziel **eure IP aus Schritt 1**? Dann ist nichts zu tun, weiter mit A3.
5. Sonst einen neuen Eintrag anlegen:
   - **Host:** `team`
   - **Typ:** `A`
   - **Ziel:** die IPv4-Adresse aus Schritt 1
6. Speichern („DNS-Records speichern“) und die Sicherheitsabfrage bestätigen.
7. **Warten:** Meist dauert es 15–30 Minuten, manchmal bis zu 2 Stunden, bis der Eintrag überall bekannt ist. In der Zeit kannst du mit A4 und A5 weitermachen.

### A3 · SSL-Zertifikat und PHP-Version
1. In Plesk unter **Websites & Domains** bei **team.perfumecloud.de** auf **SSL/TLS-Zertifikate** und dann **Let's Encrypt** wählen. **Kostenloses Zertifikat installieren** und bestätigen.
   - Kommt eine Fehlermeldung, ist der DNS-Eintrag aus A2 noch nicht aktiv. 30 Minuten warten und erneut versuchen.
2. Bei **team.perfumecloud.de** auf **PHP** bzw. **PHP-Einstellungen** und dort die Version **8.3** wählen (oder die höchste 8.x, mindestens 8.1). Speichern.

### A4 · Datenbank anlegen
1. In Plesk auf **Datenbanken** und dann **Datenbank hinzufügen**.
2. Datenbankname z. B. `teamapp`, Benutzer z. B. `teamapp`, Passwort **generieren lassen**.
3. Alle drei Angaben notieren und **OK** klicken.

> Meldet Plesk, dass das Limit erreicht ist (Webhosting 1000 hat 1 Datenbank), überspringst du diesen Schritt und wählst in A6 **SQLite**.

### A5 · App hochladen
1. In Plesk auf **Dateien** (Dateimanager) und den Ordner **`team.perfumecloud.de`** öffnen.
2. Oben auf **Hochladen** und die Datei **`perfumecloud-team-app-upload.zip`** auswählen.
3. Bei der hochgeladenen ZIP-Datei auf das Menü (**⋯**) und dann **Dateien extrahieren**. „Vorhandene Dateien ersetzen“ anhaken und **OK** klicken.
4. Danach liegen im Ordner die drei Ordner **`app`**, **`public`** und **`storage`**. Die ZIP-Datei kann gelöscht werden.

### A6 · Einrichtungsassistent
1. Im Browser **`https://team.perfumecloud.de`** öffnen. Es erscheint „Willkommen!“.
2. **Datenbank:**
   - **MySQL:** Server `localhost`, Port `3306`, dazu Name, Benutzer und Passwort aus A4.
   - Oder **SQLite**, wenn es keine freie Datenbank gibt.
3. **Dein Admin-Konto:** Name `Marius`, deine E-Mail und ein sicheres Passwort.
4. Auf **App einrichten** klicken. Du bist angemeldet und siehst die Übersicht.

> Bitte A5 und A6 direkt nacheinander erledigen: Solange noch kein Konto existiert, könnte theoretisch jemand anderes den Assistenten aufrufen.

### A7 · Ben und Keanu anlegen
1. In der App auf **Einstellungen**, dann **Team** und **Person hinzufügen**.
2. Name **Ben**, seine E-Mail und ein Startpasswort (mindestens 8 Zeichen) eintragen und **Hinzufügen** klicken.
3. Dasselbe für **Keanu**.
4. Beiden E-Mail und Startpasswort **persönlich** geben. Das Passwort ändern sie später selbst unter **Einstellungen**.

### A8 · Postfächer info@ und support@ verbinden
1. Den IMAP-Server nachsehen: In Plesk auf **E-Mail**, eine Adresse anklicken und dann die Einstellungen für E-Mail-Programme öffnen. Der Servername sieht bei netcup etwa so aus: `mxXXXXXX.netcup.net`.
2. In der App auf **Einstellungen**, dann **Integrationen** und zu **Postfächer**. Beide Adressen sind schon eingetragen.
3. Bei beiden den **IMAP-Server**, Port **993** und das **Passwort** des Postfachs eintragen.
4. Auf **Speichern & testen** klicken. Erscheint ein grüner Haken, holt die App ab jetzt die wichtigen Mails.

### A9 · Shopify verbinden
1. <https://dev.shopify.com> öffnen und mit deinem Shopify-Konto (Shop-Inhaber) anmelden.
2. Auf **Apps** und dann **App erstellen** klicken, Name `Perfume Cloud Team`.
3. Bei der App-Version unter **Zugriffsbereiche / Scopes** diese drei anhaken: `read_orders`, `read_products`, `read_inventory`. Dann die Version **freigeben**.
4. Die App im Shop **Perfume Cloud** **installieren**.
5. In den **Einstellungen** der App die **Client-ID** und das **Client-Secret** kopieren.
6. In der Team-App auf **Einstellungen**, dann **Integrationen** und zu **Shopify**. Die myshopify-Adresse `ks8yin-mg.myshopify.com` ist schon eingetragen. Client-ID und Secret einfügen und **Speichern & testen** klicken.
7. Nach etwa einer Minute füllt sich die **Statistik**.

### A10 · Cronjob (für Push-Nachrichten bei geschlossener App)
1. In der App auf **Einstellungen**, dann **Integrationen** und zu **Cronjob**. Dort auf **Kopieren** klicken.
2. In Plesk auf **Geplante Aufgaben** und dann **Aufgabe hinzufügen**.
3. Eintragen:
   - **Aufgabentyp:** URL abrufen
   - **URL:** die kopierte Adresse
   - **Ausführen:** Cron-Stil `*/5 * * * *` (alle 5 Minuten)
   - **Benachrichtigung:** keine
4. Mit **OK** speichern. Nach ein paar Minuten steht in der App „Cronjob lief zuletzt vor … Min.“

✅ **Teil A ist erledigt, die App ist online.**

---

## Teil B – App aufs iPhone (jede:r, 2 Minuten)

Voraussetzung: **iOS 16.4 oder neuer**. Die Version steht unter Einstellungen → Allgemein → Info.

1. Auf dem iPhone **Safari** öffnen.
2. Oben **`team.perfumecloud.de`** eingeben und öffnen.
3. Mit **E-Mail und Passwort** anmelden (von Marius).
4. Auf das **Teilen-Symbol** tippen (Quadrat mit Pfeil nach oben).
   - Ist es nicht zu sehen, erst unten rechts auf **•••** tippen und dann auf **Teilen**.
5. Nach unten scrollen und **Zum Home-Bildschirm** antippen.
6. Den Namen **PC Team** so lassen. Wird **„Als Web-App öffnen“** angezeigt, bleibt es eingeschaltet. Dann **Hinzufügen** tippen.
7. Auf dem Home-Bildschirm ist jetzt das **Perfume-Cloud-Icon** mit eurem Monogramm. **Ab jetzt die App immer über dieses Icon öffnen**, nicht über Safari.
8. Die App über das Icon öffnen und **noch einmal anmelden**. Die installierte App hat ihren eigenen Speicher, das ist normal.
9. **Benachrichtigungen einschalten:**
   - Oben rechts auf deinen **Kreis mit Initiale** tippen. Das öffnet die **Einstellungen**.
   - Bei **Benachrichtigungen** auf **Aktivieren** tippen und bei der iPhone-Abfrage **Erlauben** wählen.
   - **Test senden** antippen. Nach ein paar Sekunden kommt eine Mitteilung ✓
10. Darunter mit den Schaltern festlegen, was du bekommen möchtest: wichtige Mails, neue Bestellungen, Aufgaben für mich, Kommentare und die Erinnerung am Morgen.

🎉 **Fertig!** Die Zahl am App-Icon zeigt die wichtigen offenen Mails.

---

## Teil C – Windows-PC und Mac

**Windows (Edge oder Chrome):**
1. `https://team.perfumecloud.de` öffnen und anmelden.
2. Rechts in der Adressleiste auf das Symbol **App installieren** klicken (Bildschirm mit Pfeil). Alternativ im Menü **⋯** → **Apps** → **Diese Website als App installieren**.
3. Auf **Installieren** klicken. Die App erscheint im Startmenü und lässt sich an die Taskleiste anheften.
4. In der App unter **Einstellungen**, **Benachrichtigungen** auf **Aktivieren** klicken.

**Mac (Safari):** Die Seite öffnen und im Menü **Ablage** auf **Zum Dock hinzufügen** klicken.

---

## Teil D – iPhone-Widget (optional)

1. Die kostenlose App **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** aus dem App Store laden.
2. In der Team-App auf **Einstellungen**, dann **iPhone-Widget** und **Widget-Skript erstellen**, danach **Skript kopieren**.
3. **Scriptable** öffnen, oben rechts auf **+** tippen und den Text einfügen. Oben als Namen **Perfume Cloud** eintragen und **Fertig** tippen.
4. Auf dem Home-Bildschirm auf eine freie Stelle lange drücken. Dann **Bearbeiten**, **Widget hinzufügen**, **Scriptable** wählen, eine Größe (klein, mittel oder groß) auswählen und **Widget hinzufügen** tippen.
5. Das neue Widget lange drücken, **Widget bearbeiten** wählen und bei **Script** **Perfume Cloud** auswählen.

Das geht genauso auf dem **Sperrbildschirm**: Sperrbildschirm lange drücken, **Anpassen** und dort Widgets hinzufügen.

---

## Teil E – Updates automatisch (optional)

Wenn Claude etwas an der App ändert, landet das auf GitHub. Damit es ohne erneutes Hochladen der ZIP-Datei auch auf netcup ankommt:

1. Die FTP-Daten nachsehen: In Plesk auf **FTP-Zugang** (Server, Benutzer, Passwort).
2. Auf GitHub im Repo **Team-App** auf **Settings**, dann **Secrets and variables** und **Actions**.
3. Im Reiter **Secrets** mit **New repository secret** diese drei anlegen:
   - `FTP_SERVER`
   - `FTP_USERNAME`
   - `FTP_PASSWORD`
4. Im Reiter **Variables** mit **New repository variable** diese zwei anlegen:
   - `FTP_DIR` = `team.perfumecloud.de/`
   - `DEPLOY_ENABLED` = `true`
5. Ab jetzt landet jede Änderung nach etwa 2 Minuten automatisch auf netcup.

---

## Wenn etwas hakt

| Problem | Lösung |
|---|---|
| `team.perfumecloud.de` öffnet den Shop oder gar nichts | Der DNS-Eintrag (A2) fehlt oder ist noch nicht aktiv. Etwas warten. |
| „Forbidden“ oder eine Ordnerliste | Der Dokumentenstamm muss `team.perfumecloud.de/public` sein (A1). Ändern lässt er sich in Plesk unter **Hosting-Einstellungen**. |
| Let's Encrypt schlägt fehl | Der DNS-Eintrag ist noch nicht aktiv. 30 Minuten warten. |
| „Interner Fehler“ | Die Details stehen in `team.perfumecloud.de/storage/app.log` (Plesk-Dateimanager). Den Inhalt Claude zeigen. |
| Keine Push-Nachricht auf dem iPhone | Die App über das **Home-Bildschirm-Icon** öffnen, nicht über Safari. Mindestens iOS 16.4. In den iPhone-Einstellungen unter **Mitteilungen**, **PC Team** erlauben. Ohne Cronjob (A10) gibt es bei geschlossener App keine Push-Nachrichten. |
| „Zum Home-Bildschirm“ fehlt | Die Seite in **Safari** öffnen, nicht in einer anderen App. |
| Passwort vergessen | Marius setzt unter **Einstellungen**, **Team**, **Passwort** ein neues. |
| Mail-Test rot | IMAP-Server und Postfach-Passwort prüfen, Port 993. |
| Shopify-Test rot | Client-ID und Secret neu kopieren. Prüfen, ob die drei Scopes angehakt sind und die App im Shop installiert ist. |
