import type { User } from '../lib/types';
import { Avatar, cx } from './ui';

/** Filter-Leiste: Alle · Ich · weitere Personen */
export function PersonFilter({
  users,
  value,
  onChange,
  meId,
  withNone,
}: {
  users: User[];
  value: string;
  onChange: (v: string) => void;
  meId?: string;
  withNone?: boolean;
}) {
  const sorted = [...users].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)));
  const pill = (active: boolean) =>
    cx(
      'flex h-9 shrink-0 items-center gap-2 rounded-full border text-[14px] font-medium transition-colors',
      active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:text-ink',
    );
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      <button className={cx(pill(value === 'all'), 'px-3.5')} onClick={() => onChange('all')}>
        Alle
      </button>
      {sorted.map((u) => (
        <button key={u.id} className={cx(pill(value === u.id), 'pl-1 pr-3.5')} onClick={() => onChange(u.id)}>
          <Avatar user={u} size={27} />
          {u.id === meId ? 'Ich' : u.name.split(' ')[0]}
        </button>
      ))}
      {withNone && (
        <button className={cx(pill(value === 'none'), 'px-3.5')} onClick={() => onChange('none')}>
          Nicht zugewiesen
        </button>
      )}
    </div>
  );
}
