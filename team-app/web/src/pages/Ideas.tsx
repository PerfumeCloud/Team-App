import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowUp, CalendarDays, Check, CircleHelp, Clock, Flag, Lightbulb, ListChecks, MapPin, NotebookPen, Tag, Trash2, Undo2, X } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { AutoTextarea, Avatar, Button, cx, IconButton, Logo, Segmented } from '../components/ui';
import { useStore } from '../lib/store';
import { uuid } from '../lib/api';
import { dueInfo, firstName, todayISO } from '../lib/format';
import { toast } from '../lib/toast';
import { parseIdea, summary, type Context, type Draft, type DraftEvent, type DraftNote, type DraftTask, type Mode, type Priority } from '../lib/assistant';
import { KindDot } from '../components/events';
import { dayLabel, KINDS, kindInfo, plusHour } from '../lib/calendar';
import type { User } from '../lib/types';

interface Message {
  id: string;
  at: number;
  text: string;
  mode: Mode;
  draft: Draft;
  useNote: boolean;
  /** Abgewählte Aufgaben und Termine (keys). */
  skip: string[];
  state: 'open' | 'saved' | 'discarded';
  saved?: { noteId: string | null; taskIds: string[]; eventIds?: string[]; firstDate?: string };
}

const EXAMPLES = [
  'Adventskalender mit 24 Proben, Ben kümmert sich um die Fotos bis Freitag, Keanu um die Verpackung',
  'Black Friday\n- Newsletter schreiben @ich bis 20.11.\n- Rabattcode im Shop anlegen !\n- Reel drehen @Ben\n  - Flakons\n  - Geschenkbox',
  'Meeting mit Keanu am Donnerstag um 14 Uhr im Büro, danach Pakete packen',
  'Neuer Duft: Vanille, Tonka und Sandelholz – eher süß, für den Winter',
];

