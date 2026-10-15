import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, Copy, Crown, ExternalLink, Package, Send, Star, StickyNote, Trash2, Truck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import type { CustomerInfo, CustomerOrder } from '../lib/types';
import { dateTime, euro, int, relative, shortDay } from '../lib/format';
import { toast } from '../lib/toast';
import { Avatar, Button, Chip, cx, IconButton, Spinner } from './ui';

// Kurz zwischenspeichern: Wer zwischen Mails hin und her springt, wartet nicht jedes Mal auf Shopify
const cache = new Map<string, { at: number; data: CustomerInfo }>();
const CACHE_MS = 2 * 60 * 1000;

export function useCustomer(email: string, order?: string | null) {
  const key = `${email.toLowerCase()}|${order ?? ''}`;
  const [data, setData] = useState<CustomerInfo | null>(() => cache.get(key)?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (force = false) => {
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < CACHE_MS) {
        setData(hit.data);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ email });
        if (order) q.set('order', order);
        const d = await api<CustomerInfo>('GET', `/customers?${q}`);
        cache.set(key, { at: Date.now(), data: d });
        setData(d);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [key, email, order],
  );
  useEffect(() => {
    setData(cache.get(key)?.data ?? null);
    if (email || order) void load();
  }, [key, load, email, order]);
  return { data, error, loading, reload: () => load(true), setData };
}

function statusTone(o: CustomerOrder): 'good' | 'accent' | 'warn' | 'bad' | 'neutral' {
  if (o.cancelled || o.delivery === 'FAILURE' || o.delivery === 'NOT_DELIVERED') return 'bad';
  if (o.delivery === 'DELIVERED' || o.delivery === 'PICKED_UP') return 'good';
  if (o.fulfillment === 'FULFILLED' || o.delivery) return 'accent';
  if (o.fulfillment === 'UNFULFILLED' || o.fulfillment === 'PARTIALLY_FULFILLED') return 'warn';
  return 'neutral';
}

