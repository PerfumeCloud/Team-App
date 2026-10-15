# Team-App aufs Handy bringen – Schritt für Schritt

Die App ist eine **Web-App**: Sie liegt auf eurem netcup-Webhosting unter `https://team.perfumecloud.de` und wird von dort auf iPhone, Mac und Windows-PC installiert. Es gibt keinen App Store, kein Apple-Entwicklerkonto und **keine Zusatzkosten**.

| Teil | Wer | Dauer |
|---|---|---|
| **A – App online stellen** | Marius, einmalig am Computer | ca. 30–45 Min. |
| **B – App aufs iPhone** | jede:r auf dem eigenen iPhone | ca. 2 Min. |
| **C – Windows-PC / Mac** | wer möchte | ca. 1 Min. |
| **D – iPhone-Widget** | optional | ca. 3 Min. |
| **E – Updates automatisch** | optional, einmalig | ca. 10 Min. |
| **J – Members Club** | Marius, wenn der Club läuft | ca. 10 Min. |
| **Update auf 1.6** | Marius, wenn die App schon läuft | ca. 15 Min. |
| **K – Auswertungen und Datensicherung** | Marius | ca. 10 Min. |
| **L – Antworten, Kundeninfos und Versand** | alle | zum Nachlesen |
| **M – Probelauf für den Members Club** | Admins | ca. 10 Min. |

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

### A7 · Ben und Keanu einladen
1. In der App auf **Einstellungen**, dann **Team** und **Person hinzufügen**.
2. Name **Ben** und seine E-Mail eintragen. **Einladung per E-Mail schicken** bleibt an. Dann **Hinzufügen** klicken.
3. Ben bekommt eine Mail von info@ mit einem Link. Darüber legt er sein Passwort selbst fest und ist sofort angemeldet. Der Link gilt 14 Tage und nur einmal.
4. Dasselbe für **Keanu**.

Kommt die Mail nicht an (z. B. weil info@ noch nicht verbunden ist, siehe A8), zeigt die App den **Einladungslink** an. Mit **Teilen** geht er per WhatsApp oder iMessage raus. Später schickt **Einladen** neben dem Namen einen neuen Link.

> Wurde eine Person gelöscht und wird mit derselben E-Mail neu angelegt, holt die App das alte Konto zurück, statt „E-Mail existiert bereits“ zu melden. Alternativ unter **Integrationen → Wartung → Gelöschte Personen** auf **Wiederherstellen** tippen.

### A8 · Postfächer verbinden (info@, support@ und persönliche)
1. Den IMAP-Server nachsehen: In Plesk auf **E-Mail**, eine Adresse anklicken und dann die Einstellungen für E-Mail-Programme öffnen. Bei euch ist das **`mxf938.netcup.net`** (steht auch im MX-Eintrag der Domain).
2. In der App auf **Einstellungen**, dann **Integrationen** und zu **Postfächer**. info@ und support@ sind schon eingetragen.
3. Bei beiden den **IMAP-Server**, Port **993** und das **Passwort** des Postfachs eintragen.
4. Persönliche Adressen wie `marius.heub@perfumecloud.de` mit **Postfach hinzufügen** ergänzen. Bei **Sichtbar für** nur die Person antippen, der das Postfach gehört. **Alle im Team** heißt: alle sehen die Mails.
5. Auf **Speichern & testen** klicken. Erscheint ein grüner Haken, holt die App ab jetzt die Mails.

Über **info@** verschickt die App auch die Einladungs-Mails (A7). Dafür muss das Passwort von info@ hier eingetragen sein.

**Mails verschicken** (gleiche Seite, weiter unten): Hier steht, über welches Postfach die App verschickt. Bei netcup ist der Server für den Versand derselbe wie für den Abruf, Port **465** (SSL/TLS) oder **587** (STARTTLS). Feld leer lassen = wie beim Abruf. Mit **Testmail an …** prüfen, ob der Versand klappt. Beim Postfach zeigt **Prüfen**, ob Abruf und Versand funktionieren, und schickt eine Testmail an das Postfach selbst.

### A9 · Shopify verbinden
1. <https://dev.shopify.com> öffnen und mit deinem Shopify-Konto (Shop-Inhaber) anmelden.
2. Auf **Apps** und dann **App erstellen** klicken, Name `Perfume Cloud Team`.
3. Bei der App-Version unter **Zugriffsbereiche / Scopes** diese drei anhaken: `read_orders`, `read_products`, `read_inventory`. Für Kundeninfos, „Versenden“ und den Probelauf kommen drei weitere dazu (siehe **A9a**), die könnt ihr gleich mit anhaken. Dann die Version **freigeben**.
4. Die App im Shop **Perfume Cloud** **installieren**.
5. In den **Einstellungen** der App die **Client-ID** und das **Client-Secret** kopieren.
6. In der Team-App auf **Einstellungen**, dann **Integrationen** und zu **Shopify**. Die myshopify-Adresse `ks8yin-mg.myshopify.com` ist schon eingetragen. Client-ID und Secret einfügen und **Speichern & testen** klicken.
7. Nach etwa einer Minute füllt sich die **Statistik**.

