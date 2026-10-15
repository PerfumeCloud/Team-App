import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Bell, BellOff, Cake, Check, MessageCircleHeart, MessageSquareHeart, Newspaper, Send, Share2, Users } from 'lucide-react';
import { api, fehlertext } from '../lib/api';
import { useKunde } from '../lib/kontext';
import { toast } from '../lib/toast';
import { datum, punkteWort } from '../lib/format';
import { aboAufGeraet, alsApp, erlaubnis, istIos, pushAusschalten, pushEinschalten, pushMoeglich } from '../lib/push';
import { einladungsLink } from '../lib/einladung';
import type { Claim, Me, PushCategory, PushState } from '../lib/types';
import { Hb, Hinweis, KopierKnopf } from './ui';

/* ---------- Mitteilungen ---------- */

export function Mitteilungen() {
  const { me, setMe } = useKunde();
  const state = me.push;
  const [aktiv, setAktiv] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const moeglich = pushMoeglich();
  const iosOhneApp = istIos() && !alsApp();

  useEffect(() => {
    void aboAufGeraet().then((s) => setAktiv(!!s));
  }, []);

  function setzen(s: PushState | null) {
    if (s) setMe({ ...me, push: s } as Me);
  }

  async function einschalten() {
    setBusy(true);
    setFehler(null);
    try {
      setzen(await pushEinschalten());
      setAktiv(true);
      toast('Mitteilungen sind an');
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  async function ausschalten() {
    setBusy(true);
    setFehler(null);
    try {
      setzen(await pushAusschalten());
      setAktiv(false);
      toast('Mitteilungen auf diesem Gerät aus');
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  async function testen() {
    setBusy(true);
    setFehler(null);
    try {
      const r = await api<{ devices: number; results: { device: string; ok: boolean; reason: string }[] }>('POST', '/push/test');
      const fehlgeschlagen = r.results.filter((x) => !x.ok);
      if (r.devices === 0) setFehler('Auf keinem Gerät sind Mitteilungen eingeschaltet.');
      else if (fehlgeschlagen.length === 0) toast('Testnachricht ist unterwegs');
      else setFehler(`Nicht angekommen auf: ${fehlgeschlagen.map((x) => `${x.device}${x.reason ? ` (${x.reason})` : ''}`).join(', ')}`);
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setBusy(false);
    }
  }

  async function kategorie(cat: PushCategory, an: boolean) {
    if (!state) return;
    setzen({ ...state, prefs: { ...state.prefs, [cat]: an } });
    try {
      setzen(await api<PushState>('PUT', '/push/prefs', { [cat]: an }));
    } catch (e) {
      setzen(state);
      toast(fehlertext(e));
    }
  }

  const blockiert = erlaubnis() === 'denied';

  return (
    <section className="karte" id="mitteilungen">
      <div className="karte-kopf">
        <h2 className="karte-titel">Mitteilungen</h2>
        {aktiv && (
          <span className="erledigt">
            <Check /> an
          </span>
        )}
      </div>
      <p className="klein">Wir melden uns, wenn dein Paket unterwegs ist, Punkte gutgeschrieben werden oder es etwas Neues gibt. Werbung per E-Mail gibt es dafür nicht.</p>

      {iosOhneApp && !aktiv && (
        <Hinweis>
          Auf dem iPhone gehen Mitteilungen nur in der App: Füge den Club unten unter „Als App auf dem Handy“ zum Home-Bildschirm hinzu und öffne ihn von dort.
        </Hinweis>
      )}
      {!moeglich && !iosOhneApp && <Hinweis>Dieser Browser kann keine Mitteilungen empfangen.</Hinweis>}
      {blockiert && <Hinweis>Mitteilungen sind für diese App blockiert. Du kannst sie in den Einstellungen deines Geräts erlauben.</Hinweis>}
      {fehler && <Hinweis fehler>{fehler}</Hinweis>}

      <div className="code-reihe">
        {moeglich && !aktiv && (
          <Hb klein dunkel live busy={busy} disabled={me.preview || blockiert} icon={<Bell />} onClick={() => void einschalten()}>
            Mitteilungen einschalten
          </Hb>
        )}
        {aktiv && (
          <>
            <button className="knopf" onClick={() => void testen()} disabled={busy || me.preview}>
              <Send /> Test senden
            </button>
            <button className="knopf" onClick={() => void ausschalten()} disabled={busy || me.preview}>
              <BellOff /> Auf diesem Gerät aus
            </button>
          </>
        )}
      </div>

      {state && state.devices > 0 && (
        <div>
          {(Object.keys(state.categories) as PushCategory[]).map((cat) => (
            <label className="schalter" key={cat}>
              <span>{state.categories[cat]}</span>
              <input type="checkbox" checked={state.prefs[cat]} disabled={me.preview} onChange={(e) => void kategorie(cat, e.target.checked)} />
            </label>
          ))}
          <p className="winzig leise" style={{ marginTop: '.4rem' }}>
            Angemeldet auf {state.devices} {state.devices === 1 ? 'Gerät' : 'Geräten'}. Nachts warten Mitteilungen bis zum Morgen.
          </p>
        </div>
      )}
    </section>
  );
}

/* ---------- Extra-Punkte ---------- */

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function geburtstagText(mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number);
  return `${d}. ${MONATE[m - 1]}`;
}

function Geburtstag() {
  const { me, setMe } = useKunde();
  const p = me.program;
  const b = me.bonus;
  const [tag, setTag] = useState('');
  const [monat, setMonat] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  if (!b || p.bonus.birthday <= 0) return null;

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      setMe(await api<Me>('POST', '/me/birthday', { birthday: `${monat.padStart(2, '0')}-${tag.padStart(2, '0')}` }));
      toast('Geburtstag gespeichert');
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="extra">
      <span className="symbol">
        <Cake />
      </span>
      <div className="extra-inhalt">
        <b>{punkteWort(p.bonus.birthday)} zum Geburtstag</b>
        {b.birthday ? (
          <p className="klein">
            Eingetragen: {geburtstagText(b.birthday)}. {b.birthday_bonus_this_year ? 'Dein Geschenk für dieses Jahr hast du schon bekommen.' : 'Wir schicken dir die Punkte an deinem Tag.'}
          </p>
        ) : (
          <form className="geburtstag" onSubmit={speichern}>
            <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} required>
              <option value="">Tag</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}.
                </option>
              ))}
            </select>
            <select aria-label="Monat" value={monat} onChange={(e) => setMonat(e.target.value)} required>
              <option value="">Monat</option>
              {MONATE.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
            <button className="knopf" type="submit" disabled={busy || !tag || !monat || me.preview}>
              Speichern
            </button>
            <small className="leise">Nur Tag und Monat. Später ändern geht nur über uns, damit niemand doppelt feiert.</small>
          </form>
        )}
        {fehler && <Hinweis fehler>{fehler}</Hinweis>}
      </div>
    </div>
  );
}

