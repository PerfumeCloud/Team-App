import { useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router';
import { CircleCheck, CircleX, Download, Frown, Mail, Meh, Pencil, Play, Plus, Smile, Square, Trash2 } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datum, datumZeit, euro, punkte, seit } from '../../lib/format';
import { faktorWort } from '../../lib/regeln';
import type { AdminPromo, FeedbackItem, InvitesOverview, OpenClaim } from '../../lib/types';
import { Chip, Dialog, Hb, Hinweis, Laden, Seitenkopf } from '../../components/ui';
import { Kennzahl } from './Dashboard';
import { useAdmin } from './AdminApp';
import { BefragungAdmin, EmpfehlungenAdmin } from './Kundenstimmen';

export default function Aktionen() {
  const { me } = useAdmin();
  return (
    <>
      <Seitenkopf label="Admin" titel={<>Aktionen &amp; <em>Anfragen</em></>} />
      <nav className="reiter" aria-label="Bereiche">
        <NavLink to="/admin/aktionen" end>
          Punkte-Aktionen
        </NavLink>
        <NavLink to="/admin/aktionen/anfragen">Bewertungen{me.open_claims > 0 ? ` (${me.open_claims})` : ''}</NavLink>
        <NavLink to="/admin/aktionen/warteliste">Warteliste</NavLink>
        <NavLink to="/admin/aktionen/feedback">Feedback</NavLink>
        <NavLink to="/admin/aktionen/befragung">Befragung</NavLink>
        <NavLink to="/admin/aktionen/empfehlungen">Empfehlungslinks</NavLink>
      </nav>
      <Routes>
        <Route index element={<Promotions />} />
        <Route path="anfragen" element={<Anfragen />} />
        <Route path="warteliste" element={<Warteliste />} />
        <Route path="feedback" element={<FeedbackListe />} />
        <Route path="befragung" element={<BefragungAdmin />} />
        <Route path="empfehlungen" element={<EmpfehlungenAdmin />} />
        <Route path="*" element={<Navigate to="/admin/aktionen" replace />} />
      </Routes>
    </>
  );
}

/* ---------- Doppelte Punkte für einen Zeitraum ---------- */

