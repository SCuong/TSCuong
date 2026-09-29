import { describe, expect, it } from 'vitest';
import { columnStats, median, tableStats, valueType } from './stats';

describe('valueType', () => {
  it('classifies values', () => {
    expect(valueType('42')).toBe('integer');
    expect(valueType('-4.2e1')).toBe('decimal');
    expect(valueType('.5')).toBe('decimal');
    expect(valueType('Yes')).toBe('boolean');
    expect(valueType('2024-02-29')).toBe('date');
    expect(valueType('2024-02-29T10:00:00Z')).toBe('date');
    expect(valueType('2024-13-01')).toBe('text');
    expect(valueType('1,000')).toBe('text');
    expect(valueType('1e999')).toBe('text');
    expect(valueType('9'.repeat(400))).toBe('text');
    expect(valueType('🍣')).toBe('text');
  });
});

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe('columnStats', () => {
  const t = {
    headers: ['n', 'price', 'flag', 'day', 'mixed', 'blank'],
    rows: [
      ['1', '2.5', 'true', '2024-01-05', '10', ''],
      ['3', '10', 'false', '2023-12-31', '20', ' '],
      ['2', '', 'yes', '2024-03-01', 'n/a', ''],
      ['2', '0.5', 'no', '', '30', ''],
    ],
  };
  const stats = tableStats(t);

  it('infers integer columns with numeric summary', () => {
    const s = stats[0];
    expect(s.type).toBe('integer');
    expect(s).toMatchObject({ count: 4, empty: 0, filled: 4, unique: 3, typeConfidence: 1 });
    expect(s.numeric).toEqual({ min: 1, max: 3, sum: 8, mean: 2, median: 2, stdDev: Math.sqrt(2 / 3) });
    expect(s.top[0]).toEqual({ value: '2', count: 2 });
  });

  it('infers decimal columns and counts empties', () => {
    const s = stats[1];
    expect(s.type).toBe('decimal');
    expect(s.empty).toBe(1);
    expect(s.numeric?.min).toBe(0.5);
    expect(s.numeric?.max).toBe(10);
    expect(s.numeric?.median).toBe(2.5);
  });

  it('infers booleans with counts', () => {
    expect(stats[2].type).toBe('boolean');
    expect(stats[2].booleans).toEqual({ trueCount: 2, falseCount: 2 });
  });

  it('infers dates with a range', () => {
    expect(stats[3].type).toBe('date');
    expect(stats[3].dates).toEqual({ min: '2023-12-31', max: '2024-03-01' });
  });

  it('reports mixed columns as text but still summarises mostly-numeric data', () => {
    const s = stats[4];
    expect(s.type).toBe('text');
    expect(s.typeConfidence).toBe(0.25);
    expect(s.numeric).toMatchObject({ min: 10, max: 30, mean: 20 });
  });

  it('treats whitespace-only cells as empty by default', () => {
    expect(stats[5]).toMatchObject({ type: 'empty', empty: 4, filled: 0, unique: 0, minLength: 0, maxLength: 0 });
    expect(columnStats(t, 5, { trim: false }).filled).toBe(1);
  });

  it('measures lengths in code points', () => {
    const s = columnStats({ headers: ['e'], rows: [['🍣🍣'], ['abc']] }, 0);
    expect(s.minLength).toBe(2);
    expect(s.maxLength).toBe(3);
  });

  it('limits the top values', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [String(i % 7)]);
    expect(columnStats({ headers: ['x'], rows }, 0, { topN: 3 }).top).toHaveLength(3);
  });

  it('handles an empty table and large input', () => {
    expect(tableStats({ headers: [], rows: [] })).toEqual([]);
    const rows = Array.from({ length: 100_000 }, (_, i) => [String(i)]);
    const s = columnStats({ headers: ['i'], rows }, 0);
    expect(s.numeric?.mean).toBe(49_999.5);
    expect(s.unique).toBe(100_000);
  });
});
