import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  BellRing,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Download,
  LayoutGrid,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Share,
  ShoppingBag,
  SquarePlus,
  Sun,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Avatar, Button, Chip, cx, Segmented, Spinner, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { Integrations, MailboxConfig, Prefs, PushKind, User, UserColor } from '../lib/types';
import { disablePush, enablePush, isIos, isStandalone, pushState, type PushState } from '../lib/push';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import widgetTemplate from '../lib/widget-template.js?raw';
import { relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

const COLORS: UserColor[] = ['blue', 'sage', 'rose', 'amber', 'plum', 'slate'];
const PUSH_KINDS: { key: PushKind; label: string; hint: string }[] = [
  { key: 'mail', label: 'Wichtige Mails', hint: 'Neue wichtige Mail oder seit 24 Std. offen' },
  { key: 'orders', label: 'Neue Bestellungen', hint: 'Sobald eine Bestellung eingeht' },
  { key: 'tasks', label: 'Aufgaben für mich', hint: 'Wenn dir jemand eine Aufgabe zuweist' },
  { key: 'comments', label: 'Kommentare', hint: 'Zu Aufgaben, die du angelegt hast oder erledigst' },
  { key: 'reminders', label: 'Morgendliche Erinnerung', hint: 'Um 8 Uhr: heute fällige Aufgaben' },
];

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5 md:p-6">
      <h2 className="font-display text-[23px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { tab = 'allgemein' } = useParams();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const admin = me?.role === 'admin';
  const tabs = [
    { value: 'allgemein', label: 'Allgemein' },
    { value: 'team', label: 'Team' },
    ...(admin ? [{ value: 'integrationen', label: 'Integrationen' }] : []),
  ];
  return (
    <>
      <PageHeader title="Einstellungen" />
      <Segmented className="mb-6" value={tab} onChange={(v) => navigate(v === 'allgemein' ? '/einstellungen' : `/einstellungen/${v}`)} options={tabs} />
      <div className="max-w-[760px] space-y-5">
        {tab === 'allgemein' && <General />}
        {tab === 'team' && <Team />}
        {tab === 'integrationen' && admin && <IntegrationsPanel />}
      </div>
    </>
  );
}

// ---------------- Allgemein ----------------

