import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDownRight, ArrowUpRight, Ban, ChartLine, Crown, CircleAlert, PackageCheck, RefreshCw, Settings, Table2, Trophy, TriangleAlert, Truck, Undo2 } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { AreaChart, BarList, StatTile, Trend } from '../components/charts';
import { Button, Chip, cx, EmptyState, IconButton, Segmented, Spinner } from '../components/ui';
import { useStats } from '../lib/stats';
import { useStore } from '../lib/store';
import type { Stats } from '../lib/types';
import { dateTime, euro, int, relative, time } from '../lib/format';
import { useNow } from '../lib/hooks';

const RANGES = [7, 30, 90] as const;

const perOrder = (t: { orders: number; items: number }) => (t.orders ? t.items / t.orders : 0);
const rate = (n: number, orders: number) =>
  orders + n ? `${((n / (orders + n)) * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % der Bestellungen` : 'keine';

const FULFILLMENT: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' | 'bad' }> = {
  FULFILLED: { label: 'Versendet', tone: 'good' },
  UNFULFILLED: { label: 'Offen', tone: 'warn' },
  PARTIALLY_FULFILLED: { label: 'Teilweise', tone: 'warn' },
  IN_PROGRESS: { label: 'In Arbeit', tone: 'warn' },
  ON_HOLD: { label: 'Angehalten', tone: 'neutral' },
  SCHEDULED: { label: 'Geplant', tone: 'neutral' },
  RESTOCKED: { label: 'Zurück', tone: 'neutral' },
};