### A9a · Weitere Shopify-Rechte (ab Version 1.5)
Ohne diese Rechte läuft die App weiter, nur die jeweilige Funktion fehlt.

| Berechtigung | Wofür | Ohne sie |
|---|---|---|
| `read_customers` + geschützte Kundendaten (Name, E-Mail, Adresse) | **Kundeninfos** neben einer Mail: Bestellungen, Versandstatus, Ort, Club-Stufe | keine Kundeninfos |
| `write_merchant_managed_fulfillment_orders` | **Versenden**: Sendungsnummer in Shopify eintragen und die Bestellung als versendet markieren | Versand-Liste nur zum Ansehen |
| `write_orders` | **Probelauf** im Members Club: die Testbestellung am Ende automatisch stornieren (Artikel zurück ins Lager) | Testbestellung von Hand im Shopify-Admin stornieren |

1. <https://dev.shopify.com> → **Apps** → **Perfume Cloud Team** → **Versionen** → **Version erstellen**. Bei den **Scopes** die drei bisherigen behalten und `read_customers`, `write_merchant_managed_fulfillment_orders` und `write_orders` dazu anhaken → **Freigeben**.
2. **Geschützte Kundendaten** freischalten. Shopify gibt Name, E-Mail und Adresse von Kundinnen und Kunden nur heraus, wenn die App das angibt:
   - In der App im Dev Dashboard den Punkt **Protected customer data access** (geschützte Kundendaten) öffnen. Findet ihr ihn dort nicht: <https://partners.shopify.com> → **Apps** → **Perfume Cloud Team** → **API-Zugriffsanfragen**.
   - **Protected customer data** → **Zugriff anfragen**, Grund z. B. „Kundenservice: Bestellungen und Versandstatus zur Absenderadresse einer Mail anzeigen“ → **Speichern**.
   - Darunter bei den **Feldern** **Name**, **E-Mail** und **Adresse** anhaken (Telefon braucht die App nicht), jeweils denselben Grund → **Speichern**.
   - Bei einer App nur für den eigenen Shop prüft Shopify das nicht, die Freigabe gilt sofort.
3. Shopify-Admin → **Apps** → **Perfume Cloud Team**: Fragt Shopify nach den neuen Rechten, **Aktualisieren** bzw. **Installieren** bestätigen.
4. Team-App → **Einstellungen → Integrationen → Shopify** → **Speichern & testen**. Fehlt noch etwas, nennt die App die fehlenden Rechte. Darunter mit **Kundeninfo testen** eine echte Kunden-Adresse oder Bestellnummer (z. B. `#1042`) eingeben: Es erscheinen Bestellungen, Ort und Club-Stufe.

Steht bei „Kundeninfo testen“ „Shopify verweigert den Zugriff auf Kundendaten“, fehlt Schritt 2.

### A10 · Cronjob und Sofort-Abruf (Push wenige Sekunden nach einer neuen Mail)
Ab Version 1.4 hält die App die Verbindung zu euren Postfächern offen. Der Mailserver meldet jede neue Mail in dem Moment, in dem sie ankommt (IMAP IDLE), und die Push-Nachricht ist nach wenigen Sekunden auf dem Handy. Neue Bestellungen holt sie alle 20 Sekunden. Gestartet und am Laufen gehalten wird das von einer geplanten Aufgabe in Plesk, **jede Minute**.

1. In der App auf **Einstellungen**, dann **Integrationen** und zu **Sofort-Abruf & Cronjob**. Beim **Skript** auf **Kopieren** klicken.
2. In Plesk auf **Geplante Aufgaben**. Gibt es schon eine Aufgabe für die Team-App (z. B. „URL abrufen“ alle 5 Minuten), sie **bearbeiten**, sonst **Aufgabe hinzufügen**.
3. Eintragen:
   - **Aufgabentyp:** PHP-Skript ausführen
   - **Skriptpfad:** der kopierte Pfad (endet auf `app/bin/cron.php`), PHP-Version **8.3**
   - **Ausführen:** Cron-Stil `* * * * *` (jede Minute)
   - **Benachrichtigung:** keine
