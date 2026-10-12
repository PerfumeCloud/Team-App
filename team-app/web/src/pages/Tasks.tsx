import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ListChecks, Plus } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { PersonFilter } from '../components/PersonFilter';
import { STATUS_LABEL, TaskCard, TaskDetail } from '../components/tasks';
import { Button, cx, EmptyState, Segmented } from '../components/ui';
import { sortTasks, useStore } from '../lib/store';
import type { Task, TaskStatus } from '../lib/types';
import { useIsDesktop } from '../lib/hooks';

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

export default function Tasks() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tasksMap = useStore((s) => s.tasks);
  const usersMap = useStore((s) => s.users);
  const me = useStore((s) => s.me);
  const saveTask = useStore((s) => s.saveTask);
  const desktop = useIsDesktop();
  const [person, setPerson] = useState<string | 'all'>('all');
  const [tab, setTab] = useState<TaskStatus>('todo');
  const [quick, setQuick] = useState('');
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const users = Object.values(usersMap).filter((u) => !u.deleted);
  const filtered = useMemo(
    () => Object.values(tasksMap).filter((t) => person === 'all' || (person === 'none' ? !t.assignee_id : t.assignee_id === person)),
    [tasksMap, person],
  );
  const byStatus = useMemo(() => {
    const out: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of filtered) out[t.status].push(t);
    for (const s of STATUSES) out[s] = sortTasks(out[s]);
    out.done = out.done.slice(0, 40);
    return out;
  }, [filtered]);

  const open = (t: Task) => navigate(`/planung/${t.id}`);

  function addQuick(e: FormEvent, status: TaskStatus = desktop ? 'todo' : tab) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    saveTask({ title, status: status === 'done' ? 'todo' : status, assignee_id: person !== 'all' && person !== 'none' ? person : null });
    setQuick('');
  }

  function createAndOpen() {
    const t = saveTask({ title: 'Neue Aufgabe', status: 'todo', assignee_id: person !== 'all' && person !== 'none' ? person : (me?.id ?? null) });
    navigate(`/planung/${t.id}`);
  }

  const total = byStatus.todo.length + byStatus.doing.length;

  return (
    <>
      <PageHeader
        title="Planung"
        subtitle={total ? `${total} offene Aufgabe${total === 1 ? '' : 'n'}` : 'Alles erledigt'}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={createAndOpen}>
            Neue Aufgabe
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <PersonFilter users={users} value={person} onChange={setPerson} meId={me?.id} />
      </div>

      {desktop ? (
        <div className="grid grid-cols-3 gap-5">
          {STATUSES.map((s) => (
            <section
              key={s}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/task-id')) {
                  e.preventDefault();
                  setDragOver(s);
                }
              }}
              onDragLeave={() => setDragOver((d) => (d === s ? null : d))}
              onDrop={(e) => {
                const taskId = e.dataTransfer.getData('text/task-id');
                setDragOver(null);
                if (taskId && tasksMap[taskId]?.status !== s) saveTask({ id: taskId, status: s });
              }}
              className={cx('flex min-h-[320px] flex-col rounded-3xl p-3 transition-colors', dragOver === s ? 'bg-accent-soft' : 'bg-surface-2/60')}
            >
              <div className="mb-3 flex items-center justify-between px-1.5 pt-1">
                <h2 className="text-[13.5px] font-semibold text-ink">{STATUS_LABEL[s]}</h2>
                <span className="tnum text-[12px] text-ink-3">{byStatus[s].length}</span>
              </div>
              {s === 'todo' && (
                <form onSubmit={(e) => addQuick(e, 'todo')} className="mb-3">
                  <input className="field bg-surface/80" placeholder="+ Aufgabe hinzufügen" value={quick} onChange={(e) => setQuick(e.target.value)} />
                </form>
              )}
              <div className="flex flex-col gap-2.5">
                {byStatus[s].map((t) => (
                  <TaskCard key={t.id} task={t} onOpen={() => open(t)} draggable />
                ))}
                {byStatus[s].length === 0 && <p className="px-2 py-6 text-center text-[13px] text-ink-3">{s === 'done' ? 'Noch nichts erledigt' : 'Leer – Karten hierher ziehen'}</p>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            className="mb-4 w-full"
            options={STATUSES.map((s) => ({
              value: s,
              label: (
                <span>
                  {STATUS_LABEL[s]} <span className="tnum text-ink-3">{byStatus[s].length}</span>
                </span>
              ),
            }))}
          />
          {tab !== 'done' && (
            <form onSubmit={addQuick} className="mb-3">
              <input className="field" placeholder="+ Aufgabe hinzufügen" value={quick} onChange={(e) => setQuick(e.target.value)} enterKeyHint="done" />
            </form>
          )}
          <div className="flex flex-col gap-2.5">
            {byStatus[tab].map((t) => (
              <TaskCard key={t.id} task={t} onOpen={() => open(t)} />
            ))}
          </div>
          {byStatus[tab].length === 0 && (
            <EmptyState
              icon={<ListChecks className="h-6 w-6" />}
              title={tab === 'done' ? 'Noch nichts erledigt' : 'Nichts offen'}
              text={tab === 'todo' ? 'Schreib oben eine neue Aufgabe rein – sie erscheint sofort bei allen.' : undefined}
            />
          )}
        </>
      )}

      <TaskDetail taskId={id ?? null} onClose={() => navigate('/planung')} />
    </>
  );
}
