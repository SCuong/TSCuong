import type { ReactNode } from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-fg-muted', className)}>
      <LoaderCircle size={size} className="animate-spin" aria-hidden />
      {label ? <span className="text-[13px]">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

/** Determinate (0–1) or indeterminate (null) progress bar with optional cancel. */
export function ProgressBar({
  value,
  label,
  onCancel,
  className,
}: {
  value: number | null;
  label?: string;
  onCancel?: () => void;
  className?: string;
}) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="min-w-0 flex-1">
        {(label || pct !== null) && (
          <div className="mb-1.5 flex justify-between gap-2 text-[12.5px] text-fg-secondary">
            <span className="truncate">{label}</span>
            {pct !== null && <span className="tabular-nums">{pct}%</span>}
          </div>
        )}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          aria-label={label || 'Progress'}
          className="relative h-1.5 overflow-hidden rounded-full bg-surface-hover"
        >
          {pct === null ? (
            <div className="absolute inset-y-0 w-2/5 rounded-full bg-accent [animation:lk-indeterminate_1.1s_ease-in-out_infinite]" />
          ) : (
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
          )}
        </div>
      </div>
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-surface-raised text-fg-muted">
          <Icon size={19} aria-hidden />
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13px] text-fg-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
