import { describe, expect, it } from 'vitest';
import { dedupe, rowKey } from './dedupe';

const t = {
  headers: ['email', 'name'],
  rows: [
    ['a@x.com', 'Ada'],
    ['b@x.com', 'Bob'],
    ['a@x.com', 'Ada'],
    ['A@X.com ', 'Ada L.'],
    ['b@x.com', 'Bobby'],
  ],
};

describe('dedupe', () => {
  it('removes duplicate whole rows keeping the first', () => {
    const r = dedupe(t);
    expect(r.table.rows).toEqual([t.rows[0], t.rows[1], t.rows[3], t.rows[4]]);
    expect(r.removedCount).toBe(1);
    expect(r.duplicateGroups).toBe(1);
    expect(r.removed.rows).toEqual([t.rows[2]]);
  });

  it('dedupes by chosen columns and keeps the last occurrence in original order', () => {
    const r = dedupe(t, { columns: [0], keep: 'last' });
    expect(r.table.rows).toEqual([t.rows[2], t.rows[3], t.rows[4]]);
    expect(r.removedCount).toBe(2);
    expect(r.duplicateGroups).toBe(2);
  });

  it('can ignore case and surrounding whitespace', () => {
    const r = dedupe(t, { columns: [0], ignoreCase: true, trim: true });
    expect(r.table.rows).toEqual([t.rows[0], t.rows[1]]);
    expect(r.removedCount).toBe(3);
  });

  it('collapses internal whitespace when asked', () => {
    const table = { headers: ['v'], rows: [['a  b'], ['a b']] };
    expect(dedupe(table).removedCount).toBe(0);
    expect(dedupe(table, { collapseWhitespace: true }).removedCount).toBe(1);
  });

  it('does not confuse cells that contain separators', () => {
    const table = {
      headers: ['a', 'b'],
      rows: [
        ['x,y', 'z'],
        ['x', 'y,z'],
      ],
    };
    expect(dedupe(table).removedCount).toBe(0);
  });

  it('handles an empty table', () => {
    const r = dedupe({ headers: ['a'], rows: [] });
    expect(r).toMatchObject({ removedCount: 0, duplicateGroups: 0 });
  });

  it('handles Unicode and large input', () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => [`🍣${i % 1000}`]);
    const r = dedupe({ headers: ['k'], rows });
    expect(r.table.rows).toHaveLength(1000);
    expect(r.removedCount).toBe(49_000);
  });
});

describe('rowKey', () => {
  it('treats missing cells as empty', () => {
    expect(rowKey(['a'], { columns: [0, 3] })).toBe(JSON.stringify(['a', '']));
  });
});
