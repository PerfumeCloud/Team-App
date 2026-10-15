import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  BellRing,
  CalendarClock,
  Check,
  CircleAlert,
  Crown,
  ExternalLink,
  Gift,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { BarList, StatTile } from '../components/charts';
import { AutoTextarea, Button, Chip, cx, EmptyState, IconButton, Segmented, Sheet, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { dateTime, euro, int, relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';
import type { Broadcast, BroadcastOverview, BroadcastStatus, BroadcastTemplate, ClubStats } from '../lib/types';

/** Club-Admin in einem neuen Fenster öffnen – mit Einmal-Link, ohne erneute Anmeldung. */
export async function openClubAdmin() {
  // Fenster sofort öffnen (sonst blockt der Browser das Pop-up nach dem Warten auf den Server)
  const w = window.open('', '_blank');
  try {
    const { url } = await api<{ url: string }>('POST', '/club/sso');
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    toast((e as Error).message, 'error');
  }
}

export default function Club() {
  const { tab = 'statistik' } = useParams();
  const navigate = useNavigate();
  const meta = useStore((s) => s.meta);
  const me = useStore((s) => s.me);
  const [opening, setOpening] = useState(false);

  if (meta && !meta.clubConfigured) {
    return (
      <>
        <PageHeader title="Members Club" />
        <div className="card">
          <EmptyState
            icon={<Crown className="h-6 w-6" />}
            title={me?.role === 'admin' ? 'Club noch nicht verbunden' : 'Kein Zugang zum Club'}
            text={
              me?.role === 'admin'
                ? 'Trag unter Integrationen die Adresse des Clubs und den Schlüssel aus den Club-Einstellungen ein. Liegt der Club in derselben Datenbank, wird beides automatisch erkannt.'
                : 'Ein Admin kann dir unter Einstellungen → Team den Club-Zugang geben.'
            }
            action={
              me?.role === 'admin' && (
                <Button icon={<Settings className="h-4 w-4" />} onClick={() => navigate('/einstellungen/integrationen#club')}>
                  Club verbinden
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Members Club"
        subtitle="Mitglieder, Punkte und Nachrichten an alle im Club"
        actions={
          <Button
            variant="secondary"
            icon={<ExternalLink className="h-4 w-4" />}
            loading={opening}
            onClick={async () => {
              setOpening(true);
              await openClubAdmin();
              setOpening(false);
            }}
          >
            Club-Admin öffnen
          </Button>
        }
      />
      <Segmented
        className="mb-6"
        value={tab === 'nachrichten' ? 'nachrichten' : 'statistik'}
        onChange={(v) => navigate(v === 'statistik' ? '/club' : `/club/${v}`)}
        options={[
          { value: 'statistik', label: 'Statistik' },
          { value: 'nachrichten', label: 'Nachricht an Mitglieder' },
        ]}
      />
      {tab === 'nachrichten' ? <Messages /> : <ClubStatistics />}
    </>
  );
}

// ---------------- Statistik ----------------

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)} %` : '–');

function ClubStatistics() {
  const [s, setS] = useState<ClubStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const now = useNow();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setS(await api<ClubStats>('GET', '/club/stats'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 120000);
    return () => window.clearInterval(t);
  }, [load]);

  if (!s) return <div className="flex justify-center py-20">{error ? <p className="max-w-md text-center text-bad">{error}</p> : <Spinner />}</div>;

  const codes = Array.isArray(s.codes) ? {} : s.codes;
  const used = codes.used ?? { count: 0, cents: 0 };
  const bonus = Array.isArray(s.bonus) ? [] : Object.entries(s.bonus).sort((a, b) => b[1].points - a[1].points);
  const feedbackTotal = s.feedback.gut + s.feedback.neutral + s.feedback.schlecht;

  return (
    <div className={cx('space-y-5 transition-opacity', loading && 'opacity-70')}>
      {error && (
        <p className="flex items-start gap-2 rounded-2xl bg-bad/10 p-3 text-[13.5px] text-bad">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {s.promotion && (
        <div className="flex items-center gap-3 rounded-2xl bg-accent-soft p-4 text-[14px] text-accent">
          <Sparkles className="h-5 w-5 shrink-0" />
          <span>
            <b>{s.promotion.name}</b> läuft: {s.promotion.factor === 2 ? 'doppelte' : `${s.promotion.factor.toLocaleString('de-DE')}-fache`} Punkte bis {dateTime(s.promotion.ends_at)}.
          </span>
        </div>
      )}
      {s.open_claims > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn/10 p-4 text-[14px] text-warn">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 shrink-0" />
            {s.open_claims === 1 ? 'Eine Bewertung wartet' : `${s.open_claims} Bewertungen warten`} auf Prüfung (Extra-Punkte).
          </span>
          <Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => void openClubAdmin()}>
            Im Club-Admin prüfen
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.6fr]">
        <div className="card flex flex-col justify-between p-5">
          <div>
            <span className="text-[13px] font-medium text-ink-2">Mitglieder</span>
            <div className="mt-2 tnum text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[48px]">{int(s.members)}</div>
            <div className="mt-2 text-[13px] text-ink-2">
              +{int(s.new_7)} diese Woche · +{int(s.new_30)} in 30 Tagen
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div>
              <div className="text-[12.5px] text-ink-2">Aktiv (30 Tage)</div>
              <div className="tnum text-[18px] font-semibold text-ink">{int(s.active_30)}</div>
              <div className="text-[12px] text-ink-3">{pct(s.active_30, s.members)} der Mitglieder</div>
            </div>
            <div>
              <div className="text-[12.5px] text-ink-2">Mit Push</div>
              <div className="tnum text-[18px] font-semibold text-ink">{int(s.push_members)}</div>
              <div className="text-[12px] text-ink-3">{pct(s.push_members, s.members)} erreichbar</div>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="section-title">Verteilung auf die Stufen</h2>
            <span className="text-[12px] text-ink-3">nach Umsatz der letzten 12 Monate</span>
          </div>
          <BarList items={s.tiers.map((t) => ({ label: t.name, value: t.count, display: int(t.count), sub: pct(t.count, s.members) }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Punkte gesammelt" value={int(s.points.earned)} sub={`+${int(s.points.earned_30)} in 30 Tagen`} icon={<Sparkles className="h-4 w-4" />} />
        <StatTile label="Punkte eingelöst" value={int(s.points.redeemed)} sub={`${int(s.points.redeemed_30)} in 30 Tagen`} icon={<Undo2 className="h-4 w-4" />} />
        <StatTile
          label="Prämien eingelöst"
          value={int(used.count)}
          sub={`${euro(used.cents)} Rabatt · ${int(s.codes_used_30.count)} in 30 Tagen`}
          icon={<Gift className="h-4 w-4" />}
        />
        <StatTile
          label="Offene Punkte"
          value={int(s.points.available)}
          sub={`entspricht ${euro(s.points.available_value_cents)} Rabatt`}
          footer={
            <span className="text-[12px] text-ink-3">
              {int(s.points.pending)} warten auf Rückgabefrist{s.points.locked ? ` · ${int(s.points.locked)} Bonus bis 1. Bestellung` : ''}
              {s.points.expired ? ` · ${int(s.points.expired)} verfallen` : ''}
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="section-title">Beitritte je Monat</h2>
            <span className="text-[12px] text-ink-3">letzte 12 Monate</span>
          </div>
          <MonthBars data={s.joins_by_month} />
        </div>
        <div className="card p-5">
          <h2 className="section-title mb-4">Extra-Punkte</h2>
          {bonus.length ? (
            <BarList items={bonus.map(([, b]) => ({ label: b.title, value: b.points, display: `${int(b.points)} P.`, sub: `${int(b.count)}×` }))} />
          ) : (
            <p className="text-[13.5px] text-ink-3">Noch keine Extra-Punkte vergeben (Geburtstag, Bewertung, Newsletter, Empfehlung, Startbonus).</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile label="Bestellungen von Mitgliedern" value={int(s.orders_30.count)} sub={`${euro(s.orders_30.revenue_cents)} in 30 Tagen`} footer={<span className="text-[12px] text-ink-3">insgesamt {int(s.orders.count)} · {euro(s.orders.revenue_cents)}</span>} />
        <StatTile
          label="Feedback"
          value={int(feedbackTotal)}
          sub={feedbackTotal ? `${int(s.feedback.gut)} gut · ${int(s.feedback.neutral)} neutral · ${int(s.feedback.schlecht)} schlecht` : 'noch keine Antworten'}
          icon={<MessageSquareText className="h-4 w-4" />}
          onClick={() => navigate('/club/nachrichten')}
        />
        <StatTile label="Nachricht an Mitglieder" value={int(s.push_members)} sub="Mitglieder erreichbar per Push" icon={<BellRing className="h-4 w-4" />} onClick={() => navigate('/club/nachrichten')} />
      </div>

      <div className="flex items-center justify-between gap-3 px-1 text-[12px] text-ink-3">
        <span>Stand {relative(s.at, now)} · Daten aus dem Club</span>
        <IconButton label="Aktualisieren" onClick={() => void load()}>
          <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  );
}

const monthShort = new Intl.DateTimeFormat('de-DE', { month: 'short' });
const monthLong = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

/** Säulen je Monat: eine Farbe, Wert beim Darüberfahren und für den letzten Monat. */
function MonthBars({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? data.length - 1;
  return (
    <div>
      <div className="flex h-36 items-end gap-1 border-b border-line sm:gap-1.5" onPointerLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const [y, m] = d.month.split('-').map(Number);
          const date = new Date(y, m - 1, 1);
          return (
            <button
              type="button"
              key={d.month}
              className="relative flex h-full flex-1 items-end focus:outline-none"
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${monthLong.format(date)}: ${d.count} Beitritte`}
            >
              {i === shown && (
                <span className="tnum absolute inset-x-[-12px] text-center text-[11.5px] font-semibold text-ink" style={{ bottom: `calc(${(d.count / max) * 100}% + 4px)` }}>
                  {int(d.count)}
                </span>
              )}
              <span
                className={cx('block w-full rounded-t-[4px] transition-[filter]', i === shown && 'brightness-110')}
                style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0, background: 'var(--chart)' }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 sm:gap-1.5">
        {data.map((d, i) => {
          const [y, m] = d.month.split('-').map(Number);
          return (
            <span key={d.month} className={cx('flex-1 text-center text-[10.5px] text-ink-3', i % 2 === 1 && 'max-sm:invisible')}>
              {monthShort.format(new Date(y, m - 1, 1)).replace('.', '')}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Nachricht an Mitglieder ----------------

const STATUS_TONE: Record<BroadcastStatus, 'neutral' | 'warn' | 'accent' | 'good'> = {
  draft: 'neutral',
  review: 'warn',
  approved: 'accent',
  sending: 'accent',
  sent: 'good',
};

/** Beispielwerte für die Vorschau – beim Versand setzt der Club Vorname und Stufe jedes Mitglieds ein. */
const SAMPLE: Record<string, string> = { vorname: 'Anna', stufe: 'Gold' };
const fillSample = (t: string) => t.replace(/\{(vorname|stufe)\}/g, (_, k: string) => SAMPLE[k]);
const fill = (t: string, values: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (values[k]?.trim() ? values[k].trim() : m));

interface Draft {
  id?: string;
  template: string | null;
  kind: 'news' | 'feedback';
  title: string;
  body: string;
  url: string;
  audience: string;
  values: Record<string, string>;
  labels: Record<string, string>;
  when: 'now' | 'later';
  at: string;
}

const localInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function fromTemplate(t: BroadcastTemplate): Draft {
  return {
    template: t.key,
    kind: t.kind,
    title: t.title,
    body: t.body,
    url: t.url,
    audience: t.audience,
    values: {},
    labels: Array.isArray(t.fields) ? {} : t.fields,
    when: 'now',
    at: localInput(Date.now() + 86400000),
  };
}

function fromBroadcast(b: Broadcast, templates: BroadcastTemplate[]): Draft {
  const t = templates.find((x) => x.key === b.template);
  return {
    id: b.id,
    template: b.template,
    kind: b.kind,
    title: b.title,
    body: b.body,
    url: b.url ?? '',
    audience: b.audience,
    values: {},
    labels: t && !Array.isArray(t.fields) ? t.fields : {},
    when: b.scheduled_at ? 'later' : 'now',
    at: localInput(b.scheduled_at ?? Date.now() + 86400000),
  };
}

function Messages() {
  const [ov, setOv] = useState<BroadcastOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<Broadcast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOv(await api<BroadcastOverview>('GET', '/club/broadcasts'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(b: Broadcast, action: 'submit' | 'approve' | 'reject' | 'cancel', body?: Record<string, unknown>) {
    setBusy(`${b.id}:${action}`);
    try {
      const r = await api<Broadcast>('POST', `/club/broadcasts/${b.id}/${action}`, body ?? {});
      const msg = {
        submit: 'Zur Prüfung gegeben',
        approve: r.status === 'sent' ? `Verschickt an ${int(r.recipients)} Mitglieder` : r.scheduled_at ? `Freigegeben – wird am ${dateTime(r.scheduled_at)} verschickt` : 'Freigegeben',
        reject: 'Zurückgegeben',
        cancel: 'Zurückgezogen – wieder ein Entwurf',
      }[action];
      toast(msg, 'success');
      setReview(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove(b: Broadcast) {
    if (!window.confirm(`„${b.title}“ löschen?`)) return;
    try {
      await api('DELETE', `/club/broadcasts/${b.id}`);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (!ov) return <div className="flex justify-center py-20">{error ? <p className="max-w-md text-center text-bad">{error}</p> : <Spinner />}</div>;

  const groups: { key: string; title: string; items: Broadcast[]; hint?: string }[] = [
    { key: 'review', title: 'Zur Prüfung', items: ov.broadcasts.filter((b) => b.status === 'review'), hint: ov.four_eyes ? 'Vier-Augen-Prinzip: Freigeben kann nur jemand anderes als die Person, die sie geschrieben hat.' : undefined },
    { key: 'draft', title: 'Entwürfe', items: ov.broadcasts.filter((b) => b.status === 'draft') },
    { key: 'planned', title: 'Geplant', items: ov.broadcasts.filter((b) => b.status === 'approved' || b.status === 'sending') },
    { key: 'sent', title: 'Verschickt', items: ov.broadcasts.filter((b) => b.status === 'sent') },
  ];
  const audience = (key: string) => ov.audiences.find((a) => a.key === key);

  return (
    <div className="space-y-5">
      <section className="card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="font-display text-[23px] font-semibold text-ink">Nachricht an Mitglieder senden</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              Push-Nachricht an alle im Club, z. B. bei einem neuen Duft. Ablauf: schreiben → zur Prüfung geben → freigeben. Erst mit der Freigabe wird verschickt – sofort oder zum geplanten Zeitpunkt.
            </p>
          </div>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDraft(fromTemplate(ov.templates[0]))}>
            Neue Nachricht
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {ov.templates.map((t) => (
            <button
              key={t.key}
              onClick={() => setDraft(fromTemplate(t))}
              className="flex h-9 items-center gap-2 rounded-full border border-line px-3 text-[13px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
            >
              {t.kind === 'feedback' ? <MessageSquareText className="h-3.5 w-3.5" /> : t.key === 'free' ? <Pencil className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
          {ov.audiences.map((a) => (
            <span key={a.key} className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {a.label}: <b className="tnum font-semibold text-ink-2">{int(a.count)}</b>
            </span>
          ))}
        </p>
      </section>

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.key}>
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="section-title">{g.title}</h2>
                <span className="tnum text-[12.5px] text-ink-3">{g.items.length}</span>
              </div>
              {g.hint && <p className="mb-2 px-1 text-[12.5px] text-ink-3">{g.hint}</p>}
              <ul className="space-y-3">
                {g.items.map((b) => {
                  const mine = b.created_by === ov.me.id;
                  const canApprove = !ov.four_eyes || !mine;
                  return (
                    <li key={b.id} className="card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip tone={STATUS_TONE[b.status]}>{b.status_label}</Chip>
                            {b.kind === 'feedback' && <Chip icon={<MessageSquareText className="h-3 w-3" />}>Feedback-Anfrage</Chip>}
                            <Chip icon={<Users className="h-3 w-3" />}>
                              {audience(b.audience)?.label ?? b.audience}
                              {b.status !== 'sent' && audience(b.audience) ? ` · ${int(audience(b.audience)!.count)}` : ''}
                            </Chip>
                            {b.scheduled_at && b.status !== 'sent' && <Chip icon={<CalendarClock className="h-3 w-3" />}>{dateTime(b.scheduled_at)}</Chip>}
                          </div>
                          <p className="mt-2 text-[15px] font-semibold text-ink">{b.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-2">{b.body}</p>
                          <p className="mt-1.5 text-[12px] text-ink-3">
                            von {b.created_by_name}
                            {b.approved_by_name ? ` · freigegeben von ${b.approved_by_name}` : ''}
                            {b.status === 'sent' && b.sent_at
                              ? ` · ${dateTime(b.sent_at)} an ${int(b.recipients)} Mitglieder${b.delivered !== undefined ? ` · ${int(b.delivered)} zugestellt` : ''}${b.queued ? ` · ${int(b.queued)} warten (Ruhezeit)` : ''}`
                              : ''}
                            {b.answers !== undefined ? ` · ${int(b.answers)} Antworten` : ''}
                          </p>
                          {b.review_note && (
                            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-warn/10 px-3 py-2 text-[13px] text-warn">
                              <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {b.review_note}
                            </p>
                          )}
                          {b.error && (
                            <p className="mt-2 flex items-start gap-1.5 text-[13px] text-bad">
                              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {b.error}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {b.status === 'draft' && (
                          <>
                            <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={busy === `${b.id}:submit`} onClick={() => act(b, 'submit')}>
                              Zur Prüfung geben
                            </Button>
                            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setDraft(fromBroadcast(b, ov.templates))}>
                              Bearbeiten
                            </Button>
                            <IconButton label="Löschen" className="h-8 w-8 hover:text-bad" onClick={() => remove(b)}>
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          </>
                        )}
                        {b.status === 'review' && (
                          <>
                            {canApprove ? (
                              <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setReview(b)}>
                                Prüfen & freigeben
                              </Button>
                            ) : (
                              <span className="flex items-center text-[12.5px] text-ink-3">Wartet auf Freigabe durch eine andere Person</span>
                            )}
                            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setDraft(fromBroadcast(b, ov.templates))}>
                              Bearbeiten
                            </Button>
                          </>
                        )}
                        {b.status === 'approved' && (
                          <Button size="sm" variant="secondary" icon={<Undo2 className="h-3.5 w-3.5" />} loading={busy === `${b.id}:cancel`} onClick={() => act(b, 'cancel')}>
                            Zurückziehen
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}
      {ov.broadcasts.length === 0 && <p className="px-1 text-[13.5px] text-ink-3">Noch keine Nachrichten. Wähle oben eine Vorlage, z. B. „Neuer Duft“.</p>}

      <Sheet open={!!draft} onClose={() => setDraft(null)} wide title={<h2 className="font-display text-[24px] font-semibold text-ink">{draft?.id ? 'Nachricht bearbeiten' : 'Neue Nachricht'}</h2>}>
        {draft && <Composer ov={ov} initial={draft} onDone={async () => { setDraft(null); await load(); }} />}
      </Sheet>
      <Sheet open={!!review} onClose={() => setReview(null)} title={<h2 className="font-display text-[24px] font-semibold text-ink">Prüfen & freigeben</h2>}>
        {review && <Review b={review} ov={ov} busy={busy} onAct={act} />}
      </Sheet>
    </div>
  );
}

/** So sieht die Nachricht auf dem Sperrbildschirm aus. */
function PushPreview({ title, body, appUrl }: { title: string; body: string; appUrl: string }) {
  return (
    <div className="rounded-[22px] bg-surface-2 p-3">
      <div className="flex items-start gap-3 rounded-2xl bg-surface p-3 shadow-card">
        <img src={`${appUrl}/brand/icon-192.png`} onError={(e) => ((e.target as HTMLImageElement).src = '/brand/icon-192.png')} alt="" className="h-9 w-9 shrink-0 rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Perfume Cloud Club</span>
            <span className="text-[11px] text-ink-3">jetzt</span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[14px] font-semibold text-ink">{title || 'Überschrift'}</p>
          <p className="line-clamp-4 text-[13.5px] leading-snug text-ink-2">{body || 'Text der Nachricht'}</p>
        </div>
      </div>
      <p className="mt-2 px-1 text-[11.5px] text-ink-3">Vorschau mit Beispielwerten (Vorname „Anna“, Stufe „Gold“).</p>
    </div>
  );
}

function Composer({ ov, initial, onDone }: { ov: BroadcastOverview; initial: Draft; onDone: () => Promise<void> }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState<'' | 'save' | 'submit'>('');
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const title = fill(d.title, d.values);
  const body = fill(d.body, d.values);
  const fields = Object.entries(d.labels).filter(([k]) => `${d.title} ${d.body}`.includes(`{${k}}`));
  const missing = /\{(?!vorname\}|stufe\})\w+\}/.test(`${title} ${body}`);
  const scheduled = d.when === 'later' ? new Date(d.at).getTime() : null;
  const past = scheduled !== null && (Number.isNaN(scheduled) || scheduled < Date.now());
  const invalidUrl = d.kind === 'news' && d.url.trim() !== '' && !/^(https:\/\/|\/)/.test(d.url.trim());
  const canSave = title.trim() !== '' && body.trim() !== '' && !missing && !past && !invalidUrl;
  const aud = ov.audiences.find((a) => a.key === d.audience);

  async function save(submit: boolean) {
    setBusy(submit ? 'submit' : 'save');
    try {
      const payload = { template: d.template, kind: d.kind, title, body, url: d.kind === 'news' ? d.url.trim() : '', audience: d.audience, scheduled_at: scheduled };
      const b = d.id ? await api<Broadcast>('PUT', `/club/broadcasts/${d.id}`, payload) : await api<Broadcast>('POST', '/club/broadcasts', payload);
      if (submit) await api('POST', `/club/broadcasts/${b.id}/submit`, {});
      toast(submit ? 'Zur Prüfung gegeben' : 'Entwurf gespeichert', 'success');
      await onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="label">Vorlage</span>
        <div className="flex flex-wrap gap-1.5">
          {ov.templates.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={d.template === t.key}
              onClick={() => setD({ ...fromTemplate(t), id: d.id })}
              className={cx(
                'h-8 rounded-full border px-3 text-[12.5px] transition-colors',
                d.template === t.key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {fields.map(([k, label]) => (
        <div key={k}>
          <label className="label" htmlFor={`f-${k}`}>
            {label}
          </label>
          <input id={`f-${k}`} className="field" value={d.values[k] ?? ''} onChange={(e) => set({ values: { ...d.values, [k]: e.target.value } })} placeholder={k === 'duft' ? 'z. B. Ambre Soir' : ''} autoFocus />
        </div>
      ))}

      <div>
        <label className="label" htmlFor="b-title">
          Überschrift <span className="tnum text-ink-3">· {title.length}/120</span>
        </label>
        <input id="b-title" className="field" maxLength={120} value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="b-body">
          Text <span className="tnum text-ink-3">· {body.length}/400</span>
        </label>
        <AutoTextarea id="b-body" className="field min-h-[88px]" maxLength={400} value={d.body} onChange={(e) => set({ body: e.target.value })} />
        <p className="mt-1 text-[12px] text-ink-3">
          <code className="rounded bg-surface-2 px-1">{'{vorname}'}</code> und <code className="rounded bg-surface-2 px-1">{'{stufe}'}</code> setzt der Club beim Versand für jedes Mitglied ein. Am Sperrbildschirm sind etwa 150 Zeichen sichtbar.
        </p>
        {missing && <p className="mt-1 text-[12.5px] text-warn">Bitte die Platzhalter in geschweiften Klammern ausfüllen.</p>}
      </div>

      {d.kind === 'news' ? (
        <div>
          <label className="label" htmlFor="b-url">
            Link beim Antippen <span className="text-ink-3">(optional)</span>
          </label>
          <input id="b-url" className="field" value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://perfumecloud.de/products/…" inputMode="url" />
          {invalidUrl ? (
            <p className="mt-1 text-[12.5px] text-bad">Der Link muss mit https:// beginnen.</p>
          ) : (
            <p className="mt-1 text-[12px] text-ink-3">Leer = öffnet die Club-App.</p>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
          Öffnet in der Club-App die Feedback-Seite: Gut, Neutral oder Schlecht, optional mit Begründung. Die Antworten gehen an info@perfumecloud.de.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className="label">Empfänger</span>
          <select className="field" value={d.audience} onChange={(e) => set({ audience: e.target.value })}>
            {ov.audiences.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label} ({int(a.count)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Zeitpunkt</span>
          <Segmented
            className="w-full"
            value={d.when}
            onChange={(v) => set({ when: v })}
            options={[
              { value: 'now', label: 'Nach Freigabe' },
              { value: 'later', label: 'Geplant' },
            ]}
          />
          {d.when === 'later' && <input type="datetime-local" className="field mt-2" value={d.at} onChange={(e) => set({ at: e.target.value })} />}
          {past && <p className="mt-1 text-[12.5px] text-bad">Der Zeitpunkt liegt in der Vergangenheit.</p>}
        </div>
      </div>
      <p className="text-[12px] text-ink-3">
        Nur Mitglieder mit Push und eingeschalteten „Aktionen & Neuheiten“ bekommen die Nachricht{aud ? ` – gerade ${int(aud.count)}` : ''}. Zwischen {ov.quiet.start} und {ov.quiet.end} Uhr wartet sie bis zum Ende der Ruhezeit.
      </p>

      <PushPreview title={fillSample(title)} body={fillSample(body)} appUrl={ov.app_url} />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button icon={<Send className="h-4 w-4" />} disabled={!canSave} loading={busy === 'submit'} onClick={() => save(true)}>
          Zur Prüfung geben
        </Button>
        <Button variant="secondary" disabled={!canSave} loading={busy === 'save'} onClick={() => save(false)}>
          Als Entwurf speichern
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">Verschickt wird erst nach der Freigabe{ov.four_eyes ? ' durch eine andere Person' : ''}.</p>
    </div>
  );
}

function Review({
  b,
  ov,
  busy,
  onAct,
}: {
  b: Broadcast;
  ov: BroadcastOverview;
  busy: string | null;
  onAct: (b: Broadcast, action: 'approve' | 'reject', body?: Record<string, unknown>) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const aud = ov.audiences.find((a) => a.key === b.audience);
  const rows: [string, ReactNode][] = useMemo(
    () => [
      ['Empfänger', `${aud?.label ?? b.audience}${aud ? ` · ${int(aud.count)} Mitglieder mit Push` : ''}`],
      ['Zeitpunkt', b.scheduled_at ? dateTime(b.scheduled_at) : 'sofort nach der Freigabe'],
      ['Beim Antippen', b.kind === 'feedback' ? 'Feedback-Seite im Club' : b.url || 'Club-App'],
      ['Geschrieben von', b.created_by_name],
    ],
    [aud, b],
  );

  async function test() {
    setTesting(true);
    try {
      const r = await api<{ devices: number; results: { device: string; ok: boolean; reason: string }[] }>('POST', `/club/broadcasts/${b.id}/test`, {});
      const bad = r.results.filter((x) => !x.ok);
      if (bad.length) toast(`Nicht angekommen: ${bad.map((x) => `${x.device}${x.reason ? ` (${x.reason})` : ''}`).join(', ')}`, 'error');
      else toast(`Test an ${r.devices} ${r.devices === 1 ? 'Gerät' : 'Geräte'} geschickt`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PushPreview title={fillSample(b.title)} body={fillSample(b.body)} appUrl={ov.app_url} />
      <dl className="divide-y divide-line/70 rounded-2xl border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-4 py-2.5 text-[13.5px]">
            <dt className="w-32 shrink-0 text-ink-3">{k}</dt>
            <dd className="min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <Button variant="secondary" size="sm" icon={<BellRing className="h-3.5 w-3.5" />} loading={testing} onClick={test}>
        Test an mich
      </Button>
      <p className="-mt-2 text-[12px] text-ink-3">Kommt auf deinen Geräten an, wenn du im Club mit {ov.me.email} angemeldet bist und Mitteilungen eingeschaltet hast.</p>

      {rejecting ? (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <label className="label" htmlFor="note">
            Was soll geändert werden?
          </label>
          <input id="note" className="field" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Link fehlt" autoFocus />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy === `${b.id}:reject`} onClick={() => onAct(b, 'reject', { note })}>
              Zurückgeben
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button
            icon={<Check className="h-4 w-4" />}
            loading={busy === `${b.id}:approve`}
            onClick={() => {
              const text = b.scheduled_at
                ? `Freigeben? Die Nachricht geht am ${dateTime(b.scheduled_at)} an ${aud ? int(aud.count) : 'die'} Mitglieder.`
                : `Jetzt an ${aud ? int(aud.count) : 'alle'} Mitglieder senden?`;
              if (window.confirm(text)) void onAct(b, 'approve');
            }}
          >
            {b.scheduled_at ? 'Freigeben' : 'Freigeben & senden'}
          </Button>
          <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setRejecting(true)}>
            Zurückgeben
          </Button>
        </div>
      )}
    </div>
  );
}
