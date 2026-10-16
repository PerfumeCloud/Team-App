import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Gift, Heart, MailX, Share2, Star, Store } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useStatus } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { punkte } from '../lib/format';
import { toast } from '../lib/toast';
import type { SurveyQuestion, SurveyView } from '../lib/types';
import { KundenShell } from '../components/Shell';
import { Hb, Hinweis, Kopierfeld, Laden, ProduktBild, Seitenkopf } from '../components/ui';

/** Fünf Sterne zum Antippen (große Flächen, mit Tastatur bedienbar). */
export function Sterne({
  wert,
  onWahl,
  label,
  klein,
  disabled,
}: {
  wert: number;
  onWahl: (n: number) => void;
  label: string;
  klein?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={klein ? 'sterne sterne-klein' : 'sterne'} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={wert === n}
          aria-label={n === 1 ? '1 Stern' : `${n} Sterne`}
          className={n <= wert ? 'an' : undefined}
          disabled={disabled}
          onClick={() => onWahl(n)}
        >
          <Star aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Öffentliche Seite aus der Mail oder Push: ohne Anmeldung, nur mit dem Link. */
export default function Bewertung() {
  useTitel('Bewertung');
  const { token = '' } = useParams();
  const status = useStatus();
  const [params, setParams] = useSearchParams();
  const [v, setV] = useState<SurveyView | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [abgemeldet, setAbgemeldet] = useState<string | null | false>(false);
  const vorgemerkt = useRef(false);

  const uebernehmen = useCallback((r: SurveyView) => {
    setV(r);
    setRatings({ ...r.ratings });
    setAnswers({ ...r.answers });
    setComment(r.comment ?? '');
  }, []);

  const speichern = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const r = await api<SurveyView>('POST', `/bewertung/${token}`, body);
        if (body.done) uebernehmen(r);
        else setV(r);
        setFehler(null);
        return r;
      } catch (e) {
        setFehler(fehlertext(e));
        return null;
      }
    },
    [token, uebernehmen],
  );

  useEffect(() => {
    api<SurveyView>('GET', `/bewertung/${token}`)
      .then(uebernehmen)
      .catch((e) => setFehler(fehlertext(e)));
  }, [token, uebernehmen]);

  // Stern direkt in der Mail angetippt (?s=5&p=0): erst speichern, wenn die Seite wirklich sichtbar ist –
  // Link-Prüfer von Mailprogrammen öffnen Links oft unsichtbar und sollen nichts bewerten.
  useEffect(() => {
    if (!v || vorgemerkt.current || v.state !== 'open') return;
    const s = Number(params.get('s'));
    const p = Number(params.get('p') ?? 0);
    const item = v.items[p];
    if (!item || !(s >= 1 && s <= 5)) return;
    const los = () => {
      if (document.visibilityState !== 'visible' || vorgemerkt.current) return;
      vorgemerkt.current = true;
      setRatings((r) => ({ ...r, [item.key]: s }));
      void speichern({ ratings: { [item.key]: s } });
      setParams({}, { replace: true });
    };
    los();
    document.addEventListener('visibilitychange', los);
    return () => document.removeEventListener('visibilitychange', los);
  }, [v, params, setParams, speichern]);

  if (!v) {
    return (
      <KundenShell shopUrl={status.shop_url ?? '/'} ohneDock>
        {fehler ? <Hinweis fehler>{fehler}</Hinweis> : <Laden />}
      </KundenShell>
    );
  }

  const name = v.first_name ? `, ${v.first_name}` : '';
  const bewertet = Object.keys(ratings).length > 0;

  const stern = (key: string, n: number) => {
    setRatings((r) => ({ ...r, [key]: n }));
    // Zwischenspeichern: auch wer danach die Seite schließt, hat bewertet
    void speichern({ ratings: { [key]: n } });
  };

  const absenden = async () => {
    setBusy(true);
    const r = await speichern({ ratings, answers, comment, done: true });
    setBusy(false);
    if (r) {
      setBearbeiten(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const abmelden = async () => {
    try {
      const r = await api<{ ok: boolean; email: string | null }>('POST', `/bewertung/${token}/abmelden`);
      setAbgemeldet(r.email);
    } catch (e) {
      toast(fehlertext(e));
    }
  };

  const fuss = (
    <footer className="befragung-fuss">
      {abgemeldet === false ? (
        <button type="button" className="textlink" onClick={() => void abmelden()}>
          Keine Bewertungsanfragen mehr
        </button>
      ) : (
        <span>
          <MailX aria-hidden="true" className="inline-symbol" /> Erledigt: {abgemeldet ?? 'Diese Adresse'} bekommt keine Bewertungsanfragen mehr.
        </span>
      )}
      <a href={v.privacy_url} target="_blank" rel="noopener">
        Datenschutz
      </a>
      <a href={v.imprint_url} target="_blank" rel="noopener">
        Impressum
      </a>
    </footer>
  );

  if (v.state === 'expired') {
    return (
      <KundenShell shopUrl={v.shop_url} ohneDock>
        <Seitenkopf
          label="Bewertung"
          titel={
            <>
              Diese Befragung ist <em>abgelaufen</em>
            </>
          }
        >
          <p>Schreib uns gern direkt, wie dir dein Duft gefällt – wir freuen uns über jede Nachricht.</p>
        </Seitenkopf>
        <div>
          <Hb dunkel href={v.shop_url}>
            Zum Shop
          </Hb>
        </div>
        {fuss}
      </KundenShell>
    );
  }

  if (v.state === 'answered' && v.thanks && !bearbeiten) {
    return (
      <KundenShell shopUrl={v.shop_url} ohneDock>
        <Danke v={v} name={name} onBearbeiten={() => setBearbeiten(true)} />
        {fuss}
      </KundenShell>
    );
  }

  return (
    <KundenShell shopUrl={v.shop_url} ohneDock>
      <Seitenkopf
        label={v.test ? 'Bewertung · Testbestellung' : 'Bewertung'}
        titel={
          <>
            Wie gefällt dir <em>{v.items.length > 1 ? 'deine Düfte' : 'dein Duft'}</em>
            {name}?
          </>
        }
      >
        <p>
          Bestellung {v.order_name} · Ein Tipp auf die Sterne genügt.
          {v.points > 0 && ` Als Dankeschön bekommst du ${punkte(v.points)} Punkte – egal, wie du bewertest.`}
        </p>
      </Seitenkopf>

      <section className="karte" aria-label="Deine Düfte">
        {v.items.map((it) => (
          <div className="duft-zeile" key={it.key}>
            <ProduktBild src={it.image} />
            <span className="name">
              {it.title}
              {it.variant && <small>{it.variant}</small>}
            </span>
            <Sterne wert={ratings[it.key] ?? 0} onWahl={(n) => stern(it.key, n)} label={`Bewertung für ${it.title}`} />
          </div>
        ))}
      </section>

      {bewertet && (v.questions.length > 0 || v.comment_enabled) && (
        <section className="karte formular" aria-label="Weitere Fragen">
          <span className="label">Freiwillig</span>
          {v.questions.map((q) => (
            <Frage key={q.id} q={q} wert={answers[q.id]} onWahl={(w) => setAnswers((a) => ({ ...a, [q.id]: w }))} />
          ))}
          {v.comment_enabled && (
            <label className="feld">
              <span>Möchtest du uns noch etwas sagen?</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
                placeholder="Was gefällt dir, was könnten wir besser machen?"
              />
              <small>Dein Kommentar geht nur an unser Team und wird nicht veröffentlicht.</small>
            </label>
          )}
        </section>
      )}

      {fehler && <Hinweis fehler>{fehler}</Hinweis>}
      <div>
        <Hb dunkel busy={busy} disabled={!bewertet} onClick={() => void absenden()}>
          {v.state === 'answered' ? 'Änderung speichern' : 'Absenden'}
        </Hb>
      </div>
      {fuss}
    </KundenShell>
  );
}

function Frage({ q, wert, onWahl }: { q: SurveyQuestion; wert: string | number | undefined; onWahl: (w: string | number) => void }) {
  if (q.type === 'stars') {
    return (
      <div className="feld">
        <span>{q.text}</span>
        <Sterne klein wert={Number(wert ?? 0)} onWahl={onWahl} label={q.text} />
      </div>
    );
  }
  if (q.type === 'choice') {
    return (
      <div className="feld">
        <span>{q.text}</span>
        <div className="auswahl" role="group" aria-label={q.text}>
          {q.options.map((o) => (
            <button key={o} type="button" aria-pressed={wert === o} onClick={() => onWahl(o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <label className="feld">
      <span>{q.text}</span>
      <input value={String(wert ?? '')} maxLength={500} onChange={(e) => onWahl(e.target.value)} />
    </label>
  );
}

function Danke({ v, name, onBearbeiten }: { v: SurveyView; name: string; onBearbeiten: () => void }) {
  const t = v.thanks!;
  const teilen = async (link: string) => {
    const text = `${t.referral?.friend_text ?? ''} bei Perfume Cloud – mit meinem Link:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Perfume Cloud', text, url: link });
        return;
      } catch {
        /* abgebrochen */
      }
    }
    toast(
      (await navigator.clipboard?.writeText(link).then(
        () => true,
        () => false,
      ))
        ? 'Link kopiert'
        : 'Kopieren hat nicht geklappt',
    );
  };
  return (
    <>
      <Seitenkopf
        label="Danke"
        titel={
          <>
            Danke{name}, <em>das hilft uns sehr</em>
          </>
        }
      >
        <p>
          {t.low
            ? 'Das tut uns leid. Unser Team schaut sich deine Rückmeldung an und meldet sich bei dir.'
            : 'Wir lesen jede Antwort und lernen daraus für die nächsten Düfte.'}
        </p>
      </Seitenkopf>

      {t.points > 0 && (
        <Kachel icon={<Gift />} titel={`+${punkte(t.points)} Punkte`}>
          <p>Sind deinem Club-Konto gutgeschrieben.</p>
        </Kachel>
      )}

      {t.referral && (
        <Kachel icon={<Heart />} titel="Teile deinen Lieblingsduft">
          <p>
            Deine Freundinnen und Freunde bekommen {t.referral.friend_text}. Du bekommst {t.referral.reward_text}.
          </p>
          <Kopierfeld label="Dein Empfehlungslink" wert={t.referral.link} />
          <div>
            <button type="button" className="knopf" onClick={() => void teilen(t.referral!.link)}>
              <Share2 /> Link teilen
            </button>
          </div>
        </Kachel>
      )}

      {t.review && (
        <Kachel icon={<Store />} titel="Magst du auch im Shop bewerten?">
          <p>Andere freuen sich über ehrliche Erfahrungen – egal ob begeistert oder kritisch.</p>
          <div>
            <Hb href={t.review.url} neuesFenster>
              {t.review.label}
            </Hb>
          </div>
        </Kachel>
      )}

      {t.join && (
        <Kachel icon={<Gift />} titel={`Schon im ${t.join.program}?`}>
          <p>Sammle Punkte bei jeder Bestellung{t.join.welcome_points > 0 ? ` – zum Start gibt es ${punkte(t.join.welcome_points)} Punkte geschenkt` : ''}.</p>
          <div>
            <Hb dunkel href={t.join.url}>
              Kostenlos beitreten
            </Hb>
          </div>
        </Kachel>
      )}

      <p>
        <button type="button" className="textlink" onClick={onBearbeiten}>
          Bewertung ändern
        </button>
      </p>
    </>
  );
}

function Kachel({ icon, titel, children }: { icon: ReactNode; titel: string; children: ReactNode }) {
  return (
    <section className="karte">
      <div className="karte-kopf karte-kopf-links">
        <span className="symbol">{icon}</span>
        <h2 className="karte-titel">{titel}</h2>
      </div>
      {children}
    </section>
  );
}

/** /abmelden/:token – Ziel des Abmeldelinks in der Mail (mit Bestätigung, damit Link-Prüfer nichts auslösen). */
export function Abmelden() {
  useTitel('Abmelden');
  const { token = '' } = useParams();
  const status = useStatus();
  const [fertig, setFertig] = useState<string | null | false>(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const los = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; email: string | null }>('POST', `/abmelden/${token}`);
      setFertig(r.email);
      setFehler(null);
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KundenShell shopUrl={status.shop_url ?? '/'} ohneDock>
      {fertig === false ? (
        <>
          <Seitenkopf
            label="Abmelden"
            titel={
              <>
                Keine <em>Bewertungsanfragen</em> mehr?
              </>
            }
          >
            <p>Wir fragen dann nach Bestellungen nicht mehr, wie dir dein Duft gefällt, und schicken keine Nachkauf-Erinnerungen per Mail.</p>
          </Seitenkopf>
          {fehler && <Hinweis fehler>{fehler}</Hinweis>}
          <div>
            <Hb dunkel busy={busy} onClick={() => void los()}>
              Abmelden
            </Hb>
          </div>
        </>
      ) : (
        <Seitenkopf
          label="Abmelden"
          titel={
            <>
              Du bist <em>abgemeldet</em>
            </>
          }
        >
          <p>
            {fertig ?? 'Diese Adresse'} bekommt keine Bewertungsanfragen mehr. Falls du es dir anders überlegst: im Club unter Konto kannst du sie wieder
            einschalten.
          </p>
        </Seitenkopf>
      )}
    </KundenShell>
  );
}
