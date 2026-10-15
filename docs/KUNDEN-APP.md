# Kunden-App „Perfume Cloud Club“ online stellen – Schritt für Schritt

Die Club-App ist eine **Web-App** für eure Kundinnen und Kunden unter `https://app.perfumecloud.de`. Sie läuft auf demselben netcup-Webhosting wie die Team-App und sieht aus wie der Shop (Elfenbein, Dünen, Castoro, Glas-Dock).

**Was Kundinnen und Kunden damit machen:**
- mit dem **Perfume-Cloud-Kundenkonto** anmelden (dasselbe Konto wie im Shop, Code per E-Mail statt Passwort; neue Konten entstehen dabei automatisch)
- dem **Club beitreten** und **Treuepunkte** sammeln: 1 Punkt je Euro Warenwert, 50 Punkte Willkommensbonus
- in den **Stufen Bronze, Silber und Gold** aufsteigen: mehr Punkte je Euro und eigene Vorteile je Stufe
- **Bonuspunkte** bekommen: Geburtstag, Newsletter, Bewertung, Freunde einladen (beide bekommen Punkte), Startbonus für die Warteliste, doppelte Punkte in Aktionszeiträumen
- Punkte als **Rabattcode** einlösen (100 Punkte = 5 €), Code mit einem Tipp im Shop hinterlegen
- **Bestellungen verfolgen**: Status, Zeitleiste, Sendungsnummer mit Link, Artikel, Punkte je Bestellung
- **Push-Mitteilungen** bekommen: Paket unterwegs, Punkte gutgeschrieben oder abgezogen (mit Grund), Prämie bereit, Punkte verfallen bald, neue Düfte
- **Feedback** geben (Gut / Neutral / Schlecht, optional mit Text), es geht an info@
- die App auf den **Home-Bildschirm** legen

**Fürs Team:** Club-Admin unter `app.perfumecloud.de/admin` mit Regeln, Stufen, Verfall, Boni, Aktionen, Warteliste, Push-Texten und Feedback. In der **Team-App** gibt es den Bereich **Members Club** mit Statistik, „Nachricht an Mitglieder senden“ (mit Prüfung und Freigabe) und einem direkten Link in den Club-Admin. Wer im Team ist, landet nach der Anmeldung in der Club-App direkt im Admin-Bereich.

**Kosten:** keine. Webhosting habt ihr schon, der Headless-Kanal und die Customer Account API sind in Shopify kostenlos, Rabattcodes auch.

| Teil | Wer | Dauer |
|---|---|---|
| **Update 1.0 → 1.1 (Club 2.0)** | Marius, wenn die App schon läuft | ca. 10 Min. |
| **A – App online stellen** | Marius, einmalig am Computer | ca. 25 Min. |
| **B – Shopify-App für Punkte und Codes** | Marius | ca. 10 Min. |
| **C – Anmeldung mit dem Kundenkonto** | Marius | ca. 10 Min. |
| **D – Cronjob** | Marius | ca. 3 Min. |
| **E – Teilnahmebedingungen und Link im Shop** | Marius + Ben/Keanu | ca. 15 Min. |
| **F – Einmal selbst testen** | wer möchte | ca. 10 Min. |
| **G – Updates automatisch** | optional | ca. 5 Min. |
| **H – Mit der Team-App verbinden** | Marius | ca. 10 Min. |
| **I – Punkteanzeige im Shop** | Marius, nach Freigabe | ca. 15 Min. |
| **J – Willkommens- und Erinnerungs-Mail (Shopify)** | Marius oder Ben/Keanu | ca. 15 Min. |
| **K – Warteliste einladen (Launch)** | gemeinsam entscheiden | ca. 5 Min. |

**Bereitlegen:** Zugang zum netcup **CCP**, zum **Shopify-Admin** (Inhaber-Konto) und die Datei **`perfumecloud-club-upload.zip`** (aus dem Chat mit Claude oder auf GitHub unter **Actions** → letzter grüner Lauf „Kunden-App“ → **kunden-app-upload**).

> 🔐 Passwörter und Secrets nie in Chats oder ins Repo schreiben, nur direkt in die App bzw. in die Notion-Passwortliste.

### Schon in Shopify eingerichtet (von Claude, 13. und 15.10.2026)

