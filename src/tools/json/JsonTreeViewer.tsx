import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Link, ListTree, Search } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Feedback';
import { ErrorMessage } from '@/components/ui/Alert';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, copyText, formatNumber, pluralize } from '@/lib/utils';
import { formatJsonError, parseJson } from './lib/json';
import { countNodes, flattenTree, previewValue, searchTree, type ExpansionState, type JsonType, type TreeRow } from './lib/tree';

const SAMPLE = JSON.stringify(
  {
    store: {
      name: 'Corner Books',
      open: true,
      rating: 4.7,
      address: { street: '12 Main St', city: 'Springfield', zip: null },
      books: [
        { title: 'Sayings of the Century', author: 'Nigel Rees', price: 8.95, tags: ['quotes'] },
        { title: 'Moby Dick', author: 'Herman Melville', price: 8.99, isbn: '0-553-21311-3' },
        { title: 'The Lord of the Rings', author: 'J. R. R. Tolkien', price: 22.99, tags: ['fantasy', 'classic'] },
      ],
    },
  },
  null,
  2,
);

const ROW_HEIGHT = 28;

const TYPE_STYLE: Record<JsonType, string> = {
  string: 'text-[var(--lk-syn-string)]',
  number: 'text-[var(--lk-syn-number)]',
  boolean: 'text-[var(--lk-syn-keyword)]',
  null: 'text-fg-muted italic',
  object: 'text-fg-muted',
  array: 'text-fg-muted',
};

function valueForCopy(row: TreeRow): string {
  if (row.type === 'string') return row.value as string;
  return JSON.stringify(row.value, null, 2);
}

async function copyWithToast(text: string, what: string) {
  if (await copyText(text)) toast(`Copied ${what}`);
  else toast('Copy failed. Your browser blocked clipboard access.', 'error');
}

