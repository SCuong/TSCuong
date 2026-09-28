/** Arbitrary-size integer parsing/formatting in bases 2–36 (BigInt), plus two's complement helpers. */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
export const MAX_INPUT_LENGTH = 20_000;

const PREFIX_BASES: Record<string, number> = { '0x': 16, '0b': 2, '0o': 8 };

export function baseName(base: number): string {
  switch (base) {
    case 2:
      return 'binary';
    case 8:
      return 'octal';
    case 10:
      return 'decimal';
    case 16:
      return 'hexadecimal';
    default:
      return `base ${base}`;
  }
}

function digitValue(ch: string): number {
  const i = DIGITS.indexOf(ch.toLowerCase());
  return i;
}

/**
 * Parse an integer written in `base`.
 * - optional sign (`-`/`+`, also the Unicode minus)
 * - `0x`/`0b`/`0o` prefixes: accepted when they match `base`; in base 10 they switch the base (auto-detect)
 * - spaces and underscores are digit separators; in base 10 "," thousands separators are accepted when well formed
 * - fractions and invalid digits produce a clear message naming the character and its position
 */
export function parseInteger(input: string, base: number): Result<bigint> {
  if (!Number.isInteger(base) || base < 2 || base > 36) return { ok: false, error: 'Base must be a whole number from 2 to 36.' };
  if (input.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: `Input is too long (limit ${MAX_INPUT_LENGTH.toLocaleString('en-US')} characters).` };
  }
  // Track original positions (1-based) so errors point at what the user typed.
  const chars = Array.from(input);
  let i = 0;
  const isSpace = (c: string) => /\s/.test(c);
  while (i < chars.length && isSpace(chars[i])) i++;
  if (i >= chars.length) return { ok: false, error: 'Enter a number.' };

  let negative = false;
  if (chars[i] === '-' || chars[i] === '+' || chars[i] === '−') {
    negative = chars[i] !== '+';
    i++;
    while (i < chars.length && isSpace(chars[i])) i++;
  }

  let effectiveBase = base;
  const maybePrefix = (chars[i] ?? '') + (chars[i + 1] ?? '').toLowerCase();
  const prefixBase = PREFIX_BASES[maybePrefix];
  if (prefixBase !== undefined) {
    if (prefixBase === base) {
      i += 2;
    } else if (base === 10) {
      effectiveBase = prefixBase;
      i += 2;
    }
    // Otherwise the characters are validated as ordinary digits (e.g. "0b1" is valid hex).
  }

  // Well-formed thousands separators in decimal: 1,234,567
  const rest = chars.slice(i).join('');
  const commaGrouped = effectiveBase === 10 && /^\d{1,3}(,\d{3})+\s*$/.test(rest);

  let digits = '';
  let firstDigitPos = -1;
  for (let j = i; j < chars.length; j++) {
    const c = chars[j];
    if (c === '_' || isSpace(c) || (commaGrouped && c === ',')) continue;
    if (c === '.' || (c === ',' && effectiveBase === 10)) {
      // A separator followed by more digits reads as a fraction.
      const tail = chars.slice(j + 1).join('').trim();
      if (c === '.' || /^\d/.test(tail)) {
        return { ok: false, error: 'Fractions are not supported. Enter a whole number.' };
      }
    }
    const d = digitValue(c);
    if (d < 0 || d >= effectiveBase) {
      const shown = c === ' ' ? 'space' : `"${c}"`;
      return {
        ok: false,
        error: `Invalid digit ${shown} at position ${j + 1} for ${baseName(effectiveBase)}${
          effectiveBase <= 10 ? ` (digits 0–${effectiveBase - 1})` : ` (digits 0–9 and a–${DIGITS[effectiveBase - 1]})`
        }.`,
      };
    }
    if (firstDigitPos < 0) firstDigitPos = j;
    digits += c.toLowerCase();
  }
  if (!digits) return { ok: false, error: prefixBase ? 'The prefix is not followed by any digits.' : 'Enter a number.' };

  let value: bigint;
  if (effectiveBase === 16) value = BigInt('0x' + digits);
  else if (effectiveBase === 2) value = BigInt('0b' + digits);
  else if (effectiveBase === 8) value = BigInt('0o' + digits);
  else if (effectiveBase === 10) value = BigInt(digits);
  else value = parseGeneric(digits, effectiveBase);
  return { ok: true, value: negative ? -value : value };
}

