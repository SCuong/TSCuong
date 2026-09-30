import { describe, expect, it } from 'vitest';
import { fromRoman, toRoman } from './roman';

describe('roman numerals', () => {
  it('converts known values', () => {
    const cases: Array<[number, string]> = [
      [1, 'I'],
      [4, 'IV'],
      [9, 'IX'],
      [14, 'XIV'],
      [40, 'XL'],
      [90, 'XC'],
      [400, 'CD'],
      [1994, 'MCMXCIV'],
      [2026, 'MMXXVI'],
      [3999, 'MMMCMXCIX'],
    ];
    for (const [n, r] of cases) {
      expect(toRoman(n)).toMatchObject({ ok: true, value: r });
      expect(fromRoman(r)).toMatchObject({ ok: true, value: n });
    }
  });

  it('round-trips every value from 1 to 3999', () => {
    for (let n = 1; n <= 3999; n++) {
      const r = toRoman(n);
      if (!r.ok) throw new Error(r.error);
      const back = fromRoman(r.value);
      expect(back.ok && back.value).toBe(n);
    }
  });

  it('is case-insensitive and trims', () => {
    expect(fromRoman('  mcmxciv ')).toMatchObject({ ok: true, value: 1994 });
  });

  it('breaks numbers into parts', () => {
    const r = toRoman(1994);
    expect(r.ok && r.parts.map((p) => p.symbol)).toEqual(['M', 'CM', 'XC', 'IV']);
  });

  it.each(['IIII', 'VV', 'IC', 'MMMM', 'XM', 'IL', 'VX', 'IIV', 'XIIII', 'CCCC', 'DD', 'LL', 'IXIX', 'IVI', 'XCX', 'CMM'])(
    'rejects %s',
    (bad) => {
      expect(fromRoman(bad).ok).toBe(false);
    },
  );

  it('explains errors', () => {
    expect(fromRoman('')).toEqual({ ok: false, error: 'Enter a Roman numeral.' });
    expect(fromRoman('XAV')).toMatchObject({ ok: false, error: expect.stringMatching(/'A' at position 2/) });
    expect(fromRoman('IC')).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid subtraction/) });
    expect(fromRoman('IIII')).toMatchObject({ ok: false, error: expect.stringMatching(/more than three/) });
    expect(fromRoman('IXIX')).toMatchObject({ ok: false, error: expect.stringMatching(/standard form/) });
    expect(fromRoman('MMMM')).toMatchObject({ ok: false, error: expect.stringMatching(/3999/) });
    expect(fromRoman('XIV😀')).toMatchObject({ ok: false });
    expect(toRoman(0).ok).toBe(false);
    expect(toRoman(4000).ok).toBe(false);
    expect(toRoman(2.5).ok).toBe(false);
    expect(toRoman(-3).ok).toBe(false);
  });

  it('names the offending character at its real position', () => {
    // Regression: code-unit indexing pointed at half of the emoji, and "ß" (upper case "SS") shifted positions.
    expect(fromRoman('XIV😀I')).toMatchObject({ ok: false, error: expect.stringMatching(/^'😀' at position 4 /) });
    expect(fromRoman('ßX')).toMatchObject({ ok: false, error: expect.stringMatching(/^'ß' at position 1 /) });
    expect(fromRoman('xiv')).toMatchObject({ ok: true, value: 14 });
  });
});
