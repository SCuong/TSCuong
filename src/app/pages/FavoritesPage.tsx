import { useState } from 'react';
import { History, Pin, Star, Trash } from 'lucide-react';
import { resolveTools, toolPath } from '@/tools/registry';
import { getCategory } from '@/tools/categories';
import {
  clearHistory,
  favoritesStore,
  pinnedStore,
  useFavorites,
  usePinned,
  useRecentSearches,
  useRecentTools,
  useUsage,
} from '@/lib/userPrefs';
import { ToolGrid } from '@/components/ToolCard';
import { ToolIcon } from '@/components/ToolIcon';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Link } from 'react-router';
import { openPalette } from '../paletteStore';
import { useDocumentTitle } from '../useDocumentTitle';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

export function FavoritesPage() {
  useDocumentTitle('Favorites & history');
  const favorites = resolveTools(useFavorites());
  const pinned = resolveTools(usePinned());
  const recent = resolveTools(useRecentTools());
  const searches = useRecentSearches();
  const usage = useUsage();
  const [confirm, setConfirm] = useState(false);

  const mostUsed = resolveTools(Object.keys(usage))
    .map((tool) => ({ tool, ...usage[tool.id] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-8 pb-16 sm:px-6 lg:px-8">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">Favorites &amp; history</h1>
      <p className="mt-1 text-[14px] text-fg-secondary">Stored only in this browser. Star a tool to favorite it; pin it to keep it in the sidebar.</p>

      <div className="mt-8 flex flex-col gap-8">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Pin size={15} aria-hidden /> Pinned
            </h2>
            {pinned.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => pinnedStore.reset()}>
                Unpin all
              </Button>
            )}
          </div>
          {pinned.length ? (
            <ToolGrid tools={pinned} />
          ) : (
            <p className="text-[13px] text-fg-muted">Use the pin button on any tool page to keep it one click away in the sidebar.</p>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Star size={15} aria-hidden /> Favorites
            </h2>
            {favorites.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => favoritesStore.reset()}>
                Clear favorites
              </Button>
            )}
          </div>
          {favorites.length ? (
            <ToolGrid tools={favorites} />
          ) : (
            <Panel>
              <EmptyState
                icon={Star}
                title="No favorites yet"
                action={
                  <Button variant="secondary" onClick={() => openPalette()}>
                    Find a tool
                  </Button>
                }
              >
                Star tools you use often and they will appear here and at the top of the home page.
              </EmptyState>
            </Panel>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Most used"
            actions={
              (recent.length > 0 || searches.length > 0) && (
                <Button size="sm" variant="ghost" icon={Trash} onClick={() => setConfirm(true)}>
                  Clear history
                </Button>
              )
            }
            bodyClassName="p-2"
          >
            {mostUsed.length ? (
              <ol>
                {mostUsed.map(({ tool, count, lastUsed }) => (
                  <li key={tool.id}>
                    <Link to={toolPath(tool)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover">
                      <ToolIcon icon={tool.icon} hue={getCategory(tool.category).hue} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{tool.name}</span>
                      <span className="text-[12px] text-fg-muted tabular-nums">
                        {count}× · {relativeTime(lastUsed)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={History} title="No usage yet">
                Tools you open are counted here, on this device only.
              </EmptyState>
            )}
          </Panel>
          <Panel title="Recent searches" bodyClassName="p-2">
            {searches.length ? (
              <ul>
                {searches.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => openPalette(s)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] text-fg hover:bg-surface-hover"
                    >
                      <History size={15} aria-hidden className="text-fg-muted" />
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={History} title="No recent searches">
                Searches you open a tool from are remembered here. You can turn this off in Settings.
              </EmptyState>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Clear history?"
        confirmLabel="Clear history"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          clearHistory();
          setConfirm(false);
        }}
      >
        Recently used tools, usage counts and recent searches will be removed. Favorites and pins are kept.
      </ConfirmDialog>
    </div>
  );
}
