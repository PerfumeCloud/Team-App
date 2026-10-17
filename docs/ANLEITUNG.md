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
| **M – Testbestellung für den Members Club** | Admins | ca. 10 Min. |
| **N – Instagram** | Marius einmalig (Meta-App), danach alle mit Zugang | ca. 20 Min. |
| **Update auf 1.7** | Marius, wenn die App schon läuft | ca. 5 Min. + Teil N |
| **O – Postfach: Ordner, Gesendet, Erledigt** | alle | zum Nachlesen |
| **P – Hilfe in der App** | alle | – |
| **Update auf 1.8** | Marius, wenn die App schon läuft | ca. 10 Min. |
| **Update auf 1.9** | Marius, zusammen mit Members Club 1.4 | ca. 10 Min. |

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
3. Bei der App-Version unter **Zugriffsbereiche / Scopes** diese drei anhaken: `read_orders`, `read_products`, `read_inventory`. Für Kundeninfos, „Versenden“ und die Testbestellung kommen drei weitere dazu (siehe **A9a**), die könnt ihr gleich mit anhaken. Dann die Version **freigeben**.
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
| `write_orders` | **Testbestellung** im Members Club: am Ende automatisch stornieren (Artikel zurück ins Lager) | Testbestellung von Hand im Shopify-Admin stornieren |

1. <https://dev.shopify.com> → **Apps** → **Perfume Cloud Team** → **Versionen** → **Version erstellen**. Bei den **Scopes** die drei bisherigen behalten und `read_customers`, `write_merchant_managed_fulfillment_orders` und `write_orders` dazu anhaken → **Freigeben**.
2. **Geschützte Kundendaten** freischalten. Shopify gibt Name, E-Mail und Adresse von Kundinnen und Kunden nur heraus, wenn die App das angibt:
   - In der App im Dev Dashboard den Punkt **Protected customer data access** (geschützte Kundendaten) öffnen. Findet ihr ihn dort nicht: <https://partners.shopify.com> → **Apps** → **Perfume Cloud Team** → **API-Zugriffsanfragen**.
   - **Protected customer data** → **Zugriff anfragen**, Grund z. B. „Kundenservice: Bestellungen und Versandstatus zur Absenderadresse einer Mail anzeigen“ → **Speichern**.
   - Darunter bei den **Feldern** **Name**, **E-Mail** und **Adresse** anhaken (Telefon braucht die App nicht), jeweils denselben Grund → **Speichern**.
   - Bei einer App nur für den eigenen Shop prüft Shopify das nicht, die Freigabe gilt sofort.
3. **Im Shop bestätigen** – sonst gelten die neuen Rechte nicht, auch wenn sie in der Version angehakt sind: Team-App → **Einstellungen → Integrationen → Shopify** → **In Shopify bestätigen**. Das öffnet in einem neuen Tab die Seite, auf der Shopify die neuen Rechte der Team-App zeigt (vorher im Shopify-Admin angemeldet sein) → **Aktualisieren** bzw. **Installieren**. Klappt das nicht, **App in Shopify öffnen** – auch dabei fragt Shopify nach den neuen Rechten. Ein „Verbindung verweigert“ danach ist egal.
   - Hinweis: Die Team-App hat bei Shopify keinen Kurznamen. Bis Version 1.8.0 führte der Knopf deshalb nur in die allgemeine App-Liste ohne Bestätigen-Knopf; ab 1.8.1 holt die App den richtigen Link direkt von Shopify.
   - Kommt gar keine Abfrage: im Dev Dashboard prüfen, dass die neueste Version **aktiv** ist und die Scopes als **Zugriffsbereiche** (nicht als „optionale“) eingetragen sind. Letzter Weg: Shopify-Admin → **Einstellungen → Apps** → **Perfume Cloud Team** → **Deinstallieren** und im Dev Dashboard wieder **installieren**. Die Team-App speichert nichts in Shopify, Client-ID und Secret bleiben gleich; danach **Speichern & testen**.
