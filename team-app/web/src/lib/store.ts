import { create } from 'zustand';
import { api, ApiError, isOffline, uuid } from './api';
import type { ActivityItem, Comment, Email, ID, Meta, Note, Prefs, StatusResponse, SyncResponse, Task, User } from './types';
import { toast } from './toast';

/*
 * Sync-Engine
 * - Änderungen werden sofort lokal angezeigt (optimistisch) und in eine Warteschlange (Outbox) gelegt.
 * - Die Outbox wird der Reihe nach an den Server geschickt; ohne Netz bleibt sie erhalten.
 * - Alle paar Sekunden fragt die App „was hat sich seit X geändert?“ und übernimmt fremde Änderungen.
 * - Alles wird lokal zwischengespeichert, damit die App sofort startet und offline lesbar ist.
 */

type Table = 'tasks' | 'notes' | 'comments' | 'emails';

interface OutboxOp {
  key: string;
  table: Table;
  id: string;
  method: 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
}

type Phase = 'boot' | 'setup' | 'login' | 'ready';

interface Data {
  me: User | null;
  prefs: Prefs | null;
  users: Record<ID, User>;
  tasks: Record<ID, Task>;
  notes: Record<ID, Note>;
  comments: Record<ID, Comment>;
  emails: Record<string, Email>;
  activity: ActivityItem[];
  meta: Meta | null;
  cursor: number;
  lastSyncAt: number;
  outbox: OutboxOp[];
}

interface State extends Data {
  phase: Phase;
  status: StatusResponse | null;
  /** Warum der Server beim Start nicht erreichbar war (nur ohne Zwischenspeicher). */
  bootError: string | null;
  online: boolean;
  syncing: boolean;
  boot: () => Promise<void>;
  setSession: (user: User) => Promise<void>;
  logout: () => Promise<void>;
  sync: (opts?: { full?: boolean }) => Promise<void>;
  saveTask: (patch: Partial<Task> & { id?: ID }) => Task;
  deleteTask: (id: ID) => void;
  saveNote: (patch: Partial<Note> & { id?: ID }) => Note;
  deleteNote: (id: ID) => void;
  addComment: (taskId: ID, body: string) => void;
  deleteComment: (id: ID) => void;
  updateEmail: (id: string, patch: { status?: 'open' | 'done'; assignee_id?: ID | null }) => void;
  setMe: (user: User, prefs?: Prefs) => void;
}

const CACHE_KEY = 'pc-cache-v1';

const empty: Data = {
  me: null,
  prefs: null,
  users: {},
  tasks: {},
  notes: {},
  comments: {},
  emails: {},
  activity: [],
  meta: null,
  cursor: 0,
  lastSyncAt: 0,
  outbox: [],
};

function loadCache(): Data | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Data;
    return data?.me ? { ...empty, ...data } : null;
  } catch {
    return null;
  }
}

let saveTimer: number | undefined;
function persist(state: State) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!state.me) return;
    const data: Data = {
      me: state.me,
      prefs: state.prefs,
      users: state.users,
      tasks: state.tasks,
      notes: state.notes,
      comments: state.comments,
      emails: state.emails,
      activity: state.activity,
      meta: state.meta,
      cursor: state.cursor,
      lastSyncAt: state.lastSyncAt,
      outbox: state.outbox,
    };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      /* Speicher voll oder privat – App funktioniert trotzdem */
    }
  }, 400);
}

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[x.id] = x;
  return out;
}

function mergeRows<T extends { id: string; deleted: number }>(
  current: Record<string, T>,
  rows: T[],
  pending: Set<string>,
  full: boolean,
): Record<string, T> {
  const next: Record<string, T> = full ? {} : { ...current };
  if (full) {
    // Lokal geänderte, noch nicht gesendete Einträge behalten
    for (const id of pending) if (current[id]) next[id] = current[id];
  }
  for (const row of rows) {
    if (pending.has(row.id)) continue;
    if (row.deleted) delete next[row.id];
    else next[row.id] = row;
  }
  return next;
}

function enqueue(outbox: OutboxOp[], op: OutboxOp): OutboxOp[] {
  const rest = outbox.filter((o) => !(o.table === op.table && o.id === op.id && (o.method === op.method || op.method === 'DELETE')));
  if (op.method === 'PATCH') {
    const prev = outbox.find((o) => o.key === op.key);
    if (prev?.body) op = { ...op, body: { ...prev.body, ...op.body } };
  }
  return [...rest, op];
}

let flushing = false;
let syncQueued = false;