function General() {
  const me = useStore((s) => s.me)!;
  const prefs = useStore((s) => s.prefs);
  const setMe = useStore((s) => s.setMe);
  const logout = useStore((s) => s.logout);
  const [name, setName] = useState(me.name);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);

  async function saveProfile(patch: Record<string, unknown>) {
    try {
      const r = await api<{ user: User; prefs: Prefs }>('PUT', '/me', patch);
      setMe(r.user, r.prefs);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (await saveProfile(pw)) {
      toast('Passwort geändert', 'success');
      setPw({ currentPassword: '', newPassword: '' });
    }
    setBusy(false);
  }

  return (
    <>
      <Section title="Profil">
        <div className="flex items-center gap-4">
          <Avatar user={{ ...me, name }} size={56} />
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="name">
              Name
            </label>
            <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== me.name && saveProfile({ name })} />
          </div>
        </div>
        <div className="mt-4">
          <span className="label">Farbe</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Farbe ${c}`}
                onClick={() => saveProfile({ color: c })}
                className={cx(`u-${c}`, 'h-8 w-8 rounded-full transition-transform hover:scale-110', me.color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
                style={{ background: 'var(--u-bg)', border: '2px solid var(--u-fg)' }}
              />
            ))}
          </div>
        </div>
        <p className="mt-4 text-[13px] text-ink-3">Angemeldet als {me.email}</p>
      </Section>

      <PushSection prefs={prefs} onPrefs={(p) => saveProfile({ prefs: p })} />
      <InstallSection />
      <WidgetSection />

      <Section title="Darstellung">
        <Segmented
          value={theme}
          onChange={(v) => {
            setTheme(v);
            setThemePref(v);
          }}
          options={[
            { value: 'auto', label: <span className="flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> Automatisch</span> },
            { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Hell</span> },
            { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> Dunkel</span> },
          ]}
        />
      </Section>

      <Section title="Passwort ändern">
        <form onSubmit={changePassword} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className="field" type="password" placeholder="Aktuelles Passwort" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <input className="field" type="password" placeholder="Neues Passwort (mind. 8 Zeichen)" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
          <div>
            <Button type="submit" variant="secondary" loading={busy}>
              Passwort speichern
            </Button>
          </div>
        </form>
      </Section>

      <div className="flex items-center justify-between px-1 pb-4">
        <span className="text-[12px] text-ink-3">Perfume Cloud Team-App · Version 1.0</span>
        <Button variant="danger" icon={<LogOut className="h-4 w-4" />} onClick={() => logout()}>
          Abmelden
        </Button>
      </div>
    </>
  );
}

function PushSection({ prefs, onPrefs }: { prefs: Prefs | null; onPrefs: (p: Prefs) => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === 'subscribed') toast('Benachrichtigungen sind aktiv', 'success');
      if (s === 'denied') toast('Mitteilungen wurden blockiert – bitte in den Geräte-Einstellungen erlauben.', 'error');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Konnte Benachrichtigungen nicht aktivieren.', 'error');
    }
    setBusy(false);
  }

  return (
    <Section title="Benachrichtigungen" description="Push-Nachrichten kommen auf diesem Gerät an – auch wenn die App geschlossen ist. Auf jedem Gerät einmal aktivieren.">
      <div className="rounded-2xl bg-surface-2 p-4">
        {state === null && <Spinner />}
        {state === 'needs-install' && (
          <div className="flex gap-3 text-[14px] text-ink-2">
            <SquarePlus className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <p>
              Auf dem iPhone funktionieren Benachrichtigungen nur, wenn die App auf dem Home-Bildschirm liegt: Tippe in Safari auf <Share className="inline h-4 w-4" /> <b>Teilen</b> → <b>Zum Home-Bildschirm</b>, öffne die App dort und komm hierher zurück.
            </p>
          </div>
        )}
        {state === 'unsupported' && <p className="text-[14px] text-ink-2">Dieser Browser unterstützt keine Push-Nachrichten. Tipp: Chrome, Edge oder Safari verwenden.</p>}
        {state === 'denied' && (
          <p className="flex gap-2 text-[14px] text-bad">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Mitteilungen sind für diese App blockiert. Erlaube sie in den Einstellungen deines Geräts bzw. Browsers.
          </p>
        )}
        {(state === 'default' || state === 'off') && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[14px] text-ink-2">Auf diesem Gerät noch nicht aktiv.</span>
            <Button icon={<BellRing className="h-4 w-4" />} loading={busy} onClick={enable}>
              Aktivieren
            </Button>
          </div>
        )}
        {state === 'subscribed' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[14px] font-medium text-good">
              <CircleCheck className="h-4 w-4" /> Aktiv auf diesem Gerät
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const r = await api<{ sent: number }>('POST', '/push/test').catch(() => ({ sent: 0 }));
                  toast(r.sent ? 'Test gesendet – kommt gleich an' : 'Senden fehlgeschlagen', r.sent ? 'success' : 'error');
                }}
              >
                Test senden
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await disablePush();
                  setState('off');
                }}
              >
                Ausschalten
              </Button>
            </div>
          </div>
        )}
      </div>
      {prefs && (
        <ul className="mt-4 divide-y divide-line/70">
          {PUSH_KINDS.map((k) => (
            <li key={k.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-[14.5px] font-medium text-ink">{k.label}</div>
                <div className="text-[12.5px] text-ink-3">{k.hint}</div>
              </div>
              <Toggle label={k.label} checked={prefs.push[k.key]} onChange={(v) => onPrefs({ ...prefs, push: { ...prefs.push, [k.key]: v } })} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-ink-3">Zwischen 22 und 7 Uhr werden keine Mail- und Bestell-Nachrichten verschickt.</p>
    </Section>
  );
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredPrompt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as InstallPrompt;
});

function InstallSection() {
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt);
  useEffect(() => {
    const on = () => setCanPrompt(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (isStandalone()) return null;
  return (
    <Section title="App installieren" description="Als App installiert startet Perfume Cloud wie eine normale App – mit eigenem Icon, im Vollbild und mit Benachrichtigungen.">
      {isIos() ? (
        <ol className="space-y-2 text-[14px] text-ink-2">
          <li>
            1. In <b>Safari</b> unten auf <Share className="inline h-4 w-4" /> <b>Teilen</b> tippen
          </li>
          <li>
            2. <b>Zum Home-Bildschirm</b> wählen und <b>Hinzufügen</b>
          </li>
          <li>3. Die App ab jetzt über das Icon öffnen</li>
        </ol>
      ) : canPrompt ? (
        <Button
          icon={<Download className="h-4 w-4" />}
          onClick={async () => {
            await deferredPrompt?.prompt();
            deferredPrompt = null;
            setCanPrompt(false);
          }}
        >
          Jetzt installieren
        </Button>
      ) : (
        <p className="text-[14px] text-ink-2">
          In <b>Edge</b> oder <b>Chrome</b>: rechts in der Adressleiste auf das Installieren-Symbol klicken (oder Menü → „App installieren“). Auf dem Mac in Safari: Ablage → „Zum Dock hinzufügen“.
        </p>
      )}
    </Section>
  );
}

function WidgetSection() {
  const me = useStore((s) => s.me)!;
  const [active, setActive] = useState<boolean | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ active: boolean }>('GET', '/widget/status')
      .then((r) => setActive(r.active))
      .catch(() => setActive(false));
  }, []);

  async function create() {
    if (active && !window.confirm('Ein neuer Schlüssel ersetzt den alten – das bestehende Widget funktioniert dann erst wieder mit dem neuen Skript. Fortfahren?')) return;
    setBusy(true);
    try {
      const { token } = await api<{ token: string }>('POST', '/widget/token');
      const code = widgetTemplate.replaceAll('__URL__', window.location.origin).replaceAll('__TOKEN__', token).replaceAll('__NAME__', me.name);
      setScript(code);
      setActive(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setBusy(false);
  }

  async function copy() {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      toast('Skript kopiert – jetzt in Scriptable einfügen', 'success');
    } catch {
      toast('Kopieren nicht möglich – bitte den Text markieren und kopieren.', 'error');
    }
  }

  return (
    <Section
      title="iPhone-Widget"
      description={
        <>
          Umsatz, wichtige Mails und deine Aufgaben direkt auf dem Home- oder Sperrbildschirm. Dafür braucht es die kostenlose App{' '}
          <a className="font-medium text-accent underline-offset-2 hover:underline" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noreferrer">
            Scriptable
          </a>
          .
        </>
      }
    >
      <ol className="space-y-2 text-[14px] leading-relaxed text-ink-2">
        <li>
          1. <b>Scriptable</b> aus dem App Store laden.
        </li>
        <li>
          2. Hier auf <b>„Widget-Skript erstellen“</b> tippen und <b>kopieren</b>.
        </li>
        <li>
          3. In Scriptable oben rechts auf <b>+</b>, Text einfügen, oben als Namen <b>Perfume Cloud</b> eintragen, <b>Fertig</b>.
        </li>
        <li>
          4. Auf dem Home-Bildschirm lange drücken → <b>Bearbeiten</b> → <b>Widget hinzufügen</b> → <b>Scriptable</b> → Größe wählen.
        </li>
        <li>
          5. Das neue Widget antippen und halten → <b>Widget bearbeiten</b> → bei „Script“ <b>Perfume Cloud</b> auswählen.
        </li>
      </ol>
      <p className="mt-3 text-[12.5px] text-ink-3">
        Klappt genauso auf dem Sperrbildschirm. Das Widget aktualisiert sich etwa alle 15 Minuten (iOS entscheidet den genauen Zeitpunkt). Der Zugang darin ist persönlich und kann nur lesen.
      </p>

      {script ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button icon={<Copy className="h-4 w-4" />} onClick={copy}>
              Skript kopieren
            </Button>
            <a
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14px] font-medium text-ink hover:bg-surface-2"
              href={`data:text/javascript;charset=utf-8,${encodeURIComponent(script)}`}
              download="Perfume Cloud.js"
            >
              <Download className="h-4 w-4" /> Als Datei
            </a>
          </div>
          <textarea readOnly className="field h-32 font-mono text-[11px] leading-snug" value={script} onFocus={(e) => e.target.select()} />
          <p className="text-[12.5px] text-warn">Dieses Skript enthält deinen persönlichen Schlüssel – nur in dein eigenes Scriptable einfügen.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button icon={<LayoutGrid className="h-4 w-4" />} loading={busy || active === null} onClick={create}>
            {active ? 'Neues Widget-Skript erstellen' : 'Widget-Skript erstellen'}
          </Button>
          {active && (
            <Button
              variant="ghost"
              onClick={async () => {
                await api('DELETE', '/widget/token').catch(() => undefined);
                setActive(false);
                toast('Widget-Zugang gesperrt', 'success');
              }}
            >
              Zugang sperren
            </Button>
          )}
          {active && <span className="text-[12.5px] text-good">Widget-Zugang ist aktiv</span>}
        </div>
      )}
    </Section>
  );
}

// ---------------- Team ----------------

function Team() {
  const usersMap = useStore((s) => s.users);
  const me = useStore((s) => s.me)!;
  const sync = useStore((s) => s.sync);
  const admin = me.role === 'admin';
  const users = Object.values(usersMap).filter((u) => !u.deleted);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/admin/users', form);
      toast(`${form.name} wurde angelegt`, 'success');
      setForm({ name: '', email: '', password: '', role: 'member' });
      await sync();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setBusy(false);
  }

  return (
    <>
      <Section title="Team" description={admin ? 'Jede Person bekommt ein eigenes Konto. Teile E-Mail und Startpasswort persönlich – das Passwort kann danach jede:r selbst ändern.' : undefined}>
        <ul className="divide-y divide-line/70">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar user={u} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink">
                  {u.name} {u.id === me.id && <span className="text-ink-3">(du)</span>}
                </div>
                <div className="truncate text-[12.5px] text-ink-3">{u.email}</div>
              </div>
              {u.role === 'admin' && <Chip tone="accent">Admin</Chip>}
              {admin && u.id !== me.id && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setReset({ id: u.id, password: '' })}>
                    Passwort
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api('PUT', `/admin/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' }).catch((e) => toast(e.message, 'error'));
                      await sync();
                    }}
                  >
                    {u.role === 'admin' ? 'Kein Admin' : 'Zum Admin'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-bad"
                    aria-label={`${u.name} entfernen`}
                    onClick={async () => {
                      if (!window.confirm(`${u.name} wirklich entfernen?`)) return;
                      await api('DELETE', `/admin/users/${u.id}`).catch((e) => toast(e.message, 'error'));
                      await sync({ full: true });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {reset?.id === u.id && (
                <form
                  className="flex w-full gap-2 pl-12"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await api('PUT', `/admin/users/${u.id}`, { password: reset.password });
                      toast('Neues Passwort gesetzt', 'success');
                      setReset(null);
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  }}
                >
                  <input className="field" type="text" minLength={8} required placeholder="Neues Passwort (mind. 8 Zeichen)" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
                  <Button type="submit">Setzen</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Section>
      {admin && (
        <Section title="Person hinzufügen">
          <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className="field" placeholder="Name, z. B. Ben oder Keanu" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="field" type="email" placeholder="E-Mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input className="field" type="text" minLength={8} placeholder="Startpasswort (mind. 8 Zeichen)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <Segmented
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={[
                { value: 'member', label: 'Mitglied' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
            <div>
              <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={busy}>
                Hinzufügen
              </Button>
            </div>
          </form>
        </Section>
      )}
    </>
  );
}

// ---------------- Integrationen ----------------

const DEFAULT_MAILBOXES: MailboxConfig[] = [
  { email: 'info@perfumecloud.de', host: '', port: 993, security: 'ssl', user: 'info@perfumecloud.de' },
  { email: 'support@perfumecloud.de', host: '', port: 993, security: 'ssl', user: 'support@perfumecloud.de' },
];

function StatusLine({ status }: { status?: { ok: boolean; message: string; at?: number } | null }) {
  const now = useNow();
  if (!status) return null;
  return (
    <p className={cx('mt-3 flex items-start gap-2 text-[13px]', status.ok ? 'text-good' : 'text-bad')}>
      {status.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>
        {status.message}
        {status.at ? <span className="text-ink-3"> · {relative(status.at, now)}</span> : null}
      </span>
    </p>
  );
}

function IntegrationsPanel() {
  const [data, setData] = useState<Integrations | null>(null);
  const sync = useStore((s) => s.sync);
  const now = useNow();
  const [shop, setShop] = useState({ shop: '', client_id: '', client_secret: '' });
  const [boxes, setBoxes] = useState<MailboxConfig[]>(DEFAULT_MAILBOXES);
  const [busy, setBusy] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(5);

  useEffect(() => {
    api<Integrations>('GET', '/admin/integrations')
      .then((d) => {
        setData(d);
        setShop({ shop: d.shopify.shop || 'ks8yin-mg.myshopify.com', client_id: d.shopify.client_id, client_secret: '' });
        if (d.mailboxes.length) setBoxes(d.mailboxes.map((m) => ({ ...m, password: '' })));
        setThreshold(d.settings.low_stock_threshold);
      })
      .catch((e) => toast(e.message, 'error'));
  }, []);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <Spinner />;

  const saveShop = (e: FormEvent) => {
    e.preventDefault();
    void run('shop', async () => {
      const d = await api<Integrations>('PUT', '/admin/shopify', shop);
      setData(d);
      setShop((s) => ({ ...s, client_secret: '' }));
      toast(d.test?.ok ? 'Shopify verbunden – Bestellungen werden geladen' : d.test?.message ?? 'Fehler', d.test?.ok ? 'success' : 'error');
      void sync();
    });
  };

  const saveMail = (e: FormEvent) => {
    e.preventDefault();
    void run('mail', async () => {
      const d = await api<Integrations>('PUT', '/admin/mailboxes', { mailboxes: boxes });
      setData(d);
      setBoxes(d.mailboxes.map((m) => ({ ...m, password: '' })));
      const failed = Object.values(d.tests ?? {}).filter((t) => !t.ok).length;
      toast(failed ? `${failed} Postfach konnte nicht verbunden werden` : 'Postfächer verbunden – Mails werden abgerufen', failed ? 'error' : 'success');
      void sync();
    });
  };

  const setBox = (i: number, patch: Partial<MailboxConfig>) => setBoxes(boxes.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <>
      <Section
        title="Shopify"
        description={
          <>
            Lesezugriff auf Bestellungen, Produkte und Lager über eine eigene App im <b>Shopify Dev Dashboard</b> (kostenlos). Benötigte Berechtigungen: <code className="rounded bg-surface-2 px-1">read_orders</code>,{' '}
            <code className="rounded bg-surface-2 px-1">read_products</code>, <code className="rounded bg-surface-2 px-1">read_inventory</code>. Schritt-für-Schritt-Anleitung: siehe <b>docs/ANLEITUNG.md</b>.
          </>
        }
      >
        <form onSubmit={saveShop} className="space-y-3">
          <div>
            <label className="label">myshopify-Adresse</label>
            <input className="field" value={shop.shop} onChange={(e) => setShop({ ...shop, shop: e.target.value })} placeholder="ks8yin-mg.myshopify.com" required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Client-ID</label>
              <input className="field" value={shop.client_id} onChange={(e) => setShop({ ...shop, client_id: e.target.value })} required autoComplete="off" />
            </div>
            <div>
              <label className="label">Client-Secret {data.shopify.hasSecret && <span className="text-ink-3">(gespeichert)</span>}</label>
              <input
                className="field"
                type="password"
                value={shop.client_secret}
                onChange={(e) => setShop({ ...shop, client_secret: e.target.value })}
                placeholder={data.shopify.hasSecret ? '•••••••• unverändert' : ''}
                required={!data.shopify.hasSecret}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" icon={<ShoppingBag className="h-4 w-4" />} loading={busy === 'shop'}>
              Speichern & testen
            </Button>
            {data.shopify.configured && <span className="text-[12.5px] text-ink-3">Letzter Abgleich: {data.shopify.lastSync ? relative(data.shopify.lastSync, now) : 'noch nie'}</span>}
          </div>
          <StatusLine status={data.test ?? data.shopify.status} />
        </form>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <label className="text-[13.5px] text-ink-2" htmlFor="th">
            „Knapper Bestand“ ab
          </label>
          <input id="th" type="number" min={0} className="field w-24" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <span className="text-[13.5px] text-ink-2">Stück</span>
          <Button size="sm" variant="secondary" onClick={() => run('th', async () => setData(await api('PUT', '/admin/settings', { low_stock_threshold: threshold })))}>
            Übernehmen
          </Button>
        </div>
      </Section>

      <Section
        title="Postfächer"
        description="IMAP-Zugang von info@ und support@. Die Daten stehen bei netcup im Webhosting-Panel unter E-Mail → Postfach → „Mail-Client einrichten“. Die App liest nur – sie markiert nichts als gelesen und löscht nichts."
      >
        <form onSubmit={saveMail} className="space-y-5">
          {boxes.map((b, i) => (
            <div key={i} className="rounded-2xl border border-line p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
                  <Mail className="h-4 w-4 text-accent" /> {b.email || 'Neues Postfach'}
                </div>
                <button type="button" className="text-[12.5px] text-ink-3 hover:text-bad" onClick={() => setBoxes(boxes.filter((_, j) => j !== i))}>
                  Entfernen
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div className="sm:col-span-3">
                  <label className="label">E-Mail-Adresse</label>
                  <input className="field" type="email" value={b.email} onChange={(e) => setBox(i, { email: e.target.value, user: b.user === b.email ? e.target.value : b.user })} required />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">Benutzername</label>
                  <input className="field" value={b.user} onChange={(e) => setBox(i, { user: e.target.value })} required autoComplete="off" />
                </div>
                <div className="sm:col-span-4">
                  <label className="label">IMAP-Server</label>
                  <input className="field" value={b.host} onChange={(e) => setBox(i, { host: e.target.value })} placeholder="z. B. mxf9a2.netcup.net" required />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Port</label>
                  <input className="field" type="number" value={b.port} onChange={(e) => setBox(i, { port: Number(e.target.value), security: Number(e.target.value) === 143 ? 'starttls' : 'ssl' })} />
                </div>
                <div className="sm:col-span-6">
                  <label className="label">Passwort {b.hasPassword && <span className="text-ink-3">(gespeichert)</span>}</label>
                  <input
                    className="field"
                    type="password"
                    value={b.password ?? ''}
                    onChange={(e) => setBox(i, { password: e.target.value })}
                    placeholder={b.hasPassword ? '•••••••• unverändert' : ''}
                    required={!b.hasPassword}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <StatusLine status={(b.id && data.tests?.[b.id]) || b.status} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" icon={<Mail className="h-4 w-4" />} loading={busy === 'mail'}>
              Speichern & testen
            </Button>
            <Button type="button" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setBoxes([...boxes, { email: '', host: boxes[0]?.host ?? '', port: 993, security: 'ssl', user: '' }])}>
              Postfach hinzufügen
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title="Cronjob"
        description="Damit Mails, Bestellungen und Push-Nachrichten auch dann aktuell sind, wenn niemand die App offen hat, ruft netcup alle 5 Minuten diese Adresse auf. In Plesk: Geplante Aufgaben → Aufgabe hinzufügen → „URL abrufen“."
      >
        <div className="flex items-center gap-2">
          <input className="field font-mono text-[12.5px]" readOnly value={data.cron.url} onFocus={(e) => e.target.select()} />
          <Button
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            onClick={() => {
              void navigator.clipboard?.writeText(data.cron.url);
              toast('Adresse kopiert', 'success');
            }}
          >
            Kopieren
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <Clock className="h-4 w-4 text-ink-3" />
          {data.cron.lastRun ? `Cronjob lief zuletzt ${relative(data.cron.lastRun, now)}` : 'Der Cronjob ist noch nicht gelaufen.'}
          {data.cron.jobsLastRun ? ` · Abgleich zuletzt ${relative(data.cron.jobsLastRun, now)}` : ''}
        </p>
        <div className="mt-4">
          <Button
            variant="secondary"
            icon={<RefreshCw className={cx('h-4 w-4', busy === 'jobs' && 'animate-spin')} />}
            loading={busy === 'jobs'}
            onClick={() =>
              run('jobs', async () => {
                const d = await api<Integrations>('POST', '/admin/jobs');
                setData(d);
                toast('Abgleich abgeschlossen', 'success');
                void sync();
              })
            }
          >
            Jetzt abgleichen
          </Button>
        </div>
      </Section>
    </>
  );
}
