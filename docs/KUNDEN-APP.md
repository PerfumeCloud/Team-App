# Kunden-App „Perfume Cloud Club“ online stellen – Schritt für Schritt

Die Club-App ist eine **Web-App** für eure Kundinnen und Kunden unter `https://app.perfumecloud.de`. Sie läuft auf demselben netcup-Webhosting wie die Team-App und sieht aus wie der Shop (Elfenbein, Dünen, Castoro, Glas-Dock).

**Was Kundinnen und Kunden damit machen:**
- mit dem **Perfume-Cloud-Kundenkonto** anmelden (dasselbe Konto wie im Shop, Code per E-Mail statt Passwort; neue Konten entstehen dabei automatisch)
- dem **Club beitreten** und **Treuepunkte** sammeln: 1 Punkt je Euro Warenwert, 50 Punkte Willkommensbonus
- Punkte als **Rabattcode** einlösen (100 Punkte = 5 €), Code mit einem Tipp im Shop hinterlegen
- **Bestellungen verfolgen**: Status, Zeitleiste, Sendungsnummer mit Link, Artikel, Punkte je Bestellung
- die App auf den **Home-Bildschirm** legen

**Kosten:** keine. Webhosting habt ihr schon, der Headless-Kanal und die Customer Account API sind in Shopify kostenlos, Rabattcodes auch.

| Teil | Wer | Dauer |
|---|---|---|
| **A – App online stellen** | Marius, einmalig am Computer | ca. 25 Min. |
| **B – Shopify-App für Punkte und Codes** | Marius | ca. 10 Min. |
| **C – Anmeldung mit dem Kundenkonto** | Marius | ca. 10 Min. |
| **D – Cronjob** | Marius | ca. 3 Min. |
| **E – Teilnahmebedingungen und Link im Shop** | Marius + Ben/Keanu | ca. 15 Min. |
| **F – Einmal selbst testen** | wer möchte | ca. 10 Min. |
| **G – Updates automatisch** | optional | ca. 5 Min. |

**Bereitlegen:** Zugang zum netcup **CCP**, zum **Shopify-Admin** (Inhaber-Konto) und die Datei **`perfumecloud-club-upload.zip`** (aus dem Chat mit Claude oder auf GitHub unter **Actions** → letzter grüner Lauf „Kunden-App“ → **kunden-app-upload**).

> 🔐 Passwörter und Secrets nie in Chats oder ins Repo schreiben, nur direkt in die App bzw. in die Notion-Passwortliste.

### Schon in Shopify eingerichtet (von Claude, 13.10.2026)

| Was | Wo in Shopify | Wofür |
|---|---|---|
| Kunden-Metafelder **Treuepunkte** (`club.punkte`), **Treuepunkte unterwegs** (`club.punkte_ausstehend`), **Club-Mitglied seit** (`club.mitglied_seit`) | Einstellungen → Benutzerdefinierte Daten → Kunden | Punktestand direkt beim Kunden sehen, im Theme anzeigen, für Segmente und Mails |
| Segment **Club-Mitglieder** (`customer_tags CONTAINS 'club'`) | Kunden → Segmente | alle Mitglieder, z. B. für Newsletter nur an den Club |
| Segment **Club: Prämie einlösbar** (mind. 100 Punkte) | Kunden → Segmente | Erinnerungs-Mail „Du hast 5 € Rabatt bereit“ |
| Seite **Perfume Cloud Club – Teilnahmebedingungen** (`/pages/club`), **noch nicht veröffentlicht** | Onlineshop → Seiten | Bedingungen, auf die die App verlinkt (Teil E) |

Die App pflegt die Metafelder und das Tag `club` selbst. Bitte dort nichts von Hand ändern, Punkte bucht ihr im Club-Admin (siehe unten).

---

## Teil A – App online stellen

Wie bei der Team-App, nur mit `app` statt `team`.

### A1 · Subdomain anlegen
1. Im **CCP** anmelden → **Produkte** → beim Webhosting auf **Login WCP** (Plesk).
2. **Websites & Domains** → **Subdomain hinzufügen**:
   - **Subdomain-Name:** `app`
   - **Domain:** `perfumecloud.de`
   - **Dokumentenstamm:** `app.perfumecloud.de/httpdocs/public` ← mit `/public` am Ende
3. **OK**.

