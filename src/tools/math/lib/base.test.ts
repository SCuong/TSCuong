import { describe, expect, it } from 'vitest';
import {
  bitLength,
  formatInteger,
  fromTwosComplement,
  groupDigits,
  parseInteger,
  toTwosComplement,
} from './base';

const v = (text: string, base: number) => {
  const r = parseInteger(text, base);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (text: string, base: number) => {
  const r = parseInteger(text, base);
  if (r.ok) throw new Error(`expected error for ${text}`);
  return r.error;
};

describe('parseInteger', () => {
  it('parses the common bases', () => {
    expect(v('255', 10)).toBe(255n);
    expect(v('ff', 16)).toBe(255n);
    expect(v('FF', 16)).toBe(255n);
    expect(v('11111111', 2)).toBe(255n);
    expect(v('377', 8)).toBe(255n);
    expect(v('73', 36)).toBe(255n);
    expect(v('zz', 36)).toBe(1295n);
    expect(v('0', 7)).toBe(0n);
    expect(v('121', 3)).toBe(16n);
  });

  it('accepts matching prefixes and auto-detects them in decimal', () => {
    expect(v('0xFF', 16)).toBe(255n);
    expect(v('0XfF', 16)).toBe(255n);
    expect(v('0b1010', 2)).toBe(10n);
    expect(v('0o17', 8)).toBe(15n);
    expect(v('0x1F', 10)).toBe(31n);
    expect(v('0b101', 10)).toBe(5n);
    expect(v('0o777', 10)).toBe(511n);
    // "0b1" is a valid hex number, not a binary prefix, in base 16
    expect(v('0b1', 16)).toBe(0xb1n);
    expect(err('0x', 16)).toMatch(/prefix is not followed/);
  });

  it('handles separators, whitespace and signs', () => {
    expect(v('1_000_000', 10)).toBe(1000000n);
    expect(v('1 000 000', 10)).toBe(1000000n);
    expect(v('1,234,567', 10)).toBe(1234567n);
    expect(v('1111 0000', 2)).toBe(240n);
    expect(v('  -42  ', 10)).toBe(-42n);
    expect(v('+42', 10)).toBe(42n);
    expect(v('−42', 10)).toBe(-42n);
    expect(v('-0xff', 16)).toBe(-255n);
    expect(v('- 5', 10)).toBe(-5n);
  });

  it('rejects fractions clearly', () => {
    expect(err('1.5', 10)).toBe('Fractions are not supported. Enter a whole number.');
    expect(err('ff.8', 16)).toMatch(/Fractions are not supported/);
    expect(err('1,5', 10)).toMatch(/Fractions are not supported/);
  });

  it('names the invalid digit and its position', () => {
    expect(err('1012', 2)).toBe('Invalid digit "2" at position 4 for binary (digits 0–1).');
    expect(err('128', 8)).toBe('Invalid digit "8" at position 3 for octal (digits 0–7).');
    expect(err('12g4', 16)).toBe('Invalid digit "g" at position 3 for hexadecimal (digits 0–9 and a–f).');
    expect(err('1e5', 10)).toMatch(/"e" at position 2 for decimal/);
    expect(err('  -9z', 10)).toMatch(/"z" at position 5/);
    expect(err('😀', 10)).toMatch(/Invalid digit "😀" at position 1/);
    expect(err('xyz', 20)).toMatch(/base 20 \(digits 0–9 and a–j\)/);
  });

  it('rejects empty input, bad bases and very long input', () => {
    expect(err('', 10)).toBe('Enter a number.');
    expect(err('   ', 10)).toBe('Enter a number.');
    expect(err('-', 10)).toBe('Enter a number.');
    expect(err('1', 1)).toMatch(/Base must be/);
    expect(err('1', 37)).toMatch(/Base must be/);
    expect(err('1'.repeat(20_001), 10)).toMatch(/too long/);
  });

  it('handles huge numbers exactly (2^200)', () => {
    const big = 2n ** 200n;
    const dec = big.toString(10);
    expect(v(dec, 10)).toBe(big);
    expect(v('1' + '0'.repeat(200), 2)).toBe(big);
    expect(v('1' + '0'.repeat(50), 16)).toBe(big);
    expect(v(big.toString(36), 36)).toBe(big);
    expect(v(big.toString(7), 7)).toBe(big);
    expect(v('-' + big.toString(13), 13)).toBe(-big);
    // Long generic-base input (divide and conquer path)
    const huge = 3n ** 5000n;
    expect(v(huge.toString(36), 36)).toBe(huge);
  });
});

describe('formatInteger / grouping', () => {
  it('formats in any base with grouping', () => {
    expect(formatInteger(255n, 16, { uppercase: true })).toBe('FF');
    expect(formatInteger(255n, 2, { grouping: 'nibble' })).toBe('1111 1111');
    expect(formatInteger(256n, 2, { grouping: 'nibble' })).toBe('1 0000 0000');
    expect(formatInteger(256n, 2, { grouping: 'byte' })).toBe('1 00000000');
    expect(formatInteger(0xdeadbeefn, 16, { grouping: 'byte', uppercase: true })).toBe('DE AD BE EF');
    expect(formatInteger(0xdeadbeefn, 16, { grouping: 'nibble' })).toBe('dead beef');
    expect(formatInteger(1234567n, 10, { grouping: 'nibble' })).toBe('1,234,567');
    expect(formatInteger(-1234567n, 10, { grouping: 'byte' })).toBe('-1,234,567');
    expect(formatInteger(123n, 10, { grouping: 'byte' })).toBe('123');
    expect(formatInteger(5n, 2, { minDigits: 8 })).toBe('00000101');
    expect(formatInteger(0n, 10)).toBe('0');
    expect(formatInteger(-255n, 16)).toBe('-ff');
  });

  it('grouped output parses back', () => {
    const n = 2n ** 200n + 12345n;
    for (const base of [2, 8, 10, 16]) {
      expect(v(formatInteger(n, base, { grouping: 'nibble' }), base)).toBe(n);
      expect(v(formatInteger(-n, base, { grouping: 'byte' }), base)).toBe(-n);
    }
  });

  it('groupDigits', () => {
    expect(groupDigits('12345', 0)).toBe('12345');
    expect(groupDigits('123', 3)).toBe('123');
    expect(groupDigits('1234', 3, ',')).toBe('1,234');
  });

  it('bitLength', () => {
    expect(bitLength(0n)).toBe(0);
    expect(bitLength(1n)).toBe(1);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(-256n)).toBe(9);
    expect(bitLength(2n ** 200n)).toBe(201);
  });
});

