import type { ReactNode } from 'react';
import { CopyButton } from '@/components/ui/Actions';
import { cn } from '@/lib/utils';

/** A toggle chip (pressed/unpressed) used for multi-select lists. */
export function ToggleChip({
  pressed,
  onToggle,
  children,
  className,
  title,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onToggle}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-100',
        pressed
          ? 'border-accent-line bg-accent-soft text-accent-text'
          : 'border-line bg-surface-raised text-fg-secondary hover:border-line-strong hover:bg-surface-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Label + monospace value + copy button, wrapping long values. */
export function CopyRow({ label, value, extra }: { label: ReactNode; value: string; extra?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
      <div className="text-[13px] text-fg-muted">{label}</div>
      <code className="col-span-2 row-start-2 min-w-0 rounded-md bg-surface-sunken px-2 py-1.5 font-mono text-[12.5px] break-all text-fg sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {value}
      </code>
      <div className="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-3">
        {extra}
        <CopyButton value={value} iconOnly label={`Copy ${typeof label === 'string' ? label : 'value'}`} />
      </div>
    </div>
  );
}
