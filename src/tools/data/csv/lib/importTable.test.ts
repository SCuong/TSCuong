import { describe, expect, it } from 'vitest';
import { blankTable, importTable, normalizeTable } from './importTable';

describe('importTable', () => {
  it('returns null for blank input', () => {
    expect(importTable('')).toBeNull();
    expect(importTable('  \n ')).toBeNull();
  });

  it('reads a Markdown table with alignment', () => {
    const r = importTable('| a | b |\n|:--|--:|\n| 1 | 2 |');
    expect(r).toEqual({ table: { headers: ['a', 'b'], rows: [['1', '2']] }, align: ['left', 'right'], format: 'markdown' });
  });

  it('reads CSV and TSV', () => {
    expect(importTable('x,y\n1,"2,5"')).toMatchObject({
      table: { headers: ['x', 'y'], rows: [['1', '2,5']] },
      format: 'csv',
      delimiter: ',',
    });
    expect(importTable('x\ty\n1\t2')?.delimiter).toBe('\t');
  });

  it('can treat the first row as data', () => {
    expect(importTable('1,2', false)?.table).toEqual({ headers: ['Column 1', 'Column 2'], rows: [['1', '2']] });
  });

  it('treats text with pipes but no separator row as CSV', () => {
    expect(importTable('a|b\nc|d')?.format).toBe('csv');
  });

  it('keeps emoji and CJK', () => {
    expect(importTable('名前,🍣\n山田,1')?.table.headers).toEqual(['名前', '🍣']);
  });
});

describe('blankTable / normalizeTable', () => {
  it('creates a blank table', () => {
    expect(blankTable(2, 1)).toEqual({ headers: ['Header 1', 'Header 2'], rows: [['', '']] });
  });
  it('pads and truncates rows', () => {
    expect(normalizeTable({ headers: ['a', 'b'], rows: [['1'], ['1', '2', '3']] })).toEqual({
      headers: ['a', 'b'],
      rows: [
        ['1', ''],
        ['1', '2'],
      ],
    });
    const ok = { headers: ['a'], rows: [['1']] };
    expect(normalizeTable(ok)).toBe(ok);
  });
});
