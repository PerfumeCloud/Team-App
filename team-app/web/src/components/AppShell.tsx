import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { ChartLine, CloudOff, House, Inbox, Lightbulb, ListChecks, NotebookPen, Settings } from 'lucide-react';
import { openImportantCount, useStore } from '../lib/store';
import { relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { Avatar, cx, Logo } from './ui';

const NAV = [
  { to: '/', label: 'Übersicht', icon: House },
  { to: '/ideen', label: 'Ideen', icon: Lightbulb },
  { to: '/planung', label: 'Planung', icon: ListChecks },
  { to: '/notizen', label: 'Notizen', icon: NotebookPen },
  { to: '/postfach', label: 'Postfach', icon: Inbox },
  { to: '/statistik', label: 'Statistik', icon: ChartLine },
];

function useBadges() {
  const emails = useStore((s) => s.emails);
  const tasks = useStore((s) => s.tasks);
  const me = useStore((s) => s.me);
  const mine = Object.values(tasks).filter((t) => t.assignee_id === me?.id && t.status !== 'done').length;
  return { '/postfach': openImportantCount(emails), '/planung': mine } as Record<string, number>;
}

function SyncStatus({ compact }: { compact?: boolean }) {
  const online = useStore((s) => s.online);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const pending = useStore((s) => s.outbox.length);
  const now = useNow(15000);
  if (!online) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-warn">
        <CloudOff className="h-3.5 w-3.5" /> Offline{pending && !compact ? ` · ${pending} Änderung${pending === 1 ? '' : 'en'} warten` : ''}
      </span>
    );
  }
  if (compact) {
    return (
      <span
        className={cx('h-2 w-2 rounded-full', pending ? 'bg-warn' : 'bg-good')}
        title={pending ? 'Wird gespeichert …' : `Synchron · ${relative(lastSyncAt, now)}`}
        aria-label={pending ? 'Wird gespeichert' : 'Synchron'}
      />
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
      <span className={cx('h-1.5 w-1.5 rounded-full', pending ? 'bg-warn' : 'bg-good')} />
      {pending ? 'Wird gespeichert …' : lastSyncAt ? `Synchron · ${relative(lastSyncAt, now)}` : 'Verbinde …'}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useStore((s) => s.me);
  const badges = useBadges();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <div className="min-h-dvh lg:flex">
      {/* Seitenleiste (Desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col border-r border-line/70 bg-surface/60 px-4 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <Logo className="h-10 w-10" />
          <div className="leading-tight">
            <div className="font-display text-[21px] font-semibold text-ink">Perfume Cloud</div>
            <div className="eyebrow">Team</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium transition-colors',
                  isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              <span className="flex-1">{label}</span>
              {badges[to] ? <span className="tnum rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink">{badges[to]}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="px-3">
            <SyncStatus />
          </div>
          <NavLink
            to="/einstellungen"
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors', isActive ? 'bg-accent-soft' : 'hover:bg-surface-2')
            }
          >
            <Avatar user={me} size={32} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[14px] font-medium text-ink">{me?.name}</div>
              <div className="text-[12px] text-ink-3">Einstellungen</div>
            </div>
            <Settings className="h-4 w-4 text-ink-3" />
          </NavLink>
        </div>
      </aside>

      {/* Inhalt */}
      <div className="min-w-0 flex-1">
        <header className="safe-top sticky top-0 z-30 border-b border-line/50 bg-bg/80 backdrop-blur-xl lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <button className="flex items-center gap-2.5" onClick={() => navigate('/')}>
              <Logo className="h-8 w-8" />
              <span className="font-display text-[19px] font-semibold text-ink">Perfume Cloud</span>
            </button>
            <div className="flex items-center gap-3">
              <SyncStatus compact />
              <button onClick={() => navigate('/einstellungen')} aria-label="Einstellungen" className="rounded-full active:scale-95">
                <Avatar user={me} size={32} />
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] px-4 pb-[calc(104px+var(--safe-bottom))] pt-5 md:px-8 lg:pb-12 lg:pt-10">{children}</main>
      </div>

      {/* Tab-Leiste (Handy) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-surface/85 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg">
          {NAV.map(({ to, label, icon: Icon }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className={cx('relative flex min-w-0 flex-1 flex-col items-center gap-1 pb-1.5 pt-2.5 text-[10px] font-medium tracking-[-0.01em]', isActive(to) ? 'text-accent' : 'text-ink-3')}
              aria-current={isActive(to) ? 'page' : undefined}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={isActive(to) ? 2.2 : 1.8} />
                {badges[to] ? (
                  <span className="tnum absolute -right-2.5 -top-1.5 min-w-[17px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-[17px] text-accent-ink ring-2 ring-surface">
                    {badges[to]}
                  </span>
                ) : null}
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 lg:mb-8">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[14.5px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
