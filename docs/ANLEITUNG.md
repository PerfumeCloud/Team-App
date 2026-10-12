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
   - **Dokumentenstamm:** `team.perfumecloud.de/httpdocs/public` ← wichtig: mit `/public` am Ende
5. **OK** klicken.

> Hat Plesk den Dokumentenstamm schon auf `team.perfumecloud.de/httpdocs` gesetzt, änderst du ihn unter **Websites & Domains** → team.perfumecloud.de → **Hosting-Einstellungen** auf `team.perfumecloud.de/httpdocs/public`.

> Taucht `perfumecloud.de` in Plesk nicht auf, ist die Domain dem Webhosting noch nicht zugeordnet. Dann kurz Claude fragen.

### A2 · DNS-Eintrag für `team` setzen
Damit `team.perfumecloud.de` auf euer Webhosting zeigt, während der Shop bei Shopify bleibt. Zuerst die **IPv4-Adresse eures Webservers** notieren: im Webhosting-Panel unter **Domain-Einstellungen** bei „Webserver“. Bei euch ist das **`46.38.249.54`**.

**Solange die Domain noch bei Shopify verwaltet wird** (Stand jetzt):
1. Shopify-Admin → **Einstellungen** → **Domains** → **perfumecloud.de** → **DNS-Einstellungen**.
2. **Benutzerdefinierten Eintrag hinzufügen** → **A-Eintrag**: Name `team`, verweist auf die IPv4-Adresse eures Webhostings → speichern.
3. Die übrigen Einträge (A/AAAA `@`, CNAME `www`, MX, TXT) **nicht verändern**.

**Wenn die Domain zu netcup umgezogen ist** (nach dem Transfer), müssen im CCP unter **Domains** → Lupe/🔗 bei perfumecloud.de → **DNS** genau diese Einträge stehen:

| Host | Typ | Ziel | Priorität | Wofür |
|---|---|---|---|---|
| `@` | A | `23.227.38.65` | | Shop (Shopify) |
| `www` | CNAME | `shops.myshopify.com` | | Shop (Shopify) |
| `@` | MX | `mxf938.netcup.net` | 10 | Mails |
| `@` | TXT | `v=spf1 mx ~all` | | Mails (Spamschutz) |
| `team` | A | IPv4 des Webhostings | | Team-App |

Andere Einträge für `@` oder `www` (z. B. ein A- oder **AAAA-Eintrag mit netcup-IP**) **löschen**, sonst landen Besucher statt im Shop auf dem Webhosting. Danach in Shopify unter **Domains** prüfen, dass perfumecloud.de als verbunden angezeigt wird.

**Warten:** Neue DNS-Einträge brauchen meist 15–30 Minuten, manchmal bis zu 2 Stunden. In der Zeit kannst du mit A4 und A5 weitermachen.

### A3 · SSL-Zertifikat und PHP-Version
1. In Plesk unter **Websites & Domains** bei **team.perfumecloud.de** auf **SSL/TLS-Zertifikate** und dann **Let's Encrypt** wählen. **Kostenloses Zertifikat installieren** und bestätigen.
   - Kommt eine Fehlermeldung, ist der DNS-Eintrag aus A2 noch nicht aktiv. 30 Minuten warten und erneut versuchen.
2. Bei **team.perfumecloud.de** auf **PHP** bzw. **PHP-Einstellungen** und dort die Version **8.3** wählen (oder die höchste 8.x, mindestens 8.1).
3. **Wichtig:** Auf derselben Seite bei **open_basedir** die Option **`{WEBSPACEROOT}{/}{:}{TMP}{/}…`** wählen (nicht die Standard-Option mit `{DOCROOT}`). Sonst darf PHP die Ordner `app` und `storage` neben `public` nicht lesen und die App zeigt einen Fehler. Speichern.

