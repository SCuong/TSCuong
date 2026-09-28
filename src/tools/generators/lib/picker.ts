import { RandomReader, shuffleInPlace } from './random';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_COUNT = 10_000;

// ---------------------------------------------------------------------------
// Integers
// ---------------------------------------------------------------------------

export interface IntOptions {
  min: number;
  max: number;
  count: number;
  unique: boolean;
  sort: 'none' | 'asc' | 'desc';
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function randomIntegers(opts: IntOptions, reader = new RandomReader()): Result<number[]> {
  const { min, max, count, unique, sort } = opts;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return { ok: false, error: 'Minimum and maximum must be whole numbers.' };
  if (min > max) return { ok: false, error: 'The minimum must not be greater than the maximum.' };
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Pick at least 1 number.' };
  if (count > MAX_COUNT) return { ok: false, error: `You can generate at most ${fmt(MAX_COUNT)} numbers at once.` };
  const size = max - min + 1;
  if (!Number.isSafeInteger(size) || size > 2 ** 53) return { ok: false, error: 'The range is too large (at most 2^53 values).' };
  if (unique && count > size) {
    return {
      ok: false,
      error: `You asked for ${fmt(count)} unique numbers, but ${fmt(min)}–${fmt(max)} only contains ${fmt(size)}. Lower the count, widen the range, or allow duplicates.`,
    };
  }
  let values: number[];
  if (!unique) {
    values = Array.from({ length: count }, () => min + reader.below(size));
  } else {
    // Robert Floyd's sampling: a uniformly random k-subset in k draws, then shuffled for random order.
    const chosen = new Set<number>();
    for (let j = size - count; j < size; j++) {
      const t = reader.below(j + 1);
      chosen.add(chosen.has(t) ? j : t);
    }
    values = shuffleInPlace(
      [...chosen].map((v) => v + min),
      reader,
    );
  }
  if (sort === 'asc') values.sort((a, b) => a - b);
  else if (sort === 'desc') values.sort((a, b) => b - a);
  return { ok: true, value: values };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function parseList(text: string, dedupe: boolean): string[] {
  const items = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return dedupe ? [...new Set(items)] : items;
}

/** Pick `n` distinct entries (by position) from the list, in random order. */
export function pickFromList(items: readonly string[], n: number, reader = new RandomReader()): Result<string[]> {
  if (items.length === 0) return { ok: false, error: 'Add at least one entry, one per line.' };
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Pick at least 1 entry.' };
  if (n > items.length) {
    return { ok: false, error: `You asked for ${fmt(n)} winners but the list only has ${fmt(items.length)} ${items.length === 1 ? 'entry' : 'entries'}.` };
  }
  const copy = items.slice();
  // Partial Fisher–Yates: the first n positions become a uniform random sample.
  for (let i = 0; i < n; i++) {
    const j = i + reader.below(copy.length - i);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return { ok: true, value: copy.slice(0, n) };
}

export function shuffleList(items: readonly string[], reader = new RandomReader()): string[] {
  return shuffleInPlace(items.slice(), reader);
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

export interface DiceTerm {
  sign: 1 | -1;
  /** Number of dice; 0 for a constant modifier. */
  count: number;
  sides: number;
  /** Constant value when count is 0. */
  constant: number;
  text: string;
}

export const MAX_DICE = 1000;
export const MAX_SIDES = 1_000_000;

export function parseDice(input: string): Result<DiceTerm[]> {
  const src = input.replace(/\s+/g, '').toLowerCase();
  if (!src) return { ok: false, error: 'Enter dice notation such as 2d6 or 1d20+3.' };
  const re = /([+-]?)(?:(\d*)d(\d+|%)|(\d+))/y;
  const terms: DiceTerm[] = [];
  let pos = 0;
  let totalDice = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || (terms.length > 0 && !m[1])) {
      return { ok: false, error: `Couldn't read "${input.trim()}". Use notation like 2d6, d20, 3d8+2 or 1d6+1d4-1.` };
    }
    const sign: 1 | -1 = m[1] === '-' ? -1 : 1;
    if (m[4] !== undefined) {
      const constant = Number(m[4]);
      if (!Number.isSafeInteger(constant)) return { ok: false, error: 'That modifier is too large.' };
      terms.push({ sign, count: 0, sides: 0, constant, text: m[0] });
    } else {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = m[3] === '%' ? 100 : Number(m[3]);
      if (count < 1) return { ok: false, error: 'Roll at least 1 die per term.' };
      if (sides < 2) return { ok: false, error: 'A die needs at least 2 sides.' };
      if (sides > MAX_SIDES) return { ok: false, error: `Dice can have at most ${fmt(MAX_SIDES)} sides.` };
      totalDice += count;
      if (totalDice > MAX_DICE) return { ok: false, error: `You can roll at most ${fmt(MAX_DICE)} dice at once.` };
      terms.push({ sign, count, sides, constant: 0, text: m[0] });
    }
    pos = re.lastIndex;
  }
  if (!terms.some((t) => t.count > 0)) return { ok: false, error: 'Include at least one die, such as d6.' };
  return { ok: true, value: terms };
}

export interface DiceRoll {
  terms: Array<{ term: DiceTerm; rolls: number[]; subtotal: number }>;
  total: number;
}

export function rollDice(terms: DiceTerm[], reader = new RandomReader()): DiceRoll {
  let total = 0;
  const out = terms.map((term) => {
    if (term.count === 0) {
      const subtotal = term.sign * term.constant;
      total += subtotal;
      return { term, rolls: [], subtotal };
    }
    const rolls = Array.from({ length: term.count }, () => 1 + reader.below(term.sides));
    const subtotal = term.sign * rolls.reduce((a, b) => a + b, 0);
    total += subtotal;
    return { term, rolls, subtotal };
  });
  return { terms: out, total };
}

/** Lowest and highest possible totals. */
export function diceRange(terms: DiceTerm[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const t of terms) {
    const lo = t.count === 0 ? t.constant : t.count;
    const hi = t.count === 0 ? t.constant : t.count * t.sides;
    if (t.sign === 1) {
      min += lo;
      max += hi;
    } else {
      min -= hi;
      max -= lo;
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

export interface CoinFlips {
  flips: Array<'H' | 'T'>;
  heads: number;
  tails: number;
  longestStreak: { side: 'H' | 'T'; length: number };
}

export function flipCoins(count: number, reader = new RandomReader()): CoinFlips {
  const flips: Array<'H' | 'T'> = [];
  let heads = 0;
  let best: CoinFlips['longestStreak'] = { side: 'H', length: 0 };
  let run = 0;
  for (let i = 0; i < count; i++) {
    const side = (reader.byte() & 1) === 1 ? 'H' : 'T';
    if (side === 'H') heads++;
    run = i > 0 && flips[i - 1] === side ? run + 1 : 1;
    if (run > best.length) best = { side, length: run };
    flips.push(side);
  }
  return { flips, heads, tails: count - heads, longestStreak: best };
}
