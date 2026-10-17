import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BellRing, Check, CircleAlert, Info, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Button, Chip, cx } from '../components/ui';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { toast } from '../lib/toast';

export interface ClubAccount {
  email: string;
  team: boolean;
  member: { id: string; name: string; joined: boolean } | null;
  devices: number;
  admin: boolean;
  reasons: string[];
}

export interface PushCheckData {
  team: {
    devices: number;
    orders_push: boolean;
    shopify: boolean;
    read_orders: boolean;
    last_sync: number | null;
    cron_last_run: number | null;
    quiet_now: boolean;
    quiet: { start: number; end: number };
    order_push: { name: string; sent: number; at: number } | null;
  };
  club: { error?: string; version?: string; team_mode?: boolean; team_users?: boolean; admin_by_email?: boolean; accounts?: ClubAccount[] };
}

interface TestResult {
  devices: number;
  results: { device: string; ok: boolean; status: number; reason: string }[];
  email?: string;
}

/** Erstes eigenes Club-Konto mit Gerät – dorthin gehen die Pushs, solange nichts gewählt ist. */
export function defaultDevice(d: PushCheckData | null): string | null {
  const accounts = (d?.club.accounts ?? []).filter((a) => a.member?.joined);
  return (accounts.find((a) => a.devices > 0) ?? accounts[0])?.member?.id ?? null;
}

function testSummary(r: TestResult): string {
  if (r.devices === 0) return 'Kein Gerät angemeldet – es wurde nichts verschickt.';
  const ok = r.results.filter((x) => x.ok).length;
  const failed = r.results.filter((x) => !x.ok);
  return `An ${ok} von ${r.devices} Gerät${r.devices === 1 ? '' : 'en'} verschickt${failed.length ? ` · Fehler: ${failed.map((f) => `${f.device} ${f.reason || f.status}`).join(', ')}` : ''}.`;
}

function Row({ state, title, children }: { state: 'ok' | 'warn' | 'info'; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cx(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          state === 'ok' ? 'bg-good/15 text-good' : state === 'warn' ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-ink-3',
        )}
      >
        {state === 'ok' ? <Check className="h-3.5 w-3.5" /> : state === 'warn' ? <CircleAlert className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1 text-[14px]">
        <div className="text-ink">{title}</div>
        {children && <div className="mt-0.5 text-[13px] text-ink-3">{children}</div>}
      </div>
    </li>
  );
}

/**
 * Push-Check der Testbestellung: kommt „Neue Bestellung“ aus der Team-App an, und an welches Club-Konto gehen die
 * Club-Pushs? Eigene weitere Adressen (z. B. die private) lassen sich hier als Admin-E-Mail im Club eintragen.
 */
