import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Flag, ListChecks, Plus } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Button, cx, IconButton, Toggle } from '../components/ui';
import { EventRow, EventSheet, KindDot, SpecialRow, specialTone, type EventDraft } from '../components/events';
import { TaskCheck } from '../components/tasks';
import { useStore } from '../lib/store';
import { addDaysIso, agenda, dayLabel, kindInfo, longDayLabel, monthFmt, monthGrid, onDay, parse, sortEvents, specialsBetween } from '../lib/calendar';
import { todayISO } from '../lib/format';
import { useNow } from '../lib/hooks';
import type { Task } from '../lib/types';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TASKS_KEY = 'pc-cal-tasks';
const SPECIAL_KEY = 'pc-cal-special';

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}
function store(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* egal */
  }
}

export default function Calendar() {
  const eventsMap = useStore((s) => s.events);
  const tasksMap = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const meta = useStore((s) => s.meta);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  useNow(60000);
  const today = todayISO();
  const [selected, setSelected] = useState(() => params.get('d') ?? today);
  const [month, setMonth] = useState(() => {
    const d = parse(params.get('d') ?? today);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [showTasks, setShowTasks] = useState(() => stored(TASKS_KEY));
  const [showSpecial, setShowSpecial] = useState(() => stored(SPECIAL_KEY));

  // Aus Push-Nachricht oder Übersicht: /kalender?d=2026-10-16 bzw. ?neu=2026-10-16
  useEffect(() => {
    const d = params.get('d');
    const neu = params.get('neu');
    const open = params.get('termin');
    if (d) {
      setSelected(d);
      const p = parse(d);
      setMonth({ y: p.getFullYear(), m: p.getMonth() });
    }
    if (neu) setDraft({ start_date: neu });
    if (open && eventsMap[open]) setDraft(eventsMap[open]);
    if (d || neu || open) setParams({}, { replace: true });
  }, [params, setParams, eventsMap]);

  const events = useMemo(() => sortEvents(Object.values(eventsMap)), [eventsMap]);
  const tasks = useMemo(() => Object.values(tasksMap).filter((t) => t.due_date && !t.deleted), [tasksMap]);
  const weeks = useMemo(() => monthGrid(month.y, month.m), [month]);
  const monthStart = weeks[0][0];
  const monthEnd = weeks[5][6];
  const visible = useMemo(() => events.filter((e) => e.start_date <= monthEnd && (e.end_date ?? e.start_date) >= monthStart), [events, monthStart, monthEnd]);
  // Feiertage und Aktionstage: für jedes Jahr berechnet, nichts gespeichert
  const specials = useMemo(() => (showSpecial ? specialsBetween(monthStart, monthEnd, meta) : []), [showSpecial, monthStart, monthEnd, meta]);
  const soonFrom = selected < today ? today : addDaysIso(selected, 1);
  const soonSpecials = useMemo(() => (showSpecial ? specialsBetween(soonFrom, addDaysIso(soonFrom, 30), meta) : []), [showSpecial, soonFrom, meta]);

  const daySpecials = showSpecial ? specialsBetween(selected, selected, meta) : [];
  const dayEvents = events.filter((e) => onDay(e, selected));
  const dayTasks = showTasks ? tasks.filter((t) => t.due_date === selected) : [];
  const upcoming = agenda(
    events.filter((e) => (e.end_date ?? e.start_date) >= today && e.start_date > selected),
    soonSpecials,
  ).slice(0, 8);

  const shift = (n: number) => setMonth(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  const toggleTasks = (v: boolean) => {
    setShowTasks(v);
    store(TASKS_KEY, v);
  };
  const toggleSpecial = (v: boolean) => {
    setShowSpecial(v);
    store(SPECIAL_KEY, v);
  };
  const openDay = (day: string) => {
    setSelected(day);
    const p = parse(day);
    setMonth({ y: p.getFullYear(), m: p.getMonth() });
  };
  const goToday = () => openDay(today);

  return (
    <>
      <PageHeader
        title="Kalender"
        subtitle="Termine, Meetings, Events und Fristen fürs Team"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDraft({ start_date: selected })}>
            <span className="max-sm:hidden">Neuer Termin</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* Monat */}
        <div className="card p-3 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <h2 className="font-display text-[24px] font-semibold capitalize leading-none text-ink">{monthFmt.format(new Date(month.y, month.m, 1))}</h2>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={goToday}>
                Heute
              </Button>
              <IconButton label="Voriger Monat" onClick={() => shift(-1)}>
                <ChevronLeft className="h-5 w-5" />
              </IconButton>
              <IconButton label="Nächster Monat" onClick={() => shift(1)}>
                <ChevronRight className="h-5 w-5" />
              </IconButton>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            {WEEKDAYS.map((w) => (
              <div key={w} className="pb-1.5">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-line/60">
            {weeks.flat().map((day) => {
              const inMonth = parse(day).getMonth() === month.m;
              const evs = visible.filter((e) => onDay(e, day));
              const sp = specials.filter((x) => x.date === day);
              const holiday = sp.find((x) => x.type === 'feiertag');
              const taskCount = showTasks ? tasks.filter((t) => t.due_date === day && t.status !== 'done').length : 0;
              const isSel = day === selected;
              return (
                <button
                  key={day}
                  onClick={() => setSelected(day)}
                  onDoubleClick={() => setDraft({ start_date: day })}
                  aria-pressed={isSel}
                  className={cx(
                    'flex min-h-[52px] flex-col items-stretch gap-0.5 p-1 text-left transition-colors sm:min-h-[92px] sm:p-1.5',
                    inMonth ? 'bg-surface' : 'bg-surface/55',
                    isSel ? 'ring-2 ring-inset ring-accent' : 'hover:bg-surface-2',
                  )}
                >
                  {/* Vorgelesen wird nur diese Zeile; Zahl, Punkte und Titel sind für die Augen (kein aria-label, damit nichts doppelt ist) */}
                  <span className="sr-only">
                    {longDayLabel(day)}
                    {sp.length ? `, ${sp.map((x) => x.title).join(', ')}` : ''}
                    {evs.length ? `, ${evs.length} Termin${evs.length === 1 ? '' : 'e'}` : ''}
                    {taskCount ? `, ${taskCount} Aufgabe${taskCount === 1 ? '' : 'n'}` : ''}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cx(
                      'tnum mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[13px] sm:mx-0',
                      day === today ? 'bg-accent font-semibold text-accent-ink' : holiday ? cx('font-semibold text-bad', !inMonth && 'opacity-60') : inMonth ? 'text-ink' : 'text-ink-3',
                    )}
                  >
                    {parse(day).getDate()}
                  </span>
                  {/* Handy: Punkte */}
                  <span className="flex justify-center gap-0.5 sm:hidden" aria-hidden="true">
                    {sp.some((x) => x.type === 'aktion') && <span className="u-amber h-1.5 w-1.5 rounded-full" style={{ background: 'var(--u-fg)' }} />}
                    {evs.slice(0, 3).map((e) => (
                      <KindDot key={e.id} kind={e.kind} className="h-1.5 w-1.5" />
                    ))}
                    {taskCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-ink-3/60" />}
                  </span>
                  {/* Desktop: Titel (für Screenreader steht alles schon in der Zeile oben) */}
                  <span className="hidden flex-col gap-0.5 sm:flex" aria-hidden="true">
                    {sp.map((x) => (
                      <span
                        key={x.title}
                        className={cx(specialTone(x), 'truncate px-1 text-[11px] font-medium leading-[17px]', x.type === 'aktion' && 'rounded')}
                        style={x.type === 'aktion' ? { background: 'var(--u-bg)', color: 'var(--u-fg)' } : { color: 'var(--u-fg)' }}
                      >
                        {x.title}
                      </span>
                    ))}
                    {evs.slice(0, 3).map((e) => (
                      <span key={e.id} className={cx(kindInfo(e.kind).tone, 'truncate rounded px-1 text-[11px] font-medium leading-[17px]')} style={{ background: 'var(--u-bg)', color: 'var(--u-fg)' }}>
                        {e.start_time && e.start_date === day ? `${e.start_time} ` : ''}
                        {e.title}
                      </span>
                    ))}
                    {evs.length > 3 && <span className="px-1 text-[11px] text-ink-3">+{evs.length - 3} weitere</span>}
                    {taskCount > 0 && (
                      <span className="flex items-center gap-1 px-1 text-[11px] text-ink-3">
                        <ListChecks className="h-3 w-3" /> {taskCount}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 space-y-2 px-1">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <ListChecks className="h-4 w-4 text-ink-3" /> Aufgaben mit Datum anzeigen
              </span>
              <Toggle label="Aufgaben anzeigen" checked={showTasks} onChange={toggleTasks} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <Flag className="h-4 w-4 text-ink-3" /> Feiertage &amp; Aktionstage
              </span>
              <Toggle label="Feiertage und Aktionstage anzeigen" checked={showSpecial} onChange={toggleSpecial} />
            </div>
          </div>
        </div>

        {/* Tag + Demnächst */}
        <div className="space-y-5">
          <div className="card p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="eyebrow">{dayLabel(selected, today) === longDayLabel(selected) ? 'Ausgewählt' : dayLabel(selected, today)}</p>
                <h2 className="font-display text-[22px] font-semibold leading-tight text-ink">{longDayLabel(selected)}</h2>
              </div>
              <IconButton label="Termin an diesem Tag" onClick={() => setDraft({ start_date: selected })}>
                <Plus className="h-5 w-5" />
              </IconButton>
            </div>
            {daySpecials.length > 0 && (
              <div className="-mx-2 mb-1 space-y-0.5">
                {daySpecials.map((x) => (
                  <SpecialRow key={x.title} s={x} />
                ))}
              </div>
            )}
            {dayEvents.length === 0 && dayTasks.length === 0 ? (
              <button onClick={() => setDraft({ start_date: selected })} className="w-full rounded-xl border border-dashed border-line px-3 py-5 text-center text-[14px] text-ink-3 hover:bg-surface-2">
                Noch nichts eingetragen – tippen zum Hinzufügen
              </button>
            ) : (
              <div className="-mx-2 space-y-0.5">
                {dayEvents.map((e) => (
                  <EventRow key={e.id} e={e} users={users} onOpen={() => setDraft(e)} />
                ))}
                {dayTasks.map((t) => (
                  <TaskLine key={t.id} t={t} onOpen={() => navigate(`/planung/${t.id}`)} />
                ))}
              </div>
            )}
          </div>

          <div className="card p-4 sm:p-5">
            <h2 className="section-title mb-2 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-ink-3" /> Demnächst
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-[14px] text-ink-3">Keine weiteren Termine eingetragen.</p>
            ) : (
              <div className="-mx-2 space-y-0.5">
                {upcoming.map((it) =>
                  it.type === 'event' ? (
                    <EventRow key={it.e.id} e={it.e} users={users} showDate={dayLabel(it.date, today)} onOpen={() => setDraft(it.e)} />
                  ) : (
                    <SpecialRow key={it.date + it.s.title} s={it.s} showDate={dayLabel(it.date, today)} onOpen={() => openDay(it.date)} />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <EventSheet draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}

function TaskLine({ t, onOpen }: { t: Task; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
      <TaskCheck task={t} size={20} />
      <button onClick={onOpen} className={cx('min-w-0 flex-1 truncate py-0.5 text-left text-[14px] text-ink-2', t.status === 'done' && 'line-through')}>
        <span className="mr-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Aufgabe</span>
        {t.title}
      </button>
    </div>
  );
}