export default function Statistics() {
  const [days, setDays] = useState<number>(() => Number(localStorage.getItem('pc-stats-days')) || 30);
  const { data, loading, load, error } = useStats();
  const meta = useStore((s) => s.meta);
  const me = useStore((s) => s.me);
  const navigate = useNavigate();
  const now = useNow();
  const [table, setTable] = useState(false);
  const s = data[days];
  const best = s?.series.reduce<Stats['series'][number] | null>((b, d) => (d.revenue > 0 && (!b || d.revenue > b.revenue) ? d : b), null) ?? null;

  useEffect(() => {
    void load(days);
    try {
      localStorage.setItem('pc-stats-days', String(days));
    } catch {
      /* egal */
    }
    const t = window.setInterval(() => load(days), 120000);
    return () => window.clearInterval(t);
  }, [days, load]);

  if (meta && !meta.shopifyConfigured && !s?.current.orders) {
    return (
      <>
        <PageHeader title="Statistik" />
        <div className="card">
          <EmptyState
            icon={<ChartLine className="h-6 w-6" />}
            title="Shopify noch nicht verbunden"
            text="Sobald der Shop verbunden ist, seht ihr hier Umsatz, Bestellungen, Top-Düfte und knappe Bestände."
            action={
              me?.role === 'admin' && (
                <Button icon={<Settings className="h-4 w-4" />} onClick={() => navigate('/einstellungen/integrationen')}>
                  Shopify verbinden
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
        title="Statistik"
        subtitle={s?.lastSync ? `Daten aus Shopify · Stand ${relative(s.lastSync, now)}` : 'Daten aus Shopify'}
        actions={
          <>
            {meta?.clubConfigured && (
              <Button size="sm" variant="soft" icon={<Crown className="h-3.5 w-3.5" />} onClick={() => navigate('/club')}>
                Members Club
              </Button>
            )}
            <IconButton label="Aktualisieren" onClick={() => load(days)}>
              <RefreshCw className={cx('h-[18px] w-[18px]', loading[days] && 'animate-spin')} />
            </IconButton>
          </>
        }
      />

      {/* Zeitraum – eine Zeile über allem, gilt für alle Zahlen darunter */}
      <div className="mb-6">
        <Segmented
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={RANGES.map((r) => ({ value: String(r), label: `${r} Tage` }))}
        />
      </div>

      {!s ? (
        <div className="flex justify-center py-20">{error ? <p className="text-bad">{error}</p> : <Spinner />}</div>
      ) : (
        <div className={cx('space-y-5 transition-opacity', loading[days] && 'opacity-60')}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_2fr]">
            <div className="card flex flex-col justify-between p-5">
              <div>
                <span className="text-[13px] font-medium text-ink-2">Umsatz · letzte {days} Tage</span>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="tnum text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[48px]">{euro(s.current.revenue)}</span>
                  <Trend cur={s.current.revenue} prev={s.previous.revenue} size="lg" />
                </div>
                <div className="mt-2 text-[13px] text-ink-3">gegenüber den {days} Tagen davor</div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div>
                  <div className="text-[13px] text-ink-2">Heute</div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="tnum text-[18px] font-semibold text-ink">{euro(s.today.revenue)}</span>
                    {s.yesterdaySameTime && <Trend cur={s.today.revenue} prev={s.yesterdaySameTime.revenue} size="sm" against={`zu gestern bis ${time(now)}`} />}
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {s.today.orders} Bestellung{s.today.orders === 1 ? '' : 'en'}
                    {s.yesterdaySameTime ? ` · gestern bis ${time(now)}: ${euro(s.yesterdaySameTime.revenue)}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-[13px] text-ink-2">Vorzeitraum</div>
                  <div className="text-[18px] font-semibold text-ink-2">{euro(s.previous.revenue)}</div>
                  <div className="text-[12px] text-ink-3">{int(s.previous.orders)} Bestellungen</div>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Umsatz pro Tag</h2>
                <Button size="sm" variant="ghost" icon={table ? <ChartLine className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />} onClick={() => setTable(!table)}>
                  {table ? 'Diagramm' : 'Tabelle'}
                </Button>
              </div>
              {table ? (
                <div className="max-h-[240px] overflow-y-auto">
                  <table className="w-full text-[14px]">
                    <thead className="sticky top-0 bg-surface text-left text-[12px] text-ink-3">
                      <tr>
                        <th className="py-1.5 font-medium">Tag</th>
                        <th className="py-1.5 text-right font-medium">Bestellungen</th>
                        <th className="py-1.5 text-right font-medium">Umsatz</th>
                      </tr>
                    </thead>
                    <tbody className="tnum">
                      {[...s.series].reverse().map((d) => (
                        <tr key={d.date} className="border-t border-line/60">
                          <td className="py-1.5 text-ink-2">{new Date(d.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                          <td className="py-1.5 text-right text-ink-2">{d.orders}</td>
                          <td className="py-1.5 text-right font-medium text-ink">{euro(d.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <AreaChart
                  data={s.series.map((d) => ({ date: d.date, value: d.revenue, extra: `${d.orders} Bestellung${d.orders === 1 ? '' : 'en'}` }))}
                  height={240}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label="Bestellungen"
              value={int(s.current.orders)}
              trend={<Trend cur={s.current.orders} prev={s.previous.orders} />}
              sub={`vorher ${int(s.previous.orders)}`}
            />
            <StatTile
              label="Ø Warenkorb"
              value={euro(s.current.aov)}
              trend={<Trend cur={s.current.aov} prev={s.previous.aov} />}
              sub={`vorher ${euro(s.previous.aov)}`}
            />
            <StatTile
              label="Verkaufte Artikel"
              value={int(s.current.items)}
              trend={<Trend cur={s.current.items} prev={s.previous.items} />}
              sub={`vorher ${int(s.previous.items)}`}
            />
            <StatTile
              label="Artikel pro Bestellung"
              value={perOrder(s.current).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              trend={<Trend cur={perOrder(s.current)} prev={perOrder(s.previous)} />}
              sub={`vorher ${perOrder(s.previous).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`}
            />
            <StatTile
              label="Bester Tag"
              icon={<Trophy className="h-4 w-4" />}
              value={best ? euro(best.revenue) : '–'}
              sub={best ? `${new Date(best.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} · ${best.orders} Bestellung${best.orders === 1 ? '' : 'en'}` : 'Noch keine Verkäufe'}
            />
            <StatTile
              label="Stornos"
              icon={<Ban className="h-4 w-4" />}
              value={int(s.current.cancelled ?? 0)}
              trend={s.previous.cancelled !== undefined && <Trend cur={s.current.cancelled ?? 0} prev={s.previous.cancelled} invert absolute />}
              sub={rate(s.current.cancelled ?? 0, s.current.orders)}
            />
            <StatTile
              label="Erstattungen"
              icon={<Undo2 className="h-4 w-4" />}
              value={int(s.current.refunded ?? 0)}
              trend={s.previous.refunded !== undefined && <Trend cur={s.current.refunded ?? 0} prev={s.previous.refunded} invert absolute />}
              sub={rate(s.current.refunded ?? 0, s.current.orders)}
            />
            <StatTile
              label="Zu versenden"
              icon={<Truck className="h-4 w-4" />}
              value={int(s.toShip.count)}
              sub={s.toShip.oldest ? `Älteste seit ${relative(s.toShip.oldest, now)}` : 'Alles versendet'}
            />
          </div>
          <p className="-mt-1 text-[12px] text-ink-3">
            Prozent = Veränderung zu den {days} Tagen davor ·{' '}
            <span className="font-semibold text-good">
              <ArrowUpRight className="inline h-3.5 w-3.5" /> grün = besser
            </span>{' '}
            ·{' '}
            <span className="font-semibold text-bad">
              <ArrowDownRight className="inline h-3.5 w-3.5" /> rot = schlechter
            </span>
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="section-title mb-4">Top-Düfte nach Umsatz</h2>
              {s.topProducts.length ? (
                <BarList
                  items={s.topProducts.map((p) => ({
                    label: p.title,
                    value: p.revenue,
                    display: euro(p.revenue),
                    sub: `${int(p.qty)} Stück`,
                    trend: p.prevRevenue !== undefined ? <Trend cur={p.revenue} prev={p.prevRevenue} size="sm" /> : undefined,
                  }))}
                />
              ) : (
                <p className="text-[14px] text-ink-3">Noch keine Verkäufe in diesem Zeitraum.</p>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Knapper Bestand</h2>
                {s.lowStock.threshold !== undefined && <span className="text-[12px] text-ink-3">≤ {s.lowStock.threshold} Stück</span>}
              </div>
              {s.lowStock.items.length ? (
                <ul className="divide-y divide-line/70">
                  {s.lowStock.items.map((it) => (
                    <li key={it.variant + it.sku} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium text-ink">{it.title}</div>
                        {it.variant !== it.title && <div className="truncate text-[12px] text-ink-3">{it.variant.replace(`${it.title} - `, '')}</div>}
                      </div>
                      {it.qty <= 0 ? (
                        <Chip tone="bad" icon={<CircleAlert className="h-3 w-3" />}>
                          Ausverkauft
                        </Chip>
                      ) : (
                        <Chip tone="warn" icon={<TriangleAlert className="h-3 w-3" />}>
                          {it.qty} übrig
                        </Chip>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-[14px] text-ink-2">
                  <PackageCheck className="h-4 w-4 text-good" /> Alle Düfte ausreichend auf Lager.
                </p>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="section-title mb-3">Letzte Bestellungen</h2>
            {s.recent.length ? (
              <ul className="divide-y divide-line/70">
                {s.recent.map((o) => {
                  const f = o.cancelled ? { label: 'Storniert', tone: 'bad' as const } : FULFILLMENT[o.fulfillment ?? ''] ?? { label: o.fulfillment ?? '–', tone: 'neutral' as const };
                  return (
                    <li key={o.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium text-ink">{o.name}</div>
                        <div className="text-[12px] text-ink-3">
                          {dateTime(o.created_at)} · {o.items} Artikel
                        </div>
                      </div>
                      <Chip tone={f.tone}>{f.label}</Chip>
                      <div className="tnum w-[88px] text-right text-[14px] font-semibold text-ink">{euro(o.total)}</div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[14px] text-ink-3">Noch keine Bestellungen synchronisiert.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
