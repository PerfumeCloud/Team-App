import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderInput,
  FolderPlus,
  Inbox as InboxIcon,
  Lock,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { Button, cx, EmptyState, IconButton, Sheet, Spinner } from './ui';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

// ---------------- Typen ----------------

export type FolderSpecial = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | null;

export interface MailFolder {
  path: string;
  name: string;
  parent: string | null;
  special: FolderSpecial;
  selectable: boolean;
  depth: number;
  children: number;
}

export interface FolderList {
  box: string;
  delimiter: string;
  folders: MailFolder[];
  sent: string | null;
  at: number;
}

interface FolderMessage {
  uid: number;
  from_name: string;
  from_email: string;
  to: { name: string; email: string }[];
  subject: string;
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
}

interface FolderPage {
  box: string;
  folder: MailFolder;
  total: number;
  page: number;
  pages: number;
  messages: FolderMessage[];
}

interface FolderMail extends Omit<FolderMessage, 'seen' | 'flagged' | 'answered' | 'snippet'> {
  cc: { name: string; email: string }[];
  text: string;
  attachments: { name: string; size: number }[];
}

/** Wo man im Postfach gerade ist: Posteingang der App (ggf. nur ein Postfach) oder ein Ordner auf dem Mailserver. */
export type Place = { kind: 'inbox'; box: string } | { kind: 'folder'; box: string; path: string; name: string; special: FolderSpecial };

export const boxLabel = (box: string, my?: string | null) => (box === my ? 'Mein Postfach' : `${box.split('@')[0]}@`);

const ICONS: Record<string, ReactNode> = {
  inbox: <InboxIcon className="h-4 w-4" />,
  sent: <Send className="h-4 w-4" />,
  drafts: <SquarePen className="h-4 w-4" />,
  archive: <Archive className="h-4 w-4" />,
  junk: <ShieldAlert className="h-4 w-4" />,
  trash: <Trash2 className="h-4 w-4" />,
};
const folderIcon = (f: Pick<MailFolder, 'special'>) => ICONS[f.special ?? ''] ?? <Folder className="h-4 w-4" />;

// ---------------- Ordnerliste (gemeinsam für Navigation und „Verschieben“) ----------------

const cache = new Map<string, FolderList>();
const listeners = new Set<() => void>();

async function loadFolders(box: string, fresh = false): Promise<FolderList> {
  const r = await api<FolderList>('GET', `/mail/folders?box=${encodeURIComponent(box)}${fresh ? '&fresh=1' : ''}`);
  cache.set(box, r);
  listeners.forEach((l) => l());
  return r;
}

/** Nach Anlegen/Umbenennen/Löschen: neue Liste übernehmen und alle Ansichten aktualisieren. */
function putFolders(r: FolderList) {
  cache.set(r.box, r);
  listeners.forEach((l) => l());
}

export function useFolders(box: string | null) {
  const [, tick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (!box || cache.has(box)) return;
    loadFolders(box)
      .then(() => setError(null))
      .catch((e) => setError((e as Error).message));
  }, [box]);
  return { list: box ? (cache.get(box) ?? null) : null, error, reload: () => box && loadFolders(box, true).catch((e) => toast((e as Error).message, 'error')) };
}

// ---------------- Navigation ----------------