export default function JsonTreeViewer() {
  const [input, setInput] = useToolState('json-tree-viewer', 'input', '');
  const [query, setQuery] = useState('');
  const [expansion, setExpansion] = useState<ExpansionState>({ depth: 2, toggled: new Set() });
  const [selected, setSelected] = useState<string | null>(null);
  const debouncedInput = useDebouncedValue(input, input.length > 500_000 ? 300 : 100);
  const debouncedQuery = useDebouncedValue(query, 200);
  const scrollRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => (debouncedInput.trim() ? parseJson(debouncedInput) : null), [debouncedInput]);
  const root = parsed?.ok ? parsed.value : undefined;
  const total = useMemo(() => (parsed?.ok ? countNodes(parsed.value) : 0), [parsed]);
  const search = useMemo(() => (parsed?.ok && debouncedQuery.trim() ? searchTree(parsed.value, debouncedQuery) : null), [parsed, debouncedQuery]);
  const rows = useMemo(() => (parsed?.ok ? flattenTree(root, expansion, search) : []), [parsed, root, expansion, search]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  function toggle(path: string) {
    setExpansion((prev) => {
      const next = new Set(prev.toggled);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { depth: prev.depth, toggled: next };
    });
  }

  const selectedRow = selected ? rows.find((r) => r.path === selected) : undefined;
  const noMatches = search && search.count === 0;

  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <EditorPanel code
          title="JSON input"
          value={input}
          onChange={(v) => {
            setInput(v);
            setSelected(null);
          }}
          language="json"
          placeholder="Paste JSON or open a .json file…"
          sample={SAMPLE}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(parsed && !parsed.ok)}
          height="600px"
        />
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <div className="relative min-w-40 flex-1">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter keys and values…"
                aria-label="Filter keys and values"
                className="h-8 pl-8 text-[13px]"
                disabled={!parsed?.ok}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={ChevronsUpDown} onClick={() => setExpansion({ depth: Infinity, toggled: new Set() })} disabled={!parsed?.ok}>
                Expand all
              </Button>
              <Button size="sm" variant="ghost" icon={ChevronsDownUp} onClick={() => setExpansion({ depth: 1, toggled: new Set() })} disabled={!parsed?.ok}>
                Collapse all
              </Button>
            </div>
          </header>
          {parsed && !parsed.ok && (
            <div className="p-3">
              <ErrorMessage error={formatJsonError(parsed.error)} title="Invalid JSON" />
            </div>
          )}
          {!parsed && (
            <EmptyState icon={ListTree} title="No JSON yet" className="flex-1">
              Paste JSON on the left to explore it as a collapsible tree. Large files stay responsive: only visible rows render.
            </EmptyState>
          )}
          {parsed?.ok && (
            <>
              <div ref={scrollRef} className="h-[550px] overflow-auto font-mono text-[12.5px]" role="tree" aria-label="JSON tree">
                {noMatches ? (
                  <EmptyState icon={Search} title="No matches">
                    Nothing matches “{debouncedQuery}”.
                  </EmptyState>
                ) : (
                  <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }} className="w-max">
                    {virtualizer.getVirtualItems().map((item) => {
                      const row = rows[item.index];
                      const container = row.type === 'object' || row.type === 'array';
                      const isSel = row.path === selected;
                      return (
                        <div
                          key={row.path}
                          role="treeitem"
                          aria-level={row.depth + 1}
                          aria-expanded={container ? row.expanded : undefined}
                          aria-selected={isSel}
                          className={cn(
                            'group absolute left-0 flex w-full min-w-max items-center gap-1 pr-2',
                            isSel ? 'bg-accent-soft' : 'hover:bg-surface-hover',
                          )}
                          style={{ top: item.start, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * 16 }}
                        >
                          {container ? (
                            <button
                              type="button"
                              onClick={() => toggle(row.path)}
                              aria-label={row.expanded ? 'Collapse' : 'Expand'}
                              className="flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg"
                            >
                              <ChevronRight size={14} className={cn('transition-transform', row.expanded && 'rotate-90')} aria-hidden />
                            </button>
                          ) : (
                            <span className="w-5 shrink-0" />
                          )}
                          <button
                            type="button"
                            onClick={() => setSelected(row.path)}
                            onDoubleClick={() => container && toggle(row.path)}
                            title={row.path}
                            className="flex min-w-0 items-center gap-1.5 rounded px-1 text-left whitespace-nowrap"
                          >
                            {row.key !== null ? (
                              <span className={cn(typeof row.key === 'number' ? 'text-fg-muted' : 'text-[var(--lk-syn-property)]', row.match && 'lk-hl-match')}>
                                {typeof row.key === 'number' ? row.key : row.key === '' ? '""' : row.key}
                              </span>
                            ) : (
                              <span className="text-fg-muted">root</span>
                            )}
                            {container ? (
                              <span className="text-[11.5px] text-fg-muted">
                                {row.type === 'array' ? '[ ' : '{ '}
                                {pluralize(row.size, row.type === 'array' ? 'item' : 'key')}
                                {row.type === 'array' ? ' ]' : ' }'}
                              </span>
                            ) : (
                              <>
                                <span className="text-fg-muted">:</span>
                                <span className={cn(TYPE_STYLE[row.type], row.match && 'lk-hl-match')}>{previewValue(row.value)}</span>
                              </>
                            )}
                          </button>
                          <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-3">
                            <span className="rounded border border-line px-1 font-sans text-[10.5px] leading-4 text-fg-muted">{row.type}</span>
                            <IconButton
                              icon={Link}
                              label="Copy JSONPath"
                              size="sm"
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => void copyWithToast(row.path, 'JSONPath')}
                            />
                            <IconButton
                              icon={Copy}
                              label="Copy value"
                              size="sm"
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => void copyWithToast(valueForCopy(row), 'value')}
                            />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <footer className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3 py-1.5 text-[12.5px] text-fg-muted">
                {selectedRow ? (
                  <>
                    <code className="min-w-0 flex-1 truncate font-mono text-fg" title={selectedRow.path}>
                      {selectedRow.path}
                    </code>
                    <div className="flex gap-1">
                      <Button size="sm" icon={Link} onClick={() => void copyWithToast(selectedRow.path, 'JSONPath')}>
                        Copy path
                      </Button>
                      <Button size="sm" icon={Copy} onClick={() => void copyWithToast(valueForCopy(selectedRow), 'value')}>
                        Copy value
                      </Button>
                    </div>
                  </>
                ) : (
                  <span className="flex-1">
                    {formatNumber(total)} nodes · {formatNumber(rows.length)} shown
                    {search && search.count > 0 && ` · ${pluralize(search.count, 'match', 'matches')}`}
                    <span className="hidden sm:inline"> · Select a row to copy its JSONPath</span>
                  </span>
                )}
              </footer>
            </>
          )}
        </section>
      </div>
    </ToolStack>
  );
}
