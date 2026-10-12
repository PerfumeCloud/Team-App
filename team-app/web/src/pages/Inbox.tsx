import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, CircleCheck, Flag, Inbox as InboxIcon, ListPlus, Lock, Mail, Newspaper, Reply, RotateCcw, Settings, UserRound } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Avatar, Button, Chip, cx, EmptyState, Segmented } from '../components/ui';
import { useStore } from '../lib/store';
import type { Email, User } from '../lib/types';
import { relative, todayISO } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

type View = 'important' | 'open' | 'done';

const isOpen = (m: Email) => m.status === 'open' && !m.answered;

export default function Inbox() {
  const emailsMap = useStore((s) => s.emails);
  const usersMap = useStore((s) => s.users);
  const meta = useStore((s) => s.meta);
  const me = useStore((s) => s.me);
  const now = useNow();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('important');
  const [box, setBox] = useState<string>(() => params.get('box') ?? 'all');
  const [showAuto, setShowAuto] = useState(false);

  // Aus einer Push-Nachricht: /postfach?box=marius.heub@… öffnet das eigene Postfach mit allen offenen Mails
  useEffect(() => {
    const b = params.get('box');
    if (b) {
      setBox(b);
      if (b === meta?.myMailbox) setView('open');
      setParams({}, { replace: true });
    }
  }, [params, setParams, meta?.myMailbox]);

  const users = Object.values(usersMap).filter((u) => !u.deleted);
  const inBox = useMemo(() => Object.values(emailsMap).filter((m) => box === 'all' || m.mailbox === box), [emailsMap, box]);
  const autoCount = inBox.filter((m) => m.auto && isOpen(m)).length;
  // Newsletter & automatische Mails nur auf Wunsch
  const all = useMemo(() => inBox.filter((m) => showAuto || !m.auto), [inBox, showAuto]);
  const lists = useMemo(() => {
    const important = all.filter((m) => isOpen(m) && m.important).sort((a, b) => b.score - a.score || b.received_at - a.received_at);
    const open = all.filter(isOpen).sort((a, b) => b.received_at - a.received_at);
    const done = all.filter((m) => !isOpen(m)).sort((a, b) => (b.done_at ?? b.received_at) - (a.done_at ?? a.received_at));
    return { important, open, done };
  }, [all]);
  const list = lists[view];

  if (!meta?.mailConfigured) {
    return (
      <>
        <PageHeader title="Postfach" />
        <div className="card">
          <EmptyState
            icon={<InboxIcon className="h-6 w-6" />}
            title="Postfächer noch nicht verbunden"
            text="Sobald info@ und support@ eingerichtet sind, erscheinen hier die wichtigen offenen Mails. Dein eigenes Postfach kannst du selbst verbinden – das sieht nur du."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={<Lock className="h-4 w-4" />} onClick={() => navigate('/einstellungen')}>
                  Mein Postfach verbinden
                </Button>
                {me?.role === 'admin' && (
                  <Button variant="secondary" icon={<Settings className="h-4 w-4" />} onClick={() => navigate('/einstellungen/integrationen')}>
                    Team-Postfächer
                  </Button>
                )}
              </div>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Postfach"
        subtitle={meta.mailLastFetch ? `Zuletzt abgerufen ${relative(meta.mailLastFetch, now)}` : 'Wird gleich abgerufen …'}
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'important', label: <span>Wichtig <span className="tnum text-ink-3">{lists.important.length}</span></span> },
            { value: 'open', label: <span>Alle offenen <span className="tnum text-ink-3">{lists.open.length}</span></span> },
            { value: 'done', label: 'Erledigt' },
          ]}
        />
        {meta.mailboxes.length > 1 && (
          <Segmented
            size="sm"
            value={box}
            onChange={setBox}
            options={[
              { value: 'all', label: 'Alle' },
              ...meta.mailboxes.map((m) => ({
                value: m,
                label:
                  m === meta.myMailbox ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Mein Postfach
                    </span>
                  ) : Object.values(emailsMap).some((e) => e.mailbox === m && e.visible_to?.length) ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> {m.split('@')[0]}@
                    </span>
                  ) : (
                    m.split('@')[0] + '@'
                  ),
              })),
            ]}
          />
        )}
        {(autoCount > 0 || showAuto) && (
          <button
            onClick={() => setShowAuto((v) => !v)}
            aria-pressed={showAuto}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
              showAuto ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
            )}
          >
            <Newspaper className="h-3.5 w-3.5" /> Newsletter & Automatisch <span className="tnum text-ink-3">{autoCount}</span>
          </button>
        )}
        {!meta.myMailbox && (
          <Button size="sm" variant="ghost" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => navigate('/einstellungen')}>
            Eigenes Postfach verbinden
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CircleCheck className="h-6 w-6" />}
            title={view === 'done' ? 'Noch nichts erledigt' : 'Alles erledigt'}
            text={view === 'important' ? 'Keine wichtigen offenen Mails. Schön!' : undefined}
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((m) => (
            <MailRow key={m.id} mail={m} users={users} usersMap={usersMap} now={now} meId={me?.id} />
          ))}
        </ul>
      )}
      <p className="mt-6 text-center text-[12px] leading-relaxed text-ink-3">
        Angezeigt werden Mails der letzten 14 Tage. Newsletter, automatische Mails und Shopify-Benachrichtigungen sind ausgeblendet, lassen sich aber einblenden.
        <br />
        Beantwortete Mails gelten automatisch als erledigt. Postfächer mit 🔒 sehen nur die Personen, für die sie freigegeben sind.
      </p>
    </>
  );
}

