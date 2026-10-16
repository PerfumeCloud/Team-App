import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCheck, ExternalLink, Heart, Inbox, MessageCircle, Reply, RotateCcw, Send } from 'lucide-react';
import { AutoTextarea, Button, Chip, cx, EmptyState, Segmented, Spinner } from './ui';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';
import type { IgComment, IgComments } from '../lib/types';

/** Schnellantworten – werden nur eingefügt und lassen sich vor dem Senden anpassen. */
const QUICK = [
  'Danke dir! 🤍',
  'Wie schön, dass er dir gefällt – danke! ✨',
  'Schreib uns gern eine Direktnachricht, dann helfen wir dir weiter.',
  'Den Duft findest du in unserem Shop – Link in der Bio.',
];

export default function Comments({ onChange }: { onChange: (unanswered: number) => void }) {
  const now = useNow();
  const [data, setData] = useState<IgComments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback(
    (r: IgComments) => {
      setData(r);
      onChange(r.unanswered);
    },
    [onChange],
  );

  const load = useCallback(async () => {
    try {
      apply(await api<IgComments>('GET', '/instagram/comments'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apply]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startReply(c: IgComment) {
    setReplying(c.id);
    setText(`@${c.username} `);
  }

  async function send(c: IgComment) {
    setBusy(`${c.id}:reply`);
    try {
      apply(await api<IgComments>('POST', `/instagram/comments/${c.id}/reply`, { text }));
      toast(`Antwort an @${c.username} gepostet`, 'success');
      setReplying(null);
      setText('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(c: IgComment) {
    setBusy(`${c.id}:toggle`);
    try {
      apply(await api<IgComments>('POST', `/instagram/comments/${c.id}/${c.open ? 'done' : 'open'}`, {}));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="flex justify-center py-20">{error ? <p className="max-w-md text-center text-bad">{error}</p> : <Spinner />}</div>;

  const shown = filter === 'open' ? data.comments.filter((c) => c.open) : data.comments;

  return (
    <div className="space-y-4">
      <section className="card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="font-display text-[23px] font-semibold text-ink">Kommentare</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
              Kommentare auf euren Beiträgen der letzten 30 Tage. Antworten gehen direkt als @{data.username || 'euer Konto'} auf Instagram raus. „Erledigt“
              blendet einen Kommentar aus, ohne zu antworten – z. B. bei Emojis oder Spam.
            </p>
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: `Offen${data.unanswered ? ` (${data.unanswered})` : ''}` },
              { value: 'all', label: 'Alle' },
            ]}
          />
        </div>
      </section>

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={filter === 'open' ? <CheckCheck className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
            title={filter === 'open' ? 'Alles beantwortet' : 'Noch keine Kommentare'}
            text={
              filter === 'open'
                ? 'Neue Kommentare kommen mit dem stündlichen Abgleich – mit Push, wenn ihr das eingeschaltet habt.'
                : 'Sobald jemand kommentiert, steht es hier.'
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <li key={c.id} className={cx('card p-4', !c.open && 'opacity-80')}>
              <div className="flex items-start gap-3">
                {c.post.thumb ? (
                  <img
                    src={c.post.thumb}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 shrink-0 rounded-lg bg-surface-2 object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold text-ink">@{c.username}</span>
                    <span className="text-[12px] text-ink-3">{relative(c.at, now)}</span>
                    {c.likes > 0 && (
                      <span className="tnum inline-flex items-center gap-0.5 text-[12px] text-ink-3">
                        <Heart className="h-3 w-3" /> {c.likes}
                      </span>
                    )}
                    {c.replied ? (
                      <Chip tone="good" icon={<Check className="h-3 w-3" />}>
                        Beantwortet{c.replied_by ? ` von ${c.replied_by}` : ''}
                      </Chip>
                    ) : c.open ? (
                      <Chip tone="warn">Offen</Chip>
                    ) : (
                      <Chip>Erledigt</Chip>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-line break-words text-[14px] text-ink">{c.text}</p>
                  {c.post.caption && (
                    <p className="mt-1 truncate text-[12px] text-ink-3">
                      zu: {c.post.caption}
                      {c.post.permalink && (
                        <>
                          {' · '}
                          <a
                            href={c.post.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-ink-2 underline-offset-2 hover:underline"
                          >
                            ansehen <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>

              {replying === c.id ? (
                <div className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
                  <AutoTextarea className="field min-h-[64px] bg-surface" maxLength={2200} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setText(`@${c.username} ${q}`)}
                        className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      icon={<Send className="h-3.5 w-3.5" />}
                      disabled={text.replace(`@${c.username}`, '').trim() === ''}
                      loading={busy === `${c.id}:reply`}
                      onClick={() => send(c)}
                    >
                      Auf Instagram antworten
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplying(null)}>
                      Abbrechen
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!c.replied && (
                    <Button size="sm" variant="secondary" icon={<Reply className="h-3.5 w-3.5" />} onClick={() => startReply(c)}>
                      Antworten
                    </Button>
                  )}
                  {!c.replied && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={c.open ? <Check className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      loading={busy === `${c.id}:toggle`}
                      onClick={() => toggle(c)}
                    >
                      {c.open ? 'Erledigt' : 'Wieder öffnen'}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
