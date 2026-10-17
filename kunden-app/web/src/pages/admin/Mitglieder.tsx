import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Eye, ExternalLink, Search, Users } from 'lucide-react';
import { api, fehlertext, vorschauStarten } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datum, datumZeit, euro, punkte, punkteWort, seit } from '../../lib/format';
import type { AdminMember, AdminMemberDetail } from '../../lib/types';
import { Chip, Hb, Hinweis, Laden, Leer, Seitenkopf } from '../../components/ui';
import { codeStatus, Verlauf } from '../../components/Verlauf';
import { StufenZeichen } from '../../components/Club';

const STUFEN = [
  { key: '', name: 'Alle' },
  { key: 'bronze', name: 'Bronze' },
  { key: 'silber', name: 'Silber' },
  { key: 'gold', name: 'Gold' },
];

export function Mitglieder() {
  useTitel('Mitglieder');
  const [params, setParams] = useSearchParams();
  const [eingabe, setEingabe] = useState('');
  const [q, setQ] = useState('');
  const stufe = params.get('stufe') ?? '';
  useEffect(() => {
    const t = window.setTimeout(() => setQ(eingabe.trim()), 300);
    return () => window.clearTimeout(t);
  }, [eingabe]);
  const { data, error, loading } = useLoad<{ members: AdminMember[] }>(`/admin/members?q=${encodeURIComponent(q)}&stufe=${stufe}`);

  return (
    <>
      <Seitenkopf label="Admin" titel={<>Club-<em>Mitglieder</em></>} />
      {params.get('ansicht') && (
        <Hinweis>
          Mit deiner E-Mail gibt es noch kein Club-Konto. Wähle ein Mitglied und tippe auf „Als Mitglied ansehen“, oder öffne die <a href="/">Club-App</a> und tritt selbst bei.
        </Hinweis>
      )}
      <div className="code-reihe" style={{ alignItems: 'center' }}>
        <label className="feld" style={{ flex: '1 1 18rem', maxWidth: '28rem', position: 'relative' }}>
          <span className="sr">Suchen</span>
          <input type="search" placeholder="Name, E-Mail oder Einladungscode" value={eingabe} onChange={(e) => setEingabe(e.target.value)} style={{ paddingLeft: '2.9rem' }} />
          <Search className="icon" style={{ position: 'absolute', left: '1.1rem', top: '50%', translate: '0 -50%', color: 'var(--leise)' }} aria-hidden="true" />
        </label>
        <div className="reiter" role="group" aria-label="Nach Stufe filtern">
          {STUFEN.map((s) => (
            <button
              key={s.key}
              aria-pressed={stufe === s.key}
              onClick={() => {
                const p = new URLSearchParams(params);
                if (s.key) p.set('stufe', s.key);
                else p.delete('stufe');
                setParams(p, { replace: true });
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      {error && <Hinweis fehler>{error}</Hinweis>}
      {!data && loading && <Laden />}
      {data && data.members.length === 0 && (
        <div className="karte">
          <Leer icon={<Users />} titel={q || stufe ? 'Niemand gefunden' : 'Noch keine Mitglieder'}>
            <p>{q || stufe ? 'Versuch es mit einem anderen Suchbegriff oder Filter.' : 'Sobald sich jemand in der App anmeldet und beitritt, erscheint die Person hier.'}</p>
          </Leer>
        </div>
      )}
      {data && data.members.length > 0 && (
        <section className="karte">
          <ul className="tabelle">
            {data.members.map((m) => (
              <li key={m.id}>
                <Link className="zeile" to={`/admin/mitglieder/${m.id}`}>
                  <span style={{ display: 'flex', gap: '.7rem', alignItems: 'center', minWidth: 0 }}>
                    <StufenZeichen stufe={m.tier} klein />
                    <span style={{ display: 'grid', minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || m.email}</span>
                      <small className="leise winzig">
                        {m.name ? `${m.email} · ` : ''}
                        {m.tier_name} · seit {datum(m.joined_at)}
                      </small>
                    </span>
                  </span>
                  <span className="rechts">
                    {punkte(m.balance)}
                    {m.pending > 0 && (
                      <small className="leise winzig" style={{ display: 'block' }}>
                        +{punkte(m.pending)} unterwegs
                      </small>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data.members.length >= 100 && <p className="klein leise">Die ersten 100 Treffer. Such nach Name oder E-Mail, um weitere zu finden.</p>}
        </section>
      )}
    </>
  );
}

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const PUSH_STATUS: Record<string, string> = { queued: 'wartet', sending: 'wird gesendet', sent: 'zugestellt', failed: 'fehlgeschlagen', no_device: 'kein Gerät' };

export function Mitglied() {
  const { id } = useParams();
  const { data, setData, error } = useLoad<AdminMemberDetail>(`/admin/members/${id}`);
  useTitel(data ? data.member.name || data.member.email : 'Mitglied');
  const [punkteEingabe, setPunkteEingabe] = useState('');
  const [notiz, setNotiz] = useState('');
  const [art, setArt] = useState<'adjust' | 'bonus'>('bonus');
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
      setData(await api<AdminMemberDetail>('POST', `/admin/members/${m.id}/adjust`, { points: n, note: notiz.trim(), kind: n > 0 ? art : 'adjust' }));
      setPunkteEingabe('');
      setNotiz('');
      toast(n > 0 ? `${punkteWort(n)} gutgeschrieben, Push ist unterwegs` : `${punkteWort(-n)} abgezogen, Push ist unterwegs`);
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  async function aendern(feld: Record<string, string>) {
    try {
      setData(await api<AdminMemberDetail>('PUT', `/admin/members/${m.id}`, feld));
      toast('Gespeichert');
    } catch (err) {
      toast(fehlertext(err));
    }
  }

  const [gm, gt] = m.birthday ? m.birthday.split('-').map(Number) : [0, 0];

  return (
    <>
      <Seitenkopf zurueck={{ to: '/admin/mitglieder', text: 'Alle Mitglieder' }} label="Mitglied" titel={m.name || m.email}>
        {m.name && <p>{m.email}</p>}
      </Seitenkopf>

      <div className="code-reihe">
        <Hb klein dunkel icon={<Eye />} onClick={() => vorschauStarten(m.id)}>
          Als Mitglied ansehen
        </Hb>
        {m.shopify_url && (
          <a className="knopf" href={m.shopify_url} target="_blank" rel="noopener">
            <ExternalLink /> Im Shopify-Admin
          </a>
        )}
      </div>

      <div className="kennzahlen">
        <div className="kennzahl">
          <span className="label">Guthaben</span>
          <b>{punkte(m.balance)}</b>
          {m.expiring && (
            <small>
              {punkte(m.expiring.points)} verfallen am {datum(m.expiring.at)}
            </small>
          )}
        </div>
        <div className="kennzahl">
          <span className="label">Unterwegs</span>
          <b>{punkte(m.pending)}</b>
        </div>
        <div className="kennzahl">
          <span className="label">Mitglied seit</span>
          <b style={{ fontSize: '1.4rem' }}>{datum(m.joined_at)}</b>
          <small>zuletzt aktiv {seit(m.last_seen_at)}</small>
        </div>
        <div className="kennzahl">
          <span className="label">Push</span>
          <b style={{ fontSize: '1.4rem' }}>{m.devices > 0 ? `${m.devices} ${m.devices === 1 ? 'Gerät' : 'Geräte'}` : 'aus'}</b>
        </div>
      </div>

      <section className="karte">
        <h2 className="karte-titel">Stufe und Angaben</h2>
        <div className="formular-reihe">
          <label className="feld">
            <span>Stufe</span>
            <select value={m.tier} onChange={(e) => void aendern({ tier: e.target.value })}>
              {data.tiers.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            <small>
              Einkaufswert seit dem Beitritt: {euro(m.tier_spend_cents)}
              {m.tier_floor ? ` · bleibt mindestens ${data.tiers.find((t) => t.key === m.tier_floor)?.name ?? m.tier_floor}` : ''}. Von Hand gesetzt bleibt die Stufe mindestens erhalten; mit
              mehr Einkaufswert steigt sie weiter.
            </small>
          </label>
          <div className="feld">
            <span>Geburtstag</span>
            <div className="geburtstag">
              <select aria-label="Tag" value={gt || ''} onChange={(e) => void aendern({ birthday: e.target.value ? `${String(gm || 1).padStart(2, '0')}-${e.target.value.padStart(2, '0')}` : '' })}>
                <option value="">–</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {i + 1}.
                  </option>
                ))}
              </select>
              <select aria-label="Monat" value={gm || ''} onChange={(e) => void aendern({ birthday: e.target.value ? `${e.target.value.padStart(2, '0')}-${String(gt || 1).padStart(2, '0')}` : '' })}>
                <option value="">–</option>
                {MONATE.map((n, i) => (
                  <option key={n} value={String(i + 1)}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <small>Vom Team eingetragen gilt der Geburtstag sofort.</small>
          </div>
        </div>
        <div className="code-reihe">
          {m.waitlist && <Chip tone="progress">Warteliste</Chip>}
          {m.newsletter && <Chip tone="good">Newsletter</Chip>}
          {m.ref_code && <Chip tone="muted">Einladungscode {m.ref_code}</Chip>}
          {m.referred_by && (
            <Chip tone="muted">
              eingeladen von <Link to={`/admin/mitglieder/${m.referred_by.id}`}>{m.referred_by.name}</Link>
            </Chip>
          )}
          {m.invited > 0 && <Chip tone="good">{m.invited} eingeladen</Chip>}
        </div>
      </section>

      <form className="karte formular" onSubmit={buchen}>
        <h2 className="karte-titel">Punkte gutschreiben oder abziehen</h2>
        <div className="formular-reihe">
          <label className="feld">
            <span>Punkte (minus zum Abziehen)</span>
            <input inputMode="numeric" value={punkteEingabe} onChange={(e) => setPunkteEingabe(e.target.value.replace(/[^\d-]/g, ''))} placeholder="z. B. 50" />
          </label>
          <label className="feld">
            <span>Grund (steht in der Push-Nachricht)</span>
            <input value={notiz} maxLength={200} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. Entschuldigung für die Verspätung" />
          </label>
        </div>
        {!punkteEingabe.startsWith('-') && (
          <div className="reiter" role="group" aria-label="Art der Gutschrift">
            <button type="button" aria-pressed={art === 'bonus'} onClick={() => setArt('bonus')}>
              Bonus (zählt in der Statistik als Bonus)
            </button>
            <button type="button" aria-pressed={art === 'adjust'} onClick={() => setArt('adjust')}>
              Korrektur
            </button>
          </div>
        )}
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

      {data.pushes.length > 0 && (
        <section className="karte">
          <h2 className="karte-titel">Letzte Mitteilungen</h2>
          <ul className="verlauf">
            {data.pushes.map((p, i) => (
              <li key={i}>
                <span className="was">
                  {p.title}
                  <small>
                    {p.body}
                    {p.error ? ` · ${p.error}` : ''}
                  </small>
                </span>
                <span className="klein leise" style={{ textAlign: 'right' }}>
                  {PUSH_STATUS[p.status] ?? p.status}
                  <br />
                  {datumZeit(p.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
