import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The standard bordered surface used for tool sections. */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  description,
  as: Tag = 'section',
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div';
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <Tag
      className={cn('flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card', className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[13px] font-semibold tracking-tight text-fg">{title}</h2>}
            {description && <p className="text-[12.5px] text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-surface-hover text-fg-secondary border-line',
    accent: 'bg-accent-soft text-accent-text border-accent-line',
    success: 'bg-success-soft text-success border-transparent',
    warning: 'bg-warning-soft text-warning border-transparent',
    danger: 'bg-danger-soft text-danger border-transparent',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-raised px-1 font-sans text-[11px] font-medium text-fg-muted shadow-[0_1px_0_var(--lk-border-strong)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Key/value rows for inspectors (metadata, headers, results). */
export function KeyValueList({
  items,
  className,
  mono = true,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; key?: string }>;
  className?: string;
  mono?: boolean;
}) {
  return (
    <dl className={cn('divide-y divide-line text-[13px]', className)}>
      {items.map((item, i) => (
        <div key={item.key ?? i} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(120px,200px)_1fr]">
          <dt className="text-fg-muted">{item.label}</dt>
          <dd className={cn('min-w-0 break-words text-fg', mono && 'font-mono text-[12.5px]')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface-sunken px-3 py-2.5', className)}>
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[17px] font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}
