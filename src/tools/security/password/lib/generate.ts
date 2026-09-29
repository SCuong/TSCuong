/** Password and passphrase generation with exact entropy figures. */

import { SecureRandom } from './random';

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const DIGITS = '0123456789';
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>/?~';
/** Characters that are easily confused with each other in many fonts. */
export const LOOKALIKES = 'Il1|O0o';

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;

export type CharsetId = 'upper' | 'lower' | 'digits' | 'symbols';

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** Characters used when `symbols` is on. */
  symbolSet: string;
  excludeLookalikes: boolean;
  /** Every selected set must appear at least once. */
  requireEach: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  symbolSet: DEFAULT_SYMBOLS,
  excludeLookalikes: false,
  requireEach: true,
};

export interface Charset {
  id: CharsetId;
  chars: string[];
}

export type CharsetResult = { ok: true; sets: Charset[]; alphabet: string[] } | { ok: false; error: string };

/**
 * Builds the enabled character sets. Characters are de-duplicated across sets (a custom symbol
 * that is also a digit only counts once), whitespace and control characters are ignored.
 */
export function buildCharsets(options: PasswordOptions): CharsetResult {
  const seen = new Set<string>();
  const sets: Charset[] = [];
  const add = (id: CharsetId, source: string) => {
    const chars: string[] = [];
    for (const ch of Array.from(source)) {
      if (/\s|\p{Cc}/u.test(ch)) continue;
      if (options.excludeLookalikes && LOOKALIKES.includes(ch)) continue;
      if (seen.has(ch)) continue;
      seen.add(ch);
      chars.push(ch);
    }
    sets.push({ id, chars });
  };
  if (options.upper) add('upper', UPPER);
  if (options.lower) add('lower', LOWER);
  if (options.digits) add('digits', DIGITS);
  if (options.symbols) add('symbols', options.symbolSet);
  if (sets.length === 0) return { ok: false, error: 'Choose at least one character set.' };
  const empty = sets.find((s) => s.chars.length === 0);
  if (empty) {
    return {
      ok: false,
      error:
        empty.id === 'symbols'
          ? 'The symbol set is empty (or only repeats characters from the other sets). Add symbols or turn symbols off.'
          : 'One of the selected sets has no characters left.',
    };
  }
  if (!Number.isInteger(options.length) || options.length < MIN_LENGTH || options.length > MAX_LENGTH) {
    return { ok: false, error: `Choose a length between ${MIN_LENGTH} and ${MAX_LENGTH}.` };
  }
  if (options.requireEach && options.length < sets.length) {
    return { ok: false, error: `To include every selected set, the length must be at least ${sets.length}.` };
  }
  return { ok: true, sets, alphabet: sets.flatMap((s) => s.chars) };
}

/** log2 of a positive BigInt, accurate to double precision. */
export function log2BigInt(value: bigint): number {
  if (value <= 0n) return -Infinity;
  const bits = value.toString(2).length;
  if (bits <= 52) return Math.log2(Number(value));
  const shift = bits - 52;
  return Math.log2(Number(value >> BigInt(shift))) + shift;
}

/** Number of strings of `length` over the union of `sizes` that contain every set at least once. */
export function countWithEverySet(sizes: number[], length: number): bigint {
  const total = sizes.reduce((a, b) => a + b, 0);
  let count = 0n;
  // Inclusion–exclusion over the subsets of sets that are missing.
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    let missing = 0;
    let bitsSet = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (mask & (1 << i)) {
        missing += sizes[i];
        bitsSet++;
      }
    }
    const term = BigInt(total - missing) ** BigInt(length);
    count += bitsSet % 2 === 0 ? term : -term;
  }
  return count;
}

/**
 * Entropy of the generator in bits: log2 of the number of equally likely passwords it can produce.
 * With `requireEach`, passwords missing a set are rejected, which removes a (usually tiny) fraction.
 */
export function passwordEntropyBits(sizes: number[], length: number, requireEach: boolean): number {
  if (sizes.length === 0 || length <= 0) return 0;
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!requireEach || sizes.length === 1) return length * Math.log2(total);
  const count = countWithEverySet(sizes, length);
  return count > 0n ? log2BigInt(count) : 0;
}