4. Zurück in der Team-App **Erneut prüfen**. Die App unterscheidet „Im Shop noch nicht bestätigt“ (Schritt 3 fehlt) und „In der App-Version fehlen“ (Schritt 1 fehlt); bei allen Rechten steht „alle Berechtigungen da“. Darunter mit **Kundeninfo testen** eine echte Kunden-Adresse oder Bestellnummer (z. B. `#1042`) eingeben: Es erscheinen Bestellungen, Ort und Club-Stufe.

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
7. **Club-Widget** (nur für Admins und Personen mit Club-Zugang): ein weiteres Widget hinzufügen und bei **Parameter** `club` eintragen. Es zeigt die Zahl der Mitglieder, wie viele heute und in den letzten 7 Tagen dazugekommen sind, die Verteilung auf Bronze, Silber und Gold, die neuesten Mitglieder (nur Vorname und erster Buchstabe des Nachnamens), die Durchschnittsbewertung der letzten 30 Tage und eine laufende Aktion. Antippen öffnet die Club-Seite der Team-App. Wer Club-Zugang hat, sieht die Mitgliederzahl außerdem im normalen Widget.

Die Club-Zahlen holt die Team-App höchstens alle 5 Minuten vom Club. Ist der Club kurz nicht erreichbar, zeigt das Widget bis zu einer Stunde die letzten Zahlen.

**Nach einem Update** der Team-App das Skript einmal neu kopieren (Schritte 2 und 3, dabei den alten Text in Scriptable ersetzen). Die Widgets auf dem Bildschirm bleiben, wie sie sind.

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

4. **Testbestellung** (nur Admins): siehe **Teil M**.
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
7. **iPhone-Widget**: Skript einmal neu kopieren und in Scriptable ersetzen (Teil D). Neu: das Club-Widget mit dem Parameter `club`.

## Update auf Version 1.7 (wenn die App schon läuft)

Neu: **Instagram** – Auswertung, Beiträge planen und veröffentlichen, Kommentare beantworten. Alle Daten bleiben erhalten.

1. Neue **`perfumecloud-team-app-upload.zip`** wie in A5 hochladen und mit „Vorhandene Dateien ersetzen“ entpacken (oder automatisch über Teil E).
2. Die App einmal öffnen. Unter **Einstellungen** steht ganz unten „Version 1.7.0“. Falls etwas hakt: **Einstellungen → Integrationen → Wartung → Datenbank aktualisieren**.
3. Instagram verbinden: **Teil N**.

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
**Antworten** öffnet den Editor mit deiner **Signatur** (Einstellungen → Allgemein, auch mit **Bild**, z. B. Logo oder eingescannte Unterschrift) und den **Textbausteinen** zum Antippen. Platzhalter wie `{vorname}`, `{bestellnummer}` oder `{sendungslink}` füllt die App aus Shopify und dem Club. Mit **Ursprüngliche Mail zitieren** und **Danach als erledigt markieren**. Aus info@ und support@ geht die Antwort mit dem Absendernamen und der Fußzeile aus **Einstellungen → Vorlagen → Absender & Fußzeile** (dort auch **Logo unter der Fußzeile**), aus dem eigenen Postfach mit deinem Namen. Bilder gehen eingebettet mit der Mail raus (bis 400 KB, Breite per Regler 60–600 Pixel). Die Fußzeile samt Logo übernimmt auch der Members Club für seine Mails (ab Club 1.3).

Textbausteine pflegen Admins unter **Einstellungen → Vorlagen**. Der Baustein, dessen Titel mit **„Entschuldigung“** beginnt, ist der Antwortvorschlag in den Aufgaben zu schlechten Bewertungen (Teil J).

### L3 · Versand
Unter **Versand** (am Handy über **Zu versenden** auf der Übersicht) stehen alle offenen Bestellungen. **Versenden** trägt die Sendungsnummer in Shopify ein und markiert die Bestellung als versendet, auf Wunsch mit Versandbestätigung an die Kundin. Die Nummer kannst du mit **Scannen** direkt vom Etikett lesen (Kamera). Den Versanddienst erkennt die App an der Nummer.

Unter **Einstellungen → Auswertungen → Versand**: **Erinnerung ab** (z. B. 2 Tagen: morgens ab 9 Uhr ein Push für liegengebliebene Bestellungen), vorausgewählter Versanddienst, Versandbestätigung an oder aus. Braucht A9a.

## Teil M – Testbestellung für den Members Club

Einmal den ganzen Weg einer Bestellung durch den Club gehen, von „Bestellung eingegangen“ bis zum Stufenaufstieg, mit einem eigenen **Testkonto**. Nichts davon zählt in Statistik, Wochenrückblick, Mitgliederliste oder Newsletter. Nur Admins sehen den Bereich: **Members Club → Testbestellung**. (Bis Version 1.7 hieß das „Probelauf“.)

