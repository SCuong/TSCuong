import { describe, expect, it } from 'vitest';
import { applyOp, interpret, parseOperand, parseShiftCount, popcount, toBits, toHex, type Op, type Width } from './bitwise';

const run = (op: Op, a: bigint, b: bigint, w: Width) => {
  const r = applyOp(op, a, b, w);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

const MAX64 = 2n ** 64n - 1n;

describe('parseOperand', () => {
  it('parses decimal within the signed/unsigned range', () => {
    expect(parseOperand('-1', 'dec', 8, true)).toEqual({ ok: true, value: 0xffn });
    expect(parseOperand('-128', 'dec', 8, true)).toEqual({ ok: true, value: 0x80n });
    expect(parseOperand('255', 'dec', 8, false)).toEqual({ ok: true, value: 255n });
    expect(parseOperand('255', 'dec', 8, true).ok).toBe(false);
    expect(parseOperand('-1', 'dec', 8, false).ok).toBe(false);
    expect(parseOperand('256', 'dec', 8, false).ok).toBe(false);
    expect(parseOperand('18446744073709551615', 'dec', 64, false)).toEqual({ ok: true, value: MAX64 });
    expect(parseOperand('-9223372036854775808', 'dec', 64, true)).toEqual({ ok: true, value: 2n ** 63n });
    expect(parseOperand('9223372036854775808', 'dec', 64, true).ok).toBe(false);
  });

  it('parses hex/binary as raw bit patterns', () => {
    expect(parseOperand('ff', 'hex', 8, true)).toEqual({ ok: true, value: 255n });
    expect(parseOperand('0xFFFF_FFFF_FFFF_FFFF', 'hex', 64, true)).toEqual({ ok: true, value: MAX64 });
    expect(parseOperand('1 0000 0000', 'bin', 8, false).ok).toBe(false);
    expect(parseOperand('1010', 'bin', 8, false)).toEqual({ ok: true, value: 10n });
    expect(parseOperand('-1', 'hex', 16, true)).toEqual({ ok: true, value: 0xffffn });
    expect(parseOperand('-1', 'hex', 16, false).ok).toBe(false);
    expect(parseOperand('12', 'bin', 8, false)).toMatchObject({ ok: false, error: expect.stringMatching(/"2" at position 2/) });
    expect(parseOperand('', 'dec', 8, false).ok).toBe(false);
  });

  it('parses shift counts', () => {
    expect(parseShiftCount('3', 'dec')).toEqual({ ok: true, value: 3n });
    expect(parseShiftCount('100', 'dec')).toEqual({ ok: true, value: 100n });
    expect(parseShiftCount('-1', 'dec').ok).toBe(false);
    expect(parseShiftCount('0x10', 'hex')).toEqual({ ok: true, value: 16n });
  });
});

describe('applyOp', () => {
  it('logic operations', () => {
    expect(run('and', 0b1100n, 0b1010n, 8)).toBe(0b1000n);
    expect(run('or', 0b1100n, 0b1010n, 8)).toBe(0b1110n);
    expect(run('xor', 0b1100n, 0b1010n, 8)).toBe(0b0110n);
    expect(run('nand', 0b1100n, 0b1010n, 8)).toBe(0b11110111n);
    expect(run('nor', 0b1100n, 0b1010n, 8)).toBe(0b11110001n);
    expect(run('xnor', 0b1100n, 0b1010n, 8)).toBe(0b11111001n);
    expect(run('not', 0n, 0n, 8)).toBe(0xffn);
    expect(run('not', 0n, 0n, 64)).toBe(MAX64);
    expect(run('not', MAX64, 0n, 64)).toBe(0n);
  });

  it('64-bit boundaries', () => {
    expect(run('and', MAX64, 2n ** 63n, 64)).toBe(2n ** 63n);
    expect(run('xor', MAX64, MAX64, 64)).toBe(0n);
    expect(run('or', 2n ** 63n, 1n, 64)).toBe(2n ** 63n + 1n);
    expect(run('shl', 1n, 63n, 64)).toBe(2n ** 63n);
    expect(run('shl', 1n, 64n, 64)).toBe(0n);
    expect(run('shl', MAX64, 1n, 64)).toBe(MAX64 - 1n);
    expect(run('shr', 2n ** 63n, 63n, 64)).toBe(1n);
    expect(run('sar', 2n ** 63n, 63n, 64)).toBe(MAX64);
    expect(run('sar', 2n ** 63n, 200n, 64)).toBe(MAX64);
    expect(run('rol', 2n ** 63n, 1n, 64)).toBe(1n);
    expect(run('ror', 1n, 1n, 64)).toBe(2n ** 63n);
    expect(interpret(run('shl', 1n, 63n, 64), 64, true)).toBe(-(2n ** 63n));
  });

  it('shifts', () => {
    expect(run('shl', 0b1n, 3n, 8)).toBe(8n);
    expect(run('shl', 0x81n, 1n, 8)).toBe(0x02n);
    // -16 >> 2 = -4 (arithmetic), >>> 2 = 0x3C (logical)
    expect(run('sar', 0xf0n, 2n, 8)).toBe(0xfcn);
    expect(interpret(run('sar', 0xf0n, 2n, 8), 8, true)).toBe(-4n);
    expect(run('shr', 0xf0n, 2n, 8)).toBe(0x3cn);
    expect(run('sar', 0x70n, 2n, 8)).toBe(0x1cn);
    expect(run('shr', 0xffn, 8n, 8)).toBe(0n);
    expect(run('sar', 0x80n, 100n, 8)).toBe(0xffn);
    expect(run('sar', 0x40n, 100n, 8)).toBe(0n);
    expect(run('shl', 5n, 0n, 8)).toBe(5n);
    expect(applyOp('shl', 1n, -1n, 8).ok).toBe(false);
  });

  it('matches JavaScript 32-bit semantics', () => {
    const cases: Array<[number, number]> = [
      [-16, 2],
      [0x7fffffff, 1],
      [-1, 31],
      [123456789, 7],
    ];
    for (const [a, s] of cases) {
      const pa = BigInt.asUintN(32, BigInt(a));
      expect(interpret(run('sar', pa, BigInt(s), 32), 32, true)).toBe(BigInt(a >> s));
      expect(run('shr', pa, BigInt(s), 32)).toBe(BigInt(a >>> s));
      expect(interpret(run('shl', pa, BigInt(s), 32), 32, true)).toBe(BigInt(a << s));
    }
  });

  it('rotates', () => {
    expect(run('rol', 0b10000001n, 1n, 8)).toBe(0b00000011n);
    expect(run('ror', 0b10000001n, 1n, 8)).toBe(0b11000000n);
    expect(run('rol', 0x12n, 8n, 8)).toBe(0x12n);
    expect(run('rol', 0x12n, 12n, 8)).toBe(0x21n);
    expect(run('ror', 0x1234n, 4n, 16)).toBe(0x4123n);
    expect(run('rol', 0x12345678n, 36n, 32)).toBe(0x23456781n);
  });
});

describe('helpers', () => {
  it('formats bits, hex and popcount', () => {
    expect(toBits(5n, 8)).toBe('00000101');
    expect(toBits(MAX64, 64)).toBe('1'.repeat(64));
    expect(toHex(0xabn, 16)).toBe('00AB');
    expect(toHex(MAX64, 64)).toBe('FFFFFFFFFFFFFFFF');
    expect(popcount(0xffn)).toBe(8);
    expect(popcount(0n)).toBe(0);
    expect(interpret(0xffn, 8, true)).toBe(-1n);
    expect(interpret(0xffn, 8, false)).toBe(255n);
  });
});
