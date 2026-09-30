/** Number formatting shared by the math-a tools (unit, percentage and transfer calculators). */

export interface FormatOptions {
  /** Significant digits kept (1–17). Default 12, which hides binary floating-point noise. */
  precision?: number;
  /** Thousands separators (",") for the integer part. Default true. */
  grouping?: boolean;
  /**
   * Round the integer part too, to exactly `precision` significant digits (12,345 → 12,300 at 3 digits),
   * for controls where the user picks the number of significant digits. By default every integer digit
   * is kept, so a large result never shows made-up trailing zeros (1,234,567,890,123.45 stays intact).
   */
  strictPrecision?: boolean;
}

const SCI_HIGH = 1e15;
const SCI_LOW = 1e-7;

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(precision: number, grouping: boolean): Intl.NumberFormat {
  const key = `${precision}:${grouping}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { maximumSignificantDigits: precision, useGrouping: grouping });
    formatters.set(key, f);
  }
  return f;
}

/** Round to `precision` significant digits as a Number (removes 0.1 + 0.2 style noise). */
export function roundSignificant(value: number, precision = 12): number {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(clampPrecision(precision)));
}

function clampPrecision(p: number): number {
  return Math.min(17, Math.max(1, Math.round(p)));
}

/**
 * Human-friendly, copy-safe number formatting:
 * - `0.1 + 0.2` → "0.3" (rounded to significant digits, trailing zeros dropped)
 * - very large or very small magnitudes → scientific notation ("1.5e21", "6.2e-9")
 * - thousands separators optional, locale-independent ("1,234.5")
 */
export function formatNumber(value: number, options: FormatOptions = {}): string {
  const precision = clampPrecision(options.precision ?? 12);
  const grouping = options.grouping ?? true;
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (value === 0) return '0';
  const intDigits = Math.abs(value) >= 1 && Math.abs(value) < SCI_HIGH ? String(Math.trunc(Math.abs(value))).length : 0;
  const digits = options.strictPrecision || intDigits <= precision ? precision : Math.min(15, intDigits + 2);
  const rounded = roundSignificant(value, digits);
  const abs = Math.abs(rounded);
  if (abs >= SCI_HIGH || abs < SCI_LOW) {
    const [mantissa, exponent] = rounded.toExponential(precision - 1).split('e');
    const m = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa;
    return `${m}e${exponent.replace('+', '')}`;
  }
  return formatter(digits, grouping).format(rounded);
}

/** Parse a user-typed decimal number: allows spaces, underscores and "," thousands separators, and a leading "+". */
export function parseNumber(input: string): number | null {
  let text = input.trim().replace(/[\s_\u00a0\u202f]/g, '').replace(/^\+/, '').replace(/\u2212/g, '-');
  if (!text) return null;
  if (text.includes(',')) {
    // Only accept commas that are proper thousands separators, e.g. 1,234,567.5
    if (!/^-?\d{1,3}(,\d{3})+(\.\d*)?([eE][+-]?\d+)?$/.test(text)) return null;
    text = text.replace(/,/g, '');
  }
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