Voraussetzung: Der Club läuft auf **Version 1.3** (KUNDEN-APP.md, „Update 1.2 → 1.3“). Ist er älter, meldet die Team-App „Der Members Club läuft noch auf Version …“ und verlinkt die Anleitung (in der App: **Hilfe → Members Club aktualisieren**).

Damit Push-Mitteilungen auf deinem Handy ankommen: in der Club-App (`app.perfumecloud.de`) mit **derselben E-Mail wie in der Team-App** anmelden und unter **Konto** Mitteilungen erlauben. Mails gehen an dieselbe Adresse.

**Simuliert (ohne Shop):** Alles passiert im Club, kein Shop, keine echte Bestellung.
1. **Art: Simuliert (ohne Shop)**, Bestellwert eingeben (für Punkte und Stufe) → **Testbestellung starten**.
2. In der Liste die Schritte nacheinander **Auslösen**: Versendet → Zugestellt → Befragung → Punkte gutgeschrieben → Empfehlung belohnt → Stufenaufstieg. Zu jedem Schritt steht, was passiert ist (z. B. welcher Push verschickt wurde).
3. **Befragung öffnen** zeigt die Bewertungsseite wie bei einer Kundin. Bewertest du dort mit 1 oder 2 Sternen, erscheint nach spätestens einer Minute (oder sofort mit **Jetzt abgleichen**) die Aufgabe in der Planung, zugewiesen an dich.
4. **Aufräumen** löscht alle Testdaten.

**Echt im Shop (0 €):** Ein echter Weg durch den Shop mit Kasse, Versandmail und Zustellung.
1. **Art: Echt im Shop (0 €)** → **Testbestellung starten**. Die App erzeugt zwei Einmal-Codes (`TEST-…` für 100 % auf die Ware und `TEST-…-VERSAND` für kostenlosen Versand) und zeigt den Link in den Shop.
2. Über den Link bestellen (er setzt den ersten Code), an der Kasse den Versand-Code dazu eingeben. Welches Kundenkonto du dabei nutzt, ist egal, die App erkennt die Bestellung am Code. Punkte und Stufe rechnet sie mit dem eingegebenen Bestellwert statt 0 €. Die Bestellung erscheint nach dem nächsten Abgleich (oder **Jetzt abgleichen**). Versand und Zustellung laufen echt über Shopify, die anderen Schritte lassen sich wie oben auslösen.
3. **Aufräumen** storniert die Bestellung in Shopify (Artikel zurück ins Lager, keine Mail an die Kundin) und löscht die Testdaten. Ohne `write_orders` (A9a) zeigt die App einen Link, dann in Shopify von Hand **Stornieren**.

Testbestellungen zählen nicht in Statistik und Wochenrückblick. Laufende Probeläufe aus Version 1.7 laufen weiter (Codes `PROBE-…` gelten bis zum Aufräumen).

## Teil N – Instagram

Die Team-App verbindet sich mit eurem Instagram-Konto. Im Menü (am Computer links, am Handy über **Statistik → Instagram**) gibt es dann:

- **Übersicht:** Follower und Zuwachs, erreichte Konten, Aufrufe, Interaktionen und Klicks auf Links (7 Tage, mit Vergleich zur Vorwoche), Verläufe, was bei euch funktioniert (Formate, Wochentage, Tageszeiten, Hashtags), die stärksten Beiträge, die Zielgruppe (Alter, Geschlecht, Städte, ab 100 Followern) und die nächsten geplanten Beiträge.
- **Beiträge:** alle Beiträge mit Reichweite, Likes, Kommentaren, Speicherungen und Interaktionsrate, sortier- und filterbar.
- **Planer:** Beiträge vorbereiten, prüfen, freigeben und veröffentlichen lassen.
- **Kommentare:** offene Kommentare der letzten 30 Tage, direkt aus der App beantworten.

Die Zahlen gleicht die App stündlich ab (braucht den Cronjob aus A10). Der **Wochenrückblick** (Teil K2) enthält Follower, erreichte Konten, offene Kommentare und den stärksten Beitrag der Woche.

