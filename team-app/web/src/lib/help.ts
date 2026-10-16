/**
 * Hilfe-Katalog: Schritt-für-Schritt-Anleitungen zu jeder Funktion, zu Installation und Verbindungen.
 * Text mit **fett** für Knöpfe und Menüpunkte und `code` für Adressen und Werte.
 * Ausführlich (mit Plesk, Dev Dashboard, Meta) steht alles in docs/ANLEITUNG.md.
 */

export type HelpCategory = 'installation' | 'verbindungen' | 'postfach' | 'club' | 'instagram' | 'arbeiten' | 'admin';

export interface HelpArticle {
  id: string;
  category: HelpCategory;
  title: string;
  /** Ein Satz: Wofür ist das? */
  intro: string;
  /** Nur Admins können das einrichten */
  admin?: boolean;
  steps: string[];
  /** Häufige Probleme: Frage → Lösung */
  problems?: { q: string; a: string }[];
  /** Direkt zur passenden Stelle in der App */
  open?: { to: string; label: string };
  /** Zusätzliche Suchbegriffe */
  keywords?: string;
}

export const HELP_CATEGORIES: { key: HelpCategory; label: string }[] = [
  { key: 'installation', label: 'Installation' },
  { key: 'verbindungen', label: 'Verbindungen' },
  { key: 'postfach', label: 'Postfach' },
  { key: 'arbeiten', label: 'Planung & Versand' },
  { key: 'club', label: 'Members Club' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'admin', label: 'Team & Sicherung' },
];

