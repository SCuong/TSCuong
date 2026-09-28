import type { ExplainKind, ExplainNode } from '../lib/explain';
import { cn } from '@/lib/utils';

const KIND_STYLE: Record<ExplainKind, string> = {
  literal: 'text-fg',
  char: 'text-fg',
  any: 'text-[var(--lk-syn-keyword)]',
  class: 'text-[var(--lk-syn-number)]',
  group: 'text-[var(--lk-syn-function)]',
  lookaround: 'text-[var(--lk-syn-type)]',
  anchor: 'text-[var(--lk-syn-keyword)]',
  alternation: 'text-[var(--lk-syn-tag)]',
  reference: 'text-[var(--lk-syn-attr)]',
};

/** Longest token shown in full; longer ones (e.g. a big group) are shortened with an ellipsis. */
const MAX_TOKEN = 48;

function shorten(raw: string): string {
  return raw.length > MAX_TOKEN ? `${raw.slice(0, MAX_TOKEN - 1)}…` : raw;
}

/** Nested, token-by-token explanation of a pattern. */
export function ExplanationTree({ nodes, depth = 0 }: { nodes: ExplainNode[]; depth?: number }) {
  return (
    <ul className={cn('flex flex-col gap-1', depth > 0 && 'mt-1 ml-2 border-l border-line pl-3 sm:ml-3')}>
      {nodes.map((node) => (
        <li key={`${node.start}-${node.end}-${node.kind}`} className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-0.5">
            <code
              title={node.raw}
              className={cn(
                'max-w-full shrink-0 rounded-md border border-line bg-surface-sunken px-1.5 py-px font-mono text-[12.5px] break-all whitespace-pre-wrap',
                KIND_STYLE[node.kind],
              )}
            >
              {node.raw ? shorten(node.raw) : '(empty)'}
            </code>
            <span className="min-w-0 text-[13px] text-fg-secondary">{node.text}</span>
          </div>
          {node.children && node.children.length > 0 && <ExplanationTree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}
