import type { ReactNode } from 'react';

/** Karte mit Überschrift für die Einstellungen. */
export function Section({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card scroll-mt-24 p-5 md:p-6" id={id}>
      <h2 className="font-display text-[23px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
