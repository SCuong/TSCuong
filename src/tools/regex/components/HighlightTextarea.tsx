import { forwardRef, useMemo, useRef, type ReactNode, type UIEvent } from 'react';
import { cn } from '@/lib/utils';

export interface HighlightRange {
  start: number;
  end: number;
}

/** Text beyond this point is not mirrored in the highlight layer (the textarea still shows everything). */
const MAX_MIRROR_CHARS = 400_000;

const LAYOUT =
  'm-0 box-border px-3 py-2.5 font-mono text-[13px] leading-[1.6] whitespace-pre-wrap break-words [overflow-wrap:anywhere] [tab-size:4]';

/**
 * A plain textarea with match highlights drawn in a mirrored layer behind the
 * text. Consecutive matches alternate colours; `activeIndex` gets a stronger
 * outline. Zero-length matches are drawn as a thin caret. The mirror is
 * decorative (`aria-hidden`); the match list is the accessible representation.
 */
export const HighlightTextarea = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    ranges: HighlightRange[];
    activeIndex?: number | null;
    placeholder?: string;
    ariaLabel: string;
    className?: string;
    invalid?: boolean;
  }
>(function HighlightTextarea({ value, onChange, ranges, activeIndex, placeholder, ariaLabel, className, invalid }, ref) {
  const mirror = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    ranges.forEach((r, i) => {
      if (r.start < last || r.start > MAX_MIRROR_CHARS) return;
      if (r.start > last) out.push(value.slice(last, r.start));
      const active = i === activeIndex;
      if (r.end === r.start) {
        out.push(
          <span key={i} className="relative">
            <span
              className={cn(
                'absolute top-[0.2em] -left-px h-[1.2em] w-0.5 rounded-full',
                active ? 'bg-warm' : i % 2 ? 'bg-accent' : 'bg-warning',
              )}
            />
          </span>,
        );
      } else {
        out.push(
          <mark
            key={i}
            className={cn(
              'rounded-[3px] text-transparent',
              i % 2 ? 'lk-hl-match-alt' : 'lk-hl-match',
              active && 'outline-2 outline-offset-0 outline-warm',
            )}
          >
            {value.slice(r.start, r.end)}
          </mark>,
        );
      }
      last = r.end;
    });
    // Mirror the rest only while it is small; beyond the last highlight nothing needs drawing.
    out.push(value.slice(last, Math.max(last, Math.min(value.length, MAX_MIRROR_CHARS))));
    return out;
  }, [value, ranges, activeIndex]);

  function syncScroll(e: UIEvent<HTMLTextAreaElement>) {
    if (!mirror.current) return;
    mirror.current.scrollTop = e.currentTarget.scrollTop;
    mirror.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  return (
    <div
      className={cn(
        'relative min-h-0 overflow-hidden rounded-lg border bg-surface-sunken transition-[border-color,box-shadow] duration-100',
        invalid
          ? 'border-danger'
          : 'border-line-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--lk-accent-soft)]',
        className,
      )}
    >
      <div
        ref={mirror}
        aria-hidden
        className={cn(LAYOUT, 'pointer-events-none absolute inset-0 overflow-y-scroll text-transparent select-none')}
        style={{ scrollbarColor: 'transparent transparent' }}
      >
        {nodes}
        {'\n'}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn(
          LAYOUT,
          'relative block h-full w-full resize-none overflow-y-scroll bg-transparent text-fg caret-[var(--lk-accent-text)] outline-none placeholder:text-fg-muted',
        )}
      />
    </div>
  );
});
