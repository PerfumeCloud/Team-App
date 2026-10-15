import { useState } from 'react';
import { RotateCcw, Send } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { punkte } from '../../lib/format';
import type { PushAdmin, PushCategory, PushTemplate } from '../../lib/types';
import { Hb, Hinweis, Laden, Seitenkopf } from '../../components/ui';
import { Kennzahl } from './Dashboard';

/** Beispielwerte für die Vorschau der Platzhalter */
const BEISPIEL: Record<string, string> = {
  vorname: 'Anna',
  bestellung: 'Bestellung #1042',
  punkte: '59',
  grund: 'Bestellung #1042',
  kontostand: '240',
  euro: '5 €',
  datum: '30.11.2026',
  code: 'PC-7KX2-M9QD',
  stufe: 'Silber',
  satz: '1,5 Punkte pro Euro',
  freund: 'Clara',
  aktion: 'Black Friday',
  faktor: 'doppelte',
  duft: 'Sunset Dune',
};

function fuellen(text: string): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => BEISPIEL[k] ?? m);
}

const STUNDEN = Array.from({ length: 24 }, (_, i) => i);

export default function PushSeite() {
  useTitel('Push');
  const { data, setData, error } = useLoad<PushAdmin>('/admin/push');
  const [aenderungen, setAenderungen] = useState<Record<string, Partial<PushTemplate>>>({});
  const [ruhe, setRuhe] = useState<{ start: number; end: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testFehler, setTestFehler] = useState<string | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const quiet = ruhe ?? data.stats.quiet;
  const week = data.stats.week;
  const zugestellt = week.sent ?? 0;
  const fehlgeschlagen = week.failed ?? 0;
  const ohneGeraet = week.no_device ?? 0;
  const geaendert = Object.keys(aenderungen).length > 0 || ruhe !== null;

  function setzen(key: string, feld: Partial<PushTemplate>) {
    setAenderungen((a) => ({ ...a, [key]: { ...a[key], ...feld } }));
  }

  async function speichern() {
    setBusy('speichern');
    try {
      const templates: Record<string, { title: string; body: string; enabled: boolean }> = {};
      for (const [key, a] of Object.entries(aenderungen)) {
        const t = data!.templates.find((x) => x.key === key)!;
        templates[key] = { title: a.title ?? t.title, body: a.body ?? t.body, enabled: a.enabled ?? t.enabled };
      }
      const r = await api<PushAdmin>('PUT', '/admin/push', { templates, ...(ruhe ? { quiet: ruhe } : {}) });
      setData({ ...data!, ...r });
      setAenderungen({});
      setRuhe(null);
      toast('Gespeichert');
    } catch (e) {
      toast(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  async function testen(t: PushTemplate) {
    const a = aenderungen[t.key] ?? {};
    setBusy(t.key);
    setTestFehler(null);
    try {
      const r = await api<{ devices: number; results: { device: string; ok: boolean; reason: string }[] }>('POST', '/admin/push/test', {
        template: t.key,
        title: a.title ?? t.title,
        body: a.body ?? t.body,
      });
      const schlecht = r.results.filter((x) => !x.ok);
      if (schlecht.length === 0) toast(`Test an ${r.devices} ${r.devices === 1 ? 'Gerät' : 'Geräte'} geschickt`);
      else setTestFehler(`Nicht angekommen: ${schlecht.map((x) => `${x.device}${x.reason ? ` (${x.reason})` : ''}`).join(', ')}`);
    } catch (e) {
      setTestFehler(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  const gruppen = (Object.keys(data.categories) as PushCategory[]).map((cat) => ({ cat, label: data.categories[cat], items: data.templates.filter((t) => t.cat === cat) }));

  return (
    <>
      <Seitenkopf label="Admin" titel={<>Push-<em>Mitteilungen</em></>}>
        <p>
          Mitglieder bekommen Mitteilungen zu Versand, Punkten und Aktionen. Die Texte hier gelten für alle automatischen Nachrichten. Nachrichten an alle Mitglieder (z. B. neue Düfte) verschickst du in
          der Team-App unter Club.
        </p>
      </Seitenkopf>

      <div className="kennzahlen">
        <Kennzahl titel="Mit Push" wert={punkte(data.stats.members)} unten={`Mitglieder · ${data.stats.devices} Geräte`} />
        <Kennzahl titel="Zugestellt" wert={punkte(zugestellt)} unten="letzte 7 Tage" />
        <Kennzahl titel="Fehlgeschlagen" wert={punkte(fehlgeschlagen)} unten={ohneGeraet > 0 ? `${punkte(ohneGeraet)} ohne Gerät` : 'letzte 7 Tage'} />
        <Kennzahl titel="Wartet" wert={punkte(week.queued ?? 0)} unten="z. B. bis zum Ende der Ruhezeit" />
      </div>

      {data.stats.errors.length > 0 && (
        <details className="karte mehr">
          <summary>Geräte mit Fehlern ({data.stats.errors.length})</summary>
          <ul className="tabelle">
            {data.stats.errors.map((e, i) => (
              <li key={i}>
                <span>
                  {e.device}
                  <small className="leise winzig" style={{ display: 'block' }}>
                    {e.status ? `HTTP ${e.status}` : ''} {e.error}
                  </small>
                </span>
                <span className="rechts klein">{e.fails}× in Folge</span>
              </li>
            ))}
          </ul>
          <p className="klein leise">Abgemeldete Geräte (HTTP 404/410) werden automatisch entfernt, nach 30 Fehlern in Folge ebenfalls.</p>
        </details>
      )}

      <section className="karte">
        <h2 className="karte-titel">Ruhezeit</h2>
        <p className="klein">In dieser Zeit warten automatische Mitteilungen bis zum Ende. Gleiche Uhrzeiten = keine Ruhezeit.</p>
        <div className="geburtstag">
          <label className="feld">
            <span>von</span>
            <select value={quiet.start} onChange={(e) => setRuhe({ ...quiet, start: Number(e.target.value) })}>
              {STUNDEN.map((h) => (
                <option key={h} value={h}>
                  {h} Uhr
                </option>
              ))}
            </select>
          </label>
          <label className="feld">
            <span>bis</span>
            <select value={quiet.end} onChange={(e) => setRuhe({ ...quiet, end: Number(e.target.value) })}>
              {STUNDEN.map((h) => (
                <option key={h} value={h}>
                  {h} Uhr
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {data.own_devices === 0 && (
        <Hinweis>
          Zum Testen brauchst du ein Gerät im Club: Öffne die Club-App mit deiner Team-E-Mail, tritt bei und schalte unter „Konto“ die Mitteilungen ein.
        </Hinweis>
      )}
      {testFehler && <Hinweis fehler>{testFehler}</Hinweis>}

      {gruppen.map((g) => (
        <section className="karte" key={g.cat}>
          <h2 className="karte-titel">{g.label}</h2>
          <div className="vorlagen">
            {g.items.map((t) => {
              const a = aenderungen[t.key] ?? {};
              const title = a.title ?? t.title;
              const body = a.body ?? t.body;
              const enabled = a.enabled ?? t.enabled;
              const anders = title !== t.default_title || body !== t.default_body;
              return (
                <div className={`vorlage${enabled ? '' : ' aus'}`} key={t.key}>
                  <label className="schalter" style={{ borderBottom: 0, paddingTop: 0 }}>
                    <span>
                      <b style={{ fontWeight: 400 }}>{t.label}</b>
                      <small>Platzhalter: {t.vars.map((v) => `{${v}}`).join(' ')}</small>
                    </span>
                    <input type="checkbox" checked={enabled} onChange={(e) => setzen(t.key, { enabled: e.target.checked })} aria-label={`${t.label} senden`} />
                  </label>
                  <div className="formular-reihe">
                    <label className="feld">
                      <span>Titel</span>
                      <input value={title} maxLength={120} disabled={!enabled} onChange={(e) => setzen(t.key, { title: e.target.value })} />
                    </label>
                    <label className="feld">
                      <span>Text</span>
                      <input value={body} maxLength={300} disabled={!enabled} onChange={(e) => setzen(t.key, { body: e.target.value })} />
                    </label>
                  </div>
                  <div className="push-vorschau" aria-label="Vorschau">
                    <img src="/brand/icon-192.png" alt="" />
                    <span>
                      <b>{fuellen(title)}</b>
                      {fuellen(body)}
                    </span>
                  </div>
                  <div className="code-reihe">
                    <button className="knopf knopf-klein" disabled={busy !== null || !enabled || data.own_devices === 0} onClick={() => void testen(t)}>
                      <Send /> {busy === t.key ? 'Sendet …' : 'Test an mich'}
                    </button>
                    {anders && (
                      <button className="knopf knopf-klein" onClick={() => setzen(t.key, { title: t.default_title, body: t.default_body })}>
                        <RotateCcw /> Standardtext
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {geaendert && (
        <div className="speichern-leiste">
          <span className="klein">Ungespeicherte Änderungen</span>
          <button
            className="knopf knopf-klein"
            onClick={() => {
              setAenderungen({});
              setRuhe(null);
            }}
          >
            Verwerfen
          </button>
          <Hb klein dunkel busy={busy === 'speichern'} onClick={() => void speichern()}>
            Speichern
          </Hb>
        </div>
      )}
    </>
  );
}