function Einladen() {
  const { me } = useKunde();
  const p = me.program;
  const r = me.bonus?.referral;
  if (!r?.code) return null;
  const link = einladungsLink(r.code);
  const text = `Ich sammle im ${p.name} Punkte für meine Düfte. Mit meinem Link bekommst du nach deiner ersten Bestellung ${punkteWort(p.bonus.referred)} extra:`;

  async function teilen() {
    try {
      await navigator.share({ title: p.name, text, url: link });
    } catch {
      /* abgebrochen */
    }
  }

  return (
    <div className="extra">
      <span className="symbol">
        <Users />
      </span>
      <div className="extra-inhalt">
        <b>Freunde einladen</b>
        <p className="klein">
          {p.bonus.referrer > 0 && p.bonus.referred > 0
            ? `Ihr bekommt beide Punkte: du ${punkteWort(p.bonus.referrer)}, deine Freundin oder dein Freund ${punkteWort(p.bonus.referred)}, sobald die erste Bestellung gutgeschrieben ist.`
            : 'Punkte gibt es nach der ersten Bestellung.'}
          {r.invited > 0 && ` Bisher eingeladen: ${r.invited}${r.rewarded > 0 ? `, davon ${r.rewarded} mit Bonus` : ''}.`}
        </p>
        <div className="kopierfeld">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Dein Einladungslink" />
          <KopierKnopf text={link} nurIcon label="Link kopieren" />
          {'share' in navigator && (
            <button className="knopf knopf-rund" onClick={() => void teilen()} aria-label="Teilen" title="Teilen">
              <Share2 />
            </button>
          )}
        </div>
        <small className="leise">Dein Code: {r.code}</small>
      </div>
    </div>
  );
}

