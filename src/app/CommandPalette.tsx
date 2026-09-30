import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  CalendarClock,
  Clock,
  CornerDownLeft,
  Eraser,
  FingerprintPattern as Fingerprint,
  History,
  KeyRound,
  LayoutGrid,
  Languages,
  Monitor,
  Moon,
  Search,
  Settings,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { closePalette, getPaletteInitialQuery, usePaletteOpen } from './paletteStore';
import { PALETTE_SUGGESTED_TOOL_IDS } from './paletteSuggestions';
import { toast } from '@/components/ui/Toast';
import { cn, copyText } from '@/lib/utils';

/** Copies a generated value and confirms it without leaving the keyboard flow. */
async function copyAndConfirm(value: string, message: string) {
  if (await copyText(value)) toast(message);
  else toast(t('The clipboard is not available here. Open the matching tool to copy it manually.'), 'error');
}
import { preloadTool, resolveTools, searchTools, toolPath, TOOLS } from '@/tools/registry';
import { getCategory } from '@/tools/categories';
import type { ToolDefinition } from '@/tools/types';
import { clearHistory, recordSearch, useFavorites, usePinned, useRecentSearches, useRecentTools } from '@/lib/userPrefs';
import { setThemePreference, useTheme } from '@/lib/theme';
import { normalize } from '@/lib/search';
import { ToolIcon } from '@/components/ToolIcon';
import { Kbd } from '@/components/ui/Panel';
import { getLocale, LOCALES, setLocale, t } from '@/lib/i18n';

/** Read when the palette renders: this module loads before the language does. */
const otherLocale = () => LOCALES.find((option) => option.id !== getLocale()) ?? LOCALES[0];

interface ActionItem {
  kind: 'action';
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}
interface ToolItem {
  kind: 'tool';
  id: string;
  tool: ToolDefinition;
}
interface QueryItem {
  kind: 'query';
  id: string;
  query: string;
}
type Item = ActionItem | ToolItem | QueryItem;
interface Group {
  title: string;
  items: Item[];
}

const toolItem = (tool: ToolDefinition): ToolItem => ({ kind: 'tool', id: `tool:${tool.id}`, tool });

export function CommandPalette() {
  const open = usePaletteOpen();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      const target = returnFocus.current;
      if (target && document.contains(target)) target.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={t('Command palette')}
      onCancel={(e) => {
        e.preventDefault();
        closePalette();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) closePalette();
      }}
      className="mx-auto mt-[8vh] mb-auto w-[calc(100%-24px)] max-w-[640px] overflow-hidden rounded-xl border border-line-strong bg-surface-raised p-0 text-fg shadow-popover backdrop:bg-overlay open:[animation:lk-pop-in_140ms_ease-out] sm:mt-[12vh]"
    >
      {open && <PaletteBody />}
    </dialog>
  );
}

