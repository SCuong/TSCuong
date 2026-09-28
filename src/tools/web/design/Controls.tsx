import { useId, useState, type ReactNode } from 'react';
import { CopyButton } from '@/components/ui/Actions';
import { cn } from '@/lib/utils';

/** Label + range slider + number field, kept in sync. */
export function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className,
}: {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_88px] items-center gap-x-3 gap-y-1', className)}>
      <label htmlFor={id} className="col-span-2 text-[12.5px] font-medium text-fg-secondary">
        {label}
      </label>
      <input
        type="range"
        className="lk-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={typeof label === "string" ? label : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={cn('lk-field h-8 py-1 pr-7 text-right text-[13px] tabular-nums', !unit && 'pr-2')}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            if (e.target.value === '') return;
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
        {unit && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11.5px] text-fg-muted">{unit}</span>}
      </div>
    </div>
  );
}

/** Native color swatch + hex text input. */
export function ColorInput({ label, value, onChange, className }: { label: string; value: string; onChange: (hex: string) => void; className?: string }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-fg-secondary">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface-sunken p-0.5"
        />
        <input
          id={id}
          className="lk-field h-8 py-1 font-mono text-[13px]"
          value={draft ?? value}
          spellCheck={false}
          aria-invalid={draft !== null && !parseHex(draft) ? true : undefined}
          onFocus={() => setDraft(value)}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = parseHex(e.target.value);
            if (hex) onChange(hex);
          }}
        />
      </div>
    </div>
  );
}

function parseHex(text: string): string | null {
  const v = text.trim();
  const hex = v.startsWith('#') ? v : `#${v}`;
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) return `#${hex.slice(1).replace(/./g, (c) => c + c)}`.toLowerCase();
  return null;
}

/** Read-only CSS output with a copy button. */
export function CssOutput({ title = 'CSS', code }: { title?: string; code: string }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        <CopyButton value={code} label="Copy CSS" />
      </header>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-fg">{code}</pre>
    </section>
  );
}
