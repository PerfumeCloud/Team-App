import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Frown, Meh, Smile } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useKunde } from '../lib/kontext';
import { useTitel } from '../lib/hooks';
import { Erfolg, Hb, Hinweis, Seitenkopf } from '../components/ui';

type Bewertung = 'gut' | 'neutral' | 'schlecht';

const WAHL: { key: Bewertung; label: string; Icon: typeof Smile }[] = [
  { key: 'gut', label: 'Gut', Icon: Smile },
  { key: 'neutral', label: 'Neutral', Icon: Meh },
  { key: 'schlecht', label: 'Schlecht', Icon: Frown },
];

export default function Feedback() {
  useTitel('Feedback');
  const { me, reloadMe } = useKunde();
  const [params] = useSearchParams();
  const anfrage = params.get('anfrage');
  const [frage, setFrage] = useState<string | null>(null);
  const [wahl, setWahl] = useState<Bewertung | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  useEffect(() => {
    if (!anfrage || !/^[0-9a-f-]{36}$/.test(anfrage)) return;
    api<{ id: string; title: string }>('GET', `/feedback/anfrage/${anfrage}`)
      .then((r) => setFrage(r.title))
      .catch(() => setFrage(null));
  }, [anfrage]);

  async function senden(e: FormEvent) {
    e.preventDefault();
    if (!wahl) return;
    setBusy(true);
    setFehler(null);
    try {
      await api('POST', '/feedback', { rating: wahl, text: text.trim() || undefined, anfrage: frage ? anfrage : undefined });
      setFertig(true);
      void reloadMe();
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Seitenkopf label="Feedback" titel={frage ? <>{frage}</> : <>Wie gefällt dir <em>der Club?</em></>} zurueck={{ to: '/konto', text: 'Konto' }}>
        <p>Deine Antwort geht direkt an unser Team. Danke, dass du dir die Zeit nimmst!</p>
      </Seitenkopf>

      <form className="karte formular" onSubmit={senden} style={{ maxWidth: '36rem' }}>
        <div className="bewertung" role="group" aria-label="Deine Bewertung">
          {WAHL.map(({ key, label, Icon }) => (
            <button key={key} type="button" aria-pressed={wahl === key} onClick={() => setWahl(key)}>
              <Icon aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <label className="feld">
          <span>Magst du uns sagen, warum? (freiwillig)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Was gefällt dir, was fehlt dir?" />
        </label>
        {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        <div>
          <Hb dunkel type="submit" busy={busy} disabled={!wahl || me.preview}>
            Absenden
          </Hb>
        </div>
      </form>

      {fertig && (
        <Erfolg name="DANKE" titel="Dein Feedback ist angekommen">
          <p>Wir lesen jede Antwort. Wenn du uns etwas gefragt hast, melden wir uns per E-Mail.</p>
          <Hb dunkel to="/">
            Zur Übersicht
          </Hb>
        </Erfolg>
      )}
    </>
  );
}
