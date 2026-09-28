import { Fraction, gcd } from './fraction';

export type RatioResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse "16:9", "4 : 6 : 8", "1.5:2", "16x9", "16/9" (2+ positive terms). */
export function parseRatio(text: string): RatioResult<Fraction[]> {
  const s = text.trim();
  if (!s) return { ok: false, error: 'Enter a ratio such as 16:9.' };
  const parts = s.split(/\s*(?::|x|×|\/|,)\s*/i);
  if (parts.length < 2) return { ok: false, error: 'A ratio needs at least two terms separated by ":" (e.g. 4:3).' };
  const terms: Fraction[] = [];
  for (const [i, p] of parts.entries()) {
    const f = Fraction.parse(p);
    if (!f || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(p.trim())) {
      return { ok: false, error: `Term ${i + 1} "${p}" is not a number.` };
    }
    if (f.num < 0n) return { ok: false, error: `Term ${i + 1} is negative; ratio terms must be positive.` };
    terms.push(f);
  }
  if (terms.every((t) => t.isZero())) return { ok: false, error: 'At least one term must be non-zero.' };
  return { ok: true, value: terms };
}

/** Simplify to the smallest whole-number ratio (decimals are scaled first: 1.5:2 → 3:4). */
export function simplify(terms: Fraction[]): bigint[] {
  let lcmDen = 1n;
  for (const t of terms) lcmDen = (lcmDen * t.den) / gcd(lcmDen, t.den);
  const ints = terms.map((t) => (t.num * lcmDen) / t.den);
  const g = ints.reduce((a, b) => gcd(a, b), 0n) || 1n;
  return ints.map((v) => v / g);
}

export type Unknown = 'a' | 'b' | 'c' | 'd';

/** Solve A:B = C:D for the one missing value. */
export function solveProportion(values: Record<Unknown, string>, unknown: Unknown): RatioResult<Fraction> {
  const known: Partial<Record<Unknown, Fraction>> = {};
  for (const key of ['a', 'b', 'c', 'd'] as Unknown[]) {
    if (key === unknown) continue;
    const raw = values[key].trim();
    if (!raw) return { ok: false, error: `Enter a value for ${key.toUpperCase()}.` };
    const f = Fraction.parse(raw);
    if (!f) return { ok: false, error: `${key.toUpperCase()} "${raw}" is not a number.` };
    known[key] = f;
  }
  const { a, b, c, d } = known;
  try {
    // A/B = C/D  ⇒  A·D = B·C
    switch (unknown) {
      case 'a':
        return ok(b!.mul(c!).div(nonZero(d!, 'D')));
      case 'b':
        return ok(a!.mul(d!).div(nonZero(c!, 'C')));
      case 'c':
        return ok(a!.mul(d!).div(nonZero(b!, 'B')));
      case 'd':
        return ok(b!.mul(c!).div(nonZero(a!, 'A')));
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Cannot solve this proportion.' };
  }
}

function nonZero(f: Fraction, name: string): Fraction {
  if (f.isZero()) throw new Error(`${name} cannot be 0 here (it would divide by zero).`);
  return f;
}

function ok<T>(value: T): RatioResult<T> {
  return { ok: true, value };
}

/** Given ratio w:h and one known side, compute the other side. */
export function scaleRatio(w: Fraction, h: Fraction, known: 'width' | 'height', value: Fraction): RatioResult<Fraction> {
  if (w.isZero() || h.isZero()) return { ok: false, error: 'Both ratio terms must be greater than 0 to scale.' };
  return ok(known === 'width' ? value.mul(h).div(w) : value.mul(w).div(h));
}

export function formatFraction(f: Fraction, digits = 10): string {
  return f.toDecimal(digits);
}
