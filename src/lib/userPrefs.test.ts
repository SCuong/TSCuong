import { beforeEach, describe, expect, it } from 'vitest';
import {
  favoritesStore,
  recentSearchesStore,
  recentToolsStore,
  recordSearch,
  recordToolVisit,
  settingsStore,
  toggleFavorite,
  usageStore,
} from './userPrefs';
import { createPersistentStore } from './storage/local';

beforeEach(() => {
  for (const s of [favoritesStore, recentToolsStore, recentSearchesStore, usageStore, settingsStore]) s.reset();
});

describe('user preferences', () => {
  it('toggles favorites and persists them', () => {
    toggleFavorite('a');
    toggleFavorite('b');
    toggleFavorite('a');
    expect(favoritesStore.get()).toEqual(['b']);
    expect(JSON.parse(localStorage.getItem('localkit:favorites')!)).toEqual({ v: 1, data: ['b'] });
  });

  it('keeps recent tools unique, most recent first, capped', () => {
    for (let i = 0; i < 20; i++) recordToolVisit(`t${i}`);
    recordToolVisit('t5');
    const recent = recentToolsStore.get();
    expect(recent[0]).toBe('t5');
    expect(recent.length).toBe(12);
    expect(new Set(recent).size).toBe(recent.length);
    expect(usageStore.get().t5.count).toBe(2);
  });

  it('records searches case-insensitively unique and honors the setting', () => {
    recordSearch('JSON');
    recordSearch('json');
    recordSearch('x');
    expect(recentSearchesStore.get()).toEqual(['json']);
    settingsStore.set((s) => ({ ...s, recordSearchHistory: false }));
    recordSearch('pdf merge');
    expect(recentSearchesStore.get()).toEqual(['json']);
  });
});

describe('createPersistentStore', () => {
  it('falls back to the default on corrupt data', () => {
    localStorage.setItem('localkit:corrupt', '{not json');
    const store = createPersistentStore({ key: 'corrupt', version: 1, defaultValue: [1] });
    expect(store.get()).toEqual([1]);
  });

  it('migrates older versions', () => {
    localStorage.setItem('localkit:migrate', JSON.stringify({ v: 1, data: 'a,b' }));
    const store = createPersistentStore<string[]>({
      key: 'migrate',
      version: 2,
      defaultValue: [],
      migrate: (data, from) => (from === 1 && typeof data === 'string' ? data.split(',') : undefined),
    });
    expect(store.get()).toEqual(['a', 'b']);
    expect(JSON.parse(localStorage.getItem('localkit:migrate')!).v).toBe(2);
  });

  it('ignores data from a newer version instead of corrupting it', () => {
    localStorage.setItem('localkit:future', JSON.stringify({ v: 9, data: 'x' }));
    const store = createPersistentStore({ key: 'future', version: 1, defaultValue: 'default' });
    expect(store.get()).toBe('default');
  });

  it('rejects invalid shapes via validate', () => {
    localStorage.setItem('localkit:shape', JSON.stringify({ v: 1, data: 42 }));
    const store = createPersistentStore<string[]>({
      key: 'shape',
      version: 1,
      defaultValue: [],
      validate: (v): v is string[] => Array.isArray(v),
    });
    expect(store.get()).toEqual([]);
  });
});