### A2 · DNS-Eintrag für `app`
Wie A2 in der Team-App-Anleitung: im **Shopify-Admin** → **Einstellungen** → **Domains** → **perfumecloud.de** → **DNS-Einstellungen** → **Benutzerdefinierten Eintrag hinzufügen** → **A-Eintrag**: Name `app`, Ziel **`46.38.249.54`** (IPv4 eures Webhostings). Sonst nichts ändern.

(Liegt die Domain inzwischen bei netcup: im CCP unter **Domains** → **DNS** die Zeile `app | A | 46.38.249.54` ergänzen.)

### A3 · SSL und PHP
1. Plesk → **app.perfumecloud.de** → **SSL/TLS-Zertifikate** → **Let's Encrypt** → kostenlos installieren (klappt erst, wenn A2 aktiv ist, sonst 30 Min. warten).
2. **PHP-Einstellungen**: Version **8.3**, bei **open_basedir** die Option mit **`{WEBSPACEROOT}`** wählen (wie bei der Team-App). Speichern.

### A4 · Datenbank
- **Ist in Plesk unter „Datenbanken“ noch eine frei?** Dann **Datenbank hinzufügen**, Name z. B. `club`, Benutzer `club`, Passwort generieren lassen und notieren.
- **Webhosting 1000 hat nur eine Datenbank.** Nutzt die Team-App sie schon, nehmt in A6 einfach **SQLite**. Das reicht für den Club locker (die Daten liegen dann geschützt im Ordner `storage`).

### A5 · Hochladen
1. Plesk → **Dateien** → Ordner **`app.perfumecloud.de/httpdocs`**.
2. **Hochladen** → `perfumecloud-club-upload.zip` → Menü **⋯** → **Dateien extrahieren**, „Vorhandene Dateien ersetzen“ anhaken → **OK**.
3. Danach liegen dort **`app`**, **`public`**, **`storage`**. ZIP und die netcup-Platzhalter `index.html`/`favicon.ico` löschen.

### A6 · Einrichtung
1. **`https://app.perfumecloud.de`** öffnen, es erscheint „Club einrichten“.
2. **Datenbank:** **MySQL** (Server `mysqlf937.netcup.net`, Port 3306, Name/Benutzer/Passwort aus A4) oder **SQLite**.
3. **Dein Admin-Zugang:** Name, E-Mail, Passwort (mind. 10 Zeichen). Das ist nur für den Club-Admin, nicht für den Shop.
4. **Einrichten** → du landest im **Club-Admin** unter `https://app.perfumecloud.de/admin`.

> A5 und A6 direkt nacheinander erledigen, damit niemand anderes die Einrichtung aufruft.

---

## Teil B – Shopify-App für Punkte und Codes

Die App liest damit Bestellungen, legt Rabattcodes an und schreibt Punkte in die Metafelder.

1. <https://dev.shopify.com> öffnen (Shop-Inhaber) → **Apps** → **App erstellen**, Name `Perfume Cloud Club`.
2. Bei der App-Version unter **Zugriffsbereiche / Scopes** anhaken:
   - `read_orders`
   - `write_customers`
   - `write_discounts`
   - optional `read_all_orders` (nur nötig, damit Bestellungen älter als 60 Tage in der App erscheinen; muss bei Shopify beantragt werden)
3. Version **freigeben** und die App im Shop **Perfume Cloud** **installieren**.
4. In den **Einstellungen** der App **Client-ID** und **Client-Secret** kopieren.
5. Club-Admin → **Einstellungen** → **Shopify-App (Admin API)**: Shop-Adresse `ks8yin-mg.myshopify.com`, Client-ID und Secret einfügen → **Speichern und testen**. Grüner Haken = verbunden.

> Bitte eine **eigene** App anlegen, nicht die der Team-App erweitern. So hat jede App nur die Rechte, die sie braucht.

---

## Teil C – Anmeldung mit dem Kundenkonto

Damit Kundinnen und Kunden sich mit ihrem Shop-Konto anmelden (Shopify schickt den Code per Mail, die Anmeldeseite trägt euer Branding).