export function FolderNav({
  boxes,
  myMailbox,
  place,
  openCount,
  onPlace,
}: {
  boxes: string[];
  myMailbox?: string | null;
  place: Place;
  openCount: (box: string) => number;
  onPlace: (p: Place) => void;
}) {
  const [editing, setEditing] = useState<{ box: string; parent: string | null; folder?: MailFolder } | null>(null);
  const isInbox = (box: string) => place.kind === 'inbox' && place.box === box;
  return (
    <nav aria-label="Postfächer und Ordner" className="space-y-4">
      {boxes.length > 1 && (
        <NavItem
          active={isInbox('all')}
          icon={<InboxIcon className="h-4 w-4" />}
          count={openCount('all')}
          onClick={() => onPlace({ kind: 'inbox', box: 'all' })}
        >
          Alle Posteingänge
        </NavItem>
      )}
      {boxes.map((box) => (
        <BoxFolders
          key={box}
          box={box}
          label={boxLabel(box, myMailbox)}
          personal={box === myMailbox}
          place={place}
          count={openCount(box)}
          onPlace={onPlace}
          onNew={(parent) => setEditing({ box, parent })}
          onEdit={(folder) => setEditing({ box, parent: folder.parent, folder })}
        />
      ))}
      <FolderEditSheet edit={editing} onClose={() => setEditing(null)} onPlace={onPlace} place={place} />
    </nav>
  );
}