function MailRow({ mail, users, usersMap, now, meId }: { mail: Email; users: User[]; usersMap: Record<string, User>; now: number; meId?: string }) {
  const updateEmail = useStore((s) => s.updateEmail);
  const saveTask = useStore((s) => s.saveTask);
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);
  const open = isOpen(mail);
  // „Sichtbar für“: leer = alle; [ich] = mein persönliches Postfach
  const restricted = (mail.visible_to?.length ?? 0) > 0;
  const mine = restricted && mail.visible_to!.length === 1 && mail.visible_to![0] === meId;
  const assignable = restricted ? users.filter((u) => mail.visible_to!.includes(u.id)) : users;
  const assignee = mail.assignee_id ? usersMap[mail.assignee_id] : null;
  const sender = mail.from_name || mail.from_email || 'Unbekannt';
  const replyHref = `mailto:${encodeURIComponent(mail.from_email ?? '')}?subject=${encodeURIComponent((mail.subject ?? '').match(/^re:/i) ? (mail.subject ?? '') : `Re: ${mail.subject ?? ''}`)}`;

  function toTask() {
    const t = saveTask({
      title: `Antworten: ${mail.subject ?? sender}`,
      // Aufgaben sieht das ganze Team – bei nicht freigegebenen Postfächern daher ohne Mailtext
      description: restricted ? `Mail von ${sender} in ${mine ? 'deinem persönlichen Postfach' : mail.mailbox}` : `Von ${sender}${mail.from_email ? ` <${mail.from_email}>` : ''} an ${mail.mailbox}\n\n${mail.snippet ?? ''}`,
      assignee_id: mine ? (meId ?? null) : (mail.assignee_id ?? meId ?? null),
      due_date: todayISO(),
      priority: mail.reasons.includes('Kundenanliegen') ? 'high' : 'normal',
      category: 'Mail',
      source_email_id: mail.id,
    });
    navigate(`/planung/${t.id}`);
  }

  return (
    <li className={cx('card p-4 transition-opacity', !open && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <div className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', !mail.seen && open ? 'bg-accent' : 'bg-transparent')} aria-label={!mail.seen ? 'Ungelesen' : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cx('truncate text-[14.5px] text-ink', !mail.seen ? 'font-semibold' : 'font-medium')}>{sender}</span>
            <span className="shrink-0 text-[12px] text-ink-3">{relative(mail.received_at, now)}</span>
          </div>
          <div className={cx('mt-0.5 text-[14px] leading-snug text-ink', !mail.seen && 'font-medium')}>{mail.subject}</div>
          {mail.snippet && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{mail.snippet}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {mine ? (
              <Chip tone="neutral" icon={<Lock className="h-3 w-3" />}>
                Mein Postfach
              </Chip>
            ) : restricted ? (
              <Chip tone="neutral" icon={<Lock className="h-3 w-3" />}>
                {mail.mailbox.split('@')[0]}@
              </Chip>
            ) : (
              <Chip tone="accent">{mail.mailbox.split('@')[0]}@</Chip>
            )}
            {!!mail.auto && <Chip icon={<Newspaper className="h-3 w-3" />}>Automatisch</Chip>}
            {open &&
              mail.reasons
                .filter((r) => r !== 'Ungelesen')
                .map((r) => (
                  <Chip key={r} tone={r === 'Markiert' || r.startsWith('Über') ? 'warn' : r === 'Kundenanliegen' ? 'bad' : 'neutral'} icon={r === 'Markiert' ? <Flag className="h-3 w-3" /> : undefined}>
                    {r}
                  </Chip>
                ))}
            {!open && (
              <Chip tone="good" icon={<Check className="h-3 w-3" />}>
                {mail.answered ? 'Beantwortet' : `Erledigt${mail.done_by && usersMap[mail.done_by] ? ` von ${usersMap[mail.done_by].name.split(' ')[0]}` : ''}`}
              </Chip>
            )}
            {assignee && (
              <span className="ml-1 inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                <Avatar user={assignee} size={20} /> {assignee.name.split(' ')[0]}
              </span>
            )}
          </div>
        </div>
      </div>

      {assigning && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {assignable.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                updateEmail(mail.id, { assignee_id: u.id === mail.assignee_id ? null : u.id });
                setAssigning(false);
              }}
              className={cx('flex h-8 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px]', u.id === mail.assignee_id ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2')}
            >
              <Avatar user={u} size={24} /> {u.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        {open ? (
          <Button
            size="sm"
            variant="soft"
            icon={<Check className="h-3.5 w-3.5" />}
            onClick={() => {
              updateEmail(mail.id, { status: 'done' });
              toast('Als erledigt markiert', 'success', { label: 'Rückgängig', run: () => updateEmail(mail.id, { status: 'open' }) });
            }}
          >
            Erledigt
          </Button>
        ) : (
          !mail.answered && (
            <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => updateEmail(mail.id, { status: 'open' })}>
              Wieder öffnen
            </Button>
          )
        )}
        <a href={replyHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
          <Reply className="h-3.5 w-3.5" /> Antworten
        </a>
        {open && (
          <>
            {assignable.length > 1 && (
              <Button size="sm" variant="secondary" aria-label="Zuweisen" icon={<UserRound className="h-3.5 w-3.5" />} onClick={() => setAssigning((v) => !v)}>
                <span className="max-sm:hidden">Zuweisen</span>
              </Button>
            )}
            <Button size="sm" variant="secondary" aria-label="Als Aufgabe anlegen" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={toTask}>
              <span className="max-sm:hidden">Als Aufgabe</span>
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
