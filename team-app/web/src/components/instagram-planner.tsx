import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Bookmark,
  CalendarClock,
  Check,
  CircleAlert,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  GalleryHorizontal,
  Hash,
  Heart,
  Image as ImageIcon,
  ImagePlus,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { InstagramIcon } from './instagram-icon';
import { AutoTextarea, Button, Chip, cx, IconButton, Segmented, Sheet, Spinner } from './ui';
import { api } from '../lib/api';
import { dateTime, euro, int } from '../lib/format';
import { CROPS, fetchShopifyImage, toInstagramJpeg, uploadInstagramImage, type Crop } from '../lib/image';
import { toast } from '../lib/toast';
import type { IgPost, IgPostKind, IgPostList, IgPostStatus, IgProduct } from '../lib/types';

const KIND_LABEL: Record<IgPostKind, string> = { image: 'Bild', carousel: 'Karussell', story: 'Story', reel: 'Reel' };
const KIND_ICON: Record<IgPostKind, typeof ImageIcon> = { image: ImageIcon, carousel: GalleryHorizontal, story: Smartphone, reel: Clapperboard };
const KIND_HINT: Record<IgPostKind, string> = {
  image: 'Ein Foto im Feed',
  carousel: '2 bis 10 Fotos zum Wischen',
  story: 'Hochformat, 24 Stunden sichtbar',
  reel: 'Video – mit Erinnerung, ihr postet selbst',
};

const STATUS_TONE: Record<IgPostStatus, 'neutral' | 'warn' | 'accent' | 'good' | 'bad'> = {
  draft: 'neutral',
  review: 'warn',
  approved: 'accent',
  publishing: 'accent',
  published: 'good',
  failed: 'bad',
};

type Action = 'submit' | 'approve' | 'reject' | 'cancel' | 'retry' | 'done';

const localInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Morgen 18 Uhr als Vorschlag für den Zeitpunkt */
const tomorrowEvening = () => {
  const d = new Date(Date.now() + 86400000);
  d.setHours(18, 0, 0, 0);
  return d.getTime();
};

const countHashtags = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
const countMentions = (s: string) => (s.match(/(^|\s)@[\w.]+/gu) ?? []).length;
const feedRatioOk = (w: number, h: number) => w / Math.max(1, h) >= 0.79 && w / Math.max(1, h) <= 1.92;

/** Was Instagram vor dem Veröffentlichen verlangt – dieselben Regeln prüft der Server. */
function problems(kind: IgPostKind, mode: 'auto' | 'manual', caption: string, images: IgPost['images']): string[] {
  const out: string[] = [];
  if (mode === 'manual') return out;
  if (kind !== 'story' && caption.trim() === '') out.push('Text für den Beitrag fehlt.');
  if (kind === 'image' && images.length === 0) out.push('Bitte ein Bild hinzufügen.');
  if (kind === 'carousel' && images.length < 2) out.push('Ein Karussell braucht mindestens 2 Bilder.');
  if (kind === 'story' && images.length !== 1) out.push(images.length ? 'Eine Story hat genau ein Bild.' : 'Bitte ein Bild hinzufügen.');
  if (kind !== 'story') {
    images.forEach((img, i) => {
      if (!feedRatioOk(img.w, img.h)) out.push(`Bild ${i + 1} ist zu hoch oder zu breit für den Feed – bitte entfernen und mit 4:5 oder 1:1 neu hinzufügen.`);
    });
  }
  return out;
}

