import { describe, expect, it } from 'vitest';
import {
  compareCells,
  deleteColumn,
  deleteRows,
  demoteHeader,
  insertColumn,
  insertRow,
  moveColumn,
  pickRows,
  promoteHeader,
  renameColumn,
  setCell,
  trimEmptyTrailingColumns,
  viewIndices,
} from './table';

const t = {
  headers: ['name', 'qty'],
  rows: [
    ['banana', '10'],
    ['Apple', '2'],
    ['cherry', ''],
    ['apple', '100'],
  ],
};

describe('compareCells', () => {
  it('compares numbers numerically and text naturally', () => {
    expect(compareCells('2', '10')).toBeLessThan(0);
    expect(compareCells('file2', 'file10')).toBeLessThan(0);
    expect(compareCells('a', 'B')).toBeLessThan(0);
    expect(compareCells('1.5', '1.50')).toBe(0);
  });
  it('puts empty cells last', () => {
    expect(compareCells('', 'a')).toBe(1);
    expect(compareCells('a', '')).toBe(-1);
    expect(compareCells('', '')).toBe(0);
  });
});

describe('viewIndices', () => {
  it('returns all rows without options', () => {
    expect(viewIndices(t)).toEqual([0, 1, 2, 3]);
  });
  it('filters case-insensitively across all columns', () => {
    expect(viewIndices(t, { filter: 'APPLE' })).toEqual([1, 3]);
  });
  it('filters case-sensitively and by column', () => {
    expect(viewIndices(t, { filter: 'Apple', caseSensitive: true })).toEqual([1]);
    expect(viewIndices(t, { filter: '10', filterColumn: 1 })).toEqual([0, 3]);
    expect(viewIndices(t, { filter: '10', filterColumn: 0 })).toEqual([]);
  });
  it('sorts numerically ascending and descending, empty last', () => {
    expect(viewIndices(t, { sort: { column: 1, dir: 'asc' } })).toEqual([1, 0, 3, 2]);
    expect(viewIndices(t, { sort: { column: 1, dir: 'desc' } })).toEqual([3, 0, 1, 2]);
  });
  it('sorts text stably', () => {
    expect(viewIndices(t, { sort: { column: 0, dir: 'asc' } })).toEqual([1, 3, 0, 2]);
  });
  it('ignores an out-of-range sort column', () => {
    expect(viewIndices(t, { sort: { column: 9, dir: 'asc' } })).toEqual([0, 1, 2, 3]);
  });
  it('combines filter and sort', () => {
    expect(viewIndices(t, { filter: 'apple', sort: { column: 1, dir: 'desc' } })).toEqual([3, 1]);
  });
});

describe('editing', () => {
  it('setCell is immutable and skips no-op edits', () => {
    const next = setCell(t, 0, 1, '11');
    expect(next.rows[0]).toEqual(['banana', '11']);
    expect(t.rows[0]).toEqual(['banana', '10']);
    expect(setCell(t, 0, 1, '10')).toBe(t);
  });
  it('renameColumn', () => {
    expect(renameColumn(t, 0, 'fruit').headers).toEqual(['fruit', 'qty']);
  });
  it('insertRow clamps the position', () => {
    expect(insertRow(t, 99).rows.at(-1)).toEqual(['', '']);
    expect(insertRow(t, -5).rows[0]).toEqual(['', '']);
  });
  it('deleteRows', () => {
    expect(deleteRows(t, [0, 2]).rows).toEqual([
      ['Apple', '2'],
      ['apple', '100'],
    ]);
  });
  it('insertColumn gives a unique generated name', () => {
    const next = insertColumn({ headers: ['Column 2'], rows: [['x']] }, 1);
    expect(next.headers).toEqual(['Column 2', 'Column 3']);
    expect(next.rows).toEqual([['x', '']]);
    expect(insertColumn(t, 0, 'id').headers).toEqual(['id', 'name', 'qty']);
  });
  it('deleteColumn', () => {
    expect(deleteColumn(t, 0)).toEqual({ headers: ['qty'], rows: [['10'], ['2'], [''], ['100']] });
  });
  it('moveColumn', () => {
    expect(moveColumn(t, 0, 1).headers).toEqual(['qty', 'name']);
    expect(moveColumn(t, 0, 1).rows[0]).toEqual(['10', 'banana']);
    expect(moveColumn(t, 0, 5)).toBe(t);
  });
  it('pickRows', () => {
    expect(pickRows(t, [2]).rows).toEqual([['cherry', '']]);
  });
});

describe('header toggling', () => {
  it('promote and demote are inverse (up to generated names)', () => {
    const demoted = demoteHeader(t);
    expect(demoted.headers).toEqual(['Column 1', 'Column 2']);
    expect(demoted.rows[0]).toEqual(['name', 'qty']);
    expect(promoteHeader(demoted)).toEqual(t);
  });
  it('promoteHeader on an empty table is a no-op', () => {
    const empty = { headers: [], rows: [] };
    expect(promoteHeader(empty)).toBe(empty);
  });
});

describe('trimEmptyTrailingColumns', () => {
  it('removes empty generated columns at the end only', () => {
    const table = {
      headers: ['a', 'Column 2', 'Column 3'],
      rows: [
        ['1', 'x', ''],
        ['2', '', ''],
      ],
    };
    expect(trimEmptyTrailingColumns(table)).toEqual({
      headers: ['a', 'Column 2'],
      rows: [
        ['1', 'x'],
        ['2', ''],
      ],
    });
  });
  it('keeps named empty columns', () => {
    const table = { headers: ['a', 'notes'], rows: [['1', '']] };
    expect(trimEmptyTrailingColumns(table)).toBe(table);
  });
});
