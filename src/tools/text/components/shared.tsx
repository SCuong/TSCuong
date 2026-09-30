import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/Field';
import { FlaskConical } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import { codePointLabel, countCodePoints, countLines, visibleChar, whitespaceName } from '../lib/common';
import type { FrequencyRow } from '../lib/frequency';

/** Standard file types for "Open file" on text inputs. */
export const TEXT_FILE_ACCEPT = '.txt,.md,.csv,.tsv,.log,.json,.xml,.html,.htm,.yml,.yaml,.ini,.conf,.srt,.vtt,text/*';

/** Label + control group used in tool bars. */
export function Opt({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** "12 lines · 340 characters" footer for editor panels (counted without blocking typing in huge texts). */
export function TextFooter({ text, extra }: { text: string; extra?: ReactNode }) {
  const deferred = useDeferredValue(text);
  const counts = useMemo(() => ({ lines: countLines(deferred), chars: countCodePoints(deferred) }), [deferred]);
  if (!text) return null;
  return (
    <>
      <span>{pluralize(counts.lines, 'line')}</span>
      <span>{pluralize(counts.chars, 'character')}</span>
      {extra}
    </>
  );
}

export interface HighlightRange {
  start: number;
  end: number;
  /** Optional alternate style (e.g. the "first" occurrence). */
  alt?: boolean;
  title?: string;
}

const MAX_HIGHLIGHT_CHARS = 300_000;
const MAX_HIGHLIGHTS = 5_000;

/**
 * Read-only text view with highlighted ranges. Very large inputs are truncated for
 * display only, with a note, so the page stays responsive.
 */
export function HighlightedText({
  text,
  ranges,
  className,
  maxHeight = '360px',
  emptyLabel = 'Nothing to show yet.',
  ariaLabel,
}: {
  text: string;
  ranges: HighlightRange[];
  className?: string;
  maxHeight?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  const parts = useMemo(() => {
    const limit = Math.min(text.length, MAX_HIGHLIGHT_CHARS);
    const out: ReactNode[] = [];
    let last = 0;
    let shown = 0;
    const sorted = ranges.slice().sort((a, b) => a.start - b.start);
    for (const r of sorted) {
      if (r.start >= limit || shown >= MAX_HIGHLIGHTS) break;
      if (r.start < last) continue;
      if (r.start > last) out.push(text.slice(last, r.start));
      const end = Math.min(r.end, limit);
      out.push(
        <mark key={r.start} title={r.title} className={cn('text-fg', r.alt ? 'lk-hl-match-alt' : 'lk-hl-match')}>
          {text.slice(r.start, end)}
        </mark>,
      );
      last = end;
      shown++;
    }
    if (last < limit) out.push(text.slice(last, limit));
    return { nodes: out, truncated: text.length > limit, cappedHighlights: shown >= MAX_HIGHLIGHTS && sorted.length > shown };
  }, [text, ranges]);

  return (
    <div className={cn('rounded-lg border border-line bg-surface-sunken', className)}>
      <pre
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        className="overflow-auto px-3 py-2 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg"
        style={{ maxHeight }}
      >
        {text ? parts.nodes : <span className="text-fg-muted">{emptyLabel}</span>}
      </pre>
      {(parts.truncated || parts.cappedHighlights) && (
        <p className="border-t border-line px-3 py-1.5 text-[12px] text-fg-muted">
          {parts.truncated
            ? `Preview shows the first ${formatNumber(MAX_HIGHLIGHT_CHARS, 0)} characters.`
            : `Only the first ${formatNumber(MAX_HIGHLIGHTS, 0)} matches are highlighted.`}
        </p>
      )}
    </div>
  );
}

/** Frequency table with bars; renders the first 200 rows until expanded. */
export function FrequencyTable({
  rows,
  itemHeader,
  mode = 'word',
}: {
  rows: FrequencyRow[];
  itemHeader: string;
  mode?: 'word' | 'char';
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? 5000 : 200;
  const visible = rows.slice(0, limit);
  const max = rows[0]?.count ?? 1;
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-fg-muted">
              <th scope="col" className="w-12 py-2 pr-2 font-medium">#</th>
              <th scope="col" className="py-2 pr-3 font-medium">{itemHeader}</th>
              {mode === 'char' && (
                <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">Code point</th>
              )}
              <th scope="col" className="py-2 pr-3 text-right font-medium">Count</th>
              <th scope="col" className="py-2 text-right font-medium sm:w-[34%] sm:text-left">Share</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const name = mode === 'char' ? whitespaceName(row.item) : null;
              return (
                <tr key={row.item} className="border-b border-line/70 last:border-0">
                  <td className="py-1.5 pr-2 text-fg-muted tabular-nums">{i + 1}</td>
                  <td className="py-1.5 pr-3 break-all">
                    <span className="font-mono text-fg">{mode === 'char' ? visibleChar(row.item) : row.item}</span>
                    {name && <span className="ml-2 text-[12px] text-fg-muted">{name}</span>}
                  </td>
                  {mode === 'char' && (
                    <td className="hidden py-1.5 pr-3 font-mono text-[12px] whitespace-nowrap text-fg-secondary sm:table-cell">{codePointLabel(row.item)}</td>
                  )}
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatNumber(row.count, 0)}</td>
                  <td className="py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover sm:block">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(row.count / max) * 100}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-[12px] text-fg-secondary tabular-nums">
                        {row.percent.toFixed(row.percent < 1 ? 2 : 1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > visible.length && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-fg-muted">
          <span>
            Showing {formatNumber(visible.length, 0)} of {formatNumber(rows.length, 0)}. The CSV export includes every row.
          </span>
          {!expanded && (
            <Button size="sm" variant="secondary" onClick={() => setExpanded(true)}>
              Show more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact inline list of numbers, e.g. "3 matched · 7 kept". */
export function Counts({ items }: { items: Array<{ label: string; value: number | string; tone?: 'success' | 'danger' | 'accent' }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
      {items.map((item) => (
        <span key={item.label}>
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              item.tone === 'success' ? 'text-success' : item.tone === 'danger' ? 'text-danger' : item.tone === 'accent' ? 'text-accent-text' : 'text-fg',
            )}
          >
            {typeof item.value === 'number' ? formatNumber(item.value, 0) : item.value}
          </span>{' '}
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** "Load sample" action for editor panels whose sample also sets options. */
export function SampleButton({ onClick }: { onClick: () => void }) {
  return <IconButton icon={FlaskConical} label="Load sample" size="sm" onClick={onClick} />;
}
