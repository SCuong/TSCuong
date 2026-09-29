import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PositionOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A grid of positions on a page (top-left … bottom-right) with radio-group semantics: one tab
 * stop, arrow keys move the selection in two dimensions, Home/End jump to the first/last.
 */
export function PositionGrid<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 3,
  disabled,
  className,
  cellClassName,
  indicator,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: PositionOption<T>[];
  columns?: number;
  disabled?: boolean;
  className?: string;
  /** Extra classes per cell (e.g. to align the indicator with the position). */
  cellClassName?: (value: T) => string;
  indicator: (selected: boolean) => ReactNode;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  function onKeyDown(event: KeyboardEvent) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    let next: number;
    if (event.key in step) {
      next = index + step[event.key];
      // Left/right stay on the same row; up/down stay in the grid.
      const sameRow = Math.floor(next / columns) === Math.floor(index / columns);
      if (next < 0 || next >= options.length || ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !sameRow)) next = index;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    if (next !== index) onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKeyDown}
      className={cn('grid gap-1.5', disabled && 'opacity-40', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.label}
            tabIndex={i === index ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center rounded-lg border transition-colors disabled:cursor-not-allowed',
              selected ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-sunken hover:bg-surface-hover',
              cellClassName?.(o.value),
            )}
          >
            {indicator(selected)}
          </button>
        );
      })}
    </div>
  );
}
