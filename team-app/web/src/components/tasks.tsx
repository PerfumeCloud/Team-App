import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CalendarDays, Check, CircleCheck, Flag, Inbox, ListChecks, MessageCircle, Plus, Send, Tag, Trash2, X } from 'lucide-react';
import { useStore } from '../lib/store';
import type { ChecklistItem, Priority, Task, TaskStatus, User } from '../lib/types';
import { dateTime, dueInfo, relative } from '../lib/format';
import { uuid } from '../lib/api';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';
import { AutoTextarea, Avatar, Button, Chip, cx, IconButton, Segmented, Sheet } from './ui';

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'Offen', doing: 'In Arbeit', done: 'Erledigt' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Niedrig', normal: 'Normal', high: 'Hoch' };

export function TaskCheck({ task, size = 22 }: { task: Task; size?: number }) {
  const saveTask = useStore((s) => s.saveTask);
  const done = task.status === 'done';
  return (
    <button
      aria-label={done ? 'Als offen markieren' : 'Als erledigt markieren'}
      onClick={(e) => {
        e.stopPropagation();
        const prev = task.status;
        saveTask({ id: task.id, status: done ? 'todo' : 'done' });
        if (!done) toast(`„${task.title}“ erledigt`, 'success', { label: 'Rückgängig', run: () => saveTask({ id: task.id, status: prev }) });
      }}
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all active:scale-90',
        done ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3/50 text-transparent hover:border-accent hover:text-accent/50',
      )}
      style={{ width: size, height: size }}
    >
      <Check className="h-[60%] w-[60%]" strokeWidth={3} />
    </button>
  );
}

export function DueChip({ date, done }: { date: string | null; done?: boolean }) {
  const info = dueInfo(date);
  if (!info) return null;
  const tone = done ? 'neutral' : info.state === 'overdue' ? 'bad' : info.state === 'today' ? 'warn' : 'neutral';
  return (
    <Chip tone={tone} icon={<CalendarDays className="h-3 w-3" />}>
      {info.label}
    </Chip>
  );
}

export function TaskCard({ task, onOpen, compact, draggable }: { task: Task; onOpen: () => void; compact?: boolean; draggable?: boolean }) {
  const users = useStore((s) => s.users);
  const comments = useStore((s) => s.comments);
  const commentCount = useMemo(() => Object.values(comments).filter((c) => c.task_id === task.id).length, [comments, task.id]);
  const done = task.status === 'done';
  const checklistDone = task.checklist.filter((c) => c.done).length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cx(
        'card group flex cursor-pointer gap-3 p-3.5 transition-all hover:shadow-lift',
        done && 'opacity-60',
        draggable && 'active:cursor-grabbing',
      )}
    >
      <div className="pt-0.5">
        <TaskCheck task={task} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cx('text-[14.5px] font-medium leading-snug text-ink', done && 'line-through decoration-ink-3')}>{task.title}</div>
        {!compact && task.description && <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{task.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.priority === 'high' && !done && (
            <Chip tone="bad" icon={<Flag className="h-3 w-3" />}>
              Hoch
            </Chip>
          )}
          <DueChip date={task.due_date} done={done} />
          {task.category && <Chip icon={<Tag className="h-3 w-3" />}>{task.category}</Chip>}
          {task.checklist.length > 0 && (
            <Chip icon={<ListChecks className="h-3 w-3" />}>
              {checklistDone}/{task.checklist.length}
            </Chip>
          )}
          {commentCount > 0 && <Chip icon={<MessageCircle className="h-3 w-3" />}>{commentCount}</Chip>}
          {task.source_email_id && <Chip icon={<Inbox className="h-3 w-3" />}>Mail</Chip>}
        </div>
      </div>
      <div className="shrink-0">
        <Avatar user={task.assignee_id ? users[task.assignee_id] : null} size={26} />
      </div>
    </div>
  );
}

