import { describe, expect, it } from 'vitest';
import {
  deleteItems,
  duplicateItems,
  idsByPosition,
  initialItems,
  insertAfterSelection,
  isUnchanged,
  reverseItems,
  rotateItems,
  toOrganizeItems,
  type PageItem,
} from './organize';

const indices = (items: PageItem[]) => items.map((it) => (it.kind === 'page' ? it.index : 'blank'));

describe('organize operations', () => {
  it('creates the initial list', () => {
    const items = initialItems(3);
    expect(indices(items)).toEqual([0, 1, 2]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect(isUnchanged(items, 3)).toBe(true);
    expect(initialItems(0)).toEqual([]);
  });

  it('rotates selected pages and wraps around', () => {
    const items = initialItems(2);
    const ids = new Set([items[1].id]);
    const once = rotateItems(items, ids, -90);
    expect(once.map((i) => (i.kind === 'page' ? i.rotate : 0))).toEqual([0, 270]);
    expect(rotateItems(once, ids, 90).map((i) => (i.kind === 'page' ? i.rotate : 0))).toEqual([0, 0]);
    expect(isUnchanged(once, 2)).toBe(false);
  });

  it('deletes and duplicates', () => {
    const items = initialItems(3);
    expect(indices(deleteItems(items, new Set([items[0].id, items[2].id])))).toEqual([1]);
    const { items: dup, created } = duplicateItems(items, new Set([items[0].id, items[2].id]));
    expect(indices(dup)).toEqual([0, 0, 1, 2, 2]);
    expect(created).toHaveLength(2);
    expect(new Set(dup.map((i) => i.id)).size).toBe(5);
  });

  it('inserts after the last selected item or at the end', () => {
    const items = initialItems(3);
    const blank: PageItem = { id: 'b', kind: 'blank', width: 10, height: 10 };
    expect(indices(insertAfterSelection(items, new Set([items[0].id]), [blank]))).toEqual([0, 'blank', 1, 2]);
    expect(indices(insertAfterSelection(items, new Set(), [blank]))).toEqual([0, 1, 2, 'blank']);
  });

  it('reverses all pages or only the selected ones in place', () => {
    const items = initialItems(5);
    expect(indices(reverseItems(items))).toEqual([4, 3, 2, 1, 0]);
    expect(indices(reverseItems(items, new Set([items[0].id, items[2].id, items[4].id])))).toEqual([4, 1, 2, 3, 0]);
  });

  it('selects by position', () => {
    const items = initialItems(5);
    expect(idsByPosition(items, 'odd').size).toBe(3);
    expect(idsByPosition(items, 'even').size).toBe(2);
    expect(idsByPosition(items, 'all').size).toBe(5);
  });

  it('converts to worker items', () => {
    const items: PageItem[] = [...initialItems(1), { id: 'b', kind: 'blank', width: 5, height: 6 }];
    expect(toOrganizeItems(items)).toEqual([
      { kind: 'page', source: 0, index: 0, rotate: 0 },
      { kind: 'blank', width: 5, height: 6 },
    ]);
  });
});
