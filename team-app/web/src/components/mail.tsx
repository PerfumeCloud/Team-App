import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, ExternalLink, Eye, FlaskConical, Mail as MailIcon, Paperclip, Reply, Send, Sparkles, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import type { Email, MailMessage, ReplyResult, ReplyTemplate, TemplatesResponse } from '../lib/types';
import { dateTime, relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';
import { CustomerPanel } from './customer';
import { AutoTextarea, Button, Chip, cx, Segmented, Sheet, Spinner, Toggle } from './ui';

// Textbausteine einmal pro Sitzung laden – ändern sich selten
let templatesCache: TemplatesResponse | null = null;
export function useTemplates() {
  const [data, setData] = useState<TemplatesResponse | null>(templatesCache);
  useEffect(() => {
    api<TemplatesResponse>('GET', '/templates')
      .then((r) => {
        templatesCache = r;
        setData(r);
      })
      .catch(() => undefined);
  }, []);
  return data;
}
export function clearTemplatesCache() {
  templatesCache = null;
}

const draftKey = (id: string) => `pc-draft-${id}`;
function readDraft(id: string): string {
  try {
    return localStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(id: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* privat oder voll – egal */
  }
}

export function mailtoHref(mail: Email): string {
  const s = mail.subject ?? '';
  return `mailto:${encodeURIComponent(mail.from_email ?? '')}?subject=${encodeURIComponent(/^re:/i.test(s) ? s : `Re: ${s}`)}`;
}

/** Mail lesen und direkt beantworten – links die Nachricht, rechts (bzw. im Tab) alles zur Kundin. */
export function MailSheet({ mail, open, onClose, compose }: { mail: Email | null; open: boolean; onClose: () => void; compose?: boolean }) {
  const [tab, setTab] = useState<'mail' | 'kunde'>('mail');
  useEffect(() => {
    if (open) setTab('mail');
  }, [open, mail?.id]);
  if (!mail) return null;
  const sender = mail.from_name || mail.from_email || 'Unbekannt';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      xl
      title={
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold text-ink">{mail.subject || '(ohne Betreff)'}</h2>
          <div className="truncate text-[13px] text-ink-3">
            {sender}
            {mail.from_name && mail.from_email ? ` <${mail.from_email}>` : ''} · an {mail.mailbox}
          </div>
        </div>
      }
    >
      <MailBody key={mail.id} mail={mail} tab={tab} setTab={setTab} compose={compose} onDone={onClose} />
    </Sheet>
  );
}

function MailBody({
  mail,
  tab,
  setTab,
  compose,
  onDone,
}: {
  mail: Email;
  tab: 'mail' | 'kunde';
  setTab: (t: 'mail' | 'kunde') => void;
  compose?: boolean;
  onDone: () => void;
}) {
  const [msg, setMsg] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(() => readDraft(mail.id));
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const users = useStore((s) => s.users);
  const now = useNow();

  useEffect(() => {
    api<MailMessage>('GET', `/emails/${mail.id}/message`)
      .then(setMsg)
      .catch((e) => setError((e as Error).message));
  }, [mail.id]);
  useEffect(() => writeDraft(mail.id, text), [mail.id, text]);
  useEffect(() => {
    if (compose && msg) areaRef.current?.focus();
  }, [compose, msg]);

  /** An der Cursor-Position einfügen (z. B. Sendungslink aus den Kundeninfos). */
  function insert(snippet: string) {
    const el = areaRef.current;
    const pos = el && document.activeElement === el ? el.selectionStart : text.length;
    const before = text.slice(0, pos);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    setText(before + sep + snippet + text.slice(pos));
    setTab('mail');
    toast('In die Antwort eingefügt', 'success');
  }

  const customerEmail = mail.from_email ?? '';
  return (
    <div>
      <Segmented
        className="mb-4 w-full lg:hidden"
        value={tab}
        onChange={setTab}
        options={[
          {
            value: 'mail',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <MailIcon className="h-3.5 w-3.5" /> Nachricht
              </span>
            ),
          },
          {
            value: 'kunde',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" /> Kunde
              </span>
            ),
          },
        ]}
      />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <div className={cx('min-w-0 space-y-5', tab !== 'mail' && 'max-lg:hidden')}>
          {/* Nachricht */}
          <div className="rounded-2xl border border-line bg-surface-2/50 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              <span>{dateTime(mail.received_at)}</span>
              {msg?.to && msg.to.length > 0 && <span className="truncate">an {msg.to.map((t) => t.email).join(', ')}</span>}
              {msg?.cc && msg.cc.length > 0 && <span className="truncate">Kopie {msg.cc.map((t) => t.email).join(', ')}</span>}
            </div>
            {!msg && !error && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
            {error && (
              <>
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{mail.snippet}</p>
                <p className="mt-3 flex gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Volltext nicht abrufbar: {error}
                </p>
              </>
            )}
            {msg && <MessageText text={msg.text || mail.snippet || ''} />}
            {msg && msg.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {msg.attachments.map((a, i) => (
                  <Chip key={i} icon={<Paperclip className="h-3 w-3" />}>
                    {a.name} · {Math.max(1, Math.round(a.size / 1024))} KB
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {msg && msg.replies.length > 0 && (
            <ul className="space-y-1.5">
              {msg.replies.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Reply className="h-3.5 w-3.5 text-good" /> Beantwortet von {r.user_id && users[r.user_id] ? users[r.user_id].name.split(' ')[0] : 'jemandem'}{' '}
                  {relative(r.created_at, now)} an {r.to}
                </li>
              ))}
            </ul>
          )}

          {msg ? (
            <Composer mail={mail} msg={msg} text={text} setText={setText} areaRef={areaRef} onSent={onDone} />
          ) : (
            error && (
              <a
                href={mailtoHref(mail)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-[14px] font-medium text-ink hover:bg-surface-2"
              >
                <ExternalLink className="h-4 w-4" /> Im Mail-Programm antworten
              </a>
            )
          )}
        </div>

        <aside className={cx('min-w-0 max-lg:pb-2 lg:border-l lg:border-line lg:pl-6', tab !== 'kunde' && 'max-lg:hidden')}>
          <p className="eyebrow mb-3 max-lg:hidden">Kunde</p>
          {customerEmail || msg?.order_number ? (
            <CustomerPanel email={customerEmail} order={msg?.order_number} onInsert={insert} />
          ) : (
            <p className="text-[13px] text-ink-3">Keine Absenderadresse – keine Kundeninfos.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Lange Mails einklappen, zitierte Verläufe („> …“, „Am … schrieb“) abgesetzt zeigen. */
function MessageText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const lines = text.replace(/\n{3,}/g, '\n\n').split('\n');
  // Verlauf ab der ersten Zitatzeile abtrennen
  const cut = lines.findIndex((l, i) => /^>/.test(l) || (/^(Am|On) .{6,120}(schrieb|wrote)/.test(l) && i > 0) || /^-{2,}\s*(Original|Ursprüngliche)/i.test(l));
  const main = (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
  const quoted = cut > 0 ? lines.slice(cut).join('\n').trim() : '';
  const long = main.length > 1600;
  return (
    <div>
      <p className={cx('whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink', long && !full && 'line-clamp-[18]')}>{main || '(kein Text)'}</p>
      {long && (
        <button className="mt-1 text-[13px] font-medium text-accent hover:underline" onClick={() => setFull((v) => !v)}>
          {full ? 'Weniger anzeigen' : 'Ganze Mail anzeigen'}
        </button>
      )}
      {quoted && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-ink-3">Verlauf anzeigen</summary>
          <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-[13px] leading-relaxed text-ink-3">{quoted}</p>
        </details>
      )}
    </div>
  );
}

function Composer({
  mail,
  msg,
  text,
  setText,
  areaRef,
  onSent,
}: {
  mail: Email;
  msg: MailMessage;
  text: string;
  setText: (t: string) => void;
  areaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSent: () => void;
}) {
  const tpl = useTemplates();
  const putEmail = useStore((s) => s.putEmail);
  const [quote, setQuote] = useState(false);
  const [done, setDone] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [preview, setPreview] = useState<ReplyResult | null>(null);
  const [busy, setBusy] = useState<'fill' | 'ai' | 'preview' | 'test' | 'send' | null>(null);
  const [aiUsed, setAiUsed] = useState(false);

  // KI-Entwurf: ersetzt ein leeres Feld, sonst wird nachgefragt
  async function aiDraft() {
    if (text.trim() && !window.confirm('Den bisherigen Text durch einen KI-Entwurf ersetzen?')) return;
    setBusy('ai');
    try {
      const r = await api<{ text: string }>('POST', `/emails/${mail.id}/draft`, { order: msg.order_number });
      setText(r.text);
      setMissing([]);
      setTemplateId(null);
      setPreview(null);
      setAiUsed(true);
      requestAnimationFrame(() => areaRef.current?.focus());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function useTemplate(t: ReplyTemplate) {
    setBusy('fill');
    try {
      const r = await api<{ text: string; missing: string[] }>('POST', `/emails/${mail.id}/fill`, { text: t.body, order: msg.order_number });
      setText(text.trim() ? `${text.trimEnd()}\n\n${r.text}` : r.text);
      setMissing(r.missing);
      setTemplateId(t.id);
      setPreview(null);
      requestAnimationFrame(() => areaRef.current?.focus());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function run(mode: 'preview' | 'test' | 'send') {
    if (!text.trim()) {
      toast('Bitte zuerst einen Text schreiben.', 'error');
      return;
    }
    setBusy(mode);
    try {
      const r = await api<ReplyResult>('POST', `/emails/${mail.id}/reply`, {
        mode,
        text,
        quote,
        done,
        template_id: templateId,
      });
      setMissing(r.missing);
      if (mode === 'preview') setPreview(r);
      if (mode === 'test') toast(r.message ?? 'Testmail verschickt', 'success');
      if (mode === 'send') {
        if (r.email) putEmail(r.email);
        writeDraft(mail.id, '');
        setText('');
        setAiUsed(false);
        toast(r.message ?? 'Antwort verschickt', 'success');
        r.warnings?.forEach((w) => toast(w, 'error'));
        onSent();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  // Kurzname statt der langen Beschreibung: „bestellnummer“ → „Bestellnummer“
  const label = (key: string) => ({ meinvorname: 'Dein Vorname', meinname: 'Dein Name' } as Record<string, string>)[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="section-title">Antworten</p>
        <a href={mailtoHref(mail)} className="text-[12px] text-ink-3 hover:text-ink hover:underline">
          Lieber im Mail-Programm
        </a>
      </div>

      {tpl && (tpl.templates.length > 0 || tpl.ai) && (
        <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {tpl.ai && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void aiDraft()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3 text-[13px] font-medium text-accent transition-colors hover:brightness-[0.98] disabled:opacity-50"
            >
              <Sparkles className={cx('h-3.5 w-3.5', busy === 'ai' && 'animate-pulse')} aria-hidden />
              {busy === 'ai' ? 'Schreibt …' : 'KI-Entwurf'}
            </button>
          )}
          {tpl.templates.map((t) => (
            <button
              key={t.id}
              disabled={busy !== null}
              onClick={() => void useTemplate(t)}
              className={cx(
                'inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium transition-colors disabled:opacity-50',
                templateId === t.id ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      <AutoTextarea
        ref={areaRef}
        className="field min-h-[160px] leading-relaxed"
        placeholder={`Hallo ${mail.from_name?.split(' ')[0] ?? ''} …`.replace('  ', ' ')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
      />
      {aiUsed && (
        <p className="mt-2 flex gap-2 rounded-xl bg-accent-soft p-2.5 text-[13px] text-ink-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>Entwurf von der KI – bitte Fakten und Ton prüfen, bevor du ihn verschickst.</span>
        </p>
      )}
      {missing.length > 0 && (
        <p className="mt-2 flex gap-2 rounded-xl bg-warn/10 p-2.5 text-[13px] text-warn">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Nicht gefunden und weggelassen: <b>{missing.map(label).join(', ')}</b> – bitte prüfen und ggf. selbst ergänzen.
          </span>
        </p>
      )}
      <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-3">
        <p className="whitespace-pre-line">{msg.signature}</p>
        {msg.signature_image && <img src={msg.signature_image} alt="Bild unter deiner Signatur" className="max-h-16 max-w-[220px] object-contain object-left" />}
        {msg.footer && <p className="whitespace-pre-line">{msg.footer}</p>}
        {msg.footer_image && <img src={msg.footer_image} alt="Bild unter der Team-Fußzeile" className="max-h-16 max-w-[220px] object-contain object-left" />}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <Toggle label="Ursprüngliche Mail zitieren" checked={quote} onChange={setQuote} /> Mail zitieren
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <Toggle label="Danach als erledigt markieren" checked={done} onChange={setDone} /> Danach erledigt
        </label>
      </div>

      {preview && (
        <div className="mt-4 rounded-2xl bg-surface-2 p-4">
          <div className="space-y-0.5 text-[12px] text-ink-3">
            <div>Von: {preview.from}</div>
            <div>An: {preview.to}</div>
            <div>Betreff: {preview.subject}</div>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{preview.text}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye className="h-3.5 w-3.5" />}
          loading={busy === 'preview'}
          disabled={busy !== null}
          onClick={() => run('preview')}
        >
          Vorschau
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<FlaskConical className="h-3.5 w-3.5" />}
          loading={busy === 'test'}
          disabled={busy !== null}
          onClick={() => run('test')}
        >
          Test an mich
        </Button>
        <div className="flex-1" />
        {preview ? (
          <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={busy === 'send'} disabled={busy !== null} onClick={() => run('send')}>
            Jetzt an {preview.to.replace(/^.*<|>$/g, '')} senden
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Check className="h-3.5 w-3.5" />}
            loading={busy === 'preview'}
            disabled={busy !== null || !text.trim()}
            onClick={() => run('preview')}
          >
            Prüfen & senden
          </Button>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">
        Gesendet wird über {mail.mailbox}; eine Kopie landet im Ordner „Gesendet“. Entwürfe bleiben auf diesem Gerät gespeichert.
      </p>
    </div>
  );
}