export function PushCheck({
  data,
  onData,
  selected,
  onSelect,
  onReload,
  reloading,
}: {
  data: PushCheckData;
  onData: (d: PushCheckData) => void;
  selected: string | null;
  onSelect: (memberId: string) => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const t = data.team;
  const accounts = data.club.accounts ?? [];
  const syncAge = t.last_sync ? Date.now() - t.last_sync : null;

  const test = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      toast(testSummary(await api<TestResult>('POST', '/club/trial/test-push', body)));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeEmail = async (path: string, value: string, done: string) => {
    setBusy(path + value);
    try {
      onData(await api<PushCheckData>('POST', path, { email: value }));
      toast(done);
      setEmail('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) void changeEmail('/club/access/emails', email.trim(), 'Adresse als Admin-E-Mail eingetragen');
  };

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <BellRing className="h-4 w-4 text-accent" /> Push-Check
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={reloading} onClick={onReload}>
          Neu prüfen
        </Button>
      </div>

      <section>
        <div className="label">Team-App: „Neue Bestellung“</div>
        <ul className="divide-y divide-line">
          <Row
            state={t.devices > 0 ? 'ok' : 'warn'}
            title={t.devices > 0 ? `Auf ${t.devices} Gerät${t.devices === 1 ? '' : 'en'} für Push angemeldet` : 'Kein Gerät für Push angemeldet'}
          >
            {t.devices === 0 && (
              <>
                Unter{' '}
                <Link to="/einstellungen" className="text-accent underline-offset-2 hover:underline">
                  Einstellungen
                </Link>{' '}
                Push einschalten. Auf dem iPhone die Team-App dafür vom Home-Bildschirm öffnen.
              </>
            )}
          </Row>
          <Row
            state={t.orders_push ? 'ok' : 'warn'}
            title={t.orders_push ? 'Push bei neuen Bestellungen ist an' : 'Push bei neuen Bestellungen ist in deinen Einstellungen aus'}
          />
          <Row
            state={t.read_orders ? 'ok' : 'warn'}
            title={
              t.read_orders
                ? 'Team-App darf Bestellungen in Shopify lesen'
                : t.shopify
                  ? 'Shopify-Berechtigung read_orders fehlt'
                  : 'Shopify ist nicht verbunden'
            }
          >
            {!t.read_orders && (
              <>
                Ohne sie sieht die Team-App keine Bestellungen und schickt keinen Push.{' '}
                <Link to="/hilfe/shopify-rechte" className="text-accent underline-offset-2 hover:underline">
                  Berechtigungen bestätigen
                </Link>
              </>
            )}
          </Row>
          <Row
            state={syncAge !== null && syncAge < 30 * 60000 ? 'ok' : 'warn'}
            title={t.last_sync ? `Bestellungen zuletzt abgeglichen ${relative(t.last_sync)}` : 'Bestellungen wurden noch nie abgeglichen'}
          >
            {(syncAge === null || syncAge >= 30 * 60000) &&
              (t.cron_last_run
                ? `Der Cronjob hat sich ${relative(t.cron_last_run)} gemeldet.`
                : 'Der Cronjob hat sich noch nie gemeldet (Anleitung, Schritt „Cronjob“).')}{' '}
            „Jetzt abgleichen“ bei der Testbestellung holt Bestellungen sofort.
          </Row>
          <Row state="info" title={t.quiet_now ? `Gerade Ruhezeit (${t.quiet.start}–${t.quiet.end} Uhr)` : `Ruhezeit ${t.quiet.start}–${t.quiet.end} Uhr`}>
            Normale Bestell-Pushs warten in der Ruhezeit. Die Testbestellung kommt trotzdem sofort.
          </Row>
          {t.order_push && (
            <Row state={t.order_push.sent > 0 ? 'ok' : 'warn'} title={`„Neue Bestellung ${t.order_push.name}“ ${relative(t.order_push.at)}`}>
              {t.order_push.sent > 0 ? `An ${t.order_push.sent} Gerät${t.order_push.sent === 1 ? '' : 'e'} im Team verschickt.` : 'An kein Gerät verschickt.'}
            </Row>
          )}
        </ul>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          icon={<Send className="h-3.5 w-3.5" />}
          loading={busy === 'team'}
          disabled={t.devices === 0}
          onClick={() => void test('team', { channel: 'team' })}
        >
          Testpush an die Team-App
        </Button>
      </section>

      <section>
        <div className="label">Club: Pushs zur Testbestellung</div>
        {data.club.error ? (
          <p className="mt-2 flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{data.club.error}</span>
          </p>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-ink-3">
              Club {data.club.version} · {data.club.team_users ? 'gemeinsame Datenbank mit der Team-App' : 'eigene Datenbank, Team-Konten sind dort unbekannt'}.
              Die Pushs gehen an das gewählte Club-Konto.
            </p>
            <ul className="mt-2 space-y-2">
              {accounts.map((a) => {
                const id = a.member?.joined ? a.member.id : null;
                return (
                  <li key={a.email} className={cx('rounded-xl border p-3', id && id === selected ? 'border-accent bg-accent-soft' : 'border-line')}>
                    <div className="flex flex-wrap items-start gap-3">
                      <label className={cx('flex min-w-0 flex-1 items-start gap-2.5', id ? 'cursor-pointer' : 'opacity-80')}>
                        <input
                          type="radio"
                          name="push-target"
                          className="mt-1 accent-[rgb(var(--accent))]"
                          disabled={!id}
                          checked={!!id && id === selected}
                          onChange={() => id && onSelect(id)}
                        />
                        <span className="min-w-0">
                          <span className="block break-all font-medium text-ink">{a.email}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                            <Chip>{a.team ? 'Team-Adresse' : 'Admin-E-Mail'}</Chip>
                            {a.member ? (
                              a.member.joined ? (
                                <Chip tone={a.devices > 0 ? 'good' : 'warn'}>
                                  {a.devices > 0 ? `Club-Konto · ${a.devices} Gerät${a.devices === 1 ? '' : 'e'}` : 'Club-Konto ohne Gerät'}
                                </Chip>
                              ) : (
                                <Chip tone="warn">Angemeldet, noch nicht beigetreten</Chip>
                              )
                            ) : (
                              <Chip tone="warn">Kein Club-Konto</Chip>
                            )}
                            <Chip tone={a.admin ? 'good' : 'warn'}>{a.admin ? 'Admin erkannt' : 'Nicht als Admin erkannt'}</Chip>
                          </span>
                          {!a.admin && a.reasons.length > 0 && <span className="mt-1 block text-[12px] text-ink-3">{a.reasons.join(' ')}</span>}
                        </span>
                      </label>
                      <div className="flex shrink-0 gap-2">
                        {id && a.devices > 0 && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Send className="h-3.5 w-3.5" />}
                            loading={busy === 'club' + id}
                            onClick={() => void test('club' + id, { channel: 'club', member_id: id })}
                          >
                            Testpush
                          </Button>
                        )}
                        {!a.team && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${a.email} entfernen`}
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            loading={busy === '/club/access/emails/remove' + a.email}
                            onClick={() => void changeEmail('/club/access/emails/remove', a.email, 'Adresse entfernt')}
                          />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!accounts.some((a) => a.devices > 0) && (
              <p className="mt-2 flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Keine deiner Adressen hat ein Gerät im Club. Öffne die Club-App auf dem iPhone vom Home-Bildschirm, melde dich mit einer dieser Adressen an
                  und erlaube unter „Konto“ die Mitteilungen. Kaufst du mit einer anderen Adresse ein, trag sie unten ein.
                </span>
              </p>
            )}
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={add}>
              <label className="min-w-0 flex-1">
                <span className="label">Weitere eigene Adresse</span>
                <input
                  className="field mt-1 w-full"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="deine private Shop-Adresse"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <Button
                type="submit"
                size="md"
                icon={<Plus className="h-4 w-4" />}
                loading={busy === '/club/access/emails' + email.trim()}
                disabled={!email.trim()}
              >
                Eintragen
              </Button>
            </form>
            <p className="mt-1 text-[12px] text-ink-3">Mit dieser Adresse wirst du im Club auch als Admin erkannt (mit deinen Rechten).</p>
          </>
        )}
      </section>
    </div>
  );
}
