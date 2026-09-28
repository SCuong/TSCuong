import { useSyncExternalStore } from 'react';

export const STORAGE_PREFIX = 'localkit:';

/** Safe localStorage access: private browsing, disabled storage and quota errors never throw. */
export function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_PREFIX + key);
    else window.localStorage.setItem(STORAGE_PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export function listLocalKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key.slice(STORAGE_PREFIX.length));
    }
    return keys;
  } catch {
    return [];
  }
}

interface Envelope<T> {
  v: number;
  data: T;
}

export interface PersistentStoreOptions<T> {
  /** Key without the `localkit:` prefix. */
  key: string;
  /** Schema version. Bump it and provide `migrate` whenever the stored shape changes. */
  version: number;
  defaultValue: T;
  /** Upgrade data written by an older version. Return `undefined` to fall back to the default. */
  migrate?: (data: unknown, fromVersion: number) => T | undefined;
  /** Reject structurally invalid data (e.g. manual edits or corruption). */
  validate?: (data: unknown) => data is T;
}

export interface PersistentStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
  /** Re-read from storage (used after imports and cross-tab changes). */
  reload(): void;
  readonly key: string;
}

/**
 * A tiny versioned store persisted in localStorage.
 *
 * Only meant for small, frequently read state (theme, favorites, recents).
 * Larger documents belong in IndexedDB (see `db.ts`).
 */
export function createPersistentStore<T>(options: PersistentStoreOptions<T>): PersistentStore<T> {
  const { key, version, defaultValue, migrate, validate } = options;
  const listeners = new Set<() => void>();
  let state: T = load();

  function load(): T {
    const raw = readRaw(key);
    if (raw === null) return defaultValue;
    try {
      const parsed = JSON.parse(raw) as Partial<Envelope<unknown>>;
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.v !== 'number') return defaultValue;
      let data: unknown = parsed.data;
      if (parsed.v !== version) {
        if (!migrate || parsed.v > version) return defaultValue;
        const migrated = migrate(data, parsed.v);
        if (migrated === undefined) return defaultValue;
        data = migrated;
        persist(migrated as T);
      }
      if (validate && !validate(data)) return defaultValue;
      return data as T;
    } catch {
      return defaultValue;
    }
  }

  function persist(value: T) {
    writeRaw(key, JSON.stringify({ v: version, data: value } satisfies Envelope<T>));
  }

  function emit() {
    for (const listener of listeners) listener();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_PREFIX + key) {
        state = load();
        emit();
      }
    });
  }

  return {
    key,
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      persist(value);
      emit();
    },
    reset() {
      state = defaultValue;
      writeRaw(key, null);
      emit();
    },
    reload() {
      state = load();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: PersistentStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useStoreSelector<T, S>(store: PersistentStore<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
