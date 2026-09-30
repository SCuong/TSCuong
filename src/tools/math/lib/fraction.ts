/** Exact rational numbers over BigInt. Always normalized: gcd(num, den) = 1 and den > 0. */
export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint = 1n) {
    if (den === 0n) throw new RangeError('Division by zero');
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num < 0n ? -num : num, den);
    this.num = g > 1n ? num / g : num;
    this.den = g > 1n ? den / g : den;
  }

  static readonly ZERO = new Fraction(0n);
  static readonly ONE = new Fraction(1n);

  static from(n: number | bigint): Fraction {
    if (typeof n === 'bigint') return new Fraction(n);
    const parsed = Fraction.parse(String(n));
    if (!parsed) throw new RangeError(`Cannot represent ${n} exactly`);
    return parsed;
  }

  /** Parses "3", "-2", "0.25", "1/3", "-1.5/2", "1e-3", "2.5e2". Returns null when invalid. */
  static parse(text: string): Fraction | null {
    const s = text.trim().replace(/−/g, '-');
    if (!s) return null;
    const slash = s.indexOf('/');
    if (slash >= 0) {
      // "1/2/3" is ambiguous (1/6 or 3/2?), so only a single fraction bar is accepted.
      if (s.indexOf('/', slash + 1) >= 0) return null;
      const a = Fraction.parse(s.slice(0, slash));
      const b = Fraction.parse(s.slice(slash + 1));
      if (!a || !b || b.isZero()) return null;
      return a.div(b);
    }
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (!m[2] && !m[3])) return null;
    const [, sign, int = '', frac = ''] = m;
    const exp = m[4] ? Number(m[4]) : 0;
    if (Math.abs(exp) > 400) return null;
    let num = BigInt((int || '0') + frac);
    let den = 10n ** BigInt(frac.length);
    if (exp > 0) num *= 10n ** BigInt(exp);
    else if (exp < 0) den *= 10n ** BigInt(-exp);
    if (sign === '-') num = -num;
    return new Fraction(num, den);
  }

  isZero(): boolean {
    return this.num === 0n;
  }
  isInteger(): boolean {
    return this.den === 1n;
  }
  neg(): Fraction {
    return new Fraction(-this.num, this.den);
  }
  abs(): Fraction {
    return this.num < 0n ? this.neg() : this;
  }
  add(o: Fraction): Fraction {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  sub(o: Fraction): Fraction {
    return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  mul(o: Fraction): Fraction {
    return new Fraction(this.num * o.num, this.den * o.den);
  }
  div(o: Fraction): Fraction {
    if (o.num === 0n) throw new RangeError('Division by zero');
    return new Fraction(this.num * o.den, this.den * o.num);
  }
  equals(o: Fraction): boolean {
    return this.num === o.num && this.den === o.den;
  }
  toNumber(): number {
    const n = this.num;
    const d = this.den;
    const nf = Number(n);
    const df = Number(d);
    if (Number.isFinite(nf) && Number.isFinite(df)) return nf / df;
    // Scale both parts by the same power of two so they fit a double (the quotient keeps ~53 bits).
    const shift = BigInt(Math.max(0, Math.max(bitLength(n), bitLength(d)) - 1000));
    return Number(n >> shift) / Number(d >> shift);
  }
  toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }
  /**
   * Decimal string with up to `digits` significant digits (trailing zeros trimmed). Integer digits are
   * never rounded away (12345678901/2 → 6172839450.5, not 6172839500), and values beyond the double
   * range are formatted exactly from the BigInt parts instead of turning into Infinity.
   */
  toDecimal(digits = 10): string {
    if (this.den === 1n) return this.num.toString();
    const v = this.toNumber();
    const abs = Math.abs(v);
    if (!Number.isFinite(v) || abs === 0 || abs >= 1e15 || abs < 1e-6) return this.toExponential(digits);
    const intDigits = abs >= 1 ? String(Math.trunc(abs)).length : 0;
    const r = Number(v.toPrecision(Math.min(15, Math.max(digits, intDigits + 2))));
    return Object.is(r, -0) ? '0' : String(r);
  }
  /** Scientific notation ("1.25e+400") computed exactly from the BigInt parts, rounded half up. */
  toExponential(digits = 10): string {
    if (this.num === 0n) return '0';
    const negative = this.num < 0n;
    const num = negative ? -this.num : this.num;
    const den = this.den;
    // Estimate the decimal exponent from the digit counts, then correct it.
    let exp = num.toString().length - den.toString().length;
    const scaled = (e: number): bigint => {
      // floor(num / den × 10^(digits − e)) — one extra digit kept for rounding.
      const shift = digits - e;
      return shift >= 0 ? (num * 10n ** BigInt(shift)) / den : num / (den * 10n ** BigInt(-shift));
    };
    let q = scaled(exp);
    const upper = 10n ** BigInt(digits + 1);
    const lower = 10n ** BigInt(digits);
    while (q >= upper) q = scaled(++exp);
    while (q < lower) q = scaled(--exp);
    let rounded = (q + 5n) / 10n;
    if (rounded >= 10n ** BigInt(digits)) {
      rounded /= 10n;
      exp++;
    }
    const text = rounded.toString();
    const mantissa = `${text[0]}${text.length > 1 ? `.${text.slice(1)}` : ''}`.replace(/\.?0+$/, '');
    return `${negative ? '-' : ''}${mantissa}e${exp >= 0 ? '+' : ''}${exp}`;
  }
}

function bitLength(v: bigint): number {
  return (v < 0n ? -v : v).toString(16).length * 4;
}

export function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}
