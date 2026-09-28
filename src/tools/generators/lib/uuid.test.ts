import { describe, expect, it } from 'vitest';
import { formatUuid, generateUuids, normalizeUuid, parseMany, parseUuid } from './uuid';

function info(input: string) {
  const r = parseUuid(input);
  if (!r.ok) throw new Error(r.error);
  return r.info;
}

describe('RFC 9562 test vectors', () => {
  it('decodes the v1 timestamp, clock sequence and node', () => {
    const i = info('C232AB00-9414-11EC-B3C8-9F6BDECED846');
    expect(i.version).toBe(1);
    expect(i.variant).toBe('RFC 9562');
    expect(i.timestamp?.iso).toBe('2022-02-22T19:22:22.0000000Z');
    expect(i.timestamp?.unixMs).toBe(1645557742000);
    expect(i.clockSeq).toBe(0x33c8);
    expect(i.node).toBe('9f:6b:de:ce:d8:46');
    expect(i.nodeIsRandom).toBe(true);
  });

  it('decodes the v6 timestamp to the same instant as v1', () => {
    const i = info('1EC9414C-232A-6B00-B3C8-9F6BDECED846');
    expect(i.version).toBe(6);
    expect(i.timestamp?.iso).toBe('2022-02-22T19:22:22.0000000Z');
    expect(i.clockSeq).toBe(0x33c8);
  });

  it('decodes the v7 millisecond timestamp', () => {
    const i = info('017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
    expect(i.version).toBe(7);
    expect(i.variant).toBe('RFC 9562');
    expect(i.timestamp?.unixMs).toBe(0x017f22e279b0);
    expect(i.timestamp?.iso).toBe('2022-02-22T19:22:22.000Z');
  });

  it('keeps 100 ns precision for v1', () => {
    // One tick after the RFC vector.
    const i = info('C232AB01-9414-11EC-B3C8-9F6BDECED846');
    expect(i.timestamp?.iso).toBe('2022-02-22T19:22:22.0000001Z');
  });

  it('recognizes v4 without a timestamp', () => {
    const i = info('919108f7-52d1-4320-9bac-f847db4148a8');
    expect(i.version).toBe(4);
    expect(i.timestamp).toBeUndefined();
  });
});

describe('parseUuid', () => {
  it('accepts braces, urn prefix, uppercase and no hyphens', () => {
    for (const s of ['{017F22E2-79B0-7CC3-98C4-DC0C0C07398F}', 'urn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f', '017F22E279B07CC398C4DC0C0C07398F']) {
      expect(info(s).canonical).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
    }
  });

  it('identifies nil and max', () => {
    expect(info('00000000-0000-0000-0000-000000000000').special).toBe('nil');
    expect(info('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF').special).toBe('max');
  });

  it('reports variants', () => {
    expect(info('00000000-0000-1000-0000-000000000001').variant).toBe('NCS (reserved)');
    expect(info('00000000-0000-1000-c000-000000000001').variant).toBe('Microsoft (reserved)');
    expect(info('00000000-0000-1000-e000-000000000001').variant).toBe('Future (reserved)');
    // Non-RFC variant: no timestamp decoding.
    expect(info('00000000-0000-1000-c000-000000000001').timestamp).toBeUndefined();
  });

  it('explains invalid input', () => {
    const bad = parseUuid('not-a-uuid');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/hexadecimal/);
    const short = parseUuid('017F22E2-79B0-7CC3-98C4');
    if (!short.ok) expect(short.error).toMatch(/found 20/);
    const hy = parseUuid('017F22E279B0-7CC3-98C4-DC0C-0C07398F');
    if (!hy.ok) expect(hy.error).toMatch(/hyphens/);
    expect(parseUuid('   ').ok).toBe(false);
  });

  it('parses many tokens separated by whitespace and commas', () => {
    const r = parseMany('017F22E2-79B0-7CC3-98C4-DC0C0C07398F, "c232ab00-9414-11ec-b3c8-9f6bdeced846"\nbad');
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.ok)).toEqual([true, true, false]);
  });

  it('normalizeUuid rejects 31 or 33 digits', () => {
    expect(normalizeUuid('a'.repeat(31))).toBeNull();
    expect(normalizeUuid('a'.repeat(33))).toBeNull();
  });
});

describe('generateUuids', () => {
  const plain = { uppercase: false, braces: false, hyphens: true };

  it('generates each version with the right version nibble', () => {
    for (const [kind, v] of [
      ['v1', 1],
      ['v4', 4],
      ['v6', 6],
      ['v7', 7],
    ] as const) {
      const ids = generateUuids(kind, 20, plain);
      expect(ids).toHaveLength(20);
      for (const id of ids) {
        const i = info(id);
        expect(i.version).toBe(v);
        expect(i.variant).toBe('RFC 9562');
      }
      expect(new Set(ids).size).toBe(20);
    }
  });

  it('v1/v6/v7 timestamps are close to now', () => {
    const now = Date.now();
    for (const kind of ['v1', 'v6', 'v7'] as const) {
      const t = info(generateUuids(kind, 1, plain)[0]).timestamp!.unixMs;
      expect(Math.abs(t - now)).toBeLessThan(5000);
    }
  });

  it('v7 ids sort in generation order', () => {
    const ids = generateUuids('v7', 2000, plain);
    expect([...ids].sort()).toEqual(ids);
  });

  it('produces nil and max', () => {
    expect(generateUuids('nil', 2, plain)).toEqual(['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000']);
    expect(generateUuids('max', 1, plain)[0]).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
  });

  it('clamps the count to 1..10000', () => {
    expect(generateUuids('v4', 0, plain)).toHaveLength(1);
    expect(generateUuids('v4', 50_000, plain)).toHaveLength(10_000);
  });

  it('formats', () => {
    const id = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
    expect(formatUuid(id, { uppercase: true, braces: true, hyphens: false })).toBe('{017F22E279B07CC398C4DC0C0C07398F}');
    expect(formatUuid(id, { uppercase: false, braces: false, hyphens: true })).toBe(id);
  });
});
