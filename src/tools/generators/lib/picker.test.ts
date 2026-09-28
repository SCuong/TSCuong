import { describe, expect, it } from 'vitest';
import { diceRange, flipCoins, parseDice, parseList, pickFromList, randomIntegers, rollDice, shuffleList } from './picker';

describe('randomIntegers', () => {
  it('stays within bounds, inclusive', () => {
    const r = randomIntegers({ min: -3, max: 3, count: 2000, unique: false, sort: 'none' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.min(...r.value)).toBe(-3);
      expect(Math.max(...r.value)).toBe(3);
    }
  });

  it('is unbiased across a range (chi-square)', () => {
    const r = randomIntegers({ min: 1, max: 10, count: 10_000, unique: false, sort: 'none' });
    if (!r.ok) throw new Error(r.error);
    const counts = new Array(10).fill(0);
    for (const v of r.value) counts[v - 1]++;
    const chi = counts.reduce((s, c) => s + (c - 1000) ** 2 / 1000, 0);
    // df = 9; p = 0.0001 critical value ≈ 33.7
    expect(chi).toBeLessThan(33.7);
  });

  it('unique picks are distinct and can cover the whole range', () => {
    const r = randomIntegers({ min: 1, max: 50, count: 50, unique: true, sort: 'asc' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('unique sampling is uniform over subsets', () => {
    // Choose 1 of 4 many times via the Floyd path: each value ~25%.
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) {
      const r = randomIntegers({ min: 0, max: 3, count: 2, unique: true, sort: 'none' });
      if (r.ok) for (const v of r.value) counts[v]++;
    }
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThan(200);
  });

  it('huge ranges with unique values', () => {
    const r = randomIntegers({ min: 0, max: Number.MAX_SAFE_INTEGER - 1, count: 1000, unique: true, sort: 'desc' });
    if (!r.ok) throw new Error(r.error);
    expect(new Set(r.value).size).toBe(1000);
    expect(r.value[0]).toBeGreaterThanOrEqual(r.value[999]);
  });

  it('explains impossible requests', () => {
    const r = randomIntegers({ min: 1, max: 10, count: 20, unique: true, sort: 'none' });
    expect(!r.ok && r.error).toMatch(/20 unique numbers.*only contains 10/);
    expect(randomIntegers({ min: 5, max: 1, count: 1, unique: false, sort: 'none' }).ok).toBe(false);
    expect(randomIntegers({ min: 1.5, max: 3, count: 1, unique: false, sort: 'none' }).ok).toBe(false);
    expect(randomIntegers({ min: 1, max: 3, count: 0, unique: false, sort: 'none' }).ok).toBe(false);
    expect(randomIntegers({ min: 1, max: 3, count: 10_001, unique: false, sort: 'none' }).ok).toBe(false);
    expect(randomIntegers({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, count: 1, unique: false, sort: 'none' }).ok).toBe(false);
  });

  it('min == max works', () => {
    const r = randomIntegers({ min: 7, max: 7, count: 3, unique: false, sort: 'none' });
    expect(r.ok && r.value).toEqual([7, 7, 7]);
  });
});

describe('lists', () => {
  it('parses, trims and dedupes', () => {
    expect(parseList(' a \n\nb\r\na\n', false)).toEqual(['a', 'b', 'a']);
    expect(parseList(' a \n\nb\r\na\n', true)).toEqual(['a', 'b']);
    expect(parseList('', true)).toEqual([]);
  });

  it('picks distinct winners', () => {
    const items = ['Ann', 'Bob', 'Cy', 'Di', '🎉 Eve'];
    const r = pickFromList(items, 5);
    expect(r.ok && [...r.value].sort()).toEqual([...items].sort());
    const one = pickFromList(items, 1);
    expect(one.ok && items).toContain(one.ok ? one.value[0] : '');
  });

  it('pick is uniform', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const r = pickFromList(['a', 'b', 'c'], 1);
      if (r.ok) counts.set(r.value[0], (counts.get(r.value[0]) ?? 0) + 1);
    }
    for (const c of counts.values()) expect(Math.abs(c - 2000)).toBeLessThan(200);
  });

  it('explains too many winners and empty lists', () => {
    const r = pickFromList(['a'], 2);
    expect(!r.ok && r.error).toMatch(/only has 1 entry/);
    expect(pickFromList([], 1).ok).toBe(false);
  });

  it('shuffle keeps entries', () => {
    const items = Array.from({ length: 30 }, (_, i) => `x${i}`);
    expect(shuffleList(items).sort()).toEqual([...items].sort());
  });
});

describe('dice', () => {
  it('parses common notation', () => {
    const r = parseDice('2d6');
    expect(r.ok && r.value).toEqual([{ sign: 1, count: 2, sides: 6, constant: 0, text: '2d6' }]);
    const r2 = parseDice('d20 + 5');
    expect(r2.ok && r2.value.map((t) => [t.sign, t.count, t.sides, t.constant])).toEqual([
      [1, 1, 20, 0],
      [1, 0, 0, 5],
    ]);
    const r3 = parseDice('3D8-1d4-2');
    expect(r3.ok && r3.value.map((t) => [t.sign, t.count, t.sides, t.constant])).toEqual([
      [1, 3, 8, 0],
      [-1, 1, 4, 0],
      [-1, 0, 0, 2],
    ]);
    const pct = parseDice('d%');
    expect(pct.ok && pct.value[0].sides).toBe(100);
  });

  it('rejects bad notation', () => {
    for (const s of ['', 'abc', '2d', '2d6 3d4', '0d6', '2d1', '5', '1001d6', '2d6+', 'd6*2', '1d2000000']) {
      expect(parseDice(s).ok, s).toBe(false);
    }
  });

  it('rolls within range and totals correctly', () => {
    const p = parseDice('3d6+2');
    if (!p.ok) throw new Error(p.error);
    expect(diceRange(p.value)).toEqual({ min: 5, max: 20 });
    for (let i = 0; i < 500; i++) {
      const roll = rollDice(p.value);
      const sum = roll.terms[0].rolls.reduce((a, b) => a + b, 0) + 2;
      expect(roll.total).toBe(sum);
      expect(roll.total).toBeGreaterThanOrEqual(5);
      expect(roll.total).toBeLessThanOrEqual(20);
    }
  });

  it('negative terms subtract', () => {
    const p = parseDice('1d4-1d4');
    if (!p.ok) throw new Error(p.error);
    expect(diceRange(p.value)).toEqual({ min: -3, max: 3 });
  });

  it('d6 faces are uniform', () => {
    const p = parseDice('1000d6');
    if (!p.ok) throw new Error(p.error);
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 6; i++) for (const v of rollDice(p.value).terms[0].rolls) counts[v]++;
    expect(counts[0]).toBe(0);
    for (let f = 1; f <= 6; f++) expect(Math.abs(counts[f] - 1000)).toBeLessThan(150);
  });
});

describe('coins', () => {
  it('counts heads, tails and streaks', () => {
    const r = flipCoins(10_000);
    expect(r.heads + r.tails).toBe(10_000);
    expect(Math.abs(r.heads - 5000)).toBeLessThan(300);
    expect(r.longestStreak.length).toBeGreaterThan(5);
    const one = flipCoins(1);
    expect(one.longestStreak.length).toBe(1);
  });
});