export const HELP: HelpArticle[] = [
  // ---------- Installation ----------
  {
    id: 'iphone',
    category: 'installation',
    title: 'App aufs iPhone installieren',
    intro: 'Die Team-App kommt nicht aus dem App Store, sondern direkt von unserem Server. Sie aktualisiert sich selbst.',
    keywords: 'home-bildschirm safari ios installieren handy',
    steps: [
      'Auf dem iPhone **Safari** öffnen (nicht Chrome oder eine andere App). Mindestens iOS 16.4.',
      '`team.perfumecloud.de/app` öffnen. Die Seite zeigt die passenden Schritte für dein Gerät.',
      'Unten auf das **Teilen-Symbol** tippen (Quadrat mit Pfeil). Ist es nicht zu sehen: erst auf **•••** tippen, dann **Teilen**.',
      'Nach unten scrollen, **Zum Home-Bildschirm** antippen. „Als Web-App öffnen“ eingeschaltet lassen, **Hinzufügen**.',
      'Ab jetzt die App **immer über das Icon** auf dem Home-Bildschirm öffnen, nicht über Safari.',
      'Im Icon einmal **anmelden** (die installierte App hat ihren eigenen Speicher, das ist normal).',
      'Danach **Benachrichtigungen einschalten** (siehe „Benachrichtigungen einschalten und testen“).',
    ],
    problems: [
      { q: '„Zum Home-Bildschirm“ fehlt', a: 'Die Seite in **Safari** öffnen. In Chrome, Instagram oder der Mail-App gibt es den Punkt nicht.' },
      {
        q: 'Links öffnen sich außerhalb der App',
        a: 'Das ist gewollt: Shop, Shopify, Instagram und Sendungsverfolgung öffnen in einem neuen Tab, die App selbst bleibt offen. Zurück geht es über das App-Icon.',
      },
      {
        q: 'Nach einem Update sieht die App alt aus',
        a: 'App ganz schließen (vom unteren Rand nach oben wischen und wegwischen) und neu öffnen. Sie lädt die neue Version dann selbst.',
      },
    ],
    open: { to: '/einstellungen', label: 'App auf weiteren Geräten' },
  },
  {
    id: 'computer',
    category: 'installation',
    title: 'App auf Windows-PC oder Mac installieren',
    intro: 'Am Computer läuft die App in einem eigenen Fenster, mit Benachrichtigungen und Kurzbefehlen.',
    keywords: 'windows edge chrome mac dock taskleiste',
    steps: [
      '**Windows (Edge oder Chrome):** `team.perfumecloud.de/app` öffnen und **App installieren** klicken. Oder rechts in der Adressleiste auf das Symbol mit dem Bildschirm und Pfeil.',
      '**Installieren** bestätigen. Die App erscheint im Startmenü und lässt sich an die Taskleiste anheften.',
      '**Mac (Safari):** die Seite öffnen, im Menü **Ablage** → **Zum Dock hinzufügen**.',
      'In der App anmelden und unter **Einstellungen → Benachrichtigungen** auf **Aktivieren** klicken.',
      'Rechtsklick auf das Icon in der Taskleiste zeigt Kurzbefehle: Postfach, Planung, Kalender, Idee festhalten.',
    ],
    problems: [
      {
        q: 'Kein „App installieren“ zu sehen',
        a: 'Im Menü **⋯** → **Apps** → **Diese Website als App installieren**. Firefox kann keine Web-Apps installieren, dafür Edge oder Chrome nehmen.',
      },
    ],
  },
  {
    id: 'push',
    category: 'installation',
    title: 'Benachrichtigungen einschalten und testen',
    intro: 'Push für neue Mails, Bestellungen, Aufgaben, Termine und Club-Hinweise.',
    keywords: 'push mitteilungen benachrichtigung test gerät',
    steps: [
      'Die App über das **Icon auf dem Home-Bildschirm** öffnen (in Safari geht Push auf dem iPhone nicht).',
      'Oben rechts auf deinen **Kreis mit Initiale** tippen → **Einstellungen**.',
      'Bei **Benachrichtigungen** auf **Aktivieren** tippen und bei der Abfrage **Erlauben** wählen.',
      '**Test senden** tippen. Nach ein paar Sekunden kommt eine Mitteilung.',
      'Darunter festlegen, was du bekommen möchtest. **Bei welchen Mails?**: Jede neue, Wirklich alle oder Nur wichtige.',
    ],
    problems: [
      {
        q: 'Der Test kommt nicht an',
        a: 'In den iPhone-Einstellungen unter **Mitteilungen → PC Team** erlauben. Steht beim Gerät „nicht angemeldet“, **Neu anmelden** tippen.',
      },
      {
        q: 'Push kommt erst nach Minuten',
        a: 'Der Cronjob läuft nicht jede Minute (siehe „Sofort-Abruf & Cronjob“). Zwischen 22 und 7 Uhr kommen Mail-Pushs gesammelt am Morgen.',
      },
      {
        q: 'Eine Person bekommt gar nichts',
        a: 'Admins sehen unter **Einstellungen → Integrationen → Wartung** die Geräte jeder Person. **Datenbank aktualisieren** räumt kaputte Anmeldungen auf.',
      },
    ],
    open: { to: '/einstellungen', label: 'Benachrichtigungen' },
  },
  {
    id: 'widget',
    category: 'installation',
    title: 'iPhone-Widget einrichten',
    intro: 'Aufgaben, Mails, Termine oder Club-Zahlen direkt auf dem Home- oder Sperrbildschirm.',
    keywords: 'scriptable widget sperrbildschirm kalender club',
    steps: [
      'Die kostenlose App **Scriptable** aus dem App Store laden.',
      'In der Team-App **Einstellungen → iPhone-Widget** → **Widget-Skript erstellen** → **Skript kopieren**.',
      'Scriptable öffnen, oben rechts **+**, Text einfügen, als Namen **Perfume Cloud** eintragen, **Fertig**.',
      'Auf dem Home-Bildschirm lange auf eine freie Stelle drücken → **Bearbeiten** → **Widget hinzufügen** → **Scriptable** → Größe wählen.',
      'Das Widget lange drücken → **Widget bearbeiten** → bei **Script** „Perfume Cloud“ wählen.',
      'Für Termine bei **Parameter** `kalender` eintragen, für Club-Zahlen `club`.',
    ],
    problems: [
      { q: 'Widget zeigt einen Fehler oder alte Zahlen', a: 'Nach einem Update der Team-App das Skript einmal neu kopieren und in Scriptable ersetzen.' },
    ],
    open: { to: '/einstellungen', label: 'iPhone-Widget' },
  },
  {
    id: 'update',
    category: 'installation',
    title: 'Neue Version der Team-App aufspielen',
    intro: 'So kommt ein Update auf den Server. Alle Daten bleiben erhalten.',
    admin: true,
    keywords: 'update version zip hochladen plesk netcup',
    steps: [
      'Die neue Datei `perfumecloud-team-app-upload.zip` bereitlegen (aus dem Chat mit Claude oder von GitHub).',
      'netcup **Plesk** → **Dateien** → Ordner `team.perfumecloud.de/httpdocs` öffnen.',
      '**Hochladen** → ZIP wählen → beim Menü **⋯** der Datei **Dateien extrahieren**, „Vorhandene Dateien ersetzen“ anhaken.',
      'Die App einmal öffnen. Sie ergänzt die Datenbank selbst. Ganz unten in den **Einstellungen** steht die neue Versionsnummer.',
      'Ist das automatische Update eingerichtet (GitHub, Teil E der Anleitung), passiert das alles von selbst.',
    ],
    problems: [
      { q: 'Nach dem Update fehlen Daten oder es hakt', a: '**Einstellungen → Integrationen → Wartung → Datenbank aktualisieren**. Es geht nichts verloren.' },
    ],
  },

  // ---------- Verbindungen ----------
  {
    id: 'shopify',
    category: 'verbindungen',
    title: 'Shopify verbinden',
    intro: 'Für Statistik, Bestellungen, Versand, Lager und Kundeninfos.',
    admin: true,
    keywords: 'shopify client id secret dev dashboard app',
    steps: [
      '`dev.shopify.com` öffnen und als Shop-Inhaber anmelden → **Apps** → **Perfume Cloud Team** (oder **App erstellen**).',
      'In einer neuen **Version** bei den Scopes anhaken: `read_orders`, `read_products`, `read_inventory`, dazu `read_customers`, `write_merchant_managed_fulfillment_orders` und `write_orders` → **Freigeben**.',
      'Die App im Shop **installieren** bzw. die neue Version **bestätigen** (siehe „Shopify: fehlende Berechtigungen“).',
      'In den Einstellungen der App **Client-ID** und **Client-Secret** kopieren.',
      'Team-App → **Einstellungen → Integrationen → Shopify**: beides einfügen → **Speichern & testen**.',
      'Nach etwa einer Minute füllt sich die **Statistik**.',
    ],
    problems: [
      {
        q: 'Test rot: Anmeldung abgelehnt',
        a: 'Client-ID und Secret neu kopieren (ohne Leerzeichen). Ist das Secret im Dev Dashboard neu erstellt worden, gilt nur noch das neue.',
      },
      { q: 'Test meldet fehlende Berechtigungen', a: 'Siehe „Shopify: fehlende Berechtigungen bestätigen“.' },
    ],
    open: { to: '/einstellungen/integrationen', label: 'Integrationen' },
  },
  {
    id: 'shopify-rechte',
    category: 'verbindungen',
    title: 'Shopify: fehlende Berechtigungen bestätigen',
    intro:
      'Steht z. B. „Im Shop noch nicht bestätigt: write_orders“, obwohl der Scope in der App-Version angehakt ist: Der Shop muss die neue Version noch bestätigen. Shopify gibt neue Rechte erst nach dieser Zustimmung frei, auch bei der eigenen App.',
    admin: true,
    keywords: 'scope berechtigung read_inventory write_orders write_merchant_managed_fulfillment_orders read_customers fehlt bestätigen aktualisieren',
    steps: [
      'Team-App → **Einstellungen → Integrationen → Shopify**. Die App sagt, was fehlt: „Im Shop noch nicht bestätigt“ oder „In der App-Version fehlen“.',
      '**Im Shop noch nicht bestätigt:** auf **In Shopify bestätigen** tippen. Das öffnet in einem neuen Tab die Seite, auf der Shopify die neuen Rechte der Team-App zeigt (vorher im Shopify-Admin anmelden, als Inhaber oder mit dem Recht „Apps verwalten“).',
      'Die Liste ansehen und **Aktualisieren** bzw. **Installieren** wählen.',
      'Zurück in der Team-App **Erneut prüfen** tippen. Jetzt steht „alle Berechtigungen da“. (Beim nächsten Öffnen der Einstellungen prüft die App das auch von selbst.)',
      '**In der App-Version fehlen:** im Dev Dashboard eine neue Version mit den genannten Scopes erstellen und **freigeben**, dann wie oben bestätigen.',
    ],
    problems: [
      {
        q: 'Statt der Bestätigung kommt nur die App-Liste oder „Verbindung verweigert“',
        a: 'Zweiter Weg: **App in Shopify öffnen** tippen. Shopify fragt beim Öffnen der App nach den neuen Rechten. Erscheint danach „Verbindung verweigert“, ist das egal (die Team-App lässt sich nicht im Shopify-Admin anzeigen). In der Team-App **Erneut prüfen**.',
      },
      {
        q: 'Shopify fragt gar nicht nach',
        a: 'Im **Dev Dashboard** (dev.shopify.com) → **Apps → Perfume Cloud Team** prüfen, dass die neueste Version **aktiv** ist und die Scopes dort als **Zugriffsbereiche** stehen, nicht als **optionale** Zugriffsbereiche. Dann bei der App auf **Installieren** bzw. den Installationslink gehen und den Shop **Perfume Cloud** wählen.',
      },
      {
        q: 'Es klappt trotzdem nicht',
        a: 'Letzter Weg: Shopify-Admin → **Einstellungen → Apps** → **Perfume Cloud Team** → **Deinstallieren**, danach im Dev Dashboard wieder **installieren**. Die Team-App speichert nichts in Shopify, es geht nichts verloren; Client-ID und Secret bleiben gleich. Danach in der Team-App **Speichern & testen**.',
      },
      {
        q: 'Nach dem Bestätigen fehlt immer noch etwas',
        a: 'Shopify braucht manchmal eine Minute. **Erneut prüfen** tippen. Hilft das nicht: **Speichern & testen** mit Client-ID und Secret wiederholen.',
      },
      {
        q: 'Wofür brauchen wir welche Berechtigung?',
        a: '`read_customers`: Kundeninfos neben der Mail · `write_merchant_managed_fulfillment_orders`: Versenden mit Sendungsnummer · `write_orders`: Testbestellung am Ende stornieren. Ohne sie läuft der Rest weiter.',
      },
    ],
    open: { to: '/einstellungen/integrationen', label: 'Shopify prüfen' },
  },
  {
    id: 'kundendaten',
    category: 'verbindungen',
    title: 'Kundeninfos neben der Mail freischalten',
    intro: 'Bestellungen, Versandstatus, Ort und Club-Stufe zur Absenderadresse einer Mail.',
    admin: true,
    keywords: 'geschützte kundendaten protected customer data name adresse',
    steps: [
      'Im Dev Dashboard bei der App **Protected customer data access** öffnen → **Zugriff anfragen**, Grund z. B. „Kundenservice“.',
      'Bei den Feldern **Name**, **E-Mail** und **Adresse** anhaken, denselben Grund → **Speichern**.',
      'Shopify-Admin → **Apps** → **Perfume Cloud Team** → Update bestätigen.',
      'Team-App → **Integrationen → Shopify** → **Kundeninfo testen** mit einer echten Kundenadresse oder `#1042`.',
    ],
    problems: [{ q: '„Shopify verweigert den Zugriff auf Kundendaten“', a: 'Schritt 1 und 2 fehlen noch oder sind nicht gespeichert.' }],
  },
  {
    id: 'postfaecher',
    category: 'verbindungen',
    title: 'Team-Postfächer verbinden (info@, support@)',
    intro: 'Die App holt die Mails per IMAP und meldet neue sofort.',
    admin: true,
    keywords: 'imap postfach passwort netcup mxf938 993 sichtbar',
    steps: [
      '**Einstellungen → Integrationen → Postfächer**. info@ und support@ sind schon eingetragen.',
      'Bei jedem Postfach IMAP-Server `mxf938.netcup.net`, Port `993` und das **Passwort** des Postfachs eintragen.',
      'Weitere Adressen mit **Postfach hinzufügen**. Bei **Sichtbar für** festlegen, wer die Mails sieht.',
      '**Speichern & testen**. Ein grüner Haken heißt: Abruf läuft.',
      'Mit **Prüfen** beim Postfach testet die App Abruf und Versand und schickt eine Testmail an das Postfach selbst.',
    ],
    problems: [
      { q: 'Test rot', a: 'Passwort des Postfachs neu eintragen (in Plesk unter **E-Mail** änderbar), Server `mxf938.netcup.net`, Port 993.' },
      { q: 'Mails kommen verspätet', a: 'Siehe „Sofort-Abruf & Cronjob“.' },
    ],
    open: { to: '/einstellungen/integrationen', label: 'Postfächer' },
  },
  {
    id: 'mein-postfach',
    category: 'verbindungen',
    title: 'Eigenes Postfach verbinden',
    intro: 'Dein persönliches Postfach (z. B. vorname@perfumecloud.de) siehst nur du, mit Push nur an dich.',
    keywords: 'persönlich eigenes postfach privat',
    steps: [
      '**Einstellungen → Allgemein → Mein Postfach**.',
      'E-Mail-Adresse und Passwort des Postfachs eintragen. Server `mxf938.netcup.net`, Port `993`, Benutzername leer lassen.',
      '**Speichern & testen**.',
      'Im **Postfach** erscheint es links (am Handy über **Ordner**) mit einem Schloss.',
    ],
    open: { to: '/einstellungen', label: 'Mein Postfach' },
  },
  {
    id: 'mailversand',
    category: 'verbindungen',
    title: 'Mails verschicken (Antworten, Einladungen, Rückblick)',
    intro: 'Über welches Postfach die App selbst Mails verschickt.',
    admin: true,
    keywords: 'smtp versand 465 587 testmail',
    steps: [
      '**Einstellungen → Integrationen → Mails verschicken**.',
      'Server leer lassen heißt: wie beim Abruf. Port **465** (SSL) oder **587** (STARTTLS).',
      '**Testmail an …** schicken. Kommt sie an, klappt der Versand.',
    ],
    problems: [{ q: 'Testmail kommt nicht an', a: 'Spam-Ordner prüfen. Beim Postfach **Prüfen** zeigt die genaue Fehlermeldung des Mailservers.' }],
    open: { to: '/einstellungen/integrationen', label: 'Mails verschicken' },
  },
  {
    id: 'cronjob',
    category: 'verbindungen',
    title: 'Sofort-Abruf & Cronjob',
    intro: 'Damit Mails, Bestellungen und Push auch bei geschlossener App ankommen, innerhalb von Sekunden.',
    admin: true,
    keywords: 'cron geplante aufgabe plesk idle sofort',
    steps: [
      '**Einstellungen → Integrationen → Sofort-Abruf & Cronjob** → beim **Skript** auf **Kopieren**.',
      'Plesk → **Geplante Aufgaben** → **Aufgabe hinzufügen** (oder die bestehende bearbeiten).',
      'Aufgabentyp **PHP-Skript ausführen**, Skriptpfad einfügen, PHP **8.3**, Cron-Stil `* * * * *`, Benachrichtigung keine → **OK**.',
      'Nach ein bis zwei Minuten steht in der App **Sofort-Abruf aktiv**.',
    ],
    problems: [
      { q: 'Steht nicht „Sofort-Abruf aktiv“', a: 'Läuft die Aufgabe als „URL abrufen“, auf „PHP-Skript ausführen“ umstellen. Sie muss jede Minute laufen.' },
    ],
    open: { to: '/einstellungen/integrationen', label: 'Sofort-Abruf' },
  },
  {
    id: 'kalender-abo',
    category: 'verbindungen',
    title: 'Team-Kalender im iPhone-Kalender',
    intro: 'Termine und Aktionstage erscheinen in der Kalender-App und ihren Widgets.',
    keywords: 'ical abo webcal kalender abonnieren',
    steps: [
      '**Einstellungen → Allgemein → Kalender abonnieren** → **Abo-Link erstellen**.',
      '**Im Kalender abonnieren** tippen und bestätigen.',
      'Die Termine aktualisieren sich von selbst (das iPhone fragt etwa stündlich nach).',
    ],
    open: { to: '/einstellungen', label: 'Kalender abonnieren' },
  },

  // ---------- Postfach ----------
  {
    id: 'ordner',
    category: 'postfach',
    title: 'Ordner anlegen und Mails einsortieren',
    intro: 'Wie in Outlook: eigene Ordner und Unterordner. Sie gelten auch in Outlook, Apple Mail und am iPhone.',
    keywords: 'ordner unterordner verschieben sortieren outlook archiv',
    steps: [
      '**Postfach** öffnen. Am Computer stehen die Ordner links, am Handy oben über **Ordner**.',
      'Beim Postfach auf **Neuer Ordner** tippen, Namen eingeben, bei **Liegt in** ggf. einen übergeordneten Ordner wählen → **Anlegen**.',
      'Eine Mail einsortieren: bei der Mail auf **Verschieben** tippen und den Ordner wählen. Gibt es ihn noch nicht: Namen eingeben → **Anlegen & verschieben**.',
      'Umbenennen oder löschen: beim Ordner auf den **Stift**. Löschen geht nur, wenn der Ordner leer ist.',
      'Einen Ordner öffnen: antippen. Mit der Suche findest du Absender, Empfänger und Betreff.',
    ],
    problems: [
      {
        q: 'Verschobene Mail ist im Posteingang weg',
        a: 'Richtig so: Sie liegt jetzt im Ordner (auch in Outlook). Zurück geht es über **Verschieben → Posteingang**.',
      },
      { q: 'Ein Ordner fehlt', a: 'Beim Postfach auf das Neu-laden-Symbol tippen. Ordner aus Outlook erscheinen nach bis zu 5 Minuten.' },
    ],
    open: { to: '/postfach', label: 'Postfach' },
  },
  {
    id: 'gesendet',
    category: 'postfach',
    title: 'Gesendete und erledigte Mails finden',
    intro: 'Alles, was ihr verschickt oder abgehakt habt, bleibt auffindbar.',
    keywords: 'gesendet erledigt abgehakt archiv suche',
    steps: [
      '**Gesendet:** im Postfach links (am Handy **Ordner**) beim jeweiligen Postfach **Gesendet** antippen. Dort stehen auch Antworten aus Outlook oder vom iPhone.',
      '**Erledigt:** oben im Posteingang auf **Erledigt** tippen. Die App zeigt alle abgehakten Mails der letzten 6 Monate, mit **Ältere anzeigen** weiter zurück.',
      'Eine erledigte Mail wieder öffnen: antippen → **Wieder öffnen**.',
    ],
    open: { to: '/postfach', label: 'Postfach' },
  },
  {
    id: 'antworten',
    category: 'postfach',
    title: 'Antworten mit Textbausteinen',
    intro: 'Direkt aus der App, mit Signatur, Textbausteinen und Daten aus Shopify.',
    keywords: 'antworten textbaustein vorlage platzhalter zitieren',
    steps: [
      'Mail öffnen → **Antworten**.',
      'Einen **Textbaustein** antippen. Platzhalter wie `{vorname}`, `{bestellnummer}` oder `{sendungslink}` füllt die App aus Shopify und dem Club.',
      'Optional **Ursprüngliche Mail zitieren** und **Danach als erledigt markieren**.',
      'Die **Vorschau** zeigt die Mail mit Signatur und Fußzeile, so wie sie ankommt → **Senden**.',
      'Textbausteine pflegen Admins unter **Einstellungen → Vorlagen**.',
    ],
    open: { to: '/einstellungen/vorlagen', label: 'Vorlagen' },
  },
  {
    id: 'signatur',
    category: 'postfach',
    title: 'Signatur mit Bild oder Logo',
    intro:
      'Unter jeder Mail aus der App: deine Signatur, optional mit Bild (z. B. eingescannte Unterschrift), bei info@ und support@ dazu die Fußzeile des Teams mit Logo.',
    keywords: 'signatur bild logo fußzeile unterschrift',
    steps: [
      '**Eigene Signatur:** **Einstellungen → Allgemein → Signatur**: Text eintragen.',
      'Darunter bei **Bild unter deiner Signatur** auf **Bild hinzufügen** (PNG, JPEG oder GIF). Die App verkleinert es selbst.',
      'Mit dem Regler die **Breite in der Mail** einstellen (60 bis 600 Pixel).',
      '**Fußzeile des Teams** (Admins): **Einstellungen → Vorlagen → Absender & Fußzeile**: Text und **Logo unter der Fußzeile**.',
      'Die Fußzeile mit Logo übernimmt auch der Members Club für seine Mails (ab Club 1.3).',
      'Prüfen: eine Antwort öffnen, die **Vorschau** zeigt Signatur und Bild.',
    ],
    problems: [
      {
        q: 'Das Bild ist zu groß',
        a: 'Höchstens 400 KB. Die App verkleinert vor dem Hochladen. Klappt es nicht, ein kleineres Bild oder einen Screenshot nehmen.',
      },
      { q: 'Beim Empfänger fehlt das Bild', a: 'Das Bild ist in die Mail eingebettet. Manche Mailprogramme zeigen Bilder erst nach „Bilder laden“.' },
    ],
    open: { to: '/einstellungen', label: 'Signatur' },
  },

  // ---------- Planung & Versand ----------
  {
    id: 'ideen',
    category: 'arbeiten',
    title: 'Ideen-Assistent: Aufgaben und Termine aus einem Satz',
    intro: 'Einfach losschreiben oder diktieren. Der Assistent macht Notiz, Aufgaben und Termine daraus.',
    keywords: 'idee notiz aufgabe termin diktieren',
    steps: [
      'Auf **Ideen** (am Handy die Glühbirne oben) tippen.',
      'Schreiben oder diktieren, z. B. „Ben macht die Fotos bis Freitag, Meeting Mittwoch 11 Uhr“.',
      'Der Vorschlag zeigt Notiz, Aufgaben und Termine. Alles lässt sich ändern oder abwählen.',
      '**Übernehmen**.',
    ],
    problems: [
      {
        q: 'Wie erkennt er Personen und Termine?',
        a: '`@Ben` oder „Ben macht …“ für Personen, „morgen“, „Freitag“, „15.11.“, „KW 47“ für Fälligkeit, „14 Uhr“ für Termine, „!“ für dringend.',
      },
    ],
    open: { to: '/ideen', label: 'Ideen' },
  },
  {
    id: 'versand',
    category: 'arbeiten',
    title: 'Bestellungen versenden',
    intro: 'Sendungsnummer eintragen oder scannen, Shopify markiert die Bestellung als versendet.',
    keywords: 'versand sendungsnummer scannen dhl tracking',
    steps: [
      '**Versand** öffnen (am Handy über **Zu versenden** auf der Übersicht).',
      'Bei der Bestellung **Versenden** tippen.',
      'Sendungsnummer eintippen oder mit **Scannen** vom Etikett lesen. Den Versanddienst erkennt die App.',
      'Auf Wunsch geht eine Versandbestätigung an die Kundin → **Versenden**.',
    ],
    problems: [
      {
        q: '„Fehlende Berechtigung“',
        a: '`write_merchant_managed_fulfillment_orders` fehlt oder ist im Shop noch nicht bestätigt (siehe „Shopify: fehlende Berechtigungen“).',
      },
    ],
    open: { to: '/versand', label: 'Versand' },
  },
  {
    id: 'kalender',
    category: 'arbeiten',
    title: 'Termine eintragen',
    intro: 'Meetings, Events und Fristen fürs Team, mit Erinnerung.',
    keywords: 'kalender termin erinnerung feiertage',
    steps: [
      '**Kalender** → **Neuer Termin** (am Computer auch Doppelklick auf einen Tag).',
      'Titel, Datum, Uhrzeit oder ganztägig, Ort, Teilnehmer und Erinnerung wählen. Ohne Teilnehmer gilt er fürs ganze Team.',
      'Eingetragene Personen bekommen einen Push, vor dem Termin die Erinnerung.',
    ],
    open: { to: '/kalender', label: 'Kalender' },
  },

  // ---------- Members Club ----------
  {
    id: 'club-verbinden',
    category: 'club',
    title: 'Members Club verbinden',
    intro: 'Damit die Team-App Statistik, Nachrichten und die Testbestellung des Clubs zeigt.',
    admin: true,
    keywords: 'club kunden-app verbinden schlüssel datenbank',
    steps: [
      'Liegt der Club in derselben Datenbank (Club-Admin → Einstellungen → System → **In die Team-Datenbank umziehen**), ist er automatisch verbunden.',
      'Sonst: **Einstellungen → Integrationen → Members Club**: Adresse `https://app.perfumecloud.de` und den **Schlüssel** aus dem Club-Admin eintragen → **Speichern & testen**.',
      'Für Personen ohne Admin-Rolle: **Einstellungen → Team** → bei der Person **Club-Zugang**.',
    ],
    problems: [{ q: '„Club noch nicht verbunden“', a: 'Im Club-Admin muss die Adresse der App gespeichert sein: dort einmal **Einstellungen speichern**.' }],
    open: { to: '/einstellungen/integrationen', label: 'Members Club' },
  },
  {
    id: 'club-update',
    category: 'club',
    title: 'Members Club aktualisieren (auf Version 1.3.1)',
    intro:
      'Meldet die Team-App „Der Members Club läuft noch auf Version …“ oder zeigt die Testbestellung „Nicht gefunden“, ist der Club älter als die Team-App.',
    admin: true,
    keywords: 'club update version nicht gefunden testbestellung 1.3 zip',
    steps: [
      'Die Datei `perfumecloud-club-upload.zip` bereitlegen (aus dem Chat mit Claude).',
      'netcup **Plesk** → **Dateien** → Ordner `app.perfumecloud.de/httpdocs` öffnen.',
      '**Hochladen** → ZIP wählen → beim Menü **⋯** **Dateien extrahieren**, „Vorhandene Dateien ersetzen“ anhaken.',
      '`app.perfumecloud.de` einmal öffnen. Der Club ergänzt die Datenbank selbst.',
      'Team-App → **Einstellungen → Integrationen → Members Club** → **Speichern & testen**. Dort steht jetzt „Version 1.3.1“.',
      'Danach klappen **Testbestellung**, die Fußzeile mit Logo in den Club-Mails und die neue Anmeldeseite der Club-App.',
    ],
    problems: [
      {
        q: 'Nach dem Hochladen steht noch die alte Version',
        a: 'Prüfen, ob die ZIP im richtigen Ordner (`app.perfumecloud.de/httpdocs`) entpackt wurde und „Vorhandene Dateien ersetzen“ an war.',
      },
    ],
    open: { to: '/einstellungen/integrationen', label: 'Club prüfen' },
  },
  {
    id: 'club-admin-email',
    category: 'club',
    title: 'Club-App: „Admin“ für die eigene (private) E-Mail freischalten',
    intro:
      'Die Club-App erkennt Admins an der E-Mail. Meldest du dich dort mit einer anderen Adresse an als in der Team-App (z. B. der privaten aus dem Shop-Kundenkonto), trägst du sie als Admin-E-Mail ein.',
    admin: true,
    keywords: 'club admin email e-mail erkennt nicht admin knopf fehlt privat icloud freischalten zugänge',
    steps: [
      'Den Club-Admin öffnen: **Members Club → Club-Admin öffnen** (öffnet einen neuen Tab).',
      'Dort **Einstellungen → Zugänge** → Abschnitt **Admin-E-Mails** → **E-Mail eintragen**.',
      'Die Adresse eingeben, mit der du dich in der Club-App anmeldest. Bei **Gehört zu** dich selbst wählen (dann gelten deine Rechte) → **Eintragen**.',
      'Die Club-App neu laden: oben steht **Admin**. Wer schon angemeldet ist, bekommt den Admin-Bereich beim nächsten Öffnen.',
    ],
    problems: [
      {
        q: 'Den Abschnitt „Admin-E-Mails“ gibt es nicht',
        a: 'Der Club ist älter als 1.3.1: **Members Club aktualisieren**.',
      },
      {
        q: '„Darf keine Zugänge verwalten“',
        a: 'Eintragen dürfen Admins der Team-App und eigene Club-Zugänge. Den Club-Admin dafür aus der Team-App öffnen.',
      },
    ],
    open: { to: '/club', label: 'Members Club' },
  },
  {
    id: 'testbestellung',
    category: 'club',
    title: 'Testbestellung durchspielen',
    intro: 'Einmal den ganzen Weg einer Bestellung durch den Club: Versand, Zustellung, Bewertung, Punkte, Stufe. Zählt nirgends mit.',
    admin: true,
    keywords: 'testbestellung probelauf test bestellung club punkte',
    steps: [
      'In der Club-App (`app.perfumecloud.de`) mit **derselben E-Mail wie in der Team-App** anmelden und unter **Konto** Mitteilungen erlauben.',
      'Team-App → **Members Club → Testbestellung**.',
      '**Simuliert (ohne Shop):** Bestellwert eingeben → **Testbestellung starten** → die Schritte nacheinander **Auslösen**.',
      '**Echt im Shop (0 €):** Die App erzeugt zwei Einmal-Codes (`TEST-…` und `TEST-…-VERSAND`) und einen Link in den Shop. Bestellen, an der Kasse den Versand-Code dazu.',
      '**Aufräumen** löscht die Testdaten und storniert die Shop-Bestellung.',
    ],
    problems: [
      { q: '„Nicht gefunden“ oder „Club läuft noch auf Version …“', a: 'Der Club ist älter als 1.3. Siehe „Members Club aktualisieren“.' },
      { q: 'Push nur im Protokoll', a: 'In der Club-App mit derselben E-Mail anmelden und Mitteilungen erlauben.' },
      {
        q: 'Aufräumen storniert nicht',
        a: '`write_orders` fehlt. Bestellung im Shopify-Admin von Hand stornieren, „Artikel wieder auf Lager“ an, „Kunden benachrichtigen“ aus.',
      },
    ],
    open: { to: '/club/testbestellung', label: 'Testbestellung' },
  },
  {
    id: 'club-nachricht',
    category: 'club',
    title: 'Nachricht an Club-Mitglieder senden',
    intro: 'Push an alle Mitglieder oder nur an Silber und Gold, mit Vorlagen und Vier-Augen-Prinzip.',
    keywords: 'push mitglieder nachricht broadcast vorlage',
    steps: [
      '**Members Club → Nachricht an Mitglieder**.',
      'Vorlage wählen (z. B. Neuer Duft, Früher Zugang), Text anpassen, Empfänger wählen. Die Vorschau zeigt den Push.',
      '**Zur Prüfung geben**. Jemand anderes tippt **Freigeben & senden** oder plant einen Zeitpunkt.',
    ],
    open: { to: '/club', label: 'Members Club' },
  },

  // ---------- Instagram ----------
  {
    id: 'instagram',
    category: 'instagram',
    title: 'Instagram verbinden',
    intro: 'Für Auswertung, Planer und Kommentare. Braucht ein professionelles Instagram-Konto und eine eigene Meta-App.',
    admin: true,
    keywords: 'instagram meta app verbinden token tester redirect',
    steps: [
      'Instagram auf **professionelles Konto** umstellen (Instagram-App → Einstellungen → Kontotyp und Tools).',
      '`developers.facebook.com/apps` → **App erstellen** → Anwendungsfall „Nachrichten und Inhalte auf Instagram verwalten“.',
      '**API-Einrichtung mit Instagram-Login**: die vier Berechtigungen `instagram_business_basic`, `…_content_publish`, `…_manage_comments`, `…_manage_insights` hinzufügen.',
      'Bei **OAuth-Weiterleitungs-URIs** die Adresse aus der Team-App eintragen (**Integrationen → Instagram → Kopieren**).',
      'Unter **App-Rollen** das Konto als **Instagram-Tester** hinzufügen und die Einladung auf instagram.com annehmen.',
      'Team-App → **Integrationen → Instagram**: Instagram-App-ID und -Secret eintragen → **Speichern** → **Mit Instagram verbinden**.',
    ],
    problems: [
      { q: '„Invalid redirect_uri“', a: 'Die Weiterleitungs-URI in der Meta-App muss genau so lauten wie in der Team-App, mit `https://`.' },
      { q: '„Insufficient developer role“', a: 'Das Konto ist noch kein Instagram-Tester oder die Einladung ist nicht angenommen.' },
      {
        q: 'Am iPhone landet man nach dem Verbinden in Safari',
        a: 'Das Verbinden am besten am Computer erledigen. Danach funktioniert alles auch in der iPhone-App.',
      },
    ],
    open: { to: '/einstellungen/integrationen', label: 'Instagram' },
  },
  {
    id: 'instagram-planer',
    category: 'instagram',
    title: 'Beiträge planen und freigeben',
    intro: 'Vorbereiten, prüfen lassen, automatisch veröffentlichen.',
    keywords: 'instagram beitrag planer freigabe story reel karussell',
    steps: [
      '**Instagram → Planer → Neuer Beitrag** (oder Bild, Karussell, Story, Reel).',
      'Fotos hinzufügen oder **Bilder und Text aus dem Shop**. Format wählen (4:5 empfohlen).',
      'Text schreiben, Zeitpunkt wählen → **Zur Prüfung geben**.',
      'Jemand anderes öffnet **Prüfen & freigeben** → **Freigeben**. Die App veröffentlicht zum Zeitpunkt selbst.',
      'Reels und Videos: zum Zeitpunkt kommt ein Push mit **Jetzt posten**, dann in der Instagram-App posten.',
    ],
    problems: [{ q: '„Bild nicht abrufbar“', a: '`team.perfumecloud.de` muss ohne Passwortschutz erreichbar sein, Instagram holt die Bilder dort ab.' }],
    open: { to: '/instagram/planung', label: 'Planer' },
  },

  // ---------- Team & Sicherung ----------
  {
    id: 'team',
    category: 'admin',
    title: 'Personen einladen und Passwort zurücksetzen',
    intro: 'Neue Teammitglieder bekommen eine Mail mit Einladungslink.',
    admin: true,
    keywords: 'einladen person team passwort vergessen rolle',
    steps: [
      '**Einstellungen → Team → Person hinzufügen**: Name und E-Mail, „Einladung per E-Mail schicken“ an → **Hinzufügen**.',
      'Die Person legt über den Link ihr Passwort selbst fest. Der Link gilt 14 Tage.',
      'Kommt die Mail nicht an: den angezeigten **Einladungslink** per WhatsApp oder iMessage teilen.',
      '**Passwort vergessen:** bei der Person auf **Passwort** und ein neues vergeben.',
    ],
    open: { to: '/einstellungen/team', label: 'Team' },
  },
  {
    id: 'sicherung',
    category: 'admin',
    title: 'Datensicherung und Wochenrückblick',
    intro: 'Jede Nacht eine verschlüsselte Sicherung von Team-App und Club, freitags der Rückblick per Mail.',
    admin: true,
    keywords: 'backup sicherung wiederherstellen wochenrückblick auswertung',
    steps: [
      '**Einstellungen → Auswertungen → Auswertungsadresse** prüfen → **Testmail**.',
      '**Datensicherung:** Sicherungs-Passwort festlegen (mindestens 10 Zeichen) und sofort in die Passwortliste. Ohne Passwort lässt sich keine Sicherung öffnen.',
      '**Jetzt sichern**, dann **Letzte prüfen**.',
      '**Wochenrückblick:** Tag und Uhrzeit wählen, per Mail und/oder Push. **Vorschau** zeigt die laufende Woche.',
    ],
    problems: [{ q: '„Letzte Sicherung fehlgeschlagen“', a: 'Die Meldung darunter nennt den Grund. Meist fehlt das Sicherungs-Passwort.' }],
    open: { to: '/einstellungen/auswertungen', label: 'Auswertungen' },
  },
  {
    id: 'wartung',
    category: 'admin',
    title: 'Wenn Daten fehlen oder jemand nichts bekommt',
    intro: 'Die Wartung zeigt für jede Person Geräte, Push und Postfächer und repariert hängende Abgleiche.',
    admin: true,
    keywords: 'wartung datenbank aktualisieren fehler hängt',
    steps: [
      '**Einstellungen → Integrationen → Wartung**.',
      'In der Liste sehen, wann die Person zuletzt online war, welche Geräte Push haben und welche Postfächer sie sieht.',
      '**Datenbank aktualisieren** tippen. Es geht nichts verloren, alle Geräte laden die Daten neu.',
      'Fehlen bei einer Person Geräte: auf ihrem iPhone **Einstellungen → Benachrichtigungen → Aktivieren**.',
    ],
    problems: [{ q: '„Interner Fehler“', a: 'Die Details stehen in `storage/app.log` (Plesk-Dateimanager). Den Inhalt Claude zeigen.' }],
    open: { to: '/einstellungen/integrationen', label: 'Wartung' },
  },
];

/** Suche über Titel, Einleitung, Schritte, Probleme und Stichwörter (Groß-/Kleinschreibung und Umlaute egal). */
export function searchHelp(query: string, list: HelpArticle[] = HELP): HelpArticle[] {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list
    .map((a) => {
      const title = norm(a.title);
      const body = norm([a.intro, a.keywords ?? '', ...a.steps, ...(a.problems ?? []).flatMap((p) => [p.q, p.a])].join(' '));
      if (!words.every((w) => title.includes(w) || body.includes(w))) return null;
      return { a, score: words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (norm(a.keywords ?? '').includes(w) ? 2 : 0), 0) };
    })
    .filter((x): x is { a: HelpArticle; score: number } => x !== null)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
