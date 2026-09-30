import { Link } from 'react-router';
import { Pin, Star } from 'lucide-react';
import type { ToolDefinition } from '@/tools/types';
import { getCategory } from '@/tools/categories';
import { preloadTool, toolPath } from '@/tools/registry';
import { toggleFavorite, useFavorites, usePinned } from '@/lib/userPrefs';
import { cn } from '@/lib/utils';
import { ToolIcon } from './ToolIcon';
import { t } from '@/lib/i18n';

export function ToolCard({ tool, variant = 'default' }: { tool: ToolDefinition; variant?: 'default' | 'compact' }) {
  const favorites = useFavorites();
  const pinned = usePinned();
  const isFavorite = favorites.includes(tool.id);
  const isPinned = pinned.includes(tool.id);
  const category = getCategory(tool.category);

  return (
    <div className="group relative">
      <Link
        to={toolPath(tool)}
        onMouseEnter={() => preloadTool(tool)}
        onFocus={() => preloadTool(tool)}
        className={cn(
          'flex h-full items-start gap-3 rounded-xl border border-line bg-surface shadow-card transition-[border-color,background-color,box-shadow] duration-150',
          'hover:border-line-strong hover:bg-surface-raised hover:shadow-raised',
          variant === 'compact' ? 'px-3 py-2.5' : 'p-3.5 pr-10',
        )}
      >
        <ToolIcon icon={tool.icon} hue={category.hue} size={variant === 'compact' ? 'sm' : 'md'} />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 truncate text-[14px] font-medium text-fg">
            <span className="truncate">{t(tool.name)}</span>
            {isPinned && <Pin size={11} className="shrink-0 text-fg-muted" aria-label={t('Pinned')} />}
          </h3>
          {variant === 'default' && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-fg-muted">{t(tool.description)}</p>
          )}
        </div>
      </Link>
      {variant === 'default' && (
        <button
          type="button"
          onClick={() => toggleFavorite(tool.id)}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? t('Remove {name} from favorites', { name: t(tool.name) }) : t('Add {name} to favorites', { name: t(tool.name) })}
          title={isFavorite ? t('Remove from favorites') : t('Add to favorites')}
          className={cn(
            'absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-md transition-[opacity,color,background-color] duration-100 hover:bg-surface-hover',
            isFavorite
              ? 'text-warm opacity-100'
              : 'text-fg-muted opacity-100 hover:text-fg sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100',
          )}
        >
          <Star size={15} aria-hidden fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

export function ToolGrid({ tools, variant }: { tools: ToolDefinition[]; variant?: 'default' | 'compact' }) {
  return (
    <ul
      className={cn(
        'grid gap-2.5',
        variant === 'compact'
          ? 'grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4'
          : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
      )}
    >
      {tools.map((tool) => (
        <li key={tool.id} className="min-w-0">
          <ToolCard tool={tool} variant={variant} />
        </li>
      ))}
    </ul>
  );
}
