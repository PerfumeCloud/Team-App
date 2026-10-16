import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, CircleCheck, Copy, ExternalLink, Hash, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { InstagramIcon } from './instagram-icon';
import { Section } from './section';
import { AutoTextarea, Button, cx, Toggle } from './ui';
import { api } from '../lib/api';
import { dateTime, relative } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import type { InstagramSettings } from '../lib/types';

const SCOPE_LABEL: Record<string, string> = {
  instagram_business_basic: 'Profil und Beiträge lesen',
  instagram_business_content_publish: 'Beiträge veröffentlichen',
  instagram_business_manage_comments: 'Kommentare lesen und beantworten',
  instagram_business_manage_insights: 'Statistiken lesen',
};

/** Admin: Instagram verbinden (Meta-App mit Instagram-Login), Vier-Augen-Prinzip, Hashtag-Set. */
export function InstagramSection({ initial }: { initial: InstagramSettings }) {
  const navigate = useNavigate();
  const sync = useStore((s) => s.sync);
  const now = useNow();
  const [ig, setIg] = useState(initial);
  const [form, setForm] = useState({ app_id: initial.app_id, app_secret: '' });
  const [token, setToken] = useState('');
  const [hashtags, setHashtags] = useState(initial.hashtags);
  const [busy, setBusy] = useState<'' | 'app' | 'token' | 'test' | 'off' | 'tags' | 'eyes'>('');
  const [showApp, setShowApp] = useState(!initial.connected);

  // Rückkehr von der Instagram-Anmeldung: ?instagram=ok:benutzername oder eine Fehlermeldung
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const msg = params.get('instagram');
    if (msg !== null) {
      if (msg.startsWith('ok:')) toast(`Instagram verbunden${msg.length > 3 ? ` mit @${msg.slice(3)}` : ''} – die Zahlen werden gerade geladen`, 'success');
      else toast(msg, 'error');
      params.delete('instagram');
      const q = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
      void sync();
    }
    if (window.location.hash === '#instagram')
      window.setTimeout(() => document.getElementById('instagram')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [sync]);

  async function call(kind: typeof busy, fn: () => Promise<{ instagram: InstagramSettings }>, ok?: string) {
    setBusy(kind);
    try {
      const r = await fn();
      setIg(r.instagram);
      setForm({ app_id: r.instagram.app_id, app_secret: '' });
      if (ok) toast(ok, 'success');
      void sync();
      return r.instagram;
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  const put = (body: Record<string, unknown>) => () => api<{ instagram: InstagramSettings }>('PUT', '/admin/instagram', body);
  const canConnect = ig.app_id !== '' && ig.hasSecret;
  const daysLeft = ig.expires ? Math.floor((ig.expires - now) / 86400000) : null;

  return (
    <Section
      id="instagram"
      title="Instagram"
      description={
        <>
          Verbindet euer Instagram-Konto (Business- oder Creator-Konto) mit der Team-App: Auswertungen, Beiträge planen und veröffentlichen, Kommentare
          beantworten. Dafür braucht ihr einmalig eine eigene, kostenlose App im <b>Meta App Dashboard</b> mit „Instagram-API mit Instagram-Login“ – Schritt für
          Schritt in der Anleitung, Teil N.
        </>
      }
    >
      {ig.connected ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl bg-good/10 p-3 text-[13px] text-good">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">Verbunden mit @{ig.username}</p>
              <p className="text-ink-2">
                {ig.connectedAt ? `seit ${dateTime(ig.connectedAt)} · ` : ''}
                {ig.expires
                  ? daysLeft !== null && daysLeft < 7
                    ? `Zugang läuft am ${dateTime(ig.expires)} ab – bitte neu verbinden`
                    : `Zugang gültig bis ${dateTime(ig.expires)}, wird automatisch verlängert`
                  : ''}
                {ig.lastSync ? ` · zuletzt abgeglichen ${relative(ig.lastSync, now)}` : ''}
              </p>
            </div>
          </div>
          {ig.missingScopes && ig.missingScopes.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Es fehlen Berechtigungen: {ig.missingScopes.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}. Bitte „Neu verbinden“ und bei Instagram alle Häkchen
                gesetzt lassen.
              </span>
            </p>
          )}
          {ig.status && (
            <p className={cx('flex items-start gap-2 text-[13px]', ig.status.ok ? 'text-ink-2' : 'text-bad')}>
              {ig.status.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {ig.status.message}
                {ig.status.at ? <span className="text-ink-3"> · {relative(ig.status.at, now)}</span> : null}
              </span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={busy === 'test'}
              onClick={() =>
                void call('test', () => api<{ instagram: InstagramSettings }>('POST', '/admin/instagram/test')).then(
                  (r) => r && toast(r.status?.message ?? 'Abgeglichen', r.status?.ok === false ? 'error' : 'success'),
                )
              }
            >
              Jetzt abgleichen
            </Button>
            <Button variant="ghost" icon={<InstagramIcon className="h-4 w-4" />} onClick={() => navigate('/instagram')}>
              Zur Instagram-Seite
            </Button>
            {canConnect && (
              <Button variant="ghost" onClick={() => (window.location.href = '/api/instagram/connect')}>
                Neu verbinden
              </Button>
            )}
            <Button
              variant="ghost"
              className="hover:text-bad"
              icon={<LogOut className="h-4 w-4" />}
              loading={busy === 'off'}
              onClick={() => {
                if (window.confirm('Instagram trennen? Geplante Beiträge bleiben als Entwürfe erhalten, Auswertungen bis heute auch.'))
                  void call('off', () => api<{ instagram: InstagramSettings }>('DELETE', '/admin/instagram'), 'Instagram getrennt');
              }}
            >
              Trennen
            </Button>
          </div>
          {!showApp && (
            <button className="text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowApp(true)}>
              App-ID und App-Secret ändern
            </button>
          )}
        </div>
      ) : (
        <ol className="mb-4 space-y-1.5 text-[14px] text-ink-2">
          <li>
            1. Im{' '}
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline"
            >
              Meta App Dashboard <ExternalLink className="h-3 w-3" />
            </a>{' '}
            eine App anlegen (Anwendungsfall „Instagram-API“ → „API-Einrichtung mit Instagram-Login“).
          </li>
          <li>2. Unter „Instagram-Login für Unternehmen einrichten“ diese Weiterleitungs-URI eintragen:</li>
        </ol>
      )}

      {(showApp || !ig.connected) && (
        <div className={cx('space-y-3', ig.connected && 'mt-5 border-t border-line pt-5')}>
          {ig.connected && <p className="text-[14px] text-ink-2">Weiterleitungs-URI (muss im Meta App Dashboard eingetragen sein):</p>}
          <div className="flex items-center gap-2">
            <input className="field min-w-0 flex-1 font-mono text-[13px]" readOnly value={ig.redirectUri} onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              className="shrink-0 px-3 sm:px-4"
              aria-label="Kopieren"
              icon={<Copy className="h-4 w-4" />}
              onClick={() => {
                void navigator.clipboard?.writeText(ig.redirectUri);
                toast('Weiterleitungs-URI kopiert', 'success');
              }}
            >
              <span className="hidden sm:inline">Kopieren</span>
            </Button>
          </div>
          {!ig.connected && (
            <p className="text-[14px] text-ink-2">3. Instagram-App-ID und Instagram-App-Secret aus derselben Seite hier eintragen und speichern:</p>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void call('app', put({ app_id: form.app_id.trim(), ...(form.app_secret.trim() ? { app_secret: form.app_secret.trim() } : {}) }), 'Gespeichert');
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="ig-app-id">
                  Instagram-App-ID
                </label>
                <input
                  id="ig-app-id"
                  className="field font-mono"
                  inputMode="numeric"
                  value={form.app_id}
                  onChange={(e) => setForm({ ...form, app_id: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label" htmlFor="ig-secret">
                  Instagram-App-Secret {ig.hasSecret && <span className="text-ink-3">(gespeichert)</span>}
                </label>
                <input
                  id="ig-secret"
                  className="field"
                  type="password"
                  value={form.app_secret}
                  onChange={(e) => setForm({ ...form, app_secret: e.target.value })}
                  placeholder={ig.hasSecret ? '•••••••• unverändert' : ''}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant={canConnect ? 'secondary' : 'primary'} loading={busy === 'app'}>
                Speichern
              </Button>
              {!ig.connected && (
                <Button
                  type="button"
                  icon={<InstagramIcon className="h-4 w-4" />}
                  disabled={!canConnect}
                  onClick={() => (window.location.href = '/api/instagram/connect')}
                >
                  Mit Instagram verbinden
                </Button>
              )}
            </div>
            {!ig.connected && (
              <p className="text-[12px] text-ink-3">
                4. „Mit Instagram verbinden“ öffnet die Anmeldung bei Instagram. Mit dem Konto anmelden, das ihr verbinden wollt, und alle Berechtigungen
                erlauben – danach geht es automatisch hierher zurück.
              </p>
            )}
          </form>

          {!ig.connected && (
            <details className="rounded-xl bg-surface-2/70 p-3 text-[13px] text-ink-2">
              <summary className="cursor-pointer font-medium text-ink">Alternative: Zugangsschlüssel direkt einfügen</summary>
              <p className="mt-2">
                Im Meta App Dashboard unter „Zugriffsschlüssel generieren“ das Konto hinzufügen und den Schlüssel erzeugen. Er gilt 60 Tage und wird automatisch
                verlängert, solange App-ID und App-Secret oben gespeichert sind.
              </p>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void call('token', put({ token: token.trim() }), 'Instagram verbunden – die Zahlen werden geladen').then((r) => r && setToken(''));
                }}
              >
                <input
                  className="field min-w-0 flex-1 font-mono"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="IG…"
                  autoComplete="off"
                />
                <Button type="submit" variant="secondary" disabled={token.trim().length < 40} loading={busy === 'token'}>
                  Verbinden
                </Button>
              </form>
            </details>
          )}
        </div>
      )}

      <div className="mt-5 space-y-4 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
              <ShieldCheck className="h-4 w-4 text-ink-3" /> Vier-Augen-Prinzip
            </p>
            <p className="text-[13px] text-ink-3">Beiträge gibt immer jemand anderes frei als die Person, die sie vorbereitet hat.</p>
          </div>
          <Toggle label="Vier-Augen-Prinzip" checked={ig.four_eyes} disabled={busy === 'eyes'} onChange={(v) => void call('eyes', put({ four_eyes: v }))} />
        </div>
        <div>
          <label className="label" htmlFor="ig-tags">
            <Hash className="mr-1 inline h-3.5 w-3.5 text-ink-3" />
            Hashtag-Set
          </label>
          <AutoTextarea
            id="ig-tags"
            className="field min-h-[44px]"
            maxLength={500}
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            onBlur={() => hashtags !== ig.hashtags && void call('tags', put({ hashtags }), 'Hashtag-Set gespeichert')}
            placeholder="#perfumecloud #parfum #duft"
          />
          <p className="mt-1 text-[12px] text-ink-3">
            Lässt sich im Planer mit einem Tipp unter den Text setzen. Wenige passende Hashtags (3–8) wirken besser als 30.
          </p>
        </div>
        <p className="text-[12px] text-ink-3">
          Der Zugang bleibt verschlüsselt auf dem Server – der Browser bekommt ihn nie zu sehen. Zugang zu Instagram in der Team-App haben Admins und alle mit
          „Instagram-Zugang“ (Einstellungen → Team).
        </p>
      </div>
    </Section>
  );
}
