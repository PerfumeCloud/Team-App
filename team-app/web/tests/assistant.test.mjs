// Prüft den Ideen-Assistenten (ohne KI). Aufruf: node --test team-app/web/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIdea, findDate } from '../src/lib/assistant.ts';

// Montag, 12. Oktober 2026
const ctx = {
  people: [
    { id: 'u-marius', name: 'Marius' },
    { id: 'u-ben', name: 'Ben' },
    { id: 'u-keanu', name: 'Keanu' },
  ],
  meId: 'u-marius',
  today: '2026-10-12',
  categories: ['Marketing'],
};
const d = (text) => {
  const hit = findDate(text, ctx.today);
  return hit && `${hit.date.getFullYear()}-${String(hit.date.getMonth() + 1).padStart(2, '0')}-${String(hit.date.getDate()).padStart(2, '0')}`;
};
const brief = (t) => ({ title: t.title, who: t.assigneeId, due: t.due, prio: t.priority });

test('Datumsangaben', () => {
  assert.equal(d('morgen'), '2026-10-13');
  assert.equal(d('übermorgen'), '2026-10-14');
  assert.equal(d('bis Freitag'), '2026-10-16');
  assert.equal(d('am Montag'), '2026-10-19');
  assert.equal(d('nächste Woche Freitag'), '2026-10-23');
  assert.equal(d('Freitag nächste Woche'), '2026-10-23');
  assert.equal(d('nächste Woche'), '2026-10-19');
  assert.equal(d('Ende der Woche'), '2026-10-16');
  assert.equal(d('am Wochenende'), '2026-10-17');
  assert.equal(d('Ende des Monats'), '2026-10-31');
  assert.equal(d('Anfang Dezember'), '2026-12-01');
  assert.equal(d('Mitte November'), '2026-11-15');
  assert.equal(d('Ende November'), '2026-11-30');
  assert.equal(d('3. Dezember'), '2026-12-03');
  assert.equal(d('bis 15.11.'), '2026-11-15');
  assert.equal(d('am 2.1.'), '2027-01-02');
  assert.equal(d('15.11.2027'), '2028-11-15'.replace('2028', '2027'));
  assert.equal(d('in 2 Wochen'), '2026-10-26');
  assert.equal(d('in drei Tagen'), '2026-10-15');
  assert.equal(d('KW 47'), '2026-11-16');
  assert.equal(d('bis KW 47'), '2026-11-20');
  assert.equal(d('vor Black Friday'), '2026-11-27');
  assert.equal(d('Weihnachten'), '2026-12-24');
  assert.equal(d('Fr. Fotos'), '2026-10-16');
  assert.equal(d('mach das so. Danke'), null);
  assert.equal(d('Preis 15,90 €'), null);
  assert.equal(d('Neuer Duft mit Vanille'), null);
});

test('Diktierte Idee wird Notiz + Aufgaben', () => {
  const r = parseIdea(
    'Wir sollten im November einen Adventskalender mit 24 Proben machen, Ben kümmert sich um Fotos bis Freitag, Keanu um die Verpackung',
    ctx,
  );
  assert.ok(r.note);
  assert.match(r.note.title, /^Wir sollten im November einen Adventskalender/);
  assert.deepEqual(r.tasks.map(brief), [
    { title: 'Fotos', who: 'u-ben', due: '2026-10-16', prio: 'normal' },
    { title: 'Verpackung', who: 'u-keanu', due: null, prio: 'normal' },
  ]);
});

test('Liste mit Überschrift, @Person, Datum, !, #Kategorie und Unterpunkten', () => {
  const r = parseIdea(
    ['Adventskalender', '- Proben abfüllen @Keanu bis 15.11.', '- Fotos machen @Ben Freitag !', '- Produktseite anlegen #Shop', '  - Text schreiben', '  - Preis festlegen'].join('\n'),
    ctx,
  );
  assert.equal(r.note?.title, 'Adventskalender');
  assert.deepEqual(r.tasks.map(brief), [
    { title: 'Proben abfüllen', who: 'u-keanu', due: '2026-11-15', prio: 'normal' },
    { title: 'Fotos machen', who: 'u-ben', due: '2026-10-16', prio: 'high' },
    { title: 'Produktseite anlegen', who: null, due: null, prio: 'normal' },
  ]);
  assert.deepEqual(r.tasks[2].checklist, ['Text schreiben', 'Preis festlegen']);
  // Überschrift wird Kategorie, außer es gibt einen #Hashtag
  assert.equal(r.tasks[2].category, 'Shop');
});

test('Überschrift als Kategorie', () => {
  const r = parseIdea('Herbst-Gewinnspiel\n- Regeln schreiben\n- Post planen @Ben', ctx);
  assert.deepEqual(r.tasks.map((t) => t.category), ['Herbst-Gewinnspiel', 'Herbst-Gewinnspiel']);
});

test('Einzelne Aufgabe und Ich-Form', () => {
  assert.deepEqual(parseIdea('Etiketten bestellen', ctx).tasks.map(brief), [{ title: 'Etiketten bestellen', who: null, due: null, prio: 'normal' }]);
  assert.equal(parseIdea('Etiketten bestellen', ctx).note, null);
  assert.deepEqual(parseIdea('ich mache den Newsletter bis 20.11. !', ctx).tasks.map(brief), [
    { title: 'Newsletter machen', who: 'u-marius', due: '2026-11-20', prio: 'high' },
  ]);
  assert.deepEqual(parseIdea('Retouren-Etiketten mach ich', ctx).tasks.map(brief), [{ title: 'Retouren-Etiketten machen', who: 'u-marius', due: null, prio: 'normal' }]);
  assert.equal(parseIdea('ich muss noch dringend die Steuer machen', ctx).tasks[0].title, 'Steuer machen');
});

