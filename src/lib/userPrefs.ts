import { createPersistentStore, isStringArray, useStore } from './storage/local';

/**
 * Small, frequently read user state: favorites, pins, recents, usage and
 * search history. Kept in localStorage (versioned) so the home page and the
 * command palette can render synchronously on first paint.
 */

const MAX_RECENT_TOOLS = 12;
const MAX_RECENT_SEARCHES = 8;

export const favoritesStore = createPersistentStore<string[]>({
  key: 'favorites',
  version: 1,
  defaultValue: [],
  validate: isStringArray,
});

export const pinnedStore = createPersistentStore<string[]>({
  key: 'pinned',
  version: 1,
  defaultValue: [],
  validate: isStringArray,
});

export const recentToolsStore = createPersistentStore<string[]>({
  key: 'recent-tools',
  version: 1,
  defaultValue: [],
  validate: isStringArray,
});

export const recentSearchesStore = createPersistentStore<string[]>({
  key: 'recent-searches',
  version: 1,
  defaultValue: [],
  validate: isStringArray,
});

export interface UsageEntry {
  count: number;
  lastUsed: number;
}

export type UsageMap = Record<string, UsageEntry>;

const isUsageMap = (value: unknown): value is UsageMap =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as UsageEntry).count === 'number' &&
      typeof (entry as UsageEntry).lastUsed === 'number',
  );

export const usageStore = createPersistentStore<UsageMap>({
  key: 'usage',
  version: 1,
  defaultValue: {},
  validate: isUsageMap,
});

export interface AppSettings {
  /** Remember the text typed into simple tools between visits. */
  rememberToolInput: boolean;
  /** Record searches in the recent-searches list. */
  recordSearchHistory: boolean;
}

export const settingsStore = createPersistentStore<AppSettings>({
  key: 'settings',
  version: 1,
  defaultValue: { rememberToolInput: true, recordSearchHistory: true },
  validate: (v): v is AppSettings =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as AppSettings).rememberToolInput === 'boolean' &&
    typeof (v as AppSettings).recordSearchHistory === 'boolean',
});

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function toggleFavorite(id: string) {
  favoritesStore.set((list) => toggleIn(list, id));
}

export function togglePinned(id: string) {
  pinnedStore.set((list) => toggleIn(list, id));
}

export function recordToolVisit(id: string, now = Date.now()) {
  recentToolsStore.set((list) => [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT_TOOLS));
  usageStore.set((map) => ({
    ...map,
    [id]: { count: (map[id]?.count ?? 0) + 1, lastUsed: now },
  }));
}

export function recordSearch(query: string) {
  const q = query.trim();
  if (q.length < 2 || !settingsStore.get().recordSearchHistory) return;
  recentSearchesStore.set((list) =>
    [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES),
  );
}

export function clearHistory() {
  recentToolsStore.reset();
  recentSearchesStore.reset();
  usageStore.reset();
}

export const useFavorites = () => useStore(favoritesStore);
export const usePinned = () => useStore(pinnedStore);
export const useRecentTools = () => useStore(recentToolsStore);
export const useRecentSearches = () => useStore(recentSearchesStore);
export const useUsage = () => useStore(usageStore);
export const useSettings = () => useStore(settingsStore);

/** Every localStorage-backed store, used by backup export/import. */
export const ALL_LOCAL_STORES = [
  favoritesStore,
  pinnedStore,
  recentToolsStore,
  recentSearchesStore,
  usageStore,
  settingsStore,
];
