import { forwardRef, useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, X } from 'lucide-react';
import type { User } from '../lib/types';
import { initials } from '../lib/format';
import { useToasts } from '../lib/toast';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-sm',
    secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
    soft: 'bg-accent-soft text-accent hover:brightness-[0.98]',
    ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
    danger: 'bg-bad/10 text-bad hover:bg-bad/15',
  };
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg', md: 'h-10 px-4 text-[14px] gap-2 rounded-xl', lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl' };
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50',
        styles[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:scale-95',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Avatar({ user, size = 28, ring }: { user?: User | null; size?: number; ring?: boolean }) {
  if (!user) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line text-ink-3"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        aria-label="Niemand"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className={cx(`u-${user.color}`, 'inline-flex shrink-0 items-center justify-center rounded-full font-semibold', ring && 'ring-2 ring-surface')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: 'var(--u-bg)', color: 'var(--u-fg)' }}
      title={user.name}
      aria-label={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

export function Chip({ children, tone = 'neutral', className, icon }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad'; className?: string; icon?: ReactNode }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent',
    good: 'bg-good/10 text-good',
    warn: 'bg-warn/10 text-warn',
    bad: 'bg-bad/10 text-bad',
  };
  return (
    <span className={cx('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" className={cx('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-lg font-medium transition-all',
            size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13.5px]',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-line',
      )}
    >
      <span className={cx('h-[22px] w-[22px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[20px]' : 'translate-x-[2px]')} />
    </button>
  );
}

export function AutoTextarea({ className, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} value={value} rows={1} className={cx('resize-none overflow-hidden', className)} {...rest} />;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('h-5 w-5 animate-spin text-ink-3', className)} />;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <p className="font-display text-[22px] font-semibold text-ink">{title}</p>
      {text && <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-ink-2">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="section-title">{title}</h2>
      {action}
    </div>
  );
}

/** Unten einfahrendes Blatt (Handy) bzw. Seitenpanel (Desktop). */
export function Sheet({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-stretch lg:justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(20_20_24/0.35)] backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-sheet-in flex-col overflow-hidden rounded-t-3xl bg-surface shadow-lift lg:m-3 lg:max-h-none lg:rounded-3xl',
          wide ? 'lg:w-[640px]' : 'lg:w-[560px]',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line lg:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 lg:px-6 lg:pt-5">
          <div className="min-w-0 flex-1">{title}</div>
          <IconButton label="Schließen" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        <div className="safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 lg:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+var(--safe-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto flex max-w-md animate-toast-in items-center gap-3 rounded-2xl px-4 py-3 text-[14px] shadow-lift',
            t.kind === 'error' ? 'bg-bad text-white' : 'bg-ink text-bg',
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button
              className="shrink-0 font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Logo({ className }: { className?: string }) {
  return <img src="/brand/monogram.png" alt="" className={cx('select-none dark:invert', className)} draggable={false} />;
}
