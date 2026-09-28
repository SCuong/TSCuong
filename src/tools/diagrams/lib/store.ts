import type { Collection, Identified } from '@/lib/storage/db';

const chains = new WeakMap<object, Promise<unknown>>();

/**
 * Merges `patch` into the stored record and bumps `updatedAt`. Writes to the same
 * collection are serialized and always read the latest stored version first, so
 * concurrent edits (e.g. an autosave and a rename) never overwrite each other.
 * Resolves to the saved record, or null when the record no longer exists.
 */
export function patchRecord<T extends Identified & { updatedAt: number }>(
  coll: Collection<T>,
  id: string,
  patch: Partial<Omit<T, 'id'>>,
  now: () => number = Date.now,
): Promise<T | null> {
  const run = async (): Promise<T | null> => {
    const current = await coll.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id, updatedAt: Math.max(now(), current.updatedAt) } as T;
    await coll.put(next);
    return next;
  };
  const previous = chains.get(coll) ?? Promise.resolve();
  const result = previous.then(run, run);
  chains.set(
    coll,
    result.catch(() => undefined),
  );
  return result;
}
