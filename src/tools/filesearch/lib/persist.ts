import { collection, newId } from '@/lib/storage/db';
import type { IndexOptions, IndexSummary, Snapshot } from './protocol';

/**
 * A saved folder index. Stored in the NON_EXPORTABLE `fileIndexes` collection
 * because it can hold a FileSystemDirectoryHandle. File metadata and text are
 * kept as Blobs so listing recent locations stays cheap.
 */
export interface StoredIndex {
  id: string;
  name: string;
  /** 'handle': re-scannable via the File System Access API. 'snapshot': fallback mode, cannot be refreshed. */
  mode: 'handle' | 'snapshot';
  handle?: FileSystemDirectoryHandle;
  createdAt: number;
  updatedAt: number;
  summary: IndexSummary;
  options: IndexOptions;
  meta: Blob;
  content: Blob;
}

export const fileIndexes = collection<StoredIndex>('fileIndexes');

/** Find an existing record for the same folder so re-indexing replaces it instead of piling up duplicates. */
export async function findExisting(handle: FileSystemDirectoryHandle | null, name: string): Promise<StoredIndex | undefined> {
  const all = await fileIndexes.all();
  for (const item of all) {
    if (handle && item.mode === 'handle' && item.handle) {
      try {
        if (await item.handle.isSameEntry(handle)) return item;
      } catch {
        // ignore stale handles
      }
    } else if (!handle && item.mode === 'snapshot' && item.name === name) {
      return item;
    }
  }
  return undefined;
}

export async function saveIndex(args: {
  handle: FileSystemDirectoryHandle | null;
  summary: IndexSummary;
  options: IndexOptions;
  snapshot: Snapshot;
}): Promise<StoredIndex> {
  const existing = await findExisting(args.handle, args.summary.rootName);
  const now = Date.now();
  const record: StoredIndex = {
    id: existing?.id ?? newId(),
    name: args.summary.rootName,
    mode: args.handle ? 'handle' : 'snapshot',
    ...(args.handle ? { handle: args.handle } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    summary: args.summary,
    options: args.options,
    meta: args.snapshot.meta,
    content: args.snapshot.content,
  };
  await fileIndexes.put(record);
  return record;
}
