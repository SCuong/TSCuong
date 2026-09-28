import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Search, TriangleAlert } from 'lucide-react';
import { CopyButton } from '@/components/ui/Actions';
import { Input } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { GIT_RECIPES, RECIPE_GROUPS, searchRecipes, type GitRecipe, type RecipeGroup } from './lib/gitCommands';
import { ToggleChip } from './shared';

const TOOL = 'git-command-reference';

/** Highlight <placeholders> so users see what to replace. */
function renderCommand(cmd: string): ReactNode {
  const parts = cmd.split(/(<[^<>\s][^<>]*>)/g);
  return parts.map((part, i) =>
    /^<[^<>]+>$/.test(part) && part !== '<<<<<<<' ? (
      <span key={i} className="rounded bg-accent-soft px-0.5 text-accent-text">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Render `code` spans in explanations. */
function renderText(text: string): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-surface-sunken px-1 py-px font-mono text-[12px] text-fg">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export default function GitCommandReference() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useToolState<RecipeGroup | 'all'>(TOOL, 'group', 'all');

  const results = useMemo(() => {
    const found = searchRecipes(query);
    return group === 'all' ? found : found.filter((r) => r.group === group);
  }, [query, group]);

  const grouped = useMemo(() => {
    if (query.trim()) return [{ group: null as RecipeGroup | null, items: results }];
    return RECIPE_GROUPS.map((g) => ({ group: g as RecipeGroup | null, items: results.filter((r) => r.group === g) })).filter((g) => g.items.length);
  }, [results, query]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <div className="relative">
          <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to do? e.g. undo last commit, rename branch, stash"
            aria-label="Search Git tasks"
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter by topic">
          <ToggleChip pressed={group === 'all'} onToggle={() => setGroup('all')}>
            All
          </ToggleChip>
          {RECIPE_GROUPS.map((g) => (
            <ToggleChip key={g} pressed={group === g} onToggle={() => setGroup(group === g ? 'all' : g)}>
              {g}
            </ToggleChip>
          ))}
        </div>
      </div>

      <p className="text-[12.5px] text-fg-muted" role="status">
        {pluralize(results.length, 'task')}
        {results.length !== GIT_RECIPES.length && ` of ${GIT_RECIPES.length}`} · placeholders like{' '}
        <code className="rounded bg-accent-soft px-1 font-mono text-accent-text">&lt;branch&gt;</code> need your values
      </p>

      {results.length === 0 ? (
        <EmptyState icon={Search} title="No matching task" className="rounded-xl border border-line bg-surface">
          Try fewer or different words, such as “reset”, “branch” or “remote”.
        </EmptyState>
      ) : (
        grouped.map(({ group: g, items }) => (
          <section key={g ?? 'results'} aria-label={g ?? 'Search results'} className="flex flex-col gap-3">
            {g && <h2 className="text-[13px] font-semibold tracking-wide text-fg-muted uppercase">{g}</h2>}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {items.map((r) => (
                <RecipeCard key={r.id} recipe={r} showGroup={!g} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function RecipeCard({ recipe, showGroup }: { recipe: GitRecipe; showGroup: boolean }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-semibold tracking-tight text-fg">{recipe.title}</h3>
        {showGroup && <span className="text-[12px] text-fg-muted">{recipe.group}</span>}
      </header>
      <ul className="flex flex-col gap-1.5">
        {recipe.commands.map((c) => (
          <li key={c.cmd} className="rounded-lg border border-line bg-surface-sunken">
            <div className="flex items-start gap-2 py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 py-1 font-mono text-[12.5px] leading-relaxed break-words text-fg">{renderCommand(c.cmd)}</code>
              <CopyButton value={c.cmd} iconOnly label={`Copy: ${c.cmd}`} />
            </div>
            {c.note && <p className="border-t border-line px-3 py-1 text-[12px] text-fg-muted">{c.note}</p>}
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-relaxed text-fg-secondary">{renderText(recipe.explain)}</p>
      {recipe.danger && (
        <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] leading-relaxed text-fg">
          <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
          {recipe.danger}
        </p>
      )}
    </article>
  );
}