export const useStore = create<State>((set, get) => ({
  ...empty,
  phase: 'boot',
  status: null,
  bootError: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,

  async boot() {
    const cached = loadCache();
    if (cached) {
      set({ ...cached, phase: 'ready' });
      void get().sync({ full: Date.now() - cached.lastSyncAt > 7 * 86400000 });
      return;
    }
    try {
      const status = await api<StatusResponse | null>('GET', '/status');
      if (!status || typeof status !== 'object' || !('installed' in status)) {
        throw new ApiError(0, 'Die Server-Schnittstelle antwortet nicht. Fehlt public/.htaccess?');
      }
      set({ status, bootError: null });
      if (!status.installed) {
        set({ phase: 'setup' });
        return;
      }
      const me = await api<{ user: User; prefs: Prefs }>('GET', '/me');
      set({ ...empty, me: me.user, prefs: me.prefs, phase: 'ready' });
      await get().sync({ full: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) set({ phase: 'login', bootError: null });
      else if (e instanceof ApiError) {
        set({ phase: 'login', bootError: e.status === 0 ? e.message : `Der Server meldet einen Fehler (${e.status}). Bitte die Einrichtung prüfen.` });
      } else {
        set({ phase: 'login', online: false, bootError: 'Keine Verbindung zum Server.' });
      }
    }
  },

  async setSession(user) {
    const prev = get().me;
    if (prev && prev.id !== user.id) localStorage.removeItem(CACHE_KEY);
    set({ ...empty, me: user, phase: 'ready' });
    try {
      const me = await api<{ user: User; prefs: Prefs }>('GET', '/me');
      set({ me: me.user, prefs: me.prefs });
    } catch {
      /* egal */
    }
    await get().sync({ full: true });
  },

  async logout() {
    try {
      await api('POST', '/auth/logout');
    } catch {
      /* offline – lokal trotzdem abmelden */
    }
    localStorage.removeItem(CACHE_KEY);
    set({ ...empty, phase: 'login' });
  },

  async sync(opts = {}) {
    if (!get().me) return;
    if (get().syncing) {
      syncQueued = true;
      return;
    }
    set({ syncing: true });
    try {
      await flush();
      const since = opts.full ? 0 : get().cursor;
      const res = await api<SyncResponse>('GET', `/sync?since=${since}`);
      const pending = new Set(get().outbox.map((o) => o.id));
      const s = get();
      const users = byId(res.users);
      const activity = res.full
        ? res.activity
        : [...res.activity, ...s.activity.filter((a) => !res.activity.some((b) => b.id === a.id))]
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, 80);
      set({
        users,
        me: users[s.me!.id] ? { ...s.me!, ...users[s.me!.id] } : s.me,
        tasks: mergeRows(s.tasks, res.tasks, pending, res.full),
        notes: mergeRows(s.notes, res.notes, pending, res.full),
        comments: mergeRows(s.comments, res.comments, pending, res.full),
        emails: mergeRows(s.emails, res.emails, pending, res.full),
        activity,
        meta: res.meta,
        cursor: res.serverTime,
        lastSyncAt: Date.now(),
        online: true,
      });
      updateBadge();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        localStorage.removeItem(CACHE_KEY);
        set({ ...empty, phase: 'login' });
      } else if (isOffline(e)) {
        set({ online: false });
      }
    } finally {
      set({ syncing: false });
      if (syncQueued) {
        syncQueued = false;
        void get().sync();
      }
    }
  },

  saveTask(patch) {
    const s = get();
    const id = patch.id ?? uuid();
    const old: Task | undefined = s.tasks[id];
    const now = Date.now();
    const base: Task = {
      id,
      title: '',
      description: null,
      status: 'todo',
      priority: 'normal',
      category: null,
      assignee_id: null,
      due_date: null,
      position: now,
      checklist: [],
      source_email_id: null,
      completed_at: null,
      created_by: s.me?.id ?? null,
      created_at: now,
      updated_by: null,
      updated_at: now,
      deleted: 0,
    };
    const task: Task = { ...base, ...old, ...patch, updated_by: s.me?.id ?? null, updated_at: now };
    if (task.status === 'done' && !task.completed_at) task.completed_at = now;
    if (task.status !== 'done') task.completed_at = null;
    set({
      tasks: { ...s.tasks, [id]: task },
      outbox: enqueue(s.outbox, {
        key: `PUT:tasks:${id}`,
        table: 'tasks',
        id,
        method: 'PUT',
        path: `/tasks/${id}`,
        body: {
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          category: task.category,
          assignee_id: task.assignee_id,
          due_date: task.due_date,
          position: task.position,
          checklist: task.checklist,
          source_email_id: task.source_email_id,
        },
      }),
    });
    kick();
    return task;
  },

  deleteTask(id) {
    const s = get();
    const tasks = { ...s.tasks };
    delete tasks[id];
    set({ tasks, outbox: enqueue(s.outbox, { key: `DELETE:tasks:${id}`, table: 'tasks', id, method: 'DELETE', path: `/tasks/${id}` }) });
    kick();
  },

  saveNote(patch) {
    const s = get();
    const id = patch.id ?? uuid();
    const now = Date.now();
    const old: Note | undefined = s.notes[id];
    const base: Note = {
      id,
      title: '',
      body: null,
      pinned: 0,
      color: 'none',
      created_by: s.me?.id ?? null,
      created_at: now,
      updated_by: null,
      updated_at: now,
      deleted: 0,
    };
    const note: Note = { ...base, ...old, ...patch, updated_by: s.me?.id ?? null, updated_at: now };
    set({
      notes: { ...s.notes, [id]: note },
      outbox: enqueue(s.outbox, {
        key: `PUT:notes:${id}`,
        table: 'notes',
        id,
        method: 'PUT',
        path: `/notes/${id}`,
        body: { title: note.title, body: note.body, pinned: note.pinned, color: note.color },
      }),
    });
    kick();
    return note;
  },

  deleteNote(id) {
    const s = get();
    const notes = { ...s.notes };
    delete notes[id];
    set({ notes, outbox: enqueue(s.outbox, { key: `DELETE:notes:${id}`, table: 'notes', id, method: 'DELETE', path: `/notes/${id}` }) });
    kick();
  },

  addComment(taskId, body) {
    const s = get();
    const id = uuid();
    const now = Date.now();
    const c: Comment = { id, task_id: taskId, user_id: s.me!.id, body, created_at: now, updated_at: now, deleted: 0 };
    set({
      comments: { ...s.comments, [id]: c },
      outbox: enqueue(s.outbox, { key: `PUT:comments:${id}`, table: 'comments', id, method: 'PUT', path: `/comments/${id}`, body: { task_id: taskId, body } }),
    });
    kick();
  },

  deleteComment(id) {
    const s = get();
    const comments = { ...s.comments };
    delete comments[id];
    set({ comments, outbox: enqueue(s.outbox, { key: `DELETE:comments:${id}`, table: 'comments', id, method: 'DELETE', path: `/comments/${id}` }) });
    kick();
  },

  updateEmail(id, patch) {
    const s = get();
    const mail = s.emails[id];
    if (!mail) return;
    const next: Email = { ...mail, ...patch, updated_at: Date.now() };
    if (patch.status === 'done') {
      next.done_by = s.me?.id ?? null;
      next.done_at = Date.now();
    }
    set({
      emails: { ...s.emails, [id]: next },
      outbox: enqueue(s.outbox, { key: `PATCH:emails:${id}`, table: 'emails', id, method: 'PATCH', path: `/emails/${id}`, body: patch }),
    });
    updateBadge();
    kick();
  },

  setMe(user, prefs) {
    set((s) => ({ me: user, prefs: prefs ?? s.prefs, users: { ...s.users, [user.id]: user } }));
  },
}));

