/** Fixed-width bitwise operations on BigInt bit patterns (8/16/32/64 bits). */
import { parseInteger, signedRange, unsignedMax, type Result } from './base';

export type Width = 8 | 16 | 32 | 64;
export const WIDTHS: Width[] = [8, 16, 32, 64];
export type Radix = 'dec' | 'hex' | 'bin';
export const RADIX_BASE: Record<Radix, number> = { dec: 10, hex: 16, bin: 2 };

export type Op = 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor' | 'not' | 'shl' | 'sar' | 'shr' | 'rol' | 'ror';

export interface OpInfo {
  id: Op;
  symbol: string;
  name: string;
  /** Unary ops ignore B; shift/rotate ops use B as the bit count. */
  kind: 'binary' | 'unary' | 'shift';
}

export const OPS: OpInfo[] = [
  { id: 'and', symbol: '&', name: 'AND', kind: 'binary' },
  { id: 'or', symbol: '|', name: 'OR', kind: 'binary' },
  { id: 'xor', symbol: '^', name: 'XOR', kind: 'binary' },
  { id: 'not', symbol: '~', name: 'NOT', kind: 'unary' },
  { id: 'nand', symbol: '~&', name: 'NAND', kind: 'binary' },
  { id: 'nor', symbol: '~|', name: 'NOR', kind: 'binary' },
  { id: 'xnor', symbol: '~^', name: 'XNOR', kind: 'binary' },
  { id: 'shl', symbol: '<<', name: 'Shift left', kind: 'shift' },
  { id: 'sar', symbol: '>>', name: 'Arithmetic shift right', kind: 'shift' },
  { id: 'shr', symbol: '>>>', name: 'Logical shift right', kind: 'shift' },
  { id: 'rol', symbol: 'rol', name: 'Rotate left', kind: 'shift' },
  { id: 'ror', symbol: 'ror', name: 'Rotate right', kind: 'shift' },
];

export function opInfo(op: Op): OpInfo {
  return OPS.find((o) => o.id === op)!;
}

export function mask(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

/**
 * Parse an operand into a raw `width`-bit pattern.
 * - Decimal input is a value: it must fit the signed or unsigned range of the width.
 * - Hex/binary input is a bit pattern of at most `width` bits (a leading "-" is allowed in signed mode and
 *   means the two's complement of that magnitude).
 */
export function parseOperand(text: string, radix: Radix, width: Width, signed: boolean): Result<bigint> {
  const parsed = parseInteger(text, RADIX_BASE[radix]);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const [smin, smax] = signedRange(width);
  const umax = unsignedMax(width);
  if (radix === 'dec') {
    if (signed && (v < smin || v > smax)) {
      return { ok: false, error: `${v} does not fit in a signed ${width}-bit integer (range ${smin} to ${smax}).` };
    }
    if (!signed && (v < 0n || v > umax)) {
      return {
        ok: false,
        error:
          v < 0n
            ? `Negative numbers need signed mode (unsigned ${width}-bit range is 0 to ${umax}).`
            : `${v} does not fit in an unsigned ${width}-bit integer (max ${umax}).`,
      };
    }
    return { ok: true, value: BigInt.asUintN(width, v) };
  }
  if (v < 0n) {
    if (!signed) return { ok: false, error: 'Negative numbers need signed mode.' };
    if (v < smin) return { ok: false, error: `-${(-v).toString(RADIX_BASE[radix])} is below the signed ${width}-bit minimum.` };
    return { ok: true, value: BigInt.asUintN(width, v) };
  }
  if (v > umax) {
    return { ok: false, error: `That value has more than ${width} bits. Choose a wider width or a smaller value.` };
  }
  return { ok: true, value: v };
}

/** Apply `op` to the `width`-bit patterns `a` and `b` (for shifts/rotations `b` is the bit count). */
export function applyOp(op: Op, a: bigint, b: bigint, width: Width): Result<bigint> {
  const m = mask(width);
  const w = BigInt(width);
  a &= m;
  switch (op) {
    case 'and':
      return { ok: true, value: a & b & m };
    case 'or':
      return { ok: true, value: (a | b) & m };
    case 'xor':
      return { ok: true, value: (a ^ b) & m };
    case 'nand':
      return { ok: true, value: ~(a & b) & m };
    case 'nor':
      return { ok: true, value: ~(a | b) & m };
    case 'xnor':
      return { ok: true, value: ~(a ^ b) & m };
    case 'not':
      return { ok: true, value: ~a & m };
    default:
      break;
  }
  if (b < 0n) return { ok: false, error: 'The shift amount cannot be negative.' };
  switch (op) {
    case 'shl':
      return { ok: true, value: b >= w ? 0n : (a << b) & m };
    case 'shr':
      return { ok: true, value: b >= w ? 0n : a >> b };
    case 'sar': {
      const signedA = BigInt.asIntN(width, a);
      const k = b >= w ? w - 1n : b;
      return { ok: true, value: BigInt.asUintN(width, signedA >> k) };
    }
    case 'rol':
    case 'ror': {
      const k = b % w;
      if (k === 0n) return { ok: true, value: a };
      const left = op === 'rol' ? k : w - k;
      return { ok: true, value: ((a << left) | (a >> (w - left))) & m };
    }
    default:
      return { ok: false, error: 'Unknown operation.' };
  }
}

/** Parse a shift/rotate bit count (a plain non-negative integer; counts ≥ width are allowed). */
export function parseShiftCount(text: string, radix: Radix): Result<bigint> {
  const parsed = parseInteger(text, RADIX_BASE[radix]);
  if (!parsed.ok) return parsed;
  if (parsed.value < 0n) return { ok: false, error: 'The shift amount cannot be negative.' };
  if (parsed.value > 1_000_000n) return { ok: false, error: 'The shift amount is too large.' };
  return parsed;
}

export function interpret(pattern: bigint, width: Width, signed: boolean): bigint {
  return signed ? BigInt.asIntN(width, pattern) : BigInt.asUintN(width, pattern);
}

export function toBits(pattern: bigint, width: Width): string {
  return BigInt.asUintN(width, pattern).toString(2).padStart(width, '0');
}

export function toHex(pattern: bigint, width: Width): string {
  return BigInt.asUintN(width, pattern)
    .toString(16)
    .toUpperCase()
    .padStart(width / 4, '0');
}

export function popcount(pattern: bigint): number {
  let n = 0;
  for (const c of pattern.toString(2)) if (c === '1') n++;
  return n;
}
