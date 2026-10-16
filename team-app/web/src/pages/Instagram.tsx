import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Bookmark,
  CalendarClock,
  CircleAlert,
  ClipboardCopy,
  ExternalLink,
  Eye,
  Heart,
  Lightbulb,
  Link2,
  MessageCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { AreaChart, BarList, Sparkline, StatTile, Trend } from '../components/charts';
import { InstagramIcon } from '../components/instagram-icon';
import { Button, Chip, cx, EmptyState, IconButton, Segmented, Sheet, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, int, relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import type { IgFormat, IgGroup, IgMedia, IgOverview, IgTotals } from '../lib/types';
import Planner from '../components/instagram-planner';
import Comments from '../components/instagram-comments';

type Tab = 'uebersicht' | 'beitraege' | 'planung' | 'kommentare';

export const FORMAT_LABEL: Record<IgFormat, string> = { reel: 'Reel', carousel: 'Karussell', image: 'Bild', video: 'Video', story: 'Story' };
const FORMAT_PLURAL: Record<IgFormat, string> = { reel: 'Reels', carousel: 'Karussells', image: 'Bilder', video: 'Videos', story: 'Storys' };

export default function Instagram() {
  const { tab = 'uebersicht' } = useParams();
  const navigate = useNavigate();
  const meta = useStore((s) => s.meta);
  const me = useStore((s) => s.me);
  const current: Tab = (['beitraege', 'planung', 'kommentare'] as const).find((t) => t === tab) ?? 'uebersicht';
  const [o, setO] = useState<IgOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setO(await api<IgOverview>('GET', '/instagram'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5 * 60000);
    return () => window.clearInterval(t);
  }, [load]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api<IgOverview>('POST', '/instagram/sync');
      setO(r);
      toast(r.message ?? 'Aktualisiert', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (meta && !meta.instagram) {
    return (
      <>
        <PageHeader title="Instagram" />
        <div className="card">
          <EmptyState
            icon={<InstagramIcon className="h-6 w-6" />}
            title="Kein Zugang zu Instagram"
            text="Ein Admin kann dir unter Einstellungen → Team den Instagram-Zugang geben."
          />
        </div>
      </>
    );
  }
  if (meta?.instagram && !meta.instagram.connected) {
    return (
      <>
        <PageHeader title="Instagram" />
        <div className="card">
          <EmptyState
            icon={<InstagramIcon className="h-6 w-6" />}
            title="Instagram noch nicht verbunden"
            text="Einmal das Instagram-Konto verbinden – danach gibt es hier Auswertungen, den Planer für Beiträge und alle Kommentare. Anleitung: docs/ANLEITUNG.md, Teil N."
            action={
              me?.role === 'admin' && (
                <Button icon={<Settings className="h-4 w-4" />} onClick={() => navigate('/einstellungen/integrationen#instagram')}>
                  Instagram verbinden
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }

  const username = o?.profile?.username ?? meta?.instagram?.username ?? '';
  return (
    <>
      <PageHeader
        title="Instagram"
        subtitle={username ? `@${username} · Auswertung, Planer und Kommentare` : 'Auswertung, Planer und Kommentare'}
        actions={
          username ? (
            <Button
              variant="secondary"
              icon={<ExternalLink className="h-4 w-4" />}
              onClick={() => window.open(`https://www.instagram.com/${username}/`, '_blank', 'noopener')}
            >
              Auf Instagram
            </Button>
          ) : undefined
        }
      />
      {/* Am Handy seitlich scrollbar, wenn die Reiter nicht in eine Zeile passen */}
      <div className="no-scrollbar -mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented
          value={current}
          onChange={(v) => navigate(v === 'uebersicht' ? '/instagram' : `/instagram/${v}`)}
          options={[
            { value: 'uebersicht', label: 'Übersicht' },
            { value: 'beitraege', label: 'Beiträge' },
            { value: 'planung', label: 'Planer' },
            {
              value: 'kommentare',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Kommentare
                  {o?.kpis.unanswered ? (
                    <span className="tnum rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink">{o.kpis.unanswered}</span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </div>
      {current === 'planung' ? (
        <Planner bestTime={o ? bestTimeHint(o) : null} />
      ) : current === 'kommentare' ? (
        <Comments onChange={(n) => setO((x) => (x ? { ...x, kpis: { ...x.kpis, unanswered: n } } : x))} />
      ) : !o ? (
        <div className="flex justify-center py-20">{error ? <p className="max-w-md text-center text-bad">{error}</p> : <Spinner />}</div>
      ) : current === 'beitraege' ? (
        <MediaGrid media={o.media} />
      ) : (
        <Overview o={o} loading={loading} onRefresh={refresh} />
      )}
    </>
  );
}

/** „Donnerstag abends“ – für den Planer, wenn die Auswertung einen klaren Favoriten hat. */
function bestTimeHint(o: IgOverview): string | null {
  const days = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const slots: Record<string, string> = { morgen: 'morgens', mittag: 'mittags', nachmittag: 'nachmittags', abend: 'abends', nacht: 'spät abends' };
  const best = <T extends string>(g: Partial<Record<T, IgGroup>>) =>
    (Object.entries(g) as [T, IgGroup][]).filter(([, x]) => x.count >= 2 && x.avg !== null).sort((a, b) => (b[1].avg ?? 0) - (a[1].avg ?? 0))[0]?.[0];
  const d = best(o.analysis.weekdays);
  const s = best(o.analysis.slots);
  if (!d && !s) return null;
  return [d ? `am ${days[Number(d)]}` : '', s ? slots[s] : ''].filter(Boolean).join(' ');
}

// ---------------- Übersicht ----------------

const KPI: { key: keyof IgTotals; label: string; icon: typeof Eye }[] = [
  { key: 'reach', label: 'Erreichte Konten', icon: Users },
  { key: 'views', label: 'Aufrufe', icon: Eye },
  { key: 'total_interactions', label: 'Interaktionen', icon: Heart },
  { key: 'profile_links_taps', label: 'Klicks auf Links', icon: Link2 },
];

const GENDER: Record<string, string> = { F: 'Frauen', M: 'Männer', U: 'Ohne Angabe' };
const WEEKDAYS = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const SLOTS: [string, string][] = [
  ['morgen', 'Morgens (6–11 Uhr)'],
  ['mittag', 'Mittags (11–15 Uhr)'],
  ['nachmittag', 'Nachmittags (15–18 Uhr)'],
  ['abend', 'Abends (18–22 Uhr)'],
  ['nacht', 'Spät (22–6 Uhr)'],
];

function Overview({ o, loading, onRefresh }: { o: IgOverview; loading: boolean; onRefresh: () => void }) {
  const now = useNow();
  const navigate = useNavigate();
  const [exportText, setExportText] = useState<string | null>(null);
  const k = o.kpis;
  const a = o.analysis;
  const metricLabel = a.metric === 'reach' ? 'erreichte Konten' : 'Interaktionen';
  const byId = useMemo(() => new Map(o.media.map((m) => [m.id, m])), [o.media]);
  const top = a.top
    .map((id) => byId.get(id))
    .filter((m): m is IgMedia => !!m)
    .slice(0, 3);
  const groupItems = (entries: [string, IgGroup][], label: (k: string) => string) =>
    entries
      .filter(([, g]) => g.avg !== null)
      .map(([key, g]) => ({
        label: label(key),
        value: g.avg ?? 0,
        display: int(g.avg ?? 0),
        sub: `${g.count} Beitr.${g.avg_rate !== null ? ` · ${g.avg_rate.toLocaleString('de-DE')} %` : ''}`,
      }));
  const audience = o.audience;
  const audienceTotal = (rows?: { value: number }[]) => (rows ?? []).reduce((s, r) => s + r.value, 0);

  async function openExport() {
    try {
      setExportText((await api<{ text: string }>('GET', '/instagram/export')).text);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className={cx('space-y-5 transition-opacity', loading && 'opacity-70')}>
      {o.status && !o.status.ok && (
        <p className="flex items-start gap-2 rounded-2xl bg-bad/10 p-3 text-[14px] text-bad">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {o.status.message}
            {o.admin && (
              <button className="ml-1 underline" onClick={() => navigate('/einstellungen/integrationen#instagram')}>
                Zu den Einstellungen
              </button>
            )}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.6fr]">
        <div className="card flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center gap-3">
              {o.profile?.picture ? (
                <img src={o.profile.picture} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-line" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <InstagramIcon className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[15px] font-semibold text-ink">@{o.profile?.username}</div>
                <div className="text-[12px] text-ink-3">
                  {o.profile?.media_count !== null && o.profile?.media_count !== undefined ? `${int(o.profile.media_count)} Beiträge` : ''}
                </div>
              </div>
            </div>
            <span className="mt-5 block text-[13px] font-medium text-ink-2">Follower</span>
            <div className="mt-2 tnum text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[48px]">
              {k.followers !== null ? int(k.followers) : '–'}
            </div>
            <div className="mt-2 text-[13px] text-ink-2">
              {k.followers_7 !== null ? `${k.followers_7 >= 0 ? '+' : '−'}${int(Math.abs(k.followers_7))} in 7 Tagen` : 'Wachstum ab morgen sichtbar'}
              {k.followers_30 !== null ? ` · ${k.followers_30 >= 0 ? '+' : '−'}${int(Math.abs(k.followers_30))} in 30 Tagen` : ''}
            </div>
          </div>
          {o.followers_series.length >= 3 && (
            <div className="mt-4">
              <Sparkline values={o.followers_series.map((p) => p.value)} zero={false} />
            </div>
          )}
        </div>
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-accent" />
            <h2 className="section-title">Was bei euch funktioniert</h2>
          </div>
          {a.tips.length ? (
            <ul className="space-y-2.5">
              {a.tips.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
                  <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
                  <span>{t.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-ink-3">
              Noch zu wenige Beiträge für klare Muster – nach ein paar weiteren Posts stehen hier Tipps aus euren eigenen Zahlen.
            </p>
          )}
          <p className="mt-4 text-[12px] text-ink-3">
            Grundlage: {a.posts} Beiträge der letzten 6 Monate · Ø {a.overall !== null ? int(a.overall) : '–'} {metricLabel} pro Beitrag
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {KPI.map(({ key, label, icon: Icon }) => {
          const cur = k.cur[key];
          const prev = k.prev[key];
          return (
            <StatTile
              key={key}
              label={label}
              value={cur !== undefined ? int(cur) : '–'}
              trend={cur !== undefined && prev !== undefined ? <Trend cur={cur} prev={prev} against="zur Vorwoche" size="sm" /> : undefined}
              sub="letzte 7 Tage"
              icon={<Icon className="h-4 w-4" />}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile
          label="Beiträge (30 Tage)"
          value={int(k.posts_30)}
          sub={`Ø ${a.rhythm.per_week.toLocaleString('de-DE')} pro Woche${a.rhythm.days_since !== null ? ` · letzter vor ${a.rhythm.days_since === 0 ? 'heute' : a.rhythm.days_since === 1 ? '1 Tag' : `${a.rhythm.days_since} Tagen`}` : ''}`}
          icon={<CalendarClock className="h-4 w-4" />}
          onClick={() => navigate('/instagram/planung')}
        />
        <StatTile
          label="Ø Interaktionsrate"
          value={k.rate_30 !== null ? `${k.rate_30.toLocaleString('de-DE')} %` : '–'}
          sub="Interaktionen je erreichtem Konto, 30 Tage"
          icon={<Heart className="h-4 w-4" />}
        />
        <StatTile
          label="Kommentare offen"
          value={int(k.unanswered)}
          sub={k.unanswered ? 'warten auf eine Antwort' : 'alles beantwortet'}
          icon={<MessageCircle className="h-4 w-4" />}
          onClick={() => navigate('/instagram/kommentare')}
        />
      </div>

      {(o.followers_series.length >= 2 || o.reach_series.length >= 2) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {o.followers_series.length >= 2 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Follower</h2>
              <AreaChart
                data={o.followers_series.map((p) => ({ date: p.day, value: p.value }))}
                format={(v) => `${int(v)} Follower`}
                axis={(v) => int(v)}
                height={200}
                zero={false}
              />
            </div>
          )}
          {o.reach_series.length >= 2 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Erreichte Konten pro Tag</h2>
              <AreaChart
                data={o.reach_series.map((p) => ({ date: p.day, value: p.value }))}
                format={(v) => `${int(v)} Konten`}
                axis={(v) => int(v)}
                height={200}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="section-title mb-1">Formate</h2>
          <p className="mb-4 text-[12px] text-ink-3">Ø {metricLabel} pro Beitrag</p>
          {Object.keys(a.formats).length ? (
            <BarList items={groupItems(Object.entries(a.formats) as [string, IgGroup][], (f) => FORMAT_PLURAL[f as IgFormat] ?? f)} />
          ) : (
            <p className="text-[14px] text-ink-3">Noch keine Beiträge.</p>
          )}
        </div>
        <div className="card p-5">
          <h2 className="section-title mb-1">Wochentage</h2>
          <p className="mb-4 text-[12px] text-ink-3">Ø {metricLabel} nach Tag der Veröffentlichung</p>
          <BarList
            items={groupItems(
              Object.entries(a.weekdays).sort((x, y) => Number(x[0]) - Number(y[0])),
              (d) => WEEKDAYS[Number(d)],
            )}
          />
        </div>
        <div className="card p-5">
          <h2 className="section-title mb-1">Tageszeit</h2>
          <p className="mb-4 text-[12px] text-ink-3">Ø {metricLabel} nach Uhrzeit</p>
          <BarList
            items={groupItems(
              SLOTS.filter(([s]) => a.slots[s as keyof typeof a.slots]).map(([s]) => [s, a.slots[s as keyof typeof a.slots]!]),
              (s) => SLOTS.find(([x]) => x === s)?.[1] ?? s,
            )}
          />
        </div>
      </div>

      {top.length > 0 && (
        <section>
          <h2 className="section-title mb-3 px-1">Stärkste Beiträge</h2>
          {/* Am Handy seitlich wischen statt drei große Bilder untereinander */}
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {top.map((m) => (
              <div key={m.id} className="w-[72%] shrink-0 snap-start sm:w-auto">
                <MediaCard m={m} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="section-title mb-1">Hashtags</h2>
          <p className="mb-4 text-[12px] text-ink-3">
            Ø {metricLabel} der Beiträge mit diesem Hashtag
            {a.hashtags.avg_count !== null ? ` · im Schnitt ${a.hashtags.avg_count.toLocaleString('de-DE')} pro Beitrag` : ''}
          </p>
          {a.hashtags.top.length ? (
            <BarList
              items={a.hashtags.top
                .slice(0, 8)
                .map((t) => ({ label: t.tag, value: t.avg ?? 0, display: t.avg !== null ? int(t.avg) : '–', sub: `${t.count}×` }))}
            />
          ) : (
            <p className="text-[14px] text-ink-3">Keine Hashtags in den letzten Beiträgen.</p>
          )}
        </div>
        {o.planned.length > 0 && (
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title">Als Nächstes geplant</h2>
              <Button size="sm" variant="ghost" onClick={() => navigate('/instagram/planung')}>
                Zum Planer
              </Button>
            </div>
            <ul className="divide-y divide-line/70">
              {o.planned.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  {p.images[0] ? (
                    <img src={p.images[0].url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
                      <InstagramIcon className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-ink">{p.caption || FORMAT_LABEL[p.kind as IgFormat]}</p>
                    <p className="text-[12px] text-ink-3">
                      {p.status_label}
                      {p.scheduled_at ? ` · ${dateTime(p.scheduled_at)}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="card p-5">
        <h2 className="section-title mb-1">Zielgruppe</h2>
        {audience && (audience.age?.length || audience.city?.length) ? (
          <>
            <p className="mb-4 text-[12px] text-ink-3">Follower diesen Monat · Stand {relative(audience.at, now)}</p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {!!audience.gender?.length && (
                <div>
                  <h3 className="mb-3 text-[13px] font-medium text-ink-2">Geschlecht</h3>
                  <BarList
                    items={audience.gender.map((g) => ({
                      label: GENDER[g.label] ?? g.label,
                      value: g.value,
                      display: `${Math.round((g.value / Math.max(1, audienceTotal(audience.gender))) * 100)} %`,
                    }))}
                  />
                </div>
              )}
              {!!audience.age?.length && (
                <div>
                  <h3 className="mb-3 text-[13px] font-medium text-ink-2">Alter</h3>
                  <BarList
                    items={[...audience.age]
                      .sort((x, y) => x.label.localeCompare(y.label))
                      .map((g) => ({
                        label: `${g.label} Jahre`,
                        value: g.value,
                        display: `${Math.round((g.value / Math.max(1, audienceTotal(audience.age))) * 100)} %`,
                      }))}
                  />
                </div>
              )}
              {!!audience.city?.length && (
                <div>
                  <h3 className="mb-3 text-[13px] font-medium text-ink-2">Städte</h3>
                  <BarList items={audience.city.map((g) => ({ label: g.label.split(',')[0], value: g.value, display: int(g.value) }))} />
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="mt-2 text-[14px] text-ink-3">Instagram zeigt Alter, Geschlecht und Städte erst ab 100 Followern. Die Daten kommen einmal pro Woche.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px] text-ink-3">
        <span>Stand {o.lastSync ? relative(o.lastSync, now) : '–'} · Daten von Instagram, stündlich abgeglichen</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<ClipboardCopy className="h-3.5 w-3.5" />} onClick={() => void openExport()}>
            Zusammenfassung für Claude
          </Button>
          <IconButton label="Jetzt abgleichen" onClick={onRefresh}>
            <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
          </IconButton>
        </div>
      </div>

      <Sheet open={exportText !== null} onClose={() => setExportText(null)} title="Zusammenfassung für Claude" wide>
        <p className="mb-3 text-[14px] text-ink-2">
          Kopieren und in den Chat mit Claude einfügen – für eine ausführliche Analyse und neue Beitragsideen. Enthält nur Zahlen und eure eigenen Texte, keine
          Namen von Kommentierenden.
        </p>
        <textarea readOnly className="field h-72 font-mono text-[12px]" value={exportText ?? ''} onFocus={(e) => e.currentTarget.select()} />
        <div className="mt-3 flex justify-end">
          <Button
            icon={<ClipboardCopy className="h-4 w-4" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(exportText ?? '');
                toast('Kopiert', 'success');
              } catch {
                toast('Bitte den Text markieren und kopieren', 'error');
              }
            }}
          >
            Kopieren
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------- Beiträge ----------------

function MediaCard({ m }: { m: IgMedia }) {
  return (
    <article className="card overflow-hidden">
      <a href={m.permalink ?? undefined} target="_blank" rel="noopener noreferrer" className="relative block aspect-square bg-surface-2">
        {m.thumb ? (
          <img
            src={m.thumb}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          />
        ) : (
          <span className="flex h-full items-center justify-center text-ink-3">
            <InstagramIcon className="h-8 w-8" />
          </span>
        )}
        <span className="absolute left-2 top-2">
          <Chip className="bg-surface/90 backdrop-blur">{FORMAT_LABEL[m.format]}</Chip>
        </span>
      </a>
      <div className="p-3.5">
        <p className="text-[12px] text-ink-3">{dateTime(m.posted_at)}</p>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] text-ink-2">{m.caption || '–'}</p>
        <div className="tnum mt-2.5 grid grid-cols-4 gap-1 text-[12px] text-ink-2">
          <span className="flex items-center gap-1" title="Erreichte Konten">
            <Users className="h-3.5 w-3.5 text-ink-3" />
            {m.reach !== null ? int(m.reach) : '–'}
          </span>
          <span className="flex items-center gap-1" title="Likes">
            <Heart className="h-3.5 w-3.5 text-ink-3" />
            {int(m.likes)}
          </span>
          <span className="flex items-center gap-1" title="Kommentare">
            <MessageCircle className="h-3.5 w-3.5 text-ink-3" />
            {int(m.comments)}
          </span>
          <span className="flex items-center gap-1" title="Gespeichert">
            <Bookmark className="h-3.5 w-3.5 text-ink-3" />
            {m.saved !== null ? int(m.saved) : '–'}
          </span>
        </div>
        {m.rate !== null && (
          <p className="mt-2 text-[12px] text-ink-3">
            Interaktionsrate <b className="font-semibold text-ink-2">{m.rate.toLocaleString('de-DE')} %</b>
            {m.avg_watch_s !== null ? ` · Ø ${m.avg_watch_s.toLocaleString('de-DE')} s angesehen` : ''}
          </p>
        )}
      </div>
    </article>
  );
}

type Sort = 'neu' | 'reichweite' | 'interaktionen' | 'rate';

function MediaGrid({ media }: { media: IgMedia[] }) {
  const [sort, setSort] = useState<Sort>('neu');
  const [format, setFormat] = useState<'alle' | IgFormat>('alle');
  const formats = Array.from(new Set(media.map((m) => m.format)));
  const list = useMemo(() => {
    const l = media.filter((m) => format === 'alle' || m.format === format);
    const key: Record<Sort, (m: IgMedia) => number> = {
      neu: (m) => m.posted_at,
      reichweite: (m) => m.reach ?? -1,
      interaktionen: (m) => m.interactions,
      rate: (m) => m.rate ?? -1,
    };
    return [...l].sort((a, b) => key[sort](b) - key[sort](a));
  }, [media, sort, format]);

  if (!media.length) {
    return (
      <div className="card">
        <EmptyState
          icon={<InstagramIcon className="h-6 w-6" />}
          title="Noch keine Beiträge abgeglichen"
          text="Die App holt die Beiträge stündlich – oder in der Übersicht auf „Jetzt abgleichen“ tippen."
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'neu', label: 'Neueste' },
            { value: 'reichweite', label: 'Reichweite' },
            { value: 'interaktionen', label: 'Interaktionen' },
            { value: 'rate', label: 'Rate' },
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          {(['alle', ...formats] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={cx(
                'h-8 rounded-full border px-3 text-[13px] transition-colors',
                format === f ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {f === 'alle' ? 'Alle' : FORMAT_PLURAL[f]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((m) => (
          <MediaCard key={m.id} m={m} />
        ))}
      </div>
      <p className="px-1 text-[12px] text-ink-3">
        Die letzten 6 Monate · Kennzahlen neuer Beiträge werden mehrmals täglich aktualisiert, ältere einmal pro Woche.
      </p>
    </div>
  );
}