function PaletteBody() {
  const navigate = useNavigate();
  const [query, setQuery] = useState(getPaletteInitialQuery);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pinned = usePinned();
  const favorites = useFavorites();
  const recent = useRecentTools();
  const recentSearches = useRecentSearches();
  const { resolved } = useTheme();

  const actions = useMemo<ActionItem[]>(
    () => [
      {
        kind: 'action',
        id: 'action:theme-toggle',
        label: resolved === 'dark' ? t('Switch to light theme') : t('Switch to dark theme'),
        icon: resolved === 'dark' ? Sun : Moon,
        keywords: 'theme dark light mode appearance toggle',
        run: () => setThemePreference(resolved === 'dark' ? 'light' : 'dark'),
      },
      {
        kind: 'action',
        id: 'action:theme-system',
        label: t('Use system theme'),
        icon: Monitor,
        keywords: 'theme system auto appearance',
        run: () => setThemePreference('system'),
      },
      {
        kind: 'action',
        id: 'action:language',
        label: t('Switch language to {language}', { language: otherLocale().label }),
        icon: Languages,
        keywords: 'language locale ngon ngu tieng viet vietnamese english',
        run: () => setLocale(otherLocale().id),
      },
      {
        kind: 'action',
        id: 'action:all-tools',
        label: t('Browse all tools'),
        icon: LayoutGrid,
        keywords: 'all tools browse categories list',
        run: () => navigate('/tools'),
      },
      {
        kind: 'action',
        id: 'action:favorites',
        label: t('Favorites & history'),
        icon: Star,
        keywords: 'favorites starred pinned recent history',
        run: () => navigate('/favorites'),
      },
      {
        kind: 'action',
        id: 'action:settings',
        label: t('Settings, backup & restore'),
        icon: Settings,
        keywords: 'settings preferences backup export import restore data clear',
        run: () => navigate('/settings'),
      },
      {
        kind: 'action',
        id: 'action:copy-uuid',
        label: t('Copy a new UUID'),
        icon: Fingerprint,
        keywords: 'uuid guid v4 generate new random id copy',
        run: () => {
          const value = crypto.randomUUID();
          void copyAndConfirm(value, t('Copied {value}', { value }));
        },
      },
      {
        kind: 'action',
        id: 'action:copy-unix',
        label: t('Copy the current Unix timestamp'),
        icon: Clock,
        keywords: 'unix epoch timestamp now current time seconds copy',
        run: () => {
          const value = String(Math.floor(Date.now() / 1000));
          void copyAndConfirm(value, t('Copied {value}', { value }));
        },
      },
      {
        kind: 'action',
        id: 'action:copy-iso',
        label: t('Copy the current time (ISO 8601)'),
        icon: CalendarClock,
        keywords: 'iso 8601 date time now current timestamp utc copy',
        run: () => {
          const value = new Date().toISOString();
          void copyAndConfirm(value, t('Copied {value}', { value }));
        },
      },
      {
        kind: 'action',
        id: 'action:copy-password',
        label: t('Copy a strong random password'),
        icon: KeyRound,
        keywords: 'password generate random secure strong passphrase copy',
        run: () => {
          // Loaded on demand: tool modules load after the interface language, never with the shell.
          void import('@/tools/generators/lib/randomString').then(({ buildAlphabet, generateStrings }) => {
            const alphabet = buildAlphabet('alnumSymbols', '', true);
            if (!alphabet.ok) return;
            const [value] = generateStrings(alphabet.alphabet, 20, 1);
            // Never echo the password itself on screen.
            if (value) void copyAndConfirm(value, t('Copied a 20-character password'));
          });
        },
      },
      {
        kind: 'action',
        id: 'action:clear-history',
        label: t('Clear recent tools and searches'),
        icon: Eraser,
        keywords: 'clear history recent searches usage reset forget',
        run: () => {
          clearHistory();
          toast(t('Recent tools and searches cleared'));
        },
      },
    ],
    [navigate, resolved],
  );

  const groups = useMemo<Group[]>(() => {
    const q = query.trim();
    if (!q) {
      const result: Group[] = [];
      const pinnedTools = resolveTools(pinned);
      if (pinnedTools.length) result.push({ title: t('Pinned'), items: pinnedTools.map(toolItem) });
      const recentTools = resolveTools(recent).filter((tool) => !pinned.includes(tool.id)).slice(0, 6);
      if (recentTools.length) result.push({ title: t('Recently used'), items: recentTools.map(toolItem) });
      const favTools = resolveTools(favorites)
        .filter((tool) => !pinned.includes(tool.id) && !recentTools.includes(tool))
        .slice(0, 6);
      if (favTools.length) result.push({ title: t('Favorites'), items: favTools.map(toolItem) });
      if (recentSearches.length)
        result.push({
          title: t('Recent searches'),
          items: recentSearches.slice(0, 4).map((s) => ({ kind: 'query', id: `query:${s}`, query: s })),
        });
      if (result.length === 0) {
        const suggestions = PALETTE_SUGGESTED_TOOL_IDS.map((id) => TOOLS.find((tool) => tool.id === id)).filter(
          (tool): tool is ToolDefinition => Boolean(tool),
        );
        const fallback = suggestions.length ? suggestions : TOOLS.slice(0, 6);
        result.push({ title: t('Suggestions'), items: fallback.map(toolItem) });
      }
      result.push({ title: t('Quick actions'), items: actions });
      return result;
    }
    const tools = searchTools(q, 30).map((r) => toolItem(r.item));
    const nq = normalize(q);
    const matchingActions = actions.filter((a) =>
      nq.split(' ').every((w) => normalize(`${a.label} ${a.keywords}`).includes(w)),
    );
    const result: Group[] = [];
    if (tools.length) result.push({ title: t('Tools'), items: tools });
    if (matchingActions.length) result.push({ title: t('Actions'), items: matchingActions });
    return result;
  }, [query, pinned, recent, favorites, recentSearches, actions]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    const item = flat[active];
    if (item?.kind === 'tool') preloadTool(item.tool);
  }, [active, flat]);

  function select(item: Item | undefined) {
    if (!item) return;
    if (item.kind === 'query') {
      setQuery(item.query);
      return;
    }
    if (query.trim()) recordSearch(query);
    closePalette();
    if (item.kind === 'tool') navigate(toolPath(item.tool));
    else item.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const count = flat.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (count) setActive((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) setActive((i) => (i - 1 + count) % count);
    } else if (event.key === 'Home' && event.ctrlKey) {
      setActive(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      setActive(Math.max(0, count - 1));
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      setActive((i) => Math.min(count - 1, i + 8));
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 8));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(flat[active]);
    }
  }

  let index = -1;
  const activeId = flat[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="flex max-h-[min(640px,80dvh)] flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={18} className="shrink-0 text-fg-muted" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search tools and actions…')}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={t('Search tools and actions')}
          spellCheck={false}
          autoComplete="off"
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
        />
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label={t('Results')} className="min-h-0 flex-1 overflow-y-auto p-2">
        {flat.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-fg">{t('No tools match “{query}”', { query: query.trim() })}</p>
            <p className="mt-1 text-[13px] text-fg-muted">{t('Try a format (csv, pdf, png) or an action (merge, decode, compress).')}</p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title} className="mb-1 last:mb-0">
            <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-fg-muted uppercase">
              {group.title}
            </div>
            {group.items.map((item) => {
              index++;
              const i = index;
              return (
                <PaletteRow
                  key={item.id}
                  id={`${listId}-${i}`}
                  index={i}
                  item={item}
                  active={i === active}
                  onHover={() => setActive(i)}
                  onSelect={() => select(item)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-[12px] text-fg-muted sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>{' '}{t('navigate')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>
            <CornerDownLeft size={11} aria-hidden />
          </Kbd>{' '}{t('open')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>{' '}{t('close')}
        </span>
        <span className="ml-auto">{t('{count} tools, all running locally', { count: TOOLS.length })}</span>
      </div>
    </div>
  );
}

function PaletteRow({
  id,
  index,
  item,
  active,
  onHover,
  onSelect,
}: {
  id: string;
  index: number;
  item: Item;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  let icon: ReactNode;
  let title: string;
  let subtitle: string | undefined;
  let meta: ReactNode = null;
  if (item.kind === 'tool') {
    const category = getCategory(item.tool.category);
    icon = <ToolIcon icon={item.tool.icon} hue={category.hue} size="sm" />;
    title = t(item.tool.name);
    subtitle = t(item.tool.description);
    meta = <span className="hidden text-[12px] text-fg-muted sm:inline">{t(category.name)}</span>;
  } else if (item.kind === 'action') {
    const Icon = item.icon;
    icon = (
      <span className="flex size-7 items-center justify-center rounded-md border border-line bg-surface text-fg-secondary">
        <Icon size={15} aria-hidden />
      </span>
    );
    title = item.label;
  } else {
    icon = (
      <span className="flex size-7 items-center justify-center rounded-md text-fg-muted">
        <History size={15} aria-hidden />
      </span>
    );
    title = item.query;
  }
  return (
    <div
      id={id}
      data-index={index}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 select-none',
        active ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-fg">{title}</div>
        {subtitle && <div className="truncate text-[12.5px] text-fg-muted">{subtitle}</div>}
      </div>
      {meta}
      <ArrowRight size={15} aria-hidden className={cn('shrink-0 text-fg-muted', active ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}
