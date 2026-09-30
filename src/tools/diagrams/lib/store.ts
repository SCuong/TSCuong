import type { Collection, Identified } from '@/lib/storage/db';

type Versioned = Identified & { updatedAt: number };

const chains = new WeakMap<object, Promise<unknown>>();

/**
 * Runs `task` after every earlier task queued for the same collection, so
 * read-modify-write sequences on that collection never interleave.
 */
export function serialize<R>(coll: object, task: () => Promise<R>): Promise<R> {
  const previous = chains.get(coll) ?? Promise.resolve();
  const result = previous.then(task, task);
  chains.set(
    coll,
    result.catch(() => undefined),
  );
  return result;
}

/** A timestamp strictly newer than `previous`, so every write is ordered even within one millisecond. */
export function nextVersion(previous: number, now: number = Date.now()): number {
  return Math.max(now, previous + 1);
}

/**
 * Merges `patch` into the stored record. Writes to the same collection are
 * serialized and always read the latest stored version first, so concurrent
 * edits (e.g. an autosave and a rename) never overwrite each other.
 * `touch: false` keeps `updatedAt` (for changes that are not edits, like starring).
 * Resolves to the saved record, or null when the record no longer exists.
 */
export function patchRecord<T extends Versioned>(
  coll: Collection<T>,
  id: string,
  patch: Partial<Omit<T, 'id'>>,
  now: () => number = Date.now,
  options: { touch?: boolean } = {},
): Promise<T | null> {
  return serialize(coll, async () => {
    const current = await coll.get(id);
    if (!current) return null;
    const updatedAt = options.touch === false ? current.updatedAt : nextVersion(current.updatedAt, now());
    const next = { ...current, ...patch, id, updatedAt } as T;
    await coll.put(next);
    return next;
  });
}

/** Deletes a record after any queued writes to it, so a pending autosave cannot bring it back. */
export function removeRecord(coll: Collection<Versioned>, id: string): Promise<void> {
  return serialize(coll, () => coll.remove(id));
}

/** Equality for stored field values: primitives by value, arrays (e.g. tags) element-wise. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

export interface AutosaveOptions<T extends Versioned, K extends keyof T> {
  coll: Collection<T>;
  /** The stored record when editing started. */
  initial: T;
  /** Latest values of the fields this editor owns (read at the moment each write is issued). */
  read: () => Pick<T, K>;
  /** The main text field: concurrent changes to it from elsewhere are preserved instead of overwritten. */
  conflictField: K;
  /**
   * Called before this editor overwrites a version of `conflictField` that was saved somewhere else
   * (another tab) after this editor last saw the record. Persist `theirs` (e.g. as a copy) here.
   */
  onConflict: (theirs: T) => Promise<void>;
  now?: () => number;
}

/**
 * Autosave for one open record (a note, a diagram).
 *
 * - Each write carries the editor's latest values, so a slow save can never
 *   store older text than a later one.
 * - {@link save} reads the stored record first: when another tab changed the
 *   main text since this editor last saw it, `onConflict` keeps that version.
 * - {@link saveNow} issues the write synchronously, for `pagehide` and
 *   `visibilitychange`: an IndexedDB request started later (after an await)
 *   never runs once the page is unloading, which used to lose the last edits.
 * - {@link observe} applies newer versions saved elsewhere to the fields this
 *   editor has not changed.
 */
export class AutosaveSession<T extends Versioned, K extends keyof T> {
  private base: T;
  private readonly dirty = new Set<K>();
  private seq = 0;
  private readonly opts: AutosaveOptions<T, K>;

  constructor(opts: AutosaveOptions<T, K>) {
    this.opts = opts;
    this.base = opts.initial;
  }

  /** The newest version this editor knows is stored (written by it or observed). */
  get stored(): T {
    return this.base;
  }

  get pending(): boolean {
    return this.dirty.size > 0;
  }

  markDirty(keys: Iterable<K>) {
    for (const key of keys) this.dirty.add(key);
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private take(): { keys: K[]; values: Partial<T> } {
    const keys = [...this.dirty];
    this.dirty.clear();
    const latest = this.opts.read();
    const values: Partial<T> = {};
    for (const key of keys) values[key] = latest[key];
    return { keys, values };
  }

  private restore(keys: K[]) {
    for (const key of keys) this.dirty.add(key);
  }

  /**
   * Saves pending changes after earlier queued writes. Resolves to the stored
   * record, or null when it was deleted meanwhile (pending changes are dropped).
   */
  save(): Promise<T | null> {
    const { coll, conflictField, onConflict } = this.opts;
    return serialize(coll, async () => {
      for (let attempt = 0; ; attempt++) {
        if (this.dirty.size === 0) return this.base;
        const seq = this.seq;
        const current = await coll.get(this.base.id);
        if (!current) {
          this.dirty.clear();
          return null;
        }
        // A synchronous save ran while we were reading: read again so it is not mistaken for someone else's.
        if (seq !== this.seq && attempt < 3) continue;
        if (this.dirty.size === 0) return this.base;
        if (
          this.dirty.has(conflictField) &&
          current[conflictField] !== this.base[conflictField] &&
          current[conflictField] !== this.opts.read()[conflictField]
        ) {
          await onConflict(current);
        }
        const { keys, values } = this.take();
        const next = { ...current, ...values, id: current.id, updatedAt: nextVersion(current.updatedAt, this.now()) } as T;
        const previous = this.base;
        this.base = next;
        this.seq++;
        try {
          await coll.put(next);
        } catch (error) {
          this.base = previous;
          this.restore(keys);
          throw error;
        }
        return next;
      }
    });
  }

  /**
   * Writes pending changes right away, without reading first (the page may be
   * unloading). Returns the write so callers can report failures.
   */
  saveNow(): Promise<void> | null {
    if (this.dirty.size === 0) return null;
    const { keys, values } = this.take();
    const previous = this.base;
    const next = { ...previous, ...values, updatedAt: nextVersion(previous.updatedAt, this.now()) } as T;
    this.base = next;
    this.seq++;
    return this.opts.coll.put(next).catch((error: unknown) => {
      if (this.base === next) this.base = previous;
      this.restore(keys);
      throw error;
    });
  }

  /**
   * Feeds the latest stored record (e.g. from a collection refresh). Returns
   * the owned fields changed elsewhere that the editor should adopt (it has no
   * unsaved changes to them), or null when there is nothing newer.
   */
  observe(stored: T): Partial<Pick<T, K>> | null {
    if (stored.updatedAt <= this.base.updatedAt) return null;
    const previous = this.base;
    const adopt: Partial<Pick<T, K>> = {};
    const latest = this.opts.read();
    let changed = false;
    for (const key of Object.keys(latest) as K[]) {
      if (this.dirty.has(key) || sameValue(stored[key], previous[key])) continue;
      adopt[key] = stored[key];
      changed = true;
    }
    // Keep the old value of a field with unsaved edits: the next save compares against it to detect the conflict.
    const next = { ...stored } as T;
    for (const key of this.dirty) next[key] = previous[key];
    this.base = next;
    return changed ? adopt : null;
  }
}