export default function Planner({ bestTime }: { bestTime: string | null }) {
  const [list, setList] = useState<IgPostList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ post: IgPost | null; kind: IgPostKind } | null>(null);
  const [review, setReview] = useState<IgPost | null>(null);
  const [manual, setManual] = useState<IgPost | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      setList(await api<IgPostList>('GET', '/instagram/posts'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Während veröffentlicht wird, regelmäßig nachsehen
  const publishing = list?.posts.some((p) => p.status === 'publishing') ?? false;
  useEffect(() => {
    if (!publishing) return;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [publishing, load]);

  async function act(p: IgPost, action: Action, body?: Record<string, unknown>) {
    setBusy(`${p.id}:${action}`);
    try {
      const r = await api<IgPost>('POST', `/instagram/posts/${p.id}/${action}`, body ?? {});
      const later = r.scheduled_at !== null && r.scheduled_at > Date.now();
      const published = r.status === 'published' ? 'Auf Instagram veröffentlicht' : null;
      const failed = r.status === 'failed' ? `Nicht veröffentlicht: ${r.error ?? 'unbekannter Fehler'}` : null;
      const msg: Record<Action, string> = {
        submit: 'Zur Prüfung gegeben',
        approve:
          failed ??
          published ??
          (r.mode === 'manual'
            ? later
              ? `Freigegeben – Erinnerung am ${dateTime(r.scheduled_at!)}`
              : 'Freigegeben – jetzt in der Instagram-App posten'
            : later
              ? `Freigegeben – erscheint am ${dateTime(r.scheduled_at!)}`
              : 'Freigegeben – wird gleich veröffentlicht'),
        reject: 'Zurückgegeben',
        cancel: 'Zurückgezogen – wieder ein Entwurf',
        retry: failed ?? published ?? 'Wird erneut versucht',
        done: 'Als gepostet markiert',
      };
      toast(msg[action], failed ? 'error' : 'success');
      setReview(null);
      setManual(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: IgPost) {
    if (!window.confirm('Diesen Beitrag löschen?')) return;
    try {
      await api('DELETE', `/instagram/posts/${p.id}`);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('Die Datei ist kein gültiges JSON.');
      }
      const r = await api<IgPostList>('POST', '/instagram/posts/import', Array.isArray(data) ? { posts: data } : data);
      setList(r);
      toast(`${r.created ?? 0} ${r.created === 1 ? 'Entwurf' : 'Entwürfe'} übernommen – bitte prüfen und zur Freigabe geben`, 'success');
      if (r.notes?.length) toast(r.notes.join(' · '), 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function open(post: IgPost | null, kind: IgPostKind) {
    dirty.current = false;
    setEditing({ post, kind });
  }

  function closeEditor() {
    if (dirty.current && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    setEditing(null);
    void load();
  }

  if (!list) return <div className="flex justify-center py-20">{error ? <p className="max-w-md text-center text-bad">{error}</p> : <Spinner />}</div>;

  const byTime = (a: IgPost, b: IgPost) => (a.scheduled_at ?? a.updated_at) - (b.scheduled_at ?? b.updated_at);
  const groups: { key: string; title: string; items: IgPost[]; hint?: string }[] = [
    {
      key: 'review',
      title: 'Zur Prüfung',
      items: list.posts.filter((p) => p.status === 'review'),
      hint: list.four_eyes ? 'Vier-Augen-Prinzip: Freigeben kann nur jemand anderes als die Person, die den Beitrag vorbereitet hat.' : undefined,
    },
    { key: 'failed', title: 'Nicht veröffentlicht', items: list.posts.filter((p) => p.status === 'failed') },
    { key: 'draft', title: 'Entwürfe', items: list.posts.filter((p) => p.status === 'draft') },
    { key: 'planned', title: 'Freigegeben & geplant', items: list.posts.filter((p) => p.status === 'approved' || p.status === 'publishing').sort(byTime) },
    {
      key: 'published',
      title: 'Veröffentlicht',
      items: list.posts.filter((p) => p.status === 'published'),
      hint: 'Die letzten 60 Tage. Zahlen kommen mit dem stündlichen Abgleich.',
    },
  ];

  return (
    <div className="space-y-5">
      <section className="card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="font-display text-[23px] font-semibold text-ink">Beiträge planen</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
              Ablauf: vorbereiten → zur Prüfung geben → freigeben. Bilder, Karussells und Storys veröffentlicht die App nach der Freigabe selbst – sofort oder
              zum geplanten Zeitpunkt. Reels postet ihr in der Instagram-App, die App erinnert euch.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => open(null, 'image')}>
              Neuer Beitrag
            </Button>
            <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} loading={importing} onClick={() => fileRef.current?.click()}>
              Entwürfe importieren
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as IgPostKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                onClick={() => open(null, k)}
                title={KIND_HINT[k]}
                className="flex h-9 items-center gap-2 rounded-full border border-line px-3 text-[13px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
              >
                <Icon className="h-3.5 w-3.5" />
                {KIND_LABEL[k]}
                {k === 'reel' && <span className="text-ink-3">· Erinnerung</span>}
              </button>
            );
          })}
        </div>
        {bestTime && (
          <p className="mt-3 flex items-start gap-1.5 text-[13px] text-ink-2">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> Laut eurer Auswertung erreichen Beiträge {bestTime} die meisten Konten.
          </p>
        )}
        {!list.connected && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warn/10 px-3 py-2 text-[13px] text-warn">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Instagram ist nicht verbunden. Entwürfe könnt ihr schon vorbereiten – automatisch
            veröffentlichen geht erst nach dem Verbinden.
          </p>
        )}
      </section>

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.key}>
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="section-title">{g.title}</h2>
                <span className="tnum text-[13px] text-ink-3">{g.items.length}</span>
              </div>
              {g.hint && <p className="mb-2 px-1 text-[13px] text-ink-3">{g.hint}</p>}
              <ul className="space-y-3">
                {g.items.map((p) => (
                  <PostCard
                    key={p.id}
                    p={p}
                    list={list}
                    busy={busy}
                    onAct={act}
                    onEdit={() => open(p, p.kind)}
                    onReview={() => setReview(p)}
                    onManual={() => setManual(p)}
                    onRemove={() => remove(p)}
                  />
                ))}
              </ul>
            </section>
          ),
      )}
      {list.posts.length === 0 && (
        <p className="px-1 text-[14px] text-ink-3">
          Noch keine Beiträge. Lege oben einen an – oder importiere Entwürfe, die Claude für euch vorbereitet hat (JSON-Datei).
        </p>
      )}

      <Sheet
        open={!!editing}
        onClose={closeEditor}
        wide
        title={<h2 className="font-display text-[24px] font-semibold text-ink">{editing?.post ? 'Beitrag bearbeiten' : 'Neuer Beitrag'}</h2>}
      >
        {editing && (
          <Editor
            list={list}
            initial={editing.post}
            initialKind={editing.kind}
            bestTime={bestTime}
            dirty={dirty}
            onDone={async () => {
              dirty.current = false;
              setEditing(null);
              await load();
            }}
          />
        )}
      </Sheet>
      <Sheet open={!!review} onClose={() => setReview(null)} title={<h2 className="font-display text-[24px] font-semibold text-ink">Prüfen & freigeben</h2>}>
        {review && <Review p={review} list={list} busy={busy} onAct={act} />}
      </Sheet>
      <Sheet open={!!manual} onClose={() => setManual(null)} title={<h2 className="font-display text-[24px] font-semibold text-ink">Selbst posten</h2>}>
        {manual && <PostManually p={manual} busy={busy} onAct={act} />}
      </Sheet>
    </div>
  );
}

