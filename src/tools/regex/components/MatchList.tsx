import { useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn, formatNumber } from '@/lib/utils';
import type { MatchResult } from '../lib/match';
import { t } from '@/lib/i18n';

const PAGE = 100;
const MAX_SHOWN_CHARS = 240;

/** Show invisible characters (line breaks, tabs, empty strings) so matches are unambiguous. */
export function VisibleText({ text, className }: { text: string | undefined; className?: string }) {
  if (text === undefined) return <span className="text-fg-muted italic">{t('did not participate')}</span>;
  if (text === '') return <span className="text-fg-muted italic">{t('empty')}</span>;
  const shown = text.length > MAX_SHOWN_CHARS ? text.slice(0, MAX_SHOWN_CHARS) : text;
  const parts: ReactNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) parts.push(buf);
    buf = '';
  };
  for (const ch of shown) {
    const symbol = ch === '\n' ? '↵' : ch === '\r' ? '␍' : ch === '\t' ? '⇥' : null;
    if (symbol) {
      flush();
      parts.push(
        <span key={parts.length} className="text-fg-muted" title={ch === '\n' ? t('line feed') : ch === '\r' ? t('carriage return') : 'tab'}>
          {symbol}
        </span>,
      );
    } else buf += ch;
  }
  flush();
  return (
    <span className={cn('whitespace-pre-wrap break-all', className)}>
      {parts}
      {shown.length < text.length && <span className="text-fg-muted">{t('… (+{count} chars)', { count: formatNumber(text.length - shown.length, 0) })}</span>}
    </span>
  );
}

export function MatchList({
  matches,
  replacements,
  activeIndex,
  onSelect,
}: {
  matches: MatchResult[];
  replacements: string[] | null;
  activeIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const shown = matches.slice(0, limit);

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2" aria-label={t('Matches')}>
        {shown.map((m, i) => (
          <li key={`${m.index}-${i}`}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === activeIndex || undefined}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors duration-100',
                i === activeIndex
                  ? 'border-accent-line bg-accent-soft'
                  : 'border-line bg-surface-sunken hover:border-line-strong hover:bg-surface-hover',
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] text-fg-muted">
                <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
                  <span
                    aria-hidden
                    className={cn('inline-block size-2 rounded-full', i % 2 ? 'lk-hl-match-alt' : 'lk-hl-match')}
                  />
                  {t('Match {i}', { i: formatNumber(i + 1, 0) })}
                </span>
                <span className="tabular-nums">
                  {t('index {index}–{end} · length {end2}', { index: formatNumber(m.index, 0), end: formatNumber(m.end, 0), end2: formatNumber(m.end - m.index, 0) })}
                </span>
              </div>
              <div className="mt-1 font-mono text-[13px] text-fg">
                <VisibleText text={m.text} />
              </div>
              {replacements && (
                <div className="mt-1 flex min-w-0 items-baseline gap-1.5 font-mono text-[13px] text-success">
                  <ArrowRight size={13} aria-label="becomes" className="shrink-0 translate-y-0.5" />
                  <VisibleText text={replacements[i]} />
                </div>
              )}
              {m.groups.length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-2 text-[12.5px]">
                  {m.groups.map((g) => (
                    <div key={g.index} className="contents">
                      <dt className="font-mono whitespace-nowrap text-fg-muted">
                        ${g.index}
                        {g.name && <span className="text-accent-text"> {g.name}</span>}
                      </dt>
                      <dd className="min-w-0 font-mono text-fg">
                        <VisibleText text={g.value} />
                        {g.start !== null && (
                          <span className="ml-2 font-sans text-[11.5px] text-fg-muted tabular-nums">
                            {formatNumber(g.start, 0)}–{formatNumber(g.end ?? g.start, 0)}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </button>
          </li>
        ))}
      </ol>
      {matches.length > limit && (
        <Button size="sm" variant="ghost" className="self-center" onClick={() => setLimit((l) => l + PAGE * 2)}>
          {t('Show more ({count} left)', { count: formatNumber(matches.length - limit, 0) })}
        </Button>
      )}
    </div>
  );
}