describe("two's complement", () => {
  it('encodes signed boundaries', () => {
    expect(toTwosComplement(-128n, 8, true)).toEqual({ ok: true, value: 0x80n });
    expect(toTwosComplement(127n, 8, true)).toEqual({ ok: true, value: 0x7fn });
    expect(toTwosComplement(-1n, 8, true)).toEqual({ ok: true, value: 0xffn });
    expect(toTwosComplement(-1n, 64, true)).toEqual({ ok: true, value: 2n ** 64n - 1n });
    expect(toTwosComplement(-(2n ** 63n), 64, true)).toEqual({ ok: true, value: 2n ** 63n });
    expect(toTwosComplement(-32768n, 16, true)).toEqual({ ok: true, value: 0x8000n });
  });

  it('reports overflow', () => {
    const r = toTwosComplement(255n, 8, true);
    expect(r).toEqual({ ok: false, error: '255 does not fit in a signed 8-bit integer (range -128 to 127).' });
    expect(toTwosComplement(-129n, 8, true).ok).toBe(false);
    expect(toTwosComplement(128n, 8, true).ok).toBe(false);
    expect(toTwosComplement(256n, 8, false).ok).toBe(false);
    expect(toTwosComplement(255n, 8, false)).toEqual({ ok: true, value: 255n });
    const neg = toTwosComplement(-1n, 32, false);
    expect(neg.ok).toBe(false);
    expect(!neg.ok && neg.error).toMatch(/negative.*Switch to signed/);
    expect(toTwosComplement(2n ** 64n, 64, false).ok).toBe(false);
    expect(toTwosComplement(2n ** 64n - 1n, 64, false).ok).toBe(true);
  });

  it('decodes bit patterns', () => {
    expect(fromTwosComplement(0x80n, 8, true)).toEqual({ ok: true, value: -128n });
    expect(fromTwosComplement(0x80n, 8, false)).toEqual({ ok: true, value: 128n });
    expect(fromTwosComplement(0xffffn, 16, true)).toEqual({ ok: true, value: -1n });
    expect(fromTwosComplement(0x1ffn, 8, true).ok).toBe(false);
    expect(fromTwosComplement(-1n, 8, true).ok).toBe(false);
  });
});