4. Mit **OK** speichern. Nach ein bis zwei Minuten steht in der App ein grüner Kasten **Sofort-Abruf aktiv**, bei jedem Postfach **sofort**. Nach der ersten neuen Mail steht dort auch, wie viele Sekunden es bis zur Meldung gedauert hat.

**Statt „PHP-Skript ausführen“** geht auch **URL abrufen** mit der Adresse darunter, ebenfalls jede Minute. Das klappt aber nur, wenn PHP bei euch als FPM läuft (Plesk → PHP-Einstellungen → „FPM-Anwendung“). Sonst holt die App die Mails dabei nur einmal pro Minute.

✅ **Teil A ist erledigt, die App ist online.**

---

## Teil B – App aufs iPhone (jede:r, 2 Minuten)

Voraussetzung: **iOS 16.4 oder neuer**. Die Version steht unter Einstellungen → Allgemein → Info.

> **Am einfachsten:** **`team.perfumecloud.de/app`** öffnen. Die Seite erkennt das Gerät und zeigt genau die passenden Schritte, ganz ohne Anmeldung. Am Computer steht dort ein QR-Code: mit der iPhone-Kamera scannen, fertig. Den Link könnt ihr euch auch gegenseitig schicken (in der App unter **Einstellungen → App auf weiteren Geräten**).
>
> Warum nicht aus dem App Store? Die App kommt direkt von eurem Server und aktualisiert sich selbst. Für den App Store bräuchte es ein Apple-Entwicklerkonto (99 € im Jahr) und Apples Prüfung bei jedem Update.

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
1. **`https://team.perfumecloud.de/app`** öffnen und auf **App installieren** klicken. (Oder: rechts in der Adressleiste auf das Symbol **App installieren** klicken, Bildschirm mit Pfeil. Alternativ im Menü **⋯** → **Apps** → **Diese Website als App installieren**.)
2. Auf **Installieren** klicken. Die App öffnet sich in einem eigenen Fenster, erscheint im Startmenü und lässt sich an die Taskleiste anheften.
3. In der App anmelden und unter **Einstellungen**, **Benachrichtigungen** auf **Aktivieren** klicken.
4. Rechtsklick auf das Icon in der Taskleiste zeigt Kurzbefehle: **Postfach**, **Planung**, **Kalender**, **Idee festhalten**.

Benachrichtigungen kommen auch bei geschlossenem App-Fenster, solange der Computer läuft.

**Mac (Safari):** Die Seite öffnen und im Menü **Ablage** auf **Zum Dock hinzufügen** klicken.

---

## Teil D – iPhone-Widget (optional)

1. Die kostenlose App **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** aus dem App Store laden.
2. In der Team-App auf **Einstellungen**, dann **iPhone-Widget** und **Widget-Skript erstellen**, danach **Skript kopieren**.
3. **Scriptable** öffnen, oben rechts auf **+** tippen und den Text einfügen. Oben als Namen **Perfume Cloud** eintragen und **Fertig** tippen.
4. Auf dem Home-Bildschirm auf eine freie Stelle lange drücken. Dann **Bearbeiten**, **Widget hinzufügen**, **Scriptable** wählen, eine Größe (klein, mittel oder groß) auswählen und **Widget hinzufügen** tippen.
5. Das neue Widget lange drücken, **Widget bearbeiten** wählen und bei **Script** **Perfume Cloud** auswählen.
6. **Kalender-Widget:** ein zweites Widget hinzufügen, ebenfalls **Perfume Cloud** wählen und bei **Parameter** `kalender` eintragen. Es zeigt die nächsten Termine, Feiertage und Aktionstage.

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

## Teil F – Ideen-Assistent (Notizen, Aufgaben und Termine aus einem Satz)

In der App auf **Ideen** (oder auf der Übersicht ins Feld **„Idee oder Aufgabe festhalten“**) einfach losschreiben oder mit dem Mikrofon der iPhone-Tastatur diktieren. Der Assistent schlägt eine Notiz, Aufgaben und Termine vor. Alles lässt sich vor dem **Übernehmen** noch ändern oder abwählen. Er läuft ohne KI direkt in der App, kostet nichts und funktioniert auch offline.

