import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ExternalLink, Search, Users } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datum, euro, punkte, punkteWort, seit } from '../../lib/format';
import type { AdminMember, Code, HistoryItem } from '../../lib/types';
import { Hb, Hinweis, Laden, Leer, Seitenkopf } from '../../components/ui';
import { codeStatus, Verlauf } from '../../components/Verlauf';

export function Mitglieder() {
  useTitel('Mitglieder');
  const [eingabe, setEingabe] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(eingabe.trim()), 300);
    return () => window.clearTimeout(t);
  }, [eingabe]);
  const { data, error, loading } = useLoad<{ members: AdminMember[] }>(`/admin/members?q=${encodeURIComponent(q)}`);

  return (
    <>
      <Seitenkopf label="Admin" titel={<>Club-<em>Mitglieder</em></>} />
      <label className="feld" style={{ maxWidth: '28rem', position: 'relative' }}>
        <span className="sr">Suchen</span>
        <input type="search" placeholder="Name oder E-Mail suchen" value={eingabe} onChange={(e) => setEingabe(e.target.value)} style={{ paddingLeft: '2.9rem' }} />
        <Search className="icon" style={{ position: 'absolute', left: '1.1rem', top: '50%', translate: '0 -50%', color: 'var(--leise)' }} aria-hidden="true" />
      </label>
      {error && <Hinweis fehler>{error}</Hinweis>}
      {!data && loading && <Laden />}
      {data && data.members.length === 0 && (
        <div className="karte">
          <Leer icon={<Users />} titel={q ? 'Niemand gefunden' : 'Noch keine Mitglieder'}>
            <p>{q ? 'Versuch es mit einem anderen Suchbegriff.' : 'Sobald sich jemand in der App anmeldet und beitritt, erscheint die Person hier.'}</p>
          </Leer>
        </div>
      )}
      {data && data.members.length > 0 && (
        <section className="karte">
          <ul className="tabelle">
            {data.members.map((m) => (
              <li key={m.id}>
                <Link className="zeile" to={`/admin/mitglieder/${m.id}`}>
                  <span style={{ display: 'grid', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || m.email}</span>
                    <small className="leise winzig">
                      {m.name ? `${m.email} · ` : ''}seit {datum(m.joined_at)}
                    </small>
                  </span>
                  <span className="rechts">
                    {punkte(m.balance)}
                    {m.pending > 0 && <small className="leise winzig" style={{ display: 'block' }}>+{punkte(m.pending)} unterwegs</small>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

interface MitgliedDaten {
  member: AdminMember;
  history: HistoryItem[];
  codes: Code[];
}

export function Mitglied() {
  const { id } = useParams();
  const { data, setData, error } = useLoad<MitgliedDaten>(`/admin/members/${id}`);
  useTitel(data ? data.member.name || data.member.email : 'Mitglied');
  const [punkteEingabe, setPunkteEingabe] = useState('');
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;
  const m = data.member;

  async function buchen(e: FormEvent) {
    e.preventDefault();
    const n = parseInt(punkteEingabe, 10);
    if (!n) {
      setFehler('Bitte eine Zahl angeben, z. B. 50 oder -20.');
      return;
    }
    setBusy(true);
    setFehler(null);
    try {
      setData(await api<MitgliedDaten>('POST', `/admin/members/${m.id}/adjust`, { points: n, note: notiz.trim() }));
      setPunkteEingabe('');
      setNotiz('');
      toast(n > 0 ? `${punkteWort(n)} gutgeschrieben` : `${punkteWort(-n)} abgezogen`);
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Seitenkopf zurueck={{ to: '/admin/mitglieder', text: 'Alle Mitglieder' }} label="Mitglied" titel={m.name || m.email}>
        {m.name && <p>{m.email}</p>}
      </Seitenkopf>

      <div className="kennzahlen">
        <div className="kennzahl">
          <span className="label">Guthaben</span>
          <b>{punkte(m.balance)}</b>
        </div>
        <div className="kennzahl">
          <span className="label">Unterwegs</span>
          <b>{punkte(m.pending)}</b>
        </div>
        <div className="kennzahl">
          <span className="label">Mitglied seit</span>
          <b style={{ fontSize: '1.4rem' }}>{datum(m.joined_at)}</b>
        </div>
        <div className="kennzahl">
          <span className="label">Zuletzt aktiv</span>
          <b style={{ fontSize: '1.4rem' }}>{seit(m.last_seen_at)}</b>
        </div>
      </div>

      {m.shopify_url && (
        <div>
          <a className="knopf" href={m.shopify_url} target="_blank" rel="noopener">
            <ExternalLink /> Im Shopify-Admin öffnen
          </a>
        </div>
      )}

      <form className="karte formular" onSubmit={buchen}>
        <h2 className="karte-titel">Punkte gutschreiben oder abziehen</h2>
        <div className="formular-reihe">
          <label className="feld">
            <span>Punkte (minus zum Abziehen)</span>
            <input inputMode="numeric" value={punkteEingabe} onChange={(e) => setPunkteEingabe(e.target.value.replace(/[^\d-]/g, ''))} placeholder="z. B. 50" />
          </label>
          <label className="feld">
            <span>Grund (sieht das Mitglied)</span>
            <input value={notiz} maxLength={200} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. Entschuldigung für die Verspätung" />
          </label>
        </div>
        {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        <div>
          <Hb klein dunkel type="submit" busy={busy}>
            Buchen
          </Hb>
        </div>
      </form>

      {data.codes.length > 0 && (
        <section className="karte">
          <h2 className="karte-titel">Codes</h2>
          <ul className="verlauf">
            {data.codes.map((c) => (
              <li key={c.id}>
                <span className="was">
                  <span style={{ fontFamily: '"Tenor Sans", sans-serif', letterSpacing: '.08em' }}>{c.code}</span>
                  <small>
                    {codeStatus(c)} · erstellt {datum(c.created_at)}
                  </small>
                </span>
                <span className="zahl">{euro(c.value_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="karte">
        <h2 className="karte-titel">Verlauf</h2>
        <Verlauf items={data.history} />
      </section>
    </>
  );
}
