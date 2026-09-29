import { useEffect, useId, useState, type ReactNode } from 'react';
import { CopyButton } from '@/components/ui/Actions';
import { cn } from '@/lib/utils';
import { formatIsoDate, formatClock, parseWall, type WallTime } from '../lib/civil';
import { isValidTimeZone, localTimeZone, wallInZone } from '../lib/tz';

/** Current time, updated every `intervalMs` unless paused. */
export function useNow(intervalMs = 1000, paused = false): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, paused]);
  return now;
}

/**
 * Current time that ticks right after each whole `periodMs` (1 s, 1 min…), so a
 * displayed clock changes on time instead of up to a period late.
 */
export function useClock(periodMs = 1000, paused = false): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      timer = setTimeout(tick, periodMs - (t % periodMs) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [periodMs, paused]);
  return now;
}

/** `useClock` with a one-second period. */
export function useSecondClock(paused = false): number {
  return useClock(1000, paused);
}

/** A stored zone if the browser still knows it, else the device zone. */
export function validZone(zone: string | undefined): string {
  return zone && isValidTimeZone(zone) ? zone : localTimeZone();
}

/** Whether the user's locale prefers a 12-hour clock. */
export function prefers12Hour(): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12);
  } catch {
    return false;
  }
}

/** "YYYY-MM-DDTHH:MM:SS" for <input type="datetime-local">. */
export function toLocalInputValue(w: WallTime): string {
  return `${formatIsoDate(w)}T${formatClock(w)}`;
}

/** The current wall time in a zone, as an input value (seconds zeroed). */
export function nowInputValue(zone: string, now = Date.now()): string {
  const w = wallInZone(now, zone);
  return toLocalInputValue({ ...w, second: 0, millisecond: 0 });
}

/** Today's date in a zone, as a date input value. */
export function todayInputValue(zone: string, now = Date.now()): string {
  return formatIsoDate(wallInZone(now, zone));
}

/** Parses a datetime-local / date input value. */
export function parseInputValue(value: string): WallTime | null {
  return value ? parseWall(value) : null;
}

/** Labelled date-time (or date-only) input backed by the native picker. */
export function DateTimeInput({
  label,
  value,
  onChange,
  dateOnly,
  className,
  invalid,
  action,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  dateOnly?: boolean;
  className?: string;
  invalid?: boolean;
  action?: ReactNode;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg-secondary">
          {label}
        </label>
        {action}
      </div>
      <input
        id={id}
        type={dateOnly ? 'date' : 'datetime-local'}
        step={dateOnly ? undefined : 1}
        min={dateOnly ? '0001-01-01' : '0001-01-01T00:00'}
        max={dateOnly ? '9999-12-31' : '9999-12-31T23:59:59'}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="lk-field font-mono text-[13px] tabular-nums"
      />
      {hint && <p className="mt-1.5 text-[12.5px] text-fg-muted">{hint}</p>}
    </div>
  );
}

/** Small text button used next to input labels ("Now", "Today"). */
export function LinkButton({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded px-1 text-[12.5px] font-medium text-accent-text hover:underline"
    >
      {children}
    </button>
  );
}

/** Example / preset chip. */
export function Chip({
  children,
  onClick,
  active,
  mono = true,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  mono?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'max-w-full truncate rounded-md border px-2 py-0.5 text-[12px] transition-colors',
        mono && 'font-mono',
        active
          ? 'border-accent-line bg-accent-soft text-accent-text'
          : 'border-line bg-surface-sunken text-fg-secondary hover:border-line-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/** One labelled output value with a copy button. */
export function CopyRow({
  label,
  value,
  hint,
  mono = true,
  emphasis,
  empty,
}: {
  label: ReactNode;
  value: string;
  hint?: ReactNode;
  mono?: boolean;
  emphasis?: boolean;
  /** Shown (muted) instead of a dash when there is no value. */
  empty?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[minmax(130px,200px)_minmax(0,1fr)_auto]">
      <div className="min-w-0 text-[12.5px] text-fg-muted sm:text-[13px]">
        {label}
        {hint && <span className="block text-[11.5px] text-fg-muted">{hint}</span>}
      </div>
      <div
        className={cn(
          'order-3 col-span-2 min-w-0 break-all text-fg sm:order-none sm:col-span-1',
          mono ? 'font-mono text-[13px]' : 'text-[13.5px]',
          emphasis && 'font-semibold',
        )}
      >
        {value || <span className="font-sans text-[12.5px] text-fg-muted">{empty ?? '—'}</span>}
      </div>
      <CopyButton value={value} iconOnly label={`Copy ${typeof label === 'string' ? label : 'value'}`} />
    </div>
  );
}

/** Small headline stat used in result summaries. */
export function BigValue({
  label,
  value,
  sub,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-lg border border-line bg-surface-sunken px-3 py-2.5', className)}>
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[17px] font-semibold text-fg tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-fg-muted">{sub}</div>}
    </div>
  );
}

/** Compact inline fact: "Label value". */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg tabular-nums">{children}</span>
    </span>
  );
}
