# Merkliste: Rechtliches für die Überarbeitung des Shop-Themes

Diese Punkte gehören in die **Datenschutzerklärung**, die **Einwilligungstexte** und das **Theme**, sobald das Shop-Theme überarbeitet wird. Sie ergeben sich aus dem Club (Treuepunkte, Befragung nach der Lieferung, Empfehlungslinks) und der Team-App. Das ist eine Vorlage, keine Rechtsberatung. Die Textvorschläge sind so geschrieben, dass ihr sie direkt übernehmen und anpassen könnt.

**Stand der Apps:** Befragung und Empfehlungslinks sind im Club-Admin **ausgeschaltet**. „E-Mail an Newsletter-Abonnenten“ bei der Befragung bleibt aus, bis Punkt 3 erledigt ist.

| # | Was | Wo | Wann |
|---|---|---|---|
| 1 | Absatz „Perfume Cloud Club“ | Datenschutzerklärung | vor dem Club-Start |
| 2 | Absatz „Befragung nach der Lieferung“ | Datenschutzerklärung | bevor ihr die Befragung einschaltet |
| 3 | Newsletter-Einwilligung erweitern | Anmeldeformulare im Theme, Kasse | bevor „E-Mail an Newsletter-Abonnenten“ an geht |
| 4 | Absatz „Empfehlungslinks“ | Datenschutzerklärung | bevor ihr die Empfehlungslinks einschaltet |
| 5 | Absatz „Push-Mitteilungen“ | Datenschutzerklärung | vor dem Club-Start |
| 6 | Absatz „Kundenservice und interne Werkzeuge“ | Datenschutzerklärung | sobald die Team-App im Einsatz ist |
| 7 | Hinweis bei Kundenbewertungen | Produktseiten / Bewertungs-App | bevor es Punkte für öffentliche Bewertungen gibt |
| 8 | Fristen und Aufräumen | Team | laufend |
| 9 | Teilnahmebedingungen veröffentlichen | Shopify-Seite `/pages/club` | vor dem Club-Start |
| 10 | Impressum und Datenschutz verlinken | Club-App, Mails | erledigt, nur prüfen |
| 11 | Absatz „Instagram“ | Datenschutzerklärung | sobald Instagram in der Team-App verbunden ist |

---

## 1. Perfume Cloud Club (Treueprogramm)

> **Perfume Cloud Club (Treueprogramm).** Wenn du dem Club beitrittst, verarbeiten wir in unserer Club-App (app.perfumecloud.de) deinen Namen, deine E-Mail-Adresse, deine Kundennummer, deine Bestellungen (Nummer, Datum, Betrag, Status, Artikel, Sendungsnummer), deinen Punktestand, deine Stufe und deinen persönlichen Empfehlungscode, um das Treueprogramm durchzuführen (Art. 6 Abs. 1 lit. b DSGVO). Freiwillig kannst du deinen Geburtstag (Tag und Monat, für den Geburtstagsbonus) angeben, Push-Mitteilungen erlauben, an Befragungen teilnehmen und uns Feedback schicken. Die Anmeldung läuft über dein Shopify-Kundenkonto. Die App wird bei der netcup GmbH, Daimlerstraße 25, 76185 Karlsruhe, gehostet. Wenn du austrittst, löschen wir deine Club-Daten. Bestelldaten bleiben im Rahmen der gesetzlichen Aufbewahrungspflichten im Shop gespeichert.

(Das ist der Absatz aus KUNDEN-APP.md, Teil E, ergänzt um den Empfehlungscode und die Befragung.)

## 2. Befragung nach der Lieferung

Hintergrund: Eine Zufriedenheitsanfrage per E-Mail gilt in Deutschland als Werbung (BGH, Urteil vom 10.07.2018, VI ZR 225/17). Deshalb fragt die App per E-Mail **nur mit Einwilligung**: Mitglieder schalten das in der Club-App unter „Konto“ selbst ein, Newsletter-Abonnenten nur, wenn ihr das im Club-Admin einschaltet (siehe Punkt 3). Ohne Einwilligung fragt die App nur in der Club-App und per Push.

