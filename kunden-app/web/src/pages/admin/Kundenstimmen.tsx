import { useState } from 'react';
import { Eye, Plus, Send, Trash2 } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datum, euro, punkte } from '../../lib/format';
import type { SurveyQuestion } from '../../lib/types';
import { Chip, Hb, Hinweis, KopierKnopf, Laden } from '../../components/ui';
import { Kennzahl } from './Dashboard';

/* ======================= Befragung nach der Lieferung ======================= */

interface SurveyConfig {
  enabled: boolean;
  since: number;
  delay_days: number;
  fallback_days: number;
  min_gap_days: number;
  expire_days: number;
  push: boolean;
  mail_members: boolean;
  mail_newsletter: boolean;
  points: number;
  questions: SurveyQuestion[];
  comment: boolean;
  review_url: string;
  review_label: string;
  low_threshold: number;
  alert_team: boolean;
  reorder: boolean;
  reorder_days: number;
  retention_months: number;
  subject: string;
  intro: string;
  privacy_url: string;
  imprint_url: string;
  sender: string;
}

interface SurveyOverview {
  status: Record<string, number>;
  skipped: Record<string, number>;
  answered: number;
  sent: number;
  avg: number | null;
  low: number;
  distribution: Record<string, number>;
  products: { title: string; avg: number; count: number }[];
  recent: {
    order_name: string;
    name: string | null;
    member: boolean;
    avg: number | null;
    min: number | null;
    comment: string | null;
    items: { title: string; stars: number }[];
    at: number;
  }[];
  optouts: number;
  members_mail: number;
}

interface SurveyAdminData {
  config: SurveyConfig;
  overview: SurveyOverview;
  defaults: { privacy_url: string; imprint_url: string };
  mail_configured: boolean;
  feedback_email: string;
}

const SKIP_GRUND: Record<string, string> = {
  no_consent: 'ohne Einwilligung (keine Mail)',
  optout: 'abgemeldet',
  recent: 'kürzlich schon gefragt',
  mail_failed: 'Mail fehlgeschlagen',
  cancelled: 'Bestellung storniert',
  no_channel: 'kein Weg (keine App, keine Einwilligung)',
};

const sterne = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

function Zahl({
  label,
  wert,
  min,
  max,
  onChange,
  hilfe,
  einheit,
}: {
  label: string;
  wert: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  hilfe?: string;
  einheit?: string;
}) {
  return (
    <label className="feld">
      <span>{label}</span>
      <span className="feld-einheit">
        <input type="number" inputMode="numeric" min={min} max={max} value={wert} onChange={(e) => onChange(Number(e.target.value))} />
        {einheit && <span className="leise">{einheit}</span>}
      </span>
      {hilfe && <small>{hilfe}</small>}
    </label>
  );
}

