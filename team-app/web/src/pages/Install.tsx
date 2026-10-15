import { useMemo, useState, type ReactNode } from 'react';
import { encode } from 'uqr';
import { CircleCheck, Copy, Ellipsis, Laptop, MonitorDown, Share, Share2, Smartphone, SquarePlus, Download } from 'lucide-react';
import { Button, Logo, Toasts } from '../components/ui';
import { installUrl, iosSafari, isEdge, platform, useInstall, type Platform } from '../lib/install';
import { toast } from '../lib/toast';

/** Öffentliche Seite /app: Schritt für Schritt als App installieren – auf iPhone, Android und Computer. */
export default function Install() {
  const p = platform();
  const url = installUrl();
  const host = url.replace(/^https?:\/\//, '');

  return (
    <div className="safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-[560px] space-y-5 px-4 pb-12 pt-10 sm:pt-14">
        <header className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 h-16 w-16" />
          <p className="eyebrow">Perfume Cloud Team</p>
          <h1 className="page-title mt-2">Als App installieren</h1>
          <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-ink-2">
            Eigenes Icon, eigenes Fenster und Benachrichtigungen – direkt von eurem Server, ohne App Store. Neue Versionen kommen von selbst.
          </p>
        </header>

        <ThisDevice platform={p} url={url} />

        {(p === 'desktop' || p === 'mac-safari' || p === 'firefox' || p === 'other') && (
          <Card icon={<Smartphone className="h-5 w-5" />} title="Aufs iPhone holen">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <Qr value={url} className="h-40 w-40 shrink-0 rounded-xl border border-line" />
              <div className="space-y-2 text-[15px] leading-relaxed text-ink-2">
                <p>Mit der Kamera des iPhones scannen. Die Seite öffnet sich in Safari und zeigt dort die Schritte.</p>
                <p className="text-[13px] text-ink-3">Kurz gesagt: Teilen → Zum Home-Bildschirm → Hinzufügen.</p>
              </div>
            </div>
          </Card>
        )}

        {(p === 'ios' || p === 'android') && (
          <Card icon={<Laptop className="h-5 w-5" />} title="Auf dem Computer">
            <p className="text-[15px] leading-relaxed text-ink-2">
              Am Computer <b className="font-semibold text-ink">{host}</b> in <b className="font-semibold text-ink">Edge</b> oder{' '}
              <b className="font-semibold text-ink">Chrome</b> öffnen und auf <b className="font-semibold text-ink">App installieren</b> klicken. Auf dem Mac
              geht auch Safari: Ablage → Zum Dock hinzufügen.
            </p>
          </Card>
        )}

        <Card icon={<Share2 className="h-5 w-5" />} title="Link fürs Team">
          <p className="mb-3 text-[14px] text-ink-2">Diesen Link auf dem Gerät öffnen, auf dem die App landen soll.</p>
          <LinkRow url={url} />
        </Card>

        <p className="pt-2 text-center text-[13px] text-ink-3">
          <a href="/" className="underline decoration-line underline-offset-4 hover:text-ink">
            Ohne Installation im Browser weiter
          </a>
        </p>
      </div>
      <Toasts />
    </div>
  );
}

function ThisDevice({ platform: p, url }: { platform: Platform; url: string }) {
  const install = useInstall();
  const [accepted, setAccepted] = useState(false);
  const done = accepted || install.installed;
  const ipad = /ipad/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent);

  if (p === 'installed') {
    return (
      <Card icon={<CircleCheck className="h-5 w-5 text-good" />} title="Du nutzt bereits die App">
        <p className="mb-4 text-[15px] text-ink-2">Benachrichtigungen schaltest du in der App unter Einstellungen ein.</p>
        <Button onClick={() => window.location.assign('/')}>Zur App</Button>
      </Card>
    );
  }

  if (p === 'ios') {
    return (
      <Card icon={<Smartphone className="h-5 w-5" />} title={ipad ? 'Auf diesem iPad' : 'Auf diesem iPhone'} primary>
        {!iosSafari() && (
          <div className="mb-4 space-y-3 rounded-xl bg-warn/10 px-4 py-3 text-[14px] text-warn">
            <p>
              Öffne diese Seite in <b className="font-semibold">Safari</b> – dort klappt es am einfachsten: Link kopieren, Safari öffnen, oben einfügen.
            </p>
            <CopyButton url={url} />
          </div>
        )}
        <Steps>
          <Step n={1}>
            Unten in Safari auf <Share className="mx-0.5 inline h-[17px] w-[17px] align-[-3px] text-accent" /> <Key>Teilen</Key> tippen. Siehst du das
            Symbol nicht, zuerst auf <Ellipsis className="mx-0.5 inline h-[17px] w-[17px] align-[-4px] text-accent" /> tippen.
          </Step>
          <Step n={2}>
            <Key>Zum Home-Bildschirm</Key> <SquarePlus className="mx-0.5 inline h-[17px] w-[17px] align-[-3px] text-accent" /> wählen – eventuell etwas
            nach unten wischen.
          </Step>
          <Step n={3}>
            <Key>Als Web-App öffnen</Key> eingeschaltet lassen (falls angezeigt) und auf <Key>Hinzufügen</Key> tippen.
          </Step>
          <Step n={4}>
            Die App über das neue Icon <Key>PC Team</Key> öffnen und anmelden.
          </Step>
          <Step n={5}>
            In der App <Key>Einstellungen → Benachrichtigungen → Aktivieren</Key> tippen.
          </Step>
        </Steps>
      </Card>
    );
  }

  if (p === 'android') {
    return (
      <Card icon={<Smartphone className="h-5 w-5" />} title="Auf diesem Handy" primary>
        {done ? (
          <Installed text="Die App liegt jetzt auf dem Startbildschirm. Öffne sie dort, melde dich an und aktiviere unter Einstellungen die Benachrichtigungen." />
        ) : install.canPrompt ? (
          <InstallButton onClick={async () => setAccepted(await install.prompt())} />
        ) : (
          <Steps>
            <Step n={1}>
              In Chrome oben rechts auf <Key>⋮</Key> tippen.
            </Step>
            <Step n={2}>
              <Key>App installieren</Key> bzw. <Key>Zum Startbildschirm hinzufügen</Key> wählen.
            </Step>
            <Step n={3}>
              Die App über das neue Icon öffnen, anmelden und unter <Key>Einstellungen → Benachrichtigungen</Key> aktivieren.
            </Step>
          </Steps>
        )}
      </Card>
    );
  }

  if (p === 'desktop') {
    return (
      <Card icon={<Laptop className="h-5 w-5" />} title="Auf diesem Computer" primary>
        {done ? (
          <Installed text="„Perfume Cloud Team“ öffnet sich jetzt in einem eigenen Fenster. Du findest die App im Startmenü (Windows) bzw. im Launchpad (Mac) und kannst sie an die Taskleiste oder ins Dock heften. In der App unter Einstellungen → Benachrichtigungen auf „Aktivieren“ klicken." />
        ) : install.canPrompt ? (
          <>
            <InstallButton onClick={async () => setAccepted(await install.prompt())} />
            <p className="mt-3 text-[13px] text-ink-3">Ein Klick – danach startet die App in einem eigenen Fenster, mit Icon im Startmenü bzw. Dock.</p>
          </>
        ) : (
          <Steps>
            <Step n={1}>
              Oben in der Adressleiste rechts auf <MonitorDown className="mx-0.5 inline h-[17px] w-[17px] align-[-3px] text-accent" />{' '}
              <Key>App installieren</Key> klicken.
            </Step>
            <Step n={2}>
              Kein Symbol zu sehen? Über das Menü:{' '}
              {isEdge() ? (
                <Key>⋯ → Apps → Diese Website als App installieren</Key>
              ) : (
                <Key>⋮ → Streamen, speichern und teilen → Seite als App installieren</Key>
              )}
              .
            </Step>
            <Step n={3}>
              Steht dort <Key>In App öffnen</Key>, ist die App schon installiert – dann einfach darüber öffnen.
            </Step>
          </Steps>
        )}
        <p className="mt-4 border-t border-line/70 pt-3 text-[13px] text-ink-3">
          Benachrichtigungen kommen auch bei geschlossenem App-Fenster, solange der Computer läuft.
        </p>
      </Card>
    );
  }

  if (p === 'mac-safari') {
    return (
      <Card icon={<Laptop className="h-5 w-5" />} title="Auf diesem Mac" primary>
        <Steps>
          <Step n={1}>
            In der Menüleiste <Key>Ablage → Zum Dock hinzufügen …</Key> wählen.
          </Step>
          <Step n={2}>
            <Key>Hinzufügen</Key> klicken.
          </Step>
          <Step n={3}>
            Die App im Dock öffnen, anmelden und unter <Key>Einstellungen → Benachrichtigungen</Key> aktivieren.
          </Step>
        </Steps>
        <p className="mt-4 text-[13px] text-ink-3">Braucht macOS 14 (Sonoma) oder neuer – sonst Chrome oder Edge nehmen.</p>
      </Card>
    );
  }

  return (
    <Card icon={<Laptop className="h-5 w-5" />} title="Auf diesem Gerät" primary>
      <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
        {p === 'firefox' ? 'Firefox' : 'Dieser Browser'} kann Webseiten nicht als App installieren. Öffne den Link in <Key>Edge</Key> oder{' '}
        <Key>Chrome</Key> (Windows, Mac) oder in <Key>Safari</Key> (Mac, iPhone).
      </p>
      <CopyButton url={url} />
    </Card>
  );
}

