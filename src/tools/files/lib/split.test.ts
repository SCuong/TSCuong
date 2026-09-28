import { describe, expect, it } from 'vitest';
import { MAX_PARTS, moveItem, orderParts, parsePartName, partName, planSplit, type PartRange } from './split';

const covers = (parts: PartRange[], size: number) => {
  let pos = 0;
  for (const p of parts) {
    if (p.start !== pos || p.end <= p.start) return false;
    pos = p.end;
  }
  return pos === size;
};

describe('planSplit', () => {
  it('splits into N nearly equal parts that cover the file exactly', () => {
    const r = planSplit(10, { mode: 'parts', parts: 3 });
    expect(r).toEqual({
      ok: true,
      parts: [
        { index: 0, start: 0, end: 4 },
        { index: 1, start: 4, end: 7 },
        { index: 2, start: 7, end: 10 },
      ],
    });
    for (const [size, n] of [
      [1000, 7],
      [5, 5],
      [3 * 1024 ** 3 + 17, 13],
    ] as const) {
      const p = planSplit(size, { mode: 'parts', parts: n });
      expect(p.ok && covers(p.parts, size) && p.parts.length === n).toBe(true);
    }
  });
  it('splits by part size with a smaller last part', () => {
    const r = planSplit(25, { mode: 'size', partSize: 10 });
    expect(r.ok && r.parts.map((p) => p.end - p.start)).toEqual([10, 10, 5]);
    const exact = planSplit(20, { mode: 'size', partSize: 10 });
    expect(exact.ok && exact.parts.length).toBe(2);
    const huge = planSplit(5 * 1024 ** 3, {
      mode: 'size',
      partSize: 4 * 1024 ** 3 - 1,
    });
    expect(huge.ok && covers(huge.parts, 5 * 1024 ** 3) && huge.parts.length).toBe(2);
  });
  it('rejects impossible plans with clear messages', () => {
    expect(planSplit(0, { mode: 'parts', parts: 2 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/empty/),
    });
    expect(planSplit(10, { mode: 'parts', parts: 1 })).toMatchObject({
      ok: false,
    });
    expect(planSplit(10, { mode: 'parts', parts: 11 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at most 10 parts/),
    });
    expect(planSplit(10, { mode: 'parts', parts: 2.5 })).toMatchObject({
      ok: false,
    });
    expect(planSplit(10, { mode: 'size', partSize: 10 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/single part/),
    });
    expect(planSplit(10, { mode: 'size', partSize: 0 })).toMatchObject({
      ok: false,
    });
    expect(planSplit(MAX_PARTS * 10, { mode: 'size', partSize: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/limit/) });
    expect(planSplit(MAX_PARTS * 10, { mode: 'parts', parts: MAX_PARTS + 1 })).toMatchObject({ ok: false });
  });
});

describe('part names', () => {
  it('pads to at least three digits', () => {
    expect(partName('movie.mp4', 0, 3)).toBe('movie.mp4.001');
    expect(partName('a', 1233, 2000)).toBe('a.1234');
    expect(partName('📦 box.zip', 9, 10)).toBe('📦 box.zip.010');
  });
  it('parses common part naming schemes', () => {
    expect(parsePartName('movie.mp4.001')).toEqual({
      original: 'movie.mp4',
      number: 1,
    });
    expect(parsePartName('backup.7z.part12')).toEqual({
      original: 'backup.7z',
      number: 12,
    });
    expect(parsePartName('data.bin_003')).toEqual({
      original: 'data.bin',
      number: 3,
    });
    expect(parsePartName('xaa')).toEqual({ original: null, number: null });
  });
});

describe('orderParts', () => {
  const name = (s: string) => s;
  it('orders numerically, not lexically, and names the output', () => {
    const r = orderParts(
      ['f.bin.010', 'f.bin.002', 'f.bin.001', 'f.bin.003', 'f.bin.004', 'f.bin.005', 'f.bin.006', 'f.bin.007', 'f.bin.008', 'f.bin.009'],
      name,
    );
    expect(r.parts.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.outputName).toBe('f.bin');
    expect(r.missing).toEqual([]);
    expect(r.numbered).toBe(true);
  });
  it('reports missing and duplicate parts', () => {
    const r = orderParts(['f.001', 'f.004', 'f.004', 'f.002'], name);
    expect(r.missing).toEqual([3]);
    expect(r.duplicates).toEqual([4]);
    expect(orderParts(['f.002', 'f.003'], name).missing).toEqual([1]);
    expect(orderParts(['f.0', 'f.1'], name).missing).toEqual([]);
  });
  it('falls back to natural name order (split xaa/xab)', () => {
    const r = orderParts(['xab', 'xaa', 'xac'], name);
    expect(r.parts.map((p) => p.name)).toEqual(['xaa', 'xab', 'xac']);
    expect(r.numbered).toBe(false);
    expect(orderParts([], name)).toMatchObject({
      parts: [],
      outputName: 'joined',
    });
  });
  it('moves items', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 5)).toEqual([1, 2, 3]);
  });
});