| Schreibweise | Ergebnis |
|---|---|
| `@Ben`, „Ben macht …“, „Keanu kümmert sich um …“, „ich …“ | zuständige Person |
| „morgen“, „Freitag“, „nächste Woche Freitag“, „15.11.“, „Ende des Monats“, „KW 47“, „Black Friday“ | Fälligkeit |
| `!`, „dringend“, „wichtig“ · „irgendwann“, „nicht dringend“ | Priorität hoch · niedrig |
| `#Marketing` | Kategorie (sonst wird eine passende vorgeschlagen) |
| Zeilen mit `-`, darunter eingerückte Zeilen | einzelne Aufgaben mit Checkliste |
| „Shooting vorbereiten: Flakons, Licht und Hintergrund“ | Aufgabe mit Checkliste |
| kurze Überschrift über einer Liste | Notiz mit diesem Titel, Überschrift wird Kategorie der Aufgaben |
| „Meeting mit Ben Freitag 14 Uhr im Büro“, „Messe vom 20. bis 24.10. in Köln“, „Zahnarzt Donnerstag 9:30“ | Termin im Kalender (Uhrzeit, Ort, Teilnehmer) |
| „Meeting am Freitag vorbereiten“, „Angebot bis 12 Uhr schicken“ | bleibt eine Aufgabe |
| „Notiz:“ am Anfang | nur eine Notiz |

Beispiel: *„Wir sollten im November einen Adventskalender mit 24 Proben machen, Ben kümmert sich um die Fotos bis Freitag, Keanu um die Verpackung“* → Notiz „Adventskalender …“ und zwei Aufgaben: **Fotos** (Ben, Freitag) und **Verpackung** (Keanu).

Beispiel: *„Kundentermin Mittwoch 11 Uhr, danach Pakete packen“* → Termin **Kundentermin** (Mittwoch, 11–12 Uhr) und Aufgabe **Pakete packen**. Oben lässt sich mit **Termin** auch alles als Termin erzwingen.

## Teil G – Persönliche Postfächer und Push für Mails

Neben info@ und support@ lassen sich **persönliche Firmen-Postfächer** verbinden, z. B. `marius.heub@perfumecloud.de`. Ein persönliches Postfach sieht **nur die Person**, für die es freigegeben ist. Nur sie bekommt auch die Push-Nachrichten dazu.

- **Marius (Admin)** trägt alle Postfächer unter **Einstellungen → Integrationen → Postfächer** ein und legt bei **Sichtbar für** fest, wer sie sieht (siehe A8).
- Alternativ verbindet jede Person ihr eigenes Postfach selbst unter **Einstellungen → Mein Postfach**: E-Mail-Adresse und Passwort des Postfachs eintragen (IMAP-Server `mxf938.netcup.net`, Port `993`, Benutzername leer lassen), dann **Speichern & testen**.

Die Mails stehen danach unter **Postfach**. Persönliche Postfächer tragen ein 🔒.

**Push für Mails:** Unter **Einstellungen → Benachrichtigungen → Bei welchen Mails?** wählt jede Person selbst:

| Einstellung | Push bei … |
|---|---|
| **Jede neue** (Standard) | jeder neuen ungelesenen Mail, ohne Newsletter und automatische Mails |
| **Wirklich alle** | wirklich jeder Mail, auch Newsletter, automatische und schon gelesene |
| **Nur wichtige** | nur Mails, die die App als wichtig erkennt |

Immer gilt: nur aus Postfächern, die für diese Person sichtbar sind. Zwischen 22 und 7 Uhr ist Ruhe, morgens kommt eine Zusammenfassung.

## Teil H – Kalender

Unter **Kalender** stehen Termine, Meetings, Events und Fristen fürs Team.

- **Neuer Termin** (oder Doppelklick auf einen Tag): Titel, Art, Datum, Uhrzeit oder ganztägig, Ort, Teilnehmer und Erinnerung. Ohne Teilnehmer gilt der Termin fürs ganze Team.
- Wer eingetragen wird, bekommt eine **Push-Nachricht**. Vor dem Termin kommt die **Erinnerung**. Ein- und ausschalten lässt sich das unter **Einstellungen → Benachrichtigungen → Termine**.
- **Feiertage und Aktionstage** stehen automatisch drin und werden jedes Jahr neu berechnet: alle gesetzlichen Feiertage (rot) und Shop-Tage wie Valentinstag, Muttertag, Singles' Day, Black Week, Black Friday, Cyber Monday, Advent und Silvester (gelb). Marius wählt unter **Einstellungen → Integrationen → Kalender: Feiertage & Aktionstage** das **Bundesland**, damit auch regionale Feiertage wie Fronleichnam oder Allerheiligen dabei sind. Dort lassen sich beide Gruppen auch ausschalten. Im Kalender blendet der Schalter **Feiertage & Aktionstage** sie nur für dich aus.
- **In der iPhone-Kalender-App:** **Einstellungen → Kalender abonnieren → Abo-Link erstellen → Im Kalender abonnieren**. Dann erscheinen die Team-Termine samt Aktionstagen in der Kalender-App und ihren Widgets. Feiertage zeigt das iPhone dort schon selbst.
- **Widget:** siehe Teil D, Schritt 6.
- **Per Ideen-Chat:** siehe Teil F.

