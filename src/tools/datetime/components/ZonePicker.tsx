import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  POPULAR_ZONES,
  formatUtcLabel,
  listTimeZones,
  localTimeZone,
  searchZones,
  tzOffsetMs,
  zoneCity,
} from '../lib/tz';

/**
 * Searchable time-zone combobox. Matches city names, IANA ids, countries,
 * abbreviations ("EST") and offsets ("+5:30"); shows the UTC offset of each zone.
 * With an empty query it lists your zone and popular zones first, then all zones.
 */
export function ZonePicker({
  value,
  onChange,
  label,
  at,
  exclude,
  placeholder = 'Search city, country, zone or offset…',
  className,
  hideLabel,
  clearOnSelect,
  action,
}: {
  value: string;
  onChange: (zone: string) => void;
  label: string;
  /** Instant used for offsets and abbreviations (defaults to now). */
  at?: number;
  exclude?: string[];
  placeholder?: string;
  className?: string;
  hideLabel?: boolean;
  /** For "add zone" pickers: keep the field empty after choosing. */
  clearOnSelect?: boolean;
  /** Rendered at the end of the label row (e.g. quick "Local" / "UTC" buttons). */
  action?: ReactNode;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const instant = at ?? Date.now();
  // Offsets only change at transitions; bucket by hour so typing does not recompute everything.
  const hourBucket = Math.floor(instant / 3_600_000);
  const local = localTimeZone();

  const zones = useMemo(() => {
    const skip = new Set(exclude ?? []);
    return listTimeZones().filter((z) => !skip.has(z));
  }, [exclude]);

  /** Index of the first zone after the suggested block (for a visual divider). */
  const { results, suggestedCount } = useMemo(() => {
    if (!open) return { results: [] as string[], suggestedCount: 0 };
    if (query.trim()) return { results: searchZones(query, zones, hourBucket * 3_600_000, 80), suggestedCount: 0 };
    const known = new Set(zones);
    const suggested = [...new Set([local, ...POPULAR_ZONES])].filter((z) => known.has(z));
    const rest = zones.filter((z) => !suggested.includes(z));
    return { results: [...suggested, ...rest], suggestedCount: suggested.length };
  }, [open, query, zones, hourBucket, local]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(zone: string) {
    onChange(zone);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Home' && open) {
      setActive(0);
    } else if (event.key === 'End' && open) {
      setActive(Math.max(results.length - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && results[active]) {
        event.preventDefault();
        choose(results[active]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery('');
      }
    }
  }

  const shown = open ? query : clearOnSelect ? '' : value;
  const offsetLabel = !clearOnSelect && value && !open ? formatUtcLabel(tzOffsetMs(hourBucket * 3_600_000, value)) : '';

  return (
    <div className={cn('relative min-w-0', className)}>
      <div className={cn('mb-1.5 flex min-h-5 items-center justify-between gap-2', hideLabel && !action && 'sr-only')}>
        <label htmlFor={id} className={cn('text-[13px] font-medium text-fg-secondary', hideLabel && 'sr-only')}>
          {label}
        </label>
        {action}
      </div>
      <div className="relative">
        <Globe size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn('lk-field truncate pl-8', offsetLabel && 'pr-20')}
          value={shown}
          placeholder={clearOnSelect ? placeholder : value || placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setActive(0);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {offsetLabel && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[12px] text-fg-muted tabular-nums"
          >
            {offsetLabel}
          </span>
        )}
      </div>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line-strong bg-surface-raised p-1 shadow-popover"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-fg-muted">No time zone matches “{query}”.</li>
          ) : (
            results.map((zone, i) => (
              <li
                key={zone}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(zone);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px]',
                  i === active ? 'bg-accent-soft text-fg' : 'text-fg-secondary',
                  suggestedCount > 0 && i === suggestedCount && 'mt-1 border-t border-line pt-2',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-fg">
                    {zoneCity(zone)}
                    {zone === local && <span className="ml-1.5 text-[11.5px] font-normal text-accent-text">your zone</span>}
                    {zone === value && !clearOnSelect && <span className="ml-1.5 text-[11.5px] font-normal text-fg-muted">selected</span>}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">{zone}</span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-fg-muted tabular-nums">
                  {formatUtcLabel(tzOffsetMs(hourBucket * 3_600_000, zone))}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
