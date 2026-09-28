import { describe, expect, it } from 'vitest';
import { RandomReader } from './random';
import { CROCKFORD, decodeUlid, encodeTime, generateUlids, incrementDigits, monotonicFactory, ulid, UlidError } from './ulid';

const zeros = () => new RandomReader((n) => new Uint8Array(n));
const maxes = () => new RandomReader((n) => new Uint8Array(n).fill(255));

describe('encodeTime', () => {
  it('matches the spec example timestamp', () => {
    // From the ULID spec / ulid/javascript tests.
    expect(encodeTime(1469918176385)).toBe('01ARYZ6S41');
  });
  it('pads and handles bounds', () => {
    expect(encodeTime(0)).toBe('0000000000');
    expect(encodeTime(2 ** 48 - 1)).toBe('7ZZZZZZZZZ');
    expect(() => encodeTime(2 ** 48)).toThrow(UlidError);
    expect(() => encodeTime(-1)).toThrow(UlidError);
    expect(() => encodeTime(1.5)).toThrow(UlidError);
  });
});

describe('ulid', () => {
  it('is 26 Crockford characters with the time prefix', () => {
    const id = ulid(1469918176385, new RandomReader());
    expect(id).toHaveLength(26);
    expect(id.startsWith('01ARYZ6S41')).toBe(true);
    for (const ch of id) expect(CROCKFORD).toContain(ch);
  });

  it('randomness uses all 32 symbols roughly evenly', () => {
    const counts = new Map<string, number>();
    const reader = new RandomReader();
    for (let i = 0; i < 2000; i++) for (const ch of ulid(0, reader).slice(10)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(32);
    for (const c of counts.values()) expect(c).toBeGreaterThan(700); // expected 1000
  });
});

describe('monotonic', () => {
  it('increments the random part within the same millisecond', () => {
    const next = monotonicFactory(zeros());
    expect(next(1469918176385)).toBe('01ARYZ6S410000000000000000');
    expect(next(1469918176385)).toBe('01ARYZ6S410000000000000001');
    expect(next(1469918176385)).toBe('01ARYZ6S410000000000000002');
    // Clock going backwards keeps the last time and still increments.
    expect(next(100)).toBe('01ARYZ6S410000000000000003');
    // A later millisecond gets fresh randomness.
    expect(next(1469918176386)).toBe('01ARYZ6S420000000000000000');
  });

  it('carries across base32 digits', () => {
    expect(incrementDigits([0, 31, 31])).toEqual([1, 0, 0]);
  });

  it('throws on overflow', () => {
    const next = monotonicFactory(maxes());
    expect(next(5)).toBe('0000000005ZZZZZZZZZZZZZZZZ');
    expect(() => next(5)).toThrow(/overflow/);
  });

  it('bulk monotonic ids are strictly increasing even with a frozen clock', () => {
    const ids = generateUlids(5000, { monotonic: true, now: () => 1700000000000 });
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
    expect(new Set(ids).size).toBe(5000);
  });

  it('non-monotonic ids across increasing time sort by time', () => {
    let t = 1000;
    const ids = generateUlids(100, { monotonic: false, now: () => (t += 1) });
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('decodeUlid', () => {
  it('round-trips the timestamp and is case-insensitive', () => {
    const r = decodeUlid('01aryz6s41tsv4rrffq69g5fav');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.timeMs).toBe(1469918176385);
      expect(r.value.date.toISOString()).toBe('2016-07-30T22:36:16.385Z');
      expect(r.value.ulid).toBe('01ARYZ6S41TSV4RRFFQ69G5FAV');
      expect(r.value.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(r.value.randomHex).toHaveLength(20);
    }
  });

  it('converts the max ULID to the max UUID', () => {
    const r = decodeUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(r.ok && r.value.uuid).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
  });

  it('rejects bad input with reasons', () => {
    expect(decodeUlid('').ok).toBe(false);
    const short = decodeUlid('01ARYZ6S41');
    expect(!short.ok && short.error).toMatch(/26 characters/);
    const bad = decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAU');
    expect(!bad.ok && bad.error).toMatch(/excluded/);
    const over = decodeUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(!over.ok && over.error).toMatch(/overflow/);
  });

  it('decodes what it encodes', () => {
    const reader = new RandomReader();
    for (const t of [0, 1, 1700000000123, 2 ** 48 - 1]) {
      const r = decodeUlid(ulid(t, reader));
      expect(r.ok && r.value.timeMs).toBe(t);
    }
  });
});
