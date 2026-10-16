import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BellRing, Check, CircleAlert, Copy, ExternalLink, FlaskConical, LifeBuoy, Play, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import { Button, Chip, cx, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { dateTime, euro, int } from '../lib/format';
import { toast } from '../lib/toast';

type StepKey = 'ordered' | 'pending' | 'shipped' | 'delivered' | 'survey' | 'credited' | 'referral' | 'tier';

interface TrialStep {
  key: StepKey;
  label: string;
  done: boolean;
  at?: number | null;
  detail?: string | null;
  push?: { status: string; error: string | null } | null;
}

interface TrialView {
  active: boolean;
  mode?: 'sim' | 'real';
  by?: { name: string; email: string } | null;
  started_at?: number;
  amount_cents: number;
  codes?: string[];
  shop_link?: string | null;
  order?: { id: string; name: string; real: boolean } | null;
  devices?: number;
  device_member?: boolean;
  balance?: number;
  pending?: number;
  survey_link?: string | null;
  steps: TrialStep[];
  message?: string;
  cancel: { shopify: boolean; allowed: boolean };
}

interface CleanupResult extends TrialView {
  order: (TrialView['order'] & { cancelled?: boolean; note?: string; admin_url?: string | null }) | null;
}

/** Was jeder Schritt im Schnelltest auslöst – damit klar ist, worauf man achten soll. */
const HINTS: Record<StepKey, string> = {
  ordered: 'Testbestellung anlegen (noch nicht bezahlt)',
  pending: 'Zahlung bestätigt → Punkte werden vorgemerkt',
  shipped: 'Push „Dein Paket ist unterwegs“',
  delivered: 'Push „Dein Duft ist angekommen“, Befragung wird geplant',
  survey: 'Befragung sofort verschicken (Push und ggf. Mail)',
  credited: 'Wartezeit überspringen → Punkte gutschreiben',
  referral: 'Freundin bestellt über den Empfehlungslink',
  tier: 'Genug Umsatz für die nächste Stufe',
};

const PUSH_LABEL: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  sent: { label: 'Push verschickt', tone: 'good' },
  queued: { label: 'Push wartet', tone: 'warn' },
  sending: { label: 'Push wird verschickt', tone: 'warn' },
  failed: { label: 'Push fehlgeschlagen', tone: 'bad' },
  no_device: { label: 'Kein Gerät', tone: 'neutral' },
};

