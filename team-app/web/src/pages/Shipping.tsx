import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, CircleCheck, ExternalLink, FlaskConical, PackageCheck, RefreshCw, ScanLine, Settings, Truck } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Scanner } from '../components/scanner';
import { Avatar, Button, Chip, cx, EmptyState, IconButton, Sheet, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useStats } from '../lib/stats';
import { guessCarrier } from '../lib/shipping';
import type { ShipOrder, ShippingList, ShipResult } from '../lib/types';
import { euro, relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { toast } from '../lib/toast';

const OTHER = 'Andere';

export default function Shipping() {
  const [data, setData] = useState<ShippingList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shipping, setShipping] = useState<ShipOrder | null>(null);
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me);
  const loadStats = useStats((s) => s.load);
  const navigate = useNavigate();
  const now = useNow();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<ShippingList>('GET', '/shipping'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const remind = data?.settings.remind_days ?? 2;
  const orders = data?.orders ?? [];
  const oldest = orders.reduce((m, o) => Math.max(m, o.age_days), 0);

  return (
    <>
      <PageHeader
        title="Versand"
        subtitle={
          data
            ? orders.length
              ? `${orders.length} ${orders.length === 1 ? 'Bestellung wartet' : 'Bestellungen warten'} · ${oldest === 0 ? 'alle von heute' : `älteste seit ${oldest} ${oldest === 1 ? 'Tag' : 'Tagen'}`}`
              : 'Alles versendet'
            : 'Lädt …'
        }
        actions={
          <IconButton label="Neu laden" onClick={() => void load()}>
            <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
          </IconButton>
        }
      />

      {error && <Hint tone="bad">{error}</Hint>}
      {data && !data.configured && (
        <div className="card">
          <EmptyState
            icon={<Truck className="h-6 w-6" />}
            title="Shopify ist nicht verbunden"
            text="Sobald Shopify unter Einstellungen → Integrationen verbunden ist, erscheinen hier alle Bestellungen, die noch raus müssen."
            action={
              me?.role === 'admin' ? (
                <Button icon={<Settings className="h-4 w-4" />} onClick={() => navigate('/einstellungen/integrationen')}>
                  Shopify verbinden
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {data?.missing && data.missing.length > 0 && (
        <Hint>
          In Shopify fehlt noch die Berechtigung <b>{data.missing.join(', ')}</b>. Die Liste funktioniert, aber „Als versendet markieren“ klappt erst, wenn ein
          Admin sie freigibt. Ist sie im Dev Dashboard schon angehakt, muss die neue App-Version noch im Shop bestätigt werden: Einstellungen → Integrationen →
          Shopify → „In Shopify bestätigen“ (Hilfe → „Shopify-Berechtigungen“).
        </Hint>
      )}
      {data?.error && <Hint tone="bad">{data.error}</Hint>}

      {!data && !error && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {data?.configured && !data.error && orders.length === 0 && (
        <div className="card">
          <EmptyState icon={<CircleCheck className="h-6 w-6" />} title="Alles versendet" text="Keine offenen Bestellungen. Schön!" />
        </div>
      )}

      {orders.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {orders.map((o) => (
            <li key={o.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-semibold text-ink">{o.name}</span>
                    {o.test && <Chip tone="accent">Testbestellung</Chip>}
                    {!o.paid && <Chip tone="bad">{o.financial_label || 'Nicht bezahlt'}</Chip>}
                    {o.partial && <Chip tone="warn">Teilweise versendet</Chip>}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-ink-2">
                    {o.customer?.name ?? 'Ohne Namen'}
                    {o.customer?.city ? ` · ${o.customer.city}` : ''}
                    {o.customer?.country && o.customer.country !== 'DE' && o.customer.country !== 'Deutschland' ? ` (${o.customer.country})` : ''}
                  </div>
                </div>
                <Chip tone={o.age_days >= remind && remind > 0 ? 'warn' : 'neutral'}>
                  {o.age_days === 0 ? 'heute' : o.age_days === 1 ? 'seit 1 Tag' : `seit ${o.age_days} Tagen`}
                </Chip>
              </div>
              <ul className="mt-3 space-y-0.5 text-[14px] text-ink">
                {o.items.map((i, k) => (
                  <li key={k} className="truncate">
                    <span className="tnum text-ink-3">{i.qty}×</span> {i.title}
                    {i.variant && <span className="text-ink-3"> · {i.variant}</span>}
                  </li>
                ))}
              </ul>
              {(o.method || o.note) && (
                <p className="mt-2 text-[13px] text-ink-2">
                  {o.method && <span>{o.method}</span>}
                  {o.method && o.note && ' · '}
                  {o.note && <span className="italic">„{o.note}“</span>}
                </p>
              )}
              <div className="mt-auto flex items-center gap-2 pt-4">
                <Button size="sm" icon={<PackageCheck className="h-3.5 w-3.5" />} disabled={!o.can_ship} onClick={() => setShipping(o)}>
                  Versenden
                </Button>
                <span className="tnum text-[13px] text-ink-3">{euro(o.total_cents)}</span>
                <div className="flex-1" />
                <a href={o.admin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
                  Shopify <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.recent.length > 0 && (
        <section className="mt-8">
          <h2 className="section-title mb-3">Zuletzt in der App versendet</h2>
          <ul className="card divide-y divide-line/70">
            {data.recent.map((r) => (
              <li key={r.order_id + r.created_at} className="flex items-center gap-3 px-4 py-3">
                <Avatar user={r.user_id ? users[r.user_id] : null} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] text-ink">
                    <b className="font-semibold">{r.name}</b> · {r.carrier}
                  </div>
                  <div className="truncate font-mono text-[12px] text-ink-3">{r.tracking}</div>
                </div>
                <span className="shrink-0 text-[12px] text-ink-3">{relative(r.created_at, now)}</span>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" aria-label="Sendung verfolgen" className="text-ink-3 hover:text-ink">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-center text-[12px] leading-relaxed text-ink-3">
        „Versenden“ trägt die Sendungsnummer in Shopify ein und markiert die Bestellung als versendet – auf Wunsch mit Versandbestätigung an die Kundin.
        {remind > 0 ? ` Wartet eine Bestellung länger als ${remind} ${remind === 1 ? 'Tag' : 'Tage'}, kommt morgens eine Erinnerung.` : ''}
      </p>

      {data && (
        <ShipSheet
          order={shipping}
          data={data}
          onClose={() => setShipping(null)}
          onShipped={() => {
            setShipping(null);
            void load();
            void loadStats(7);
          }}
        />
      )}
    </>
  );
}

function ShipSheet({ order, data, onClose, onShipped }: { order: ShipOrder | null; data: ShippingList; onClose: () => void; onShipped: () => void }) {
  const [number, setNumber] = useState('');
  const [carrier, setCarrier] = useState(data.settings.default_carrier);
  const [manual, setManual] = useState(false);
  const [other, setOther] = useState({ name: '', url: '' });
  const [notify, setNotify] = useState(data.settings.notify);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState<'test' | 'send' | null>(null);
  const [result, setResult] = useState<ShipResult | null>(null);

  useEffect(() => {
    if (!order) return;
    setNumber('');
    setCarrier(data.settings.default_carrier);
    setManual(false);
    setOther({ name: '', url: '' });
    setNotify(data.settings.notify);
    setResult(null);
  }, [order, data.settings]);

  function changeNumber(v: string) {
    setNumber(v);
    setResult(null);
    const g = guessCarrier(v);
    if (g && !manual) setCarrier(g);
  }
  const onScan = useCallback((code: string) => {
    setScan(false);
    setNumber(code);
    setResult(null);
    const g = guessCarrier(code);
    if (g) {
      setCarrier(g);
      setManual(false);
    }
    toast(`Gescannt: ${code}`, 'success');
  }, []);

  async function run(mode: 'test' | 'send') {
    if (!order) return;
    setBusy(mode);
    try {
      const body = {
        mode,
        number,
        notify,
        carrier: carrier === OTHER ? other.name || 'Andere' : carrier,
        url: carrier === OTHER ? other.url : undefined,
      };
      const r = await api<ShipResult>('POST', `/shipping/${order.id}`, body);
      if (mode === 'test') setResult(r);
      else {
        toast(r.message, 'success');
        onShipped();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const guessed = guessCarrier(number);
  const valid = /^[A-Z0-9-]{6,40}$/i.test(number.replace(/\s+/g, ''));
  return (
    <>
      <Sheet
        open={!!order}
        onClose={onClose}
        title={
          <div>
            <div className="text-[17px] font-semibold text-ink">{order?.name} versenden</div>
            <div className="text-[13px] text-ink-3">{order?.customer?.name}</div>
          </div>
        }
      >
        {order && (
          <div className="space-y-5">
            <ul className="rounded-2xl bg-surface-2 p-3.5 text-[14px] text-ink">
              {order.items.map((i, k) => (
                <li key={k}>
                  <span className="tnum text-ink-3">{i.qty}×</span> {i.title}
                  {i.variant && <span className="text-ink-3"> · {i.variant}</span>}
                </li>
              ))}
            </ul>

            <div>
              <label className="label" htmlFor="tracking">
                Sendungsnummer
              </label>
              <div className="flex gap-2">
                <input
                  id="tracking"
                  className="field font-mono"
                  value={number}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="z. B. 00340434…"
                  onChange={(e) => changeNumber(e.target.value)}
                />
                <Button type="button" variant="secondary" className="h-auto shrink-0" icon={<ScanLine className="h-4 w-4" />} onClick={() => setScan(true)}>
                  Scannen
                </Button>
              </div>
              {number && (
                <p className="mt-1.5 text-[12px] text-ink-3">{guessed ? `Erkannt als ${guessed}` : 'Versanddienst nicht erkannt – bitte unten auswählen.'}</p>
              )}
            </div>

            <div>
              <span className="label">Versanddienst</span>
              <div className="flex flex-wrap gap-1.5">
                {[...data.carriers, OTHER].map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCarrier(c);
                      setManual(true);
                      setResult(null);
                    }}
                    className={cx(
                      'h-8 rounded-full border px-3 text-[13px] font-medium transition-colors',
                      carrier === c ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {carrier === OTHER && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="field"
                    placeholder="Name des Versanddienstes"
                    value={other.name}
                    onChange={(e) => setOther({ ...other, name: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Link zur Sendungsverfolgung (https://…)"
                    value={other.url}
                    onChange={(e) => setOther({ ...other, url: e.target.value })}
                  />
                </div>
              )}
            </div>

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-[15px] font-medium text-ink">Versandbestätigung an die Kundin</span>
                <span className="block text-[13px] text-ink-3">Shopify schickt die Mail mit Sendungslink</span>
              </span>
              <Toggle label="Versandbestätigung senden" checked={notify} onChange={setNotify} />
            </label>

            {result && (
              <div className={cx('flex gap-2 rounded-2xl p-3.5 text-[13px]', result.missing.length ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good')}>
                {result.missing.length ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <p>{result.message}</p>
                  {result.url && (
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                    >
                      Sendungslink prüfen <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<FlaskConical className="h-4 w-4" />}
                loading={busy === 'test'}
                disabled={!valid || busy !== null}
                onClick={() => run('test')}
              >
                Testlauf
              </Button>
              <Button
                className="flex-1"
                icon={<PackageCheck className="h-4 w-4" />}
                loading={busy === 'send'}
                disabled={!valid || busy !== null || data.missing.length > 0}
                onClick={() => run('send')}
              >
                Als versendet markieren
              </Button>
            </div>
            <p className="text-[12px] text-ink-3">Der Testlauf prüft Bestellung, Nummer und Link, ohne etwas in Shopify zu ändern.</p>
          </div>
        )}
      </Sheet>
      {scan && <Scanner onResult={onScan} onClose={() => setScan(false)} />}
    </>
  );
}

function Hint({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <p className={cx('mb-4 flex gap-2 rounded-2xl p-3.5 text-[13px] leading-relaxed', tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