### A4 · Datenbank anlegen
1. In Plesk auf **Datenbanken** und dann **Datenbank hinzufügen**.
2. Datenbankname z. B. `teamapp`, Benutzer z. B. `teamapp`, Passwort **generieren lassen**.
3. Alle drei Angaben notieren und **OK** klicken.

> Meldet Plesk, dass das Limit erreicht ist (Webhosting 1000 hat 1 Datenbank), überspringst du diesen Schritt und wählst in A6 **SQLite**.

### A5 · App hochladen
1. In Plesk auf **Dateien** (Dateimanager) und den Ordner **`team.perfumecloud.de/httpdocs`** öffnen.
2. Oben auf **Hochladen** und die Datei **`perfumecloud-team-app-upload.zip`** auswählen.
3. Bei der hochgeladenen ZIP-Datei auf das Menü (**⋯**) und dann **Dateien extrahieren**. „Vorhandene Dateien ersetzen“ anhaken und **OK** klicken.
4. Danach liegen in `httpdocs` die drei Ordner **`app`**, **`public`** und **`storage`**. Die ZIP-Datei und die Platzhalter-Dateien `index.html` und `favicon.ico` von netcup löschen.

### A6 · Einrichtungsassistent
1. Im Browser **`https://team.perfumecloud.de`** öffnen. Es erscheint „Willkommen!“.
2. **Datenbank:**
   - **MySQL:** Server **`mysqlf937.netcup.net`** (steht im Webhosting-Panel unter „Domain-Einstellungen → MySQL-Server“), Port `3306`, dazu Name, Benutzer und Passwort aus A4.
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
1. Den IMAP-Server nachsehen: In Plesk auf **E-Mail**, eine Adresse anklicken und dann die Einstellungen für E-Mail-Programme öffnen. Bei euch ist das **`mxf938.netcup.net`** (steht auch im MX-Eintrag der Domain).
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
   - `FTP_DIR` = `team.perfumecloud.de/httpdocs/`
   - `DEPLOY_ENABLED` = `true`
5. Ab jetzt landet jede Änderung nach etwa 2 Minuten automatisch auf netcup.

---

## Wenn etwas hakt

| Problem | Lösung |
|---|---|
| `team.perfumecloud.de` öffnet den Shop oder gar nichts | Der DNS-Eintrag (A2) fehlt oder ist noch nicht aktiv. Etwas warten. |
| „Hier entsteht eine neue Webseite“, „Forbidden“ oder eine Ordnerliste | Der Dokumentenstamm muss `team.perfumecloud.de/httpdocs/public` sein (A1). Ändern lässt er sich in Plesk unter **Hosting-Einstellungen**. |
| Weiße Seite oder „Interner Fehler“ ohne `app.log` | In den **PHP-Einstellungen** bei **open_basedir** die Option mit `{WEBSPACEROOT}` wählen (A3). |
| Let's Encrypt schlägt fehl | Der DNS-Eintrag ist noch nicht aktiv. 30 Minuten warten. |
| „Interner Fehler“ | Die Details stehen in `team.perfumecloud.de/httpdocs/storage/app.log` (Plesk-Dateimanager). Den Inhalt Claude zeigen. |
| Keine Push-Nachricht auf dem iPhone | Die App über das **Home-Bildschirm-Icon** öffnen, nicht über Safari. Mindestens iOS 16.4. In den iPhone-Einstellungen unter **Mitteilungen**, **PC Team** erlauben. Ohne Cronjob (A10) gibt es bei geschlossener App keine Push-Nachrichten. |
| „Zum Home-Bildschirm“ fehlt | Die Seite in **Safari** öffnen, nicht in einer anderen App. |
| Passwort vergessen | Marius setzt unter **Einstellungen**, **Team**, **Passwort** ein neues. |
| Mail-Test rot | IMAP-Server und Postfach-Passwort prüfen, Port 993. |
| Shopify-Test rot | Client-ID und Secret neu kopieren. Prüfen, ob die drei Scopes angehakt sind und die App im Shop installiert ist. |
