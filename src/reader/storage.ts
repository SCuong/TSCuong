import { openDB, type DBSchema } from 'idb';
import type { PdfDraft } from './annotations';

export const CACHE_LIMIT = { count: 20, bytes: 500 * 1024 * 1024 };

export interface ReaderDocument {
  id: string;
  name: string;
  size: number;
  pages: number;
  lastOpened: number;
  /** Older libraries fall back to lastOpened until their next import. */
  addedAt?: number;
  page: number;
  offset: number;
  favorite: boolean;
  bookmarks: number[];
  cached: boolean;
}
interface ReaderDB extends DBSchema {
  documents: { key: string; value: ReaderDocument };
  edits: { key: string; value: PdfDraft };
  thumbnails: { key: string; value: { id: string; blob: Blob } };
}
export interface ReaderStorageAdapter {
  list(): Promise<ReaderDocument[]>;
  get(id: string): Promise<ReaderDocument | undefined>;
  put(record: ReaderDocument): Promise<void>;
  remove(id: string): Promise<void>;
  writeFile(id: string, file: File): Promise<void>;
  readFile(id: string): Promise<File>;
  deleteFile(id: string): Promise<void>;
}

/** Decide before deleting anything: favorites can never be victims. */
export function cachePlan(records: ReaderDocument[], incoming: { id: string; size: number }, limit = CACHE_LIMIT) {
  const cached = records.filter((r) => r.cached && r.id !== incoming.id);
  let count = cached.length + 1;
  let bytes = cached.reduce((sum, r) => sum + r.size, incoming.size);
  const victims: string[] = [];
  for (const r of cached.filter((r) => !r.favorite).sort((a, b) => a.lastOpened - b.lastOpened)) {
    if (count <= limit.count && bytes <= limit.bytes) break;
    victims.push(r.id);
    count--;
    bytes -= r.size;
  }
  return { allowed: count <= limit.count && bytes <= limit.bytes, victims };
}

export function createReaderRepository(adapter: ReaderStorageAdapter, lock: <T>(job: () => Promise<T>) => Promise<T>) {
  return {
    list: () => adapter.list(),
    readFile: (id: string) => adapter.readFile(id),
    remember: (record: ReaderDocument, file: File) =>
      lock(async () => {
        const old = await adapter.get(record.id);
        const next = {
          ...record,
          ...(old
            ? {
                page: old.page,
                offset: old.offset,
                favorite: old.favorite,
                bookmarks: old.bookmarks,
                cached: old.cached,
                addedAt: old.addedAt ?? old.lastOpened,
              }
            : {}),
        };
        let warning: 'limit' | 'storage' | undefined;
        let wroteFile = false;
        if (!next.cached) {
          const records = await adapter.list();
          const plan = cachePlan(records, next);
          if (!plan.allowed) warning = 'limit';
          else {
            try {
              // Delete before writing so the hard byte/count limits are never exceeded.
              for (const id of plan.victims) {
                await adapter.deleteFile(id);
                const victim = await adapter.get(id);
                if (victim) await adapter.put({ ...victim, cached: false });
              }
              await adapter.writeFile(next.id, file);
              wroteFile = true;
              next.cached = true;
            } catch {
              warning = 'storage';
            }
          }
        }
        try {
          await adapter.put(next);
        } catch (error) {
          // A metadata failure must not leave an unaccounted binary copy in the bounded cache.
          if (wroteFile) await adapter.deleteFile(next.id).catch(() => {});
          throw error;
        }
        return { record: next, warning };
      }),
    patch: (
      id: string,
      patch: Partial<Pick<ReaderDocument, 'favorite' | 'bookmarks' | 'page' | 'offset' | 'cached' | 'lastOpened'>>,
    ) =>
      lock(async () => {
        const old = await adapter.get(id);
        if (!old) return;
        const next = { ...old, ...patch };
        await adapter.put(next);
        return next;
      }),
    remove: (id: string) =>
      lock(async () => {
        await adapter.deleteFile(id);
        await adapter.remove(id);
      }),
    clearCache: () =>
      lock(async () => {
        for (const r of await adapter.list()) {
          if (!r.cached || r.favorite) continue;
          await adapter.deleteFile(r.id);
          await adapter.put({ ...r, cached: false });
        }
      }),
  };
}

let database: ReturnType<typeof openDB<ReaderDB>> | undefined;
function db() {
  database ??= openDB<ReaderDB>('localkit-reader', 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('edits')) db.createObjectStore('edits', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' });
    },
  });
  return database;
}
async function directory() {
  return (await navigator.storage.getDirectory()).getDirectoryHandle('reader-files', { create: true });
}
async function deleteIfPresent(id: string) {
  if (!navigator.storage?.getDirectory) return;
  try {
    await (await directory()).removeEntry(id + '.pdf');
  } catch (error) {
    if ((error as DOMException).name !== 'NotFoundError') throw error;
  }
}
const adapter: ReaderStorageAdapter = {
  list: async () => (await db()).getAll('documents'),
  get: async (id) => (await db()).get('documents', id),
  put: async (r) => {
    await (await db()).put('documents', r);
  },
  remove: async (id) => {
    const tx = (await db()).transaction(['documents', 'edits', 'thumbnails'], 'readwrite');
    await tx.objectStore('documents').delete(id);
    await tx.objectStore('edits').delete(id);
    await tx.objectStore('thumbnails').delete(id);
    await tx.done;
  },
  writeFile: async (id, file) => {
    const handle = await (await directory()).getFileHandle(id + '.pdf', { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(file);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      await deleteIfPresent(id).catch(() => {});
      throw error;
    }
  },
  readFile: async (id) => (await (await directory()).getFileHandle(id + '.pdf')).getFile(),
  deleteFile: async (id) => { await deleteIfPresent(id); await (await db()).delete('thumbnails', id); },
};
// Serialize in this tab and, where supported, between every LocalKit tab.
let queue: Promise<unknown> = Promise.resolve();
function lock<T>(job: () => Promise<T>): Promise<T> {
  const run = () => (navigator.locks ? navigator.locks.request('localkit-reader-storage', job) : job());
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
export const readerRepository = createReaderRepository(adapter, lock);
export const readerThumbnails = {
  get: async (id: string) => (await (await db()).get('thumbnails', id))?.blob,
  put: (id: string, blob: Blob) => lock(async () => {
    if (blob.size > 200_000) return;
    const tx = (await db()).transaction(['documents', 'thumbnails'], 'readwrite');
    // A deleted/evicted file cannot gain an orphan thumbnail from an in-flight render.
    if ((await tx.objectStore('documents').get(id))?.cached) await tx.objectStore('thumbnails').put({ id, blob });
    await tx.done;
  }),
};
export const pdfDrafts = {
  get: async (id: string) => (await db()).get('edits', id),
  count: async () => (await db()).count('edits'),
  clear: () => lock(async () => { await (await db()).clear('edits'); }),
  put: (draft: PdfDraft) => lock(async () => { await (await db()).put('edits', draft); }),
  patch: (id: string, patch: Partial<Pick<PdfDraft, 'marks' | 'forms'>>) => lock(async () => {
    const database = await db();
    const old = await database.get('edits', id);
    await database.put('edits', { id, marks: [], forms: {}, ...old, ...patch, updated: Date.now() });
  }),
};

export async function fingerprint(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
