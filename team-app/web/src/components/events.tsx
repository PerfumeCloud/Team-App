import { useEffect, useState, type FormEvent } from 'react';
import { Bell, CalendarDays, Check, Clock, Flag, MapPin, ShoppingBag, Trash2, Users } from 'lucide-react';
import { AutoTextarea, Avatar, Button, cx, Segmented, Sheet, Toggle } from './ui';
import { useStore } from '../lib/store';
import { KINDS, kindInfo, plusHour, REMINDERS_ALLDAY, REMINDERS_TIMED, timeLabel } from '../lib/calendar';
import { toast } from '../lib/toast';
import type { SpecialDay } from '../lib/holidays';
import type { CalEvent, EventKind, User } from '../lib/types';

export type EventDraft = Partial<CalEvent> & { start_date: string };

/** Farbiger Punkt bzw. Streifen für die Art des Termins. */
export function KindDot({ kind, className }: { kind: EventKind; className?: string }) {
  return <span className={cx(kindInfo(kind).tone, 'inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: 'var(--u-fg)' }} />;
}

/** Zeile in Listen: Uhrzeit, Titel, Ort, Teilnehmer. */
export function EventRow({ e, users, onOpen, showDate }: { e: CalEvent; users: Record<string, User>; onOpen: () => void; showDate?: string }) {
  return (
    <button onClick={onOpen} className={cx(kindInfo(e.kind).tone, 'flex w-full items-stretch gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2')}>
      <span className="w-1 shrink-0 rounded-full" style={{ background: 'var(--u-fg)' }} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-3">
          {showDate ? `${showDate} · ` : ''}
          {timeLabel(e)}
        </div>
        <div className="truncate text-[14.5px] font-medium text-ink">{e.title || 'Ohne Titel'}</div>
        {e.location && (
          <div className="flex items-center gap-1 truncate text-[12.5px] text-ink-2">
            <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{e.location}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center -space-x-1.5 self-center">
        {e.attendees.length ? (
          e.attendees.slice(0, 3).map((id) => <Avatar key={id} user={users[id]} size={22} ring />)
        ) : (
          <span className="text-[11.5px] text-ink-3">Team</span>
        )}
      </div>
    </button>
  );
}

/** Feiertag (rot) bzw. Aktionstag für den Shop (bernstein) – automatisch eingetragen. */
export const specialTone = (s: SpecialDay) => (s.type === 'feiertag' ? 'u-holiday' : 'u-amber');

/** Zeile für Feiertage und Aktionstage – gleiche Ausrichtung wie EventRow. */
export function SpecialRow({ s, showDate, onOpen }: { s: SpecialDay; showDate?: string; onOpen?: () => void }) {
  const hol = s.type === 'feiertag';
  const Icon = hol ? Flag : ShoppingBag;
  return (
    <button onClick={onOpen} className={cx(specialTone(s), 'flex w-full items-stretch gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2')}>
      <span className="w-1 shrink-0 rounded-full" style={{ background: 'var(--u-fg)' }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--u-fg)' }}>
          <Icon className="h-3 w-3 shrink-0" />
          {showDate ? `${showDate} · ` : ''}
          {hol ? 'Feiertag' : 'Aktionstag'}
        </div>
        <div className="truncate text-[14.5px] font-medium text-ink">{s.title}</div>
      </div>
    </button>
  );
}

/** Termin anlegen oder bearbeiten. */
export function EventSheet({ draft, onClose }: { draft: EventDraft | null; onClose: () => void }) {
  return (
    <Sheet open={!!draft} onClose={onClose} title={<span className="eyebrow">{draft?.id ? 'Termin bearbeiten' : 'Neuer Termin'}</span>}>
      {draft && <EventForm key={draft.id ?? 'new'} draft={draft} onClose={onClose} />}
    </Sheet>
  );
}

function EventForm({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const saveEvent = useStore((s) => s.saveEvent);
  const deleteEvent = useStore((s) => s.deleteEvent);
  const usersMap = useStore((s) => s.users);
  const users = Object.values(usersMap).filter((u) => !u.deleted);
  const [f, setF] = useState(() => {
    const start = draft.start_time === undefined ? '10:00' : draft.start_time;
    return {
      title: draft.title ?? '',
      kind: draft.kind ?? ('termin' as EventKind),
      allDay: start === null,
      start_date: draft.start_date,
      start_time: start ?? '10:00',
      end_time: draft.end_time ?? (start ? plusHour(start) : '11:00'),
      end_date: draft.end_date ?? '',
      location: draft.location ?? '',
      notes: draft.notes ?? '',
      attendees: draft.attendees ?? [],
      remind_minutes: draft.remind_minutes === undefined ? (start === null ? 0 : 30) : draft.remind_minutes,
    };
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const reminders = f.allDay ? REMINDERS_ALLDAY : REMINDERS_TIMED;

  // Beim Wechsel ganztägig ↔ mit Uhrzeit eine passende Erinnerung wählen
  useEffect(() => {
    if (!reminders.some((r) => r.value === f.remind_minutes)) set({ remind_minutes: f.allDay ? 0 : 30 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.allDay]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) {
      toast('Bitte einen Titel eingeben', 'error');
      return;
    }
    const multi = f.end_date && f.end_date > f.start_date;
    saveEvent({
      id: draft.id,
      title: f.title.trim(),
      kind: f.kind,
      start_date: f.start_date,
      start_time: f.allDay ? null : f.start_time,
      end_time: f.allDay ? null : f.end_time && (multi || f.end_time > f.start_time) ? f.end_time : null,
      end_date: multi ? f.end_date : null,
      location: f.location.trim() || null,
      notes: f.notes.trim() || null,
      attendees: f.attendees,
      remind_minutes: f.remind_minutes,
    });
    toast(draft.id ? 'Termin gespeichert' : 'Termin eingetragen', 'success');
    onClose();
  }

  return (
    <form onSubmit={submit} className="space-y-5 pt-1">
      <input
        className="w-full bg-transparent font-display text-[26px] font-semibold leading-tight text-ink placeholder:text-ink-3 focus:outline-none"
        placeholder="Titel, z. B. Meeting Lieferant"
        value={f.title}
        onChange={(e) => set({ title: e.target.value })}
        autoFocus={!draft.id}
        aria-label="Titel"
      />
      <Segmented value={f.kind} onChange={(v) => set({ kind: v })} className="w-full" options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />

      <div className="space-y-3 rounded-2xl bg-surface-2/70 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
            <Clock className="h-4 w-4 text-ink-3" /> Ganztägig
          </span>
          <Toggle label="Ganztägig" checked={f.allDay} onChange={(v) => set({ allDay: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="ev-date">
              Datum
            </label>
            <input id="ev-date" type="date" className="field" value={f.start_date} required onChange={(e) => set({ start_date: e.target.value || f.start_date })} />
          </div>
          {!f.allDay && (
            <>
              <div>
                <label className="label" htmlFor="ev-from">
                  Von
                </label>
                <input
                  id="ev-from"
                  type="time"
                  className="field"
                  value={f.start_time}
                  onChange={(e) => {
                    const t = e.target.value || f.start_time;
                    set({ start_time: t, end_time: f.end_time <= t ? plusHour(t) : f.end_time });
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor="ev-to">
                  Bis
                </label>
                <input id="ev-to" type="time" className="field" value={f.end_time} onChange={(e) => set({ end_time: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <div>
          <label className="label" htmlFor="ev-end">
            Mehrtägig bis <span className="text-ink-3">(optional)</span>
          </label>
          <input id="ev-end" type="date" className="field" min={f.start_date} value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="label flex items-center gap-1.5" htmlFor="ev-loc">
          <MapPin className="h-3.5 w-3.5" /> Ort
        </label>
        <input id="ev-loc" className="field" placeholder="z. B. Büro, Düsseldorf, Zoom-Link" value={f.location} onChange={(e) => set({ location: e.target.value })} />
      </div>

      <div>
        <span className="label flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Wer ist dabei?
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => set({ attendees: [] })}
            className={cx(
              'flex h-9 items-center rounded-full border px-3 text-[13px] transition-colors',
              f.attendees.length === 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
            )}
          >
            Ganzes Team
          </button>
          {users.map((u) => {
            const on = f.attendees.includes(u.id);
            return (
              <button
                type="button"
                key={u.id}
                aria-pressed={on}
                onClick={() => set({ attendees: on ? f.attendees.filter((x) => x !== u.id) : [...f.attendees, u.id] })}
                className={cx(
                  'flex h-9 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] transition-colors',
                  on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
                )}
              >
                <Avatar user={u} size={26} />
                {u.name.split(' ')[0]}
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">Eingetragene bekommen eine Push-Nachricht und die Erinnerung. Sehen können den Termin alle im Team.</p>
      </div>

      <div>
        <label className="label flex items-center gap-1.5" htmlFor="ev-rem">
          <Bell className="h-3.5 w-3.5" /> Erinnerung per Push
        </label>
        <select
          id="ev-rem"
          className="field"
          value={f.remind_minutes === null ? '' : String(f.remind_minutes)}
          onChange={(e) => set({ remind_minutes: e.target.value === '' ? null : Number(e.target.value) })}
        >
          {reminders.map((r) => (
            <option key={String(r.value)} value={r.value === null ? '' : String(r.value)}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="ev-notes">
          Notizen
        </label>
        <AutoTextarea id="ev-notes" className="field min-h-[80px] leading-relaxed" placeholder="Agenda, Links, Mitbringen …" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button type="submit" icon={<CalendarDays className="h-4 w-4" />}>
          {draft.id ? 'Speichern' : 'Eintragen'}
        </Button>
        {draft.id && (
          <Button
            type="button"
            variant="ghost"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              if (!confirm('Termin löschen?')) return;
              deleteEvent(draft.id!);
              toast('Termin gelöscht', 'success');
              onClose();
            }}
          >
            Löschen
          </Button>
        )}
      </div>
    </form>
  );
}