**Voraussetzung:** Das Instagram-Konto ist ein **professionelles Konto** (Business oder Creator). Umstellen in der Instagram-App: **Einstellungen → Kontotyp und Tools → Zu professionellem Konto wechseln**. Eine Facebook-Seite braucht ihr nicht.

### N1 · Meta-App anlegen (Marius, einmalig, ca. 15 Min.)

Instagram erlaubt den Zugriff nur über eine eigene App im Meta-Entwicklerbereich. Sie ist kostenlos und nur für euer eigenes Konto. Eine Prüfung durch Meta ist dafür nicht nötig. Die Bezeichnungen im Dashboard können je nach Sprache leicht abweichen; die englischen stehen in Klammern.

1. <https://developers.facebook.com/apps> öffnen und mit einem Facebook-Konto anmelden. Beim ersten Mal fragt Meta, ob ihr euch als Entwickler registrieren wollt: bestätigen.
2. **App erstellen** (Create App). Name z. B. „Perfume Cloud Team“, Kontakt-E-Mail eintragen. Als **Anwendungsfall** (Use case) **„Nachrichten und Inhalte auf Instagram verwalten“** (Manage messaging & content on Instagram) wählen. Unternehmensportfolio: ein vorhandenes wählen oder „Ich möchte noch kein Unternehmensportfolio verbinden“. **App erstellen**.
3. Im Dashboard links **Anwendungsfälle** (Use cases) → beim Instagram-Anwendungsfall **Anpassen** (Customize) → **API-Einrichtung mit Instagram-Login** (API setup with Instagram login).
4. **Berechtigungen** (Permissions and features): bei diesen vier jeweils **Hinzufügen** (Add), falls sie nicht schon dabei sind:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_insights`
5. Oben auf der Seite **API-Einrichtung mit Instagram-Login** stehen **Instagram-App-ID** und **Instagram-App-Secret** (auf **Anzeigen** tippen). Beide braucht ihr in N2. Achtung: Die App-ID oben links im Dashboard ist die Facebook-App-ID, die passt **nicht**.
6. Weiter unten **Instagram-Business-Login einrichten** (Set up Instagram business login) → **Business-Login-Einstellungen** (Business login settings). Bei **OAuth-Weiterleitungs-URIs** (OAuth redirect URIs) die Adresse aus der Team-App eintragen (**Einstellungen → Integrationen → Instagram → Kopieren**), normalerweise `https://team.perfumecloud.de/api/instagram/callback`. **Speichern**.
7. Links **App-Rollen → Rollen** (App roles → Roles) → **Personen hinzufügen** → **Instagram-Tester** → euren Instagram-Benutzernamen eintragen. Dann auf <https://www.instagram.com/accounts/manage_access/> (mit dem Instagram-Konto angemeldet) unter **Tester-Einladungen** die Einladung **annehmen**.

> 🔐 Das App-Secret ist ein Passwort: nur in die Team-App und in die Notion-Passwortliste, nicht in Chats.

### N2 · In der Team-App verbinden (Marius)

1. **Einstellungen → Integrationen → Instagram**: Instagram-App-ID und Instagram-App-Secret eintragen → **Speichern**.
2. **Mit Instagram verbinden** → bei Instagram mit dem Konto anmelden, das ihr verbinden wollt → alle Berechtigungen erlauben. Danach geht es automatisch zurück, oben steht „Instagram verbunden mit @…“.
3. Der erste Abgleich lädt die Beiträge der letzten Monate. Die Zahlen je Beitrag kommen über die nächsten Stunden dazu (pro Stunde 30 Beiträge).

Der Zugang gilt 60 Tage und wird automatisch verlängert. Klappt das nicht (z. B. Instagram-Passwort geändert), bekommen die Admins eine Woche vor Ablauf einen Push und unter **Einstellungen → Integrationen → Instagram** steht ein Hinweis: dann **Neu verbinden**.

**Alternative ohne Weiterleitung:** In der Meta-App unter **API-Einrichtung mit Instagram-Login → Zugriffsschlüssel generieren** (Generate access tokens) das Konto hinzufügen und **Token generieren**. Den Schlüssel in der Team-App unter **Alternative: Zugangsschlüssel direkt einfügen** eintragen. App-ID und Secret trotzdem speichern, sonst kann die App ihn nicht verlängern.

### N3 · Wer darf was

