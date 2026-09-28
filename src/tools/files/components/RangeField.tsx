import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Labelled slider with a live value readout. */
export function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  className,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg-secondary">
          {label}
        </label>
        <span className="font-mono text-[12.5px] tabular-nums text-fg">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="lk-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
