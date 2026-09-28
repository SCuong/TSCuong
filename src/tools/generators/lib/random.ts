/**
 * Cryptographically secure, unbiased random helpers shared by the generator tools.
 *
 * Every function takes an optional `ByteSource` so tests can inject deterministic bytes.
 */

/** Fills and returns `n` random bytes. */
export type ByteSource = (n: number) => Uint8Array;

const MAX_GRV = 65536;

/** Web Crypto backed byte source (getRandomValues is limited to 64 KiB per call). */
export const cryptoBytes: ByteSource = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += MAX_GRV) {
    crypto.getRandomValues(out.subarray(i, Math.min(n, i + MAX_GRV)));
  }
  return out;
};

/**
 * Buffered random reader: pulls entropy in blocks so tight loops (10k ids)
 * don't call getRandomValues once per value.
 */
export class RandomReader {
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private readonly source: ByteSource;
  private readonly block: number;

  constructor(source: ByteSource = cryptoBytes, block = 4096) {
    this.source = source;
    this.block = block;
  }

  byte(): number {
    if (this.pos >= this.buf.length) {
      this.buf = this.source(this.block);
      this.pos = 0;
    }
    return this.buf[this.pos++];
  }

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.byte();
    return out;
  }

  uint32(): number {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }

  /**
   * Uniform integer in [0, n) by rejection sampling (no modulo bias).
   * Supports 1 <= n <= 2^53.
   */
  below(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 53) throw new RangeError('Range must be an integer between 1 and 2^53.');
    if (n === 1) return 0;
    if (n <= 2 ** 32) {
      const limit = Math.floor(2 ** 32 / n) * n;
      for (;;) {
        const x = this.uint32();
        if (x < limit) return x % n;
      }
    }
    const limit = Math.floor(2 ** 53 / n) * n;
    for (;;) {
      const hi = this.uint32() & 0x1fffff; // 21 bits
      const x = hi * 2 ** 32 + this.uint32(); // 53 bits
      if (x < limit) return x % n;
    }
  }

  /** Uniform integer in [min, max] (inclusive). */
  intBetween(min: number, max: number): number {
    return min + this.below(max - min + 1);
  }

  /** Uniform float in [0, 1) with 53 bits of precision. */
  float(): number {
    const hi = this.uint32() >>> 5; // 27 bits
    const lo = this.uint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }
}

/**
 * Picks `size` symbols uniformly from `alphabet` (array of symbols, possibly
 * multi-code-unit). Uses nanoid's mask + rejection strategy for alphabets up
 * to 256 symbols, and rejection sampling on 32/53-bit integers above that.
 */
export function randomFromAlphabet(alphabet: readonly string[], size: number, reader: RandomReader): string {
  const len = alphabet.length;
  if (len < 1) throw new RangeError('The alphabet is empty.');
  if (len === 1) return alphabet[0].repeat(size);
  let out = '';
  if (len <= 256) {
    const mask = (2 << (31 - Math.clz32((len - 1) | 1))) - 1;
    let count = 0;
    while (count < size) {
      const idx = reader.byte() & mask;
      if (idx < len) {
        out += alphabet[idx];
        count++;
      }
    }
    return out;
  }
  for (let i = 0; i < size; i++) out += alphabet[reader.below(len)];
  return out;
}

/** In-place Fisher–Yates shuffle with unbiased indices. */
export function shuffleInPlace<T>(items: T[], reader: RandomReader): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = reader.below(i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Split a string into user-perceived symbols (code points; keeps emoji surrogate pairs together). */
export function symbols(text: string): string[] {
  return Array.from(text);
}

/** Bits of entropy for `length` symbols drawn from an alphabet of `size`. */
export function entropyBits(size: number, length: number): number {
  if (size <= 1 || length <= 0) return 0;
  return length * Math.log2(size);
}