- **Admins** sehen Instagram immer. Für andere unter **Einstellungen → Team** bei der Person **Instagram-Zugang** tippen.
- **Vier-Augen-Prinzip** (Einstellungen → Integrationen → Instagram, Standard: an): Freigeben muss jemand anderes als die Person, die den Beitrag vorbereitet hat.
- **Hashtag-Set**: eure Standard-Hashtags, im Planer mit einem Tipp unter den Text gesetzt.
- Push **„Instagram“** (Einstellungen → Benachrichtigungen): Beitrag zur Prüfung, freigegeben, veröffentlicht oder fehlgeschlagen, Erinnerung zum Posten, neue Kommentare.

### N4 · Beiträge planen

1. **Instagram → Planer → Neuer Beitrag** (oder direkt **Bild**, **Karussell**, **Story**, **Reel**).
2. **Fotos hinzufügen** (vom Handy oder Computer, auch iPhone-Fotos) oder **Bilder und Text aus dem Shop**. Die App schneidet auf das gewählte Format zu: **4:5** (empfohlen im Feed), **1:1**, **Quer** oder **Original**; Storys **9:16**. Mit den Pfeilen ändert ihr die Reihenfolge. Ab dem zweiten Bild wird ein Bild-Beitrag zum Karussell.
3. **Text** schreiben. Zähler für Zeichen (max. 2.200), Hashtags (max. 30) und Erwähnungen (max. 20). **Notiz fürs Team** wird nicht veröffentlicht.
4. **Zeitpunkt**: sofort nach der Freigabe oder geplant. Unter dem Feld steht, wann eure Beiträge laut Auswertung am meisten Konten erreichen.
5. Die **Vorschau** zeigt den Beitrag wie im Feed. **Zur Prüfung geben**.
6. Jemand anderes öffnet **Prüfen & freigeben**, sieht Vorschau und Details und tippt **Freigeben**. Oder **Zurückgeben** mit einem Satz, was fehlt.
7. Bei **Automatisch** veröffentlicht die App zum Zeitpunkt selbst (sofort fällige direkt nach der Freigabe). Ihr bekommt einen Push, im Planer steht der Beitrag unter **Veröffentlicht** mit Link und später mit Zahlen.
8. Bei **Erinnerung, selbst posten** (und immer bei **Reels**) kommt zum Zeitpunkt ein Push. **Jetzt posten** zeigt die Schritte: Text kopieren, Bilder sichern, in der Instagram-App posten, **Ist gepostet**. Den Link zum Beitrag könnt ihr dazuschreiben; ohne Link ordnet die App ihn beim nächsten Abgleich über den Text zu.

Geht beim Veröffentlichen etwas schief, steht der Grund am Beitrag unter **Nicht veröffentlicht** und es kommt ein Push: **Erneut versuchen** oder **Bearbeiten**. Wer einen freigegebenen Beitrag ändert, macht ihn wieder zum Entwurf; er muss neu geprüft werden. Bereits veröffentlichte Beiträge lassen sich nur in der Instagram-App ändern oder löschen.

**Was über die Schnittstelle nicht geht** und deshalb mit Erinnerung läuft: Reels und Videos, Musik, Story-Sticker (Links, Umfragen), Produkt- und Personen-Markierungen, Collabs.

### N5 · Kommentare

**Instagram → Kommentare** zeigt Kommentare auf euren Beiträgen der letzten 30 Tage, offene zuerst. **Antworten** schreibt direkt als euer Konto auf Instagram (mit Schnellantworten zum Anpassen). **Erledigt** blendet einen Kommentar ohne Antwort aus, z. B. Emojis oder Spam. Neue Kommentare kommen mit dem stündlichen Abgleich, mit Push.

### N6 · Auswertung mit Claude und vorbereitete Beiträge

1. **Instagram → Übersicht** → ganz unten **Zusammenfassung für Claude** → **Kopieren**. Der Text enthält Kennzahlen, Formate, Zeiten, Hashtags und die letzten Beiträge mit Zahlen, aber keine Namen von Kommentierenden.
2. Im Chat mit Claude einfügen und z. B. schreiben: „Analysiere unser Instagram und bereite 6 Beiträge für die nächsten zwei Wochen vor.“
3. Claude schickt eine **JSON-Datei** mit Entwürfen. **Planer → Entwürfe importieren** → Datei wählen. Die Entwürfe erscheinen unter **Entwürfe** mit „Importiert“, Produktbilder holt die App aus dem Shop.
4. Durchsehen, anpassen, **Zur Prüfung geben**, freigeben wie in N4. Ohne eure Freigabe geht nichts raus.