// ---------------- Karte ----------------

function PostCard({
  p,
  list,
  busy,
  onAct,
  onEdit,
  onReview,
  onManual,
  onRemove,
}: {
  p: IgPost;
  list: IgPostList;
  busy: string | null;
  onAct: (p: IgPost, action: Action, body?: Record<string, unknown>) => Promise<void>;
  onEdit: () => void;
  onReview: () => void;
  onManual: () => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICON[p.kind];
  const mine = p.created_by === list.me.id;
  const canApprove = !list.four_eyes || !mine;
  const thumb = p.images[0];
  return (
    <li className="card p-4">
      <div className="flex items-start gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-2 sm:h-24 sm:w-24">
          {thumb ? (
            <img src={thumb.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-3">
              <Icon className="h-6 w-6" />
            </div>
          )}
          {p.images.length > 1 && (
            <span className="tnum absolute right-1 top-1 rounded-md bg-[rgb(20_20_24/0.6)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {p.images.length}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={STATUS_TONE[p.status]}>{p.status_label}</Chip>
            <Chip icon={<Icon className="h-3 w-3" />}>{KIND_LABEL[p.kind]}</Chip>
            {p.mode === 'manual' && p.status !== 'published' && <Chip icon={<BellRing className="h-3 w-3" />}>Erinnerung</Chip>}
            {p.scheduled_at && p.status !== 'published' && <Chip icon={<CalendarClock className="h-3 w-3" />}>{dateTime(p.scheduled_at)}</Chip>}
            {p.source === 'import' && p.status !== 'published' && <Chip icon={<Sparkles className="h-3 w-3" />}>Importiert</Chip>}
          </div>
          <p className={cx('mt-2 line-clamp-3 whitespace-pre-line text-[14px]', p.caption ? 'text-ink' : 'italic text-ink-3')}>
            {p.caption || 'Noch kein Text'}
          </p>
          {p.note && <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">Notiz: {p.note}</p>}
          <p className="mt-1.5 text-[12px] text-ink-3">
            {p.created_by_name ? `von ${p.created_by_name}` : 'importiert'}
            {p.approved_by_name ? ` · freigegeben von ${p.approved_by_name}` : ''}
            {p.status === 'published' && p.published_at ? ` · veröffentlicht ${dateTime(p.published_at)}` : ''}
          </p>
          {p.status === 'published' && p.metrics && (
            <p className="tnum mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
              {p.metrics.reach !== null && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5 text-ink-3" /> {int(p.metrics.reach)} erreicht
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3.5 w-3.5 text-ink-3" /> {int(p.metrics.likes)}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="h-3.5 w-3.5 text-ink-3" /> {int(p.metrics.comments)}
              </span>
              {p.metrics.saved !== null && (
                <span className="inline-flex items-center gap-1">
                  <Bookmark className="h-3.5 w-3.5 text-ink-3" /> {int(p.metrics.saved)}
                </span>
              )}
            </p>
          )}
          {p.review_note && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-warn/10 px-3 py-2 text-[13px] text-warn">
              <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.review_note}
            </p>
          )}
          {p.error && (p.status === 'failed' || p.status === 'approved') && (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] text-bad">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.error}
              {p.status === 'approved' ? ' – wird gleich noch einmal versucht.' : ''}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.status === 'draft' && (
          <>
            {list.four_eyes ? (
              <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={busy === `${p.id}:submit`} onClick={() => onAct(p, 'submit')}>
                Zur Prüfung geben
              </Button>
            ) : (
              <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={onReview}>
                Prüfen & freigeben
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>
              Bearbeiten
            </Button>
            <IconButton label="Löschen" className="h-8 w-8 hover:text-bad" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </>
        )}
        {p.status === 'review' && (
          <>
            {canApprove ? (
              <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={onReview}>
                Prüfen & freigeben
              </Button>
            ) : (
              <span className="text-[13px] text-ink-3">Wartet auf Freigabe durch eine andere Person</span>
            )}
            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>
              Bearbeiten
            </Button>
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} loading={busy === `${p.id}:cancel`} onClick={() => onAct(p, 'cancel')}>
              Zurückziehen
            </Button>
          </>
        )}
        {p.status === 'approved' && (
          <>
            {p.mode === 'manual' && (
              <Button size="sm" icon={<Smartphone className="h-3.5 w-3.5" />} onClick={onManual}>
                Jetzt posten
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Undo2 className="h-3.5 w-3.5" />}
              loading={busy === `${p.id}:cancel`}
              onClick={() => onAct(p, 'cancel')}
            >
              Zurückziehen
            </Button>
          </>
        )}
        {p.status === 'publishing' && (
          <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Wird gerade auf Instagram veröffentlicht …
          </span>
        )}
        {p.status === 'failed' && (
          <>
            <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === `${p.id}:retry`} onClick={() => onAct(p, 'retry')}>
              Erneut versuchen
            </Button>
            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>
              Bearbeiten
            </Button>
            <IconButton label="Löschen" className="h-8 w-8 hover:text-bad" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </>
        )}
        {p.status === 'published' && p.permalink && (
          <a
            href={p.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:bg-surface-2"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Auf Instagram ansehen
          </a>
        )}
      </div>
    </li>
  );
}

// ---------------- Vorschau ----------------

function Preview({ username, kind, images, caption }: { username: string; kind: IgPostKind; images: IgPost['images']; caption: string }) {
  const [index, setIndex] = useState(0);
  const [more, setMore] = useState(false);
  const i = Math.min(index, Math.max(0, images.length - 1));
  const img = images[i];
  const story = kind === 'story';
  const ratio = story ? 9 / 16 : img ? Math.min(1.91, Math.max(0.8, img.w / Math.max(1, img.h))) : 1;
  const short = caption.length > 125 && !more;
  return (
    <div className={cx('mx-auto overflow-hidden rounded-2xl border border-line bg-surface', story ? 'max-w-[240px]' : 'max-w-[360px]')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <InstagramIcon className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-semibold text-ink">{username || 'euer_konto'}</span>
        {kind === 'reel' && <span className="ml-auto text-[12px] text-ink-3">Reel</span>}
      </div>
      <div className="relative bg-surface-2" style={{ aspectRatio: String(ratio) }}>
        {img ? (
          <img src={img.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[12px] text-ink-3">
            {kind === 'reel' ? <Clapperboard className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
            {kind === 'reel' ? 'Video kommt aus der Instagram-App' : 'Noch kein Bild'}
          </div>
        )}
        {images.length > 1 && (
          <>
            <span className="tnum absolute right-2 top-2 rounded-full bg-[rgb(20_20_24/0.6)] px-2 py-0.5 text-[11px] font-semibold text-white">
              {i + 1}/{images.length}
            </span>
            {i > 0 && (
              <button
                aria-label="Vorheriges Bild"
                onClick={() => setIndex(i - 1)}
                className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {i < images.length - 1 && (
              <button
                aria-label="Nächstes Bild"
                onClick={() => setIndex(i + 1)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
      {!story && (
        <div className="space-y-1.5 px-3 py-2.5">
          <div className="flex gap-3 text-ink">
            <Heart className="h-5 w-5" />
            <MessageCircle className="h-5 w-5" />
            <Send className="h-5 w-5" />
            <Bookmark className="ml-auto h-5 w-5" />
          </div>
          {caption.trim() && (
            <p className="whitespace-pre-line break-words text-[13px] leading-snug text-ink">
              <b className="font-semibold">{username || 'euer_konto'}</b> {short ? caption.slice(0, 125).trimEnd() : caption}
              {short && (
                <button className="ml-1 text-ink-3" onClick={() => setMore(true)}>
                  … mehr
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Editor ----------------

function Editor({
  list,
  initial,
  initialKind,
  bestTime,
  dirty,
  onDone,
}: {
  list: IgPostList;
  initial: IgPost | null;
  initialKind: IgPostKind;
  bestTime: string | null;
  dirty: MutableRefObject<boolean>;
  onDone: () => Promise<void>;
}) {
  const [post, setPost] = useState<IgPost | null>(initial);
  const [kind, setKind] = useState<IgPostKind>(initial?.kind ?? initialKind);
  const [mode, setMode] = useState<'auto' | 'manual'>(initial?.mode ?? (initialKind === 'reel' ? 'manual' : 'auto'));
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [when, setWhen] = useState<'now' | 'later'>(initial ? (initial.scheduled_at ? 'later' : 'now') : 'later');
  const [at, setAt] = useState(localInput(initial?.scheduled_at ?? tomorrowEvening()));
  const [crop, setCrop] = useState<Crop>((initial?.kind ?? initialKind) === 'story' ? '9:16' : '4:5');
  const [uploading, setUploading] = useState<string | null>(null);
  const [shop, setShop] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'submit'>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const images = post?.images ?? [];
  const effectiveMode = kind === 'reel' ? 'manual' : mode;
  const scheduled = when === 'later' ? new Date(at).getTime() : null;
  const past = scheduled !== null && (Number.isNaN(scheduled) || scheduled < Date.now());
  const tags = countHashtags(caption);
  const mentions = countMentions(caption);
  const tooMany = tags > 30 || mentions > 20;
  const issues = problems(kind, effectiveMode, caption, images);
  const canSave = !past && !tooMany && !uploading;
  const hashtagsIn = list.hashtags.trim() !== '' && caption.includes(list.hashtags.trim());
  const cropOptions = kind === 'story' ? CROPS.filter((c) => c.value === '9:16' || c.value === 'original') : CROPS.filter((c) => c.value !== '9:16');

  const touch = () => (dirty.current = true);

  function changeKind(k: IgPostKind) {
    touch();
    setKind(k);
    if (k === 'reel') setMode('manual');
    if (k === 'story' && crop !== '9:16' && crop !== 'original') setCrop('9:16');
    if (k !== 'story' && crop === '9:16') setCrop('4:5');
  }

  async function persist(extra?: Record<string, unknown>): Promise<IgPost> {
    const payload = {
      kind,
      mode: effectiveMode,
      caption,
      note: note.trim() || null,
      scheduled_at: scheduled !== null && !past ? scheduled : null,
      ...extra,
    };
    const r = post ? await api<IgPost>('PUT', `/instagram/posts/${post.id}`, payload) : await api<IgPost>('POST', '/instagram/posts', payload);
    setPost(r);
    setKind(r.kind);
    return r;
  }

  async function addBlobs(blobs: Blob[]) {
    if (!blobs.length) return;
    if (kind === 'story' && images.length + blobs.length > 1) {
      toast('Eine Story hat genau ein Bild – bitte erst das vorhandene entfernen.', 'error');
      return;
    }
    if (images.length + blobs.length > 10) {
      toast('Höchstens 10 Bilder pro Beitrag.', 'error');
      return;
    }
    try {
      // Erst speichern: legt den Entwurf an bzw. übernimmt die Art, die gerade gewählt ist
      setUploading('Wird vorbereitet …');
      let p = await persist();
      const before = p.kind;
      for (let n = 0; n < blobs.length; n++) {
        setUploading(blobs.length > 1 ? `Bild ${n + 1} von ${blobs.length} …` : 'Bild wird hochgeladen …');
        const jpeg = await toInstagramJpeg(blobs[n], crop, kind !== 'story');
        p = await uploadInstagramImage(p.id, jpeg);
        setPost(p);
        setKind(p.kind);
      }
      if (before === 'image' && p.kind === 'carousel') toast('Mehrere Bilder – der Beitrag ist jetzt ein Karussell.', 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(null);
    }
  }

  async function addFromShop(urls: string[]) {
    try {
      setUploading('Produktbilder werden geladen …');
      const blobs: Blob[] = [];
      for (const u of urls) blobs.push(await fetchShopifyImage(u));
      await addBlobs(blobs);
    } catch (e) {
      toast((e as Error).message, 'error');
      setUploading(null);
    }
  }

  async function reorder(tokens: string[]) {
    try {
      await persist({ images: tokens });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  function move(i: number, dir: -1 | 1) {
    const t = images.map((x) => x.token);
    const j = i + dir;
    if (j < 0 || j >= t.length) return;
    [t[i], t[j]] = [t[j], t[i]];
    void reorder(t);
  }

  async function save(submit: boolean) {
    setBusy(submit ? 'submit' : 'save');
    try {
      const p = await persist();
      if (submit) await api('POST', `/instagram/posts/${p.id}/submit`, {});
      toast(submit ? 'Zur Prüfung gegeben' : 'Entwurf gespeichert', 'success');
      await onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  function takeProductText(pr: IgProduct) {
    const text = [`${pr.title}${pr.price !== null ? ` – ${euro(pr.price)}` : ''}`, pr.description, 'Mehr im Shop – Link in der Bio.']
      .filter(Boolean)
      .join('\n\n');
    if (caption.trim() && !window.confirm('Den bisherigen Text durch den Produkttext ersetzen?')) return;
    touch();
    setCaption(text.slice(0, 2200));
  }

  return (
    <div className="space-y-5">
      {post && post.status !== 'draft' && (
        <p className="rounded-xl bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
          Nach einer Änderung wird der Beitrag wieder zum Entwurf und muss erneut geprüft und freigegeben werden.
        </p>
      )}

      <div>
        <span className="label">Art</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(KIND_LABEL) as IgPostKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => changeKind(k)}
                className={cx(
                  'flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  kind === k ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
                )}
              >
                <span className="flex items-center gap-1.5 text-[14px] font-medium">
                  <Icon className="h-4 w-4" /> {KIND_LABEL[k]}
                </span>
                <span className="text-[12px] leading-tight text-ink-3">{KIND_HINT[k]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="label">Veröffentlichen</span>
        {kind === 'reel' ? (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
            Reels postet ihr in der Instagram-App (Video, Musik, Titelbild). Die App erinnert zum geplanten Zeitpunkt und hält Text und Notizen bereit. Bilder
            hier sind optional, z. B. als Vorlage fürs Titelbild.
          </p>
        ) : (
          <>
            <Segmented
              className="w-full"
              value={mode}
              onChange={(v) => {
                touch();
                setMode(v);
              }}
              options={[
                { value: 'auto', label: 'Automatisch' },
                { value: 'manual', label: 'Erinnerung, selbst posten' },
              ]}
            />
            <p className="mt-1 text-[12px] text-ink-3">
              {mode === 'auto'
                ? `Die App veröffentlicht nach der Freigabe auf @${list.username || 'eurem Konto'}.`
                : 'Zum Zeitpunkt kommt eine Erinnerung – sinnvoll für Musik, Sticker, Umfragen oder Produkt-Markierungen.'}
              {kind === 'story' && mode === 'auto' ? ' Storys gehen als Bild ohne Sticker oder Musik raus.' : ''}
            </p>
          </>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="label mb-0">
            Bilder <span className="tnum text-ink-3">· {images.length}/10</span>
          </span>
          <Segmented size="sm" value={crop} onChange={setCrop} options={cropOptions} />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img, i) => (
            <div key={img.token} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2">
              <img src={img.url} alt="" className="h-full w-full object-cover" />
              <span className="tnum absolute left-1.5 top-1.5 rounded-md bg-[rgb(20_20_24/0.6)] px-1.5 text-[11px] font-semibold text-white">{i + 1}</span>
              {kind !== 'story' && !feedRatioOk(img.w, img.h) && (
                <span className="absolute inset-x-1.5 bottom-9 rounded-md bg-bad px-1.5 py-0.5 text-center text-[11px] font-medium text-white">
                  Format passt nicht
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-[rgb(20_20_24/0.55)] to-transparent p-1">
                <span className="flex">
                  <IconButton
                    label="Nach vorne"
                    className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="Nach hinten"
                    className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                    disabled={i === images.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
                <IconButton
                  label="Entfernen"
                  className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                  onClick={() => void reorder(images.filter((x) => x.token !== img.token).map((x) => x.token))}
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>
          ))}
          {images.length < (kind === 'story' ? 1 : 10) && (
            <button
              type="button"
              disabled={!!uploading}
              onClick={() => fileRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {uploading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
              {uploading ? 'Lädt …' : 'Foto hinzufügen'}
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple={kind !== 'story'}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addBlobs(files);
          }}
        />
        {uploading && <p className="mt-1.5 text-[12px] text-ink-2">{uploading}</p>}
        <p className="mt-1.5 text-[12px] text-ink-3">
          Fotos werden beim Hochladen auf das gewählte Format zugeschnitten (mittig) und als JPEG gespeichert.{' '}
          {kind === 'story' ? 'Storys: 9:16.' : 'Für den Feed eignet sich 4:5 am besten – es nimmt am meisten Platz ein.'}
        </p>
        {list.shopify && (
          <div className="mt-2">
            <Button size="sm" variant={shop ? 'soft' : 'secondary'} icon={<ShoppingBag className="h-3.5 w-3.5" />} onClick={() => setShop((x) => !x)}>
              Bilder und Text aus dem Shop
            </Button>
            {shop && (
              <ProductPicker
                max={kind === 'story' ? 1 - images.length : 10 - images.length}
                busy={!!uploading}
                onImages={(urls) => void addFromShop(urls)}
                onText={takeProductText}
              />
            )}
          </div>
        )}
      </div>

      {kind !== 'story' && (
        <div>
          <label className="label" htmlFor="ig-caption">
            Text{' '}
            <span className={cx('tnum', caption.length > 2200 ? 'text-bad' : 'text-ink-3')}>
              · {int(caption.length)}/2.200 · <span className={tags > 30 ? 'text-bad' : ''}>{tags}/30 Hashtags</span>
              {mentions > 0 && <span className={mentions > 20 ? 'text-bad' : ''}> · {mentions}/20 Erwähnungen</span>}
            </span>
          </label>
          <AutoTextarea
            id="ig-caption"
            className="field min-h-[140px]"
            maxLength={2200}
            value={caption}
            onChange={(e) => {
              touch();
              setCaption(e.target.value);
            }}
            placeholder="Worum geht es? Die erste Zeile entscheidet, ob weitergelesen wird."
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {list.hashtags.trim() !== '' && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Hash className="h-3.5 w-3.5" />}
                disabled={hashtagsIn}
                onClick={() => {
                  touch();
                  setCaption((c) => `${c.trimEnd()}${c.trim() ? '\n\n' : ''}${list.hashtags.trim()}`);
                }}
              >
                {hashtagsIn ? 'Hashtag-Set eingefügt' : 'Hashtag-Set einfügen'}
              </Button>
            )}
            <span className="text-[12px] text-ink-3">
              Im Feed sind etwa die ersten 125 Zeichen zu sehen. Links sind auf Instagram nicht anklickbar – besser „Link in der Bio“.
            </span>
          </div>
          {tooMany && <p className="mt-1 text-[13px] text-bad">Instagram erlaubt höchstens 30 Hashtags und 20 Erwähnungen.</p>}
        </div>
      )}

      <div>
        <label className="label" htmlFor="ig-note">
          Notiz fürs Team <span className="text-ink-3">(optional, wird nicht veröffentlicht)</span>
        </label>
        <AutoTextarea
          id="ig-note"
          className="field min-h-[44px]"
          maxLength={2000}
          value={note}
          onChange={(e) => {
            touch();
            setNote(e.target.value);
          }}
          placeholder={kind === 'reel' ? 'z. B. Musik, Szenen, Titelbild, Produkt markieren' : 'z. B. Produkt markieren, Story-Sticker, Idee dahinter'}
        />
      </div>

      <div>
        <span className="label">Zeitpunkt</span>
        <Segmented
          className="w-full"
          value={when}
          onChange={(v) => {
            touch();
            setWhen(v);
          }}
          options={[
            { value: 'now', label: effectiveMode === 'auto' ? 'Sofort nach Freigabe' : 'Ohne Termin' },
            { value: 'later', label: 'Geplant' },
          ]}
        />
        {when === 'later' && (
          <input
            type="datetime-local"
            className="field mt-2"
            value={at}
            onChange={(e) => {
              touch();
              setAt(e.target.value);
            }}
          />
        )}
        {past && <p className="mt-1 text-[13px] text-bad">Der Zeitpunkt liegt in der Vergangenheit.</p>}
        {bestTime && when === 'later' && (
          <p className="mt-1 flex items-start gap-1.5 text-[12px] text-ink-3">
            <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0" /> Tipp aus der Auswertung: {bestTime}.
          </p>
        )}
      </div>

      <div>
        <span className="label">Vorschau</span>
        <Preview username={list.username} kind={kind} images={images} caption={caption} />
      </div>

      {issues.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
          {issues.map((x) => (
            <li key={x} className="flex items-start gap-1.5">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {x}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button icon={<Send className="h-4 w-4" />} disabled={!canSave || issues.length > 0} loading={busy === 'submit'} onClick={() => save(true)}>
          Zur Prüfung geben
        </Button>
        <Button variant="secondary" disabled={!canSave} loading={busy === 'save'} onClick={() => save(false)}>
          Als Entwurf speichern
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">Auf Instagram erscheint erst etwas nach der Freigabe{list.four_eyes ? ' durch eine andere Person' : ''}.</p>
    </div>
  );
}

function ProductPicker({ max, busy, onImages, onText }: { max: number; busy: boolean; onImages: (urls: string[]) => void; onText: (p: IgProduct) => void }) {
  const [products, setProducts] = useState<IgProduct[] | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<IgProduct | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    api<{ products: IgProduct[] }>('GET', '/instagram/products')
      .then((r) => setProducts(r.products))
      .catch((e: Error) => {
        toast(e.message, 'error');
        setProducts([]);
      });
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products ?? []).filter((p) => !s || p.title.toLowerCase().includes(s)).slice(0, 24);
  }, [products, q]);

  if (!products)
    return (
      <div className="mt-2 flex justify-center rounded-2xl border border-line py-6">
        <Spinner />
      </div>
    );

  if (sel) {
    return (
      <div className="mt-2 space-y-3 rounded-2xl border border-line p-3">
        <div className="flex items-center gap-2">
          <IconButton
            label="Zurück"
            className="h-8 w-8"
            onClick={() => {
              setSel(null);
              setPicked([]);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{sel.title}</p>
            {sel.price !== null && <p className="tnum text-[12px] text-ink-3">{euro(sel.price)}</p>}
          </div>
          <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onText(sel)}>
            Text übernehmen
          </Button>
        </div>
        {sel.images.length === 0 ? (
          <p className="text-[13px] text-ink-3">Dieses Produkt hat keine Bilder.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {sel.images.map((img) => {
                const on = picked.includes(img.url);
                return (
                  <button
                    key={img.url}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked((x) => (on ? x.filter((u) => u !== img.url) : x.length < max ? [...x, img.url] : x))}
                    className={cx('relative aspect-square overflow-hidden rounded-lg border-2', on ? 'border-accent' : 'border-transparent')}
                  >
                    <img src={`${img.url}${img.url.includes('?') ? '&' : '?'}width=300`} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {on && (
                      <span className="tnum absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink">
                        {picked.indexOf(img.url) + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              icon={<ImagePlus className="h-3.5 w-3.5" />}
              disabled={picked.length === 0 || busy || max <= 0}
              loading={busy}
              onClick={() => {
                onImages(picked);
                setPicked([]);
              }}
            >
              {picked.length > 1 ? `${picked.length} Bilder übernehmen` : 'Bild übernehmen'}
            </Button>
            {max <= 0 && <p className="text-[12px] text-ink-3">Es passen keine weiteren Bilder in diesen Beitrag.</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-2xl border border-line p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produkt suchen" />
      </div>
      {shown.length === 0 ? (
        <p className="py-2 text-[13px] text-ink-3">{products.length ? 'Kein Produkt gefunden.' : 'Keine aktiven Produkte im Shop gefunden.'}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setSel(p)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-surface-2">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {p.images[0] && (
                    <img
                      src={`${p.images[0].url}${p.images[0].url.includes('?') ? '&' : '?'}width=120`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{p.title}</span>
                  <span className="tnum block text-[12px] text-ink-3">
                    {p.images.length} {p.images.length === 1 ? 'Bild' : 'Bilder'}
                    {p.price !== null ? ` · ${euro(p.price)}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Prüfen ----------------

function Review({
  p,
  list,
  busy,
  onAct,
}: {
  p: IgPost;
  list: IgPostList;
  busy: string | null;
  onAct: (p: IgPost, action: Action, body?: Record<string, unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const later = p.scheduled_at !== null && p.scheduled_at > Date.now() + 60000;
  const rows: [string, ReactNode][] = [
    ['Art', KIND_LABEL[p.kind]],
    ['Veröffentlichung', p.mode === 'auto' ? `automatisch auf @${list.username || 'eurem Konto'}` : 'Erinnerung – ihr postet selbst'],
    ['Zeitpunkt', p.scheduled_at ? dateTime(p.scheduled_at) : p.mode === 'auto' ? 'sofort nach der Freigabe' : 'ohne Termin'],
    ['Vorbereitet von', p.created_by_name ?? (p.source === 'import' ? 'Import' : '–')],
  ];
  if (p.note) rows.push(['Notiz', <span className="whitespace-pre-line">{p.note}</span>]);
  const issues = problems(p.kind, p.mode, p.caption, p.images);
  const canReject = p.status === 'review';

  function approve() {
    const text =
      p.mode === 'manual'
        ? later
          ? `Freigeben? Am ${dateTime(p.scheduled_at!)} kommt die Erinnerung zum Posten.`
          : 'Freigeben? Danach könnt ihr den Beitrag in der Instagram-App posten.'
        : later
          ? `Freigeben? Der Beitrag erscheint am ${dateTime(p.scheduled_at!)} automatisch auf Instagram.`
          : `Jetzt auf Instagram (@${list.username}) veröffentlichen? Löschen geht danach nur noch in der Instagram-App.`;
    if (window.confirm(text)) void onAct(p, 'approve');
  }

  return (
    <div className="space-y-4">
      <Preview username={list.username} kind={p.kind} images={p.images} caption={p.caption} />
      <dl className="divide-y divide-line/70 rounded-2xl border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-4 py-2.5 text-[14px]">
            <dt className="w-36 shrink-0 text-ink-3">{k}</dt>
            <dd className="min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-ink-3">
        Bitte prüfen: Rechtschreibung, Preise und Aktionen, Rechte an Bildern und Musik, Markierungen. Werbung mit Partnern muss gekennzeichnet sein.
      </p>
      {issues.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
          {issues.map((x) => (
            <li key={x} className="flex items-start gap-1.5">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {x}
            </li>
          ))}
        </ul>
      )}

      {rejecting ? (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <label className="label" htmlFor="ig-reject">
            Was soll geändert werden?
          </label>
          <input
            id="ig-reject"
            className="field"
            value={note}
            maxLength={250}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. anderes Titelbild"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy === `${p.id}:reject`} onClick={() => onAct(p, 'reject', { note })}>
              Zurückgeben
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button icon={<Check className="h-4 w-4" />} disabled={issues.length > 0} loading={busy === `${p.id}:approve`} onClick={approve}>
            {p.mode === 'auto' && !later ? 'Freigeben & veröffentlichen' : 'Freigeben'}
          </Button>
          {canReject && (
            <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setRejecting(true)}>
              Zurückgeben
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Selbst posten (Reels und Erinnerungen) ----------------

function PostManually({
  p,
  busy,
  onAct,
}: {
  p: IgPost;
  busy: string | null;
  onAct: (p: IgPost, action: Action, body?: Record<string, unknown>) => Promise<void>;
}) {
  const [link, setLink] = useState('');
  const badLink = link.trim() !== '' && !/^https:\/\/(www\.)?instagram\.com\//.test(link.trim());

  async function copy() {
    try {
      await navigator.clipboard.writeText(p.caption);
      toast('Text kopiert', 'success');
    } catch {
      toast('Kopieren ging nicht – bitte den Text markieren und kopieren.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-4">
        <Step n={1} title="Text kopieren">
          {p.caption ? (
            <>
              <p className="line-clamp-4 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{p.caption}</p>
              <Button size="sm" variant="secondary" className="mt-2" icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>
                Text kopieren
              </Button>
            </>
          ) : (
            <p className="text-[13px] text-ink-3">Kein Text hinterlegt.</p>
          )}
        </Step>
        {p.images.length > 0 && (
          <Step n={2} title={p.images.length > 1 ? 'Bilder sichern' : 'Bild sichern'}>
            <div className="flex flex-wrap gap-2">
              {p.images.map((img, i) => (
                <a
                  key={img.token}
                  href={img.url}
                  download={`instagram-${i + 1}.jpg`}
                  className="group relative h-16 w-16 overflow-hidden rounded-lg bg-surface-2"
                  title="Herunterladen"
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-[rgb(20_20_24/0.35)] text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Download className="h-4 w-4" />
                  </span>
                </a>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-ink-3">Am iPhone: Bild antippen, dann gedrückt halten → „Zu Fotos hinzufügen“.</p>
          </Step>
        )}
        <Step n={p.images.length > 0 ? 3 : 2} title="In der Instagram-App posten">
          {p.note ? (
            <p className="whitespace-pre-line text-[13px] text-ink-2">Notiz: {p.note}</p>
          ) : (
            <p className="text-[13px] text-ink-3">Beitrag wie gewohnt anlegen und den Text einfügen.</p>
          )}
        </Step>
        <Step n={p.images.length > 0 ? 4 : 3} title="Hier abhaken">
          <input
            className="field"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link zum Beitrag (optional), z. B. https://www.instagram.com/p/…"
            inputMode="url"
          />
          {badLink ? (
            <p className="mt-1 text-[13px] text-bad">Bitte einen Link auf instagram.com einfügen oder leer lassen.</p>
          ) : (
            <p className="mt-1 text-[12px] text-ink-3">
              Ohne Link ordnet die App den Beitrag beim nächsten Abgleich selbst zu (über den Text) – dann gibt es auch dafür Zahlen.
            </p>
          )}
        </Step>
      </ol>
      <Button
        icon={<Check className="h-4 w-4" />}
        disabled={badLink}
        loading={busy === `${p.id}:done`}
        onClick={() => onAct(p, 'done', { permalink: link.trim() })}
      >
        Ist gepostet
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-[14px] font-semibold text-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}
