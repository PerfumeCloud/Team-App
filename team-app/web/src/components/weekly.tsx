import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { WeeklyReport } from '../lib/types';
import { toast } from '../lib/toast';
import { Sheet } from './ui';

/** Wochenrückblick genau so, wie er per Mail ankommt. */
export function WeeklyPreview({ report, onClose }: { report: WeeklyReport | null; onClose: () => void }) {
  return (
    <Sheet open={!!report} onClose={onClose} wide title={<span className="text-[17px] font-semibold text-ink">{report?.subject}</span>}>
      {report && (
        <iframe
          title="Wochenrückblick"
          srcDoc={report.html}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
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