| Was | Wo in Shopify | Wofür |
|---|---|---|
| Kunden-Metafelder **Treuepunkte** (`club.punkte`), **Treuepunkte unterwegs** (`club.punkte_ausstehend`), **Club-Mitglied seit** (`club.mitglied_seit`), **Club-Stufe** (`club.stufe`: bronze/silber/gold) | Einstellungen → Benutzerdefinierte Daten → Kunden | Punktestand und Stufe direkt beim Kunden sehen, im Theme anzeigen, für Segmente und Mails |
| Shop-Metafeld **Club-Programm** (`club.programm`) | im Hintergrund (liest das Theme) | Alle Regeln (Punkte je Euro, Stufen, Boni, Aktionen) für Theme und Mails. Die App schreibt es bei jeder Änderung neu |
| Segment **Club-Mitglieder** (`customer_tags CONTAINS 'club'`) | Kunden → Segmente | alle Mitglieder, z. B. für den Willkommens-Flow und Newsletter nur an den Club |
| Segment **Club: Prämie einlösbar** (mind. 100 Punkte) | Kunden → Segmente | Erinnerungs-Mail „Du hast 5 € Rabatt bereit“. Die App passt die Punktzahl an, wenn ihr den Wert einer Prämie ändert |
| Segmente **Club: Silber**, **Club: Gold** | Kunden → Segmente | Aktionen nur für höhere Stufen (z. B. früher Zugang zu neuen Düften) |
| Segment **Club: Warteliste noch nicht dabei** | Kunden → Segmente | wer auf der Warteliste steht, aber noch nicht im Club ist |
| Seite **Perfume Cloud Club – Teilnahmebedingungen** (`/pages/club`), **noch nicht veröffentlicht** | Onlineshop → Seiten | Bedingungen, auf die die App verlinkt (Teil E) |
| Theme **Club-Vorschau (Punkteanzeige)**, **nicht veröffentlicht** | Onlineshop → Themes | Kopie des Live-Themes mit Punkteanzeige im Header, im Warenkorb und den Club-Regeln (Teil I) |

Die App pflegt Metafelder, Segment-Schwelle und das Tag `club` selbst. Bitte dort nichts von Hand ändern, Punkte bucht ihr im Club-Admin (siehe unten).

---

## Update 1.0 → 1.1 (Club 2.0)

Nur nötig, wenn die App schon läuft (bei euch: `app.perfumecloud.de` mit Version 1.0 und SQLite). Alle Punkte, Mitglieder und Codes bleiben erhalten.

1. Neue **`perfumecloud-club-upload.zip`** wie in A5 nach `app.perfumecloud.de/httpdocs` hochladen und mit „Vorhandene Dateien ersetzen“ entpacken. Die `config.php` und der Ordner `storage` bleiben unangetastet.
2. `https://app.perfumecloud.de/admin` öffnen. Beim ersten Aufruf ergänzt die App die Datenbank selbst (neue Tabellen für Stufen, Boni, Push, Feedback, Warteliste).
3. **Einstellungen → Regeln & Stufen** durchsehen und einmal **Speichern**. Damit landen die neuen Regeln im Shop (Metafeld `club.programm`) und die Adresse der App wird fest gespeichert.
4. **Übersicht** prüfen: Die Checkliste zeigt, was noch fehlt (z. B. Cronjob, Team-App).
5. Danach **Teil H** (Team-App verbinden). Die Teile I bis K sind unabhängig davon.

> Ist **Teil G** eingerichtet, kommt das Update automatisch, sobald es auf `main` liegt.

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

Später (Teil H) zieht der Club in die Datenbank der Team-App um. Dann gelten die Benutzer der Team-App, und dieser erste Zugang bleibt als Reserve unter **Einstellungen → Zugänge → Eigene Club-Zugänge**.

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

**E-Mail-Versand (für Bestätigungen):** Club-Admin → **Einstellungen → Verbindungen → E-Mail-Versand**: SMTP `mxf938.netcup.net`, Port **465**, Benutzer `info@perfumecloud.de`, Passwort von info@, Absender `info@perfumecloud.de` / `Perfume Cloud`. Darüber gehen die Willkommensmail, die Einladung an die Warteliste und die Feedback-Weiterleitung an info@. Punkte, Versand und Aktionen meldet die App per **Push**, nicht per Mail.