1. Shopify-Admin → **Vertriebskanäle** → **+** → im App Store **Headless** (von Shopify, kostenlos) installieren.
2. Headless öffnen → **Storefront erstellen**, Name `Perfume Cloud Club`.
3. In der Storefront bei **Customer Account API** auf **Verwalten** / **Einstellungen bearbeiten**.
4. **Client-Typ:** **Vertraulich** (Confidential).
5. Im Club-Admin unter **Einstellungen** → **Anmeldung mit dem Shopify-Kundenkonto** stehen drei Adressen mit Kopier-Knopf. In Shopify eintragen:
   - **Callback-URI(s):** `https://app.perfumecloud.de/api/auth/shopify/callback`
   - **JavaScript-Ursprung/Ursprünge:** `https://app.perfumecloud.de`
   - **Abmelde-URI:** `https://app.perfumecloud.de/`
6. Speichern, dann in Shopify **Client-ID** und **Client-Secret** der Customer Account API kopieren.
7. Im Club-Admin einfügen → **Speichern und testen**. Grüner Haken = Anmeldeseite gefunden.

Ab jetzt zeigt die Startseite der App **„Anmelden oder Konto erstellen“**.

**Ausweichweg ohne Headless:** Unter **Anmeldung per E-Mail-Code** kann die App den Code auch selbst über info@ schicken (SMTP `mxf938.netcup.net`, Port 465, Passwort von info@). Das ist nur nötig, wenn Teil C einmal nicht klappt.

---

## Teil D – Cronjob

Gleicht alle 15 Minuten neue Bestellungen ab, schreibt Punkte nach der Rückgabefrist gut, lässt abgelaufene Codes verfallen (Punkte gehen zurück) und überträgt die Kontostände in die Shopify-Metafelder.

1. Club-Admin → **Einstellungen** → **Cronjob** → bei **URL abrufen** auf Kopieren.
2. Plesk → **Geplante Aufgaben** → **Aufgabe hinzufügen**: Typ **URL abrufen**, die kopierte URL, Cron-Stil **`*/15 * * * *`**, Benachrichtigung keine → **OK**.
3. Nach 15 Minuten steht in der Club-Übersicht „Cronjob zuletzt: vor … Minuten“.

---

## Teil E – Teilnahmebedingungen und Link im Shop

1. Shopify-Admin → **Onlineshop** → **Seiten** → **Perfume Cloud Club – Teilnahmebedingungen**. Claude hat sie mit den Regeln der App vorbereitet. **Bitte lesen und anpassen** (z. B. Mindestalter, Frist bei Programmende), dann **Sichtbar** schalten. Das ist eine Vorlage, keine Rechtsberatung.
2. Club-Admin → **Einstellungen** → **Links** → Teilnahmebedingungen: `https://www.perfumecloud.de/pages/club` → **Speichern**.
3. **Datenschutzerklärung** im Shop (Einstellungen → Richtlinien) um einen Absatz ergänzen, Vorschlag:
   > **Perfume Cloud Club (Treueprogramm).** Wenn du dem Club beitrittst, verarbeiten wir in unserer Club-App (app.perfumecloud.de) deinen Namen, deine E-Mail-Adresse, deine Kundennummer, deine Bestellungen (Nummer, Datum, Betrag, Status, Artikel, Sendungsnummer) und deinen Punktestand, um das Treueprogramm durchzuführen (Art. 6 Abs. 1 lit. b DSGVO). Die Anmeldung läuft über dein Shopify-Kundenkonto. Die App wird bei der netcup GmbH, Daimlerstraße 25, 76185 Karlsruhe, gehostet. Wenn du austrittst, löschen wir deine Club-Daten; Bestelldaten bleiben im Rahmen der gesetzlichen Aufbewahrungspflichten im Shop gespeichert.
4. **Link im Shop:** Im Footer des Themes steht schon „Web-App · Bald“. Sobald die App läuft, dort auf `https://app.perfumecloud.de` verlinken (Onlineshop → Themes → Anpassen → Footer). Gerne auch einen Menüpunkt „Club“ im Hauptmenü. Claude ändert das Live-Theme nur nach eurer Freigabe.

---

## Teil F – Einmal selbst testen

1. Im Club-Admin unter **Treueprogramm** kurz **Testbestellungen zählen** einschalten → Speichern.
2. Auf dem Handy `https://app.perfumecloud.de` öffnen → **Anmelden oder Konto erstellen** → Code aus der Mail → **Jetzt beitreten**. Es erscheinen 50 Punkte.
3. Im Shop mit demselben Konto eine Testbestellung machen (Bogus Gateway oder Testmodus). Unter **Bestellungen** taucht sie auf, die Punkte stehen bei „unterwegs“.
4. Im Club-Admin bei dir selbst unter **Mitglieder** z. B. 100 Punkte gutschreiben, dann in der App unter **Prämien** einen 5-€-Code erstellen und mit **Im Shop einlösen** prüfen, dass der Rabatt im Warenkorb steht.
5. Den Code in der App **zurückgeben**, **Testbestellungen zählen** wieder **ausschalten**.

