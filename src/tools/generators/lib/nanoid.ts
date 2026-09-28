import { RandomReader, symbols } from './random';

/** nanoid's default URL-safe alphabet (64 symbols). */
export const NANOID_URL_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export const NANOID_PRESETS: Array<{ id: string; label: string; alphabet: string }> = [
  { id: 'url', label: 'URL-safe (A–Z a–z 0–9 _ -)', alphabet: NANOID_URL_ALPHABET },
  { id: 'alnum', label: 'Alphanumeric', alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  { id: 'lower', label: 'Lowercase + digits', alphabet: '0123456789abcdefghijklmnopqrstuvwxyz' },
  { id: 'nolookalikes', label: 'No look-alikes', alphabet: '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz' },
  { id: 'hex', label: 'Hex (lowercase)', alphabet: '0123456789abcdef' },
  { id: 'digits', label: 'Digits', alphabet: '0123456789' },
];

export type AlphabetCheck = { ok: true; symbols: string[] } | { ok: false; error: string };

export function checkAlphabet(alphabet: string): AlphabetCheck {
  const list = symbols(alphabet);
  if (list.length < 2) return { ok: false, error: 'The alphabet needs at least 2 distinct characters.' };
  if (list.length > 256) return { ok: false, error: `The alphabet can have at most 256 characters; it has ${list.length}.` };
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const s of list) {
    if (seen.has(s)) dupes.add(s);
    seen.add(s);
  }
  if (dupes.size) {
    const shown = [...dupes].slice(0, 5).map((d) => (d === ' ' ? 'space' : `"${d}"`));
    return { ok: false, error: `Duplicate characters would bias the output: ${shown.join(', ')}.` };
  }
  return { ok: true, symbols: list };
}

/**
 * nanoid's `customAlphabet` algorithm: take random bytes, mask them to the
 * smallest 2^k - 1 >= alphabet size, and reject values past the end.
 * `step` is sized like nanoid (1.6 × mask × size / length) to usually finish in one read.
 */
export function customAlphabet(alphabet: readonly string[], size: number, getBytes: (n: number) => Uint8Array) {
  const len = alphabet.length;
  const mask = (2 << (31 - Math.clz32((len - 1) | 1))) - 1;
  const step = Math.ceil((1.6 * mask * size) / len);
  return (): string => {
    let id = '';
    let count = 0;
    for (;;) {
      const bytes = getBytes(step);
      for (let i = 0; i < step; i++) {
        const sym = alphabet[bytes[i] & mask];
        if (sym !== undefined) {
          id += sym;
          if (++count === size) return id;
        }
      }
    }
  };
}

export function generateNanoids(alphabet: readonly string[], size: number, count: number, reader = new RandomReader()): string[] {
  const gen = customAlphabet(alphabet, size, (n) => reader.bytes(n));
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(gen());
  return out;
}

// ---------------------------------------------------------------------------
// Collision probability (birthday bound)
// ---------------------------------------------------------------------------

/** ln of the number of possible ids: size × ln(alphabet). */
export function lnSpace(alphabetSize: number, size: number): number {
  return size * Math.log(alphabetSize);
}

/**
 * Number of ids after which the probability of at least one collision reaches `p`:
 * n ≈ sqrt(2 · N · ln(1 / (1 − p))). Returned as a (possibly huge) float.
 */
export function idsForProbability(alphabetSize: number, size: number, p = 0.01): number {
  const lnN = lnSpace(alphabetSize, size);
  return Math.exp(0.5 * (Math.LN2 + lnN + Math.log(-Math.log1p(-p))));
}

/** Probability of at least one collision among `k` ids: 1 − exp(−k(k−1) / 2N). */
export function collisionProbability(alphabetSize: number, size: number, k: number): number {
  if (k < 2) return 0;
  const lnN = lnSpace(alphabetSize, size);
  const lnX = Math.log(k) + Math.log(k - 1) - Math.LN2 - lnN;
  return -Math.expm1(-Math.exp(lnX));
}

const UNITS: Array<[number, string]> = [
  [365.25 * 24 * 3600, 'year'],
  [24 * 3600, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
  [1, 'second'],
];

/** Human duration for a (possibly astronomical) number of seconds. */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'forever';
  if (seconds < 1) return 'less than a second';
  for (const [unit, name] of UNITS) {
    if (seconds >= unit) {
      const v = seconds / unit;
      if (v >= 1e6) return `~${formatCompact(v)} ${name}s`;
      return `~${formatBig(v, name === 'second' ? 0 : v < 10 ? 1 : 0)} ${name}${v >= 1.05 || v < 0.95 ? 's' : ''}`;
    }
  }
  return 'less than a second';
}

const SCALES: Array<[number, string]> = [
  [1e18, 'quintillion'],
  [1e15, 'quadrillion'],
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
];

/** "149 billion", "1.3 quintillion"; grouped digits below a million, powers of ten above 10^21. */
export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  if (v >= 1e21) return formatBig(v);
  for (const [scale, word] of SCALES) {
    if (v >= scale) {
      const x = v / scale;
      return `${x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x).toLocaleString('en-US')} ${word}`;
    }
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
}

/** Group digits up to 10^15, scientific-ish (1.2 × 10^18 style) beyond. */
export function formatBig(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return '∞';
  if (Math.abs(v) < 1e15) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(v);
  }
  let exp = Math.floor(Math.log10(Math.abs(v)));
  let mant = v / 10 ** exp;
  if (Math.abs(mant) >= 9.995) {
    mant /= 10;
    exp++;
  }
  return `${mant.toFixed(2)} × 10^${exp}`;
}