const CLAIM_STATUS: Record<Claim['status'], string> = { open: 'wird geprüft', approved: 'gutgeschrieben', rejected: 'nicht bestätigt' };

function Bewertung() {
  const { me, reloadMe } = useKunde();
  const p = me.program;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  if (p.bonus.review <= 0 || !me.bonus) return null;
  const claims = me.bonus.claims.filter((c) => c.kind === 'review').slice(0, 3);

  async function senden(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      await api('POST', '/me/review', { note: note.trim() });
      setNote('');
      toast('Danke! Wir schauen es uns an.');
      await reloadMe();
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="extra">
      <span className="symbol">
        <MessageSquareHeart />
      </span>
      <div className="extra-inhalt">
        <b>{punkteWort(p.bonus.review)} für deine Bewertung</b>
        <p className="klein">
          Du hast einen Duft im Shop oder bei Google bewertet? Schreib uns kurz, welchen und wo. Wir prüfen das und schreiben dir die Punkte gut.
        </p>
        <form className="formular" onSubmit={senden}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="z. B. „Sunset Dune, im Shop unter Anna M.“" style={{ minHeight: '4.5rem' }} />
          <div>
            <button className="knopf" type="submit" disabled={busy || note.trim().length < 3 || me.preview}>
              <Send /> Einreichen
            </button>
          </div>
        </form>
        {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        {claims.length > 0 && (
          <ul className="verlauf">
            {claims.map((c) => (
              <li key={c.id}>
                <span className="was">
                  {c.note}
                  <small>{datum(c.created_at, true)}</small>
                </span>
                <span className="klein leise">{c.status === 'approved' && c.points ? `+${c.points} · ` : ''}{CLAIM_STATUS[c.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Newsletter() {
  const { me } = useKunde();
  const p = me.program;
  if (p.bonus.newsletter <= 0 || !me.bonus) return null;
  return (
    <div className="extra">
      <span className="symbol">
        <Newspaper />
      </span>
      <div className="extra-inhalt">
        <b>{punkteWort(p.bonus.newsletter)} für den Newsletter</b>
        {me.bonus.newsletter ? (
          <p className="erledigt">
            <Check /> Du bist angemeldet, danke!
          </p>
        ) : (
          <p className="klein">
            Melde dich im <a href={me.shop_url}>Shop</a> unten auf der Seite für unseren Newsletter an. Die Punkte kommen innerhalb einer Stunde.
          </p>
        )}
      </div>
    </div>
  );
}

export function ExtraPunkte() {
  const { me } = useKunde();
  const p = me.program;
  const irgendwas = p.bonus.birthday > 0 || p.bonus.review > 0 || p.bonus.newsletter > 0 || !!me.bonus?.referral.code;
  if (!irgendwas) return null;
  return (
    <section className="karte" id="extra">
      <h2 className="karte-titel">Extra-Punkte</h2>
      <div className="extras">
        <Geburtstag />
        <Einladen />
        <Newsletter />
        <Bewertung />
      </div>
    </section>
  );
}

export function FeedbackLink() {
  return (
    <section className="karte">
      <div className="extra">
        <span className="symbol">
          <MessageCircleHeart />
        </span>
        <div className="extra-inhalt">
          <b>Wie gefällt dir der Club?</b>
          <p className="klein">Sag uns ehrlich, was gut läuft und was besser werden soll. Wir lesen alles.</p>
          <div>
            <Link className="knopf" to="/feedback">
              Feedback geben
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
