import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CircleCheck, CircleX, Mail } from 'lucide-react';
import { api, fehlertext } from '../../lib/api';
import { useLoad, useTitel } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import type { Check, FullProgram, Settings } from '../../lib/types';
import { Hb, Hinweis, Kopierfeld, Laden, Seitenkopf } from '../../components/ui';

function Ergebnis({ test }: { test: Check | null }) {
  if (!test) return null;
  return (
    <p className={`check ${test.ok ? 'ok' : 'nein'}`}>
      {test.ok ? <CircleCheck /> : <CircleX />} {test.message}
    </p>
  );
}

function Schalter({ titel, text, an, onChange }: { titel: string; text?: string; an: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="schalter">
      <span>
        {titel}
        {text && <small>{text}</small>}
      </span>
      <input type="checkbox" role="switch" checked={an} onChange={(e) => onChange(e.target.checked)} />
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
function Abschnitt({ titel, text, children, onSave, knopf = 'Speichern', extra }: { titel: string; text?: ReactNode; children: ReactNode; onSave: () => Promise<void>; knopf?: string; extra?: ReactNode }) {
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
    <form className="karte formular" onSubmit={absenden}>
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
const centsAus = (s: string) => Math.round(parseFloat(s.replace(',', '.')) * 100);

export default function Einstellungen() {
  useTitel('Einstellungen');
  const { data, setData, error } = useLoad<Settings>('/admin/settings');
  const [prog, setProg] = useState<FullProgram | null>(null);
  const [geld, setGeld] = useState({ redeem: '', max: '' });
  const [shop, setShop] = useState({ shop: '', client_id: '', client_secret: '' });
  const [login, setLogin] = useState({ client_id: '', client_secret: '', clear_secret: false });
  const [mail, setMail] = useState({ host: '', port: 465, user: '', password: '', from_email: '', from_name: '' });
  const [mailAn, setMailAn] = useState(false);
  const [links, setLinks] = useState({ account_url: '', terms_url: '' });

  // Formulare einmal mit dem gespeicherten Stand füllen
  useEffect(() => {
    if (!data || prog) return;
    setProg(data.program);
    setGeld({ redeem: euroFeld(data.program.redeem_cents), max: euroFeld(data.program.max_cents) });
    setShop({ shop: data.shopify.shop, client_id: data.shopify.client_id, client_secret: '' });
    setLogin({ client_id: data.login_shopify.client_id, client_secret: '', clear_secret: false });
    setMail({ ...data.smtp, password: '' });
    setMailAn(data.login_email);
    setLinks({ account_url: data.account_url, terms_url: data.terms_url });
  }, [data, prog]);

  if (!data || !prog) return error ? <Hinweis fehler>{error}</Hinweis> : <Laden />;

  async function speichern(teil: Record<string, unknown>, meldung = 'Gespeichert') {
    const s = await api<Settings>('PUT', '/admin/settings', teil);
    setData(s);
    toast(meldung);
    return s;
  }

  const p = prog;
  const zahl = (k: keyof FullProgram, titel: string, hilfe?: string, step = '1') => (
    <Feld titel={titel} hilfe={hilfe}>
      <input type="number" step={step} min={0} value={String(p[k])} onChange={(e) => setProg({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) } as FullProgram)} />
    </Feld>
  );

  return (
    <>
      <Seitenkopf label="Admin" titel={<>Club <em>einstellen</em></>} />

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
      </Abschnitt>

      <Abschnitt
        titel="Anmeldung mit dem Shopify-Kundenkonto"
        text={
          <>
            In Shopify unter „Vertriebskanäle → Headless → Customer Account API“ einen Client anlegen (vertraulich, mit Secret). Dort diese drei Adressen eintragen und die Client-ID hierher kopieren.
          </>
        }
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
        titel="Treueprogramm"
        text="Änderungen gelten sofort. Bestehende Punkte bleiben, neue Bestellungen werden mit den neuen Regeln berechnet."
        onSave={async () => {
          const redeem_cents = centsAus(geld.redeem);
          const max_cents = centsAus(geld.max);
          const s = await speichern({ program: { ...p, redeem_cents, max_cents } });
          setProg(s.program);
          setGeld({ redeem: euroFeld(s.program.redeem_cents), max: euroFeld(s.program.max_cents) });
        }}
      >
        <Feld titel="Name">
          <input value={p.name} maxLength={60} onChange={(e) => setProg({ ...p, name: e.target.value })} />
        </Feld>
        <Schalter titel="Einlösen möglich" text="Ausschalten pausiert neue Codes. Punkte sammeln geht weiter." an={p.active} onChange={(v) => setProg({ ...p, active: v })} />
        <div className="formular-reihe">
          {zahl('earn_per_euro', 'Punkte je 1 € Warenwert', 'Ohne Versand, nach Rabatten', '0.1')}
          {zahl('welcome_points', 'Willkommensbonus (Punkte)')}
        </div>
        <div className="formular-reihe">
          {zahl('redeem_points', 'Punkte je Stufe')}
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
          {zahl('code_days', 'Gültigkeit eines Codes (Tage)', 'Abgelaufene Codes geben die Punkte zurück')}
        </div>
        {zahl('retro_days', 'Bestellungen vor dem Beitritt zählen (Tage)')}
        <Schalter titel="Code nur für das eigene Kundenkonto" text="Empfohlen. Verhindert, dass Codes weitergegeben werden." an={p.bind_customer} onChange={(v) => setProg({ ...p, bind_customer: v })} />
        <Schalter titel="Mit Versand-Rabatten kombinierbar" an={p.combine_shipping} onChange={(v) => setProg({ ...p, combine_shipping: v })} />
        <Schalter titel="Mit anderen Bestell-Rabatten kombinierbar" an={p.combine_order} onChange={(v) => setProg({ ...p, combine_order: v })} />
        <Schalter titel="Mit Produkt-Rabatten kombinierbar" an={p.combine_product} onChange={(v) => setProg({ ...p, combine_product: v })} />
        <Schalter titel="Testbestellungen zählen" text="Nur zum Ausprobieren einschalten." an={p.count_test} onChange={(v) => setProg({ ...p, count_test: v })} />
      </Abschnitt>

      <Abschnitt
        titel="Anmeldung per E-Mail-Code"
        text="Ausweichweg ohne Shopify-Anmeldeseite: Die App schickt selbst einen sechsstelligen Code. Braucht ein Postfach (SMTP), z. B. info@perfumecloud.de bei netcup."
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
        <Schalter titel="Anmeldung per E-Mail-Code anbieten" an={mailAn} onChange={setMailAn} />
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
      </Abschnitt>

      <Abschnitt titel="Links" onSave={async () => void (await speichern({ account_url: links.account_url.trim() || null, terms_url: links.terms_url.trim() || null }))}>
        <Feld titel="Teilnahmebedingungen" hilfe="Eine Seite im Shop, z. B. https://www.perfumecloud.de/pages/club">
          <input type="url" value={links.terms_url} onChange={(e) => setLinks({ ...links, terms_url: e.target.value })} placeholder="https://" />
        </Feld>
        <Feld titel="Kundenkonto im Shop" hilfe="Für „Adressen & Daten“. Leer lassen für /account.">
          <input type="url" value={links.account_url} onChange={(e) => setLinks({ ...links, account_url: e.target.value })} placeholder="https://" />
        </Feld>
      </Abschnitt>

      <section className="karte formular">
        <h2 className="karte-titel">Cronjob</h2>
        <p className="klein leise">In Plesk unter „Geplante Aufgaben“ → „URL abrufen“, alle 15 Minuten. Alternativ als PHP-Skript.</p>
        <Kopierfeld label="URL abrufen" wert={data.cron_url} hilfe="Enthält einen geheimen Schlüssel, nicht weitergeben." />
        <Kopierfeld label="PHP-Skript" wert={data.cron_cli} />
        <p className="winzig leise">
          Adresse der App: {data.base_url} · Version {data.version}
        </p>
      </section>
    </>
  );
}