## Teil I – Wartung („Datenbank aktualisieren“)

Bekommt jemand keine Mails oder Push-Nachrichten oder sieht veraltete Daten, geht Marius auf **Einstellungen → Integrationen → Wartung**.

- Die Liste zeigt für jede Person: zuletzt online, Geräte mit Push, letzte erfolgreiche Push-Nachricht und sichtbare Postfächer. Dort steht auch, ob eine Einladung noch offen ist.
- **Datenbank aktualisieren** bringt die Datenbank auf den neuesten Stand und löst hängende Abgleiche. Außerdem entfernt es kaputte Push-Anmeldungen und lädt auf allen Geräten die Daten komplett neu. Es geht nichts verloren.
- Fehlen bei einer Person die Push-Geräte, muss sie auf ihrem iPhone unter **Einstellungen → Benachrichtigungen** einmal **Aktivieren** tippen (App vom Home-Bildschirm aus öffnen).

## Teil J – Members Club

Die Team-App zeigt die Kunden-App „Perfume Cloud Club“ (`app.perfumecloud.de`) mit an. Einrichtung des Clubs: [KUNDEN-APP.md](KUNDEN-APP.md), Verbindung dort in **Teil H**.

1. **Verbinden:** Liegt der Club in derselben Datenbank (Club-Admin → Einstellungen → System → **In die Team-Datenbank umziehen**), ist er automatisch verbunden. Sonst unter **Einstellungen → Integrationen → Members Club** Adresse und Schlüssel aus dem Club-Admin eintragen und **Speichern & testen**.
2. **Wer darf was:** Admins sehen den Members Club immer und sind auch im Club-Admin Admin. Für andere unter **Einstellungen → Team** bei der Person **Club-Zugang** tippen.
3. Im Menü (am Computer links) steht jetzt **Members Club**:
   - **Statistik:** Mitglieder, Verteilung auf Bronze, Silber und Gold, gesammelte und eingelöste Punkte, eingelöste Prämien, offene Punkte, Beitritte je Monat, Extra-Punkte, Bestellungen von Mitgliedern, Feedback.
   - **Nachricht an Mitglieder senden:** Push an alle Mitglieder, an Silber und Gold oder nur an Gold. Vorlagen: **Neuer Duft**, **Früher Zugang (Gold)**, **Wieder da**, **Probe zur Bestellung**, **Feedback-Anfrage** (Gut / Neutral / Schlecht) und **Freie Nachricht**. Ablauf: schreiben (mit Vorschau) → **Zur Prüfung geben** → **Freigeben & senden** oder zu einem Zeitpunkt planen. Ist im Club-Admin das Vier-Augen-Prinzip an, gibt jemand anderes frei.
   - **Club-Admin öffnen:** öffnet den Admin-Bereich des Clubs in einem neuen Fenster, ohne erneute Anmeldung.

4. **Probelauf** (nur Admins): siehe **Teil M**.
5. **Schlechte Bewertungen:** Ist im Club die Befragung nach der Lieferung an, wird jede Bewertung mit 2 Sternen oder weniger (einstellbar im Club-Admin) zu einer **Aufgabe** in der Planung (Priorität hoch, fällig heute, Kategorie „Kundenservice“). Darin stehen die Sterne je Duft, die Antworten, der Kommentar, Kontakt, Club-Stufe, der Link zur Bestellung in Shopify und ein Vorschlag für die Antwort aus dem Textbaustein „Entschuldigung …“. Gleichzeitig kommt ein Push „Unzufriedene Kundin“ (abschaltbar unter **Einstellungen → Benachrichtigungen**). Die App holt neue Hinweise jede Minute.

**Push testen:** Unter **Einstellungen → Benachrichtigungen** stehen alle deine Geräte. **Test senden** zeigt je Gerät „Test angekommen beim Push-Dienst“ oder den Fehler. Steht dort „Dieses Gerät ist beim Server nicht angemeldet“, auf **Neu anmelden** tippen.

## Update auf Version 1.6 (wenn die App schon läuft)

Gilt auch für das Update von 1.4 direkt auf 1.6. Alle Daten bleiben erhalten.

