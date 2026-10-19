import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  DatabaseBackup,
  Download,
  Eye,
  FileUp,
  KeyRound,
  Mail,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Section } from '../components/section';
import { CustomerPanel } from '../components/customer';
import { clearTemplatesCache } from '../components/mail';
import { WeeklyPreview } from '../components/weekly';
import { SignatureImageField } from '../components/signature-image';
import { Button, Chip, cx, IconButton, Sheet, Spinner, Toggle } from '../components/ui';
import { api, ApiError, uuid } from '../lib/api';
import { useStore } from '../lib/store';
import type { AiSettings, BackupStatus, BackupSummary, Prefs, ReplyTemplate, ReportsAdmin, ShippingSettings, TemplatesResponse, WeeklyReport } from '../lib/types';
import { dateTime, relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

const CARRIERS = ['DHL', 'Deutsche Post (DE)', 'Hermes', 'DPD', 'GLS', 'UPS', 'DHL Express'];

// Beispielwerte für die Vorschau eines Textbausteins
const SAMPLE: Record<string, string> = {
  vorname: 'Anna',
  name: 'Anna Beispiel',
  bestellnummer: '#1042',
  versandstatus: 'unterwegs',
  versanddienst: 'DHL',
  sendungsnummer: '00340434161094042557',
  sendungslink: 'https://www.dhl.de/…?piececode=00340434161094042557',
  artikel: 'Ambre Nuit (50 ml)',
  punkte: '320',
  stufe: 'Silber',
};

const mb = (bytes: number) =>
  bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast((e as Error).message, 'error');
    return undefined;
  }
}

// ---------------- Allgemein: Signatur & Wochenrückblick per Mail ----------------