> **Befragung nach der Lieferung.** Einige Tage nach der Zustellung einer Bestellung fragen wir dich, wie dir deine Düfte gefallen. Wir fragen in unserer Club-App, per Push-Mitteilung, wenn du Mitteilungen zu „Bestellungen & Versand“ erlaubt hast, und per E-Mail nur, wenn du darin eingewilligt hast (Art. 6 Abs. 1 lit. a DSGVO). Dafür verwenden wir deine Bestellnummer, die bestellten Artikel, deinen Vornamen und deine E-Mail-Adresse. Wenn du antwortest, speichern wir deine Sterne je Duft, deine Antworten auf die Zusatzfragen und deinen Kommentar. Wir werten sie aus, um Produkte, Versand und Service zu verbessern, und melden uns bei einer schlechten Bewertung gegebenenfalls bei dir, um zu helfen (Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse an der Qualität unserer Produkte und unseres Service). Als Club-Mitglied bekommst du Punkte für die Teilnahme, unabhängig von deiner Bewertung (Art. 6 Abs. 1 lit. b DSGVO). Deine Antworten veröffentlichen wir nicht.
>
> Nach 24 Monaten entfernen wir Name, E-Mail-Adresse, Kundennummer und Kommentar; übrig bleiben nur anonyme Sterne für unsere Statistik. Anfragen, die du nicht beantwortest, löschen wir nach 6 Monaten. Du kannst der Befragung jederzeit widersprechen und deine Einwilligung widerrufen, über den Link in jeder E-Mail oder in der Club-App unter „Konto“. Damit wir dich danach nicht mehr fragen, speichern wir nur einen nicht umkehrbaren Prüfwert (Hash) deiner E-Mail-Adresse (Art. 6 Abs. 1 lit. c und f DSGVO).

**Achtung:** Die 24 Monate müssen zum Club-Admin passen (Aktionen → Befragung → E-Mail → „Antworten aufbewahren“).

## 3. Newsletter-Einwilligung erweitern

Soll die Befragung (und die Nachkauf-Erinnerung) auch an Newsletter-Abonnenten gehen, die nicht im Club sind, muss der Einwilligungstext beim Newsletter das nennen. Vorschlag für alle Anmeldefelder (Footer, Pop-up, Kasse, Kundenkonto):

> Ja, ich möchte den Perfume-Cloud-Newsletter per E-Mail erhalten: Neuigkeiten, Angebote, Fragen zu meinen Bestellungen (z. B. wie mir ein Duft gefällt) und Erinnerungen zum Nachbestellen. Abmelden geht jederzeit über den Link in jeder E-Mail. Mehr in der [Datenschutzerklärung](/policies/privacy-policy).

- Wer **vor** der Änderung zugestimmt hat, hat Bewertungsanfragen nicht ausdrücklich eingewilligt. Am sichersten ist es daher, „E-Mail an Newsletter-Abonnenten“ im Club-Admin **aus** zu lassen und nur die Club-Mitglieder mit eigenem Schalter per E-Mail zu fragen. Wenn ihr es einschalten wollt, dann erst, nachdem der neue Text eine Weile online ist, und am besten mit einer Rechtsberatung.
- Die **Nachkauf-Erinnerung** per E-Mail geht schon heute nur an Newsletter-Abonnenten (Werbung). Per Push geht sie an Mitglieder, die „Aktionen & neue Düfte“ erlaubt haben.
- Alternative für später (nur mit Rechtsberatung): Nach § 7 Abs. 3 UWG dürfen Bestandskunden ohne Einwilligung Werbung für **ähnliche eigene Waren** bekommen, wenn schon bei der Bestellung (an der Kasse) auf das Widerspruchsrecht hingewiesen wurde und jede Mail einen Abmeldelink hat. Das könnte für die Nachkauf-Erinnerung reichen, für Bewertungsanfragen ist es umstritten.

## 4. Empfehlungslinks

> **Empfehlungslinks.** Club-Mitglieder können einen persönlichen Empfehlungslink teilen. Er führt über app.perfumecloud.de in unseren Shop und hinterlegt dort einen Rabattcode im Warenkorb (Shopify setzt dafür ein technisch notwendiges Cookie). Wir zählen dabei nur, wie oft ein Link pro Tag geöffnet wurde. Wir setzen kein eigenes Cookie und speichern keine Daten über die Personen, die den Link öffnen. Bestellst du mit einem Empfehlungscode, ordnen wir deine Bestellung (Bestellnummer, Datum, Warenwert, Kundennummer) dem empfehlenden Mitglied zu, damit es dafür Punkte bekommt, und prüfen, ob es sich um eine Erstbestellung handelt (Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse an der Durchführung des Empfehlungsprogramms). Das Mitglied sieht nur, wie viele Bestellungen über seinen Link kamen, nicht, wer bestellt hat. Ein Empfehlungscode enthält den Vornamen des Mitglieds (z. B. ANNA-K2M4QX).