/** Divide-and-conquer parse: O(n log n)-ish instead of O(n²) digit-by-digit accumulation for long inputs. */
function parseGeneric(digits: string, base: number): bigint {
  const b = BigInt(base);
  if (digits.length <= 32) {
    let v = 0n;
    for (const c of digits) v = v * b + BigInt(DIGITS.indexOf(c));
    return v;
  }
  const mid = Math.floor(digits.length / 2);
  const low = digits.slice(mid);
  return parseGeneric(digits.slice(0, mid), base) * b ** BigInt(low.length) + parseGeneric(low, base);
}

export type Grouping = 'none' | 'nibble' | 'byte';

/** Digits per group for a base under a grouping mode (0 = no grouping). */
export function groupSize(base: number, grouping: Grouping): number {
  if (grouping === 'none') return 0;
  if (base === 2) return grouping === 'nibble' ? 4 : 8;
  if (base === 16) return grouping === 'nibble' ? 4 : 2;
  return 3;
}

export function groupDigits(digits: string, size: number, separator = ' '): string {
  if (size <= 0 || digits.length <= size) return digits;
  const out: string[] = [];
  let end = digits.length;
  while (end > 0) {
    out.unshift(digits.slice(Math.max(0, end - size), end));
    end -= size;
  }
  return out.join(separator);
}

export interface FormatIntegerOptions {
  grouping?: Grouping;
  uppercase?: boolean;
  /** Left-pad with zeros to this many digits. */
  minDigits?: number;
}

export function formatInteger(value: bigint, base: number, options: FormatIntegerOptions = {}): string {
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString(base);
  if (options.minDigits && digits.length < options.minDigits) digits = digits.padStart(options.minDigits, '0');
  if (options.uppercase) digits = digits.toUpperCase();
  const size = groupSize(base, options.grouping ?? 'none');
  const grouped = groupDigits(digits, size, base === 10 ? ',' : ' ');
  return (negative ? '-' : '') + grouped;
}

/** Number of bits needed for |value| (0 for zero). */
export function bitLength(value: bigint): number {
  const abs = value < 0n ? -value : value;
  return abs === 0n ? 0 : abs.toString(2).length;
}

export function signedRange(bits: number): [bigint, bigint] {
  const half = 1n << BigInt(bits - 1);
  return [-half, half - 1n];
}

export function unsignedMax(bits: number): bigint {
  return (1n << BigInt(bits)) - 1n;
}

/** Two's complement bit pattern of `value` in `bits` bits, or an overflow error for the chosen signedness. */
export function toTwosComplement(value: bigint, bits: number, signed: boolean): Result<bigint> {
  if (signed) {
    const [min, max] = signedRange(bits);
    if (value < min || value > max) {
      return {
        ok: false,
        error: `${value} does not fit in a signed ${bits}-bit integer (range ${min} to ${max}).`,
      };
    }
  } else {
    const max = unsignedMax(bits);
    if (value < 0n || value > max) {
      return {
        ok: false,
        error:
          value < 0n
            ? `${value} is negative, so it does not fit in an unsigned ${bits}-bit integer (range 0 to ${max}). Switch to signed.`
            : `${value} does not fit in an unsigned ${bits}-bit integer (range 0 to ${max}).`,
      };
    }
  }
  return { ok: true, value: BigInt.asUintN(bits, value) };
}

/** Interpret a raw bit pattern (non-negative, at most `bits` bits) as a signed or unsigned integer. */
export function fromTwosComplement(pattern: bigint, bits: number, signed: boolean): Result<bigint> {
  if (pattern < 0n) return { ok: false, error: 'A bit pattern cannot be negative. Enter the raw bits without a sign.' };
  if (pattern > unsignedMax(bits)) {
    return { ok: false, error: `That pattern needs ${bitLength(pattern)} bits, more than the selected ${bits}-bit width.` };
  }
  return { ok: true, value: signed ? BigInt.asIntN(bits, pattern) : pattern };
}
