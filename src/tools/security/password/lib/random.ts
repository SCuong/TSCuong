/**
 * Unbiased random integers from `crypto.getRandomValues`.
 *
 * `below(n)` uses rejection sampling: 32-bit values at or above the largest multiple of `n`
 * that fits in 2^32 are discarded, so `x % n` is exactly uniform (no modulo bias).
 */

/** Fills the array with random 32-bit values. Injectable for tests. */
export type Uint32Source = (target: Uint32Array<ArrayBuffer>) => void;

export const cryptoUint32Source: Uint32Source = (target) => {
  crypto.getRandomValues(target);
};

const TWO_32 = 2 ** 32;

/** Values of a uniform 32-bit integer that are accepted when drawing from [0, n): x < limit. */
export function rejectionLimit(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new RangeError('The range must be an integer between 1 and 2^32.');
  return TWO_32 - (TWO_32 % n);
}

export class SecureRandom {
  private readonly pool: Uint32Array<ArrayBuffer>;
  private index: number;
  private readonly source: Uint32Source;
  /** Number of 32-bit values drawn so far (for tests and diagnostics). */
  drawn = 0;

  constructor(source: Uint32Source = cryptoUint32Source, poolSize = 256) {
    this.source = source;
    this.pool = new Uint32Array(poolSize);
    this.index = poolSize;
  }

  uint32(): number {
    if (this.index >= this.pool.length) {
      this.source(this.pool);
      this.index = 0;
    }
    this.drawn++;
    return this.pool[this.index++];
  }

  /** Uniform integer in [0, n). */
  below(n: number): number {
    const limit = rejectionLimit(n);
    if (n === 1) return 0;
    for (let attempts = 0; attempts < 10_000; attempts++) {
      const x = this.uint32();
      if (x < limit) return x % n;
    }
    // Only reachable with a broken source (each attempt succeeds with probability > 1/2).
    throw new Error('The random source keeps returning out-of-range values.');
  }

  /** Uniformly random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list.');
    return items[this.below(items.length)];
  }
}