## 5. Push-Mitteilungen

> **Push-Mitteilungen.** Wenn du in der Club-App Mitteilungen erlaubst, speichern wir eine Kennung deines Browsers bzw. Geräts für Push-Mitteilungen und die Arten von Mitteilungen, die du bekommen möchtest (Art. 6 Abs. 1 lit. a DSGVO). Zugestellt werden die Mitteilungen verschlüsselt über den Push-Dienst deines Browsers oder Betriebssystems (z. B. Apple, Google oder Mozilla). Du kannst Mitteilungen jederzeit in der App oder in den Einstellungen deines Geräts ausschalten.

## 6. Kundenservice und interne Werkzeuge

> **Kundenservice.** Wenn du uns schreibst, sehen wir in unserem internen Team-Werkzeug zu deiner E-Mail-Adresse deine Bestellungen, ihren Versandstatus, deine Club-Stufe und deinen Punktestand sowie interne Notizen unseres Teams, damit wir dir schnell und passend antworten können (Art. 6 Abs. 1 lit. b und f DSGVO). Fällt deine Bewertung nach einer Lieferung schlecht aus, legen wir dort eine Aufgabe an, damit sich jemand bei dir meldet. Das Werkzeug läuft auf unserem eigenen Server bei der netcup GmbH in Deutschland. Sicherungskopien sind verschlüsselt und werden nach spätestens 8 Wochen gelöscht.

## 7. Hinweis bei Kundenbewertungen (Bewertungsbonus)

Seit Mai 2022 müsst ihr bei Kundenbewertungen im Shop angeben, **ob und wie** ihr prüft, dass sie von echten Käuferinnen und Käufern stammen (§ 5b Abs. 3 UWG). Bewertungen, für die es eine Gegenleistung gab (hier: Club-Punkte), müssen als solche erkennbar sein, sonst gilt das als Irreführung.

- **Bewertungs-App im Theme** (z. B. Judge.me oder Shopify Product Reviews): „Verifizierter Kauf“ einschalten und Bewertungen, für die es Punkte gab, markieren (z. B. Tag oder Badge „Mit Club-Punkten belohnt“).
- **Hinweistext** über den Bewertungen, Vorschlag:
  > Alle Bewertungen stammen von Kundinnen und Kunden, die den Duft bei uns gekauft haben. Wir prüfen das anhand der Bestellung. Für manche Bewertungen gab es Club-Punkte, unabhängig davon, wie sie ausgefallen sind. Diese sind gekennzeichnet.
- **Solange das nicht umgesetzt ist:** im Club-Admin den Bonus „Bewertung“ auf 0 setzen. Die Danke-Punkte der Befragung sind davon nicht betroffen, weil diese Antworten nicht veröffentlicht werden.
- Der Link „Bewertung im Shop“ erscheint nach der Befragung bei **allen** Antworten, nicht nur bei guten. So ist es gewollt: Wer nur zufriedene Kundinnen und Kunden zur öffentlichen Bewertung schickt, verfälscht das Bild (Review Gating). Bitte nicht ändern.

## 8. Fristen und Aufräumen

| Daten | Frist | Wie |
|---|---|---|
| Antworten der Befragung | 24 Monate, dann anonym | automatisch (Club-Cronjob) |
| Unbeantwortete Anfragen | 6 Monate | automatisch |
| Abmeldungen von der Befragung | dauerhaft, nur als Hash | automatisch |
| Hinweise ans Team (schlechte Bewertung) | 90 Tage im Club | automatisch |
| Aufgaben in der Team-App aus schlechten Bewertungen | **von Hand**: erledigte Aufgaben nach spätestens 24 Monaten löschen | Team |
| Klicks auf Empfehlungslinks | Zahl je Tag und Mitglied, bis zum Austritt | automatisch |
| Sicherungen auf dem Server | 14 Tage | automatisch |
| Instagram-Kommentare in der Team-App (Benutzername, Text) | 90 Tage | automatisch |
| Bilder geplanter Instagram-Beiträge auf dem Server | 30 Tage nach dem Veröffentlichen, gelöschte Entwürfe sofort | automatisch |
| Wochen-Sicherung per Mail an auswertung@ | **von Hand**: im Postfach eine Regel „Mails mit Betreff ‚Datensicherung‘ nach 8 Wochen löschen“ anlegen oder regelmäßig aufräumen | Marius |

