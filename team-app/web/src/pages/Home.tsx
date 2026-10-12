import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, BellRing, CircleCheck, Inbox, ListChecks, Mail, PlugZap, ShoppingBag, Truck, UserPlus } from 'lucide-react';
import { Sparkline, StatTile } from '../components/charts';
import { TaskCard } from '../components/tasks';
import { Avatar, Button, Chip, cx, SectionHeader } from '../components/ui';
import { openImportantCount, sortTasks, useStore } from '../lib/store';
import { useStats } from '../lib/stats';
import { euro, firstName, greeting, longDay, relative, todayISO, addDays } from '../lib/format';
import { useNow } from '../lib/hooks';
import { pushState } from '../lib/push';

export default function Home() {
  const me = useStore((s) => s.me);
  const tasksMap = useStore((s) => s.tasks);
  const emailsMap = useStore((s) => s.emails);
  const usersMap = useStore((s) => s.users);
  const activity = useStore((s) => s.activity);
  const meta = useStore((s) => s.meta);
  const stats = useStats((s) => s.data[7]);
  const loadStats = useStats((s) => s.load);
  const navigate = useNavigate();
  const now = useNow();
  const [push, setPush] = useState<string>('subscribed');

  useEffect(() => {
    if (meta?.shopifyConfigured) void loadStats(7);
  }, [meta?.shopifyConfigured, meta?.ordersLastSync, loadStats]);
  useEffect(() => {
    pushState().then(setPush).catch(() => undefined);
  }, []);

  const today = todayISO();
  const myTasks = useMemo(() => {
    const open = Object.values(tasksMap).filter((t) => t.assignee_id === me?.id && t.status !== 'done');
    return sortTasks(open);
  }, [tasksMap, me?.id]);
  const focus = myTasks.filter((t) => t.due_date && t.due_date <= addDays(today, 2)).slice(0, 5);
  const focusList = focus.length ? focus : myTasks.slice(0, 4);
  const overdue = myTasks.filter((t) => t.due_date && t.due_date < today).length;
  const importantMails = useMemo(
    () =>
      Object.values(emailsMap)
        .filter((m) => m.important && !m.answered && m.status === 'open')
        .sort((a, b) => b.score - a.score || b.received_at - a.received_at),
    [emailsMap],
  );
  const users = Object.values(usersMap).filter((u) => !u.deleted);

  const setup = me?.role === 'admin' && meta
    ? [
        { done: users.length >= 3, label: 'Team einladen', to: '/einstellungen/team', icon: UserPlus },
        { done: meta.shopifyConfigured, label: 'Shopify verbinden', to: '/einstellungen/integrationen', icon: ShoppingBag },
        { done: meta.mailConfigured, label: 'Postfächer verbinden', to: '/einstellungen/integrationen', icon: Mail },
        { done: push === 'subscribed', label: 'Push aktivieren', to: '/einstellungen', icon: BellRing },
      ]
    : [];
  const setupOpen = setup.filter((s) => !s.done);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-2">{longDay(new Date(now))}</p>
        <h1 className="page-title">
          {greeting(new Date(now))}, {me ? firstName(me.name) : ''}
        </h1>
      </div>

      {setupOpen.length > 0 && (
        <div className="card p-4 md:p-5">
          <div className="flex items-center gap-3">
            <PlugZap className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="section-title">Einrichtung abschließen</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 max-w-[160px] flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${((setup.length - setupOpen.length) / setup.length) * 100}%` }} />
                </div>
                <span className="tnum text-[12px] text-ink-3">
                  {setup.length - setupOpen.length}/{setup.length}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {setupOpen.map((s) => (
              <Button key={s.label} size="sm" variant="soft" icon={<s.icon className="h-3.5 w-3.5" />} onClick={() => navigate(s.to)}>
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatTile
          label="Umsatz heute"
          value={meta?.shopifyConfigured && stats ? euro(stats.today.revenue) : '–'}
          sub={meta?.shopifyConfigured ? (stats ? `${stats.today.orders} Bestellung${stats.today.orders === 1 ? '' : 'en'}` : 'Lädt …') : 'Shopify nicht verbunden'}
          footer={stats && meta?.shopifyConfigured ? <Sparkline values={stats.series.map((d) => d.revenue)} /> : undefined}
          onClick={() => navigate('/statistik')}
        />
        <StatTile
          label="Zu versenden"
          icon={<Truck className="h-4 w-4" />}
          value={meta?.shopifyConfigured && stats ? stats.toShip.count : '–'}
          sub={stats?.toShip.oldest ? `Älteste ${relative(stats.toShip.oldest, now)}` : 'Bestellungen'}
          onClick={() => navigate('/statistik')}
        />
        <StatTile
          label="Wichtige Mails"
          icon={<Inbox className="h-4 w-4" />}
          value={meta?.mailConfigured ? openImportantCount(emailsMap) : '–'}
          sub={meta?.mailConfigured ? 'offen in info@ & support@' : 'Postfächer nicht verbunden'}
          onClick={() => navigate('/postfach')}
        />
        <StatTile
          label="Meine Aufgaben"
          icon={<ListChecks className="h-4 w-4" />}
          value={myTasks.length}
          sub={overdue ? <span className="font-medium text-bad">{overdue} überfällig</span> : 'offen'}
          onClick={() => navigate('/planung')}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          <section>
            <SectionHeader
              title={focus.length ? 'Für dich in den nächsten Tagen' : 'Deine offenen Aufgaben'}
              action={
                <Button size="sm" variant="ghost" onClick={() => navigate('/planung')}>
                  Alle <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            />
            {focusList.length ? (
              <div className="flex flex-col gap-2.5">
                {focusList.map((t) => (
                  <TaskCard key={t.id} task={t} compact onOpen={() => navigate(`/planung/${t.id}`)} />
                ))}
              </div>
            ) : (
              <div className="card flex items-center gap-3 p-4 text-[14px] text-ink-2">
                <CircleCheck className="h-5 w-5 text-good" /> Dir ist gerade nichts zugewiesen.
              </div>
            )}
          </section>

          {meta?.mailConfigured && (
            <section>
              <SectionHeader
                title="Wichtige offene Mails"
                action={
                  <Button size="sm" variant="ghost" onClick={() => navigate('/postfach')}>
                    Postfach <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              {importantMails.length ? (
                <div className="card divide-y divide-line/70">
                  {importantMails.slice(0, 4).map((m) => (
                    <button key={m.id} onClick={() => navigate('/postfach')} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/50">
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', m.seen ? 'bg-line' : 'bg-accent')} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[14px] font-medium text-ink">{m.from_name || m.from_email}</span>
                          <span className="shrink-0 text-[12px] text-ink-3">{relative(m.received_at, now)}</span>
                        </div>
                        <div className="truncate text-[13.5px] text-ink-2">{m.subject}</div>
                      </div>
                      <Chip tone="accent" className="hidden sm:inline-flex">
                        {m.mailbox.split('@')[0]}@
                      </Chip>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="card flex items-center gap-3 p-4 text-[14px] text-ink-2">
                  <CircleCheck className="h-5 w-5 text-good" /> Keine wichtigen Mails offen.
                </div>
              )}
            </section>
          )}
        </div>

        <section>
          <SectionHeader title="Zuletzt im Team" />
          <div className="card p-2">
            {activity.length ? (
              <ul>
                {activity.slice(0, 9).map((a) => {
                  const u = a.user_id ? usersMap[a.user_id] : undefined;
                  const clickable = a.entity_type === 'task' && a.entity_id && tasksMap[a.entity_id];
                  return (
                    <li key={a.id}>
                      <button
                        disabled={!clickable}
                        onClick={() => clickable && navigate(`/planung/${a.entity_id}`)}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left enabled:hover:bg-surface-2/60"
                      >
                        <Avatar user={u} size={28} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] leading-snug text-ink-2">
                            <span className="font-semibold text-ink">{u ? firstName(u.name) : 'Jemand'}</span> {a.text}
                          </p>
                          <p className="mt-0.5 text-[12px] text-ink-3">{relative(a.created_at, now)}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-4 text-[13.5px] text-ink-3">Hier erscheint, was ihr gemeinsam erledigt.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