1. Neue **`perfumecloud-team-app-upload.zip`** wie in A5 nach `team.perfumecloud.de/httpdocs` hochladen und mit „Vorhandene Dateien ersetzen“ entpacken (oder automatisch über Teil E).
2. Die App einmal öffnen. Sie ergänzt die Datenbank selbst. Unter **Einstellungen** steht ganz unten „Version 1.6.0“. Falls etwas hakt: **Einstellungen → Integrationen → Wartung → Datenbank aktualisieren**.
3. **Shopify-Rechte erweitern** (A9a).
4. In der **Planung** liegt bei Marius die Aufgabe **„Postfach auswertung@perfumecloud.de anlegen“**. Abarbeiten wie in **Teil K**.
5. **Einstellungen → Vorlagen**: Textbausteine durchsehen (Teil L).
6. Den Club auf Version 1.2 bringen: [KUNDEN-APP.md](KUNDEN-APP.md), **Update 1.1 → 1.2**.

## Teil K – Auswertungen und Datensicherung

Alles unter **Einstellungen → Auswertungen** (nur Admins).

### K1 · Postfach `auswertung@perfumecloud.de`
Hierhin gehen der Wochenrückblick, die wöchentliche Datensicherung und künftige Auswertungen.
1. Plesk → **E-Mail** → **E-Mail-Adresse erstellen**: `auswertung@perfumecloud.de`, sicheres Passwort (in die Notion-Passwortliste).
2. Das Postfach in Apple Mail oder Outlook hinzufügen oder in Plesk eine Weiterleitung an eure eigenen Adressen einrichten.
3. Im Postfach eine Regel anlegen: Mails mit Betreff „Datensicherung“, die älter als 8 Wochen sind, löschen (siehe [DATENSCHUTZ-MERKLISTE.md](DATENSCHUTZ-MERKLISTE.md), Punkt 8).
4. Team-App → **Auswertungen** → **Auswertungsadresse**: Adresse prüfen (andere Adresse eintragen und **Speichern** geht jederzeit) → **Testmail**. Kommt sie an, die Aufgabe aus der Planung abhaken.

### K2 · Wochenrückblick
Umsatz, Bestellungen, Top-Düfte, Versand, Antwortzeit auf Kundenmails, erledigte Aufgaben und Club, kompakt zum Besprechen am Wochenende.
- **Automatisch verschicken**: Standard **freitags**, Uhrzeit wählbar. **Per Mail** an die Auswertungsadresse und/oder **als Push** ans Team (jede Person kann den Push unter **Benachrichtigungen** abschalten).
- **Vorschau** zeigt den Rückblick der laufenden Woche, **Jetzt an mich senden** schickt ihn nur an dich, **An Auswertungsadresse senden** sofort an alle.

### K3 · Datensicherung
Jede Nacht ab 2 Uhr sichert die App alle Daten von Team-App **und** Club verschlüsselt auf dem Server (14 Tage). Die Wochen-Sicherung geht zusätzlich per Mail an die Auswertungsadresse.
1. **Sicherungs-Passwort festlegen** (mindestens 10 Zeichen). Ohne Passwort wird nichts gesichert. Das Passwort **sofort in die Notion-Passwortliste**: Ohne es lässt sich keine Sicherung öffnen, auch nicht von Claude.
2. **Jetzt sichern**, dann **Letzte prüfen**: Die App öffnet die Sicherung probeweise und zeigt Tabellen und Einträge.
3. **Per Mail senden** schickt die neueste Sicherung an die Auswertungsadresse.
4. **Wiederherstellen** (in der Liste oder unter **Aus Datei wiederherstellen**, z. B. mit der Datei aus der Mail und ihrem Passwort, auch auf einem neuen Server) ersetzt alle Daten durch den Stand der Sicherung. Vorher legt die App automatisch eine Sicherung des aktuellen Stands an. Zur Bestätigung `WIEDERHERSTELLEN` eintippen.

## Teil L – Antworten, Kundeninfos und Versand

### L1 · Kundeninfos neben der Mail
Öffnest du im **Postfach** eine Kundenmail, steht daneben (am Handy über **Kunde**), was Shopify und der Club zur Absenderadresse wissen: Bestellungen mit Status und **Sendung verfolgen**, Ort, Newsletter, Club-Stufe und Punkte. Unter **Notizen des Teams** haltet ihr fest, was alle wissen sollten (z. B. „mag holzige Düfte, lieber per Mail“). Braucht A9a.

### L2 · Antworten aus der App
**Antworten** öffnet den Editor mit deiner **Signatur** (Einstellungen → Allgemein) und den **Textbausteinen** zum Antippen. Platzhalter wie `{vorname}`, `{bestellnummer}` oder `{sendungslink}` füllt die App aus Shopify und dem Club. Mit **Ursprüngliche Mail zitieren** und **Danach als erledigt markieren**. Aus info@ und support@ geht die Antwort mit dem Absendernamen und der Fußzeile aus **Einstellungen → Vorlagen → Absender & Fußzeile**, aus dem eigenen Postfach mit deinem Namen.

