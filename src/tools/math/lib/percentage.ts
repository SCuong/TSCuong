/** Percentage formulas. Every function returns a value or a human error (divide-by-zero etc.). */

export type Calc = { ok: true; value: number } | { ok: false; error: string };

const ok = (value: number): Calc =>
  Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'The result is too large to represent.' };

/** X% of Y. Multiplies before dividing to keep results like 15% of 80 exact. */
export function percentOf(x: number, y: number): Calc {
  return ok((x * y) / 100);
}

/** X is what percent of Y. */
export function whatPercent(x: number, y: number): Calc {
  if (y === 0) return { ok: false, error: 'Cannot divide by zero: Y must not be 0.' };
  return ok((x * 100) / y);
}

/**
 * Percentage change from A to B, relative to |A| so that a change from a negative
 * starting value keeps the intuitive sign (increase = positive).
 */
export function percentChange(a: number, b: number): Calc {
  if (a === 0) {
    return {
      ok: false,
      error: b === 0 ? 'Both values are 0, so there is no change to measure.' : 'A percentage change from 0 is undefined (division by zero).',
    };
  }
  return ok(((b - a) * 100) / Math.abs(a));
}

/** Y increased by X%. */
export function addPercent(y: number, x: number): Calc {
  return ok(y + (y * x) / 100);
}

/** Y decreased by X%. */
export function subtractPercent(y: number, x: number): Calc {
  return ok(y - (y * x) / 100);
}

/** Reverse percentage: Y is X% of what? */
export function reversePercent(y: number, x: number): Calc {
  if (x === 0) return { ok: false, error: 'Cannot divide by zero: the percentage must not be 0.' };
  return ok((y * 100) / x);
}

/** Symmetric percentage difference: |A − B| / ((A + B) / 2) × 100. */
export function percentDifference(a: number, b: number): Calc {
  if (a === b) return ok(0);
  const mean = (a + b) / 2;
  if (mean === 0) return { ok: false, error: 'The average of A and B is 0, so the percentage difference is undefined.' };
  return ok((Math.abs(a - b) * 100) / Math.abs(mean));
}
