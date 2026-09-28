import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  title?: string;
}

/** A compact single-choice control (radiogroup semantics, arrow-key navigation). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = options.findIndex((o) => o.value === value);

  function onKeyDown(event: KeyboardEvent) {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (Math.max(index, 0) + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface-sunken p-0.5',
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (index === -1 && i === 0) ? 0 : -1}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-100',
              size === 'sm' ? 'h-6 px-2 text-[12.5px]' : 'h-7 px-2.5 text-[13px]',
              selected
                ? 'bg-surface-raised text-fg shadow-card ring-1 ring-line-strong'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