const HELP: [ReactNode, string][] = [
  [<><code>@Ben</code>, „Ben macht …“, „ich …“</>, 'wer zuständig ist'],
  [<>„morgen“, „Freitag“, „15.11.“, „Ende des Monats“, „KW 47“</>, 'bis wann'],
  [<><code>!</code> oder „dringend“ · „irgendwann“</>, 'wichtig · unwichtig'],
  [<><code>#Marketing</code></>, 'Kategorie'],
  [<>„Meeting mit Ben Freitag 14 Uhr im Büro“, „Messe vom 20. bis 24.10. in Köln“</>, 'Termin im Kalender'],
  [<>Zeilen mit <code>-</code>, eingerückt darunter</>, 'einzelne Aufgaben · Checkliste'],
  [<>„Notiz:“ am Anfang</>, 'nur als Notiz speichern'],
];

const storageKey = (userId: string) => `pc-ideas-${userId}`;

function loadMessages(userId: string): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

export default function Ideas() {
  const me = useStore((s) => s.me);
  const usersMap = useStore((s) => s.users);
  const tasksMap = useStore((s) => s.tasks);
  const saveNote = useStore((s) => s.saveNote);
  const saveTask = useStore((s) => s.saveTask);
  const saveEvent = useStore((s) => s.saveEvent);
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>(() => (me ? loadMessages(me.id) : []));
  const [input, setInput] = useState('');
  const [help, setHelp] = useState(false);
  const lastRef = useRef<HTMLDivElement>(null);
  const handledState = useRef(false);

  const users = useMemo(() => Object.values(usersMap).filter((u) => !u.deleted).sort((a, b) => a.name.localeCompare(b.name)), [usersMap]);
  const categories = useMemo(() => [...new Set(Object.values(tasksMap).map((t) => t.category).filter(Boolean))] as string[], [tasksMap]);
  const ctx: Context = useMemo(
    () => ({ people: users.map((u) => ({ id: u.id, name: u.name })), meId: me?.id ?? null, today: todayISO(), categories }),
    [users, me?.id, categories],
  );

  useEffect(() => {
    if (!me) return;
    try {
      localStorage.setItem(storageKey(me.id), JSON.stringify(messages.slice(-30)));
    } catch {
      /* privater Modus – Verlauf bleibt nur bis zum Schließen */
    }
  }, [messages, me]);

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    const msg: Message = { id: uuid(), at: Date.now(), text: t, mode: 'auto', draft: parseIdea(t, ctx, 'auto'), useNote: true, skip: [], state: 'open' };
    setMessages((list) => [...list, msg]);
    setInput('');
    setHelp(false);
    requestAnimationFrame(() => lastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // Schnelleingabe von der Übersicht
  useEffect(() => {
    const text = (location.state as { text?: string } | null)?.text;
    if (text && !handledState.current) {
      handledState.current = true;
      send(text);
      navigate('.', { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const update = (id: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));

  function commit(m: Message) {
    const tasks = m.draft.tasks.filter((t) => !m.skip.includes(t.key) && t.title.trim());
    const events = (m.draft.events ?? []).filter((e) => !m.skip.includes(e.key) && e.title.trim());
    const note = m.useNote && m.draft.note && (m.draft.note.title.trim() || m.draft.note.body.trim()) ? m.draft.note : null;
    const today = todayISO();
    let noteId: string | null = null;
    if (note) {
      const lines = tasks.map((t) => {
        const who = t.assigneeId ? usersMap[t.assigneeId] : null;
        const due = dueInfo(t.due);
        return `• ${t.title.trim()}${who ? ` – ${firstName(who.name)}` : ''}${due ? `, bis ${due.label}` : ''}`;
      });
      const dates = events.map((e) => `• ${e.title.trim()} – ${dayLabel(e.date, today)}${e.start ? `, ${e.start} Uhr` : ''}`);
      const body = [note.body.trim(), lines.length ? `Aufgaben:\n${lines.join('\n')}` : '', dates.length ? `Termine:\n${dates.join('\n')}` : '']
        .filter(Boolean)
        .join('\n\n');
      noteId = saveNote({ title: note.title.trim() || 'Idee', body }).id;
    }
    const eventIds = events.map(
      (e) =>
        saveEvent({
          title: e.title.trim(),
          kind: e.kind,
          start_date: e.date,
          end_date: e.endDate && e.endDate > e.date ? e.endDate : null,
          start_time: e.start,
          end_time: e.start ? e.end : null,
          location: e.location?.trim() || null,
          attendees: e.attendees,
          // wie im Kalender: 30 Min. vorher bzw. am Tag um 8 Uhr, Fristen einen Tag vorher
          remind_minutes: e.start ? 30 : e.kind === 'frist' ? 1440 : 0,
          notes: note ? `Aus der Notiz „${note.title.trim() || 'Idee'}“` : null,
        }).id,
    );
    const taskIds = tasks.map(
      (t) =>
        saveTask({
          title: t.title.trim(),
          assignee_id: t.assigneeId,
          due_date: t.due,
          priority: t.priority,
          category: t.category?.trim() || null,
          checklist: t.checklist.filter((c) => c.trim()).map((text) => ({ id: uuid(), text: text.trim(), done: false })),
          description: note ? `Aus der Notiz „${note.title.trim() || 'Idee'}“` : null,
        }).id,
    );
    const saved = { noteId, taskIds, eventIds, firstDate: events[0]?.date };
    update(m.id, { state: 'saved', saved });
    toast(`Angelegt: ${savedText(saved)}`, 'success');
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Am Rechner sendet Enter, Shift+Enter macht eine neue Zeile. Am Handy bleibt Enter ein Zeilenumbruch.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-220px)] flex-col">
      <PageHeader
        title="Ideen"
        subtitle="Schreib einfach drauflos – daraus werden Notizen, Aufgaben und Termine."
        actions={
          <>
            {messages.length > 0 && (
              <IconButton label="So verstehe ich dich" onClick={() => setHelp((v) => !v)}>
                <CircleHelp className="h-[18px] w-[18px]" />
              </IconButton>
            )}
            {messages.length > 0 && (
              <IconButton
                label="Verlauf leeren"
                onClick={() => {
                  if (confirm('Verlauf leeren? Angelegte Notizen und Aufgaben bleiben erhalten.')) setMessages([]);
                }}
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </IconButton>
            )}
          </>
        }
      />

      <div className="mx-auto w-full max-w-[760px] flex-1 space-y-5 pb-6">
        {(messages.length === 0 || help) && <Intro onExample={(t) => setInput(t)} compact={messages.length > 0} />}

        {messages.map((m, i) => (
          <div key={m.id} ref={i === messages.length - 1 ? lastRef : undefined} className="scroll-mt-20 space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-accent-ink">{m.text}</div>
            </div>
            <Reply
              m={m}
              users={users}
              categories={categories}
              onMode={(mode) => update(m.id, { mode, draft: parseIdea(m.text, ctx, mode), skip: [], useNote: true })}
              onNote={(patch) => update(m.id, (x) => ({ draft: { ...x.draft, note: x.draft.note ? { ...x.draft.note, ...patch } : null } }))}
              onUseNote={(v) => update(m.id, { useNote: v })}
              onTask={(key, patch) => update(m.id, (x) => ({ draft: { ...x.draft, tasks: x.draft.tasks.map((t) => (t.key === key ? { ...t, ...patch } : t)) } }))}
              onEvent={(key, patch) => update(m.id, (x) => ({ draft: { ...x.draft, events: (x.draft.events ?? []).map((e) => (e.key === key ? { ...e, ...patch } : e)) } }))}
              onSkip={(key, skip) => update(m.id, (x) => ({ skip: skip ? [...x.skip, key] : x.skip.filter((k) => k !== key) }))}
              onCommit={() => commit(m)}
              onDiscard={() => update(m.id, { state: 'discarded' })}
              onReopen={() => update(m.id, { state: 'open' })}
              onOpenNote={(id) => navigate(`/notizen/${id}`)}
              onOpenTasks={() => navigate('/planung')}
              onOpenCalendar={(d) => navigate(d ? `/kalender?d=${d}` : '/kalender')}
            />
          </div>
        ))}
      </div>

      <form
        className="sticky bottom-[calc(70px+var(--safe-bottom))] z-20 mx-auto w-full max-w-[760px] lg:bottom-6"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="card flex items-end gap-2 p-2 shadow-lift">
          <AutoTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Idee, Plan oder To-do …"
            aria-label="Idee eingeben"
            enterKeyHint="enter"
            className="max-h-48 min-h-[40px] flex-1 !overflow-y-auto bg-transparent px-2 py-2 text-[15px] leading-snug text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Senden"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink transition-opacity active:scale-95 disabled:opacity-35"
          >
            <ArrowUp className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>
        <p className="mt-1.5 hidden px-2 text-[12px] text-ink-3 lg:block">Enter sendet · Shift + Enter für eine neue Zeile</p>
      </form>
    </div>
  );
}

function Intro({ onExample, compact }: { onExample: (t: string) => void; compact: boolean }) {
  return (
    <div className="card p-5">
      {!compact && (
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-[22px] font-semibold leading-tight text-ink">Was hast du im Kopf?</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
              Tipp oder diktiere eine Idee – mit dem Mikrofon auf der iPhone-Tastatur geht das am schnellsten. Ich schlage dir eine Notiz und Aufgaben vor, du prüfst kurz und übernimmst.
            </p>
          </div>
        </div>
      )}
      <p className="eyebrow mb-2">So verstehe ich dich</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-[auto_1fr]">
        {HELP.map(([k, v], i) => (
          <div key={i} className="contents">
            <dt className="text-ink [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px]">{k}</dt>
            <dd className="mb-1.5 text-ink-3 sm:mb-0">→ {v}</dd>
          </div>
        ))}
      </dl>
      {!compact && (
        <>
          <p className="eyebrow mb-2 mt-5">Zum Ausprobieren</p>
          <div className="flex flex-col gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => onExample(e)}
                className="whitespace-pre-wrap rounded-xl border border-line/80 px-3.5 py-2.5 text-left text-[14px] leading-snug text-ink-2 transition-colors hover:bg-surface-2"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Reply({
  m,
  users,
  categories,
  onMode,
  onNote,
  onUseNote,
  onTask,
  onEvent,
  onSkip,
  onCommit,
  onDiscard,
  onReopen,
  onOpenNote,
  onOpenTasks,
  onOpenCalendar,
}: {
  m: Message;
  users: User[];
  categories: string[];
  onMode: (m: Mode) => void;
  onNote: (patch: Partial<DraftNote>) => void;
  onUseNote: (v: boolean) => void;
  onTask: (key: string, patch: Partial<DraftTask>) => void;
  onEvent: (key: string, patch: Partial<DraftEvent>) => void;
  onSkip: (key: string, skip: boolean) => void;
  onCommit: () => void;
  onDiscard: () => void;
  onReopen: () => void;
  onOpenNote: (id: string) => void;
  onOpenTasks: () => void;
  onOpenCalendar: (date?: string) => void;
}) {
  const events = m.draft.events ?? [];
  const chosenTasks = m.draft.tasks.filter((t) => !m.skip.includes(t.key) && t.title.trim()).length;
  const chosenEvents = events.filter((e) => !m.skip.includes(e.key) && e.title.trim()).length;
  const chosenNote = !!m.draft.note && m.useNote;
  const nothing = !chosenTasks && !chosenNote && !chosenEvents;
  const listId = `cats-${m.id}`;

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/70 bg-surface">
        <Logo className="h-5 w-5" />
      </div>
      <div className="card min-w-0 flex-1 space-y-3 p-3.5 sm:p-4">
        {m.state === 'saved' && m.saved ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-[15px] text-ink">
              <Check className="h-4 w-4 text-good" />
              Angelegt – {savedText(m.saved)}.
            </p>
            <div className="flex flex-wrap gap-2">
              {m.saved.noteId && (
                <Button size="sm" variant="soft" icon={<NotebookPen className="h-3.5 w-3.5" />} onClick={() => onOpenNote(m.saved!.noteId!)}>
                  Notiz öffnen
                </Button>
              )}
              {m.saved.taskIds.length > 0 && (
                <Button size="sm" variant="soft" icon={<ListChecks className="h-3.5 w-3.5" />} onClick={onOpenTasks}>
                  Zur Planung
                </Button>
              )}
              {(m.saved.eventIds?.length ?? 0) > 0 && (
                <Button size="sm" variant="soft" icon={<CalendarDays className="h-3.5 w-3.5" />} onClick={() => onOpenCalendar(m.saved!.firstDate)}>
                  Zum Kalender
                </Button>
              )}
            </div>
          </div>
        ) : m.state === 'discarded' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] text-ink-3">Verworfen.</p>
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={onReopen}>
              Doch übernehmen
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[15px] text-ink">{summary(m.draft)}</p>
              <Segmented
                size="sm"
                value={m.mode}
                onChange={onMode}
                options={[
                  { value: 'auto', label: 'Automatisch' },
                  { value: 'note', label: 'Notiz' },
                  { value: 'tasks', label: 'Aufgaben' },
                  { value: 'event', label: 'Termin' },
                ]}
              />
            </div>

            {m.draft.note && (
              <div className={cx('rounded-xl border border-line/70 p-3', !m.useNote && 'opacity-50')}>
                <div className="flex items-start gap-2.5">
                  <Tick checked={m.useNote} onChange={onUseNote} label="Notiz anlegen" />
                  <NotebookPen className="mt-1 h-4 w-4 shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <AutoTextarea
                      value={m.draft.note.title}
                      onChange={(e) => onNote({ title: e.target.value.replace(/\n/g, ' ') })}
                      placeholder="Titel der Notiz"
                      aria-label="Titel der Notiz"
                      className="w-full bg-transparent font-display text-[19px] font-semibold leading-tight text-ink placeholder:text-ink-3 focus:outline-none"
                    />
                    <AutoTextarea
                      value={m.draft.note.body}
                      onChange={(e) => onNote({ body: e.target.value })}
                      placeholder="Text der Notiz (optional)"
                      aria-label="Text der Notiz"
                      className="mt-1 w-full bg-transparent text-[14px] leading-relaxed text-ink-2 placeholder:text-ink-3 focus:outline-none"
                    />
                    {chosenTasks + chosenEvents > 0 && (
                      <p className="mt-1 text-[12px] text-ink-3">{chosenEvents ? 'Aufgaben und Termine' : 'Die Aufgaben'} werden unten in der Notiz aufgelistet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {m.draft.tasks.map((t) => (
              <TaskDraft
                key={t.key}
                t={t}
                skipped={m.skip.includes(t.key)}
                users={users}
                listId={listId}
                onChange={(patch) => onTask(t.key, patch)}
                onSkip={(v) => onSkip(t.key, v)}
              />
            ))}
            {events.map((e) => (
              <EventDraftCard key={e.key} e={e} skipped={m.skip.includes(e.key)} users={users} onChange={(patch) => onEvent(e.key, patch)} onSkip={(v) => onSkip(e.key, v)} />
            ))}
            <datalist id={listId}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button icon={<Check className="h-4 w-4" />} disabled={nothing} onClick={onCommit}>
                Übernehmen
              </Button>
              <Button variant="ghost" onClick={onDiscard}>
                Verwerfen
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** „1 Notiz, 2 Aufgaben und 1 Termin“ */
function savedText(saved: NonNullable<Message['saved']>): string {
  const n = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : '');
  const parts = [saved.noteId ? '1 Notiz' : '', n(saved.taskIds.length, 'Aufgabe', 'Aufgaben'), n(saved.eventIds?.length ?? 0, 'Termin', 'Termine')].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}` : parts[0] ?? 'nichts';
}

function Tick({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border transition-colors',
        checked ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface',
      )}
    >
      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}

const PRIORITY: Record<Priority, string> = { low: 'Niedrig', normal: 'Normal', high: 'Hoch' };
const pill = 'relative inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium transition-colors';

function TaskDraft({
  t,
  skipped,
  users,
  listId,
  onChange,
  onSkip,
}: {
  t: DraftTask;
  skipped: boolean;
  users: User[];
  listId: string;
  onChange: (patch: Partial<DraftTask>) => void;
  onSkip: (v: boolean) => void;
}) {
  const who = users.find((u) => u.id === t.assigneeId) ?? null;
  const due = dueInfo(t.due);
  return (
    <div className={cx('rounded-xl border border-line/70 p-3', skipped && 'opacity-50')}>
      <div className="flex items-start gap-2.5">
        <Tick checked={!skipped} onChange={(v) => onSkip(!v)} label="Aufgabe anlegen" />
        <AutoTextarea
          value={t.title}
          onChange={(e) => onChange({ title: e.target.value.replace(/\n/g, ' ') })}
          aria-label="Titel der Aufgabe"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium leading-snug text-ink focus:outline-none"
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:pl-8">
        {/* Zuständig */}
        <label className={cx(pill, who ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-ink-2')}>
          {who ? <Avatar user={who} size={18} /> : null}
          {who ? firstName(who.name) : 'Niemand'}
          <select
            value={t.assigneeId ?? ''}
            onChange={(e) => onChange({ assigneeId: e.target.value || null })}
            aria-label="Zuständig"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">Niemand</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        {/* Fällig */}
        <label className={cx(pill, due ? (due.state === 'overdue' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-surface-2 text-ink') : 'border-line text-ink-2')}>
          <CalendarDays className="h-3.5 w-3.5" />
          {due ? due.label : 'Kein Datum'}
          <input
            type="date"
            value={t.due ?? ''}
            onChange={(e) => onChange({ due: e.target.value || null })}
            onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            aria-label="Fällig am"
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {t.due && (
          <button type="button" onClick={() => onChange({ due: null })} aria-label="Datum entfernen" className="-ml-1 rounded-full p-1 text-ink-3 hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Priorität */}
        <label className={cx(pill, t.priority === 'high' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line text-ink-2')}>
          <Flag className="h-3.5 w-3.5" />
          {PRIORITY[t.priority]}
          <select value={t.priority} onChange={(e) => onChange({ priority: e.target.value as Priority })} aria-label="Priorität" className="absolute inset-0 cursor-pointer opacity-0">
            <option value="low">Niedrig</option>
            <option value="normal">Normal</option>
            <option value="high">Hoch</option>
          </select>
        </label>
        {/* Kategorie */}
        <span className={cx(pill, 'border-line text-ink-2 focus-within:border-accent')}>
          <Tag className="h-3.5 w-3.5 shrink-0" />
          <input
            value={t.category ?? ''}
            onChange={(e) => onChange({ category: e.target.value || null })}
            list={listId}
            placeholder="Kategorie"
            aria-label="Kategorie"
            style={{ width: `${Math.max(8, (t.category ?? '').length) + 1}ch` }}
            className="bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </span>
      </div>
      {t.checklist.length > 0 && (
        <ul className="mt-2.5 space-y-1 sm:pl-8">
          {t.checklist.map((c, i) => (
            <li key={i} className="flex items-center gap-2 text-[14px] text-ink-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded border border-line" />
              <input
                value={c}
                onChange={(e) => onChange({ checklist: t.checklist.map((x, j) => (j === i ? e.target.value : x)) })}
                aria-label={`Checklistenpunkt ${i + 1}`}
                className="min-w-0 flex-1 bg-transparent focus:outline-none"
              />
              <button type="button" onClick={() => onChange({ checklist: t.checklist.filter((_, j) => j !== i) })} aria-label="Punkt entfernen" className="rounded p-0.5 text-ink-3 hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Vorschau eines Termins: Art, Datum, Uhrzeit, Ort und Teilnehmer direkt änderbar. */
function EventDraftCard({
  e,
  skipped,
  users,
  onChange,
  onSkip,
}: {
  e: DraftEvent;
  skipped: boolean;
  users: User[];
  onChange: (patch: Partial<DraftEvent>) => void;
  onSkip: (v: boolean) => void;
}) {
  const today = todayISO();
  const kind = kindInfo(e.kind);
  const multi = !!e.endDate && e.endDate > e.date;
  const toggle = (id: string) => onChange({ attendees: e.attendees.includes(id) ? e.attendees.filter((x) => x !== id) : [...e.attendees, id] });
  // Neue Startzeit: Dauer beibehalten (sonst eine Stunde), Fristen haben kein Ende
  const setStart = (start: string) => {
    if (!start) return onChange({ start: null, end: null });
    if (e.kind === 'frist') return onChange({ start, end: null });
    if (!e.start || !e.end) return onChange({ start, end: plusHour(start) });
    const end = Math.min(minutes(start) + minutes(e.end) - minutes(e.start), 23 * 60 + 59);
    onChange({ start, end: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` });
  };
  return (
    <div className={cx('rounded-xl border border-line/70 p-3', skipped && 'opacity-50')}>
      <div className="flex items-start gap-2.5">
        <Tick checked={!skipped} onChange={(v) => onSkip(!v)} label="Termin eintragen" />
        <AutoTextarea
          value={e.title}
          onChange={(ev) => onChange({ title: ev.target.value.replace(/\n/g, ' ') })}
          aria-label="Titel des Termins"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium leading-snug text-ink focus:outline-none"
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:pl-8">
        {/* Art */}
        <label className={cx(pill, kind.tone, 'border-transparent')} style={{ background: 'var(--u-bg)', color: 'var(--u-fg)' }}>
          <KindDot kind={e.kind} />
          {kind.label}
          <select value={e.kind} onChange={(ev) => onChange({ kind: ev.target.value as DraftEvent['kind'] })} aria-label="Art des Termins" className="absolute inset-0 cursor-pointer opacity-0">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {/* Datum */}
        <label className={cx(pill, 'border-line bg-surface-2 text-ink')}>
          <CalendarDays className="h-3.5 w-3.5" />
          {dayLabel(e.date, today)}
          {multi ? ` – ${dayLabel(e.endDate!, today)}` : ''}
          <input
            type="date"
            value={e.date}
            onChange={(ev) => ev.target.value && onChange({ date: ev.target.value, endDate: e.endDate && e.endDate > ev.target.value ? e.endDate : null })}
            onClick={(ev) => (ev.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            aria-label="Datum"
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {/* Uhrzeit */}
        <label className={cx(pill, e.start ? 'border-line bg-surface-2 text-ink' : 'border-line text-ink-2')}>
          <Clock className="h-3.5 w-3.5" />
          {e.start ? (e.end ? `${e.start}–${e.end}` : `${e.start} Uhr`) : 'Ganztägig'}
          <input type="time" value={e.start ?? ''} onChange={(ev) => setStart(ev.target.value)} aria-label="Uhrzeit" className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        {e.start && (
          <button type="button" onClick={() => onChange({ start: null, end: null })} aria-label="Ganztägig" title="Ganztägig" className="-ml-1 rounded-full p-1 text-ink-3 hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Ort */}
        <span className={cx(pill, 'border-line text-ink-2 focus-within:border-accent')}>
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <input
            value={e.location ?? ''}
            onChange={(ev) => onChange({ location: ev.target.value || null })}
            placeholder="Ort"
            aria-label="Ort"
            style={{ width: `${Math.max(4, (e.location ?? '').length) + 1}ch` }}
            className="bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </span>
      </div>
      {/* Teilnehmer */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:pl-8">
        <button
          type="button"
          onClick={() => onChange({ attendees: [] })}
          aria-pressed={!e.attendees.length}
          className={cx(pill, !e.attendees.length ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-ink-2')}
        >
          Ganzes Team
        </button>
        {users.map((u) => {
          const on = e.attendees.includes(u.id);
          return (
            <button key={u.id} type="button" onClick={() => toggle(u.id)} aria-pressed={on} className={cx(pill, 'pl-1', on ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-ink-2')}>
              <Avatar user={u} size={18} />
              {firstName(u.name)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
