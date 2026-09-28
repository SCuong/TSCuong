import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/Field';

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

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Native color swatch + hex text input kept in sync. */
export function ColorField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX_RE.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
        />
        <input
          id={id}
          className="lk-field w-28 font-mono text-[13px]"
          value={draft}
          spellCheck={false}
          maxLength={7}
          aria-invalid={!HEX_RE.test(draft) || undefined}
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && !v.startsWith('#')) v = `#${v}`;
            setDraft(v);
            if (HEX_RE.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
    </div>
  );
}

/** A preview frame with a checkerboard (transparency) or solid background. */
export function PreviewFrame({
  children,
  background = 'checker',
  className,
}: {
  children: ReactNode;
  background?: 'checker' | 'light' | 'dark' | string;
  className?: string;
}) {
  const style =
    background === 'light'
      ? { backgroundColor: '#ffffff' }
      : background === 'dark'
        ? { backgroundColor: '#111418' }
        : background !== 'checker'
          ? { backgroundColor: background }
          : undefined;
  return (
    <div
      className={cn(
        'flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-line p-3',
        background === 'checker' && 'lk-checker',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
