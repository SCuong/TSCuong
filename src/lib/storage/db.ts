import { openDB, type IDBPDatabase } from 'idb';
import { useCallback, useEffect, useState } from 'react';

/**
 * IndexedDB persistence for larger user documents (notes, snippets, API
 * collections, diagrams, file indexes).
 *
 * Schema changes MUST be expressed as a new step in `MIGRATIONS` and a bump of
 * `DB_VERSION`. Steps run in order for every version the user's database is
 * behind, so existing data is upgraded instead of dropped.
 */
export const DB_NAME = 'localkit';
export const DB_VERSION = 1;

export const COLLECTIONS = [
  'notes',
  'snippets',
  'apiRequests',
  'apiCollections',
  'apiEnvironments',
  'apiHistory',
  'diagrams',
  'fileIndexes',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

/** Collections that hold non-serializable data (e.g. file handles) and are excluded from backups. */
export const NON_EXPORTABLE: ReadonlySet<CollectionName> = new Set(['fileIndexes']);

type Migration = (db: IDBPDatabase) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    for (const name of COLLECTIONS) {
      const store = db.createObjectStore(name, { keyPath: 'id' });
      if (name === 'apiHistory') store.createIndex('at', 'at');
      else store.createIndex('updatedAt', 'updatedAt');
    }
    db.createObjectStore('kv');
  },
};

export interface Identified {
  id: string;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;
let fallbackReason: string | null = null;

/** In-memory fallback so the app keeps working (without persistence) when IndexedDB is unavailable. */
const memory = new Map<string, Map<string, unknown>>();
function memoryStore(name: string): Map<string, unknown> {
  let store = memory.get(name);
  if (!store) {
    store = new Map();
    memory.set(name, store);
  }
  return store;
}

export function getDB(): Promise<IDBPDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      if (typeof indexedDB === 'undefined') {
        fallbackReason = 'IndexedDB is not available in this browser.';
        return null;
      }
      try {
        return await openDB(DB_NAME, DB_VERSION, {
          upgrade(db, oldVersion) {
            for (let version = oldVersion + 1; version <= DB_VERSION; version++) {
              MIGRATIONS[version]?.(db);
            }
          },
          blocking() {
            // Another tab needs a newer schema: close so it can upgrade.
            void dbPromise?.then((db) => db?.close());
            dbPromise = null;
          },
        });
      } catch (error) {
        fallbackReason =
          error instanceof Error ? error.message : 'IndexedDB could not be opened (private browsing mode?).';
        return null;
      }
    })();
  }
  return dbPromise;
}

/** Returns a human readable reason when data is only kept in memory. */
export async function getStorageProblem(): Promise<string | null> {
  await getDB();
  return fallbackReason;
}

// ---------------------------------------------------------------------------
// Change notifications (same tab + other tabs)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('localkit-db') : null;

channel?.addEventListener('message', (event: MessageEvent<{ store?: string }>) => {
  if (event.data?.store) notifyLocal(event.data.store);
});

function notifyLocal(store: string) {
  listeners.get(store)?.forEach((listener) => listener());
}

function notify(store: string) {
  notifyLocal(store);
  channel?.postMessage({ store });
}

export function subscribeStore(store: string, listener: Listener): () => void {
  let set = listeners.get(store);
  if (!set) {
    set = new Set();
    listeners.set(store, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface Collection<T extends Identified> {
  readonly name: CollectionName;
  all(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  putMany(items: T[]): Promise<void>;
  remove(id: string): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export function collection<T extends Identified>(name: CollectionName): Collection<T> {
  return {
    name,
    async all() {
      const db = await getDB();
      if (!db) return [...memoryStore(name).values()] as T[];
      return (await db.getAll(name)) as T[];
    },
    async get(id) {
      const db = await getDB();
      if (!db) return memoryStore(name).get(id) as T | undefined;
      return (await db.get(name, id)) as T | undefined;
    },
    async put(item) {
      const db = await getDB();
      if (!db) memoryStore(name).set(item.id, item);
      else await db.put(name, item);
      notify(name);
    },
    async putMany(items) {
      const db = await getDB();
      if (!db) {
        for (const item of items) memoryStore(name).set(item.id, item);
      } else {
        const tx = db.transaction(name, 'readwrite');
        await Promise.all([...items.map((item) => tx.store.put(item)), tx.done]);
      }
      notify(name);
    },
    async remove(id) {
      const db = await getDB();
      if (!db) memoryStore(name).delete(id);
      else await db.delete(name, id);
      notify(name);
    },
    async removeMany(ids) {
      const db = await getDB();
      if (!db) {
        for (const id of ids) memoryStore(name).delete(id);
      } else {
        const tx = db.transaction(name, 'readwrite');
        await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
      }
      notify(name);
    },
    async clear() {
      const db = await getDB();
      if (!db) memoryStore(name).clear();
      else await db.clear(name);
      notify(name);
    },
    subscribe(listener) {
      return subscribeStore(name, listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Key/value store for small blobs of tool state
// ---------------------------------------------------------------------------

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  if (!db) return memoryStore('kv').get(key) as T | undefined;
  return (await db.get('kv', key)) as T | undefined;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await getDB();
  if (!db) memoryStore('kv').set(key, value);
  else await db.put('kv', value, key);
  notify(`kv:${key}`);
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDB();
  if (!db) memoryStore('kv').delete(key);
  else await db.delete('kv', key);
  notify(`kv:${key}`);
}

export async function kvEntries(): Promise<Array<[string, unknown]>> {
  const db = await getDB();
  if (!db) return [...memoryStore('kv').entries()];
  const tx = db.transaction('kv');
  const keys = await tx.store.getAllKeys();
  const values = await tx.store.getAll();
  await tx.done;
  return keys.map((key, i) => [String(key), values[i]]);
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export interface CollectionState<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCollection<T extends Identified>(coll: Collection<T>): CollectionState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => coll.subscribe(refresh), [coll, refresh]);

  useEffect(() => {
    let cancelled = false;
    coll
      .all()
      .then((all) => {
        if (cancelled) return;
        setItems(all);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read local data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coll, version]);

  return { items, loading, error, refresh };
}

export function newId(): string {
  return crypto.randomUUID();
}