**Ausweichweg ohne Headless:** Mit dem Schalter **Anmeldung per E-Mail-Code anbieten** schickt die App den Anmeldecode selbst über diesen Zugang. Das ist nur nötig, wenn Teil C einmal nicht klappt.

---

## Teil D – Cronjob

Gleicht alle 15 Minuten neue Bestellungen ab, schreibt Punkte nach der Rückgabefrist gut, lässt abgelaufene Punkte und Codes verfallen, prüft Stufen, Geburtstage und Newsletter, startet Aktionen, verschickt die Push-Warteschlange (nach der Ruhezeit) und Einladungen an die Warteliste und überträgt die Kontostände in die Shopify-Metafelder.

1. Club-Admin → **Einstellungen → System → Cronjob** → bei **URL abrufen** auf Kopieren.
2. Plesk → **Geplante Aufgaben** → **Aufgabe hinzufügen**: Typ **URL abrufen**, die kopierte URL, Cron-Stil **`*/15 * * * *`**, Benachrichtigung keine → **OK**.
3. Nach 15 Minuten steht in der Club-Übersicht „Cronjob zuletzt: vor … Minuten“.

---

## Teil E – Teilnahmebedingungen und Link im Shop

1. Shopify-Admin → **Onlineshop** → **Seiten** → **Perfume Cloud Club – Teilnahmebedingungen**. Claude hat sie mit den Regeln der App vorbereitet, inklusive Stufen, Boni und **Verfall** (Punkte nach 24 Monaten, Codes nach 90 Tagen). **Bitte lesen und anpassen** (z. B. Mindestalter, Frist bei Programmende), dann **Sichtbar** schalten. Das ist eine Vorlage, keine Rechtsberatung. Ändert ihr später Fristen, Stufen oder Boni im Club-Admin, passt bitte auch diese Seite an. Den Verfall darf es für bereits gesammelte Punkte erst geben, wenn er in den Bedingungen steht.
2. Club-Admin → **Einstellungen → Verbindungen → Links** → Teilnahmebedingungen: `https://www.perfumecloud.de/pages/club` → **Speichern**.
3. **Datenschutzerklärung** im Shop (Einstellungen → Richtlinien) um einen Absatz ergänzen, Vorschlag:
   > **Perfume Cloud Club (Treueprogramm).** Wenn du dem Club beitrittst, verarbeiten wir in unserer Club-App (app.perfumecloud.de) deinen Namen, deine E-Mail-Adresse, deine Kundennummer, deine Bestellungen (Nummer, Datum, Betrag, Status, Artikel, Sendungsnummer), deinen Punktestand und deine Stufe, um das Treueprogramm durchzuführen (Art. 6 Abs. 1 lit. b DSGVO). Freiwillig kannst du deinen Geburtstag (Tag und Monat, für den Geburtstagsbonus) angeben, Push-Mitteilungen auf deinem Gerät erlauben und uns Feedback schicken. Push-Mitteilungen schaltest du in der App jederzeit wieder aus. Die Anmeldung läuft über dein Shopify-Kundenkonto. Die App wird bei der netcup GmbH, Daimlerstraße 25, 76185 Karlsruhe, gehostet. Wenn du austrittst, löschen wir deine Club-Daten; Bestelldaten bleiben im Rahmen der gesetzlichen Aufbewahrungspflichten im Shop gespeichert.
4. **Link im Shop:** Im Footer des Themes steht schon „Web-App · Bald“. Sobald die App läuft, dort auf `https://app.perfumecloud.de` verlinken (Onlineshop → Themes → Anpassen → Footer). Gerne auch einen Menüpunkt „Club“ im Hauptmenü. Claude ändert das Live-Theme nur nach eurer Freigabe.

---

## Teil F – Einmal selbst testen

1. Im Club-Admin unter **Treueprogramm** kurz **Testbestellungen zählen** einschalten → Speichern.
2. Auf dem Handy `https://app.perfumecloud.de` öffnen → **Anmelden oder Konto erstellen** → Code aus der Mail → **Jetzt beitreten**. Es erscheinen 50 Punkte.
3. Im Shop mit demselben Konto eine Testbestellung machen (Bogus Gateway oder Testmodus). Unter **Bestellungen** taucht sie auf, die Punkte stehen bei „unterwegs“.
4. In der App unter **Konto** die **Mitteilungen einschalten** (auf dem iPhone die App vorher zum Home-Bildschirm hinzufügen und von dort öffnen).
5. Im Club-Admin bei dir selbst unter **Mitglieder** z. B. 100 Punkte gutschreiben. Es kommt eine Push-Mitteilung mit Grund und Punktzahl. Dann in der App unter **Prämien** einen 5-€-Code erstellen und mit **Im Shop einlösen** prüfen, dass der Rabatt im Warenkorb steht.
6. Den Code in der App **zurückgeben**, **Testbestellungen zählen** wieder **ausschalten**.

