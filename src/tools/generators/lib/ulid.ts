import { RandomReader } from './random';

/** Crockford's Base32 (no I, L, O, U). */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TIME_LEN = 10;
export const RANDOM_LEN = 16;
export const ULID_LEN = TIME_LEN + RANDOM_LEN;
export const MAX_TIME = 2 ** 48 - 1;

const DECODE = new Map<string, number>();
for (let i = 0; i < CROCKFORD.length; i++) {
  DECODE.set(CROCKFORD[i], i);
  DECODE.set(CROCKFORD[i].toLowerCase(), i);
}

export class UlidError extends Error {}

/** Encode a millisecond timestamp as 10 Crockford characters (48 bits, left-padded). */
export function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new UlidError('The timestamp must be a non-negative integer (milliseconds).');
  if (ms > MAX_TIME) throw new UlidError(`The timestamp can't be larger than ${MAX_TIME} (year 10889).`);
  let out = '';
  let t = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = t % 32;
    out = CROCKFORD[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

/** 16 random base32 digits (80 bits). 32 divides 256, so masking a byte is unbiased. */
export function randomDigits(reader: RandomReader): number[] {
  const out = new Array<number>(RANDOM_LEN);
  for (let i = 0; i < RANDOM_LEN; i++) out[i] = reader.byte() & 31;
  return out;
}

function digitsToString(digits: number[]): string {
  let s = '';
  for (const d of digits) s += CROCKFORD[d];
  return s;
}

/** Adds 1 to an 80-bit base32 number. Throws on overflow. */
export function incrementDigits(digits: number[]): number[] {
  const next = digits.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < 31) {
      next[i]++;
      return next;
    }
    next[i] = 0;
  }
  throw new UlidError('Random component overflowed within one millisecond (more than 2^80 ULIDs).');
}

export function ulid(ms: number, reader: RandomReader): string {
  return encodeTime(ms) + digitsToString(randomDigits(reader));
}

/**
 * Monotonic generator: within the same millisecond (or if the clock moves
 * backwards) the random component of the previous ULID is incremented by one,
 * so ids are strictly increasing.
 */
export function monotonicFactory(reader: RandomReader) {
  let lastTime = -1;
  let lastDigits: number[] = [];
  return (ms: number): string => {
    if (ms <= lastTime) {
      lastDigits = incrementDigits(lastDigits);
      return encodeTime(lastTime) + digitsToString(lastDigits);
    }
    const time = encodeTime(ms);
    lastTime = ms;
    lastDigits = randomDigits(reader);
    return time + digitsToString(lastDigits);
  };
}

export function generateUlids(count: number, opts: { monotonic: boolean; now?: () => number; reader?: RandomReader }): string[] {
  const reader = opts.reader ?? new RandomReader();
  const now = opts.now ?? Date.now;
  const next = opts.monotonic ? monotonicFactory(reader) : (ms: number) => ulid(ms, reader);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(next(now()));
  return out;
}

export interface DecodedUlid {
  ulid: string;
  timeMs: number;
  date: Date;
  /** Random component as 20 hex digits (80 bits). */
  randomHex: string;
  /** The 128-bit value formatted as a UUID. */
  uuid: string;
}

export type DecodeResult = { ok: true; value: DecodedUlid } | { ok: false; error: string };

export function decodeUlid(input: string): DecodeResult {
  const s = input.trim();
  if (!s) return { ok: false, error: 'Empty input.' };
  if (s.length !== ULID_LEN) return { ok: false, error: `A ULID has 26 characters; this has ${s.length}.` };
  let value = 0n;
  for (const ch of s) {
    const d = DECODE.get(ch);
    if (d === undefined) {
      const hint = /[ilou]/i.test(ch) ? ` ("${ch}" is excluded from Crockford Base32)` : '';
      return { ok: false, error: `Invalid character "${ch}"${hint}.` };
    }
    value = (value << 5n) | BigInt(d);
  }
  if ((DECODE.get(s[0]) ?? 0) > 7) {
    return { ok: false, error: 'The first character must be 0–7; larger values overflow the 48-bit timestamp.' };
  }
  const timeMs = Number(value >> 80n);
  const hex = value.toString(16).padStart(32, '0');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return {
    ok: true,
    value: { ulid: s.toUpperCase(), timeMs, date: new Date(timeMs), randomHex: hex.slice(12), uuid },
  };
}