export default function ClubTrial() {
  const me = useStore((s) => s.me);
  const [v, setV] = useState<TrialView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<'sim' | 'real'>('sim');
  const [amount, setAmount] = useState('59');
  const [result, setResult] = useState<CleanupResult['order']>(null);

  const load = useCallback(async () => {
    try {
      setV(await api<TrialView>('GET', '/club/trial'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Während der Testbestellung regelmäßig nachsehen (Push-Status, Abgleich)
  useEffect(() => {
    if (!v?.active) return;
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [v?.active, load]);

  const run = async (key: string, fn: () => Promise<TrialView>) => {
    setBusy(key);
    try {
      const r = await fn();
      setV(r);
      if (r.message) toast(r.message);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!v)
    return (
      <div className="flex justify-center py-16">
        {error ? (
          <div className="card flex max-w-lg items-start gap-3 p-5 text-[14px]">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div className="space-y-3">
              <p className="text-ink">{error}</p>
              <Link to="/hilfe/club-update" className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline">
                <LifeBuoy className="h-4 w-4" /> Schritt für Schritt: Members Club aktualisieren
              </Link>
            </div>
          </div>
        ) : (
          <Spinner />
        )}
      </div>
    );

  const start = () => {
    const cents = Math.round(Number(amount.replace(',', '.')) * 100);
    void run('start', () => api<TrialView>('POST', '/club/trial/start', { mode, amount_cents: cents }));
    setResult(null);
  };

  const cleanup = async () => {
    const real = v.order?.real;
    const text = real
      ? v.cancel.allowed
        ? 'Testkonto, Punkte, Befragung und Codes löschen und die Testbestellung in Shopify stornieren (Artikel zurück ins Lager)?'
        : 'Testkonto, Punkte, Befragung und Codes löschen? Die Testbestellung musst du danach im Shopify-Admin stornieren.'
      : 'Testkonto, Punkte, Befragung und Codes löschen?';
    if (!confirm(text)) return;
    setBusy('cleanup');
    try {
      const r = await api<CleanupResult>('POST', '/club/trial/cleanup');
      setResult(r.order);
      setV(r);
      toast('Testbestellung aufgeräumt');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const nextKey = v.steps.find((s) => !s.done)?.key;

  return (
    <div className="space-y-5">
      <div className="card flex items-start gap-3 p-5 text-[14px] text-ink-2">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="space-y-1">
          <p className="text-ink">
            <b>Testbestellung</b>: einmal den ganzen Weg einer Bestellung durch den Club gehen – von „Bestellung eingegangen“ bis zum Stufenaufstieg.
          </p>
          <p>
            Dafür gibt es ein eigenes Testkonto. Es zählt nirgends mit (Statistik, Wochenrückblick, Mitgliederliste, Newsletter). Nur Admins sehen diesen
            Bereich.
          </p>
        </div>
      </div>

      {result && (
        <div className={cx('flex items-start gap-3 rounded-2xl p-4 text-[14px]', result.cancelled ? 'bg-good/10 text-good' : 'bg-warn/10 text-warn')}>
          {result.cancelled ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <b>Bestellung {result.name}:</b> {result.note}
          </div>
          {result.admin_url && !result.cancelled && (
            <a className="shrink-0 font-medium underline" href={result.admin_url} target="_blank" rel="noreferrer">
              In Shopify öffnen
            </a>
          )}
        </div>
      )}

      {!v.active ? (
        <div className="card space-y-5 p-5">
          <div>
            <div className="label mb-2">Art</div>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'sim', label: 'Simuliert (ohne Shop)' },
                { value: 'real', label: 'Echt im Shop (0 €)' },
              ]}
            />
            <p className="mt-2 text-[13px] text-ink-3">
              {mode === 'sim'
                ? 'Alles passiert im Club – jeder Schritt per Knopfdruck, in wenigen Minuten durch. Kein Shop, keine echte Bestellung.'
                : 'Du bekommst einen Einmal-Code (100 % Rabatt + kostenloser Versand) und bestellst wirklich im Shop. Die Bestellung läuft durch Versand und Club wie jede andere; beim Aufräumen wird sie storniert.'}
            </p>
          </div>
          <label className="block">
            <span className="label">Bestellwert, der zählen soll</span>
            <div className="mt-1 flex items-center gap-2">
              <input className="field w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span className="text-ink-2">€</span>
            </div>
            <span className="mt-1 block text-[12px] text-ink-3">Für Punkte und Stufe wird so gerechnet, als hättest du diesen Betrag bezahlt.</span>
          </label>
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Push-Nachrichten kommen auf deine Geräte, wenn du mit <b>{me?.email}</b> im Club angemeldet bist und Mitteilungen erlaubt hast. Mails gehen an
              dieselbe Adresse.
            </span>
          </p>
          {mode === 'real' && !v.cancel.allowed && (
            <p className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {v.cancel.shopify
                  ? 'Zum automatischen Stornieren fehlt der Team-App die Shopify-Berechtigung write_orders. Ohne sie musst du die Testbestellung am Ende selbst im Shopify-Admin stornieren.'
                  : 'Shopify ist in der Team-App nicht verbunden. Die Testbestellung musst du am Ende selbst im Shopify-Admin stornieren.'}
              </span>
            </p>
          )}
          <Button icon={<Play className="h-4 w-4" />} loading={busy === 'start'} onClick={start}>
            Testbestellung starten
          </Button>
        </div>
      ) : (
        <>
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="accent">{v.mode === 'real' ? 'Echt im Shop' : 'Simuliert'}</Chip>
              <span className="text-[13px] text-ink-2">
                gestartet {v.started_at ? dateTime(v.started_at) : ''} {v.by?.name ? `von ${v.by.name}` : ''} · zählt wie {euro(v.amount_cents)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[13px] text-ink-2">Punkte</div>
                <div className="tnum text-[18px] font-semibold text-ink">{int(v.balance ?? 0)}</div>
                {(v.pending ?? 0) > 0 && <div className="text-[12px] text-ink-3">+{int(v.pending ?? 0)} vorgemerkt</div>}
              </div>
              <div>
                <div className="text-[13px] text-ink-2">Deine Geräte im Club</div>
                <div className="tnum text-[18px] font-semibold text-ink">{int(v.devices ?? 0)}</div>
                {!v.device_member && <div className="text-[12px] text-warn">Mit {me?.email} nicht im Club angemeldet – Push nur im Protokoll</div>}
              </div>
              {v.order && (
                <div>
                  <div className="text-[13px] text-ink-2">Bestellung</div>
                  <div className="tnum text-[18px] font-semibold text-ink">{v.order.name}</div>
                </div>
              )}
            </div>
            {v.mode === 'real' && v.codes && v.codes.length > 0 && !v.order && (
              <div className="rounded-xl bg-surface-2 p-3 text-[14px]">
                <p className="text-ink">
                  Jetzt im Shop bestellen – der Link setzt den Code <b className="font-mono">{v.codes[0]}</b> automatisch. Beim Bezahlen zusätzlich{' '}
                  <b className="font-mono">{v.codes[1]}</b> für den Versand eingeben.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {v.shop_link && (
                    <a href={v.shop_link} target="_blank" rel="noreferrer">
                      <Button size="sm" icon={<ShoppingBag className="h-3.5 w-3.5" />}>
                        Im Shop bestellen
                      </Button>
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => void navigator.clipboard?.writeText(v.codes!.join(' ')).then(() => toast('Codes kopiert'))}
                  >
                    Codes kopieren
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={busy === 'sync'}
                onClick={() => void run('sync', () => api('POST', '/club/trial/sync'))}
              >
                Jetzt abgleichen
              </Button>
              {v.survey_link && (
                <a href={v.survey_link} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                    Befragung öffnen
                  </Button>
                </a>
              )}
              <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy === 'cleanup'} onClick={() => void cleanup()}>
                Aufräumen
              </Button>
            </div>
          </div>

          <ol className="card divide-y divide-line">
            {v.steps.map((s, i) => {
              const push = s.push ? (PUSH_LABEL[s.push.status] ?? { label: s.push.status, tone: 'neutral' as const }) : null;
              const fromShop = v.mode === 'real' && (s.key === 'ordered' || s.key === 'pending' || s.key === 'shipped');
              return (
                <li key={s.key} className="flex items-start gap-3 p-4">
                  <span
                    className={cx(
                      'tnum mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                      s.done ? 'bg-good/15 text-good' : s.key === nextKey ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3',
                    )}
                  >
                    {s.done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx('font-medium', s.done ? 'text-ink' : 'text-ink-2')}>{s.label}</span>
                      {push && (
                        <Chip tone={push.tone} icon={<BellRing className="h-3 w-3" />}>
                          {push.label}
                        </Chip>
                      )}
                    </div>
                    <div className="mt-0.5 text-[13px] text-ink-3">
                      {s.detail || HINTS[s.key]}
                      {s.at ? ` · ${dateTime(s.at)}` : ''}
                    </div>
                    {s.push?.error && <div className="mt-0.5 text-[12px] text-bad">{s.push.error}</div>}
                  </div>
                  {!s.done && !fromShop && (
                    <Button
                      size="sm"
                      variant={s.key === nextKey ? 'primary' : 'secondary'}
                      loading={busy === s.key}
                      onClick={() => void run(s.key, () => api('POST', '/club/trial/step', { step: s.key }))}
                    >
                      Auslösen
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
