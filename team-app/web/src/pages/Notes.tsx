import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NotebookPen, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { AutoTextarea, Avatar, Button, cx, EmptyState, IconButton, Sheet } from '../components/ui';
import { useStore } from '../lib/store';
import type { Note, NoteColor } from '../lib/types';
import { relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

const COLORS: { value: NoteColor; label: string }[] = [
  { value: 'none', label: 'Weiß' },
  { value: 'cream', label: 'Creme' },
  { value: 'sand', label: 'Sand' },
  { value: 'blue', label: 'Blau' },
  { value: 'sage', label: 'Salbei' },
  { value: 'rose', label: 'Rosé' },
];

export default function Notes() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notesMap = useStore((s) => s.notes);
  const users = useStore((s) => s.users);
  const saveNote = useStore((s) => s.saveNote);
  const now = useNow();
  const [q, setQ] = useState('');

  const notes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(notesMap)
      .filter((n) => !needle || `${n.title} ${n.body ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at);
  }, [notesMap, q]);
  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);

  function create() {
    const n = saveNote({ title: '', body: '' });
    navigate(`/notizen/${n.id}`);
  }

  const grid = (list: Note[]) => (
    <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
      {list.map((n) => (
        <button
          key={n.id}
          onClick={() => navigate(`/notizen/${n.id}`)}
          className={cx(`n-${n.color}`, 'mb-4 block w-full break-inside-avoid rounded-2xl border border-line/70 p-4 text-left shadow-card transition-shadow hover:shadow-lift')}
          style={{ background: 'var(--n-bg)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display text-[21px] font-semibold leading-tight text-ink">{n.title || 'Ohne Titel'}</h2>
            {n.pinned ? <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-3" /> : null}
          </div>
          {n.body && <p className="mt-2 line-clamp-[9] whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{n.body}</p>}
          <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-3">
            <Avatar user={users[n.updated_by ?? '']} size={18} />
            {relative(n.updated_at, now)}
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Notizen"
        subtitle="Pläne, Ideen und alles, was ihr festhalten wollt"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={create}>
            Neue Notiz
          </Button>
        }
      />
      {Object.keys(notesMap).length > 3 && (
        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input className="field pl-10" placeholder="Notizen durchsuchen" aria-label="Notizen durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {pinned.length > 0 && (
        <>
          <p className="eyebrow mb-3">Angepinnt</p>
          {grid(pinned)}
          {others.length > 0 && <p className="eyebrow mb-3 mt-2">Weitere</p>}
        </>
      )}
      {grid(others)}
      {notes.length === 0 && (
        <EmptyState
          icon={<NotebookPen className="h-6 w-6" />}
          title={q ? 'Nichts gefunden' : 'Noch keine Notizen'}
          text={q ? undefined : 'Haltet hier eure Planungen fest – z. B. Ideen für neue Düfte, Kampagnen oder Messen.'}
          action={!q && <Button onClick={create}>Erste Notiz schreiben</Button>}
        />
      )}
      <NoteEditor
        noteId={id ?? null}
        onClose={() => {
          // Leere Notizen nicht aufheben
          const n = id ? useStore.getState().notes[id] : undefined;
          if (n && !n.title.trim() && !(n.body ?? '').trim()) useStore.getState().deleteNote(n.id);
          navigate('/notizen');
        }}
      />
    </>
  );
}

function NoteEditor({ noteId, onClose }: { noteId: string | null; onClose: () => void }) {
  const note = useStore((s) => (noteId ? s.notes[noteId] : undefined));
  return (
    <Sheet open={!!noteId && !!note} onClose={onClose} wide title={<span className="eyebrow">Notiz</span>}>
      {note && <NoteForm key={note.id} note={note} onClose={onClose} />}
    </Sheet>
  );
}

function NoteForm({ note, onClose }: { note: Note; onClose: () => void }) {
  const { saveNote, deleteNote } = useStore.getState();
  const users = useStore((s) => s.users);
  const pending = useStore((s) => s.outbox.some((o) => o.id === note.id));
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body ?? '');
  const dirty = useRef(false);
  const now = useNow(30000);

  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => saveNote({ id: note.id, title, body }), 700);
    return () => window.clearTimeout(t);
  }, [title, body, note.id, saveNote]);

  useEffect(() => {
    if (dirty.current) return;
    setTitle(note.title);
    setBody(note.body ?? '');
  }, [note.title, note.body]);

  // Beim Schließen noch nicht gespeicherten Text sichern
  const latest = useRef({ title, body });
  latest.current = { title, body };
  useEffect(
    () => () => {
      if (dirty.current && useStore.getState().notes[note.id]) saveNote({ id: note.id, ...latest.current });
    },
    [note.id, saveNote],
  );

  return (
    <div className={cx(`n-${note.color}`, '-mx-5 -mb-6 min-h-[60dvh] px-5 pb-8 pt-2 lg:-mx-6 lg:px-6')} style={{ background: 'var(--n-bg)' }}>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.value}
              aria-label={`Farbe ${c.label}`}
              title={c.label}
              onClick={() => saveNote({ id: note.id, color: c.value })}
              className={cx(`n-${c.value}`, 'h-6 w-6 rounded-full border transition-transform hover:scale-110', note.color === c.value ? 'border-accent ring-2 ring-accent/30' : 'border-line')}
              style={{ background: 'var(--n-bg)' }}
            />
          ))}
        </div>
        <div className="flex-1" />
        <IconButton label={note.pinned ? 'Nicht mehr anpinnen' : 'Anpinnen'} onClick={() => saveNote({ id: note.id, pinned: note.pinned ? 0 : 1 })}>
          {note.pinned ? <PinOff className="h-[18px] w-[18px]" /> : <Pin className="h-[18px] w-[18px]" />}
        </IconButton>
        <IconButton
          label="Löschen"
          className="hover:text-bad"
          onClick={() => {
            const snap = { ...note, title, body };
            dirty.current = false;
            deleteNote(note.id);
            onClose();
            toast('Notiz gelöscht', 'info', { label: 'Rückgängig', run: () => saveNote({ ...snap, deleted: 0 }) });
          }}
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
      <AutoTextarea
        autoFocus={!note.title && !note.body}
        value={title}
        onChange={(e) => {
          dirty.current = true;
          setTitle(e.target.value.replace(/\n/g, ' '));
        }}
        placeholder="Titel"
        className="w-full bg-transparent font-display text-[30px] font-semibold leading-tight text-ink placeholder:text-ink-3 focus:outline-none"
      />
      <AutoTextarea
        value={body}
        onChange={(e) => {
          dirty.current = true;
          setBody(e.target.value);
        }}
        placeholder="Schreib los …"
        className="mt-3 min-h-[40dvh] w-full bg-transparent text-[16px] leading-[1.7] text-ink placeholder:text-ink-3 focus:outline-none"
      />
      <div className="mt-4 flex items-center justify-between text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <Avatar user={users[note.updated_by ?? '']} size={18} />
          Zuletzt {relative(note.updated_at, now)}
        </span>
        <span>{pending ? 'Wird gespeichert …' : 'Gespeichert ✓'}</span>
      </div>
      <div className="mt-4 lg:hidden">
        <Button variant="secondary" className="w-full" onClick={onClose}>
          Fertig
        </Button>
      </div>
    </div>
  );
}
