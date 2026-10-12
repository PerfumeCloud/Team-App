import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChartLine, CircleAlert, PackageCheck, RefreshCw, Settings, Table2, TriangleAlert, Truck } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { AreaChart, BarList, Delta, StatTile } from '../components/charts';
import { Button, Chip, cx, EmptyState, IconButton, Segmented, Spinner } from '../components/ui';
import { useStats } from '../lib/stats';
import { useStore } from '../lib/store';
import { dateTime, euro, int, relative } from '../lib/format';
import { useNow } from '../lib/hooks';

const RANGES = [7, 30, 90] as const;

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
          <IconButton label="Aktualisieren" onClick={() => load(days)}>
            <RefreshCw className={cx('h-[18px] w-[18px]', loading[days] && 'animate-spin')} />
          </IconButton>
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
                <div className="mt-2 text-[48px] font-semibold leading-none tracking-[-0.03em] text-ink">{euro(s.current.revenue)}</div>
                <div className="mt-2.5">
                  <Delta cur={s.current.revenue} prev={s.previous.revenue} />
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div>
                  <div className="text-[12.5px] text-ink-2">Heute</div>
                  <div className="text-[18px] font-semibold text-ink">{euro(s.today.revenue)}</div>
                  <div className="text-[12px] text-ink-3">
                    {s.today.orders} Bestellung{s.today.orders === 1 ? '' : 'en'}
                  </div>
                </div>
                <div>
                  <div className="text-[12.5px] text-ink-2">Vorzeitraum</div>
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
                  <table className="w-full text-[13.5px]">
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

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Bestellungen" value={int(s.current.orders)} footer={<Delta cur={s.current.orders} prev={s.previous.orders} suffix="" />} />
            <StatTile label="Ø Warenkorb" value={euro(s.current.aov)} footer={<Delta cur={s.current.aov} prev={s.previous.aov} suffix="" />} />
            <StatTile label="Verkaufte Artikel" value={int(s.current.items)} footer={<Delta cur={s.current.items} prev={s.previous.items} suffix="" />} />
            <StatTile
              label="Zu versenden"
              icon={<Truck className="h-4 w-4" />}
              value={int(s.toShip.count)}
              sub={s.toShip.oldest ? `Älteste seit ${relative(s.toShip.oldest, now)}` : 'Alles versendet'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="section-title mb-4">Top-Düfte nach Umsatz</h2>
              {s.topProducts.length ? (
                <BarList items={s.topProducts.map((p) => ({ label: p.title, value: p.revenue, display: euro(p.revenue), sub: `${int(p.qty)} Stück` }))} />
              ) : (
                <p className="text-[13.5px] text-ink-3">Noch keine Verkäufe in diesem Zeitraum.</p>
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
                <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
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
              <p className="text-[13.5px] text-ink-3">Noch keine Bestellungen synchronisiert.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