Textbausteine pflegen Admins unter **Einstellungen → Vorlagen**. Der Baustein, dessen Titel mit **„Entschuldigung“** beginnt, ist der Antwortvorschlag in den Aufgaben zu schlechten Bewertungen (Teil J).

### L3 · Versand
Unter **Versand** (am Handy über **Zu versenden** auf der Übersicht) stehen alle offenen Bestellungen. **Versenden** trägt die Sendungsnummer in Shopify ein und markiert die Bestellung als versendet, auf Wunsch mit Versandbestätigung an die Kundin. Die Nummer kannst du mit **Scannen** direkt vom Etikett lesen (Kamera). Den Versanddienst erkennt die App an der Nummer.

Unter **Einstellungen → Auswertungen → Versand**: **Erinnerung ab** (z. B. 2 Tagen: morgens ab 9 Uhr ein Push für liegengebliebene Bestellungen), vorausgewählter Versanddienst, Versandbestätigung an oder aus. Braucht A9a.

## Teil M – Probelauf für den Members Club

Einmal den ganzen Weg einer Bestellung durch den Club gehen, von „Bestellung eingegangen“ bis zum Stufenaufstieg, mit einem eigenen **Testkonto**. Nichts davon zählt in Statistik, Wochenrückblick, Mitgliederliste oder Newsletter. Nur Admins sehen den Bereich: **Members Club → Probelauf**.

Damit Push-Mitteilungen auf deinem Handy ankommen: in der Club-App (`app.perfumecloud.de`) mit **derselben E-Mail wie in der Team-App** anmelden und unter **Konto** Mitteilungen erlauben. Mails gehen an dieselbe Adresse.

**Schnelltest (simuliert):** Alles passiert im Club, kein Shop, keine echte Bestellung.
1. **Art: Schnelltest**, Bestellwert eingeben (für Punkte und Stufe) → **Probelauf starten**.
2. In der Liste die Schritte nacheinander **auslösen**: Versendet → Zugestellt → Befragung → Punkte gutgeschrieben → Empfehlung belohnt → Stufenaufstieg. Zu jedem Schritt steht, was passiert ist (z. B. welcher Push verschickt wurde).
3. **Befragung öffnen** zeigt die Bewertungsseite wie bei einer Kundin. Bewertest du dort mit 1 oder 2 Sternen, erscheint nach spätestens einer Minute (oder sofort mit **Jetzt abgleichen**) die Aufgabe in der Planung, zugewiesen an dich.
4. **Aufräumen** löscht alle Testdaten.

**Echte 0-€-Bestellung:** Ein echter Weg durch den Shop mit Kasse, Versandmail und Zustellung.
1. **Art: Echte 0-€-Bestellung** → **Probelauf starten**. Die App erzeugt zwei Einmal-Codes (`PROBE-…` für 100 % auf die Ware und `PROBE-…-VERSAND` für kostenlosen Versand) und zeigt den Link in den Shop.
2. Über den Link bestellen (er setzt den ersten Code), an der Kasse den Versand-Code dazu eingeben. Welches Kundenkonto du dabei nutzt, ist egal, die App erkennt die Bestellung am Code. Punkte und Stufe rechnet sie mit dem eingegebenen Bestellwert statt 0 €. Die Bestellung erscheint nach dem nächsten Abgleich (oder **Jetzt abgleichen**). Versand und Zustellung laufen echt über Shopify, die anderen Schritte lassen sich wie beim Schnelltest auslösen.
3. **Aufräumen** storniert die Bestellung in Shopify (Artikel zurück ins Lager, keine Mail an die Kundin) und löscht die Testdaten. Ohne `write_orders` (A9a) zeigt die App einen Link, dann in Shopify von Hand **Stornieren**.

Testbestellungen zählen nicht in Statistik und Wochenrückblick.

## Wenn etwas hakt

