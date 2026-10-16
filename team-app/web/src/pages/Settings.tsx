import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  BellRing,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Crown,
  Download,
  ExternalLink,
  LayoutGrid,
  Lock,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Send,
  Share,
  ShoppingBag,
  Smartphone,
  Stethoscope,
  SquarePlus,
  Sun,
  Trash2,
  Zap,
} from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Section } from '../components/section';
import { InstagramIcon } from '../components/instagram-icon';
import { InstagramSection } from '../components/instagram-settings';
import { CustomerTest, ReportsPanel, SignatureSection, TemplatesPanel } from './SettingsMore';
import { Avatar, Button, Chip, cx, IconButton, Segmented, Spinner, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import type { ClubSettings, Integrations, LiveStatus, MailboxConfig, MailCheck, MyMailbox, Prefs, PushDevice, PushKind, PushTestResult, User, UserColor } from '../lib/types';
import { disablePush, enablePush, isIos, isStandalone, pushState, thisDeviceId, type PushState } from '../lib/push';
import { openClubAdmin } from './Club';
import { STATES } from '../lib/holidays';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { installUrl, useInstall } from '../lib/install';
import widgetTemplate from '../lib/widget-template.js?raw';
import { relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

const COLORS: UserColor[] = ['blue', 'sage', 'rose', 'amber', 'plum', 'slate'];
const PUSH_KINDS: { key: PushKind; label: string; hint: string }[] = [
  { key: 'mail', label: 'Mails', hint: 'Neue Mails in info@, support@ und deinem eigenen Postfach' },
  { key: 'orders', label: 'Neue Bestellungen', hint: 'Sobald eine Bestellung eingeht' },
  { key: 'tasks', label: 'Aufgaben für mich', hint: 'Wenn dir jemand eine Aufgabe zuweist' },
  { key: 'comments', label: 'Kommentare', hint: 'Zu Aufgaben, die du angelegt hast oder erledigst' },
  { key: 'reminders', label: 'Morgendliche Erinnerung', hint: 'Um 8 Uhr: heute fällige Aufgaben' },
  { key: 'events', label: 'Termine', hint: 'Erinnerung vor Terminen und wenn dich jemand einträgt' },
  { key: 'shipping', label: 'Versand-Erinnerung', hint: 'Morgens, wenn Bestellungen zu lange auf den Versand warten' },
  { key: 'feedback', label: 'Unzufriedene Kundin', hint: 'Sofort, wenn jemand nach der Lieferung 1–2 Sterne gibt' },
  { key: 'weekly', label: 'Wochenrückblick', hint: 'Freitags die Zusammenfassung der Woche' },
  { key: 'instagram', label: 'Instagram', hint: 'Beitrag zur Prüfung oder veröffentlicht, Erinnerung zum Posten, neue Kommentare' },
];

export default function Settings() {
  const { tab = 'allgemein' } = useParams();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const admin = me?.role === 'admin';
  const tabs = [
    { value: 'allgemein', label: 'Allgemein' },
    { value: 'team', label: 'Team' },
    ...(admin
      ? [
          { value: 'integrationen', label: 'Integrationen' },
          { value: 'vorlagen', label: 'Vorlagen' },
          { value: 'auswertungen', label: 'Auswertungen' },
        ]
      : []),
  ];
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  return (
    <>
      <PageHeader title="Einstellungen" />
      {/* Am Handy seitlich scrollbar, wenn die Reiter nicht in eine Zeile passen */}
      <div ref={tabsRef} className="no-scrollbar -mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented value={tab} onChange={(v) => navigate(v === 'allgemein' ? '/einstellungen' : `/einstellungen/${v}`)} options={tabs} />
      </div>
      <div className="max-w-[760px] space-y-5">
        {tab === 'allgemein' && <General />}
        {tab === 'team' && <Team />}
        {tab === 'integrationen' && admin && <IntegrationsPanel />}
        {tab === 'vorlagen' && admin && <TemplatesPanel />}
        {tab === 'auswertungen' && admin && <ReportsPanel />}
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
  const version = useStore((s) => s.meta?.version);
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

      <MyMailboxSection />
      <PushSection prefs={prefs} onPrefs={(p) => saveProfile({ prefs: p })} />
      <SignatureSection prefs={prefs} onPrefs={(p) => saveProfile({ prefs: p })} />
      <InstallSection />
      <WidgetSection />
      <CalendarFeedSection />

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
        <span className="text-[12px] text-ink-3">Perfume Cloud Team-App{version ? ` · Version ${version}` : ''}</span>
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
  const [testing, setTesting] = useState(false);
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [thisId, setThisId] = useState<string | null>(null);
  const [results, setResults] = useState<PushTestResult | null>(null);
  const loadDevices = () =>
    api<{ devices: PushDevice[] }>('GET', '/push/devices')
      .then((r) => setDevices(r.devices))
      .catch(() => undefined);
  useEffect(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
  }, []);
  useEffect(() => {
    void loadDevices();
    thisDeviceId().then(setThisId).catch(() => setThisId(null));
  }, [state]);

  async function test() {
    setTesting(true);
    try {
      const r = await api<PushTestResult>('POST', '/push/test');
      setResults(r);
      if (r.devices === 0) toast('Kein Gerät angemeldet – tippe auf „Aktivieren“.', 'error');
      else if (r.sent === r.devices) toast(r.devices === 1 ? 'Test gesendet – kommt gleich an' : `Test an ${r.devices} Geräte gesendet`, 'success');
      else toast(`${r.devices - r.sent} von ${r.devices} Geräten nicht erreicht – Details unten`, 'error');
      await loadDevices();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTesting(false);
    }
  }

  async function removeDevice(d: PushDevice) {
    if (d.id === thisId) {
      await disablePush();
      setState('off');
    } else {
      await api('DELETE', `/push/devices/${d.id}`).catch((e) => toast((e as Error).message, 'error'));
    }
    setResults(null);
    await loadDevices();
  }

  const missingHere = state === 'subscribed' && devices !== null && thisId !== null && !devices.some((d) => d.id === thisId);

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
              <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} loading={testing} onClick={test}>
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
      {missingHere && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn/10 p-3 text-[14px] text-warn">
          <span className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Dieses Gerät ist beim Server nicht angemeldet und bekommt deshalb nichts.
          </span>
          <Button size="sm" variant="secondary" loading={busy} onClick={enable}>
            Neu anmelden
          </Button>
        </div>
      )}
      {devices && devices.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow mb-1">Deine Geräte</p>
          <ul className="divide-y divide-line/70">
            {devices.map((d) => {
              const r = results?.results.find((x) => x.id === d.id);
              const failing = r ? !r.ok : d.fail_count > 0;
              const reason = r ? r.reason : d.last_error;
              const status = r ? r.status : d.last_status;
              return (
                <li key={d.id} className="flex items-start gap-3 py-2.5">
                  <Smartphone className={cx('mt-0.5 h-4 w-4 shrink-0', failing ? 'text-bad' : 'text-ink-3')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[14px] text-ink">
                      {d.device}
                      {d.id === thisId && <Chip tone="accent">Dieses Gerät</Chip>}
                      {r && (r.ok ? <Chip tone="good">Test angekommen beim Push-Dienst</Chip> : <Chip tone="bad">Test fehlgeschlagen</Chip>)}
                    </div>
                    <div className="text-[13px] text-ink-3">
                      {failing
                        ? `${status ? `HTTP ${status} · ` : ''}${reason || 'Fehler'}${d.fail_count > 1 ? ` · ${d.fail_count}× in Folge` : ''}`
                        : d.last_ok_at
                          ? `Zuletzt zugestellt ${relative(d.last_ok_at)}`
                          : `Angemeldet ${relative(d.created_at)}`}
                    </div>
                    {failing && <p className="mt-1 text-[13px] text-ink-2">{pushHint(reason ?? '', status ?? 0)}</p>}
                  </div>
                  <IconButton label={`${d.device} entfernen`} className="h-8 w-8 hover:text-bad" onClick={() => removeDevice(d)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[12px] text-ink-3">„Angekommen beim Push-Dienst“ heißt: Apple, Google oder Mozilla haben die Nachricht angenommen. Kommt trotzdem nichts, prüfe Fokus/Nicht stören und die Mitteilungs-Einstellungen des Geräts.</p>
        </div>
      )}
      {prefs && (
        <ul className="mt-4 divide-y divide-line/70">
          {PUSH_KINDS.map((k) => (
            <li key={k.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-[15px] font-medium text-ink">{k.label}</div>
                <div className="text-[13px] text-ink-3">{k.hint}</div>
              </div>
              <Toggle label={k.label} checked={prefs.push[k.key]} onChange={(v) => onPrefs({ ...prefs, push: { ...prefs.push, [k.key]: v } })} />
            </li>
          ))}
          {prefs.push.mail && (
            <li className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="text-[15px] font-medium text-ink">Bei welchen Mails?</div>
                <div className="text-[13px] text-ink-3">
                  {prefs.mailScope === 'everything'
                    ? 'Jede Mail – auch Newsletter, automatische und schon gelesene.'
                    : prefs.mailScope === 'important'
                      ? 'Nur Mails, die als wichtig erkannt werden.'
                      : 'Jede neue ungelesene Mail, ohne Newsletter und automatische.'}{' '}
                  Immer nur aus Postfächern, die für dich sichtbar sind.
                </div>
              </div>
              <Segmented
                size="sm"
                value={prefs.mailScope ?? 'all'}
                onChange={(v) => onPrefs({ ...prefs, mailScope: v })}
                options={[
                  { value: 'all', label: 'Jede neue' },
                  { value: 'everything', label: 'Wirklich alle' },
                  { value: 'important', label: 'Nur wichtige' },
                ]}
              />
            </li>
          )}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-ink-3">
        Zwischen 22 und 7 Uhr werden keine Mail- und Bestell-Nachrichten verschickt – die Mails kommen dann morgens gesammelt. Termin-Erinnerungen kommen immer pünktlich.
      </p>
    </Section>
  );
}

/** Verständlicher Hinweis zu einer Fehlermeldung des Push-Dienstes. */
function pushHint(reason: string, status: number): string {
  const r = reason.toLowerCase();
  if (r.includes('jwt') || r.includes('vapid') || status === 401 || status === 403) {
    return 'Der Push-Dienst lehnt die Anmeldung ab (Schlüssel passt nicht zum Gerät). Auf diesem Gerät „Ausschalten“ und wieder „Aktivieren“ tippen – dann klappt es mit dem aktuellen Schlüssel.';
  }
  if (r.includes('keine verbindung') || status === 0) {
    return 'Der Server erreicht den Push-Dienst nicht. Meist nur kurz – sonst beim Hoster prüfen, ob ausgehende Verbindungen (HTTPS) erlaubt sind.';
  }
  if (status === 413) return 'Die Nachricht war zu lang für den Push-Dienst.';
  if (status === 429) return 'Zu viele Nachrichten in kurzer Zeit – der Push-Dienst bremst. Das gibt sich von selbst.';
  return 'Gerät entfernen und auf dem Gerät Push neu aktivieren.';
}

function InstallSection() {
  const install = useInstall();
  const standalone = isStandalone();
  return (
    <Section
      title={standalone ? 'App auf weiteren Geräten' : 'App installieren'}
      description={
        standalone
          ? 'Für iPhone und Computer: diesen Link auf dem Gerät öffnen – dort steht Schritt für Schritt, wie die App draufkommt.'
          : 'Als App installiert startet Perfume Cloud wie eine normale App – mit eigenem Icon, im eigenen Fenster und mit Benachrichtigungen.'
      }
    >
      {!standalone &&
        (isIos() ? (
          <ol className="mb-3 space-y-2 text-[14px] text-ink-2">
            <li>
              1. In <b>Safari</b> unten auf <Share className="inline h-4 w-4" /> <b>Teilen</b> tippen
            </li>
            <li>
              2. <b>Zum Home-Bildschirm</b> wählen und <b>Hinzufügen</b>
            </li>
            <li>3. Die App ab jetzt über das Icon öffnen</li>
          </ol>
        ) : install.canPrompt ? (
          <Button className="mb-3" icon={<Download className="h-4 w-4" />} onClick={() => void install.prompt()}>
            Jetzt installieren
          </Button>
        ) : (
          <p className="mb-3 text-[14px] text-ink-2">
            In <b>Edge</b> oder <b>Chrome</b>: rechts in der Adressleiste auf das Installieren-Symbol klicken (oder Menü → „App installieren“). Auf dem Mac in Safari: Ablage → „Zum Dock hinzufügen“.
          </p>
        ))}
      <CopyRow value={installUrl()} label="Link kopiert" />
      <a href="/app" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline">
        Anleitung mit QR-Code öffnen <ExternalLink className="h-4 w-4" />
      </a>
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
        <li>
          6. <b>Kalender-Widget:</b> ein zweites Widget hinzufügen, ebenfalls <b>Perfume Cloud</b> auswählen und bei „Parameter“ <b>kalender</b> eintragen. Es zeigt deine nächsten Termine mit Feiertagen und Aktionstagen.
        </li>
        <li>
          7. <b>Club-Widget</b> (nur mit Club-Zugang): bei „Parameter“ <b>club</b> eintragen. Es zeigt Mitglieder, Neuzugänge, Stufen, die neuesten Mitglieder (nur
          Vorname und Initial) und die Bewertungen. Mit Club-Zugang steht die Mitgliederzahl auch im normalen Widget.
        </li>
      </ol>
      <p className="mt-3 text-[13px] text-ink-3">
        Klappt genauso auf dem Sperrbildschirm. Das Widget aktualisiert sich etwa alle 15 Minuten (iOS entscheidet den genauen Zeitpunkt). Der Zugang darin ist persönlich und kann nur lesen. Nach einem
        Update der Team-App das Skript einmal neu kopieren, damit neue Anzeigen dazukommen.
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
          <p className="text-[13px] text-warn">Dieses Skript enthält deinen persönlichen Schlüssel – nur in dein eigenes Scriptable einfügen.</p>
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
          {active && <span className="text-[13px] text-good">Widget-Zugang ist aktiv</span>}
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
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member', invite: true });
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const [inviteResult, setInviteResult] = useState<(InviteResult & { name: string }) | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ restored: boolean; invite: InviteResult | null }>('POST', '/admin/users', form);
      const first = form.name.split(' ')[0];
      toast(r.restored ? `${first} ist wieder im Team` : `${first} wurde angelegt`, 'success');
      if (r.invite) setInviteResult({ ...r.invite, name: first });
      setForm({ name: '', email: '', password: '', role: 'member', invite: true });
      await sync();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    setBusy(false);
  }

  async function invite(u: User) {
    try {
      const r = await api<InviteResult>('POST', `/admin/users/${u.id}/invite`);
      setInviteResult({ ...r, name: u.name.split(' ')[0] });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <>
      <Section
        title="Team"
        description={
          admin
            ? 'Jede Person bekommt ein eigenes Konto. Am einfachsten per Einladung: Die Person bekommt eine Mail mit einem Link und legt ihr Passwort selbst fest. Admins haben immer Zugang zum Members Club und zu Instagram, andere nur mit „Club-Zugang“ bzw. „Instagram-Zugang“.'
            : undefined
        }
      >
        {inviteResult && <InviteBox r={inviteResult} onClose={() => setInviteResult(null)} />}
        <ul className="divide-y divide-line/70">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar user={u} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium text-ink">
                  {u.name} {u.id === me.id && <span className="text-ink-3">(du)</span>}
                </div>
                <div className="truncate text-[13px] text-ink-3">{u.email}</div>
              </div>
              {u.role === 'admin' && <Chip tone="accent">Admin</Chip>}
              {u.role !== 'admin' && !!u.club_access && (
                <Chip icon={<Crown className="h-3 w-3" />}>Club</Chip>
              )}
              {u.role !== 'admin' && !!u.instagram_access && (
                <Chip icon={<InstagramIcon className="h-3 w-3" />}>Instagram</Chip>
              )}
              {admin && u.id !== me.id && (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => invite(u)}>
                    Einladen
                  </Button>
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
                  {u.role !== 'admin' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Crown className="h-3.5 w-3.5" />}
                      title="Zugang zum Members Club: Statistik, Nachrichten an Mitglieder, Club-Admin"
                      onClick={async () => {
                        await api('PUT', `/admin/users/${u.id}`, { club_access: !u.club_access }).catch((e) => toast(e.message, 'error'));
                        await sync();
                      }}
                    >
                      {u.club_access ? 'Kein Club' : 'Club-Zugang'}
                    </Button>
                  )}
                  {u.role !== 'admin' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<InstagramIcon className="h-3.5 w-3.5" />}
                      title="Zugang zu Instagram: Auswertung, Beiträge planen und freigeben, Kommentare beantworten"
                      onClick={async () => {
                        await api('PUT', `/admin/users/${u.id}`, { instagram_access: !u.instagram_access }).catch((e) => toast(e.message, 'error'));
                        await sync();
                      }}
                    >
                      {u.instagram_access ? 'Kein Instagram' : 'Instagram-Zugang'}
                    </Button>
                  )}
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
            <input
              className="field"
              type="text"
              minLength={8}
              placeholder={form.invite ? 'Startpasswort (optional)' : 'Startpasswort (mind. 8 Zeichen)'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!form.invite}
            />
            <Segmented
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={[
                { value: 'member', label: 'Mitglied' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
            <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2/70 px-3.5 py-2.5 sm:col-span-2">
              <span className="text-[14px] text-ink">
                Einladung per E-Mail schicken
                <span className="block text-[13px] text-ink-3">Mit Link zum Passwort-Festlegen – verschickt über euer info@-Postfach.</span>
              </span>
              <Toggle label="Einladung per E-Mail" checked={form.invite} onChange={(v) => setForm({ ...form, invite: v })} />
            </label>
            <div>
              <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={busy}>
                Hinzufügen
              </Button>
            </div>
            <p className="text-[12px] text-ink-3 sm:col-span-2">War die Person schon mal im Team und wurde entfernt? Einfach mit derselben E-Mail neu anlegen – sie wird wiederhergestellt.</p>
          </form>
        </Section>
      )}
    </>
  );
}

// ---------------- Integrationen ----------------

const DEFAULT_MAILBOXES: MailboxConfig[] = [
  { email: 'info@perfumecloud.de', host: '', port: 993, security: 'ssl', user: 'info@perfumecloud.de', visible_to: [] },
  { email: 'support@perfumecloud.de', host: '', port: 993, security: 'ssl', user: 'support@perfumecloud.de', visible_to: [] },
];

// ---------------- Einladung ----------------

interface InviteResult {
  sent: boolean;
  message: string;
  link: string;
}

function InviteBox({ r, onClose }: { r: InviteResult & { name: string }; onClose: () => void }) {
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      await nav.share({ title: 'Einladung Perfume Cloud Team', text: `Hallo ${r.name}, hier ist deine Einladung zur Team-App:`, url: r.link }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(r.link).catch(() => undefined);
      toast('Link kopiert', 'success');
    }
  };
  return (
    <div className={cx('mb-4 rounded-2xl p-4', r.sent ? 'bg-good/10' : 'bg-warn/10')}>
      <p className={cx('flex items-start gap-2 text-[14px] font-medium', r.sent ? 'text-good' : 'text-warn')}>
        {r.sent ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{r.sent ? `Einladung an ${r.name} verschickt.` : r.message}</span>
      </p>
      <p className="mt-2 text-[13px] text-ink-2">
        {r.sent ? 'Kommt nichts an (Spam-Ordner prüfen!), kannst du den Link auch direkt schicken, z. B. per WhatsApp:' : `Schick ${r.name} den Link einfach direkt, z. B. per WhatsApp:`}
      </p>
      <div className="mt-2 flex gap-2">
        <input className="field font-mono text-[12px]" readOnly value={r.link} onFocus={(e) => e.target.select()} aria-label="Einladungslink" />
        <Button variant="secondary" icon={<Share className="h-4 w-4" />} onClick={share}>
          <span className="max-sm:hidden">Teilen</span>
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-3">
        <span>Der Link gilt 14 Tage und nur einmal.</span>
        <button className="font-medium text-ink-2 hover:text-ink" onClick={onClose}>
          Schließen
        </button>
      </div>
    </div>
  );
}

// ---------------- Wartung ----------------

const LIVE_STATE: Record<LiveStatus['boxes'][string]['state'], { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  idle: { label: 'sofort', tone: 'good' },
  poll: { label: 'alle 10 Sek.', tone: 'warn' },
  connecting: { label: 'verbindet …', tone: 'neutral' },
  error: { label: 'Fehler', tone: 'bad' },
};

/** Zustand des Sofort-Abrufs: läuft er, wie schnell ist jedes Postfach, wie schnell kam die letzte Mail? */
function LiveStatusView({ live, now }: { live: LiveStatus; now: number }) {
  const boxes = Object.entries(live.boxes ?? {});
  if (!live.active) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Der Sofort-Abruf läuft nicht{live.beat ? ` (zuletzt ${relative(live.beat, now)})` : ''}. Richtet die geplante Aufgabe unten ein – jede Minute. Bis dahin kommen Push-Nachrichten erst beim nächsten Abgleich.
        </span>
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-good/10 p-3 text-[13px] text-ink-2">
      <p className="flex items-center gap-2 font-medium text-good">
        <Zap className="h-4 w-4" /> Sofort-Abruf aktiv
      </p>
      {boxes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {boxes.map(([email, b]) => (
            <li key={email} className="flex flex-wrap items-center gap-2">
              <span className="truncate">{email}</span>
              <Chip tone={LIVE_STATE[b.state]?.tone ?? 'neutral'}>{LIVE_STATE[b.state]?.label ?? b.state}</Chip>
              {b.message && <span className="text-[12px] text-bad">{b.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {live.lastMail && (
        <p className="mt-2 text-[13px] text-ink-3">
          Letzte Mail {relative(live.lastMail.at, now)} gemeldet, {seconds(live.lastMail.delay)} nach dem Eingang.
        </p>
      )}
    </div>
  );
}

function seconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 120 ? `${s} Sek.` : `${Math.round(s / 60)} Min.`;
}

function CopyRow({ value, label }: { value: string; label: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <input className="field min-w-0 flex-1 font-mono text-[13px]" readOnly value={value} onFocus={(e) => e.target.select()} />
      <Button
        variant="secondary"
        className="shrink-0 px-3 sm:px-4"
        aria-label="Kopieren"
        icon={<Copy className="h-4 w-4" />}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast(label, 'success');
        }}
      >
        <span className="hidden sm:inline">Kopieren</span>
      </Button>
    </div>
  );
}

interface Diagnostics {
  version: string;
  schema: string;
  driver: string;
  php: string;
  counts: Record<string, number>;
  cronLastRun: number;
  jobsLastRun: number;
  mailLastFetch: number;
  mailSender: string | null;
  people: {
    id: string;
    name: string;
    email: string;
    role: string;
    deleted: number;
    lastSeen: number | null;
    pushDevices: number;
    pushLastOk: number | null;
    pushError?: string | null;
    clubAccess?: boolean;
    mailPush: boolean;
    mailboxes: string[];
    invitePending: boolean;
  }[];
  log?: string[];
}

function MaintenanceSection() {
  const sync = useStore((s) => s.sync);
  const [d, setD] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const load = () => api<Diagnostics>('GET', '/admin/maintenance').then(setD).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  async function repair() {
    setBusy(true);
    try {
      const r = await api<Diagnostics>('POST', '/admin/maintenance');
      setD(r);
      toast('Datenbank aktualisiert', 'success');
      await sync({ full: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    try {
      await api('POST', `/admin/users/${id}/restore`);
      toast('Wiederhergestellt', 'success');
      await load();
      await sync({ full: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const active = d?.people.filter((p) => !p.deleted) ?? [];
  const deleted = d?.people.filter((p) => p.deleted) ?? [];
  return (
    <Section
      title="Wartung"
      description="Wenn etwas hakt – z. B. jemand keine Mails oder Push-Nachrichten bekommt: „Datenbank aktualisieren“ bringt alles auf den neuesten Stand, löst Hänger und lässt alle Geräte ihre Daten komplett neu laden. Es geht nichts verloren."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<RefreshCw className={cx('h-4 w-4', busy && 'animate-spin')} />} loading={busy} onClick={repair}>
          Datenbank aktualisieren
        </Button>
        {d && (
          <span className="text-[13px] text-ink-3">
            Version {d.version} · {d.driver === 'mysql' ? 'MySQL' : 'SQLite'} · PHP {d.php}
          </span>
        )}
      </div>
      {d?.log && (
        <ul className="mt-3 space-y-1 rounded-xl bg-good/10 p-3 text-[13px] text-ink-2">
          {d.log.map((l) => (
            <li key={l} className="flex gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" /> {l}
            </li>
          ))}
        </ul>
      )}
      {d && (
        <>
          <p className="mt-4 text-[13px] text-ink-2">
            Mails zuletzt abgerufen: <b>{d.mailLastFetch ? relative(d.mailLastFetch, now) : 'noch nie'}</b> · Cronjob: <b>{d.cronLastRun ? relative(d.cronLastRun, now) : 'noch nie gelaufen'}</b> · Einladungen gehen über:{' '}
            <b>{d.mailSender ?? 'kein Team-Postfach'}</b>
          </p>
          <ul className="mt-3 divide-y divide-line/70">
            {active.map((p) => {
              const problems = [
                p.pushDevices === 0 && 'Push nicht aktiviert',
                !p.mailPush && 'Mail-Push ausgeschaltet',
                !p.lastSeen && (p.invitePending ? 'Einladung noch nicht angenommen' : 'noch nie angemeldet'),
              ].filter(Boolean) as string[];
              return (
                <li key={p.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[15px] font-medium text-ink">{p.name}</span>
                    <span className="text-[13px] text-ink-3">{p.lastSeen ? `zuletzt online ${relative(p.lastSeen, now)}` : 'noch nie online'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip tone={p.pushDevices ? 'good' : 'warn'}>
                      {p.pushDevices} Push-Gerät{p.pushDevices === 1 ? '' : 'e'}
                      {p.pushLastOk ? ` · zuletzt ${relative(p.pushLastOk, now)}` : ''}
                    </Chip>
                    {p.pushError && (
                      <Chip tone="bad" icon={<CircleAlert className="h-3 w-3" />}>
                        Push-Fehler: {p.pushError}
                      </Chip>
                    )}
                    <Chip>
                      {p.mailboxes.length} Postf{p.mailboxes.length === 1 ? 'ach' : 'ächer'} sichtbar
                    </Chip>
                    {p.clubAccess && <Chip icon={<Crown className="h-3 w-3" />}>Club</Chip>}
                    {problems.map((x) => (
                      <Chip key={x} tone="warn" icon={<CircleAlert className="h-3 w-3" />}>
                        {x}
                      </Chip>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {deleted.length > 0 && (
            <>
              <p className="eyebrow mb-1 mt-5">Entfernte Personen</p>
              <ul className="divide-y divide-line/70">
                {deleted.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[14px] text-ink-2">{p.name}</div>
                      <div className="truncate text-[12px] text-ink-3">{p.email}</div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => restore(p.id)}>
                      Wiederherstellen
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-[12px] text-ink-3">
            Push kommt nur an, wenn die Person die App über das Icon auf dem Home-Bildschirm geöffnet und unter Einstellungen → Benachrichtigungen „Aktivieren“ getippt hat.
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------- Members Club ----------------

function ClubSection() {
  const navigate = useNavigate();
  const sync = useStore((s) => s.sync);
  const now = useNow();
  const [data, setData] = useState<ClubSettings | null>(null);
  const [form, setForm] = useState({ url: '', key: '' });
  const [busy, setBusy] = useState<'' | 'save' | 'ping' | 'open'>('');
  useEffect(() => {
    api<ClubSettings>('GET', '/admin/club')
      .then((d) => {
        setData(d);
        setForm({ url: d.club.url, key: '' });
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    // Link „Club verbinden“ führt hierher (#club)
    if (data && window.location.hash === '#club') document.getElementById('club')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data]);

  async function call(kind: 'save' | 'ping', fn: () => Promise<ClubSettings>) {
    setBusy(kind);
    try {
      const d = await fn();
      setData(d);
      setForm({ url: d.club.url, key: '' });
      if (d.test) toast(d.test.message, d.test.ok ? 'success' : 'error');
      void sync();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  if (!data) return null;
  const c = data.club;
  return (
    <Section
      id="club"
      title="Members Club"
      description="Verbindung zur Club-App (Kunden-App). Damit zeigt die Team-App die Club-Statistik, ihr könnt Nachrichten an Mitglieder schicken und den Club-Admin mit einem Klick öffnen. Adresse und Schlüssel stehen im Club-Admin unter Einstellungen → System → „Verbindung zur Team-App“."
    >
      {c.detected && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-good/10 p-3 text-[13px] text-good">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Gemeinsame Datenbank erkannt: {c.detected.url || 'Adresse fehlt'} · Schlüssel {c.detected.hasKey ? 'gefunden' : 'fehlt'}. Eigene Angaben unten haben Vorrang.
          </span>
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void call('save', () => api<ClubSettings>('PUT', '/admin/club', { url: form.url, ...(form.key.trim() ? { key: form.key } : {}) }));
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="club-url">
              Adresse des Clubs {c.urlSource === 'auto' && <span className="text-ink-3">(automatisch)</span>}
            </label>
            <input id="club-url" className="field" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={c.detected?.url || 'https://app.perfumecloud.de'} inputMode="url" />
          </div>
          <div>
            <label className="label" htmlFor="club-key">
              Schlüssel {c.hasKey ? <span className="text-ink-3">(gespeichert)</span> : c.keySource === 'auto' ? <span className="text-ink-3">(automatisch)</span> : null}
            </label>
            <input
              id="club-key"
              className="field"
              type="password"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              placeholder={c.hasKey ? '•••••••• unverändert' : c.keySource === 'auto' ? 'aus der gemeinsamen Datenbank' : ''}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" icon={<Crown className="h-4 w-4" />} loading={busy === 'save'}>
            Speichern & testen
          </Button>
          {c.configured && (
            <>
              <Button type="button" variant="secondary" loading={busy === 'ping'} onClick={() => call('ping', () => api<ClubSettings>('POST', '/admin/club/ping'))}>
                Verbindung testen
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate('/club')}>
                Zur Club-Seite
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={<ExternalLink className="h-4 w-4" />}
                loading={busy === 'open'}
                onClick={async () => {
                  setBusy('open');
                  await openClubAdmin();
                  setBusy('');
                }}
              >
                Club-Admin
              </Button>
            </>
          )}
          {c.hasKey && (
            <Button type="button" variant="ghost" onClick={() => call('save', () => api<ClubSettings>('PUT', '/admin/club', { clear_key: true }))}>
              Schlüssel löschen
            </Button>
          )}
        </div>
        <StatusLine status={data.test ?? c.status} />
        <p className="text-[12px] text-ink-3">
          Der Schlüssel bleibt auf dem Server – der Browser bekommt ihn nie zu sehen. Zugang zum Club haben Admins und alle mit „Club-Zugang“ (Einstellungen → Team).
          {c.status?.at ? ` Zuletzt geprüft: ${relative(c.status.at, now)}` : ''}
        </p>
      </form>
    </Section>
  );
}

// ---------------- Kalender abonnieren ----------------

function CalendarFeedSection() {
  const [active, setActive] = useState<boolean | null>(null);
  const [links, setLinks] = useState<{ url: string; webcal: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ active: boolean }>('GET', '/kalender/abo').then((r) => setActive(r.active)).catch(() => setActive(false));
  }, []);

  async function create() {
    if (active && !confirm('Neuen Link erstellen? Der alte Link funktioniert danach nicht mehr – das Abo muss neu eingerichtet werden.')) return;
    setBusy(true);
    try {
      const r = await api<{ url: string; webcal: string }>('POST', '/kalender/abo');
      setLinks(r);
      setActive(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Kalender abonnieren"
      description="Zeigt den Team-Kalender in der Kalender-App deines iPhones, Macs oder in Outlook – inklusive der Kalender-Widgets dort. Änderungen aus der Team-App kommen automatisch an (je nach Gerät alle 15–60 Minuten)."
    >
      {active === null ? (
        <Spinner />
      ) : links ? (
        <div className="space-y-3">
          <a href={links.webcal} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-accent-ink sm:w-auto sm:px-5">
            <CalendarDays className="h-4 w-4" /> Im Kalender abonnieren
          </a>
          <div className="flex gap-2">
            <input className="field font-mono text-[13px]" readOnly value={links.url} onFocus={(e) => e.target.select()} aria-label="Abo-Link" />
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={async () => {
                await navigator.clipboard?.writeText(links.url).catch(() => undefined);
                toast('Link kopiert', 'success');
              }}
            >
              <span className="max-sm:hidden">Kopieren</span>
            </Button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
            <li>
              <b>iPhone/Mac:</b> auf <b>Im Kalender abonnieren</b> tippen und bestätigen. Klappt das nicht: Einstellungen → Apps → Kalender → Accounts → Account hinzufügen → Andere → <b>Kalenderabo hinzufügen</b> → Link einfügen.
            </li>
            <li>
              <b>Outlook/Windows:</b> Kalender → Kalender hinzufügen → <b>Aus dem Internet abonnieren</b> → Link einfügen.
            </li>
            <li>Danach erscheint „Perfume Cloud Team“ als eigener Kalender – auch im Kalender-Widget auf dem Home-Bildschirm.</li>
          </ol>
          <p className="text-[12px] text-ink-3">Der Link ist persönlich und nur lesend. Gib ihn nicht weiter.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<CalendarDays className="h-4 w-4" />} loading={busy} onClick={create}>
            {active ? 'Neuen Abo-Link erstellen' : 'Abo-Link erstellen'}
          </Button>
          {active && (
            <Button
              variant="ghost"
              onClick={async () => {
                await api('DELETE', '/kalender/abo');
                setActive(false);
                toast('Abo-Link gesperrt', 'success');
              }}
            >
              Sperren
            </Button>
          )}
          {active && <span className="text-[13px] text-ink-3">Ein Abo-Link ist aktiv.</span>}
        </div>
      )}
    </Section>
  );
}

// ---------------- Mein Postfach ----------------

function MyMailboxSection() {
  const me = useStore((s) => s.me)!;
  const sync = useStore((s) => s.sync);
  const navigate = useNavigate();
  const [data, setData] = useState<MyMailbox | null>(null);
  const [form, setForm] = useState({ email: '', host: '', port: 993, user: '', password: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'remove' | 'check'>('');
  const [test, setTest] = useState<MailCheck | null>(null);

  async function check() {
    setBusy('check');
    try {
      const r = await api<MailCheck>('POST', '/me/mailbox/check');
      setTest(r);
      toast(r.ok ? 'Abruf und Versand funktionieren' : 'Es hakt – Details unten', r.ok ? 'success' : 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  function apply(r: MyMailbox) {
    setData(r);
    setForm({ email: r.mailbox?.email ?? '', host: r.mailbox?.host || r.suggestedHost || '', port: r.mailbox?.port ?? 993, user: r.mailbox?.user ?? '', password: '' });
  }
  useEffect(() => {
    api<MyMailbox>('GET', '/me/mailbox').then(apply).catch(() => undefined);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    try {
      const r = await api<MyMailbox>('PUT', '/me/mailbox', {
        email: form.email,
        host: form.host,
        port: form.port,
        security: form.port === 143 ? 'starttls' : 'ssl',
        user: form.user.trim() || form.email,
        password: form.password,
      });
      apply(r);
      setTest(r.test ?? null);
      if (r.test?.ok) {
        setEditing(false);
        toast('Postfach verbunden – die Mails erscheinen gleich im Postfach', 'success');
        window.setTimeout(() => void sync(), 4000);
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!confirm('Dein Postfach aus der App entfernen? Die Mails verschwinden aus der App – im Postfach selbst bleibt alles, wie es ist.')) return;
    setBusy('remove');
    try {
      apply(await api<MyMailbox>('DELETE', '/me/mailbox'));
      setTest(null);
      setEditing(false);
      toast('Postfach entfernt', 'success');
      void sync();
    } finally {
      setBusy('');
    }
  }

  const mb = data?.mailbox;
  const first = me.name.trim().split(/\s+/)[0]?.toLowerCase() || 'vorname';
  return (
    <Section
      title="Mein Postfach"
      description={
        <span className="inline-flex items-start gap-1.5">
          <Lock className="mt-[3px] h-3.5 w-3.5 shrink-0" />
          <span>Dein eigenes Firmen-Postfach. Nur du siehst diese Mails in der App, und nur du bekommst die Push-Nachrichten dazu. Das Passwort wird verschlüsselt gespeichert.</span>
        </span>
      }
    >
      {!data ? (
        <Spinner />
      ) : mb && !editing ? (
        <div className="rounded-2xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink">
              <Mail className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">{mb.email}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="soft" onClick={() => navigate(`/postfach?box=${encodeURIComponent(mb.email)}`)}>
                Öffnen
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Ändern
              </Button>
              <Button size="sm" variant="secondary" icon={<Stethoscope className="h-3.5 w-3.5" />} loading={busy === 'check'} onClick={check}>
                Prüfen
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'remove'} onClick={remove}>
                Entfernen
              </Button>
            </div>
          </div>
          <StatusLine status={test ?? mb.status} />
          <CheckSteps check={test} />
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <label className="label" htmlFor="my-mail">E-Mail-Adresse</label>
              <input
                id="my-mail"
                className="field"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={`${first}@perfumecloud.de`}
                autoComplete="off"
                required
              />
            </div>
            <div className="sm:col-span-3">
              <label className="label" htmlFor="my-pw">
                Passwort des Postfachs {mb?.hasPassword && <span className="text-ink-3">(gespeichert)</span>}
              </label>
              <input
                id="my-pw"
                className="field"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={mb?.hasPassword ? '•••••••• unverändert' : ''}
                required={!mb?.hasPassword}
                autoComplete="new-password"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="label" htmlFor="my-host">IMAP-Server</label>
              <input id="my-host" className="field" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="z. B. mxf938.netcup.net" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="my-port">Port</label>
              <input id="my-port" className="field" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 993 })} />
            </div>
            <div className="sm:col-span-6">
              <label className="label" htmlFor="my-user">
                Benutzername <span className="text-ink-3">(leer = E-Mail-Adresse)</span>
              </label>
              <input id="my-user" className="field" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder={form.email || 'E-Mail-Adresse'} autoComplete="off" />
            </div>
          </div>
          <StatusLine status={test} />
          <CheckSteps check={test && !test.ok ? test : null} />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" icon={<Mail className="h-4 w-4" />} loading={busy === 'save'}>
              Speichern & testen
            </Button>
            {mb && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Abbrechen
              </Button>
            )}
          </div>
          <p className="text-[12px] text-ink-3">Server und Passwort stehen bei netcup unter E-Mail → deine Adresse. Die App liest nur – sie markiert nichts als gelesen und löscht nichts.</p>
        </form>
      )}
    </Section>
  );
}

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

/** Ergebnis der Verbindungsprüfung Schritt für Schritt – mit Hinweis, was zu tun ist. */
function CheckSteps({ check }: { check?: MailCheck | null }) {
  if (!check?.steps?.length) return null;
  return (
    <ol className="mt-3 space-y-1.5 rounded-xl bg-surface-2/70 p-3" aria-label="Verbindungsprüfung">
      {check.steps.map((st, i) => (
        <li key={i} className="text-[13px]">
          <div className="flex items-start gap-2">
            {st.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
            <span className="min-w-0 break-words">
              <span className="font-medium text-ink">{st.label}</span> <span className="text-ink-2">– {st.detail}</span>
            </span>
          </div>
          {st.hint && <p className="ml-6 mt-1 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[13px] leading-relaxed text-warn">{st.hint}</p>}
        </li>
      ))}
    </ol>
  );
}

function IntegrationsPanel() {
  const [data, setData] = useState<Integrations | null>(null);
  const sync = useStore((s) => s.sync);
  const usersMap = useStore((s) => s.users);
  const now = useNow();
  const [shop, setShop] = useState({ shop: '', client_id: '', client_secret: '' });
  const [boxes, setBoxes] = useState<MailboxConfig[]>(DEFAULT_MAILBOXES);
  const [busy, setBusy] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(5);
  const [checks, setChecks] = useState<Record<string, MailCheck>>({});
  const [smtp, setSmtp] = useState({ host: '', port: 0 });

  useEffect(() => {
    api<Integrations>('GET', '/admin/integrations')
      .then((d) => {
        setData(d);
        setSmtp({ host: d.mail?.smtpHost ?? '', port: d.mail?.smtpPort ?? 0 });
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
      setChecks({});
      setBoxes(d.mailboxes.map((m) => ({ ...m, password: '' })));
      const failed = Object.values(d.tests ?? {}).filter((t) => !t.ok).length;
      toast(failed ? `${failed} Postfach konnte nicht verbunden werden` : 'Postfächer verbunden – Mails werden abgerufen', failed ? 'error' : 'success');
      void sync();
    });
  };

  const saveCalendar = (patch: Partial<Integrations['settings']>) =>
    void run('cal', async () => {
      setData(await api<Integrations>('PUT', '/admin/settings', patch));
      toast('Kalender aktualisiert', 'success');
      void sync();
    });

  const setBox = (i: number, patch: Partial<MailboxConfig>) => setBoxes(boxes.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const team = Object.values(usersMap).filter((u) => !u.deleted);

  /** Abruf und Versand prüfen – inkl. Testmail an das Postfach selbst. */
  const checkBox = (id: string) =>
    void run(`check:${id}`, async () => {
      const r = await api<MailCheck>('POST', `/admin/mailboxes/${id}/check`);
      setChecks((c) => ({ ...c, [id]: r }));
      toast(r.ok ? 'Abruf und Versand funktionieren – Testmail ist unterwegs' : 'Es hakt – Details beim Postfach', r.ok ? 'success' : 'error');
    });
  const senderBox = data.mailboxes.find((m) => m.email === data.mail?.sender);
  const cronLate = !data.cron.lastRun || now - data.cron.lastRun > 3 * 60000;

  return (
    <>
      <Section
        title="Shopify"
        description={
          <>
            Lesezugriff auf Bestellungen, Produkte und Lager über eine eigene App im <b>Shopify Dev Dashboard</b> (kostenlos). Benötigte Berechtigungen: <code className="rounded bg-surface-2 px-1">read_orders</code>,{' '}
            <code className="rounded bg-surface-2 px-1">read_products</code>, <code className="rounded bg-surface-2 px-1">read_inventory</code>. Für Kundeninfos und „Versenden“ zusätzlich{' '}
            <code className="rounded bg-surface-2 px-1">read_customers</code> und <code className="rounded bg-surface-2 px-1">write_merchant_managed_fulfillment_orders</code>, für den Probelauf im Members Club{' '}
            <code className="rounded bg-surface-2 px-1">write_orders</code>. Schritt-für-Schritt-Anleitung: siehe{' '}
            <b>docs/ANLEITUNG.md</b>.
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
            {data.shopify.configured && <span className="text-[13px] text-ink-3">Letzter Abgleich: {data.shopify.lastSync ? relative(data.shopify.lastSync, now) : 'noch nie'}</span>}
          </div>
          <StatusLine status={data.test ?? data.shopify.status} />
        </form>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <label className="text-[14px] text-ink-2" htmlFor="th">
            „Knapper Bestand“ ab
          </label>
          <input id="th" type="number" min={0} className="field w-24" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <span className="text-[14px] text-ink-2">Stück</span>
          <Button size="sm" variant="secondary" onClick={() => run('th', async () => setData(await api('PUT', '/admin/settings', { low_stock_threshold: threshold })))}>
            Übernehmen
          </Button>
        </div>
        {data.shopify.configured && <CustomerTest />}
      </Section>

      <Section
        title="Postfächer"
        description="Alle Konten an einem Ort: Team-Postfächer wie info@ und support@ und persönliche wie marius.heub@. Bei „Sichtbar für“ legst du fest, wer die Mails sieht und Push-Nachrichten dazu bekommt. Die Daten stehen bei netcup im Webhosting-Panel unter E-Mail. Die App liest nur – sie markiert nichts als gelesen und löscht nichts."
      >
        <form onSubmit={saveMail} className="space-y-5">
          {boxes.map((b, i) => (
            <div key={i} className="rounded-2xl border border-line p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <Mail className="h-4 w-4 text-accent" /> {b.email || 'Neues Postfach'}
                </div>
                <button type="button" className="text-[13px] text-ink-3 hover:text-bad" onClick={() => setBoxes(boxes.filter((_, j) => j !== i))}>
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
              <div className="mt-4">
                <span className="label">Sichtbar für</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setBox(i, { visible_to: [] })}
                    aria-pressed={b.visible_to.length === 0}
                    className={cx(
                      'flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors',
                      b.visible_to.length === 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    Alle im Team
                  </button>
                  {team.map((u) => {
                    const on = b.visible_to.includes(u.id);
                    return (
                      <button
                        type="button"
                        key={u.id}
                        aria-pressed={on}
                        onClick={() => setBox(i, { visible_to: on ? b.visible_to.filter((x) => x !== u.id) : [...b.visible_to, u.id] })}
                        className={cx(
                          'flex h-9 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] transition-colors',
                          on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
                        )}
                      >
                        <Avatar user={u} size={26} />
                        {u.name.split(' ')[0]}
                        {on && <Check className="h-3.5 w-3.5" />}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-3">
                  {b.visible_to.length ? (
                    <>
                      <Lock className="h-3.5 w-3.5" /> Nur sichtbar für {b.visible_to.map((id) => usersMap[id]?.name.split(' ')[0] ?? '?').join(', ')} – nur diese bekommen Mails und Push.
                    </>
                  ) : (
                    'Alle im Team sehen die Mails und bekommen Push.'
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <StatusLine status={(b.id && (checks[b.id] ?? data.tests?.[b.id])) || b.status} />
                {b.id && b.hasPassword && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    icon={<Stethoscope className="h-3.5 w-3.5" />}
                    loading={busy === `check:${b.id}`}
                    onClick={() => checkBox(b.id!)}
                  >
                    Verbindung prüfen
                  </Button>
                )}
              </div>
              <CheckSteps check={b.id ? (checks[b.id] ?? (data.tests?.[b.id] && !data.tests[b.id].ok ? data.tests[b.id] : null)) : null} />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" icon={<Mail className="h-4 w-4" />} loading={busy === 'mail'}>
              Speichern & testen
            </Button>
            <Button type="button" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setBoxes([...boxes, { email: '', host: boxes[0]?.host ?? '', port: 993, security: 'ssl', user: '', visible_to: [] }])}>
              Postfach hinzufügen
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title="Mails verschicken"
        description="Einladungen und Testmails gehen über euer Team-Postfach – mit denselben Zugangsdaten wie beim Abruf. Bei netcup ist der Server für den Versand derselbe wie für den Abruf (z. B. mxf9a2.netcup.net), Port 465 (SSL/TLS) oder 587 (STARTTLS)."
      >
        <p className="text-[14px] text-ink-2">
          Absender:{' '}
          <b className="text-ink">{data.mail?.sender ?? 'kein Team-Postfach mit Passwort – bitte oben info@ eintragen'}</b>
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label" htmlFor="smtp-host">
              Server für den Versand <span className="text-ink-3">(leer = wie beim Abruf)</span>
            </label>
            <input id="smtp-host" className="field" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder={senderBox?.host || 'wie beim Abruf'} />
          </div>
          <div>
            <span className="label">Port</span>
            <Segmented
              value={String(smtp.port)}
              onChange={(v) => setSmtp({ ...smtp, port: Number(v) })}
              options={[
                { value: '0', label: 'Automatisch' },
                { value: '465', label: '465' },
                { value: '587', label: '587' },
              ]}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'smtp'}
            onClick={() =>
              run('smtp', async () => {
                const d = await api<Integrations>('PUT', '/admin/settings', { smtp_host: smtp.host, smtp_port: smtp.port });
                setData(d);
                setSmtp({ host: d.mail?.smtpHost ?? '', port: d.mail?.smtpPort ?? 0 });
                toast('Gespeichert', 'success');
              })
            }
          >
            Übernehmen
          </Button>
          {senderBox?.id && (
            <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={busy === `check:${senderBox.id}`} onClick={() => checkBox(senderBox.id!)}>
              Testmail an {senderBox.email}
            </Button>
          )}
        </div>
        {senderBox?.id && <CheckSteps check={checks[senderBox.id]} />}
        {data.mail?.lastError && (
          <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-3">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Letzter Fehler beim Abruf ({data.mail.lastError.mailbox}, {relative(data.mail.lastError.at, now)}): {data.mail.lastError.message}
            </span>
          </p>
        )}
        <p className="mt-3 text-[12px] text-ink-3">Automatisch probiert erst 465, dann 587, und merkt sich den Port, der klappt. Der Benutzername muss die E-Mail-Adresse des Postfachs sein – netcup lehnt sonst den Absender ab.</p>
      </Section>

      <ClubSection />
      <InstagramSection initial={data.instagram} />

      <Section
        title="Kalender: Feiertage & Aktionstage"
        description="Gesetzliche Feiertage und wichtige Tage für den Shop (Valentinstag, Muttertag, Black Friday, Cyber Monday, Advent …) stehen automatisch im Kalender – jedes Jahr neu berechnet, nichts muss eingetragen werden. Wähle euer Bundesland, damit auch die regionalen Feiertage dabei sind."
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="holiday-state">
              Bundesland
            </label>
            <select
              id="holiday-state"
              className="field"
              value={data.settings.holiday_state}
              disabled={busy === 'cal'}
              onChange={(e) => saveCalendar({ holiday_state: e.target.value })}
            >
              <option value="">Nur bundesweite Feiertage</option>
              {STATES.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-medium text-ink">Feiertage anzeigen</p>
              <p className="text-[13px] text-ink-3">Neujahr, Ostern, Weihnachten … in Rot</p>
            </div>
            <Toggle label="Feiertage anzeigen" checked={data.settings.holidays_on} onChange={(v) => saveCalendar({ holidays_on: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-medium text-ink">Aktionstage für den Shop</p>
              <p className="text-[13px] text-ink-3">Valentinstag, Muttertag, Black Friday, Cyber Monday …</p>
            </div>
            <Toggle label="Aktionstage anzeigen" checked={data.settings.shop_days_on} onChange={(v) => saveCalendar({ shop_days_on: v })} />
          </div>
        </div>
      </Section>

      <Section
        title="Sofort-Abruf & Cronjob"
        description="Neue Mails meldet die App nach wenigen Sekunden: Ein Hintergrundprozess hält die Verbindung zu den Postfächern offen, und der Mailserver meldet jede neue Mail sofort. netcup startet ihn über eine geplante Aufgabe jede Minute bzw. hält ihn am Laufen. Bestellungen kommen alle 20 Sekunden dazu."
      >
        <LiveStatusView live={data.cron.live} now={now} />
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li>
            In Plesk: <b>Geplante Aufgaben</b> → <b>Aufgabe hinzufügen</b> → <b>PHP-Skript ausführen</b>.
          </li>
          <li>Diesen Pfad als Skript eintragen (PHP 8.3), Ausführen: Cron-Stil <code className="rounded bg-surface-2 px-1">* * * * *</code> (jede Minute), Benachrichtigung: keine.</li>
        </ol>
        <CopyRow value={data.cron.script} label="Skript kopiert" />
        <p className="mt-4 text-[13px] text-ink-3">
          Alternativ „URL abrufen“ mit dieser Adresse, ebenfalls jede Minute. Das klappt nur, wenn PHP auf eurem Hosting als FPM läuft; sonst holt die App Mails dabei einmal pro Minute.
        </p>
        <CopyRow value={data.cron.url} label="Adresse kopiert" />
        {cronLate && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Der Cronjob läuft nicht jede Minute{data.cron.lastRun ? ` (zuletzt ${relative(data.cron.lastRun, now)})` : ''}. Ohne ihn werden Mails und Bestellungen nur abgerufen, solange jemand die App offen hat – und Push-Nachrichten kommen verspätet.
            </span>
          </p>
        )}
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

      <MaintenanceSection />
    </>
  );
}
