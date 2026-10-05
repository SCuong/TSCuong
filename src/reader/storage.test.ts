import { describe, expect, it } from 'vitest';
import { cachePlan, createReaderRepository, type ReaderDocument, type ReaderStorageAdapter } from './storage';

function record(id: string, overrides: Partial<ReaderDocument> = {}): ReaderDocument {
  return {
    id,
    name: id + '.pdf',
    size: 10,
    pages: 8,
    page: 1,
    offset: 0,
    bookmarks: [],
    favorite: false,
    lastOpened: 1,
    cached: true,
    ...overrides,
  };
}
function memory(records: ReaderDocument[]) {
  const metadata = new Map(records.map((r) => [r.id, structuredClone(r)]));
  const files = new Map(records.filter((r) => r.cached).map((r) => [r.id, new File(['PDF'], r.name)]));
  const adapter: ReaderStorageAdapter = {
    list: async () => [...metadata.values()].map((r) => structuredClone(r)),
    get: async (id) => (metadata.has(id) ? structuredClone(metadata.get(id)) : undefined),
    put: async (r) => {
      metadata.set(r.id, structuredClone(r));
    },
    remove: async (id) => {
      metadata.delete(id);
    },
    writeFile: async (id, file) => {
      files.set(id, file);
    },
    readFile: async (id) => {
      const file = files.get(id);
      if (!file) throw new Error('Missing');
      return file;
    },
    deleteFile: async (id) => {
      files.delete(id);
    },
  };
  return { metadata, files, adapter, repository: createReaderRepository(adapter, async (job) => job()) };
}
describe('reader cache policy', () => {
  it('evicts by least recent open and never evicts favorites', () => {
    const plan = cachePlan(
      [record('protected', { favorite: true }), record('newer', { lastOpened: 4 }), record('oldest')],
      { id: 'new', size: 15 },
      { count: 3, bytes: 35 },
    );
    expect(plan).toEqual({ allowed: true, victims: ['oldest'] });
  });
  it('refuses caching without deleting anything when favorites fill the budget', () => {
    expect(
      cachePlan([record('favorite', { favorite: true })], { id: 'new', size: 1 }, { count: 1, bytes: 100 }),
    ).toEqual({ allowed: false, victims: [] });
  });
  it('accounts for both byte and count limits and replacements', () => {
    expect(cachePlan([record('same')], { id: 'same', size: 10 }, { count: 1, bytes: 10 })).toEqual({
      allowed: true,
      victims: [],
    });
    expect(cachePlan([], { id: 'huge', size: 101 }, { count: 20, bytes: 100 }).allowed).toBe(false);
    expect(cachePlan([record('a'), record('b')], { id: 'new', size: 1 }, { count: 2, bytes: 100 }).victims).toEqual([
      'a',
    ]);
  });
});
describe('reader repository', () => {
  it('keeps evicted metadata and restores a re-picked fingerprint', async () => {
    const records = Array.from({ length: 20 }, (_, n) =>
      record(String(n), { lastOpened: n + 1, page: 5, offset: 0.45, bookmarks: [2, 5] }),
    );
    const { repository, metadata, files } = memory(records);
    const result = await repository.remember(
      record('incoming', { cached: false, lastOpened: 30 }),
      new File(['new'], 'incoming.pdf'),
    );
    expect(result.record.cached).toBe(true);
    expect(files.has('0')).toBe(false);
    expect(metadata.get('0')).toMatchObject({ cached: false, page: 5, offset: 0.45, bookmarks: [2, 5] });
    const restored = await repository.remember(
      record('0', { cached: false, lastOpened: 31 }),
      new File(['restored'], 'renamed.pdf'),
    );
    expect(restored.record).toMatchObject({ cached: true, page: 5, offset: 0.45, bookmarks: [2, 5] });
    expect(files.size).toBe(20);
  });
  it('does not evict anything if a new file cannot fit beside favorites', async () => {
    const records = Array.from({ length: 20 }, (_, n) => record(String(n), { favorite: true }));
    const { repository, files } = memory(records);
    const result = await repository.remember(record('new', { cached: false }), new File(['PDF'], 'new.pdf'));
    expect(result.warning).toBe('limit');
    expect(result.record.cached).toBe(false);
    expect(files.size).toBe(20);
  });
  it('patches merge with latest metadata instead of overwriting bookmarks or favorites', async () => {
    const { repository, metadata } = memory([record('a')]);
    await repository.patch('a', { favorite: true });
    await repository.patch('a', { bookmarks: [3] });
    await repository.patch('a', { page: 3, offset: 0.4 });
    expect(metadata.get('a')).toMatchObject({ favorite: true, bookmarks: [3], page: 3, offset: 0.4 });
  });
  it('manual removal deletes bytes and metadata; clear cache preserves favorites and position', async () => {
    const { repository, metadata, files } = memory([record('fav', { favorite: true }), record('other', { page: 7 })]);
    await repository.clearCache();
    expect(files.has('fav')).toBe(true);
    expect(files.has('other')).toBe(false);
    expect(metadata.get('other')).toMatchObject({ page: 7, cached: false });
    await repository.remove('fav');
    expect(files.has('fav')).toBe(false);
    expect(metadata.has('fav')).toBe(false);
  });
  it('storage failure still saves metadata and gives an honest non-cached result', async () => {
    const { adapter, metadata } = memory([]);
    adapter.writeFile = async () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
    const repository = createReaderRepository(adapter, async (job) => job());
    expect(await repository.remember(record('new', { cached: false }), new File(['PDF'], 'new.pdf'))).toMatchObject({
      warning: 'storage',
      record: { cached: false },
    });
    expect(metadata.has('new')).toBe(true);
  });
  it('rolls back new bytes when metadata cannot be committed', async () => {
    const { adapter, files } = memory([]);
    adapter.put = async () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
    const repository = createReaderRepository(adapter, async (job) => job());
    await expect(repository.remember(record('new', { cached: false }), new File(['PDF'], 'new.pdf'))).rejects.toThrow();
    expect(files.size).toBe(0);
  });
});