| Problem | Lösung |
|---|---|
| `team.perfumecloud.de` öffnet den Shop oder gar nichts | Der DNS-Eintrag (A2) fehlt oder ist noch nicht aktiv. Etwas warten. |
| „Hier entsteht eine neue Webseite“, „Forbidden“ oder eine Ordnerliste | Der Dokumentenstamm muss `team.perfumecloud.de/httpdocs/public` sein (A1). Ändern lässt er sich in Plesk unter **Hosting-Einstellungen**. |
| Anmeldeseite mit „Der Server meldet einen Fehler“ statt Einrichtung | PHP erreicht die App nicht. **open_basedir** prüfen (A3), dann **Erneut versuchen**. |
| Weiße Seite oder „Interner Fehler“ ohne `app.log` | In den **PHP-Einstellungen** bei **open_basedir** die Option mit `{WEBSPACEROOT}` wählen (A3). |
| Let's Encrypt schlägt fehl | Der DNS-Eintrag ist noch nicht aktiv. 30 Minuten warten. |
| „Interner Fehler“ | Die Details stehen in `team.perfumecloud.de/httpdocs/storage/app.log` (Plesk-Dateimanager). Den Inhalt Claude zeigen. |
| Keine Push-Nachricht auf dem iPhone | Die App über das **Home-Bildschirm-Icon** öffnen, nicht über Safari. Mindestens iOS 16.4. In den iPhone-Einstellungen unter **Mitteilungen**, **PC Team** erlauben. Ohne Cronjob (A10) gibt es bei geschlossener App keine Push-Nachrichten. Zwischen 22 und 7 Uhr kommen Mail-Pushs gesammelt am Morgen. |
| Push kommt erst nach Minuten | **Integrationen → Sofort-Abruf & Cronjob**: Steht dort nicht „Sofort-Abruf aktiv“, läuft die geplante Aufgabe nicht jede Minute oder ist noch „URL abrufen“ ohne FPM – auf „PHP-Skript ausführen“ mit `* * * * *` umstellen (A10). Steht bei einem Postfach „Fehler“, das Passwort unter **Postfächer** prüfen. |
| „Zum Home-Bildschirm“ fehlt | Die Seite in **Safari** öffnen, nicht in einer anderen App. |
| Passwort vergessen | Marius setzt unter **Einstellungen**, **Team**, **Passwort** ein neues. |
| Mail-Test rot | IMAP-Server und Postfach-Passwort prüfen, Port 993. |
| Shopify-Test rot | Client-ID und Secret neu kopieren. Prüfen, ob die drei Scopes angehakt sind und die App im Shop installiert ist. |
| „E-Mail existiert bereits“ beim Anlegen | Mit dieser Adresse gab es schon ein Konto. Neu anlegen holt es zurück. Oder **Integrationen → Wartung → Wiederherstellen**. |
| Einladungs-Mail kommt nicht an | Den angezeigten **Einladungslink** per WhatsApp schicken. Prüfen, ob info@ unter **Postfächer** mit Passwort verbunden ist. Auch im Spam-Ordner nachsehen. |
| Jemand bekommt keine Push-Nachrichten oder Mails | **Integrationen → Wartung**: Geräte-Status prüfen, dann **Datenbank aktualisieren** (Teil I). |
| Testmail kommt nicht an | **Integrationen → Mails verschicken**: Server leer lassen (wie beim Abruf) oder den Server des Postfachs eintragen, Port 465 oder 587. Beim Postfach **Prüfen** zeigt die genaue Fehlermeldung. |
| Members Club fehlt im Menü | Nur Admins und Personen mit **Club-Zugang** sehen ihn (Teil J). |
| Members Club: „Club noch nicht verbunden“ | Teil J, Schritt 1. Im Club-Admin muss die Adresse der App gespeichert sein (dort einmal Einstellungen speichern). |
| Keine Kundeninfos neben der Mail | A9a: `read_customers` und die geschützten Kundendaten (Name, E-Mail, Adresse) freigeben, App in Shopify aktualisieren, dann **Speichern & testen**. |
| „Versenden“ meldet fehlende Berechtigung | A9a: `write_merchant_managed_fulfillment_orders` freigeben. |
| Wochenrückblick oder Sicherung kommt nicht an | **Einstellungen → Auswertungen** → **Testmail**. Kommt sie nicht an: Postfach `auswertung@` anlegen (K1) und **Integrationen → Mails verschicken** prüfen. |
| „Letzte Sicherung fehlgeschlagen“ | Die Meldung darunter nennt den Grund. Ohne Sicherungs-Passwort wird nichts gesichert (K3). |
| Probelauf fehlt unter Members Club | Nur Admins sehen ihn. |
| Probelauf: „Push nur im Protokoll“ | In der Club-App mit derselben E-Mail wie in der Team-App anmelden und Mitteilungen erlauben (Teil M). |
| Probelauf: Aufräumen storniert nicht | `write_orders` fehlt (A9a). Die Bestellung im Shopify-Admin von Hand stornieren, „Artikel wieder auf Lager“ anhaken, „Kunden benachrichtigen“ aus. |
