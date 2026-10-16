import { useEffect, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import type { WeeklyReport } from '../lib/types';
import { toast } from '../lib/toast';
import { Sheet } from './ui';

/**
 * Wochenrückblick genau so, wie er per Mail ankommt. Links darin dürfen nicht im Rahmen selbst laden
 * (die App verbietet, eingebettet zu werden → „Verbindung verweigert“): Links in die App öffnen die Seite
 * in der App, alle anderen einen neuen Tab. Skripte im Rückblick bleiben gesperrt (kein allow-scripts).
 */
export function WeeklyPreview({ report, onClose }: { report: WeeklyReport | null; onClose: () => void }) {
  const navigate = useNavigate();
  const onLoad = (e: SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    doc?.addEventListener('click', (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      ev.preventDefault();
      const url = new URL(a.href, window.location.href);
      if (url.origin === window.location.origin) {
        onClose();
        navigate(url.pathname + url.search + url.hash);
      } else if (/^https?:$/.test(url.protocol)) {
        window.open(url.href, '_blank', 'noopener');
      }
    });
  };
  return (
    <Sheet open={!!report} onClose={onClose} wide title={<span className="text-[17px] font-semibold text-ink">{report?.subject}</span>}>
      {report && (
        <iframe
          title="Wochenrückblick"
          srcDoc={report.html.replace(/<html([^>]*)>/i, '<html$1><head><base target="_blank"></head>')}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          onLoad={onLoad}
          className="h-[70dvh] w-full rounded-2xl border border-line bg-white lg:h-[calc(100dvh-140px)]"
        />
      )}
    </Sheet>
  );
}

/** Lädt den aktuellen Wochenrückblick, sobald open = true. */
export function useWeekly(open: boolean) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setReport(null);
      return;
    }
    setLoading(true);
    api<WeeklyReport>('GET', '/reports/weekly')
      .then(setReport)
      .catch((e) => toast((e as Error).message, 'error'))
      .finally(() => setLoading(false));
  }, [open]);
  return { report, loading };
}