Als Team-Mitglied landest du nach der Anmeldung im Admin-Bereich (Teil H). Die Ansicht für Mitglieder öffnest du dort oben mit **Kundenansicht**.

---

## Teil G – Updates automatisch (optional)

Die FTP-Secrets aus der Team-App (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`) gelten auch hier. Zusätzlich auf GitHub unter **Settings → Secrets and variables → Actions → Variables** anlegen:
- `CLUB_FTP_DIR` = `app.perfumecloud.de/httpdocs/`
- `CLUB_DEPLOY_ENABLED` = `true`

Danach landet jede Änderung an der Kunden-App automatisch auf netcup.

---

## Teil H – Mit der Team-App verbinden

Danach teilen sich Club und Team-App **eine Datenbank** (alle Club-Tabellen beginnen mit `club_`) und **dieselben Benutzer**: Wer in der Team-App Admin ist, ist auch Club-Admin. Die Team-App zeigt die Club-Statistik und verschickt Nachrichten an Mitglieder.

**Voraussetzung:** Team-App **Version 1.3** ist hochgeladen (Upload wie in der Team-App-Anleitung, Teil A5, oder automatisch per Teil E dort). Bei beiden Subdomains steht **open_basedir** auf `{WEBSPACEROOT}` (A3), damit der Club die Zugangsdaten der Team-App lesen darf.

### H1 · Datenbank umziehen (einmalig)
1. Club-Admin → **Einstellungen → System → Datenbank**.
2. Der Pfad zur `config.php` der Team-App wird meist automatisch gefunden. Sonst eintragen: `/var/www/vhosts/perfumecloud.de/team.perfumecloud.de/httpdocs/config.php`.
3. **In die Team-Datenbank umziehen** → **Umziehen**. Die App kopiert alle Club-Daten, prüft die Anzahl der Einträge und stellt erst dann um. Die alte SQLite-Datei bleibt als Sicherung in `storage`.
4. Danach neu anmelden, jetzt mit dem **Team-App-Konto** (E-Mail und Passwort der Team-App).

### H2 · Rechte
- **Admins der Team-App** haben immer Zugriff auf den Club-Admin und den Bereich **Members Club**.
- Für andere im Team: Team-App → **Einstellungen → Team** → bei der Person auf **Club-Zugang** tippen (oder im Club-Admin unter **Einstellungen → Zugänge**).
- Personen ohne Team-App (z. B. eine Agentur) bekommen unter **Zugänge → Eigene Club-Zugänge** ein eigenes Konto.

### H3 · Anmeldung mit der E-Mail erkennen
Club-Admin → **Einstellungen → Zugänge → Anmeldung für das Team** → **Einschalten**. Meldet sich jemand aus dem Team in der Club-App an (Shopify-Kundenkonto oder E-Mail-Code mit **derselben E-Mail** wie in der Team-App), landet die Person direkt im Admin-Bereich. Oben über **Kundenansicht** sieht sie die App wie ein Mitglied.

### H4 · Team-App einstellen
1. Team-App → **Einstellungen → Integrationen → Members Club**. Mit gemeinsamer Datenbank ist alles schon ausgefüllt (grüner Haken). Sonst Adresse und Schlüssel aus Club-Admin → **Einstellungen → System → Verbindung zur Team-App** kopieren und **Speichern & testen**.
2. Im Menü der Team-App erscheint **Members Club**:
   - **Statistik:** Mitglieder, Verteilung auf Bronze/Silber/Gold, gesammelte und eingelöste Punkte, eingelöste Prämien, offene Punkte, Beitritte je Monat, Extra-Punkte, Bestellungen von Mitgliedern, Feedback.
   - **Nachricht an Mitglieder senden:** Push an alle Mitglieder, an Silber und Gold oder nur an Gold, mit Vorlagen wie **Neuer Duft**, **Früher Zugang (Gold)** oder **Wieder da**. Ablauf: schreiben → **Zur Prüfung geben** → **Freigeben** (sofort oder zum geplanten Zeitpunkt). Mit dem **Vier-Augen-Prinzip** (Club-Admin → Einstellungen → Verbindungen → Mails und Mitteilungen) gibt immer jemand anderes frei. Auch eine **Feedback-Anfrage** (Gut / Neutral / Schlecht) lässt sich so verschicken.
   - **Club-Admin öffnen:** öffnet den Admin-Bereich mit einem Klick, ohne erneute Anmeldung.

---

## Teil I – Punkteanzeige im Shop

Im Shop steht dann z. B. im Warenkorb **„Mit dieser Bestellung sammelst du 59 Punkte.“** Die Zahl rechnet sich sofort neu, wenn sich der Warenkorb ändert, und berücksichtigt Stufe und laufende Aktion. Im Header zeigt ein kleiner Chip den Punktestand, mit **+N** für den aktuellen Warenkorb. Gäste sehen „Im Club sammelst du …“ mit Link zum Beitritt. Eine Seite **Club-Regeln** erklärt Sammeln, Einlösen, Stufen und Boni.

Alle Zahlen kommen aus dem Shop-Metafeld `club.programm`, das die App bei jeder Änderung im Admin neu schreibt. Ändert ihr Punkte je Euro, Stufen, Boni oder eine Aktion, ändern sich die Texte im Shop von selbst.

### I1 · Vorschau ansehen
Shopify-Admin → **Onlineshop → Themes** → **Club-Vorschau (Punkteanzeige)** → **⋯ → Vorschau**. Zum Ausprobieren: etwas in den Warenkorb legen, `/cart` öffnen, Menge ändern. Die Club-Regeln stehen in der Vorschau auf der Startseite vor den Fragen.

### I2 · Ins Live-Theme übernehmen (nur nach eurer Freigabe)
Am einfachsten: Claude Bescheid sagen, dann überträgt Claude die Dateien ins Live-Theme. Von Hand: im Live-Theme **⋯ → Code bearbeiten** und die Dateien aus `kunden-app/shopify-theme/` anlegen:

| Datei | Was |
|---|---|
| `assets/club.css`, `assets/club.js` | Aussehen und Live-Rechnung |
| `snippets/club-daten.liquid`, `club-kopf.liquid`, `club-punkte.liquid` | Daten, Header-Chip, Punktezeile |
| `sections/club-warenkorb.liquid` + `templates/cart.json` | Warenkorb-Seite mit Punkten |
| `sections/club-regeln.liquid` + `templates/page.club.json` | Abschnitt „Club-Regeln“ und Seitenvorlage `club` |

Dann in `sections/kopf.liquid` direkt vor dem Konto-Link eine Zeile einfügen: `{% render 'club-kopf' %}`.

**Club-Regeln auf eine Seite bringen:** im Theme-Editor auf einer Seite **Abschnitt hinzufügen → Club-Regeln**, oder unter **Onlineshop → Seiten** einer Seite die Vorlage **club** geben. **Auf Produktseiten** (sobald es sie gibt): `{% render 'club-punkte', modus: 'produkt', cents: product.selected_or_first_available_variant.price %}`.

---

## Teil J – Willkommens- und Erinnerungs-Mail (Shopify)

Die App meldet Punkte, Versand und Aktionen per **Push**. Per Mail gehen nur Bestätigungen und Starts. Für zwei Mails nutzt ihr Shopify (Shopify Messaging, bis 10.000 Mails im Monat kostenlos). Die fertigen Vorlagen im Design der App liegen in `kunden-app/shopify-mails/`.

### J1 · Willkommen im Club
1. Shopify-Admin → **Marketing → Automatisierungen → Automatisierung erstellen → Benutzerdefiniert** (öffnet Shopify Flow).
2. **Auslöser:** **Kunde ist einem Segment beigetreten** → Segment **Club-Mitglieder**.
3. **Aktion:** **Marketing-E-Mail senden** → **E-Mail bearbeiten**. Betreff: `Willkommen im Perfume Cloud Club`. Den Inhalt löschen, **Abschnitt hinzufügen → Benutzerdefiniertes Liquid**, den Inhalt von `willkommen.html` hineinkopieren.
4. Testmail an euch schicken, dann **Automatisierung einschalten**.
5. Club-Admin → **Einstellungen → Verbindungen → Mails und Mitteilungen** → **Willkommensmail beim Beitritt** ausschalten, sonst kommen zwei Mails.

> ⚠️ Marketing-Mails bekommen nur Kundinnen und Kunden, die dem Newsletter zugestimmt haben. Wer das nicht hat, bekommt dann keine Willkommensmail (sieht die Begrüßung aber in der App). Soll **jedes** Mitglied eine bekommen, lasst den Flow weg und die Willkommensmail der App an; sie sieht genauso aus.

### J2 · „Du hast 5 € Rabatt bereit“
Wie J1, nur mit Segment **Club: Prämie einlösbar**, Betreff `Du hast 5 € Rabatt bereit` und dem Inhalt von `erinnerung-praemie.html`. Die App schickt zusätzlich eine Push-Mitteilung. Ändert ihr den Wert einer Prämie oder die Fristen, passt den Text in beiden Mails mit an (die Segment-Schwelle zieht die App selbst nach).

---

## Teil K – Warteliste einladen (Launch)

Wer im Shop den Tag **warteliste** trägt, bekommt beim Beitritt einmalig den **Startbonus** (Standard: 100 Punkte).

1. Club-Admin → **Einstellungen → Regeln & Stufen → Startbonus für die Warteliste**: Höhe, Frist für den Beitritt, Gültigkeit und ob er erst mit der ersten Bestellung (ab Mindestbestellwert) einlösbar wird. Speichern.
2. **Aktionen → Warteliste** → **Warteliste laden** (holt alle Kundenkonten mit dem Tag aus Shopify).
3. **Text der Einladung** prüfen (Platzhalter `{vorname}`, `{club}`, `{startbonus}`), **Testmail an mich**.
4. Erst wenn ihr startklar seid: **Einladungen starten**. Der Cronjob verschickt sie in Paketen (40 alle 15 Minuten), **Versand anhalten** stoppt jederzeit. Die Zahlen oben zeigen, wer eingeladen ist und wer schon beigetreten ist.

---

## Club-Admin im Alltag (`app.perfumecloud.de/admin`)

- **Übersicht:** Mitglieder, offene Punkte (und was sie als Rabatt wert wären), Club-Umsatz, Codes, Abgleich mit Shopify, Checkliste für die Einrichtung.
- **Mitglieder:** suchen, Stufe, Verlauf und Codes ansehen, **Punkte gutschreiben oder abziehen** (mit Grund, den das Mitglied in der Push-Mitteilung und im Verlauf sieht – z. B. als Entschuldigung bei einer verspäteten Lieferung), Link zum Kunden im Shopify-Admin.
- **Aktionen:**
  - **Punkte-Aktionen:** z. B. „Launch-Woche“ oder „Black Friday“ mit **doppelten Punkten** (oder 1,5×, 3× …) von–bis, auf Wunsch mit Push zum Start. Läuft eine Aktion, steht sie in der App und im Shop.
  - **Bewertungen:** Mitglieder melden eine Bewertung, ihr bestätigt sie hier, dann gibt es die Punkte.
  - **Warteliste:** siehe Teil K.
  - **Feedback:** alle Antworten (Gut / Neutral / Schlecht mit Begründung). Jede geht zusätzlich per Mail an info@.
- **Push:** alle Mitteilungen mit Text und Vorschau zum Bearbeiten und Ein-/Ausschalten (Versand, Zustellung, Punkte gutgeschrieben/abgezogen/eingelöst, Prämie bereit, Verfall, Stufe, Geburtstag, Empfehlung, Aktion). Platzhalter wie `{punkte}`, `{grund}`, `{kontostand}`, `{vorname}`. **Ruhezeit** (Standard 21–8 Uhr): Mitteilungen warten bis morgens. Zahlen zu Zustellungen und Fehlern stehen oben.
- **Einstellungen:**
  - **Regeln & Stufen:** Punkte je Euro, Wert einer Prämie, Höchstwert je Code, Kombinierbarkeit, Einlösen pausieren; **Verfall** (Punkte nach Monaten, Codes nach Tagen, Erinnerung vorher); **Stufen** Bronze/Silber/Gold mit Punkten je Euro, Schwelle und Vorteilen; **Bonuspunkte**; **Startbonus**. Gilt sofort, App-Texte und Shop ziehen automatisch nach.
  - **Verbindungen:** Shopify-App, Kundenkonto-Anmeldung, E-Mail-Versand, Mails und Mitteilungen (Willkommensmail, Vier-Augen-Prinzip, Feedback-Adresse), Links.
  - **Zugänge:** siehe Teil H.
  - **System:** Datenbank, Verbindung zur Team-App, Cronjob, Version.

### So rechnet die App
- Punkte = **Warenwert nach Rabatten, ohne Versand** in Euro × **Punkte je Euro der Stufe** × **Aktionsfaktor**, abgerundet. Beispiel Silber (1,5) in einer 2×-Aktion: 59 € → 177 Punkte. Überschneiden sich Aktionen, gilt die höchste.
- **Stufen:** maßgeblich ist der Einkaufswert der letzten 12 Monate (Standard: Silber ab 150 €, Gold ab 400 €). Wer aufsteigt, steigt sofort auf und behält die Stufe mindestens 12 Monate.
- **Unterwegs**, solange die Bestellung nicht bezahlt oder nicht versendet ist und bis die **Wartezeit nach dem Versand** (14 Tage) vorbei ist. Danach **verfügbar**.
- **Storniert/erstattet:** Punkte entfallen bzw. werden anteilig angepasst.
- **Einlösen:** Punkte werden sofort abgebucht, dann entsteht in Shopify ein Rabattcode (`PC-XXXX-XXXX`, einmal, nur für dieses Kundenkonto, Mindestbestellwert = Rabatt). Klappt Shopify nicht, gehen die Punkte automatisch zurück.
- **Verfall:** Punkte verfallen 24 Monate nach der Gutschrift (älteste zuerst), vorher kommt eine Push-Erinnerung. Codes gelten 90 Tage; abgelaufene Codes werden in Shopify gelöscht und geben die Punkte zurück (abschaltbar). Wird ein abgelaufener Code doch noch benutzt, bucht die App die Punkte wieder ab. 0 Monate = Punkte verfallen nie.
- **Boni** (0 schaltet einen Bonus aus): Geburtstag (einmal im Jahr, frühestens 30 Tage nach dem Eintragen), Newsletter (einmalig, stündlicher Abgleich mit Shopify), Bewertung (nach Bestätigung, höchstens 2 im Monat), **Empfehlung**: Das neue Mitglied tritt über den Einladungslink bei und bekommt seinen Bonus mit der ersten Bestellung, das werbende Mitglied bekommt seinen, sobald diese Bestellung gutgeschrieben ist (nur Neukunden, Obergrenze je Jahr).

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
| Keine Push-Mitteilungen | App vom **Home-Bildschirm** öffnen (iPhone ab iOS 16.4), unter **Konto** Mitteilungen einschalten. Im Admin unter **Push** stehen Zustellungen und Fehler. Läuft die Ruhezeit, kommen sie morgens. Ohne Cronjob (Teil D) wird nichts verschickt. |
| Team-Mitglied landet nicht im Admin | **Zugänge → Anmeldung für das Team** muss an sein und die E-Mail exakt der in der Team-App entsprechen. Nicht-Admins brauchen **Club-Zugang** (H2). |
| Umzug der Datenbank meldet einen Fehler | Pfad zur `config.php` prüfen, **open_basedir** beider Subdomains auf `{WEBSPACEROOT}`. Es wurde nichts umgestellt, der Club läuft mit der alten Datenbank weiter. |
| Team-App: „Club noch nicht verbunden“ | Teil H4: Adresse und Schlüssel aus Club-Admin → System eintragen. Die Adresse der App muss gespeichert sein (einmal in den Club-Einstellungen speichern). |
| Punkteanzeige im Shop fehlt | Die App hat das Metafeld `club.programm` noch nicht geschrieben: im Club-Admin einmal Einstellungen speichern oder auf der Übersicht **Jetzt abgleichen**. Ist der Warenwert 0, bleibt die Zeile ausgeblendet. |
| Mail aus Shopify kommt nicht an | Nur mit Newsletter-Einwilligung (Teil J). In Shopify Flow unter **Ausführungen** sieht man jeden Lauf. |
