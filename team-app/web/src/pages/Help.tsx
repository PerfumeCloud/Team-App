import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, ChevronDown, CircleHelp, LifeBuoy, Search, ShieldCheck, X } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { buttonClass, Chip, cx, EmptyState } from '../components/ui';
import { HELP, HELP_CATEGORIES, searchHelp, type HelpArticle, type HelpCategory } from '../lib/help';
import { useStore } from '../lib/store';

/** **fett** und `code` im Hilfetext */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <strong key={i} className="font-semibold text-ink">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith('`') ? (
          <code key={i} className="break-all rounded bg-surface-2 px-1 py-px font-mono text-[0.9em] text-ink">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Article({ a, open, onToggle, isAdmin }: { a: HelpArticle; open: boolean; onToggle: () => void; isAdmin: boolean }) {
  return (
    <article id={`hilfe-${a.id}`} className="card scroll-mt-20 overflow-hidden lg:scroll-mt-6">
      <button className="flex w-full items-start gap-3 p-4 text-left sm:p-5" onClick={onToggle} aria-expanded={open}>
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CircleHelp className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold leading-snug text-ink">{a.title}</span>
            {a.admin && (
              <Chip tone="accent" icon={<ShieldCheck className="h-3 w-3" />}>
                {isAdmin ? 'Admins' : 'macht ein Admin'}
              </Chip>
            )}
          </span>
          <span className={cx('mt-1 block text-[13.5px] leading-relaxed text-ink-2', !open && 'line-clamp-2')}>{a.intro}</span>
        </span>
        <ChevronDown className={cx('mt-1.5 h-4 w-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-line/60 px-4 pb-5 pt-4 sm:px-5">
          <section>
            <h3 className="eyebrow mb-3">Schritt für Schritt</h3>
            <ol className="space-y-3">
              {a.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">
                    {i + 1}
                  </span>
                  <span className="min-w-0 pt-0.5 text-[14.5px] leading-relaxed text-ink-2">
                    <Rich text={s} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {a.problems && a.problems.length > 0 && (
            <section>
              <h3 className="eyebrow mb-2">Wenn es nicht klappt</h3>
              <dl className="divide-y divide-line/60 rounded-xl bg-surface-2/60">
                {a.problems.map((p) => (
                  <div key={p.q} className="px-3.5 py-3">
                    <dt className="text-[14px] font-semibold text-ink">{p.q}</dt>
                    <dd className="mt-1 text-[14px] leading-relaxed text-ink-2">
                      <Rich text={p.a} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {a.open && (
            <Link to={a.open.to} className={buttonClass('secondary', 'md', 'w-full sm:w-auto')}>
              {a.open.label} öffnen <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

export default function Help() {
  const { id } = useParams();
  const isAdmin = useStore((s) => s.me?.role === 'admin');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<HelpCategory | 'alle'>('alle');
  const [open, setOpen] = useState<Set<string>>(() => new Set(id ? [id] : []));

  // Direkt-Link /hilfe/<id> (z. B. aus einer Fehlermeldung): Anleitung aufklappen und hinscrollen
  useEffect(() => {
    if (!id) return;
    setOpen((o) => new Set(o).add(id));
    const t = setTimeout(() => document.getElementById(`hilfe-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(t);
  }, [id]);

  const results = useMemo(() => (q.trim() ? searchHelp(q) : cat === 'alle' ? HELP : HELP.filter((a) => a.category === cat)), [q, cat]);
  const toggle = (aid: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(aid)) n.delete(aid);
      else n.add(aid);
      return n;
    });

  const grouped = !q.trim() && cat === 'alle';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Hilfe" subtitle="Schritt für Schritt zu jeder Funktion, zu Installation und Verbindungen. Einfach suchen oder Bereich wählen." />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          className="field pl-10 pr-10"
          placeholder="z. B. Shopify Berechtigung, Ordner, Push, Widget …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Hilfe durchsuchen"
          enterKeyHint="search"
        />
        {q && (
          <button
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2"
            onClick={() => setQ('')}
            aria-label="Suche leeren"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!q.trim() && (
        <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Bereiche">
          {[{ key: 'alle' as const, label: 'Alle' }, ...HELP_CATEGORIES].map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={cat === c.key}
              onClick={() => setCat(c.key)}
              className={cx(
                'h-8 rounded-full px-3 text-[13px] font-medium transition-colors',
                cat === c.key ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2 hover:text-ink',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {results.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy className="h-6 w-6" />}
          title="Dazu gibt es noch keine Anleitung"
          text="Andere Wörter probieren, z. B. „Mail“ statt „E-Mail-Postfach“. Oder Claude im Chat fragen."
        />
      ) : grouped ? (
        <div className="space-y-7">
          {HELP_CATEGORIES.map((c) => {
            const list = results.filter((a) => a.category === c.key);
            if (!list.length) return null;
            return (
              <section key={c.key}>
                <h2 className="eyebrow mb-2.5 px-1">{c.label}</h2>
                <div className="space-y-2.5">
                  {list.map((a) => (
                    <Article key={a.id} a={a} open={open.has(a.id)} onToggle={() => toggle(a.id)} isAdmin={isAdmin} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2.5">
          {q.trim() && <p className="px-1 text-[13px] text-ink-3">{results.length === 1 ? '1 Anleitung' : `${results.length} Anleitungen`}</p>}
          {results.map((a) => (
            <Article key={a.id} a={a} open={open.has(a.id) || (!!q.trim() && results.length === 1)} onToggle={() => toggle(a.id)} isAdmin={isAdmin} />
          ))}
        </div>
      )}

      <p className="mt-8 px-1 text-[13px] leading-relaxed text-ink-3">
        Ausführlich (mit Plesk, Shopify Dev Dashboard und Meta) steht alles in der ANLEITUNG im GitHub-Repo. Hängt etwas trotzdem: Fehlermeldung abfotografieren
        und Claude im Chat zeigen.
      </p>
    </div>
  );
}