test('Person als Objekt wird nicht zuständig', () => {
  const [t] = parseIdea('Ben fragen wegen der Fotos', ctx).tasks;
  assert.equal(t.assigneeId, null);
  assert.equal(t.title, 'Ben fragen wegen der Fotos');
});

test('Person am Ende und konjugiertes Verb', () => {
  assert.deepEqual(parseIdea('Newsletter schreiben – Keanu', ctx).tasks.map(brief), [{ title: 'Newsletter schreiben', who: 'u-keanu', due: null, prio: 'normal' }]);
  assert.deepEqual(parseIdea('Fotos macht Ben', ctx).tasks.map(brief), [{ title: 'Fotos machen', who: 'u-ben', due: null, prio: 'normal' }]);
  assert.deepEqual(parseIdea('Ben macht die Fotos fertig, Keanu bestellt Flakons', ctx).tasks.map(brief), [
    { title: 'Fotos fertig machen', who: 'u-ben', due: null, prio: 'normal' },
    { title: 'Flakons bestellen', who: 'u-keanu', due: null, prio: 'normal' },
  ]);
  assert.deepEqual(parseIdea('Ben macht die Fotos und Keanu die Verpackung', ctx).tasks.map((t) => [t.title, t.assigneeId]), [
    ['Fotos machen', 'u-ben'],
    ['Verpackung', 'u-keanu'],
  ]);
});

test('Priorität niedrig', () => {
  assert.deepEqual(parseIdea('irgendwann Lager aufräumen', ctx).tasks.map(brief), [{ title: 'Lager aufräumen', who: null, due: null, prio: 'low' }]);
  assert.equal(parseIdea('Regal aufräumen, nicht dringend', ctx).tasks[0].priority, 'low');
});

test('Kategorien', () => {
  assert.equal(parseIdea('Reel drehen #instagram', ctx).tasks[0].category, 'Instagram');
  assert.equal(parseIdea('Reel drehen #marketing', ctx).tasks[0].category, 'Marketing');
  assert.equal(parseIdea('Instagram-Post für den Herbstduft planen', ctx).tasks[0].category, 'Marketing');
  assert.equal(parseIdea('DHL-Abholung buchen', ctx).tasks[0].category, 'Versand');
});

test('Checkliste nach Doppelpunkt', () => {
  const [t] = parseIdea('Shooting vorbereiten: Flakons, Licht und Hintergrund', ctx).tasks;
  assert.equal(t.title, 'Shooting vorbereiten');
  assert.deepEqual(t.checklist, ['Flakons', 'Licht', 'Hintergrund']);
});

test('Aufzählung mit Kommas', () => {
  assert.deepEqual(parseIdea('Fotos machen, Verpackung bestellen, Newsletter schreiben', ctx).tasks.map((t) => t.title), [
    'Fotos machen',
    'Verpackung bestellen',
    'Newsletter schreiben',
  ]);
});

test('Reine Idee bleibt Notiz', () => {
  const r = parseIdea('Neuer Duft: Vanille, Tonka und Sandelholz – eher süß, für den Winter', ctx);
  assert.equal(r.tasks.length, 0);
  assert.equal(r.note?.title, 'Neuer Duft');
  assert.match(r.note.body, /Sandelholz/);
  const long = parseIdea('Heute hatte ich die Idee für einen Herbstduft mit Kastanie und Rauch. Vielleicht als limitierte Edition mit nummerierten Flakons.', ctx);
  assert.equal(long.tasks.length, 0);
  assert.ok(long.note.title.length <= 62);
  assert.match(long.note.body, /nummerierten Flakons/);
});

test('Modus erzwingen', () => {
  const asNote = parseIdea('Ben macht die Fotos bis Freitag', ctx, 'note');
  assert.equal(asNote.tasks.length, 0);
  assert.equal(asNote.note?.title, 'Ben macht die Fotos bis Freitag');
  const asTasks = parseIdea('Duft mit Vanille. Verpackung in Gold', ctx, 'tasks');
  assert.equal(asTasks.note, null);
  assert.equal(asTasks.tasks.length, 2);
});

test('Weitere Alltagsfälle', () => {
  const idee = parseIdea('Idee: Duftproben-Set für Hochzeiten. Könnte man über Instagram bewerben. Ben fragt mal beim Lieferanten nach Preisen.', ctx);
  assert.equal(idee.note?.title, 'Duftproben-Set für Hochzeiten');
  assert.deepEqual(idee.tasks.map(brief), [{ title: 'Beim Lieferanten nach Preisen fragen', who: 'u-ben', due: null, prio: 'normal' }]);
  const kartons = parseIdea('Wir brauchen neue Versandkartons, die alten sind zu groß. Keanu bestellt welche bis Ende der Woche, dringend!', ctx);
  assert.deepEqual(kartons.tasks.map(brief), [{ title: 'Welche bestellen', who: 'u-keanu', due: '2026-10-16', prio: 'high' }]);
  assert.equal(parseIdea('Wenn Ben Zeit hat, macht er die Fotos', ctx).tasks.length, 1);
  const kampagne = parseIdea('Herbstkampagne\nZiel: mehr Probensets verkaufen\n- Reel drehen @Ben\n- Newsletter @ich Donnerstag', ctx);
  assert.equal(kampagne.note?.body, 'Ziel: mehr Probensets verkaufen');
  assert.deepEqual(kampagne.tasks.map((t) => [t.title, t.assigneeId, t.category]), [
    ['Reel drehen', 'u-ben', 'Herbstkampagne'],
    ['Newsletter', 'u-marius', 'Herbstkampagne'],
  ]);
});

test('Leere Eingabe', () => {
  assert.deepEqual(parseIdea('   ', ctx), { note: null, tasks: [] });
});