function Card({ icon, title, children, primary }: { icon: ReactNode; title: string; children: ReactNode; primary?: boolean }) {
  return (
    <section className={primary ? 'card border-accent/25 p-5 sm:p-6' : 'card p-5 sm:p-6'}>
      <div className="mb-4 flex items-center gap-2.5 text-accent">
        {icon}
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-3.5">{children}</ol>;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{n}</span>
      <span className="pt-px text-[15px] leading-relaxed text-ink-2">{children}</span>
    </li>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-ink">{children}</b>;
}

function InstallButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="lg" icon={<Download className="h-[18px] w-[18px]" />} className="w-full sm:w-auto" onClick={onClick}>
      App installieren
    </Button>
  );
}

function Installed({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-good/10 px-4 py-3 text-[14px] leading-relaxed text-good">
      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <b className="font-semibold">Installiert!</b> {text}
      </span>
    </div>
  );
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopiert', 'success');
  } catch {
    toast('Kopieren ging nicht – bitte den Link markieren und kopieren.', 'error');
  }
}

function CopyButton({ url }: { url: string }) {
  return (
    <Button variant="secondary" size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copy(url)}>
      Link kopieren
    </Button>
  );
}

function LinkRow({ url }: { url: string }) {
  const canShare = typeof navigator.share === 'function' && navigator.maxTouchPoints > 0;
  return (
    <div className="flex items-center gap-2">
      <input className="field min-w-0 flex-1 font-mono text-[13px]" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link zur App" />
      <Button variant="secondary" className="shrink-0 px-3 sm:px-4" aria-label="Kopieren" icon={<Copy className="h-4 w-4" />} onClick={() => void copy(url)}>
        <span className="hidden sm:inline">Kopieren</span>
      </Button>
      {canShare && (
        <Button
          variant="secondary"
          className="shrink-0 px-3"
          aria-label="Teilen"
          icon={<Share className="h-4 w-4" />}
          onClick={() => void navigator.share({ title: 'Perfume Cloud Team', url }).catch(() => undefined)}
        />
      )}
    </div>
  );
}

/** QR-Code als SVG (immer schwarz auf weiß, damit jede Kamera ihn liest). */
function Qr({ value, className }: { value: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label={`QR-Code: ${value}`}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
