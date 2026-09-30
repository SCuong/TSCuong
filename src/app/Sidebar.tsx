import { NavLink } from 'react-router';
import { House, LayoutGrid, Pin, Settings, ShieldCheck, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { populatedCategories, resolveTools, toolPath, toolsInCategory } from '@/tools/registry';
import { getCategory } from '@/tools/categories';
import { usePinned } from '@/lib/userPrefs';
import { ToolIcon } from '@/components/ToolIcon';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

function NavItem({
  to,
  icon: Icon,
  children,
  end,
  onNavigate,
  count,
}: {
  to: string;
  icon: LucideIcon;
  children: string;
  end?: boolean;
  onNavigate?: () => void;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-100',
          isActive ? 'bg-surface-hover font-medium text-fg' : 'text-fg-secondary hover:bg-surface-hover/70 hover:text-fg',
        )
      }
    >
      <Icon size={16} aria-hidden className="shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-[11.5px] tabular-nums text-fg-muted">{count}</span>}
    </NavLink>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mt-5 mb-1.5 px-2.5 text-[11px] font-semibold tracking-[0.06em] text-fg-muted uppercase">{children}</h2>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pinned = resolveTools(usePinned());
  const categories = populatedCategories();

  return (
    <nav aria-label={t('Main')} className="flex flex-col px-3 pt-3 pb-6">
      <NavItem to="/" icon={House} end onNavigate={onNavigate}>
        {t('Home')}
      </NavItem>
      <NavItem to="/tools" icon={LayoutGrid} end onNavigate={onNavigate}>
        {t('All tools')}
      </NavItem>
      <NavItem to="/favorites" icon={Star} onNavigate={onNavigate}>
        {t('Favorites & history')}
      </NavItem>

      {pinned.length > 0 && (
        <>
          <SectionTitle>{t('Pinned')}</SectionTitle>
          {pinned.map((tool) => (
            <NavLink
              key={tool.id}
              to={toolPath(tool)}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors',
                  isActive ? 'bg-surface-hover font-medium text-fg' : 'text-fg-secondary hover:bg-surface-hover/70 hover:text-fg',
                )
              }
            >
              <ToolIcon icon={tool.icon} hue={getCategory(tool.category).hue} size="sm" className="size-5.5 rounded-[5px] [&_svg]:size-3.5" />
              <span className="min-w-0 flex-1 truncate">{t(tool.name)}</span>
              <Pin size={12} aria-hidden className="text-fg-muted" />
            </NavLink>
          ))}
        </>
      )}

      <SectionTitle>{t('Categories')}</SectionTitle>
      {categories.map((category) => (
        <NavItem
          key={category.id}
          to={`/category/${category.id}`}
          icon={category.icon}
          onNavigate={onNavigate}
          count={toolsInCategory(category.id).length}
        >
          {t(category.name)}
        </NavItem>
      ))}

      <SectionTitle>{t('App')}</SectionTitle>
      <NavItem to="/settings" icon={Settings} onNavigate={onNavigate}>
        {t('Settings & backup')}
      </NavItem>
      <NavItem to="/privacy" icon={ShieldCheck} onNavigate={onNavigate}>
        {t('Privacy')}
      </NavItem>
    </nav>
  );
}