Aufbau der Datei (für Claude oder zum Selbermachen):

```json
{
  "posts": [
    {
      "kind": "carousel",
      "caption": "Text mit #hashtags",
      "note": "Idee, Bildwünsche, Musik …",
      "scheduled_at": "2026-10-23T18:00:00+02:00",
      "product": "handle-oder-titel-des-produkts"
    }
  ]
}
```

`kind`: `image`, `carousel`, `story` oder `reel`. Optional `mode: "manual"` für Erinnerung statt automatisch, `images` mit Bild-Adressen von `cdn.shopify.com`. Höchstens 30 Beiträge pro Datei. Ein Zeitpunkt in der Vergangenheit wird weggelassen.

## Teil O – Postfach: Ordner, Gesendet, Erledigt

- **Ordner wie in Outlook:** Im **Postfach** stehen am Computer links alle Postfächer mit ihren Ordnern, am Handy oben über **Ordner**. **Neuer Ordner** legt einen Ordner an (bei **Liegt in** auch als Unterordner). Der **Stift** benennt um, verschiebt den Ordner in einen anderen (**Liegt in** → **Speichern**, Unterordner und Mails wandern mit) oder löscht ihn (nur leere Ordner). Die Ordner liegen auf dem Mailserver: Sie erscheinen genauso in Outlook, Apple Mail und am iPhone, und Ordner von dort erscheinen in der App (nach spätestens 5 Minuten oder mit dem Neu-laden-Symbol).
- **Einsortieren:** Bei jeder Mail **Verschieben** (Ordner-Symbol) → Ordner wählen. Gibt es ihn noch nicht: Namen eingeben → **Anlegen & verschieben**. Die Mail verschwindet aus dem Posteingang und liegt im Ordner, auch in Outlook.
- **Reihenfolge (ab 1.9):** Links ganz unten (am Handy unter **Ordner**) **Reihenfolge ändern**. Am Computer ziehen, am Handy mit den Pfeilen. Die Reihenfolge der **Postfächer** gilt nur für dich, auf allen deinen Geräten: im Postfach, in der Übersicht und unter **Einstellungen → Reihenfolge der Postfächer**. Die Reihenfolge der **Ordner** gilt fürs ganze Team. Posteingang, Gesendet & Co. bleiben oben. Outlook und Apple Mail sortieren weiter selbst, weil der Mailserver keine Reihenfolge kennt.
- **Gesendet:** beim jeweiligen Postfach **Gesendet** antippen. Dort stehen alle verschickten Mails, auch Antworten aus Outlook oder vom iPhone.
- **Erledigt:** oben im Posteingang **Erledigt**. Die App zeigt alle abgehakten Mails der letzten **6 Monate** (vorher 30 Tage), mit **Ältere anzeigen** weiter zurück. **Wieder öffnen** holt eine Mail zurück.
- Persönliche Postfächer sieht auch hier nur die Person, der sie gehören. Ordner-Aktionen in Team-Postfächern stehen im Verlauf.

## Teil P – Hilfe in der App

Unter **Hilfe** (am Computer links im Menü, am Handy oben das **Rettungsring-Symbol**) steht zu jeder Funktion eine Schritt-für-Schritt-Anleitung: Installation auf iPhone und Computer, Push, Widget, Shopify verbinden und Berechtigungen bestätigen, Postfächer, Cronjob, Members Club verbinden und aktualisieren, Testbestellung, Instagram, Signatur, Ordner, Versand, Sicherung und Wartung. Oben suchen (z. B. „read_inventory“, „Ordner“, „Push“) oder einen Bereich wählen. Jede Anleitung hat „Wenn es nicht klappt“ mit den häufigsten Fehlern und einen Knopf direkt zur passenden Einstellung. Fehlermeldungen in der App verlinken die passende Anleitung.

**Links bleiben in der App:** Links zu Shop, Shopify, Instagram oder zur Sendungsverfolgung öffnen in einem **neuen Tab**. Die installierte App bleibt dabei offen, auf dem Handy wie am Computer.

## Update auf Version 1.9 (Members Club 1.4, Postfächer und Ordner anordnen)