useStore.subscribe((state) => persist(state));

/** Outbox an den Server schicken. */
async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (useStore.getState().outbox.length) {
      const op = useStore.getState().outbox[0];
      try {
        const row = await api<Record<string, unknown>>(op.method, op.path, op.body);
        useStore.setState((s) => {
          const outbox = s.outbox.filter((o) => o !== op);
          const stillPending = outbox.some((o) => o.id === op.id);
          if (op.method === 'DELETE' || stillPending || !row || !('id' in row)) return { outbox };
          return { outbox, [op.table]: { ...s[op.table], [op.id]: row } } as Partial<State>;
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e;
        if (isOffline(e) || (e instanceof ApiError && e.status === 429)) throw e;
        // Vom Server abgelehnt (z. B. ungültig) – verwerfen und neu laden
        useStore.setState((s) => ({ outbox: s.outbox.filter((o) => o !== op), cursor: 0 }));
        toast((e as Error).message || 'Änderung konnte nicht gespeichert werden.', 'error');
      }
    }
  } finally {
    flushing = false;
  }
}

let kickTimer: number | undefined;
/** Nach einer lokalen Änderung zeitnah synchronisieren. */
function kick() {
  window.clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => void useStore.getState().sync(), 250);
}

export function openImportantCount(emails: Record<string, Email>): number {
  let n = 0;
  for (const m of Object.values(emails)) if (m.important && !m.answered && m.status === 'open') n++;
  return n;
}

function updateBadge() {
  const n = openImportantCount(useStore.getState().emails);
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n);
    else void nav.clearAppBadge?.();
  } catch {
    /* nicht unterstützt */
  }
}

export function sortTasks(list: Task[]): Task[] {
  const prio = { high: 0, normal: 1, low: 2 } as const;
  return [...list].sort((a, b) => {
    if (a.status === 'done' && b.status === 'done') return (b.completed_at ?? 0) - (a.completed_at ?? 0);
    const ad = a.due_date ?? '9999';
    const bd = b.due_date ?? '9999';
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (prio[a.priority] !== prio[b.priority]) return prio[a.priority] - prio[b.priority];
    return b.created_at - a.created_at;
  });
}
