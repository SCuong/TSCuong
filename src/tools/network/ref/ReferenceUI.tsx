import { useId, type ReactNode } from 'react';
import { ChevronRight, Search, SearchX, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { cn, formatNumber } from '@/lib/utils';

/** Search field with an icon, a clear button and a live result count. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  count,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  count: number;
  total: number;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="lk-field h-10 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X size={15} aria-hidden />
          </button>
        )}
      </div>
      <p className="text-[12.5px] text-fg-muted" aria-live="polite">
        {count === total ? `${formatNumber(total, 0)} entries` : `${formatNumber(count, 0)} of ${formatNumber(total, 0)} entries`}
      </p>
    </div>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/** A row of toggle chips for a single-choice filter. Wraps on small screens. */
export function FilterChips<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ChipOption<T>[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
              active
                ? 'border-accent-line bg-accent-soft text-accent-text'
                : 'border-line bg-surface-sunken text-fg-secondary hover:border-line-strong hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-fg-muted')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One expandable row of a reference list. */
export function RefRow({
  expanded,
  onToggle,
  summary,
  children,
  id,
}: {
  expanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const panelId = useId();
  return (
    <li id={id} className="scroll-mt-24">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover"
      >
        <ChevronRight
          size={15}
          aria-hidden
          className={cn('mt-[3px] shrink-0 text-fg-muted transition-transform duration-150', expanded && 'rotate-90')}
        />
        <div className="min-w-0 flex-1">{summary}</div>
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-line bg-surface-sunken px-4 py-3 pl-10 text-[13px] leading-relaxed text-fg-secondary">
          {children}
        </div>
      )}
    </li>
  );
}

export function RefList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y divide-line', className)}>{children}</ul>;
}

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No matches"
      action={
        <Button size="sm" onClick={onClear}>
          Clear search and filters
        </Button>
      }
    >
      Try a different word or number.
    </EmptyState>
  );
}