function OrderCard({ o, highlight, onInsert }: { o: CustomerOrder; highlight?: boolean; onInsert?: (text: string) => void }) {
  const t = o.tracking[0];
  return (
    <div className={cx('rounded-2xl border p-3.5', highlight ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-surface')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={o.admin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[15px] font-semibold text-ink hover:underline">
            {o.name} <ExternalLink className="h-3 w-3 text-ink-3" />
          </a>
          <div className="text-[12px] text-ink-3">
            {shortDay(o.created_at)} · {euro(o.total_cents)}
            {o.city ? ` · ${o.city}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {o.test && <Chip tone="warn">Test</Chip>}
          <Chip tone={statusTone(o)}>{o.status_label}</Chip>
        </div>
      </div>
      {o.other && <p className="mt-2 text-[12px] text-warn">Bestellt mit einer anderen E-Mail-Adresse.</p>}
      <ul className="mt-2 space-y-0.5 text-[13px] text-ink-2">
        {o.items.map((it, i) => (
          <li key={i} className="truncate">
            {it.qty}× {it.title}
            {it.variant && it.variant !== 'Default Title' ? <span className="text-ink-3"> · {it.variant}</span> : null}
          </li>
        ))}
      </ul>
      {(o.financial !== 'PAID' || o.codes.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {o.financial !== 'PAID' && <Chip tone={o.financial === 'PENDING' ? 'warn' : 'neutral'}>{o.financial_label}</Chip>}
          {o.codes.map((c) => (
            <Chip key={c}>Code {c}</Chip>
          ))}
        </div>
      )}
      {t && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-surface-2 px-2.5 py-2 text-[13px]">
          <Truck className="h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ink">
              {t.company ?? 'Sendung'} {t.number}
            </div>
            <div className="text-[12px] text-ink-3">
              {o.delivered_at ? `Zugestellt ${dateTime(o.delivered_at)}` : o.shipped_at ? `Versendet ${relative(o.shipped_at)}` : ''}
            </div>
          </div>
          {t.url && (
            <>
              <IconButton
                label="Link kopieren"
                className="h-8 w-8"
                onClick={() => {
                  void navigator.clipboard?.writeText(t.url!);
                  toast('Sendungslink kopiert', 'success');
                }}
              >
                <Copy className="h-4 w-4" />
              </IconButton>
              {onInsert && (
                <IconButton label="In die Antwort einfügen" className="h-8 w-8" onClick={() => onInsert(t.url!)}>
                  <Send className="h-4 w-4" />
                </IconButton>
              )}
              <a href={t.url} target="_blank" rel="noreferrer" aria-label="Sendung verfolgen" className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-ink-2 hover:bg-surface">
                <ExternalLink className="h-4 w-4" />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Block({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} von 5 Sternen`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cx('h-3.5 w-3.5', i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-line')} />
      ))}
    </span>
  );
}

/** Alles zu einer Kundin auf einen Blick – neben der Mail, im Versand und als Test in den Einstellungen. */
export function CustomerPanel({ email, order, onInsert }: { email: string; order?: string | null; onInsert?: (text: string) => void }) {
  const { data, error, loading, reload, setData } = useCustomer(email, order);
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [allOrders, setAllOrders] = useState(false);

  if (!data) {
    return loading ? (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    ) : error ? (
      <p className="rounded-xl bg-bad/10 p-3 text-[13px] text-bad">{error}</p>
    ) : null;
  }

  const c = data.customer;
  const orders = data.orders.filter((o) => o.id !== data.mentioned?.id);
  const shown = allOrders ? orders : orders.slice(0, 3);
  const club = data.club;

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ notes: CustomerInfo['notes'] }>('POST', '/customers/notes', { email: data!.email, body: note });
      setData({ ...data!, notes: r.notes });
      setNote('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(id: string) {
    try {
      const r = await api<{ notes: CustomerInfo['notes'] }>('DELETE', `/customers/notes/${id}`);
      setData({ ...data!, notes: r.notes });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold text-ink">{c?.name || data.email || `Bestellung #${data.order}`}</div>
          {c?.name && <div className="truncate text-[13px] text-ink-3">{data.email}</div>}
          {c ? (
            <p className="mt-1 text-[13px] text-ink-2">
              Kundin seit {new Date(c.since).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })} · {c.orders} {c.orders === 1 ? 'Bestellung' : 'Bestellungen'} · {euro(c.spent_cents)}
              {c.city ? ` · ${c.city}` : ''}
            </p>
          ) : (
            data.shopify.configured &&
            !data.shopify.missing.includes('read_customers') &&
            data.email && <p className="mt-1 text-[13px] text-ink-3">Kein Kundenkonto in Shopify gefunden.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {club?.member && club.tier && (
              <Chip tone="accent" icon={<Crown className="h-3 w-3" />}>
                Club · {club.tier.name}
              </Chip>
            )}
            {c?.newsletter && <Chip tone="good">Newsletter</Chip>}
            {c?.tags.slice(0, 4).map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        </div>
        {c && (
          <a href={c.admin_url} target="_blank" rel="noreferrer" aria-label="In Shopify öffnen" title="In Shopify öffnen" className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-2 hover:bg-surface-2">
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {!data.shopify.configured && <Hint>Shopify ist nicht verbunden – Bestellungen erscheinen hier, sobald ein Admin Shopify unter Einstellungen → Integrationen einrichtet.</Hint>}
      {data.shopify.missing.length > 0 && (
        <Hint>
          In Shopify fehlt noch die Berechtigung <b>{data.shopify.missing.join(', ')}</b>
          {data.shopify.missing.includes('read_customers') ? ' – ohne sie fehlen Name, Kundenkonto und Newsletter-Status.' : '.'} Anleitung: docs/ANLEITUNG.md → „Shopify-Rechte erweitern“.
        </Hint>
      )}
      {data.shopify.error && <Hint tone="bad">{data.shopify.error}</Hint>}
      {c?.note && <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">Shopify-Notiz: {c.note}</p>}

      {data.mentioned && (
        <Block icon={<Package className="h-3.5 w-3.5" />} title={`In der Mail erwähnt`}>
          <OrderCard o={data.mentioned} highlight onInsert={onInsert} />
        </Block>
      )}
      {data.order && !data.mentioned && data.shopify.configured && !data.shopify.error && (
        <Hint>Bestellung #{data.order} aus der Mail wurde in Shopify nicht gefunden.</Hint>
      )}

      {(orders.length > 0 || (data.shopify.configured && !data.mentioned)) && (
        <Block
          icon={<Package className="h-3.5 w-3.5" />}
          title={data.mentioned ? 'Weitere Bestellungen' : 'Bestellungen'}
          action={
            loading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <button className="text-[12px] font-medium text-accent hover:underline" onClick={() => void reload()}>
                Aktualisieren
              </button>
            )
          }
        >
          {orders.length === 0 ? (
            <p className="text-[13px] text-ink-3">Keine Bestellungen mit dieser Adresse.</p>
          ) : (
            <div className="space-y-2">
              {shown.map((o) => (
                <OrderCard key={o.id} o={o} onInsert={onInsert} />
              ))}
              {orders.length > shown.length && (
                <button className="text-[13px] font-medium text-accent hover:underline" onClick={() => setAllOrders(true)}>
                  Alle {orders.length} anzeigen
                </button>
              )}
            </div>
          )}
        </Block>
      )}

      {club && (
        <Block icon={<Crown className="h-3.5 w-3.5" />} title="Members Club">
          {club.error ? (
            <p className="text-[13px] text-ink-3">{club.error}</p>
          ) : !club.member ? (
            <p className="text-[13px] text-ink-3">Kein Club-Mitglied.</p>
          ) : (
            <div className="space-y-2 rounded-2xl border border-line p-3.5 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink-2">Punkte verfügbar</span>
                <span className="tnum text-[17px] font-semibold text-ink">
                  {int(club.points?.available ?? 0)}
                  {club.points?.pending ? <span className="ml-1 text-[12px] font-normal text-ink-3">+{int(club.points.pending)} vorgemerkt</span> : null}
                </span>
              </div>
              {club.codes && club.codes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {club.codes.map((code) => (
                    <Chip key={code.code} tone={code.status === 'active' ? 'accent' : 'neutral'}>
                      {code.code} · {euro(code.value_cents)}
                    </Chip>
                  ))}
                </div>
              )}
              {club.ratings && club.ratings.count > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-2">Bewertungen ({club.ratings.count})</span>
                  <Stars value={club.ratings.avg ?? 0} />
                </div>
              )}
              {club.ratings?.last?.comment && <p className="rounded-xl bg-surface-2 p-2.5 text-ink-2">„{club.ratings.last.comment}“</p>}
              {club.referrals && club.referrals.count > 0 && (
                <p className="text-ink-2">
                  Hat {club.referrals.count} {club.referrals.count === 1 ? 'Person' : 'Personen'} geworben ({club.referrals.orders} Bestellungen).
                </p>
              )}
              {club.admin_url && (
                <a href={club.admin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                  Im Club-Admin öffnen <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </Block>
      )}

      {data.email && (
        <Block icon={<StickyNote className="h-3.5 w-3.5" />} title="Notizen des Teams">
          <div className="space-y-2">
            {data.notes.map((n) => {
              const u = n.created_by ? users[n.created_by] : null;
              return (
                <div key={n.id} className="flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 text-[13px] text-ink dark:bg-amber-500/10">
                  <Avatar user={u} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {u?.name.split(' ')[0] ?? 'Jemand'} · {relative(n.created_at)}
                    </p>
                  </div>
                  {(n.created_by === me?.id || me?.role === 'admin') && (
                    <IconButton label="Notiz löschen" className="h-7 w-7" onClick={() => void deleteNote(n.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </div>
              );
            })}
            <div className="flex gap-2">
              <input
                className="field h-10 py-0 text-[14px]"
                placeholder="z. B. mag holzige Düfte, lieber per Mail"
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addNote()}
              />
              <Button size="md" variant="secondary" loading={busy} disabled={!note.trim()} onClick={() => void addNote()}>
                Merken
              </Button>
            </div>
          </div>
        </Block>
      )}
    </div>
  );
}

function Hint({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <p className={cx('flex items-start gap-2 rounded-xl p-3 text-[13px] leading-relaxed', tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