/** ms ↔ Wert für <input type="datetime-local"> (Ortszeit) */
function lokal(ms: number): string {
  const d = new Date(ms);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

const ZUSTAND: Record<AdminPromo['state'], { text: string; ton: 'good' | 'progress' | 'muted' }> = {
  running: { text: 'läuft', ton: 'good' },
  planned: { text: 'geplant', ton: 'progress' },
  done: { text: 'vorbei', ton: 'muted' },
};

interface Entwurf {
  id?: string;
  name: string;
  factor: string;
  starts: string;
  ends: string;
  push: boolean;
  push_title: string;
  push_body: string;
}

function neuerEntwurf(): Entwurf {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const ende = new Date(start);
  ende.setDate(ende.getDate() + 7);
  return { name: '', factor: '2', starts: lokal(start.getTime()), ends: lokal(ende.getTime()), push: true, push_title: '', push_body: '' };
}

function Promotions() {
  useTitel('Aktionen');
  const { data, setData, error } = useLoad<{ promotions: AdminPromo[] }>('/admin/promotions');
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [loeschen, setLoeschen] = useState<AdminPromo | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;

  async function speichern(e: FormEvent) {
    e.preventDefault();
    if (!entwurf) return;
    setBusy(true);
    setFehler(null);
    const body = {
      name: entwurf.name.trim(),
      factor: Number(entwurf.factor.replace(',', '.')),
      starts_at: new Date(entwurf.starts).getTime(),
      ends_at: new Date(entwurf.ends).getTime(),
      push: entwurf.push,
      push_title: entwurf.push_title.trim() || null,
      push_body: entwurf.push_body.trim() || null,
    };
    try {
      setData(await api<{ promotions: AdminPromo[] }>(entwurf.id ? 'PUT' : 'POST', entwurf.id ? `/admin/promotions/${entwurf.id}` : '/admin/promotions', body));
      setEntwurf(null);
      toast('Aktion gespeichert. App, Shop und Push ziehen automatisch nach.');
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  async function entfernen() {
    if (!loeschen) return;
    setBusy(true);
    try {
      setData(await api<{ promotions: AdminPromo[] }>('DELETE', `/admin/promotions/${loeschen.id}`));
      setLoeschen(null);
      toast('Aktion gelöscht');
    } catch (err) {
      toast(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  const liste = data.promotions;

  return (
    <>
      <section className="karte">
        <div className="karte-kopf">
          <h2>Mehr Punkte für einen Zeitraum</h2>
          {!entwurf && (
            <Hb klein dunkel icon={<Plus />} onClick={() => setEntwurf(neuerEntwurf())}>
              Neue Aktion
            </Hb>
          )}
        </div>
        <p className="klein leise">
          Zum Beispiel Launch-Woche oder Black Friday: Bestellungen im Zeitraum bekommen das Vielfache an Punkten. App, Shop (Punkteanzeige im Warenkorb) und Startseite zeigen die Aktion
          automatisch. Zum Start geht auf Wunsch eine Push-Nachricht an alle, die „Aktionen &amp; neue Düfte“ erlauben.
        </p>
        {entwurf && (
          <form className="formular" onSubmit={speichern}>
            <div className="formular-reihe">
              <label className="feld">
                <span>Name</span>
                <input value={entwurf.name} onChange={(e) => setEntwurf({ ...entwurf, name: e.target.value })} placeholder="z. B. Black Friday" maxLength={100} required />
              </label>
              <label className="feld">
                <span>Punkte-Faktor</span>
                <select value={entwurf.factor} onChange={(e) => setEntwurf({ ...entwurf, factor: e.target.value })}>
                  {['1.5', '2', '3', '4', '5'].map((f) => (
                    <option key={f} value={f}>
                      {f.replace('.', ',')}× ({faktorWort(Number(f))} Punkte)
                    </option>
                  ))}
                </select>
              </label>
              <label className="feld">
                <span>Start</span>
                <input type="datetime-local" value={entwurf.starts} onChange={(e) => setEntwurf({ ...entwurf, starts: e.target.value })} required />
              </label>
              <label className="feld">
                <span>Ende</span>
                <input type="datetime-local" value={entwurf.ends} onChange={(e) => setEntwurf({ ...entwurf, ends: e.target.value })} required />
              </label>
            </div>
            <label className="schalter">
              <span>
                Push zum Start senden
                <small>Einmal, sobald die Aktion beginnt (Ruhezeiten werden beachtet).</small>
              </span>
              <input type="checkbox" checked={entwurf.push} onChange={(e) => setEntwurf({ ...entwurf, push: e.target.checked })} />
            </label>
            {entwurf.push && (
              <div className="formular-reihe">
                <label className="feld">
                  <span>Titel (leer = Vorlage „Aktion startet“)</span>
                  <input value={entwurf.push_title} maxLength={120} onChange={(e) => setEntwurf({ ...entwurf, push_title: e.target.value })} placeholder="{aktion}: {faktor} Punkte" />
                </label>
                <label className="feld">
                  <span>Text (leer = Vorlage)</span>
                  <input value={entwurf.push_body} maxLength={300} onChange={(e) => setEntwurf({ ...entwurf, push_body: e.target.value })} placeholder="Bis {datum} sammelst du {faktor} Punkte auf jede Bestellung." />
                </label>
              </div>
            )}
            {fehler && <Hinweis fehler>{fehler}</Hinweis>}
            <div className="code-reihe">
              <Hb klein dunkel type="submit" busy={busy}>
                Speichern
              </Hb>
              <button type="button" className="knopf" onClick={() => setEntwurf(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </section>

      {liste.length === 0 && !entwurf && <p className="leise klein">Noch keine Aktionen angelegt.</p>}
      {liste.length > 0 && (
        <section className="karte">
          <ul className="verlauf">
            {liste.map((a) => (
              <li key={a.id}>
                <span className="was">
                  <span>
                    {a.name} <Chip tone={ZUSTAND[a.state].ton}>{ZUSTAND[a.state].text}</Chip>
                  </span>
                  <small>
                    {faktorWort(a.factor)} Punkte · {datumZeit(a.starts_at)} bis {datumZeit(a.ends_at)}
                    {a.push ? (a.pushed_at ? ` · Push verschickt ${seit(a.pushed_at)}` : ' · Push zum Start') : ''}
                    {a.orders > 0 ? ` · ${a.orders} Bestellungen, ${euro(a.revenue_cents)}, ${punkte(a.points)} Punkte` : ''}
                  </small>
                </span>
                <span className="code-reihe" style={{ flexWrap: 'nowrap' }}>
                  {a.state !== 'done' && (
                    <button
                      className="knopf knopf-rund knopf-klein"
                      aria-label="Bearbeiten"
                      title="Bearbeiten"
                      onClick={() =>
                        setEntwurf({
                          id: a.id,
                          name: a.name,
                          factor: String(a.factor),
                          starts: lokal(a.starts_at),
                          ends: lokal(a.ends_at),
                          push: a.push,
                          push_title: a.push_title ?? '',
                          push_body: a.push_body ?? '',
                        })
                      }
                    >
                      <Pencil />
                    </button>
                  )}
                  <button className="knopf knopf-rund knopf-klein knopf-gefahr" aria-label="Löschen" title="Löschen" onClick={() => setLoeschen(a)}>
                    <Trash2 />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loeschen && (
        <Dialog
          titel={`„${loeschen.name}“ löschen?`}
          onClose={() => !busy && setLoeschen(null)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setLoeschen(null)} disabled={busy}>
                Behalten
              </button>
              <button className="knopf knopf-gefahr" onClick={() => void entfernen()} disabled={busy}>
                <Trash2 /> Löschen
              </button>
            </>
          }
        >
          <p>Bestellungen, die schon mit dem Faktor gezählt wurden, behalten ihre Punkte. Neue Bestellungen bekommen wieder den normalen Satz.</p>
        </Dialog>
      )}
    </>
  );
}

/* ---------- Bewertungen bestätigen ---------- */

function Anfragen() {
  useTitel('Bewertungen');
  const { reload: reloadAdmin } = useAdmin();
  const { data, setData, error } = useLoad<{ claims: OpenClaim[] }>('/admin/claims');
  const [punkteEingabe, setPunkteEingabe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;

  async function entscheiden(c: OpenClaim, approve: boolean) {
    setBusy(c.id);
    try {
      const p = punkteEingabe[c.id];
      setData(await api<{ claims: OpenClaim[] }>('POST', `/admin/claims/${c.id}`, { approve, points: approve && p ? Number(p) : undefined }));
      toast(approve ? 'Bestätigt, Punkte und Push sind unterwegs' : 'Abgelehnt');
      void reloadAdmin();
    } catch (err) {
      toast(fehlertext(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="karte">
      <h2 className="karte-titel">Bewertungen bestätigen</h2>
      <p className="klein leise">Mitglieder melden hier ihre Bewertungen. Prüf kurz, ob es die Bewertung gibt, und schreib dann die Punkte gut (leer = Standardwert aus den Regeln).</p>
      {data.claims.length === 0 ? (
        <p className="leise">Gerade ist nichts offen.</p>
      ) : (
        <ul className="verlauf">
          {data.claims.map((c) => (
            <li key={c.id} style={{ flexWrap: 'wrap' }}>
              <span className="was">
                {c.note}
                <small>
                  <Link to={`/admin/mitglieder/${c.member.id}`}>{c.member.name || c.member.email}</Link> · {datum(c.created_at, true)}
                </small>
              </span>
              <span className="code-reihe" style={{ alignItems: 'center' }}>
                <input
                  aria-label="Punkte"
                  inputMode="numeric"
                  style={{ width: '6rem', height: '2.25rem', fontSize: '.9375rem' }}
                  placeholder="Punkte"
                  value={punkteEingabe[c.id] ?? ''}
                  onChange={(e) => setPunkteEingabe({ ...punkteEingabe, [c.id]: e.target.value.replace(/\D/g, '') })}
                />
                <button className="knopf knopf-klein" disabled={busy === c.id} onClick={() => void entscheiden(c, true)}>
                  <CircleCheck /> Bestätigen
                </button>
                <button className="knopf knopf-klein knopf-gefahr" disabled={busy === c.id} onClick={() => void entscheiden(c, false)}>
                  <CircleX /> Ablehnen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Warteliste einladen ---------- */

const INVITE_STATUS: Record<string, string> = { new: 'noch nicht eingeladen', queued: 'wird verschickt', sent: 'eingeladen', failed: 'Fehler', joined: 'beigetreten' };

function Warteliste() {
  useTitel('Warteliste');
  const { data, setData, error } = useLoad<InvitesOverview>('/admin/invites');
  const [vorlage, setVorlage] = useState<{ subject: string; text: string } | null>(null);
  const [starten, setStarten] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const t = vorlage ?? data.template;
  const offen = data.counts.new + data.counts.failed;

  async function aktion(name: string, method: string, path: string, body?: unknown, msg?: (r: InvitesOverview & { queued?: number; sent?: boolean; message?: string }) => string) {
    setBusy(name);
    try {
      const r = await api<InvitesOverview & { queued?: number; sent?: boolean; message?: string }>(method, path, body);
      if ('counts' in r) setData(r);
      if (msg) toast(msg(r));
      return r;
    } catch (err) {
      toast(fehlertext(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {!data.mail_ready && <Hinweis fehler>Für Einladungen muss zuerst der E-Mail-Versand eingerichtet sein (Einstellungen → Verbindungen).</Hinweis>}
      <div className="kennzahlen">
        <Kennzahl titel="Auf der Warteliste" wert={punkte(data.total)} unten={data.loaded_at ? `geladen ${seit(data.loaded_at)}` : 'noch nicht geladen'} />
        <Kennzahl titel="Eingeladen" wert={punkte(data.counts.sent)} unten={data.counts.queued > 0 ? `${data.counts.queued} in der Warteschlange` : undefined} />
        <Kennzahl titel="Beigetreten" wert={punkte(data.counts.joined)} unten={data.total > 0 ? `${Math.round((data.counts.joined / data.total) * 100)} %` : undefined} />
        <Kennzahl titel="Offen" wert={punkte(offen)} unten={data.counts.failed > 0 ? `${data.counts.failed} mit Fehler` : undefined} />
      </div>

      <section className="karte">
        <h2 className="karte-titel">So läuft es</h2>
        <ol className="klein" style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '.3rem' }}>
          <li>
            Warteliste aus Shopify laden: alle Kundenkonten mit dem Tag „{data.tag}“.
          </li>
          <li>Text prüfen und eine Testmail an dich schicken.</li>
          <li>Einladungen starten. Der Cronjob verschickt sie in Paketen (40 alle 15 Minuten).</li>
          <li>
            Wer beitritt, bekommt den Startbonus
            {data.start_bonus
              ? `: ${data.start_bonus.points} Punkte${data.start_bonus.requires_order ? ', freigeschaltet mit der ersten Bestellung' : ''}${data.start_bonus.until ? `, Anmeldung bis ${datum(data.start_bonus.until)}` : ''}`
              : ' (gerade ausgeschaltet)'}
            . <Link to="/admin/einstellungen#startbonus">Ändern</Link>
          </li>
        </ol>
        <div className="code-reihe">
          <button className="knopf" disabled={busy !== null} onClick={() => void aktion('laden', 'POST', '/admin/invites/load', undefined, (r) => `${r.found ?? 0} gefunden, ${r.added ?? 0} neu`)}>
            <Download /> {busy === 'laden' ? 'Lädt …' : 'Warteliste laden'}
          </button>
          <button className="knopf" disabled={busy !== null || !data.mail_ready} onClick={() => void aktion('test', 'POST', '/admin/invites/test', undefined, (r) => (r.sent ? 'Testmail ist unterwegs' : r.message ?? 'Nicht verschickt'))}>
            <Mail /> Testmail an mich
          </button>
          {data.counts.queued > 0 ? (
            <button className="knopf knopf-gefahr" disabled={busy !== null} onClick={() => void aktion('stop', 'POST', '/admin/invites/stop', undefined, () => 'Versand angehalten')}>
              <Square /> Versand anhalten
            </button>
          ) : (
            <Hb klein dunkel icon={<Play />} disabled={busy !== null || offen === 0 || !data.mail_ready} onClick={() => setStarten(true)}>
              {offen > 0 ? `${offen} Einladungen starten` : 'Alle eingeladen'}
            </Hb>
          )}
        </div>
      </section>

      <section className="karte formular">
        <h2 className="karte-titel">Text der Einladung</h2>
        <label className="feld">
          <span>Betreff</span>
          <input value={t.subject} maxLength={150} onChange={(e) => setVorlage({ ...t, subject: e.target.value })} />
        </label>
        <label className="feld">
          <span>Text (Absätze mit Leerzeile)</span>
          <textarea value={t.text} maxLength={3000} rows={6} onChange={(e) => setVorlage({ ...t, text: e.target.value })} />
          <small>Platzhalter: {'{vorname}'}, {'{club}'}, {'{startbonus}'}. Anrede, Startbonus-Kasten und der Knopf „Jetzt beitreten“ kommen automatisch dazu.</small>
        </label>
        <div>
          <button
            className="knopf"
            disabled={!vorlage || busy !== null}
            onClick={async () => {
              const r = await aktion('vorlage', 'PUT', '/admin/invites/template', t, () => 'Text gespeichert');
              if (r) setVorlage(null);
            }}
          >
            Speichern
          </button>
        </div>
      </section>

      {data.recent.length > 0 && (
        <section className="karte">
          <h2 className="karte-titel">Zuletzt</h2>
          <ul className="tabelle">
            {data.recent.map((r) => (
              <li key={r.email}>
                <span>
                  {r.first_name ? `${r.first_name} · ` : ''}
                  {r.email}
                  {r.error && <small className="leise winzig" style={{ display: 'block' }}>{r.error}</small>}
                </span>
                <span className="rechts klein">
                  {INVITE_STATUS[r.status] ?? r.status}
                  {r.sent_at && <small className="leise winzig" style={{ display: 'block' }}>{datumZeit(r.sent_at)}</small>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {starten && (
        <Dialog
          titel={`${offen} Einladungen verschicken?`}
          onClose={() => setStarten(false)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setStarten(false)}>
                Abbrechen
              </button>
              <Hb
                klein
                dunkel
                busy={busy === 'start'}
                onClick={async () => {
                  await aktion('start', 'POST', '/admin/invites/start', undefined, (r) => `${r.queued ?? 0} Einladungen in der Warteschlange`);
                  setStarten(false);
                }}
              >
                Jetzt starten
              </Hb>
            </>
          }
        >
          <p>Alle, die noch nicht eingeladen wurden, bekommen die E-Mail „{data.subject}“. Das lässt sich nicht zurückholen, du kannst den Versand aber jederzeit anhalten.</p>
        </Dialog>
      )}
    </>
  );
}

/* ---------- Feedback der Mitglieder ---------- */

const ICON = { gut: Smile, neutral: Meh, schlecht: Frown };

function FeedbackListe() {
  useTitel('Feedback');
  const { data, error } = useLoad<{ items: FeedbackItem[]; stats: { gut: number; neutral: number; schlecht: number }; email: string }>('/admin/feedback');
  const [filter, setFilter] = useState<'' | FeedbackItem['rating']>('');
  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const items = filter ? data.items.filter((f) => f.rating === filter) : data.items;
  return (
    <>
      <div className="kennzahlen">
        <Kennzahl titel="Gut" wert={punkte(data.stats.gut)} unten="letzte 90 Tage" />
        <Kennzahl titel="Neutral" wert={punkte(data.stats.neutral)} unten="letzte 90 Tage" />
        <Kennzahl titel="Schlecht" wert={punkte(data.stats.schlecht)} unten="letzte 90 Tage" />
        <Kennzahl titel="Weiterleitung" wert="Mail" unten={data.email} />
      </div>
      <p className="klein leise">
        Eine Feedback-Anfrage an alle Mitglieder verschickst du in der Team-App unter Club → Nachricht an Mitglieder (Vorlage „Feedback“). Jede Antwort geht zusätzlich per Mail an {data.email}.
      </p>
      <div className="reiter" role="group" aria-label="Filtern">
        {(['', 'gut', 'neutral', 'schlecht'] as const).map((k) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === '' ? 'Alle' : k === 'gut' ? 'Gut' : k === 'neutral' ? 'Neutral' : 'Schlecht'}
          </button>
        ))}
      </div>
      <section className="karte">
        {items.length === 0 ? (
          <p className="leise">Noch keine Antworten.</p>
        ) : (
          <ul className="verlauf">
            {items.map((f) => {
              const Icon = ICON[f.rating];
              return (
                <li key={f.id} style={{ alignItems: 'flex-start' }}>
                  <span className="was">
                    <span style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                      <Icon className="icon" style={{ color: 'var(--wood)' }} aria-hidden="true" />
                      {f.text || <span className="leise">ohne Begründung</span>}
                    </span>
                    <small>
                      {f.name || f.email || 'ausgetreten'} · {datumZeit(f.created_at)}
                      {f.broadcast ? ` · zu „${f.broadcast}“` : ''}
                      {!f.mailed && ' · Mail noch nicht verschickt'}
                    </small>
                  </span>
                  {f.email && (
                    <a className="knopf knopf-klein" href={`mailto:${f.email}`}>
                      <Mail /> Antworten
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