function NavItem({
  active,
  icon,
  count,
  depth = 0,
  onClick,
  children,
  action,
  muted,
}: {
  active: boolean;
  icon: ReactNode;
  count?: number;
  depth?: number;
  onClick?: () => void;
  children: ReactNode;
  action?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={cx('group flex items-center rounded-xl', active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2')}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-current={active ? 'page' : undefined}
        style={{ paddingLeft: 10 + depth * 16 }}
        className={cx('flex min-h-[40px] min-w-0 flex-1 items-center gap-2.5 py-2 pr-2 text-left text-[14px]', active && 'font-medium', muted && 'text-ink-3')}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {!!count && <span className={cx('tnum shrink-0 text-[12px]', active ? 'text-accent' : 'text-ink-3')}>{count}</span>}
      </button>
      {action}
    </div>
  );
}

function BoxFolders({
  box,
  label,
  personal,
  place,
  count,
  onPlace,
  onNew,
  onEdit,
}: {
  box: string;
  label: string;
  personal: boolean;
  place: Place;
  count: number;
  onPlace: (p: Place) => void;
  onNew: (parent: string | null) => void;
  onEdit: (f: MailFolder) => void;
}) {
  const [open, setOpen] = useState(true);
  const { list, error, reload } = useFolders(open ? box : null);
  const active = (f: MailFolder) => place.kind === 'folder' && place.box === box && place.path === f.path;
  return (
    <div>
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-[32px] min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3"
        >
          <ChevronDown className={cx('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
          {personal && <Lock className="h-3 w-3 shrink-0" />}
          <span className="truncate">{label}</span>
        </button>
        {open && (
          <IconButton label={`Ordner in ${label} neu laden`} className="h-7 w-7" onClick={() => void reload()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-0.5">
          {!list && !error && (
            <div className="px-3 py-2">
              <Spinner />
            </div>
          )}
          {error && <p className="px-3 py-1 text-[12px] text-bad">{error}</p>}
          {list?.folders.map((f) =>
            f.special === 'inbox' ? (
              <NavItem
                key={f.path}
                active={place.kind === 'inbox' && place.box === box}
                icon={folderIcon(f)}
                count={count}
                depth={f.depth}
                onClick={() => onPlace({ kind: 'inbox', box })}
              >
                Posteingang
              </NavItem>
            ) : (
              <NavItem
                key={f.path}
                active={active(f)}
                icon={folderIcon(f)}
                depth={f.depth}
                muted={!f.selectable}
                onClick={f.selectable ? () => onPlace({ kind: 'folder', box, path: f.path, name: f.name, special: f.special }) : undefined}
                action={
                  !f.special && (
                    <IconButton
                      label={`„${f.name}“ bearbeiten`}
                      className="mr-1 h-7 w-7 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                      onClick={() => onEdit(f)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                  )
                }
              >
                {f.name}
              </NavItem>
            ),
          )}
          {list && (
            <button
              type="button"
              onClick={() => onNew(null)}
              className="flex min-h-[36px] w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <FolderPlus className="h-4 w-4" /> Neuer Ordner
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Ordner anlegen (auch als Unterordner), umbenennen oder löschen. */
function FolderEditSheet({
  edit,
  onClose,
  onPlace,
  place,
}: {
  edit: { box: string; parent: string | null; folder?: MailFolder } | null;
  onClose: () => void;
  onPlace: (p: Place) => void;
  place: Place;
}) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const { list } = useFolders(edit?.box ?? null);
  useEffect(() => {
    setName(edit?.folder?.name ?? '');
    setParent(edit?.parent ?? '');
  }, [edit]);
  if (!edit) return null;
  const folder = edit.folder;
  // Als Elternordner taugt jeder Ordner außer Gesendet & Co. (und nicht der Ordner selbst)
  const parents = (list?.folders ?? []).filter((f) => (!f.special || f.special === 'inbox') && f.path !== folder?.path);

  async function run(key: string, fn: () => Promise<FolderList & { created?: string; renamed?: string }>) {
    setBusy(key);
    try {
      const r = await fn();
      putFolders(r);
      if (key === 'create' && r.created) {
        toast(`Ordner „${name.trim()}“ angelegt`, 'success');
        onPlace({ kind: 'folder', box: edit!.box, path: r.created, name: name.trim(), special: null });
      } else if (key === 'rename' && r.renamed) {
        toast('Umbenannt', 'success');
        if (place.kind === 'folder' && place.path === folder?.path)
          onPlace({ kind: 'folder', box: edit!.box, path: r.renamed, name: name.trim(), special: null });
      } else if (key === 'delete') {
        toast('Ordner gelöscht', 'success');
        if (place.kind === 'folder' && place.path === folder?.path) onPlace({ kind: 'inbox', box: edit!.box });
      }
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open onClose={onClose} title={<h2 className="font-display text-[22px] font-semibold text-ink">{folder ? 'Ordner bearbeiten' : 'Neuer Ordner'}</h2>}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (folder) void run('rename', () => api('PATCH', '/mail/folders', { box: edit.box, path: folder.path, name }));
          else void run('create', () => api('POST', '/mail/folders', { box: edit.box, parent: parent || null, name }));
        }}
      >
        <p className="text-[13px] text-ink-2">
          {boxLabel(edit.box)} · Der Ordner liegt direkt auf dem Mailserver – ihr seht ihn genauso in Outlook, auf dem iPhone und im Webmail.
        </p>
        <label className="block">
          <span className="label">Name</span>
          <input
            className="field mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
            placeholder="z. B. Lieferanten"
            required
          />
        </label>
        {!folder && (
          <label className="block">
            <span className="label">Liegt in</span>
            <select className="field mt-1" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">Oberste Ebene</option>
              {parents.map((f) => (
                <option key={f.path} value={f.path}>
                  {' '.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === 'create' || busy === 'rename'} disabled={!name.trim()}>
            {folder ? 'Umbenennen' : 'Anlegen'}
          </Button>
          {folder && (
            <Button
              type="button"
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              loading={busy === 'delete'}
              onClick={() => {
                if (confirm(`Ordner „${folder.name}“ löschen? Das geht nur, wenn er leer ist.`))
                  void run('delete', () => api('POST', '/mail/folders/delete', { box: edit.box, path: folder.path }));
              }}
            >
              Löschen
            </Button>
          )}
        </div>
        {folder && (
          <p className="text-[12px] text-ink-3">Löschen geht nur bei leeren Ordnern ohne Unterordner – so verschwindet nie versehentlich eine Mail.</p>
        )}
      </form>
    </Sheet>
  );
}

// ---------------- Verschieben ----------------

/** Ordner wählen, in den eine Mail soll – mit „Neuer Ordner“ direkt hier. */
export function MoveSheet({
  box,
  from,
  open,
  onClose,
  onPick,
}: {
  box: string;
  from: string;
  open: boolean;
  onClose: () => void;
  onPick: (f: MailFolder) => Promise<void>;
}) {
  const { list, error } = useFolders(open ? box : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setNewName(null);
  }, [open]);
  const targets = (list?.folders ?? []).filter((f) => f.path !== from && f.special !== 'drafts');

  async function pick(f: MailFolder) {
    setBusy(f.path);
    try {
      await onPick(f);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function createAndMove() {
    const name = (newName ?? '').trim();
    if (!name) return;
    setBusy('new');
    try {
      const r = await api<FolderList & { created: string }>('POST', '/mail/folders', { box, name });
      putFolders(r);
      const f = r.folders.find((x) => x.path === r.created);
      if (f) await onPick(f);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={<h2 className="font-display text-[22px] font-semibold text-ink">Verschieben nach …</h2>}>
      {!list && !error && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <p className="text-[14px] text-bad">{error}</p>}
      {list && (
        <ul className="space-y-0.5">
          {targets.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                disabled={!f.selectable || busy !== null}
                onClick={() => void pick(f)}
                style={{ paddingLeft: 12 + f.depth * 18 }}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-xl pr-3 text-left text-[15px] text-ink transition-colors hover:bg-surface-2 disabled:text-ink-3 disabled:hover:bg-transparent"
              >
                <span className="text-ink-2">{folderIcon(f)}</span>
                <span className="min-w-0 flex-1 truncate">{f.special === 'inbox' ? 'Posteingang' : f.name}</span>
                {busy === f.path && <Spinner />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list && (
        <div className="mt-4 border-t border-line pt-4">
          {newName === null ? (
            <Button variant="secondary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setNewName('')}>
              Neuer Ordner
            </Button>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void createAndMove();
              }}
            >
              <input
                className="field min-w-0 flex-1"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name des Ordners"
                maxLength={60}
                autoFocus
              />
              <Button type="submit" loading={busy === 'new'} disabled={!newName.trim()}>
                Anlegen & verschieben
              </Button>
            </form>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------------- Ordner ansehen ----------------

export function FolderView({ box, path, name, special, boxName }: { box: string; path: string; name: string; special: FolderSpecial; boxName: string }) {
  const now = useNow();
  const [data, setData] = useState<FolderPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<FolderMessage | null>(null);
  const [moving, setMoving] = useState<FolderMessage | null>(null);
  const sent = special === 'sent' || special === 'drafts';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api<FolderPage>(
          'GET',
          `/mail/folder?box=${encodeURIComponent(box)}&path=${encodeURIComponent(path)}&page=${page}&q=${encodeURIComponent(search)}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [box, path, page, search]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setPage(1);
    setSearch('');
    setQuery('');
    setData(null);
  }, [box, path]);

  const move = async (m: FolderMessage, to: MailFolder) => {
    await api('POST', '/mail/folder/move', { box, from: path, uids: [m.uid], to: to.path });
    toast(`Nach „${to.special === 'inbox' ? 'Posteingang' : to.name}“ verschoben`, 'success');
    setOpened(null);
    void load();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[22px] font-semibold text-ink">
            <span className="text-ink-2">{folderIcon({ special })}</span>
            <span className="truncate">{name}</span>
          </h2>
          <p className="text-[13px] text-ink-3">
            {boxName}
            {data ? ` · ${data.total} ${data.total === 1 ? 'Mail' : 'Mails'}` : ''}
          </p>
        </div>
        <IconButton label="Neu laden" onClick={() => void load()}>
          <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
        </IconButton>
      </div>
      <form
        className="relative mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(query.trim());
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          className="field pl-9"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) setSearch('');
          }}
          placeholder={sent ? 'Empfänger oder Betreff suchen' : 'Absender oder Betreff suchen'}
          aria-label="In diesem Ordner suchen"
        />
      </form>

      {!data && !error && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
      {error && <p className="card p-5 text-[14px] text-bad">{error}</p>}
      {data && data.messages.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Folder className="h-6 w-6" />}
            title={search ? 'Nichts gefunden' : 'Der Ordner ist leer'}
            text={search ? undefined : 'Mails sortierst du über „Verschieben“ an jeder Mail hierher.'}
          />
        </div>
      )}
      {data && data.messages.length > 0 && (
        <ul className="card divide-y divide-line/70">
          {data.messages.map((m) => {
            const who = sent ? m.to.map((t) => t.name || t.email).join(', ') || '(ohne Empfänger)' : m.from_name || m.from_email || 'Unbekannt';
            return (
              <li key={m.uid} className="flex items-start gap-2 p-3 sm:p-4">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpened(m)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cx('truncate text-[15px] text-ink', !m.seen && !sent ? 'font-semibold' : 'font-medium')}>
                      {sent && <span className="font-normal text-ink-3">An: </span>}
                      {who}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-3">{relative(m.date, now)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[14px] text-ink">{m.subject}</div>
                  {m.snippet && <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{m.snippet}</p>}
                </button>
                <IconButton label="Verschieben" className="shrink-0" onClick={() => setMoving(m)}>
                  <FolderInput className="h-4 w-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            icon={<ChevronLeft className="h-4 w-4" />}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Neuere
          </Button>
          <span className="tnum text-[13px] text-ink-3">
            Seite {data.page} von {data.pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
            Ältere <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <FolderMailSheet box={box} path={path} message={opened} sent={sent} onClose={() => setOpened(null)} onMove={() => setMoving(opened)} />
      <MoveSheet box={box} from={path} open={!!moving} onClose={() => setMoving(null)} onPick={(f) => move(moving!, f)} />
    </div>
  );
}

function FolderMailSheet({
  box,
  path,
  message,
  sent,
  onClose,
  onMove,
}: {
  box: string;
  path: string;
  message: FolderMessage | null;
  sent: boolean;
  onClose: () => void;
  onMove: () => void;
}) {
  const [mail, setMail] = useState<FolderMail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMail(null);
    setError(null);
    if (!message) return;
    api<FolderMail>('GET', `/mail/folder/message?box=${encodeURIComponent(box)}&path=${encodeURIComponent(path)}&uid=${message.uid}`)
      .then(setMail)
      .catch((e) => setError((e as Error).message));
  }, [box, path, message]);
  if (!message) return null;
  const list = (l: { name: string; email: string }[]) => l.map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(', ');
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={
        <div className="min-w-0">
          <h2 className="font-display text-[20px] font-semibold leading-snug text-ink">{message.subject}</h2>
        </div>
      }
    >
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-ink-3">Von</dt>
        <dd className="min-w-0 break-words text-ink">{message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email}</dd>
        <dt className="text-ink-3">An</dt>
        <dd className="min-w-0 break-words text-ink">{list(mail?.to ?? message.to) || '–'}</dd>
        {mail && mail.cc.length > 0 && (
          <>
            <dt className="text-ink-3">Kopie</dt>
            <dd className="min-w-0 break-words text-ink">{list(mail.cc)}</dd>
          </>
        )}
        <dt className="text-ink-3">{sent ? 'Gesendet' : 'Datum'}</dt>
        <dd className="text-ink">{new Date(message.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
      </dl>
      {!mail && !error && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <p className="text-[14px] text-bad">{error}</p>}
      {mail && (
        <>
          <div className="whitespace-pre-wrap break-words rounded-2xl bg-surface-2/60 p-4 text-[14px] leading-relaxed text-ink">
            {mail.text || '(kein Text)'}
          </div>
          {mail.attachments.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {mail.attachments.map((a, i) => (
                <li key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[12px] text-ink-2">
                  <Paperclip className="h-3 w-3 shrink-0" /> <span className="truncate">{a.name}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" icon={<FolderInput className="h-4 w-4" />} onClick={onMove}>
          Verschieben
        </Button>
      </div>
      {!sent && (
        <p className="mt-3 text-[12px] text-ink-3">
          Zum Antworten die Mail zurück in den Posteingang verschieben – dort gibt es Textbausteine und Kundeninfos.
        </p>
      )}
    </Sheet>
  );
}