function Schalter({
  label,
  hilfe,
  an,
  onChange,
  disabled,
}: {
  label: string;
  hilfe?: string;
  an: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="schalter">
      <span>
        {label}
        {hilfe && <small>{hilfe}</small>}
      </span>
      <input type="checkbox" checked={an} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Mail-Vorschau (HTML in einem abgeschotteten Rahmen, ohne Skripte). */
function MailVorschau({ kind, onClose }: { kind: 'survey' | 'reorder'; onClose: () => void }) {
  const { data, error } = useLoad<{ subject: string; html: string }>(`/admin/surveys/preview?kind=${kind}`);
  return (
    <div className="mail-vorschau-rahmen">
      <div className="karte-kopf">
        <span className="klein">
          <b>{kind === 'reorder' ? 'Nachkauf-Erinnerung' : 'Bewertungsanfrage'}</b>
          {data && ` · Betreff: ${data.subject}`}
        </span>
        <button className="knopf knopf-klein" onClick={onClose}>
          Schließen
        </button>
      </div>
      {error && <Hinweis fehler>{error}</Hinweis>}
      {data ? <iframe className="mail-vorschau" title="Mail-Vorschau" sandbox="" srcDoc={data.html} /> : !error && <Laden />}
    </div>
  );
}

export function BefragungAdmin() {
  useTitel('Befragung');
  const { data, setData, error } = useLoad<SurveyAdminData>('/admin/surveys');
  const [c, setC] = useState<SurveyConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<'survey' | 'reorder' | null>(null);
  const [test, setTest] = useState<{ message: string; link: string | null } | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const k = c ?? data.config;
  const geaendert = c !== null;
  const o = data.overview;
  const set = (p: Partial<SurveyConfig>) => setC({ ...k, ...p });
  const setFrage = (i: number, p: Partial<SurveyQuestion>) => set({ questions: k.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });

  async function speichern() {
    setBusy('speichern');
    setFehler(null);
    try {
      const { since: _since, ...rest } = k;
      void _since;
      const r = await api<SurveyAdminData>('PUT', '/admin/surveys', rest);
      setData(r);
      setC(null);
      toast('Gespeichert');
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  async function testen(kind: 'survey' | 'reorder') {
    setBusy('test-' + kind);
    try {
      setTest(await api<{ message: string; link: string | null }>('POST', '/admin/surveys/test', { kind }));
    } catch (e) {
      toast(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  const quote = o.sent > 0 ? `${Math.round((o.answered / o.sent) * 100)} % beantwortet` : 'noch keine';
  const maxVert = Math.max(1, ...Object.values(o.distribution));

  return (
    <>
      <section className="karte">
        <div className="karte-kopf">
          <h2>Befragung nach der Lieferung</h2>
          {data.config.enabled ? <Chip tone="good">an</Chip> : <Chip tone="muted">aus</Chip>}
        </div>
        <p className="klein leise">
          Ein paar Tage nach der Zustellung fragen wir, wie der Duft gefällt: ein Tipp auf die Sterne je Duft, danach bis zu drei freiwillige Fragen. Mitglieder
          bekommen eine Mitteilung in der App. Per E-Mail fragen wir nur mit Einwilligung – jede Mail hat einen Abmeldelink. Punkte gibt es fürs Mitmachen,
          unabhängig von der Bewertung.
        </p>
        <Schalter
          label="Befragung einschalten"
          hilfe="Gilt für Bestellungen ab dem Einschalten – ältere werden nicht nachträglich gefragt."
          an={k.enabled}
          onChange={(v) => set({ enabled: v })}
        />
      </section>

      <div className="kennzahlen">
        <Kennzahl titel="Verschickt" wert={punkte(o.sent)} unten="letzte 90 Tage" />
        <Kennzahl titel="Beantwortet" wert={punkte(o.answered)} unten={quote} />
        <Kennzahl
          titel="Durchschnitt"
          wert={o.avg !== null ? `${o.avg.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ★` : '–'}
          unten={`${punkte(o.low)} mit ≤ ${k.low_threshold} Sternen`}
        />
        <Kennzahl titel="Abgemeldet" wert={punkte(o.optouts)} unten={`${punkte(o.members_mail)} Mitglieder wollen Mails`} />
      </div>

      <section className="karte formular">
        <h2 className="karte-titel">Wann und wie</h2>
        <div className="formular-reihe">
          <Zahl
            label="Nach der Zustellung"
            einheit="Tage"
            wert={k.delay_days}
            min={0}
            max={30}
            onChange={(n) => set({ delay_days: n })}
            hilfe="Zeit zum Ausprobieren"
          />
          <Zahl label="Ohne Zustellmeldung" einheit="Tage nach Versand" wert={k.fallback_days} min={1} max={60} onChange={(n) => set({ fallback_days: n })} />
          <Zahl
            label="Höchstens alle"
            einheit="Tage pro Person"
            wert={k.min_gap_days}
            min={0}
            max={365}
            onChange={(n) => set({ min_gap_days: n })}
            hilfe="Damit Stammkundschaft nicht zu oft gefragt wird"
          />
          <Zahl label="Link gültig" einheit="Tage" wert={k.expire_days} min={3} max={120} onChange={(n) => set({ expire_days: n })} />
        </div>
        <Schalter
          label="Mitteilung in der App (Push)"
          hilfe="An Mitglieder, die „Bestellungen & Versand“ erlaubt haben"
          an={k.push}
          onChange={(v) => set({ push: v })}
        />
        <Schalter
          label="E-Mail an Mitglieder mit Einwilligung"
          hilfe="Mitglieder schalten das im Konto unter „Wie gefällt dir dein Duft?“ ein"
          an={k.mail_members}
          onChange={(v) => set({ mail_members: v })}
        />
        <Schalter
          label="E-Mail an Newsletter-Abonnenten"
          hilfe="Auch an Kundinnen und Kunden ohne Club. Nur einschalten, wenn der Einwilligungstext der Newsletter-Anmeldung Bewertungsanfragen erwähnt."
          an={k.mail_newsletter}
          onChange={(v) => set({ mail_newsletter: v })}
        />
        {!data.mail_configured && (k.mail_members || k.mail_newsletter) && (
          <Hinweis>Für E-Mails bitte unter Einstellungen → E-Mail den Versand einrichten.</Hinweis>
        )}
      </section>

      <section className="karte formular">
        <div className="karte-kopf">
          <h2 className="karte-titel">Fragen</h2>
          {k.questions.length < 3 && (
            <button className="knopf knopf-klein" onClick={() => set({ questions: [...k.questions, { id: '', text: '', type: 'stars', options: [] }] })}>
              <Plus /> Frage
            </button>
          )}
        </div>
        <p className="klein leise">Sterne je Duft sind immer dabei. Dazu höchstens drei freiwillige Fragen – je kürzer, desto mehr Antworten.</p>
        {k.questions.map((q, i) => (
          <div className="frage-editor" key={i}>
            <label className="feld">
              <span>Frage {i + 1}</span>
              <input
                value={q.text}
                maxLength={140}
                onChange={(e) => setFrage(i, { text: e.target.value })}
                placeholder="z. B. Wie zufrieden bist du mit der Verpackung?"
              />
            </label>
            <div className="formular-reihe">
              <label className="feld">
                <span>Antwort</span>
                <select value={q.type} onChange={(e) => setFrage(i, { type: e.target.value as SurveyQuestion['type'] })}>
                  <option value="stars">Sterne</option>
                  <option value="choice">Auswahl</option>
                  <option value="text">Kurzer Text</option>
                </select>
              </label>
              {q.type === 'choice' && (
                <label className="feld">
                  <span>Antworten (mit Komma getrennt)</span>
                  <input
                    value={q.options.join(', ')}
                    onChange={(e) =>
                      setFrage(i, {
                        options: e.target.value
                          .split(',')
                          .map((x) => x.trimStart())
                          .slice(0, 5),
                      })
                    }
                    placeholder="Ja, Vielleicht, Nein"
                  />
                </label>
              )}
            </div>
            <div>
              <button className="knopf knopf-klein knopf-gefahr" onClick={() => set({ questions: k.questions.filter((_, j) => j !== i) })}>
                <Trash2 /> Entfernen
              </button>
            </div>
          </div>
        ))}
        <Schalter label="Kommentarfeld" hilfe="Freitext, geht nur ans Team" an={k.comment} onChange={(v) => set({ comment: v })} />
      </section>

      <section className="karte formular">
        <h2 className="karte-titel">Danke &amp; Hinweise</h2>
        <div className="formular-reihe">
          <Zahl
            label="Punkte fürs Mitmachen"
            einheit="Punkte"
            wert={k.points}
            min={0}
            max={10000}
            onChange={(n) => set({ points: n })}
            hilfe="Nur Mitglieder, einmal pro Bestellung – unabhängig von den Sternen"
          />
          <label className="feld">
            <span>Hinweis ans Team ab</span>
            <select value={k.low_threshold} onChange={(e) => set({ low_threshold: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 Stern' : `${n} Sternen oder weniger`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Schalter
          label="Hinweis bei schlechter Bewertung"
          hilfe={`Mail an ${data.feedback_email || 'die Feedback-Adresse'} und Aufgabe mit Push in der Team-App`}
          an={k.alert_team}
          onChange={(v) => set({ alert_team: v })}
        />
        <div className="formular-reihe">
          <label className="feld">
            <span>Link „Bewertung im Shop“</span>
            <input value={k.review_url} placeholder="https://…" onChange={(e) => set({ review_url: e.target.value })} />
            <small>Wird allen gezeigt, die geantwortet haben – egal wie viele Sterne. Gefilterte Bewertungen wären irreführend.</small>
          </label>
          <label className="feld">
            <span>Beschriftung</span>
            <input value={k.review_label} maxLength={60} onChange={(e) => set({ review_label: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="karte formular">
        <h2 className="karte-titel">Nachkauf-Erinnerung</h2>
        <p className="klein leise">
          Einmalige Erinnerung, wenn der Flakon langsam leer sein könnte: als Mitteilung (Kategorie „Aktionen &amp; neue Düfte“), per E-Mail nur mit
          Newsletter-Einwilligung. Nicht nach einer schlechten Bewertung und nicht, wenn schon nachgekauft wurde.
        </p>
        <Schalter label="Nachkauf-Erinnerung schicken" an={k.reorder} onChange={(v) => set({ reorder: v })} />
        <Zahl label="Nach der Lieferung" einheit="Tage" wert={k.reorder_days} min={14} max={730} onChange={(n) => set({ reorder_days: n })} />
      </section>

      <section className="karte formular">
        <h2 className="karte-titel">E-Mail</h2>
        <div className="formular-reihe">
          <label className="feld">
            <span>Betreff</span>
            <input value={k.subject} maxLength={120} onChange={(e) => set({ subject: e.target.value })} />
            <small>Platzhalter: {'{vorname}'}</small>
          </label>
          <label className="feld">
            <span>Absender (Fußzeile)</span>
            <input value={k.sender} maxLength={200} onChange={(e) => set({ sender: e.target.value })} />
          </label>
        </div>
        <label className="feld">
          <span>Einleitung</span>
          <textarea value={k.intro} maxLength={400} onChange={(e) => set({ intro: e.target.value })} />
        </label>
        <div className="formular-reihe">
          <label className="feld">
            <span>Datenschutz-Link</span>
            <input value={k.privacy_url} placeholder={data.defaults.privacy_url} onChange={(e) => set({ privacy_url: e.target.value })} />
          </label>
          <label className="feld">
            <span>Impressum-Link</span>
            <input value={k.imprint_url} placeholder={data.defaults.imprint_url} onChange={(e) => set({ imprint_url: e.target.value })} />
          </label>
          <Zahl
            label="Antworten aufbewahren"
            einheit="Monate"
            wert={k.retention_months}
            min={1}
            max={120}
            onChange={(n) => set({ retention_months: n })}
            hilfe="Danach werden Befragungen gelöscht"
          />
        </div>
        <div className="code-reihe">
          <button className="knopf knopf-klein" onClick={() => setVorschau('survey')}>
            <Eye /> Vorschau Anfrage
          </button>
          <button className="knopf knopf-klein" disabled={busy !== null} onClick={() => void testen('survey')}>
            <Send /> {busy === 'test-survey' ? 'Sendet …' : 'Test an mich'}
          </button>
          <button className="knopf knopf-klein" onClick={() => setVorschau('reorder')}>
            <Eye /> Vorschau Nachkauf
          </button>
          <button className="knopf knopf-klein" disabled={busy !== null} onClick={() => void testen('reorder')}>
            <Send /> {busy === 'test-reorder' ? 'Sendet …' : 'Nachkauf an mich'}
          </button>
        </div>
        {geaendert && <p className="winzig leise">Vorschau und Test nutzen die gespeicherten Einstellungen.</p>}
        {vorschau && <MailVorschau key={vorschau} kind={vorschau} onClose={() => setVorschau(null)} />}
        {test && (
          <Hinweis>
            {test.message}{' '}
            {test.link && (
              <a href={test.link} target="_blank" rel="noopener">
                Bewertungsseite öffnen
              </a>
            )}
          </Hinweis>
        )}
      </section>

      <section className="karte">
        <h2 className="karte-titel">Auswertung (90 Tage)</h2>
        {o.answered === 0 ? (
          <p className="klein leise">Noch keine Antworten.</p>
        ) : (
          <>
            <div className="sterne-verteilung">
              {[5, 4, 3, 2, 1].map((n) => (
                <div key={n}>
                  <span>{n} ★</span>
                  <span className="balken">
                    <i style={{ width: `${((o.distribution[n] ?? 0) / maxVert) * 100}%` }} />
                  </span>
                  <span className="rechts">{o.distribution[n] ?? 0}</span>
                </div>
              ))}
            </div>
            {o.products.length > 0 && (
              <ul className="tabelle">
                {o.products.map((p) => (
                  <li key={p.title}>
                    <span>{p.title}</span>
                    <span className="rechts klein">
                      {p.avg.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ★ · {p.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="karte-titel" style={{ marginTop: '.6rem' }}>
              Letzte Antworten
            </h3>
            <ul className="tabelle">
              {o.recent.map((r, i) => (
                <li key={i}>
                  <span>
                    {r.name ?? 'Gast'} · {r.order_name} {r.member ? '' : <small className="leise">(kein Mitglied)</small>}
                    <small className="leise winzig" style={{ display: 'block' }}>
                      {r.items.map((it) => `${it.title} ${sterne(it.stars)}`).join(' · ')}
                    </small>
                    {r.comment && <small style={{ display: 'block' }}>„{r.comment}“</small>}
                  </span>
                  <span className="rechts klein">{datum(r.at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {Object.keys(o.skipped).length > 0 && (
          <p className="winzig leise">
            Nicht gefragt:{' '}
            {Object.entries(o.skipped)
              .map(([g, n]) => `${n} ${SKIP_GRUND[g] ?? g}`)
              .join(' · ')}
          </p>
        )}
      </section>

      {fehler && <Hinweis fehler>{fehler}</Hinweis>}
      {geaendert && (
        <div className="speichern-leiste">
          <span className="klein">Ungespeicherte Änderungen</span>
          <button className="knopf knopf-klein" onClick={() => setC(null)}>
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

/* ======================= Empfehlungslinks ======================= */

interface ReferralConfig {
  enabled: boolean;
  friend_type: 'percent' | 'fixed';
  friend_value: number;
  friend_min_cents: number;
  new_customers_only: boolean;
  segment_only: boolean;
  reward_type: 'points' | 'percent';
  reward_points: number;
  reward_percent: number;
  reward_min_cents: number;
  reward_max_year: number;
  combine_shipping: boolean;
  combine_order: boolean;
  combine_product: boolean;
}

interface ReferralAdminData {
  config: ReferralConfig;
  overview: {
    clicks_90: number;
    orders_90: number;
    revenue_90: number;
    codes: number;
    failed: { code: string; error: string | null }[];
    by_status: { status: string; reason: string | null; count: number; points: number }[];
    top: { member_id: string; name: string; orders: number; revenue_cents: number }[];
    recent: {
      order_name: string;
      member: string;
      code: string;
      amount_cents: number;
      points: number;
      status: string;
      reason: string | null;
      test: boolean;
      at: number;
    }[];
    friend_text: string;
    reward_text: string;
  };
  program: { redeem_points: number; redeem_cents: number; wait_days: number };
  shopify: boolean;
  own: { link: string } | null;
}

const REF_GRUND: Record<string, string> = {
  self: 'eigene Bestellung',
  existing: 'schon Kundin/Kunde',
  test: 'Testbestellung',
  cancelled: 'storniert',
  zero: '0 €',
  min: 'unter Mindestwert',
  payment: 'wartet auf Zahlung',
  shipping: 'wartet auf Versand',
  wait: 'Wartezeit',
  left: 'Mitglied ausgetreten',
  duplicate: 'schon über Einladung belohnt',
  limit: 'Jahreslimit erreicht',
};

const REF_STATUS: Record<string, { text: string; ton: 'good' | 'progress' | 'muted' | 'bad' }> = {
  pending: { text: 'vorgemerkt', ton: 'progress' },
  credited: { text: 'gutgeschrieben', ton: 'good' },
  void: { text: 'ohne Punkte', ton: 'muted' },
};

/** Euro-Eingabe ↔ Cent */
const zuCent = (s: string) => Math.max(0, Math.round(Number(s.replace(',', '.')) * 100) || 0);
const alsEuro = (c: number) => (c / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

export function EmpfehlungenAdmin() {
  useTitel('Empfehlungslinks');
  const { data, setData, error } = useLoad<ReferralAdminData>('/admin/referrals');
  const [c, setC] = useState<ReferralConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [fassung, setFassung] = useState(0);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const k = c ?? data.config;
  const o = data.overview;
  const verwerfen = () => {
    setC(null);
    setFassung((f) => f + 1);
  };
  const set = (p: Partial<ReferralConfig>) => setC({ ...k, ...p });

  // Beispiel: Punkte für eine Bestellung über 59 €
  const beispiel =
    k.reward_type === 'points'
      ? k.reward_points
      : Math.floor(((5900 * k.reward_percent) / 100) * (data.program.redeem_points / Math.max(1, data.program.redeem_cents)) + 1e-9);

  async function speichern() {
    setBusy('speichern');
    setFehler(null);
    try {
      setData(await api<ReferralAdminData>('PUT', '/admin/referrals', k));
      verwerfen();
      toast('Gespeichert. Die Codes in Shopify ziehen beim nächsten Abgleich nach.');
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  async function testen() {
    setBusy('test');
    try {
      const r = await api<{ message: string; link: string }>('POST', '/admin/referrals/test', {});
      setTest(`${r.message} Dein Link: ${r.link}`);
    } catch (e) {
      setTest(fehlertext(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="karte">
        <div className="karte-kopf">
          <h2>Empfehlungslinks</h2>
          {data.config.enabled ? <Chip tone="good">an</Chip> : <Chip tone="muted">aus</Chip>}
        </div>
        <p className="klein leise">
          Jedes Mitglied bekommt einen eigenen Link mit Rabatt für Freundinnen und Freunde. Wer darüber bestellt, muss nicht im Club sein – das Mitglied bekommt
          trotzdem Punkte. Zugeordnet wird über den Rabattcode in der Bestellung, ohne Tracking-Cookie.
        </p>
        {!data.shopify && <Hinweis>Dafür muss Shopify unter Einstellungen verbunden sein (Rabattcodes anlegen).</Hinweis>}
        <Schalter label="Empfehlungslinks einschalten" an={k.enabled} disabled={!data.shopify} onChange={(v) => set({ enabled: v })} />
      </section>

      <div className="kennzahlen">
        <Kennzahl titel="Klicks" wert={punkte(o.clicks_90)} unten="letzte 90 Tage" />
        <Kennzahl titel="Bestellungen" wert={punkte(o.orders_90)} unten="über einen Link" />
        <Kennzahl titel="Umsatz" wert={euro(o.revenue_90)} unten="über Links" />
        <Kennzahl titel="Aktive Codes" wert={punkte(o.codes)} unten={o.failed.length > 0 ? `${o.failed.length} fehlgeschlagen` : 'in Shopify'} />
      </div>

      <section className="karte formular" key={`rabatt-${fassung}`}>
        <h2 className="karte-titel">Rabatt für Freunde</h2>
        <div className="formular-reihe">
          <label className="feld">
            <span>Art</span>
            <select
              value={k.friend_type}
              onChange={(e) => set({ friend_type: e.target.value as ReferralConfig['friend_type'], friend_value: e.target.value === 'percent' ? 10 : 500 })}
            >
              <option value="percent">Prozent</option>
              <option value="fixed">Euro-Betrag</option>
            </select>
          </label>
          {k.friend_type === 'percent' ? (
            <Zahl label="Rabatt" einheit="%" wert={k.friend_value} min={1} max={100} onChange={(n) => set({ friend_value: n })} />
          ) : (
            <label className="feld">
              <span>Rabatt</span>
              <span className="feld-einheit">
                <input inputMode="decimal" defaultValue={alsEuro(k.friend_value)} onChange={(e) => set({ friend_value: zuCent(e.target.value) })} />
                <span className="leise">€</span>
              </span>
            </label>
          )}
          <label className="feld">
            <span>Mindestbestellwert</span>
            <span className="feld-einheit">
              <input inputMode="decimal" defaultValue={alsEuro(k.friend_min_cents)} onChange={(e) => set({ friend_min_cents: zuCent(e.target.value) })} />
              <span className="leise">€</span>
            </span>
          </label>
        </div>
        <Schalter
          label="Nur für die erste Bestellung"
          hilfe="Einmal pro Kundin/Kunde; Bestellungen von Bestandskunden bringen keine Punkte"
          an={k.new_customers_only}
          onChange={(v) => set({ new_customers_only: v })}
        />
        <Schalter
          label="Nur Kundensegment „Club: Neukunden“"
          hilfe="Shopify prüft dann beim Bezahlen, ob jemand noch nie bestellt hat (Segment muss existieren)"
          an={k.segment_only}
          onChange={(v) => set({ segment_only: v })}
        />
        <Schalter label="Kombinierbar mit Versandrabatten" an={k.combine_shipping} onChange={(v) => set({ combine_shipping: v })} />
        <Schalter label="Kombinierbar mit anderen Bestellrabatten" an={k.combine_order} onChange={(v) => set({ combine_order: v })} />
        <Schalter label="Kombinierbar mit Produktrabatten" an={k.combine_product} onChange={(v) => set({ combine_product: v })} />
      </section>

      <section className="karte formular" key={`belohnung-${fassung}`}>
        <h2 className="karte-titel">Belohnung fürs Mitglied</h2>
        <div className="formular-reihe">
          <label className="feld">
            <span>Art</span>
            <select value={k.reward_type} onChange={(e) => set({ reward_type: e.target.value as ReferralConfig['reward_type'] })}>
              <option value="points">Feste Punkte je Bestellung</option>
              <option value="percent">Prozent vom Bestellwert</option>
            </select>
          </label>
          {k.reward_type === 'points' ? (
            <Zahl label="Punkte" einheit="Punkte" wert={k.reward_points} min={0} max={100000} onChange={(n) => set({ reward_points: n })} />
          ) : (
            <Zahl label="Anteil" einheit="% als Punkte" wert={k.reward_percent} min={0} max={100} onChange={(n) => set({ reward_percent: n })} />
          )}
          <label className="feld">
            <span>Ab Bestellwert</span>
            <span className="feld-einheit">
              <input inputMode="decimal" defaultValue={alsEuro(k.reward_min_cents)} onChange={(e) => set({ reward_min_cents: zuCent(e.target.value) })} />
              <span className="leise">€</span>
            </span>
          </label>
          <Zahl
            label="Höchstens"
            einheit="Bestellungen im Jahr"
            wert={k.reward_max_year}
            min={0}
            max={1000}
            onChange={(n) => set({ reward_max_year: n })}
            hilfe="0 = ohne Grenze"
          />
        </div>
        <p className="klein leise">
          Beispiel: Für eine Bestellung über 59 € bekommt das Mitglied {punkte(beispiel)} Punkte – gutgeschrieben wie eigene Bestellungen nach{' '}
          {data.program.wait_days} Tagen Wartezeit (Widerrufsfrist).
        </p>
      </section>

      <section className="karte">
        <h2 className="karte-titel">Testen</h2>
        {data.own ? (
          <>
            <p className="klein">Dein eigener Link (Bestellungen von dir selbst bringen keine Punkte):</p>
            <div className="kopierfeld">
              <input readOnly value={data.own.link} aria-label="Dein Empfehlungslink" />
              <KopierKnopf text={data.own.link} nurIcon />
            </div>
          </>
        ) : (
          <p className="klein leise">Tritt mit deiner Admin-Adresse dem Club bei, dann bekommst du einen eigenen Link zum Testen.</p>
        )}
        <div>
          <button className="knopf knopf-klein" disabled={busy !== null || !data.config.enabled} onClick={() => void testen()}>
            <Send /> {busy === 'test' ? 'Prüft …' : 'Code anlegen und Push an mich'}
          </button>
        </div>
        {test && <Hinweis>{test}</Hinweis>}
        {o.failed.length > 0 && (
          <Hinweis fehler>Codes, die Shopify nicht angelegt hat: {o.failed.map((f) => `${f.code}${f.error ? ` (${f.error})` : ''}`).join(', ')}</Hinweis>
        )}
      </section>

      <section className="karte">
        <h2 className="karte-titel">Bestellungen über Links</h2>
        {o.recent.length === 0 ? (
          <p className="klein leise">Noch keine.</p>
        ) : (
          <ul className="tabelle">
            {o.recent.map((r) => (
              <li key={r.order_name + r.at}>
                <span>
                  {r.order_name} · {r.member} {r.test && <Chip tone="muted">Testbestellung</Chip>}
                  <small className="leise winzig" style={{ display: 'block' }}>
                    {datum(r.at)} · {euro(r.amount_cents)} · {r.code}
                    {r.reason ? ` · ${REF_GRUND[r.reason] ?? r.reason}` : ''}
                  </small>
                </span>
                <span className="rechts">
                  <Chip tone={REF_STATUS[r.status]?.ton ?? 'muted'}>
                    {r.points > 0 && r.status !== 'void' ? `${punkte(r.points)} P. ${REF_STATUS[r.status]?.text}` : (REF_STATUS[r.status]?.text ?? r.status)}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        )}
        {o.top.length > 0 && (
          <>
            <h3 className="karte-titel" style={{ marginTop: '.6rem' }}>
              Beste Empfehler
            </h3>
            <ul className="tabelle">
              {o.top.map((t) => (
                <li key={t.member_id}>
                  <span>{t.name}</span>
                  <span className="rechts klein">
                    {t.orders} {t.orders === 1 ? 'Bestellung' : 'Bestellungen'} · {euro(t.revenue_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {fehler && <Hinweis fehler>{fehler}</Hinweis>}
      {c !== null && (
        <div className="speichern-leiste">
          <span className="klein">Ungespeicherte Änderungen</span>
          <button className="knopf knopf-klein" onClick={verwerfen}>
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