export function PersonPicker({ value, onChange, users, allowNone = true }: { value: string | null; onChange: (id: string | null) => void; users: User[]; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {allowNone && (
        <button
          onClick={() => onChange(null)}
          className={cx('flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors', value === null ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2')}
        >
          Niemand
        </button>
      )}
      {users.map((u) => (
        <button
          key={u.id}
          onClick={() => onChange(u.id)}
          className={cx(
            'flex h-9 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] transition-colors',
            value === u.id ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
          )}
        >
          <Avatar user={u} size={26} />
          {u.name.split(' ')[0]}
        </button>
      ))}
    </div>
  );
}

/** Detailansicht einer Aufgabe – speichert automatisch. */
export function TaskDetail({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const task = useStore((s) => (taskId ? s.tasks[taskId] : undefined));
  const [stale, setStale] = useState<Task | null>(null);
  useEffect(() => {
    if (task) setStale(task);
  }, [task]);
  const t = task ?? stale;
  return (
    <Sheet open={!!taskId && !!t} onClose={onClose} wide title={t ? <span className="eyebrow">Aufgabe</span> : null}>
      {t && <TaskForm key={t.id} task={t} onClose={onClose} />}
    </Sheet>
  );
}

function TaskForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const { saveTask, deleteTask, addComment, deleteComment } = useStore.getState();
  const usersMap = useStore((s) => s.users);
  const me = useStore((s) => s.me);
  const allComments = useStore((s) => s.comments);
  const emails = useStore((s) => s.emails);
  const allTasks = useStore((s) => s.tasks);
  const navigate = useNavigate();
  const now = useNow();
  const users = Object.values(usersMap).filter((u) => !u.deleted);
  const comments = Object.values(allComments)
    .filter((c) => c.task_id === task.id)
    .sort((a, b) => a.created_at - b.created_at);
  const categories = useMemo(() => [...new Set(Object.values(allTasks).map((t) => t.category).filter(Boolean))] as string[], [allTasks]);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [category, setCategory] = useState(task.category ?? '');
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const dirty = useRef(false);

  // Textfelder verzögert speichern
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => {
      if (title.trim()) saveTask({ id: task.id, title: title.trim(), description: description || null, category: category.trim() || null });
    }, 600);
    return () => window.clearTimeout(t);
  }, [title, description, category, task.id, saveTask]);

  // Beim Schließen noch nicht gespeicherten Text sichern
  const latest = useRef({ title, description, category });
  latest.current = { title, description, category };
  useEffect(
    () => () => {
      if (!dirty.current) return;
      const l = latest.current;
      if (l.title.trim() && useStore.getState().tasks[task.id]) {
        saveTask({ id: task.id, title: l.title.trim(), description: l.description || null, category: l.category.trim() || null });
      }
    },
    [task.id, saveTask],
  );

  // Fremde Änderungen übernehmen, solange hier nicht getippt wird
  useEffect(() => {
    if (dirty.current) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setCategory(task.category ?? '');
  }, [task.title, task.description, task.category]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    dirty.current = true;
    setter(v);
  };

  const setChecklist = (list: ChecklistItem[]) => saveTask({ id: task.id, checklist: list });
  const sourceMail = task.source_email_id ? emails[task.source_email_id] : null;

  function submitItem(e: FormEvent) {
    e.preventDefault();
    if (!newItem.trim()) return;
    setChecklist([...task.checklist, { id: uuid(), text: newItem.trim(), done: false }]);
    setNewItem('');
  }

  function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    addComment(task.id, comment.trim());
    setComment('');
  }

  return (
    <div className="space-y-6 pb-4">
      <AutoTextarea
        value={title}
        onChange={(e) => edit(setTitle)(e.target.value.replace(/\n/g, ' '))}
        onBlur={() => (dirty.current = false)}
        placeholder="Titel der Aufgabe"
        className="w-full bg-transparent font-display text-[28px] font-semibold leading-tight text-ink placeholder:text-ink-3 focus:outline-none"
      />

      <div className="space-y-4">
        <Segmented
          value={task.status}
          onChange={(v) => saveTask({ id: task.id, status: v })}
          className="w-full"
          options={(['todo', 'doing', 'done'] as TaskStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />

        <div>
          <span className="label">Zuständig</span>
          <PersonPicker value={task.assignee_id} onChange={(id) => saveTask({ id: task.id, assignee_id: id })} users={users} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="due">
              Fällig am
            </label>
            <div className="flex gap-2">
              <input
                id="due"
                type="date"
                className="field"
                value={task.due_date ?? ''}
                onChange={(e) => saveTask({ id: task.id, due_date: e.target.value || null })}
              />
              {task.due_date && (
                <IconButton label="Datum entfernen" className="h-[46px] w-[46px]" onClick={() => saveTask({ id: task.id, due_date: null })}>
                  <X className="h-4 w-4" />
                </IconButton>
              )}
            </div>
          </div>
          <div>
            <span className="label">Priorität</span>
            <Segmented
              value={task.priority}
              onChange={(v) => saveTask({ id: task.id, priority: v })}
              className="w-full"
              options={(['low', 'normal', 'high'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="cat">
            Kategorie
          </label>
          <input
            id="cat"
            className="field"
            list="task-categories"
            placeholder="z. B. Marketing, Einkauf, Versand"
            value={category}
            onChange={(e) => edit(setCategory)(e.target.value)}
            onBlur={() => (dirty.current = false)}
          />
          <datalist id="task-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label" htmlFor="desc">
            Beschreibung
          </label>
          <AutoTextarea
            id="desc"
            className="field min-h-[96px] leading-relaxed"
            placeholder="Details, Links, Gedanken …"
            value={description}
            onChange={(e) => edit(setDescription)(e.target.value)}
            onBlur={() => (dirty.current = false)}
          />
        </div>
      </div>

      {sourceMail && (
        <button onClick={() => navigate('/postfach')} className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-left">
          <Inbox className="h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium text-ink">{sourceMail.subject}</div>
            <div className="truncate text-[12px] text-ink-3">
              {sourceMail.from_name || sourceMail.from_email} · {sourceMail.mailbox}
            </div>
          </div>
        </button>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="section-title">Checkliste</h3>
          {task.checklist.length > 0 && (
            <span className="tnum text-[12px] text-ink-3">
              {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
            </span>
          )}
        </div>
        <ul className="space-y-1">
          {task.checklist.map((item) => (
            <li key={item.id} className="group flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface-2">
              <button
                aria-label={item.done ? 'Nicht erledigt' : 'Erledigt'}
                onClick={() => setChecklist(task.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)))}
                className={cx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px]',
                  item.done ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3/50 text-transparent',
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </button>
              <span className={cx('flex-1 text-[14px]', item.done ? 'text-ink-3 line-through' : 'text-ink')}>{item.text}</span>
              <button
                aria-label="Entfernen"
                onClick={() => setChecklist(task.checklist.filter((c) => c.id !== item.id))}
                className="text-ink-3 opacity-0 transition-opacity hover:text-bad group-hover:opacity-100 max-lg:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={submitItem} className="mt-1 flex items-center gap-3 px-1">
          <Plus className="h-5 w-5 text-ink-3" />
          <input className="flex-1 bg-transparent py-1.5 text-[14px] placeholder:text-ink-3 focus:outline-none" placeholder="Punkt hinzufügen" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
        </form>
      </section>

      <section>
        <h3 className="section-title mb-3">Kommentare</h3>
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="group flex gap-3">
              <Avatar user={usersMap[c.user_id]} size={28} />
              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-surface-2 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{usersMap[c.user_id]?.name ?? 'Jemand'}</span>
                  <span className="text-[11.5px] text-ink-3">{relative(c.created_at, now)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{c.body}</p>
                {c.user_id === me?.id && (
                  <button className="mt-1 text-[12px] text-ink-3 hover:text-bad" onClick={() => deleteComment(c.id)}>
                    Löschen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={submitComment} className="mt-3 flex items-end gap-2">
          <AutoTextarea
            className="field flex-1"
            placeholder="Kommentar schreiben …"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment(e);
            }}
          />
          <Button type="submit" className="h-[46px] w-[46px] !px-0" aria-label="Senden" disabled={!comment.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[12px] text-ink-3">
        <span>
          Erstellt von {usersMap[task.created_by ?? '']?.name ?? 'jemandem'} · {dateTime(task.created_at)}
          {task.completed_at ? (
            <>
              {' '}
              · <CircleCheck className="inline h-3 w-3" /> erledigt {relative(task.completed_at, now)}
            </>
          ) : null}
        </span>
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => {
            const snapshot = task;
            dirty.current = false;
            deleteTask(task.id);
            onClose();
            toast('Aufgabe gelöscht', 'info', { label: 'Rückgängig', run: () => saveTask({ ...snapshot, deleted: 0 }) });
          }}
        >
          Löschen
        </Button>
      </div>
    </div>
  );
}