## 9. Teilnahmebedingungen veröffentlichen

Neue Fassung: [TEILNAHMEBEDINGUNGEN.md](TEILNAHMEBEDINGUNGEN.md), HTML zum Einfügen: `kunden-app/shopify-pages/club-teilnahmebedingungen.html`. In Shopify unter **Onlineshop → Seiten → Perfume Cloud Club – Teilnahmebedingungen** den Inhalt ersetzen (Editor auf **HTML** `<>` umschalten), lesen, dann **Sichtbar** schalten. Im Theme gehören in den Footer Links zu den **Teilnahmebedingungen** und zur **Club-App**.

## 10. Impressum und Datenschutz in Club-App und Mails

Bereits eingebaut: Die Bewertungsseite, die Abmeldeseite und jede Befragungs- und Nachkauf-Mail verlinken auf Datenschutzerklärung (`/policies/privacy-policy`) und Impressum (`/policies/legal-notice`) im Shop. Beide Seiten müssen in Shopify unter **Einstellungen → Richtlinien** gepflegt sein. Liegen sie später unter einer anderen Adresse: Club-Admin → Aktionen → Befragung → E-Mail → „Datenschutz-Link“ und „Impressum-Link“.

## 11. Instagram

Die Team-App ist mit eurem Instagram-Konto verbunden (Auswertung, Beiträge veröffentlichen, Kommentare beantworten). Dafür gilt:

- **Kommentare:** Benutzername, Text, Zeitpunkt und Likes von Kommentaren auf euren Beiträgen werden in der Team-App gespeichert, damit ihr sie beantworten könnt, und nach **90 Tagen automatisch gelöscht**. Die „Zusammenfassung für Claude“ enthält keine Benutzernamen.
- **Statistik:** Reichweite, Zielgruppe (Alter, Geschlecht, Städte) und Kennzahlen liefert Instagram nur zusammengefasst, ohne einzelne Personen.
- **Bilder:** Bilder geplanter Beiträge liegen auf eurem Server. Öffentlich abrufbar (über eine nicht erratbare Adresse) sind sie nur zwischen Freigabe und Veröffentlichung, damit Instagram sie abholen kann; danach wieder nur für das Team. 30 Tage nach dem Veröffentlichen werden sie gelöscht.
- **Bildrechte:** Für jedes Bild und jede Musik müsst ihr die Rechte haben. Bei Personen auf Fotos deren Einwilligung einholen. Werbung mit Partnern (Kooperationen, Gratis-Produkte) kennzeichnen.

Vorschlag für die Datenschutzerklärung (ergänzt den Absatz zu Social Media, falls es ihn schon gibt):

> **Instagram.** Wir betreiben ein Unternehmensprofil auf Instagram (Meta Platforms Ireland Ltd., Merrion Road, Dublin 4, Irland). Für die Statistiken zu unserem Profil (z. B. Reichweite, Alter, Geschlecht und Städte unserer Follower, nur zusammengefasst) sind wir mit Meta gemeinsam verantwortlich (Art. 26 DSGVO); die Vereinbarung von Meta dazu findet ihr unter <https://www.facebook.com/legal/terms/page_controller_addendum>. Wenn du einen unserer Beiträge kommentierst, verarbeiten wir deinen Benutzernamen und deinen Kommentar in unserem internen Team-Werkzeug, um dir zu antworten (Art. 6 Abs. 1 lit. f DSGVO, unser Interesse: Kommunikation mit unserer Community). Diese Daten löschen wir dort nach 90 Tagen. Das Werkzeug läuft auf unserem eigenen Server bei der netcup GmbH in Deutschland. Für die Verarbeitung durch Instagram selbst gilt die Datenschutzrichtlinie von Instagram: <https://privacycenter.instagram.com/policy>.