Gehört zum Members Club **1.4**: Die Team-App 1.9 erwartet den Club in Version 1.4.0. Am besten beides nacheinander aufspielen. Alle Daten bleiben erhalten.

1. Neue **`perfumecloud-team-app-upload.zip`** hochladen und mit „Vorhandene Dateien ersetzen“ entpacken. Unter **Einstellungen** steht ganz unten „Version 1.9.0“.
2. Members Club auf **1.4** bringen: [KUNDEN-APP.md](KUNDEN-APP.md), **Update 1.3.2 → 1.4** (mit App-Proxy und neuem Theme).
3. **Einstellungen → Integrationen → Members Club** → **Speichern & testen**: „Version 1.4.0“.
4. Auf iPhones die App einmal ganz schließen und neu öffnen, damit die neue Version lädt.

**Neu im Postfach:**
- **Reihenfolge ändern:** eigene Reihenfolge der Postfächer (nur für dich) und der Ordner (fürs Team), am Computer ziehen, am Handy mit Pfeilen (Teil O).
- **Ordner verschieben** wie in Apple Mail: Stift → **Liegt in** → **Speichern**. Das ändert die Ordner auch auf dem Mailserver, also in Outlook und am iPhone.

## Update auf Version 1.8.2 (Push-Check bei der Testbestellung)

Behebt: Bei der Testbestellung kamen keine Pushs an. Gründe waren: Die Club-Pushs gingen nur an ein Club-Konto mit **derselben** Adresse wie in der Team-App, Club und Team-App hielten sie nachts in der Ruhezeit zurück, und ohne Shopify-Recht `read_orders` sieht die Team-App keine Bestellung.

1. Neue **`perfumecloud-team-app-upload.zip`** hochladen und mit „Vorhandene Dateien ersetzen“ entpacken. Unter **Einstellungen** steht ganz unten „Version 1.8.2“.
2. Members Club auf **1.3.2** bringen: [KUNDEN-APP.md](KUNDEN-APP.md), **Update 1.3.1 → 1.3.2**.
3. **Members Club → Testbestellung** öffnen. Unten steht der **Push-Check**: Jede Zeile soll grün sein. Meldest du dich in der Club-App mit einer anderen Adresse an (z. B. der privaten), trag sie unter **Weitere eigene Adresse** ein und wähle das Konto aus. **Testpush** zeigt sofort, ob es auf dem Handy ankommt.
4. Die Testbestellung schickt ihre Pushs jetzt auch in der Ruhezeit. **Jetzt abgleichen** holt die Shop-Bestellung sofort, statt auf den Cronjob zu warten.

## Update auf Version 1.8.1 (wenn 1.8 schon läuft)

Behebt: **Wochenrückblick** zeigte nach „Statistik öffnen“ „Verbindung verweigert“ (Links aus dem Rückblick öffnen jetzt in der App bzw. in einem neuen Tab), und **In Shopify bestätigen** führte nur in die App-Liste (jetzt direkt auf Shopifys Bestätigungsseite, dazu **App in Shopify öffnen** als zweiter Weg).

1. Neue **`perfumecloud-team-app-upload.zip`** hochladen und mit „Vorhandene Dateien ersetzen“ entpacken. Unter **Einstellungen** steht ganz unten „Version 1.8.1“.
2. **Einstellungen → Integrationen → Shopify** öffnen. Die App prüft die Rechte beim Öffnen selbst. Steht dort „Im Shop noch nicht bestätigt“: **In Shopify bestätigen** → **Aktualisieren** → zurück → **Erneut prüfen** (A9a, Schritt 3–4).
3. Members Club auf **1.3.1** bringen (Admin-E-Mails): [KUNDEN-APP.md](KUNDEN-APP.md), **Update 1.3 → 1.3.1**.

## Update auf Version 1.8 (wenn die App schon läuft)

Neu: **Testbestellung** (vorher Probelauf), Shopify-Berechtigungen richtig erkennen und **In Shopify bestätigen**, **Signatur mit Bild**, **Ordner/Gesendet/Erledigt** im Postfach, **Hilfe**, Links in neuem Tab, bessere Darstellung am Handy. Alle Daten bleiben erhalten.