/**
 * Generates one password. Each character is drawn uniformly from the whole alphabet; when every
 * set is required, whole candidates that miss a set are rejected (keeping the result uniform over
 * all valid passwords, unlike "insert one of each then shuffle").
 */
export function generatePassword(charsets: { sets: Charset[]; alphabet: string[] }, length: number, requireEach: boolean, rng: SecureRandom): string {
  const { sets, alphabet } = charsets;
  const setOf = new Map<string, number>();
  sets.forEach((s, i) => s.chars.forEach((c) => setOf.set(c, i)));
  for (let attempt = 0; attempt < 100_000; attempt++) {
    const chars: string[] = [];
    const present = new Set<number>();
    for (let i = 0; i < length; i++) {
      const ch = alphabet[rng.below(alphabet.length)];
      chars.push(ch);
      present.add(setOf.get(ch)!);
    }
    if (!requireEach || present.size === sets.length) return chars.join('');
  }
  throw new Error('Could not generate a password that satisfies every set. Increase the length.');
}

// --- passphrases --------------------------------------------------------------------------------

export type Capitalization = 'lower' | 'capitalize' | 'upper' | 'random';

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalization: Capitalization;
  /** Insert a random number 0–99 as an extra token at a random position. */
  includeNumber: boolean;
}

export const MIN_WORDS = 3;
export const MAX_WORDS = 20;

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 6,
  separator: '-',
  capitalization: 'lower',
  includeNumber: false,
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function generatePassphrase(wordList: readonly string[], options: PassphraseOptions, rng: SecureRandom): string {
  if (wordList.length === 0) throw new Error('The word list is empty.');
  const count = Math.min(MAX_WORDS, Math.max(1, Math.floor(options.words)));
  const tokens: string[] = [];
  for (let i = 0; i < count; i++) {
    const word = rng.pick(wordList);
    switch (options.capitalization) {
      case 'capitalize':
        tokens.push(capitalize(word));
        break;
      case 'upper':
        tokens.push(word.toUpperCase());
        break;
      case 'random':
        tokens.push(rng.below(2) ? capitalize(word) : word);
        break;
      default:
        tokens.push(word);
    }
  }
  if (options.includeNumber) {
    const number = String(rng.below(100));
    tokens.splice(rng.below(count + 1), 0, number);
  }
  return tokens.join(options.separator);
}

export function passphraseEntropyBits(listSize: number, options: PassphraseOptions): number {
  if (listSize <= 1) return 0;
  const count = Math.min(MAX_WORDS, Math.max(1, Math.floor(options.words)));
  let bits = count * Math.log2(listSize);
  if (options.capitalization === 'random') bits += count;
  if (options.includeNumber) bits += Math.log2(100) + Math.log2(count + 1);
  return bits;
}

// --- strength labels ----------------------------------------------------------------------------

export interface EntropyRating {
  label: string;
  tone: 'danger' | 'warning' | 'success';
}

export function rateEntropy(bits: number): EntropyRating {
  if (bits < 40) return { label: 'Weak', tone: 'danger' };
  if (bits < 60) return { label: 'Fair', tone: 'warning' };
  if (bits < 80) return { label: 'Strong', tone: 'success' };
  return { label: 'Very strong', tone: 'success' };
}

/**
 * Average time to guess a secret with `bits` of entropy (half the space) at `guessesPerSecond`,
 * as a short phrase.
 */
export function averageCrackTime(bits: number, guessesPerSecond: number): string {
  const log2Seconds = bits - 1 - Math.log2(guessesPerSecond);
  if (log2Seconds < 0) return 'less than a second';
  const seconds = 2 ** log2Seconds;
  const units: Array<[number, string]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [365.25, 'day'],
  ];
  let value = seconds;
  for (const [size, name] of units) {
    if (value < size) {
      const n = Math.max(1, Math.round(value));
      return `about ${n} ${name}${n === 1 ? '' : 's'}`;
    }
    value /= size;
  }
  // value is now in years
  if (value < 1000) {
    const n = Math.round(value);
    return `about ${n} year${n === 1 ? '' : 's'}`;
  }
  if (value < 1e6) return `about ${Math.round(value / 1000)} thousand years`;
  if (value < 1e9) return `about ${Math.round(value / 1e6)} million years`;
  if (value < 1.4e10) return `about ${Math.round(value / 1e9)} billion years`;
  return 'longer than the age of the universe';
}
