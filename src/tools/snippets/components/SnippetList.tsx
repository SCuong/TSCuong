import { forwardRef, memo, useImperativeHandle, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSnippetLanguage } from '../lib/languages';
import { relativeTime, type Snippet } from '../lib/model';
import type { SearchHit } from '../lib/search';
import { CodePreview } from './HighlightedCode';

export interface SnippetListHandle {
  scrollToIndex: (index: number) => void;
}

interface Props {
  hits: SearchHit[];
  activeId: string | null;
  openId: string | null;
  onOpen: (id: string) => void;
  className?: string;
}

/** Virtualized snippet list (stays smooth with thousands of snippets). */
export const SnippetList = forwardRef<SnippetListHandle, Props>(function SnippetList(
  { hits, activeId, openId, onOpen, className },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: hits.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 124,
    overscan: 6,
    getItemKey: (i) => hits[i].snippet.id,
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }),
  }));

  // Rounded so memoized rows only re-render when the relative time can change.
  const now = Math.floor(Date.now() / 60_000) * 60_000;

  return (
    <div ref={scroller} className={cn('min-h-0 overflow-y-auto', className)}>
      <ul
        aria-label="Snippets"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const snippet = hits[item.index].snippet;
          return (
            <li
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0 px-2 pb-1.5"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Row
                snippet={snippet}
                active={snippet.id === activeId}
                open={snippet.id === openId}
                now={now}
                onOpen={onOpen}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
});

const Row = memo(function Row({
  snippet,
  active,
  open,
  now,
  onOpen,
}: {
  snippet: Snippet;
  active: boolean;
  open: boolean;
  now: number;
  onOpen: (id: string) => void;
}) {
  const lang = getSnippetLanguage(snippet.language);
  return (
    <button
      type="button"
      id={`snippet-row-${snippet.id}`}
      onClick={() => onOpen(snippet.id)}
      aria-current={open || undefined}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors duration-100',
        open
          ? 'border-accent-line bg-accent-soft'
          : active
            ? 'border-line-strong bg-surface-hover'
            : 'border-transparent hover:bg-surface-hover',
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        {snippet.favorite && <Star size={13} className="shrink-0 fill-current text-warm" aria-label="Favorite" />}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">{snippet.title}</span>
        <span className="shrink-0 rounded border border-line bg-surface px-1.5 text-[11px] leading-[18px] font-medium text-fg-secondary">
          {lang.name}
        </span>
      </span>
      <CodePreview
        code={snippet.code}
        language={snippet.language}
        lines={3}
        className="h-[62px] w-full rounded-md border border-line/70 bg-surface-sunken px-2 py-1"
      />
      <span className="flex w-full min-w-0 items-center gap-2 text-[11.5px] text-fg-muted">
        <span className="min-w-0 flex-1 truncate">
          {snippet.tags.length > 0 ? snippet.tags.map((t) => `#${t}`).join(' ') : snippet.description || ' '}
        </span>
        {snippet.copyCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums" title={`Copied ${snippet.copyCount} times`}>
            <Copy size={11} aria-hidden />
            {snippet.copyCount}
          </span>
        )}
        <span className="shrink-0">{relativeTime(snippet.updatedAt, now)}</span>
      </span>
    </button>
  );
});