---

## Teil G – Updates automatisch (optional)

Die FTP-Secrets aus der Team-App (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`) gelten auch hier. Zusätzlich auf GitHub unter **Settings → Secrets and variables → Actions → Variables** anlegen:
- `CLUB_FTP_DIR` = `app.perfumecloud.de/httpdocs/`
- `CLUB_DEPLOY_ENABLED` = `true`

Danach landet jede Änderung an der Kunden-App automatisch auf netcup.

---

## Club-Admin im Alltag (`app.perfumecloud.de/admin`)

- **Übersicht:** Mitglieder, offene Punkte (und was sie als Rabatt wert wären), Club-Umsatz, Codes, Abgleich mit Shopify, Checkliste für die Einrichtung.
- **Mitglieder:** suchen, Verlauf und Codes ansehen, **Punkte gutschreiben oder abziehen** (mit Grund, den das Mitglied sieht – z. B. als Entschuldigung bei einer verspäteten Lieferung), Link zum Kunden im Shopify-Admin.
- **Einstellungen → Treueprogramm:** Punkte je Euro, Willkommensbonus, Wert einer Stufe, Höchstwert je Code, Wartezeit nach Versand, Gültigkeit, Kombinierbarkeit, Einlösen pausieren. Gilt sofort für neue Bestellungen.

### So rechnet die App
- Punkte = voller Euro des **Warenwerts nach Rabatten, ohne Versand** × Punkte je Euro.
- **Unterwegs**, solange die Bestellung nicht bezahlt oder nicht versendet ist und bis die **Wartezeit nach dem Versand** (14 Tage) vorbei ist. Danach **verfügbar**.
- **Storniert/erstattet:** Punkte entfallen bzw. werden anteilig angepasst.
- **Einlösen:** Punkte werden sofort abgebucht, dann entsteht in Shopify ein Rabattcode (`PC-XXXX-XXXX`, einmal, nur für dieses Kundenkonto, Mindestbestellwert = Rabatt). Klappt Shopify nicht, gehen die Punkte automatisch zurück.
- **Zurückgeben/abgelaufen:** Code wird in Shopify gelöscht, Punkte kommen zurück. Wird ein abgelaufener Code doch noch benutzt, bucht die App die Punkte wieder ab.

### Wenn etwas hakt

| Problem | Lösung |
|---|---|
| `app.perfumecloud.de` öffnet nichts oder den Shop | DNS-Eintrag (A2) fehlt oder ist noch nicht aktiv. |
| „Forbidden“, Ordnerliste oder netcup-Platzhalter | Dokumentenstamm muss `app.perfumecloud.de/httpdocs/public` sein (A1). |
| Weiße Seite / „Interner Fehler“ | **open_basedir** mit `{WEBSPACEROOT}` wählen (A3). Details in `app.perfumecloud.de/httpdocs/storage/app.log`, Inhalt Claude zeigen. |
| Shopify-Test rot: „es fehlen Berechtigungen“ | In Teil B die drei Scopes anhaken, neue Version freigeben und die App im Shop **aktualisieren**. |
| Anmeldung: „Die Anmeldung über Shopify ist gerade nicht möglich“ | Teil C prüfen: Client-ID/Secret, Callback-URI exakt wie im Admin angezeigt, Headless-Storefront gespeichert. |
| Nach der Shopify-Anmeldung „Die Anmeldung ist abgelaufen“ | Mehr als 15 Minuten auf der Anmeldeseite oder Cookies blockiert. Einfach nochmal anmelden. |
| Bestellung fehlt in der App | Sie gehört zu einem anderen Kundenkonto (z. B. Gastbestellung mit anderer E-Mail) oder ist älter als 60 Tage (ohne `read_all_orders`). **Aktualisieren** in der App tippen. |
| Punkte stehen auf „unterwegs“ | Normal bis 14 Tage nach dem Versand. Der Cronjob (Teil D) schreibt sie danach gut. |
| „Code erstellen“ meldet einen Fehler | Shopify-Test im Admin prüfen (`write_discounts`). Die Punkte wurden nicht abgebucht. |