export function SignatureSection({ prefs, onPrefs }: { prefs: Prefs | null; onPrefs: (p: Partial<Prefs>) => Promise<boolean> }) {
  const me = useStore((s) => s.me)!;
  const fallback = `Viele Grüße\n${me.name.split(' ')[0]}`;
  const [sig, setSig] = useState(prefs?.signature ?? '');
  useEffect(() => setSig(prefs?.signature ?? ''), [prefs?.signature]);
  const changed = (prefs?.signature ?? '') !== sig;
  return (
    <Section
      title="Signatur"
      description="Steht unter jeder Mail, die du aus der App schickst – mit Text und auf Wunsch einem Bild (z. B. Logo oder Unterschrift). Leer lassen für den Standard."
    >
      <textarea className="field min-h-[96px] leading-relaxed" placeholder={fallback} value={sig} onChange={(e) => setSig(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!changed}
          onClick={async () => {
            if (await onPrefs({ signature: sig.trim() || null })) toast('Signatur gespeichert', 'success');
          }}
        >
          Speichern
        </Button>
        <span className="text-[12px] text-ink-3">Bei info@ und support@ folgt darunter die Fußzeile des Teams.</span>
      </div>
      <div className="mt-4">
        <SignatureImageField endpoint="/me/signature" label="Bild unter deiner Signatur" />
      </div>
      {prefs && (
        <label className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
          <span>
            <span className="block text-[15px] font-medium text-ink">Wochenrückblick auch per Mail</span>
            <span className="block text-[13px] text-ink-3">Freitags zusätzlich an {me.email} – als Push kommt er ohnehin (Benachrichtigungen).</span>
          </span>
          <Toggle label="Wochenrückblick per Mail" checked={!!prefs.weeklyMail} onChange={(v) => void onPrefs({ weeklyMail: v })} />
        </label>
      )}
    </Section>
  );
}

// ---------------- Vorlagen (Admins) ----------------

export function TemplatesPanel() {
  const me = useStore((s) => s.me)!;
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [editing, setEditing] = useState<ReplyTemplate | null>(null);
  const [mail, setMail] = useState({ footer: '', from_name: '' });
  const [busy, setBusy] = useState(false);
  const [footerImage, setFooterImage] = useState<string | null>(null);

  useEffect(() => {
    void run(async () => {
      const d = await api<TemplatesResponse>('GET', '/templates');
      setData(d);
      setMail({ footer: d.footer, from_name: d.fromName });
    });
  }, []);

  const update = (templates: ReplyTemplate[]) => {
    clearTemplatesCache();
    setData((d) => (d ? { ...d, templates } : d));
  };

  async function move(t: ReplyTemplate, dir: -1 | 1) {
    if (!data) return;
    const list = [...data.templates];
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update(list);
    // Reihenfolge neu durchnummerieren (nur geänderte speichern)
    for (const [k, x] of list.entries()) {
      if (x.position !== k) {
        const r = await run(() => api<{ templates: ReplyTemplate[] }>('PUT', `/templates/${x.id}`, { title: x.title, body: x.body, position: k }));
        if (r) update(r.templates);
      }
    }
  }

  if (!data) return <Spinner />;
  const signature = (useStore.getState().prefs?.signature ?? '').trim() || `Viele Grüße\n${me.name.split(' ')[0]}`;
  return (
    <>
      <Section
        title="Textbausteine"
        description="Fertige Antworten zum Antippen beim Beantworten einer Mail. Platzhalter wie {vorname} oder {sendungslink} füllt die App automatisch aus Shopify und dem Club."
      >
        <ul className="divide-y divide-line/70">
          {data.templates.map((t, i) => (
            <li key={t.id} className="flex items-start gap-2 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(t)}>
                <div className="text-[15px] font-medium text-ink">{t.title}</div>
                <div className="line-clamp-2 text-[13px] text-ink-3">{t.body}</div>
              </button>
              <IconButton label="Nach oben" className="h-8 w-8" disabled={i === 0} onClick={() => void move(t, -1)}>
                <ArrowUp className="h-4 w-4" />
              </IconButton>
              <IconButton label="Nach unten" className="h-8 w-8" disabled={i === data.templates.length - 1} onClick={() => void move(t, 1)}>
                <ArrowDown className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button className="mt-3" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ id: uuid(), title: '', body: 'Hallo {vorname},\n\n', position: data.templates.length, updated_at: 0 })}>
          Neuer Textbaustein
        </Button>
      </Section>

      <Section
        title="Absender & Fußzeile"
        description="Gilt für Mails aus info@ und support@ – und für die Mails des Members Clubs. Aus dem eigenen Postfach steht dein Name als Absender und keine Fußzeile."
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="fromname">
              Absendername
            </label>
            <input id="fromname" className="field" value={mail.from_name} placeholder="Perfume Cloud" onChange={(e) => setMail({ ...mail, from_name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="footer">
              Fußzeile
            </label>
            <textarea id="footer" className="field min-h-[96px] leading-relaxed" value={mail.footer} onChange={(e) => setMail({ ...mail, footer: e.target.value })} />
          </div>
          <SignatureImageField endpoint="/admin/mail-signature" label="Logo unter der Fußzeile" onChange={(v) => setFooterImage(v.image)} />
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await run(() => api<{ footer: string; fromName: string }>('PUT', '/admin/mail-settings', mail));
              setBusy(false);
              if (r) {
                clearTemplatesCache();
                setMail({ footer: r.footer, from_name: r.fromName });
                toast('Gespeichert', 'success');
              }
            }}
          >
            Speichern
          </Button>
        </div>
        <div className="mt-5 rounded-2xl bg-surface-2 p-4">
          <p className="eyebrow mb-2">So endet eine Antwort von dir</p>
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">
            … Text der Antwort …{'\n\n'}
            {signature}
            {mail.footer.trim() ? `\n\n${mail.footer.trim()}` : ''}
          </p>
          {footerImage && <img src={footerImage} alt="" className="mt-2 max-h-16 max-w-[220px] object-contain object-left" />}
        </div>
      </Section>

      <AiSection />

      <TemplateSheet
        template={editing}
        placeholders={data.placeholders}
        isNew={!!editing && !data.templates.some((t) => t.id === editing.id)}
        onClose={() => setEditing(null)}
        onSaved={(list) => {
          update(list);
          setEditing(null);
        }}
      />
    </>
  );
}

// ---------------- KI-Entwürfe ----------------

function AiSection() {
  const [data, setData] = useState<AiSettings | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void run(async () => setData(await api<AiSettings>('GET', '/admin/ai')));
  }, []);

  async function save(patch: { key?: string; model?: string }, done?: string) {
    setBusy(true);
    const r = await run(() => api<AiSettings>('PUT', '/admin/ai', patch));
    setBusy(false);
    if (r) {
      setData(r);
      setKey('');
      clearTemplatesCache();
      if (done) toast(done, 'success');
    }
  }

  if (!data) return null;
  return (
    <Section
      title="KI-Entwürfe"
      description="Beim Antworten schreibt Claude (von Anthropic) auf Knopfdruck einen Entwurf – mit Bestellung, Versand und Club-Punkten. Verschickt wird nichts, bevor ihr den Text prüft und auf Senden tippt."
    >
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-[14px]">
          {data.configured ? <CircleCheck className="h-4 w-4 text-good" aria-hidden /> : <Sparkles className="h-4 w-4 text-ink-3" aria-hidden />}
          {data.configured ? 'Eingerichtet – der Knopf „KI-Entwurf“ erscheint beim Beantworten.' : 'Noch aus. Zum Einschalten einen API-Schlüssel eintragen.'}
        </p>
        <div>
          <label className="label" htmlFor="ai-key">
            {data.configured ? 'Neuer API-Schlüssel (leer lassen, um ihn zu behalten)' : 'API-Schlüssel'}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="ai-key" className="field" type="password" autoComplete="off" value={key} placeholder="sk-ant-…" onChange={(e) => setKey(e.target.value)} />
            <Button className="shrink-0" variant="secondary" icon={<KeyRound className="h-4 w-4" />} loading={busy} disabled={!key.trim()} onClick={() => void save({ key }, 'Schlüssel gespeichert')}>
              Speichern
            </Button>
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">
            Den Schlüssel gibt es unter console.anthropic.com → API Keys. Er wird verschlüsselt gespeichert und nie wieder angezeigt. Bezahlt wird je Entwurf (wenige Cent), am besten mit Ausgabenlimit im Anthropic-Konto.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="ai-model">
            Modell
          </label>
          <select id="ai-model" className="field" value={data.model} disabled={busy} onChange={(e) => void save({ model: e.target.value }, 'Modell gespeichert')}>
            {Object.entries(data.models).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[13px] text-ink-3">
          Diesen Monat: {data.month.drafts} {data.month.drafts === 1 ? 'Entwurf' : 'Entwürfe'}
          {data.last && !data.last.ok && data.last.message ? ` · Zuletzt: ${data.last.message}` : ''}
        </p>
        <p className="flex gap-2 rounded-xl bg-warn/10 p-2.5 text-[13px] text-warn">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Datenschutz: Für einen Entwurf gehen Text der Mail, Vorname, Bestellungen und Club-Stand an Anthropic. Bitte in der Datenschutzerklärung nennen und den Auftragsverarbeitungsvertrag (DPA) von Anthropic annehmen.
          </span>
        </p>
        {data.configured && (
          <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={busy} onClick={() => window.confirm('KI-Entwürfe ausschalten und den Schlüssel löschen?') && void save({ key: '' }, 'Ausgeschaltet')}>
            Ausschalten
          </Button>
        )}
      </div>
    </Section>
  );
}

function TemplateSheet({
  template,
  placeholders,
  isNew,
  onClose,
  onSaved,
}: {
  template: ReplyTemplate | null;
  placeholders: Record<string, string>;
  isNew: boolean;
  onClose: () => void;
  onSaved: (list: ReplyTemplate[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = useStore((s) => s.me)!;
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setTitle(template?.title ?? '');
    setBody(template?.body ?? '');
    setPreview(false);
  }, [template]);

  function insert(key: string) {
    const el = area.current;
    const pos = el ? el.selectionStart : body.length;
    setBody(body.slice(0, pos) + `{${key}}` + body.slice(pos));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + key.length + 2, pos + key.length + 2);
    });
  }

  const sample: Record<string, string> = { ...SAMPLE, meinvorname: me.name.split(' ')[0], meinname: me.name };
  const filled = body.replace(/\{([a-zäöü]+)\}/g, (m, k: string) => sample[k] ?? m);
  const unknown = [...body.matchAll(/\{([a-zäöü]+)\}/g)].map((m) => m[1]).filter((k) => !(k in placeholders));

  async function save() {
    setBusy(true);
    const r = await run(() => api<{ templates: ReplyTemplate[] }>('PUT', `/templates/${template!.id}`, { title, body, position: template!.position }));
    setBusy(false);
    if (r) {
      toast('Textbaustein gespeichert', 'success');
      onSaved(r.templates);
    }
  }
  async function remove() {
    if (!window.confirm(`„${title}“ löschen?`)) return;
    const r = await run(() => api<{ templates: ReplyTemplate[] }>('DELETE', `/templates/${template!.id}`));
    if (r) onSaved(r.templates);
  }

  return (
    <Sheet open={!!template} onClose={onClose} wide title={<span className="text-[17px] font-semibold text-ink">{isNew ? 'Neuer Textbaustein' : 'Textbaustein bearbeiten'}</span>}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="tpl-title">
            Name
          </label>
          <input id="tpl-title" className="field" value={title} placeholder="z. B. Wo ist meine Bestellung?" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label mb-0" htmlFor="tpl-body">
              Text
            </label>
            <button className="text-[13px] font-medium text-accent hover:underline" onClick={() => setPreview((v) => !v)}>
              {preview ? 'Bearbeiten' : 'Vorschau mit Beispieldaten'}
            </button>
          </div>
          {preview ? (
            <p className="min-h-[200px] whitespace-pre-wrap rounded-xl bg-surface-2 p-3.5 text-[14px] leading-relaxed text-ink">{filled}</p>
          ) : (
            <textarea ref={area} id="tpl-body" className="field min-h-[200px] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
          )}
          {unknown.length > 0 && (
            <p className="mt-2 flex gap-2 text-[13px] text-warn">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Unbekannte Platzhalter: {unknown.map((k) => `{${k}}`).join(', ')} – bleiben so stehen.
            </p>
          )}
        </div>
        <div>
          <p className="label">Platzhalter einfügen</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(placeholders).map(([k, label]) => (
              <button
                key={k}
                title={label}
                disabled={preview}
                onClick={() => insert(k)}
                className="inline-flex h-7 items-center rounded-full border border-line px-2.5 font-mono text-[12px] text-ink-2 hover:bg-surface-2 disabled:opacity-40"
              >
                {`{${k}}`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-3">Fehlt ein Wert (z. B. keine Sendungsnummer), lässt die App ihn weg und weist beim Antworten darauf hin.</p>
        </div>
        <div className="flex gap-2 pt-1">
          <Button className="flex-1" loading={busy} disabled={!title.trim() || !body.trim()} onClick={save}>
            Speichern
          </Button>
          {!isNew && (
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
              Löschen
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ---------------- Auswertungen (Admins): Adresse, Wochenrückblick, Datensicherung, Versand ----------------

export function ReportsPanel() {
  const [data, setData] = useState<ReportsAdmin | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<WeeklyReport | null>(null);
  const now = useNow();

  useEffect(() => {
    void run(async () => {
      const d = await api<ReportsAdmin>('GET', '/admin/reports');
      setData(d);
      setEmail(d.reports.email);
    });
  }, []);

  async function act<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    const r = await run(fn);
    setBusy(null);
    return r;
  }

  async function save(patch: Record<string, unknown>) {
    const d = await act('save', () => api<ReportsAdmin>('PUT', '/admin/reports', patch));
    if (d) {
      setData(d);
      setEmail(d.reports.email);
    }
    return d;
  }

  if (!data) return <Spinner />;
  const w = data.reports.weekly;
  const msg = (r: { sent: boolean; message: string } | undefined) => r && toast(r.message, r.sent ? 'success' : 'error');

  return (
    <>
      <Section title="Auswertungsadresse" description="Hierhin gehen der Wochenrückblick, die wöchentliche Datensicherung und künftige Auswertungen.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="field" type="email" value={email} placeholder="auswertung@perfumecloud.de" onChange={(e) => setEmail(e.target.value)} />
          <Button className="shrink-0" variant="secondary" loading={busy === 'save'} disabled={email === data.reports.email} onClick={() => void save({ email }).then((d) => d && toast('Gespeichert', 'success'))}>
            Speichern
          </Button>
          <Button className="shrink-0" variant="secondary" icon={<Send className="h-4 w-4" />} loading={busy === 'testmail'} onClick={async () => msg(await act('testmail', () => api<{ sent: boolean; message: string }>('POST', '/admin/reports/test-mail')))}>
            Testmail
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Leer speichern setzt auf auswertung@perfumecloud.de zurück. Das Postfach muss existieren – sonst kommt die Mail zurück.</p>
      </Section>

      <Section title="Wochenrückblick" description="Umsatz, Bestellungen, Top-Düfte, Versand, Antwortzeit auf Mails, Aufgaben und Club – kompakt zum Besprechen am Wochenende.">
        <div className="space-y-1 divide-y divide-line/70">
          <Row label="Automatisch verschicken" hint={w.on ? `Jeden ${data.reports.days[w.day - 1]} um ${w.hour} Uhr` : 'Aus – nur manuell'}>
            <Toggle label="Wochenrückblick automatisch" checked={w.on} onChange={(v) => void save({ weekly: { on: v } })} />
          </Row>
          {w.on && (
            <Row label="Wann?">
              <div className="flex gap-2">
                <select className="field w-auto py-2" aria-label="Wochentag" value={w.day} onChange={(e) => void save({ weekly: { day: Number(e.target.value) } })}>
                  {data.reports.days.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
                <select className="field w-auto py-2" aria-label="Uhrzeit" value={w.hour} onChange={(e) => void save({ weekly: { hour: Number(e.target.value) } })}>
                  {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={h}>
                      {h} Uhr
                    </option>
                  ))}
                </select>
              </div>
            </Row>
          )}
          <Row label="Per Mail an die Auswertungsadresse" hint={data.reports.email}>
            <Toggle label="Per Mail" checked={w.mail} onChange={(v) => void save({ weekly: { mail: v } })} />
          </Row>
          <Row label="Als Push ans Team" hint="Jede Person kann das unter Benachrichtigungen abschalten">
            <Toggle label="Als Push" checked={w.push} onChange={(v) => void save({ weekly: { push: v } })} />
          </Row>
        </div>
        {data.reports.lastWeekly && (
          <p className="mt-3 text-[13px] text-ink-3">
            Zuletzt verschickt {relative(data.reports.lastWeekly.at, now)} · {data.reports.lastWeekly.message}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Eye className="h-4 w-4" />} loading={busy === 'preview'} onClick={async () => setPreview((await act('preview', () => api<WeeklyReport>('GET', '/reports/weekly'))) ?? null)}>
            Vorschau
          </Button>
          <Button variant="secondary" icon={<Send className="h-4 w-4" />} loading={busy === 'me'} onClick={async () => msg(await act('me', () => api<{ sent: boolean; message: string }>('POST', '/reports/weekly/test')))}>
            Jetzt an mich senden
          </Button>
          <Button
            variant="ghost"
            icon={<Mail className="h-4 w-4" />}
            loading={busy === 'all'}
            onClick={async () => {
              if (!window.confirm(`Wochenrückblick jetzt an ${data.reports.email}${w.push ? ' und als Push ans Team' : ''} senden?`)) return;
              msg(await act('all', () => api<{ sent: boolean; message: string }>('POST', '/admin/reports/weekly/send')));
            }}
          >
            An Auswertungsadresse senden
          </Button>
        </div>
      </Section>

      <BackupSection status={data.backup} onStatus={(b) => setData({ ...data, backup: b })} />
      <ShippingSection value={data.shipping} onChange={(s) => setData({ ...data, shipping: s })} />

      <WeeklyPreview report={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-ink">{label}</div>
        {hint && <div className="text-[13px] text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// ---------------- Datensicherung ----------------

function BackupSection({ status, onStatus }: { status: BackupStatus; onStatus: (b: BackupStatus) => void }) {
  const [pw, setPw] = useState('');
  const [changePw, setChangePw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [restore, setRestore] = useState<BackupSummary | null>(null);
  const [upload, setUpload] = useState<{ file: File | null; password: string }>({ file: null, password: '' });
  const now = useNow();

  async function act<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    const r = await run(fn);
    setBusy(null);
    return r;
  }

  async function savePassword() {
    const r = await act('pw', () => api<{ backup: BackupStatus }>('PUT', '/admin/backup/password', { password: pw }));
    if (r) {
      onStatus(r.backup);
      setPw('');
      setChangePw(false);
      toast('Sicherungs-Passwort gespeichert – bitte auch im Passwort-Manager ablegen.', 'success');
    }
  }

  async function uploadFile() {
    if (!upload.file) return;
    await act('upload', async () => {
      const res = await fetch('/api/admin/backup/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-PC': '1', 'X-Backup-Password': encodeURIComponent(upload.password) },
        credentials: 'same-origin',
        body: upload.file,
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, d?.error ?? `Fehler ${res.status}`);
      setRestore(d as BackupSummary);
    });
  }

  const last = status.last;
  return (
    <Section
      title="Datensicherung"
      description="Jede Nacht eine verschlüsselte Sicherung aller Daten (Team-App und Club) auf dem Server – 14 Tage aufbewahrt. Die Wochen-Sicherung geht zusätzlich per Mail an die Auswertungsadresse und bleibt 8 Wochen."
    >
      {!status.hasPassword || changePw ? (
        <div className="rounded-2xl bg-warn/10 p-4">
          <p className="flex gap-2 text-[14px] text-warn">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            {status.hasPassword
              ? 'Neues Passwort gilt nur für neue Sicherungen. Ältere lassen sich weiter nur mit dem alten Passwort öffnen.'
              : 'Noch kein Sicherungs-Passwort – ohne Passwort wird nichts gesichert. Mindestens 10 Zeichen, im Passwort-Manager ablegen: Ohne es lässt sich keine Sicherung öffnen.'}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input className="field" type="password" autoComplete="new-password" placeholder="Sicherungs-Passwort" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button className="shrink-0" loading={busy === 'pw'} disabled={pw.length < 10} onClick={savePassword}>
              Passwort festlegen
            </Button>
            {changePw && (
              <Button className="shrink-0" variant="ghost" onClick={() => setChangePw(false)}>
                Abbrechen
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
          <div className="text-[14px]">
            {last ? (
              <span className={cx('flex items-center gap-2 font-medium', last.ok ? 'text-good' : 'text-bad')}>
                {last.ok ? <CircleCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                {last.ok ? `Letzte Sicherung ${relative(last.at, now)}` : `Letzte Sicherung fehlgeschlagen (${relative(last.at, now)})`}
              </span>
            ) : (
              <span className="text-ink-2">Noch keine Sicherung – die erste läuft heute Nacht ab 2 Uhr.</span>
            )}
            {last?.ok && last.size !== undefined && (
              <span className="mt-0.5 block text-[13px] text-ink-3">
                {last.name} · {mb(last.size)} · {last.rows?.toLocaleString('de-DE')} Einträge
              </span>
            )}
            {last && !last.ok && last.message && <span className="mt-0.5 block text-[13px] text-bad">{last.message}</span>}
            {status.lastMail && (
              <span className={cx('mt-0.5 block text-[13px]', status.lastMail.ok ? 'text-ink-3' : 'text-bad')}>
                Per Mail an {status.lastMail.to}: {status.lastMail.ok ? relative(status.lastMail.at, now) : status.lastMail.message}
              </span>
            )}
          </div>
          <button className="text-[13px] font-medium text-accent hover:underline" onClick={() => setChangePw(true)}>
            Passwort ändern
          </button>
        </div>
      )}

      {status.hasPassword && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            icon={<DatabaseBackup className="h-4 w-4" />}
            loading={busy === 'create'}
            onClick={async () => {
              const r = await act('create', () => api<{ created: { name: string; size: number; rows: number }; backup: BackupStatus }>('POST', '/admin/backup'));
              if (r) {
                onStatus(r.backup);
                toast(`Gesichert: ${r.created.name} (${mb(r.created.size)})`, 'success');
              }
            }}
          >
            Jetzt sichern
          </Button>
          <Button
            variant="secondary"
            icon={<ShieldCheck className="h-4 w-4" />}
            loading={busy === 'verify'}
            disabled={!status.files.length}
            onClick={async () => {
              const r = await act('verify', () => api<BackupSummary & { ok: boolean }>('POST', '/admin/backup/verify', {}));
              if (r) toast(`${r.name}: lässt sich öffnen · ${r.tables.length} Tabellen, ${r.tables.reduce((n, t) => n + t.rows, 0).toLocaleString('de-DE')} Einträge`, 'success');
            }}
          >
            Letzte prüfen
          </Button>
          <Button
            variant="secondary"
            icon={<Mail className="h-4 w-4" />}
            loading={busy === 'mail'}
            disabled={!status.files.length}
            onClick={async () => {
              const r = await act('mail', () => api<{ sent: boolean; message: string; backup: BackupStatus }>('POST', '/admin/backup/mail', {}));
              if (r) {
                onStatus(r.backup);
                toast(r.message, r.sent ? 'success' : 'error');
              }
            }}
          >
            Per Mail senden
          </Button>
        </div>
      )}

      {status.files.length > 0 && (
        <ul className="mt-5 divide-y divide-line/70 border-t border-line">
          {status.files.map((f) => (
            <li key={f.name} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate font-mono text-[13px] text-ink">
                  {f.name} {f.weekly && <Chip tone="accent">Woche</Chip>}
                </div>
                <div className="text-[12px] text-ink-3">
                  {dateTime(f.at)} · {mb(f.size)}
                </div>
              </div>
              <a href={`/api/admin/backup/download?name=${encodeURIComponent(f.name)}`} aria-label={`${f.name} herunterladen`} title="Herunterladen" className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2">
                <Download className="h-4 w-4" />
              </a>
              <IconButton
                label="Wiederherstellen"
                className="h-8 w-8"
                onClick={async () => {
                  const r = await act('preview', () => api<BackupSummary>('GET', `/admin/backup/preview?name=${encodeURIComponent(f.name)}`));
                  if (r) setRestore(r);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {status.hasPassword && <CloudCopy status={status} onStatus={onStatus} />}

      <details className="mt-4 rounded-2xl border border-line p-4">
        <summary className="cursor-pointer text-[14px] font-medium text-ink">Aus Datei wiederherstellen (z. B. aus der Mail)</summary>
        <div className="mt-3 space-y-2">
          <input type="file" accept=".pcbak,application/octet-stream" className="block w-full text-[14px] text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-ink" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} />
          <input className="field" type="password" autoComplete="off" placeholder="Passwort dieser Sicherung" value={upload.password} onChange={(e) => setUpload({ ...upload, password: e.target.value })} />
          <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} loading={busy === 'upload'} disabled={!upload.file || !upload.password} onClick={uploadFile}>
            Datei prüfen
          </Button>
          <p className="text-[12px] text-ink-3">Funktioniert auch auf einem neuen Server: Die Sicherung enthält alles, auch die verschlüsselten Zugangsdaten.</p>
        </div>
      </details>

      <RestoreSheet
        summary={restore}
        onClose={() => setRestore(null)}
        onDone={(b) => {
          onStatus(b);
          setRestore(null);
        }}
      />
    </Section>
  );
}

/** Kopie jeder Nacht-Sicherung in einen S3-kompatiblen Speicher außerhalb des Servers. */
function CloudCopy({ status, onStatus }: { status: BackupStatus; onStatus: (b: BackupStatus) => void }) {
  const s3 = status.s3;
  const [form, setForm] = useState({ endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, prefix: s3.prefix, access_key: s3.access_key, secret: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();
  const ready = !!(s3.endpoint && s3.bucket && s3.access_key && s3.hasSecret);
  const changed = form.endpoint !== s3.endpoint || form.region !== s3.region || form.bucket !== s3.bucket || form.prefix !== s3.prefix || form.access_key !== s3.access_key || form.secret !== '';

  async function act<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    const r = await run(fn);
    setBusy(null);
    return r;
  }

  async function save(patch: Record<string, unknown>, done: string) {
    const r = await act('save', () => api<{ backup: BackupStatus }>('PUT', '/admin/backup/s3', patch));
    if (r) {
      onStatus(r.backup);
      const n = r.backup.s3;
      setForm({ endpoint: n.endpoint, region: n.region, bucket: n.bucket, prefix: n.prefix, access_key: n.access_key, secret: '' });
      toast(done, 'success');
    }
  }

  async function send(path: string, key: string) {
    const r = await act(key, () => api<{ ok: boolean; message: string; backup: BackupStatus }>('POST', path, {}));
    if (r) {
      onStatus(r.backup);
      toast(r.message, r.ok ? 'success' : 'error');
    }
  }

  const field = (id: keyof typeof form, label: string, extra: { placeholder?: string; type?: string; hint?: string } = {}) => (
    <div>
      <label className="label" htmlFor={`s3-${id}`}>
        {label}
      </label>
      <input
        id={`s3-${id}`}
        className="field"
        type={extra.type ?? 'text'}
        autoComplete="off"
        spellCheck={false}
        placeholder={extra.placeholder}
        value={form[id]}
        onChange={(e) => setForm({ ...form, [id]: e.target.value })}
      />
      {extra.hint && <p className="mt-1 text-[12px] text-ink-3">{extra.hint}</p>}
    </div>
  );

  return (
    <details className="mt-4 rounded-2xl border border-line p-4" open={s3.on || undefined}>
      <summary className="cursor-pointer text-[14px] font-medium text-ink">
        Kopie in einen Cloud-Speicher {s3.on && <Chip tone="good">An</Chip>}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[13px] text-ink-2">
          Falls der Server ausfällt: Jede Nacht-Sicherung geht zusätzlich verschlüsselt in einen S3-Speicher, z. B. Cloudflare R2 (bis 10 GB kostenlos) oder Hetzner Object Storage. Der Speicher sieht nur unlesbare Dateien.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <span className="text-[14px] text-ink">Jede Nacht hochladen</span>
          <Toggle label="Jede Nacht in den Cloud-Speicher hochladen" checked={s3.on} disabled={!ready || busy !== null} onChange={(v) => void save({ on: v }, v ? 'Wird ab heute Nacht hochgeladen' : 'Hochladen ausgeschaltet')} />
        </div>
        {s3.last && (
          <p className={cx('flex items-start gap-2 text-[13px]', s3.last.ok ? 'text-ink-3' : 'text-bad')}>
            {s3.last.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>
              {relative(s3.last.at, now)}: {s3.last.message}
              {s3.last.size !== undefined && ` (${mb(s3.last.size)})`}
            </span>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field('endpoint', 'Adresse (Endpoint)', { placeholder: 'https://<konto-id>.r2.cloudflarestorage.com' })}</div>
          {field('bucket', 'Bucket', { placeholder: 'perfumecloud-sicherung' })}
          {field('region', 'Region', { placeholder: 'auto', hint: 'R2: auto · Hetzner: z. B. fsn1 · AWS: z. B. eu-central-1' })}
          {field('access_key', 'Zugriffsschlüssel-ID')}
          {field('secret', s3.hasSecret ? 'Geheimer Schlüssel (leer lassen, um ihn zu behalten)' : 'Geheimer Schlüssel', { type: 'password' })}
          <div className="sm:col-span-2">{field('prefix', 'Ordner im Bucket', { placeholder: 'team-app' })}</div>
        </div>
        <p className="text-[12px] text-ink-3">
          Tipp: Dem Schlüssel nur Schreibrechte für diesen einen Bucket geben und im Speicher eine Regel anlegen, die Dateien nach z. B. 30 Tagen löscht – die App löscht dort selbst nichts.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<KeyRound className="h-4 w-4" />} loading={busy === 'save'} disabled={!changed || busy !== null} onClick={() => void save(form.secret ? form : { ...form, secret: undefined }, 'Cloud-Speicher gespeichert')}>
            Speichern
          </Button>
          <Button variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} loading={busy === 'test'} disabled={!ready || changed || busy !== null} onClick={() => void send('/admin/backup/s3/test', 'test')}>
            Verbindung testen
          </Button>
          <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} loading={busy === 'up'} disabled={!ready || changed || !status.files.length || busy !== null} onClick={() => void send('/admin/backup/s3/upload', 'up')}>
            Neueste hochladen
          </Button>
          {s3.hasSecret && (
            <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={busy !== null} onClick={() => window.confirm('Geheimen Schlüssel löschen und das Hochladen ausschalten?') && void save({ forget: true }, 'Schlüssel gelöscht')}>
              Schlüssel löschen
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

function RestoreSheet({ summary, onClose, onDone }: { summary: BackupSummary | null; onClose: () => void; onDone: (b: BackupStatus) => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const sync = useStore((s) => s.sync);
  useEffect(() => setConfirm(''), [summary]);
  const total = summary?.tables.reduce((n, t) => n + t.rows, 0) ?? 0;

  async function go() {
    if (!summary) return;
    setBusy(true);
    const r = await run(() => api<{ restored: { name: string; rows: number }[]; before: string | null; backup: BackupStatus }>('POST', '/admin/backup/restore', { name: summary.name, token: summary.token, confirm }));
    setBusy(false);
    if (r) {
      toast(`Wiederhergestellt (${r.restored.length} Tabellen).${r.before ? ` Der Stand davor liegt als ${r.before} bereit.` : ''}`, 'success');
      onDone(r.backup);
      void sync();
    }
  }

  return (
    <Sheet open={!!summary} onClose={onClose} title={<span className="text-[17px] font-semibold text-ink">Sicherung wiederherstellen</span>}>
      {summary && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-2 p-4 text-[14px] text-ink">
            <div className="font-mono text-[13px]">{summary.name ?? 'Hochgeladene Datei'}</div>
            <div className="mt-1 text-ink-2">
              Stand {dateTime(summary.created_at)} · App {summary.app} · {summary.tables.length} Tabellen · {total.toLocaleString('de-DE')} Einträge
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-ink-3">Inhalt anzeigen</summary>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 text-[12px] text-ink-3">
                {summary.tables.map((t) => (
                  <li key={t.name} className="flex justify-between gap-2">
                    <span className="truncate font-mono">{t.name}</span>
                    <span className="tnum">{t.rows}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <p className="flex gap-2 rounded-2xl bg-bad/10 p-4 text-[14px] text-bad">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Alle aktuellen Daten (Aufgaben, Notizen, Termine, Club …) werden durch diesen Stand ersetzt. Vorher sichert die App automatisch den jetzigen Stand, sodass du zurück kannst.
          </p>
          <div>
            <label className="label" htmlFor="confirm">
              Zur Bestätigung <b>WIEDERHERSTELLEN</b> eintippen
            </label>
            <input id="confirm" className="field font-mono" value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button variant="danger" className="w-full" icon={<RotateCcw className="h-4 w-4" />} loading={busy} disabled={confirm !== 'WIEDERHERSTELLEN'} onClick={go}>
            Jetzt wiederherstellen
          </Button>
        </div>
      )}
    </Sheet>
  );
}

// ---------------- Versand ----------------

function ShippingSection({ value, onChange }: { value: ShippingSettings; onChange: (s: ShippingSettings) => void }) {
  async function save(patch: Partial<ShippingSettings>) {
    const r = await run(() => api<{ settings: ShippingSettings }>('PUT', '/admin/shipping', patch));
    if (r) onChange(r.settings);
  }
  return (
    <Section title="Versand" description="Erinnerung für liegengebliebene Bestellungen und Vorgaben für „Versenden“.">
      <div className="divide-y divide-line/70">
        <Row label="Erinnerung ab" hint={value.remind_days ? 'Morgens ab 9 Uhr als Push (Benachrichtigungen → Versand-Erinnerung)' : 'Aus'}>
          <select className="field w-auto py-2" aria-label="Erinnerung ab" value={value.remind_days} onChange={(e) => void save({ remind_days: Number(e.target.value) })}>
            <option value={0}>Aus</option>
            {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'Tag' : 'Tagen'}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Versanddienst vorauswählen" hint="Wird überschrieben, wenn die App die Nummer erkennt">
          <select className="field w-auto py-2" aria-label="Versanddienst vorauswählen" value={value.default_carrier} onChange={(e) => void save({ default_carrier: e.target.value })}>
            {CARRIERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Row>
        <Row label="Versandbestätigung an Kundin" hint="Voreinstellung im Versenden-Dialog">
          <Toggle label="Versandbestätigung" checked={value.notify} onChange={(v) => void save({ notify: v })} />
        </Row>
      </div>
    </Section>
  );
}

// ---------------- Shopify: Kundeninfo testen ----------------

export function CustomerTest() {
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState<{ email: string; order: string | null } | null>(null);
  const submit = () => {
    const v = email.trim();
    if (!v) return;
    const order = v.match(/^#?(\d{3,10})$/)?.[1] ?? null;
    setQuery({ email: order ? '' : v, order });
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[14px] font-medium text-ink">Kundeninfo testen</p>
      <p className="mb-2 text-[13px] text-ink-3">So erscheint eine Kundin neben ihrer Mail. E-Mail-Adresse oder Bestellnummer eingeben.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input className="field" value={email} placeholder="kundin@beispiel.de oder #1042" onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="secondary" className="shrink-0" icon={<Search className="h-4 w-4" />}>
          Anzeigen
        </Button>
      </form>
      <Sheet open={!!query} onClose={() => setQuery(null)} title={<span className="text-[17px] font-semibold text-ink">Kundeninfo</span>}>
        {query && <CustomerPanel email={query.email} order={query.order} />}
      </Sheet>
    </div>
  );
}
