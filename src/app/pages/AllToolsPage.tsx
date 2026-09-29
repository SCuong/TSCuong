import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { populatedCategories, searchTools, toolsInCategory, TOOLS } from '@/tools/registry';
import type { CategoryId } from '@/tools/types';
import { ToolGrid } from '@/components/ToolCard';
import { Input } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { useDocumentTitle } from '../useDocumentTitle';

export function AllToolsPage() {
  useDocumentTitle('All tools');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const categories = populatedCategories();

  const tools = useMemo(() => {
    const base = query.trim() ? searchTools(query, 500).map((r) => r.item) : TOOLS;
    return category === 'all' ? base : base.filter((t) => t.category === category);
  }, [query, category]);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">All tools</h1>
      <p className="mt-1 text-[14px] text-fg-secondary">
        {TOOLS.length} tools across {categories.length} categories. Every one runs in your browser.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tools…"
            aria-label="Filter tools"
            className="pl-9"
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Category filter">
          {[{ id: 'all' as const, name: 'All', count: TOOLS.length }, ...categories.map((c) => ({ id: c.id, name: c.name, count: toolsInCategory(c.id).length }))].map(
            (c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors',
                  category === c.id
                    ? 'border-accent-line bg-accent-soft font-medium text-accent-text'
                    : 'border-line bg-surface text-fg-secondary hover:border-line-strong hover:text-fg',
                )}
              >
                {c.name}
                <span className={cn('text-[11.5px] tabular-nums', category !== c.id && 'text-fg-muted')}>{c.count}</span>
              </button>
            ),
          )}
        </div>
      </div>

      <div className="mt-6" aria-live="polite">
        {tools.length ? (
          <ToolGrid tools={tools} />
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-fg-muted">
            No tools match your filter.
          </p>
        )}
      </div>
    </div>
  );
}
