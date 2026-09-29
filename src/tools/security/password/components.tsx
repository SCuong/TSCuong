import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { EntropyRating } from './lib/generate';

type CharClass = 'letter' | 'digit' | 'symbol';

function classify(ch: string): CharClass {
  if (/\p{L}/u.test(ch)) return 'letter';
  if (/\p{Nd}/u.test(ch)) return 'digit';
  return 'symbol';
}

const CLASS_COLORS: Record<CharClass, string> = {
  letter: 'text-fg',
  digit: 'text-[var(--lk-syn-number)]',
  symbol: 'text-[var(--lk-syn-keyword)]',
};

/** A generated secret with digits and symbols tinted, so similar-looking characters are easier to tell apart. */
export function ColoredSecret({ value, className }: { value: string; className?: string }) {
  const runs = useMemo(() => {
    const out: Array<{ cls: CharClass; text: string }> = [];
    for (const ch of Array.from(value)) {
      const cls = classify(ch);
      const last = out[out.length - 1];
      if (last && last.cls === cls) last.text += ch;
      else out.push({ cls, text: ch });
    }
    return out;
  }, [value]);
  return (
    <code className={cn('select-all', className)}>
      {runs.map((run, i) => (
        <span key={i} className={CLASS_COLORS[run.cls]}>
          {run.text}
        </span>
      ))}
    </code>
  );
}

const BAR: Record<EntropyRating['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
};

const TEXT: Record<EntropyRating['tone'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
};

/** Entropy in bits with a rating and a bar (full at 128 bits). */
export function EntropyMeter({ bits, rating }: { bits: number; rating: EntropyRating }) {
  const pct = Math.max(3, Math.min(100, (bits / 128) * 100));
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] text-fg-secondary">
          Entropy <span className="font-mono text-[15px] font-semibold text-fg tabular-nums">{bits.toFixed(1)}</span> bits
        </p>
        <p className={cn('text-[13px] font-semibold', TEXT[rating.tone])}>{rating.label}</p>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="meter"
        aria-label="Entropy"
        aria-valuemin={0}
        aria-valuemax={128}
        aria-valuenow={Math.round(Math.min(bits, 128))}
        aria-valuetext={`${bits.toFixed(1)} bits, ${rating.label}`}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-200', BAR[rating.tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
