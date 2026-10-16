import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { CircleCheck, CircleX, Mail, Plus, Trash2, X } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import { datumZeit, seit } from '../../lib/format';
import type { AccessOverview, Check, FullProgram, Settings, Tier } from '../../lib/types';
import { Dialog, Hb, Hinweis, Kopierfeld, Laden, Seitenkopf } from '../../components/ui';
import { StufenZeichen } from '../../components/Club';
import { useAdmin } from './AdminApp';

function Ergebnis({ test }: { test: Check | null }) {
  if (!test) return null;
  return (
    <p className={`check ${test.ok ? 'ok' : 'nein'}`}>
      {test.ok ? <CircleCheck /> : <CircleX />} {test.message}
    </p>
  );
}

function Schalter({ titel, text, an, onChange, disabled }: { titel: string; text?: string; an: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="schalter">
      <span>
        {titel}
        {text && <small>{text}</small>}
      </span>
      <input type="checkbox" role="switch" checked={an} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Feld({ titel, hilfe, children }: { titel: string; hilfe?: ReactNode; children: ReactNode }) {
  return (
    <label className="feld">
      <span>{titel}</span>
      {children}
      {hilfe && <small>{hilfe}</small>}
    </label>
  );
}

/** Ein Abschnitt mit eigenem Speichern-Knopf */
function Abschnitt({ titel, text, children, onSave, knopf = 'Speichern', extra, id }: { titel: string; text?: ReactNode; children: ReactNode; onSave: () => Promise<void>; knopf?: string; extra?: ReactNode; id?: string }) {
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  async function absenden(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler(null);
    try {
      await onSave();
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="karte formular" onSubmit={absenden} id={id}>
      <h2 className="karte-titel">{titel}</h2>
      {text && <p className="klein leise">{text}</p>}
      {children}
      {fehler && <Hinweis fehler>{fehler}</Hinweis>}
      <div className="code-reihe">
        <Hb klein dunkel type="submit" busy={busy}>
          {knopf}
        </Hb>
        {extra}
      </div>
    </form>
  );
}

const euroFeld = (cents: number) => String(cents / 100).replace('.', ',');
const centsAus = (s: string) => {
  const n = Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * 100);
  return Number.isFinite(n) ? n : 0;
};

type Speichern = (teil: Record<string, unknown>, meldung?: string) => Promise<Settings>;

export default function Einstellungen() {
  useTitel('Einstellungen');
  const { data, setData, error } = useLoad<Settings>('/admin/settings');
  const { hash } = useLocation();
  useEffect(() => {
    if (!data || !hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => clearTimeout(t);
  }, [data, hash]);

  if (!data) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;

  const speichern: Speichern = async (teil, meldung = 'Gespeichert') => {
    const s = await api<Settings>('PUT', '/admin/settings', teil);
    setData(s);
    toast(meldung);
    return s;
  };

  return (
    <>
      <Seitenkopf label="Admin" titel={<>Club <em>einstellen</em></>} />
      <nav className="reiter" aria-label="Bereiche">
        <NavLink to="/admin/einstellungen" end>
          Regeln &amp; Stufen
        </NavLink>
        <NavLink to="/admin/einstellungen/verbindungen">Verbindungen</NavLink>
        <NavLink to="/admin/einstellungen/zugaenge">Zugänge</NavLink>
        <NavLink to="/admin/einstellungen/system">System</NavLink>
      </nav>
      <Routes>
        <Route index element={<Regeln data={data} speichern={speichern} />} />
        <Route path="verbindungen" element={<Verbindungen data={data} speichern={speichern} />} />
        <Route path="zugaenge" element={<Zugaenge data={data} speichern={speichern} />} />
        <Route path="system" element={<System data={data} />} />
        <Route path="*" element={<Navigate to="/admin/einstellungen" replace />} />
      </Routes>
    </>
  );
}

/* ---------- Regeln, Stufen, Verfall, Boni ---------- */

function Regeln({ data, speichern }: { data: Settings; speichern: Speichern }) {
  const [p, setProg] = useState<FullProgram>(data.program);
  const [geld, setGeld] = useState(() => ({
    redeem: euroFeld(data.program.redeem_cents),
    max: euroFeld(data.program.max_cents),
    referral_min: euroFeld(data.program.referral_min_cents),
    start_min: euroFeld(data.program.start_bonus_min_cents),
    tiers: data.program.tiers.map((t) => euroFeld(t.min_cents)),
  }));
  const [vorteilNeu, setVorteilNeu] = useState<Record<string, string>>({});

  const zahl = (k: keyof FullProgram, titel: string, hilfe?: ReactNode, step = '1') => (
    <Feld titel={titel} hilfe={hilfe}>
      <input type="number" step={step} min={0} value={String(p[k])} onChange={(e) => setProg({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) } as FullProgram)} />
    </Feld>
  );

  function stufe(i: number, feld: Partial<Tier>) {
    const tiers = p.tiers.map((t, j) => (j === i ? { ...t, ...feld } : t));
    setProg({ ...p, tiers, earn_per_euro: i === 0 && feld.rate !== undefined ? feld.rate : p.earn_per_euro });
  }

  async function alles() {
    const tiers = p.tiers.map((t, i) => ({ ...t, min_cents: i === 0 ? 0 : centsAus(geld.tiers[i] ?? '0'), rate: Number(t.rate) }));
    const s = await speichern(
      {
        program: {
          ...p,
          earn_per_euro: Number(tiers[0].rate),
          tiers,
          redeem_cents: centsAus(geld.redeem),
          max_cents: centsAus(geld.max),
          referral_min_cents: centsAus(geld.referral_min),
          start_bonus_min_cents: centsAus(geld.start_min),
        },
      },
      'Gespeichert. App, Startseite und Shop zeigen die neuen Regeln.',
    );
    setProg(s.program);
    setGeld({
      redeem: euroFeld(s.program.redeem_cents),
      max: euroFeld(s.program.max_cents),
      referral_min: euroFeld(s.program.referral_min_cents),
      start_min: euroFeld(s.program.start_bonus_min_cents),
      tiers: s.program.tiers.map((t) => euroFeld(t.min_cents)),
    });
  }

  return (
    <>
      <Hinweis>
        Alle Texte in der App, auf der Startseite und im Shop (Punkteanzeige, Regeln im Metafeld <code>club.programm</code>) entstehen aus diesen Einstellungen. Nach dem Speichern ziehen sie
        automatisch nach. Bestehende Punkte bleiben, neue Bestellungen werden mit den neuen Regeln berechnet.
      </Hinweis>

      <Abschnitt titel="Punkte sammeln und einlösen" onSave={alles}>
        <Feld titel="Name">
          <input value={p.name} maxLength={60} onChange={(e) => setProg({ ...p, name: e.target.value })} />
        </Feld>
        <Schalter titel="Einlösen möglich" text="Ausschalten pausiert neue Codes. Punkte sammeln geht weiter." an={p.active} onChange={(v) => setProg({ ...p, active: v })} />
        <div className="formular-reihe">
          <Feld titel="Punkte je 1 € Warenwert (Grundstufe)" hilfe="Ohne Versand, nach Rabatten">
            <input type="number" step="0.1" min={0} value={String(p.tiers[0]?.rate ?? p.earn_per_euro)} onChange={(e) => stufe(0, { rate: e.target.value === '' ? 0 : Number(e.target.value) })} />
          </Feld>
          {zahl('welcome_points', 'Willkommensbonus (Punkte)')}
        </div>
        <div className="formular-reihe">
          {zahl('redeem_points', 'Punkte je Prämienstufe')}
          <Feld titel="… sind so viel wert (€)">
            <input inputMode="decimal" value={geld.redeem} onChange={(e) => setGeld({ ...geld, redeem: e.target.value })} />
          </Feld>
        </div>
        <div className="formular-reihe">
          <Feld titel="Höchstwert je Code (€)">
            <input inputMode="decimal" value={geld.max} onChange={(e) => setGeld({ ...geld, max: e.target.value })} />
          </Feld>
          {zahl('max_open_codes', 'Offene Codes je Person')}
        </div>
        <div className="formular-reihe">
          {zahl('wait_days', 'Wartezeit nach Versand (Tage)', 'Rückgabefrist, danach sind Punkte verfügbar')}
          {zahl('retro_days', 'Bestellungen vor dem Beitritt zählen (Tage)')}
        </div>
        <Schalter titel="Code nur für das eigene Kundenkonto" text="Empfohlen. Verhindert, dass Codes weitergegeben werden." an={p.bind_customer} onChange={(v) => setProg({ ...p, bind_customer: v })} />
        <Schalter titel="Mit Versand-Rabatten kombinierbar" an={p.combine_shipping} onChange={(v) => setProg({ ...p, combine_shipping: v })} />
        <Schalter titel="Mit anderen Bestell-Rabatten kombinierbar" an={p.combine_order} onChange={(v) => setProg({ ...p, combine_order: v })} />
        <Schalter titel="Mit Produkt-Rabatten kombinierbar" an={p.combine_product} onChange={(v) => setProg({ ...p, combine_product: v })} />
        <Schalter titel="Testbestellungen zählen" text="Nur zum Ausprobieren einschalten." an={p.count_test} onChange={(v) => setProg({ ...p, count_test: v })} />
      </Abschnitt>

      <Abschnitt
        id="verfall"
        titel="Verfall von Punkten und Codes"
        text="Nicht eingelöste Punkte und Codes verfallen automatisch. Mitglieder bekommen vorher eine Push-Erinnerung. Die Frist steht auch in den Texten der App."
        onSave={alles}
      >
        <div className="formular-reihe">
          {zahl('points_expiry_months', 'Punkte verfallen nach (Monaten)', '0 = Punkte verfallen nie. Gezählt ab der Gutschrift, älteste zuerst.')}
          {zahl('expiry_warn_days', 'Erinnerung so viele Tage vorher')}
        </div>
        <div className="formular-reihe">
          {zahl('code_days', 'Ein Code gilt (Tage)')}
          <div />
        </div>
        <Schalter
          titel="Abgelaufene Codes geben die Punkte zurück"
          text="Aus: Mit dem Code verfallen auch seine Punkte."
          an={p.code_expiry_refund}
          onChange={(v) => setProg({ ...p, code_expiry_refund: v })}
        />
      </Abschnitt>

      <Abschnitt
        id="stufen"
        titel="Mitgliedschaftsstufen"
        text={`Der Einkaufswert der letzten ${p.tier_months} Monate entscheidet über die Stufe. Wer aufsteigt, bekommt eine Push-Nachricht; eine erreichte Stufe gilt mindestens so lange.`}
        onSave={alles}
      >
        <Schalter titel="Stufen verwenden" text="Aus: Alle sammeln mit dem Satz der Grundstufe." an={p.tiers_enabled} onChange={(v) => setProg({ ...p, tiers_enabled: v })} />
        {zahl('tier_months', 'Zeitraum und Mindestdauer (Monate)')}
        <div className="stufen-editor">
          {p.tiers.map((t, i) => (
            <fieldset key={t.key} disabled={!p.tiers_enabled && i > 0}>
              <legend>
                <StufenZeichen stufe={t.key} klein /> {t.name}
              </legend>
              <div className="formular-reihe">
                <Feld titel="Name">
                  <input value={t.name} maxLength={30} onChange={(e) => stufe(i, { name: e.target.value })} />
                </Feld>
                <Feld titel="Punkte je 1 €">
                  <input type="number" step="0.1" min={0} value={String(t.rate)} onChange={(e) => stufe(i, { rate: e.target.value === '' ? 0 : Number(e.target.value) })} />
                </Feld>
              </div>
              {i > 0 && (
                <Feld titel={`Ab Einkaufswert in ${p.tier_months} Monaten (€)`}>
                  <input inputMode="decimal" value={geld.tiers[i] ?? ''} onChange={(e) => setGeld({ ...geld, tiers: geld.tiers.map((v, j) => (j === i ? e.target.value : v)) })} />
                </Feld>
              )}
              <div className="feld">
                <span>Vorteile (sehen Mitglieder in der App)</span>
                <ul className="vorteil-liste">
                  {t.benefits.map((b, j) => (
                    <li key={j}>
                      <input value={b} maxLength={120} onChange={(e) => stufe(i, { benefits: t.benefits.map((x, k) => (k === j ? e.target.value : x)) })} aria-label={`Vorteil ${j + 1}`} />
                      <button type="button" className="knopf knopf-rund knopf-klein" aria-label="Entfernen" onClick={() => stufe(i, { benefits: t.benefits.filter((_, k) => k !== j) })}>
                        <X />
                      </button>
                    </li>
                  ))}
                  {t.benefits.length < 8 && (
                    <li>
                      <input
                        value={vorteilNeu[t.key] ?? ''}
                        maxLength={120}
                        placeholder="z. B. Früher Zugang zu neuen Düften"
                        onChange={(e) => setVorteilNeu({ ...vorteilNeu, [t.key]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const v = (vorteilNeu[t.key] ?? '').trim();
                            if (v) {
                              stufe(i, { benefits: [...t.benefits, v] });
                              setVorteilNeu({ ...vorteilNeu, [t.key]: '' });
                            }
                          }
                        }}
                        aria-label="Neuer Vorteil"
                      />
                      <button
                        type="button"
                        className="knopf knopf-rund knopf-klein"
                        aria-label="Hinzufügen"
                        onClick={() => {
                          const v = (vorteilNeu[t.key] ?? '').trim();
                          if (v) {
                            stufe(i, { benefits: [...t.benefits, v] });
                            setVorteilNeu({ ...vorteilNeu, [t.key]: '' });
                          }
                        }}
                      >
                        <Plus />
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </fieldset>
          ))}
        </div>
        <p className="klein leise">
          Exklusive Rabatte für eine Stufe: In Shopify einen Rabatt für das Kundensegment „Club: Silber“ oder „Club: Gold“ anlegen. Frühen Zugang zu neuen Düften kündigst du in der Team-App mit der
          Vorlage „Früher Zugang“ an.
        </p>
      </Abschnitt>

      <Abschnitt id="boni" titel="Bonuspunkte" text="0 schaltet einen Bonus aus. Jeder Bonus kommt mit einer Push-Nachricht." onSave={alles}>
        <div className="formular-reihe">
          {zahl('bonus_birthday', 'Zum Geburtstag', 'Einmal im Jahr, frühestens 30 Tage nach dem Eintragen')}
          {zahl('bonus_newsletter', 'Für die Newsletter-Anmeldung', 'Einmalig, wird stündlich mit Shopify abgeglichen')}
        </div>
        <div className="formular-reihe">
          {zahl('bonus_review', 'Für eine Bewertung', 'Das Team bestätigt jede Bewertung unter Aktionen')}
          {zahl('review_max_month', 'Bewertungen je Monat höchstens')}
        </div>
        <div className="formular-reihe">
          {zahl('bonus_referrer', 'Empfehlung: für das werbende Mitglied')}
          {zahl('bonus_referred', 'Empfehlung: für den neuen Kunden')}
        </div>
        <div className="formular-reihe">
          <Feld titel="Empfehlung zählt ab Bestellwert (€)" hilfe="0 = jede erste Bestellung">
            <input inputMode="decimal" value={geld.referral_min} onChange={(e) => setGeld({ ...geld, referral_min: e.target.value })} />
          </Feld>
          {zahl('referral_max_year', 'Empfehlungen mit Bonus je Jahr höchstens')}
        </div>
      </Abschnitt>

      <Abschnitt
        id="startbonus"
        titel="Startbonus für die Warteliste"
        text="Wer beim Beitritt den Shopify-Tag der Warteliste hat, bekommt einmalig diesen Bonus. Die Einladungen verschickst du unter Aktionen → Warteliste."
        onSave={alles}
      >
        <div className="formular-reihe">
          {zahl('start_bonus', 'Startbonus (Punkte)', '0 = kein Startbonus')}
          <Feld titel="Shopify-Tag der Warteliste">
            <input value={p.waitlist_tag} maxLength={40} onChange={(e) => setProg({ ...p, waitlist_tag: e.target.value })} />
          </Feld>
        </div>
        <div className="formular-reihe">
          <Feld titel="Beitritt bis (Datum)" hilfe="Leer = ohne Frist">
            <input type="date" value={p.start_bonus_until} onChange={(e) => setProg({ ...p, start_bonus_until: e.target.value })} />
          </Feld>
          {zahl('start_bonus_days', 'Nach der Freischaltung gültig (Tage)', '0 = normale Verfallsregel')}
        </div>
        <Schalter
          titel="Erst mit der ersten Bestellung freischalten"
          text="Der Bonus ist sofort sichtbar, einlösbar aber erst nach der ersten Bestellung."
          an={p.start_bonus_requires_order}
          onChange={(v) => setProg({ ...p, start_bonus_requires_order: v })}
        />
        {p.start_bonus_requires_order && (
          <Feld titel="Mindestbestellwert für die Freischaltung (€)" hilfe="0 = jede Bestellung">
            <input inputMode="decimal" value={geld.start_min} onChange={(e) => setGeld({ ...geld, start_min: e.target.value })} />
          </Feld>
        )}
      </Abschnitt>
    </>
  );
}

/* ---------- Shopify, Anmeldung, E-Mail, Links ---------- */

function Verbindungen({ data, speichern }: { data: Settings; speichern: Speichern }) {
  const [shop, setShop] = useState({ shop: data.shopify.shop, client_id: data.shopify.client_id, client_secret: '' });
  const [login, setLogin] = useState({ client_id: data.login_shopify.client_id, client_secret: '', clear_secret: false });
  const [mail, setMail] = useState({ ...data.smtp, password: '' });
  const [mailAn, setMailAn] = useState(data.login_email);
  const [links, setLinks] = useState({ account_url: data.account_url, terms_url: data.terms_url });
  const [mitteilung, setMitteilung] = useState({ welcome_mail: data.welcome_mail, feedback_email: data.feedback_email, push_contact: data.push_contact, four_eyes: data.broadcast_four_eyes });

  return (
    <>
      <Abschnitt
        titel="Shopify-App (Admin API)"
        text={
          <>
            Im Shopify Dev Dashboard eine App anlegen, Berechtigungen <code>read_orders</code>, <code>write_customers</code>, <code>write_discounts</code> (optional <code>read_all_orders</code>) vergeben, im Shop installieren und
            hier Client-ID und Secret eintragen. Die Anleitung steht in der ANLEITUNG.
          </>
        }
        onSave={async () => {
          const s = await speichern({ shopify: shop }, 'Gespeichert und getestet');
          setShop({ ...shop, client_secret: '' });
          if (!s.shopify.test?.ok) toast('Verbindung fehlgeschlagen, siehe Hinweis');
        }}
        knopf="Speichern und testen"
      >
        <Ergebnis test={data.shopify.test} />
        <Feld titel="Shop-Adresse" hilfe="Die myshopify-Adresse, z. B. ks8yin-mg.myshopify.com">
          <input value={shop.shop} onChange={(e) => setShop({ ...shop, shop: e.target.value })} placeholder="ks8yin-mg.myshopify.com" />
        </Feld>
        <div className="formular-reihe">
          <Feld titel="Client-ID">
            <input value={shop.client_id} autoComplete="off" onChange={(e) => setShop({ ...shop, client_id: e.target.value })} />
          </Feld>
          <Feld titel="Client-Secret" hilfe={data.shopify.has_secret ? 'Gespeichert. Nur ausfüllen, um es zu ändern.' : undefined}>
            <input type="password" autoComplete="new-password" value={shop.client_secret} onChange={(e) => setShop({ ...shop, client_secret: e.target.value })} placeholder={data.shopify.has_secret ? '••••••••' : ''} />
          </Feld>
        </div>
        {data.shop_program && (
          <p className={`check ${data.shop_program.ok ? 'ok' : 'nein'}`}>
            {data.shop_program.ok ? <CircleCheck /> : <CircleX />} Regeln im Shop: {data.shop_program.message} ({seit(data.shop_program.at)})
          </p>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Anmeldung mit dem Shopify-Kundenkonto"
        text="In Shopify unter „Vertriebskanäle → Headless → Customer Account API“ einen Client anlegen (vertraulich, mit Secret). Dort diese drei Adressen eintragen und die Client-ID hierher kopieren."
        onSave={async () => {
          await speichern({ login_shopify: login }, 'Gespeichert und getestet');
          setLogin({ ...login, client_secret: '', clear_secret: false });
        }}
        knopf="Speichern und testen"
      >
        <Ergebnis test={data.login_shopify.test} />
        <Kopierfeld label="Callback-URI" wert={data.login_shopify.redirect_uri} />
        <div className="formular-reihe">
          <Kopierfeld label="JavaScript-Ursprung" wert={data.login_shopify.origin} />
          <Kopierfeld label="Abmelde-URI" wert={data.login_shopify.logout_uri} />
        </div>
        <div className="formular-reihe">
          <Feld titel="Client-ID">
            <input value={login.client_id} autoComplete="off" onChange={(e) => setLogin({ ...login, client_id: e.target.value })} />
          </Feld>
          <Feld titel="Client-Secret (bei vertraulichem Client)" hilfe={data.login_shopify.has_secret ? 'Gespeichert. Nur ausfüllen, um es zu ändern.' : 'Leer lassen bei öffentlichem Client.'}>
            <input type="password" autoComplete="new-password" value={login.client_secret} onChange={(e) => setLogin({ ...login, client_secret: e.target.value })} placeholder={data.login_shopify.has_secret ? '••••••••' : ''} />
          </Feld>
        </div>
        {data.login_shopify.has_secret && <Schalter titel="Secret löschen" text="Nur wenn der Client auf „öffentlich“ umgestellt wurde." an={login.clear_secret} onChange={(v) => setLogin({ ...login, clear_secret: v })} />}
      </Abschnitt>

      <Abschnitt
        titel="E-Mail-Versand"
        text="Für Bestätigungen (Willkommen, Anmeldecode), Einladungen der Warteliste und Feedback an das Team. Benachrichtigungen zu Punkten und Versand gehen per Push, nicht per Mail. Bei netcup: Server mxf….netcup.net, Port 465, Benutzer = volle E-Mail-Adresse."
        onSave={async () => {
          await speichern({ login_email: mailAn, smtp: mail });
          setMail({ ...mail, password: '' });
        }}
        extra={
          <button
            type="button"
            className="knopf knopf-klein"
            onClick={async () => {
              try {
                const r = await api<{ sent: boolean; message: string }>('POST', '/admin/test/mail');
                toast(r.message);
              } catch (e) {
                toast(fehlertext(e));
              }
            }}
          >
            <Mail /> Testmail an mich
          </button>
        }
      >
        <div className="formular-reihe">
          <Feld titel="SMTP-Server">
            <input value={mail.host} onChange={(e) => setMail({ ...mail, host: e.target.value })} placeholder="z. B. mxf938.netcup.net" />
          </Feld>
          <Feld titel="Port">
            <select value={mail.port} onChange={(e) => setMail({ ...mail, port: Number(e.target.value) })}>
              <option value={465}>465 (SSL)</option>
              <option value={587}>587 (STARTTLS)</option>
            </select>
          </Feld>
        </div>
        <div className="formular-reihe">
          <Feld titel="Benutzer">
            <input value={mail.user} autoComplete="off" onChange={(e) => setMail({ ...mail, user: e.target.value })} />
          </Feld>
          <Feld titel="Passwort" hilfe={data.smtp.has_password ? 'Gespeichert. Nur ausfüllen, um es zu ändern.' : undefined}>
            <input type="password" autoComplete="new-password" value={mail.password} onChange={(e) => setMail({ ...mail, password: e.target.value })} placeholder={data.smtp.has_password ? '••••••••' : ''} />
          </Feld>
        </div>
        <div className="formular-reihe">
          <Feld titel="Absender-Adresse">
            <input type="email" value={mail.from_email} onChange={(e) => setMail({ ...mail, from_email: e.target.value })} />
          </Feld>
          <Feld titel="Absender-Name">
            <input value={mail.from_name} onChange={(e) => setMail({ ...mail, from_name: e.target.value })} />
          </Feld>
        </div>
        <Schalter titel="Anmeldung per E-Mail-Code anbieten" text="Ausweichweg ohne Shopify-Anmeldeseite." an={mailAn} onChange={setMailAn} />
      </Abschnitt>

      <Abschnitt
        titel="Mails und Mitteilungen"
        onSave={async () =>
          void (await speichern({
            welcome_mail: mitteilung.welcome_mail,
            broadcast_four_eyes: mitteilung.four_eyes,
            feedback_email: mitteilung.feedback_email.trim(),
            push_contact: mitteilung.push_contact.trim(),
          }))
        }
        extra={
          <button
            type="button"
            className="knopf knopf-klein"
            onClick={async () => {
              try {
                const r = await api<{ sent: boolean; message: string }>('POST', '/admin/test/welcome');
                toast(r.sent ? 'Willkommensmail an dich verschickt' : r.message);
              } catch (e) {
                toast(fehlertext(e));
              }
            }}
          >
            <Mail /> Willkommensmail testen
          </button>
        }
      >
        <Schalter
          titel="Willkommensmail beim Beitritt"
          text="Im Design der App. Aus lassen, wenn die Willkommensmail über Shopify Flow kommt (Anleitung in der Doku)."
          an={mitteilung.welcome_mail}
          onChange={(v) => setMitteilung({ ...mitteilung, welcome_mail: v })}
        />
        <Schalter
          titel="Nachrichten an Mitglieder: Vier-Augen-Prinzip"
          text="Eine Nachricht aus der Team-App gibt jemand anderes frei als die Person, die sie geschrieben hat."
          an={mitteilung.four_eyes}
          onChange={(v) => setMitteilung({ ...mitteilung, four_eyes: v })}
        />
        <div className="formular-reihe">
          <Feld titel="Feedback geht an" hilfe="Jede Antwort der Mitglieder wird hierhin weitergeleitet.">
            <input type="email" value={mitteilung.feedback_email} onChange={(e) => setMitteilung({ ...mitteilung, feedback_email: e.target.value })} placeholder="info@perfumecloud.de" />
          </Feld>
          <Feld titel="Kontakt für Push-Dienste (VAPID)" hilfe="Apple und Google melden sich hier bei Problemen. Leer = Absender-Adresse.">
            <input type="email" value={mitteilung.push_contact} onChange={(e) => setMitteilung({ ...mitteilung, push_contact: e.target.value })} placeholder="info@perfumecloud.de" />
          </Feld>
        </div>
      </Abschnitt>

      <Abschnitt titel="Links" onSave={async () => void (await speichern({ account_url: links.account_url.trim() || null, terms_url: links.terms_url.trim() || null }))}>
        <Feld titel="Teilnahmebedingungen" hilfe="Eine Seite im Shop, z. B. https://www.perfumecloud.de/pages/club">
          <input type="url" value={links.terms_url} onChange={(e) => setLinks({ ...links, terms_url: e.target.value })} placeholder="https://" />
        </Feld>
        <Feld titel="Kundenkonto im Shop" hilfe="Für „Adressen & Daten“. Leer lassen für /account.">
          <input type="url" value={links.account_url} onChange={(e) => setLinks({ ...links, account_url: e.target.value })} placeholder="https://" />
        </Feld>
      </Abschnitt>
    </>
  );
}

/* ---------- Zugänge (wie in der Team-App) ---------- */

function Zugaenge({ data, speichern }: { data: Settings; speichern: Speichern }) {
  const { me } = useAdmin();
  const zugang = useLoad<AccessOverview>('/admin/access');
  const [neu, setNeu] = useState<{ name: string; email: string; password: string } | null>(null);
  const [loeschen, setLoeschen] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [mail, setMail] = useState<{ email: string; admin_id: string } | null>(null);
  const [mailFehler, setMailFehler] = useState<string | null>(null);
  const darf = !!me.admin.manage;

  if (!zugang.data) return zugang.error ? <Hinweis fehler>{zugang.error}</Hinweis> : <Laden />;
  const z = zugang.data;

  async function team(id: string, access: boolean) {
    try {
      zugang.setData(await api<AccessOverview>('PUT', `/admin/access/team/${id}`, { access }));
      toast(access ? 'Zugriff erteilt' : 'Zugriff entzogen');
    } catch (e) {
      toast(fehlertext(e));
    }
  }

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!neu) return;
    setBusy(true);
    setFehler(null);
    try {
      zugang.setData(await api<AccessOverview>('POST', '/admin/access', neu));
      setNeu(null);
      toast('Zugang angelegt');
    } catch (err) {
      setFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  // Personen mit Club-Admin-Zugriff, zu denen eine Admin-E-Mail gehören kann
  const personen = [...z.team.filter((u) => u.access), ...z.club];

  async function mailEintragen(e: FormEvent) {
    e.preventDefault();
    if (!mail) return;
    setBusy(true);
    setMailFehler(null);
    try {
      zugang.setData(await api<AccessOverview>('POST', '/admin/access/emails', { email: mail.email.trim(), admin_id: mail.admin_id || null }));
      setMail(null);
      toast('Admin-E-Mail eingetragen');
    } catch (err) {
      setMailFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  async function mailEntfernen(email: string) {
    try {
      zugang.setData(await api<AccessOverview>('POST', '/admin/access/emails/remove', { email }));
      toast('Admin-E-Mail entfernt');
    } catch (err) {
      toast(fehlertext(err));
    }
  }

  async function entfernen() {
    if (!loeschen) return;
    setBusy(true);
    try {
      zugang.setData(await api<AccessOverview>('DELETE', `/admin/access/${loeschen.id}`));
      setLoeschen(null);
      toast('Zugang gelöscht');
    } catch (err) {
      toast(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!darf && <Hinweis>Zugänge verwalten dürfen nur Admins der Team-App. Du kannst sie hier ansehen.</Hinweis>}

      <section className="karte">
        <h2 className="karte-titel">Team-App</h2>
        {z.team_mode ? (
          <>
            <p className="klein leise">
              Die Benutzer kommen aus der Team-App (gleiche Datenbank). Admins der Team-App haben immer Zugriff; allen anderen kannst du den Club-Admin hier oder in der Team-App unter Benutzer freischalten.
              Wer sich in der Club-App mit derselben E-Mail anmeldet, landet direkt im Admin-Bereich.
            </p>
            <ul className="tabelle">
              {z.team.map((u) => (
                <li key={u.id}>
                  <span>
                    {u.name}
                    <small className="leise winzig" style={{ display: 'block' }}>
                      {u.email} · {u.role === 'admin' ? 'Admin der Team-App' : 'Team-Mitglied'}
                    </small>
                  </span>
                  <span className="rechts">
                    <input
                      type="checkbox"
                      role="switch"
                      className="schalter-input"
                      aria-label={`Club-Admin für ${u.name}`}
                      checked={u.access}
                      disabled={!darf || u.role === 'admin'}
                      onChange={(e) => void team(u.id, e.target.checked)}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="klein">
            Der Club nutzt noch eine eigene Datenbank. Unter <NavLinkText to="/admin/einstellungen/system">System</NavLinkText> kannst du ihn in die Datenbank der Team-App umziehen; dann gelten die Benutzer der
            Team-App automatisch.
          </p>
        )}
      </section>

      <section className="karte">
        <div className="karte-kopf">
          <h2 className="karte-titel">Admin-E-Mails</h2>
          {darf && !mail && (
            <button
              className="knopf knopf-klein"
              onClick={() => setMail({ email: '', admin_id: personen.some((p) => p.id === me.admin.id) ? me.admin.id : '' })}
            >
              <Plus /> E-Mail eintragen
            </button>
          )}
        </div>
        <p className="klein leise">
          Wer sich in der Club-App mit einer dieser Adressen anmeldet (E-Mail-Code oder Shopify-Kundenkonto), bekommt den Admin-Bereich dazu und sieht oben den Knopf „Admin“. Gut für die private Adresse, mit der
          du im Shop einkaufst. Gehört die Adresse zu einer Person, gelten deren Rechte.
        </p>
        {z.emails.length > 0 ? (
          <ul className="tabelle">
            {z.emails.map((e) => (
              <li key={e.email}>
                <span className="umbruch">
                  {e.email}
                  <small className="leise winzig" style={{ display: 'block' }}>
                    {e.admin_id ? (e.valid ? `gehört zu ${e.person}` : 'Die Person hat keinen Zugang mehr – Adresse wirkt nicht') : 'eigener Admin-Zugang (ohne Zugänge verwalten)'} · eingetragen von {e.by || '–'}
                  </small>
                </span>
                <span className="rechts">
                  {darf && (
                    <button className="knopf knopf-rund knopf-klein knopf-gefahr" aria-label={`${e.email} entfernen`} onClick={() => void mailEntfernen(e.email)}>
                      <Trash2 />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          !mail && <p className="klein">Noch keine eingetragen.</p>
        )}
        {mail && (
          <form className="formular" onSubmit={mailEintragen}>
            <div className="formular-reihe">
              <Feld titel="E-Mail-Adresse">
                <input type="email" value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} required autoFocus placeholder="name@beispiel.de" />
              </Feld>
              <Feld titel="Gehört zu">
                <select value={mail.admin_id} onChange={(e) => setMail({ ...mail, admin_id: e.target.value })}>
                  {personen.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="">Keine Person (eigener Admin-Zugang)</option>
                </select>
              </Feld>
            </div>
            {mailFehler && <Hinweis fehler>{mailFehler}</Hinweis>}
            <div className="code-reihe">
              <Hb klein dunkel type="submit" busy={busy}>
                Eintragen
              </Hb>
              <button type="button" className="knopf" onClick={() => setMail(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="karte">
        <div className="karte-kopf">
          <h2 className="karte-titel">Eigene Club-Zugänge</h2>
          {darf && !neu && (
            <button className="knopf knopf-klein" onClick={() => setNeu({ name: '', email: '', password: '' })}>
              <Plus /> Zugang anlegen
            </button>
          )}
        </div>
        <p className="klein leise">Für Personen ohne Team-App, z. B. eine Agentur. Anmeldung mit E-Mail und Passwort unter /admin.</p>
        {z.club.length > 0 && (
          <ul className="tabelle">
            {z.club.map((a) => (
              <li key={a.id}>
                <span>
                  {a.name}
                  <small className="leise winzig" style={{ display: 'block' }}>
                    {a.email} · {a.last_login_at ? `zuletzt ${datumZeit(a.last_login_at)}` : 'noch nie angemeldet'}
                  </small>
                </span>
                <span className="rechts">
                  {darf && a.id !== me.admin.id && (
                    <button className="knopf knopf-rund knopf-klein knopf-gefahr" aria-label={`${a.name} löschen`} onClick={() => setLoeschen({ id: a.id, name: a.name })}>
                      <Trash2 />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {neu && (
          <form className="formular" onSubmit={anlegen}>
            <div className="formular-reihe">
              <Feld titel="Name">
                <input value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} required maxLength={100} />
              </Feld>
              <Feld titel="E-Mail">
                <input type="email" value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} required />
              </Feld>
            </div>
            <Feld titel="Passwort" hilfe="Mindestens 10 Zeichen. Gib es der Person persönlich weiter, nicht per Chat.">
              <input type="password" autoComplete="new-password" value={neu.password} onChange={(e) => setNeu({ ...neu, password: e.target.value })} required minLength={10} />
            </Feld>
            {fehler && <Hinweis fehler>{fehler}</Hinweis>}
            <div className="code-reihe">
              <Hb klein dunkel type="submit" busy={busy}>
                Anlegen
              </Hb>
              <button type="button" className="knopf" onClick={() => setNeu(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </section>

      <Abschnitt titel="Anmeldung für das Team" onSave={async () => void (await speichern({ admin_by_email: !data.admin_by_email }))} knopf={data.admin_by_email ? 'Ausschalten' : 'Einschalten'}>
        <p className={`check ${data.admin_by_email ? 'ok' : 'nein'}`}>
          {data.admin_by_email ? <CircleCheck /> : <CircleX />} Admins anhand der E-Mail erkennen: {data.admin_by_email ? 'an' : 'aus'}
        </p>
        <p className="klein leise">
          Ist das an, bekommen Team-Mitglieder nach der Anmeldung in der Club-App (Shopify-Kundenkonto oder E-Mail-Code) mit derselben E-Mail wie in der Team-App den Admin-Bereich dazu. Andere Adressen
          oben unter „Admin-E-Mails“ eintragen – die gelten auch, wenn das hier aus ist.
        </p>
      </Abschnitt>

      {loeschen && (
        <Dialog
          titel={`Zugang von ${loeschen.name} löschen?`}
          onClose={() => !busy && setLoeschen(null)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setLoeschen(null)} disabled={busy}>
                Abbrechen
              </button>
              <button className="knopf knopf-gefahr" onClick={() => void entfernen()} disabled={busy}>
                <Trash2 /> Löschen
              </button>
            </>
          }
        >
          <p>Die Person wird sofort abgemeldet und kann sich nicht mehr anmelden.</p>
        </Dialog>
      )}
    </>
  );
}

function NavLinkText({ to, children }: { to: string; children: ReactNode }) {
  return <NavLink to={to}>{children}</NavLink>;
}

/* ---------- Datenbank, Cronjob, Team-App-Verbindung ---------- */

function System({ data }: { data: Settings }) {
  const { me } = useAdmin();
  const [pfad, setPfad] = useState('');
  const [umzug, setUmzug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const db = data.database;

  async function umziehen() {
    setBusy(true);
    setFehler(null);
    try {
      await api('POST', '/admin/database/move', { config: pfad.trim() || null });
      toast('Umzug erledigt. Die Seite lädt neu.');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setFehler(fehlertext(e));
      setBusy(false);
    }
  }

  return (
    <>
      <section className="karte formular">
        <h2 className="karte-titel">Datenbank</h2>
        {db.mode === 'team' ? (
          <p className="check ok">
            <CircleCheck /> Gemeinsame Datenbank mit der Team-App ({db.team_config}). Alle Club-Tabellen beginnen mit <code>club_</code>.
          </p>
        ) : (
          <>
            <p className="check nein">
              <CircleX /> Eigene Datenbank ({db.mode === 'sqlite' ? 'SQLite-Datei' : 'MySQL'}). Benutzer und Rechte der Team-App gelten noch nicht.
            </p>
            <p className="klein">
              Der Umzug kopiert alle Club-Daten in die Datenbank der Team-App (Tabellen mit <code>club_</code>), prüft die Anzahl der Einträge und stellt erst dann um. Die alte Datenbank bleibt als Sicherung.
            </p>
            <Feld titel="Pfad zur config.php der Team-App" hilfe={db.team_config ? `Gefunden: ${db.team_config}` : 'Nicht automatisch gefunden. Bitte den vollständigen Pfad angeben.'}>
              <input value={pfad} onChange={(e) => setPfad(e.target.value)} placeholder={db.team_config ?? '/var/www/vhosts/perfumecloud.de/team.perfumecloud.de/httpdocs/config.php'} />
            </Feld>
            {fehler && <Hinweis fehler>{fehler}</Hinweis>}
            <div>
              <Hb klein dunkel disabled={!me.admin.manage} onClick={() => setUmzug(true)}>
                In die Team-Datenbank umziehen
              </Hb>
            </div>
          </>
        )}
      </section>

      <section className="karte formular">
        <h2 className="karte-titel">Verbindung zur Team-App</h2>
        <p className="klein leise">
          Die Team-App zeigt damit die Club-Statistik, verschickt Nachrichten an Mitglieder und öffnet den Admin-Bereich mit einem Klick. Mit gemeinsamer Datenbank findet sie den Schlüssel selbst; sonst in der
          Team-App unter Einstellungen → Integrationen → „Members Club“ eintragen.
        </p>
        <Kopierfeld label="Adresse der Club-App" wert={data.base_url} />
        <Kopierfeld label="Schlüssel (X-Club-Key)" wert={data.internal_key} hilfe="Geheim halten. Nur in der Team-App eintragen." />
      </section>

      <section className="karte formular">
        <h2 className="karte-titel">Cronjob</h2>
        <p className="klein leise">In Plesk unter „Geplante Aufgaben“ → „URL abrufen“, alle 15 Minuten. Alternativ als PHP-Skript.</p>
        <Kopierfeld label="URL abrufen" wert={data.cron_url} hilfe="Enthält einen geheimen Schlüssel, nicht weitergeben." />
        <Kopierfeld label="PHP-Skript" wert={data.cron_cli} />
        <p className="winzig leise">
          Adresse der App: {data.base_url} · Version {data.version}
        </p>
      </section>

      {umzug && (
        <Dialog
          titel="Datenbank jetzt umziehen?"
          onClose={() => !busy && setUmzug(false)}
          knoepfe={
            <>
              <button className="knopf" onClick={() => setUmzug(false)} disabled={busy}>
                Abbrechen
              </button>
              <Hb klein dunkel busy={busy} onClick={() => void umziehen()}>
                Umziehen
              </Hb>
            </>
          }
        >
          <p>Das dauert meist nur ein paar Sekunden. Danach melden sich alle neu an; Admins der Team-App haben automatisch Zugriff.</p>
          {fehler && <Hinweis fehler>{fehler}</Hinweis>}
        </Dialog>
      )}
    </>
  );
}