1. Neue **`perfumecloud-team-app-upload.zip`** wie in A5 hochladen und mit „Vorhandene Dateien ersetzen“ entpacken (oder automatisch über Teil E).
2. Die App einmal öffnen. Unter **Einstellungen** steht ganz unten „Version 1.8.0“. Falls etwas hakt: **Einstellungen → Integrationen → Wartung → Datenbank aktualisieren**.
3. **Shopify:** **Einstellungen → Integrationen → Shopify**. Steht dort „Im Shop noch nicht bestätigt“, **In Shopify bestätigen** → in Shopify das Update annehmen → **Erneut prüfen** (A9a, Schritt 3–4).
4. **Members Club auf 1.3** bringen: [KUNDEN-APP.md](KUNDEN-APP.md), **Update 1.2 → 1.3**. Erst dann gehen **Testbestellung** und die Fußzeile mit Logo in den Club-Mails.
5. **Signatur und Logo** eintragen (Teil L2).
6. Auf iPhones die App einmal ganz schließen und neu öffnen, damit die neue Version lädt.

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
| Shopify-Test rot | Client-ID und Secret neu kopieren. Prüfen, ob die Scopes angehakt sind, die Version freigegeben und die App im Shop installiert bzw. das Update bestätigt ist (A9a). |
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
| Testbestellung fehlt unter Members Club | Nur Admins sehen sie. |
| Testbestellung: „Nicht gefunden“ oder „Der Members Club läuft noch auf Version …“ | Der Club ist älter als 1.3: Club-Paket hochladen (KUNDEN-APP.md, Update 1.2 → 1.3). In der App: **Hilfe → Members Club aktualisieren**. |
| Testbestellung: „Push nur im Protokoll“ | In der Club-App mit derselben E-Mail wie in der Team-App anmelden und Mitteilungen erlauben (Teil M). |
| Shopify: „es fehlen Berechtigungen: read_inventory“ (o. ä.), obwohl in der App-Version angehakt | Die neue Version ist im Shop noch nicht bestätigt: **Integrationen → Shopify → In Shopify bestätigen**, Update annehmen, **Erneut prüfen** (A9a). Führt der Knopf nur in die App-Liste: Team-App auf 1.8.1 aktualisieren. |
| Wochenrückblick: „team.perfumecloud.de hat die Verbindung verweigert“ | Kam nach einem Klick auf „Statistik öffnen“ im Rückblick. Ab 1.8.1 behoben; vorher Fenster schließen und neu öffnen. |
| Statistik zeigt 0 € | In dem Zeitraum gab es keine Bestellungen (der Shop hatte zuletzt im Juli 2025 Bestellungen). Mit **90 Tage** oder nach der ersten neuen Bestellung prüfen. |
| Am iPhone ist die App verzogen oder vergrößert | App ganz schließen und neu öffnen (lädt die neue Version). Ab 1.8 zoomt das iPhone beim Antippen von Eingabefeldern nicht mehr in die Seite. |
| Instagram fehlt im Menü | Nur Admins und Personen mit **Instagram-Zugang** sehen es (N3). Andere sehen es erst, wenn das Konto verbunden ist. |
| Instagram: „Invalid redirect_uri“ beim Verbinden | Die Weiterleitungs-URI in der Meta-App (N1, Schritt 6) muss genau so lauten wie in der Team-App angezeigt, mit `https://`. |
| Instagram: „Insufficient developer role“ | Das Instagram-Konto ist noch kein Instagram-Tester der Meta-App oder die Einladung ist nicht angenommen (N1, Schritt 7). |
| Instagram: „Es fehlen Berechtigungen“ | In der Meta-App die vier Berechtigungen hinzufügen (N1, Schritt 4), dann **Neu verbinden** und bei Instagram alles erlauben. |
| Instagram: Veröffentlichen schlägt fehl, „Bild nicht abrufbar“ | Instagram holt die Bilder von `team.perfumecloud.de`. Die Adresse muss ohne Passwortschutz (z. B. Plesk-Verzeichnisschutz) erreichbar sein. |
| Instagram: Beiträge ohne Zahlen | Die Zahlen kommen nach und nach (30 Beiträge pro Stunde). Für Beiträge von vor der Umstellung aufs professionelle Konto liefert Instagram keine Zahlen. |
| Testbestellung: Aufräumen storniert nicht | `write_orders` fehlt (A9a). Die Bestellung im Shopify-Admin von Hand stornieren, „Artikel wieder auf Lager“ anhaken, „Kunden benachrichtigen“ aus. |
