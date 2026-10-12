import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cx } from './ui';
import { euro, euroAxis, pctChange } from '../lib/format';

/* Diagramme nach festen Regeln: dünne Linien (2px), 10%-Fläche, Haarlinien-Raster,
   eine Achse, Fadenkreuz-Tooltip, Werte in Textfarben – nie in der Datenfarbe. */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const dateShort = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dateLong = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
const parseDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export interface SeriesPoint {
  date: string;
  value: number;
  extra?: string;
}

export function AreaChart({ data, height = 220, format = euro }: { data: SeriesPoint[]; height?: number; format?: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const ticks = useMemo(() => niceTicks(max), [max]);
  const longest = Math.max(...ticks.map((t) => euroAxis(t).length));
  const pad = { l: Math.ceil(longest * 6.4) + 14, r: 14, t: 12, b: 28 };
  const w = Math.max(width, 0);
  const innerW = Math.max(w - pad.l - pad.r, 1);
  const innerH = height - pad.t - pad.b;
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => pad.l + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / top) * innerH;

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const area = data.length ? `${line}L${x(data.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';

  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 76))));
  const xLabels = data
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => (data.length - 1 - i) % labelEvery === 0);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    const i = Math.round((px / innerW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? data.length) - 1));
    if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
  };

  const h = hover !== null ? data[hover] : null;
  const last = data.length - 1;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          className="block touch-pan-y outline-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          tabIndex={0}
          role="img"
          aria-label="Umsatz pro Tag – mit Pfeiltasten durch die Tage gehen"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-ink-3 text-[11px]">
                {euroAxis(t)}
              </text>
            </g>
          ))}
          {xLabels.map(({ i, d }) => (
            <text key={d.date} x={x(i)} y={height - 8} textAnchor={i === last ? 'end' : i === 0 ? 'start' : 'middle'} className="fill-ink-3 text-[11px]">
              {dateShort.format(parseDay(d.date))}
            </text>
          ))}
          <path d={area} fill="var(--chart-wash)" />
          <path d={line} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.length > 0 && hover === null && (
            <circle cx={x(last)} cy={y(data[last].value)} r={4} fill="var(--chart)" stroke="rgb(var(--surface))" strokeWidth={2} />
          )}
          {h && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke="rgb(var(--ink-3))" strokeWidth={1} shapeRendering="crispEdges" />
              <circle cx={x(hover)} cy={y(h.value)} r={5} fill="var(--chart)" stroke="rgb(var(--surface))" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-xl border border-line bg-surface px-3 py-2 shadow-lift"
          style={{
            left: Math.min(Math.max(x(hover) - 70, 0), Math.max(w - 150, 0)),
          }}
        >
          <div className="flex items-center gap-2">
            <span className="h-[2px] w-3 rounded-full" style={{ background: 'var(--chart)' }} />
            <span className="text-[15px] font-semibold text-ink">{format(h.value)}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-ink-2">{dateLong.format(parseDay(h.date))}</div>
          {h.extra && <div className="text-[12px] text-ink-3">{h.extra}</div>}
        </div>
      )}
    </div>
  );
}

/** Kleine Verlaufslinie ohne Achsen – für Kennzahl-Kacheln. */
export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(...values, 1);
  const n = values.length;
  const px = (i: number) => (n <= 1 ? width / 2 : 2 + (i / (n - 1)) * (width - 6));
  const py = (v: number) => 3 + (height - 6) * (1 - v / max);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('');
  return (
    <div ref={ref} style={{ height }} aria-hidden>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} className="block">
          <path d={`${d}L${px(n - 1)},${height}L${px(0)},${height}Z`} fill="var(--chart-wash)" />
          <path d={d} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={px(n - 1)} cy={py(values[n - 1])} r={3.5} fill="var(--chart)" stroke="rgb(var(--surface))" strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

/** Waagerechte Balken (eine Farbe), Wert am Balkenende. */
export function BarList({ items }: { items: { label: string; value: number; sub?: string; display: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3.5">
      {items.map((it) => (
        <li key={it.label} className="group" title={`${it.label}: ${it.display}${it.sub ? ` · ${it.sub}` : ''}`} tabIndex={0}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="truncate text-[14px] font-medium text-ink">{it.label}</span>
            {it.sub && <span className="tnum shrink-0 text-[12px] text-ink-3">{it.sub}</span>}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-2.5 flex-1">
              <div
                className="h-full rounded-r-[4px] transition-[filter] group-hover:brightness-110 group-focus:brightness-110"
                style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: 'var(--chart)' }}
              />
            </div>
            <span className="tnum w-[84px] shrink-0 text-right text-[13px] font-semibold text-ink">{it.display}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Delta({ cur, prev, suffix = 'zum Vorzeitraum' }: { cur: number; prev: number; suffix?: string }) {
  const pct = pctChange(cur, prev);
  if (pct === null) return <span className="text-[12px] text-ink-3">Kein Vergleichswert</span>;
  const up = pct >= 0;
  return (
    <span className="inline-flex items-center gap-1 text-[12px]">
      <span className={cx('inline-flex items-center gap-0.5 font-semibold', up ? 'text-good' : 'text-bad')}>
        {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {up ? '+' : '−'}
        {Math.abs(pct).toLocaleString('de-DE', { maximumFractionDigits: Math.abs(pct) < 10 ? 1 : 0 })} %
      </span>
      <span className="text-ink-3">{suffix}</span>
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  footer,
  icon,
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cx('card flex flex-col p-4 text-left transition-shadow', onClick && 'hover:shadow-lift active:scale-[0.99]', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-2">{label}</span>
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-[12.5px] text-ink-2">{sub}</div>}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </Comp>
  );
}

