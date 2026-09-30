import { Fraction } from './fraction';

export type Matrix = Fraction[][];

export class MatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatrixError';
  }
}

export const MAX_SIZE = 6;
/** Longest accepted cell text (a 60-digit number or a long fraction still fits). */
export const MAX_CELL_LENGTH = 64;
/**
 * Exact arithmetic slows down quadratically as numbers grow, so powers stop before any entry would need
 * more than this many bits (numerator + denominator, roughly 2,400 decimal digits).
 */
export const MAX_ENTRY_BITS = 8_000;

export function dims(m: Matrix): [number, number] {
  return [m.length, m[0]?.length ?? 0];
}

export function dimsLabel(m: Matrix): string {
  const [r, c] = dims(m);
  return `${r}×${c}`;
}

/** Parse a grid of cell strings. Reports the first bad cell by name (e.g. "A[2,3]"). */
export function parseMatrix(cells: string[][], name: string): Matrix {
  return cells.map((row, i) =>
    row.map((cell, j) => {
      if (!cell.trim()) throw new MatrixError(`${name}[${i + 1},${j + 1}] is empty.`);
      if (cell.trim().length > MAX_CELL_LENGTH) {
        throw new MatrixError(`${name}[${i + 1},${j + 1}] is too long (at most ${MAX_CELL_LENGTH} characters).`);
      }
      const f = Fraction.parse(cell);
      if (!f) throw new MatrixError(`${name}[${i + 1},${j + 1}] "${cell.trim()}" is not a number (use 3, -1.5 or 2/3).`);
      return f;
    }),
  );
}

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? Fraction.ONE : Fraction.ZERO)));
}

function sameDims(a: Matrix, b: Matrix, verb: string) {
  const [ar, ac] = dims(a);
  const [br, bc] = dims(b);
  if (ar !== br || ac !== bc) {
    throw new MatrixError(`Cannot ${verb} a ${ar}×${ac} matrix and a ${br}×${bc} matrix: both must have the same size.`);
  }
}

export function add(a: Matrix, b: Matrix): Matrix {
  sameDims(a, b, 'add');
  return a.map((row, i) => row.map((v, j) => v.add(b[i][j])));
}

export function subtract(a: Matrix, b: Matrix): Matrix {
  sameDims(a, b, 'subtract');
  return a.map((row, i) => row.map((v, j) => v.sub(b[i][j])));
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const [ar, ac] = dims(a);
  const [br, bc] = dims(b);
  if (ac !== br) {
    throw new MatrixError(
      `Cannot multiply a ${ar}×${ac} matrix by a ${br}×${bc} matrix: the first matrix's columns (${ac}) must equal the second matrix's rows (${br}).`,
    );
  }
  return Array.from({ length: ar }, (_, i) =>
    Array.from({ length: bc }, (_, j) => {
      let sum = Fraction.ZERO;
      for (let k = 0; k < ac; k++) sum = sum.add(a[i][k].mul(b[k][j]));
      return sum;
    }),
  );
}

export function scalar(a: Matrix, k: Fraction): Matrix {
  return a.map((row) => row.map((v) => v.mul(k)));
}

export function transpose(a: Matrix): Matrix {
  const [r, c] = dims(a);
  return Array.from({ length: c }, (_, j) => Array.from({ length: r }, (_, i) => a[i][j]));
}

function requireSquare(a: Matrix, what: string) {
  const [r, c] = dims(a);
  if (r !== c) throw new MatrixError(`The ${what} is only defined for square matrices (this one is ${r}×${c}).`);
}

export function determinant(a: Matrix): Fraction {
  requireSquare(a, 'determinant');
  const n = a.length;
  const m = a.map((row) => [...row]);
  let det = Fraction.ONE;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    while (pivot < n && m[pivot][col].isZero()) pivot++;
    if (pivot === n) return Fraction.ZERO;
    if (pivot !== col) {
      [m[pivot], m[col]] = [m[col], m[pivot]];
      det = det.neg();
    }
    const p = m[col][col];
    det = det.mul(p);
    for (let r = col + 1; r < n; r++) {
      if (m[r][col].isZero()) continue;
      const f = m[r][col].div(p);
      for (let c = col; c < n; c++) m[r][c] = m[r][c].sub(f.mul(m[col][c]));
    }
  }
  return det;
}

/** Reduced row echelon form; returns the matrix and its rank. */
export function rref(a: Matrix): { matrix: Matrix; rank: number } {
  const m = a.map((row) => [...row]);
  const [rows, cols] = dims(m);
  let lead = 0;
  let rank = 0;
  for (let col = 0; col < cols && lead < rows; col++) {
    let pivot = lead;
    while (pivot < rows && m[pivot][col].isZero()) pivot++;
    if (pivot === rows) continue;
    [m[pivot], m[lead]] = [m[lead], m[pivot]];
    const p = m[lead][col];
    m[lead] = m[lead].map((v) => v.div(p));
    for (let r = 0; r < rows; r++) {
      if (r === lead || m[r][col].isZero()) continue;
      const f = m[r][col];
      m[r] = m[r].map((v, c) => v.sub(f.mul(m[lead][c])));
    }
    lead++;
    rank++;
  }
  return { matrix: m, rank };
}

export function rank(a: Matrix): number {
  return rref(a).rank;
}

export function inverse(a: Matrix): Matrix {
  requireSquare(a, 'inverse');
  const n = a.length;
  const aug = a.map((row, i) => [...row, ...identity(n)[i]]);
  const { matrix, rank: r } = rref(aug);
  // Singular when the left block isn't the identity.
  for (let i = 0; i < n; i++) {
    if (r < n || !matrix[i][i].equals(Fraction.ONE)) {
      throw new MatrixError('This matrix is singular (its determinant is 0), so it has no inverse.');
    }
  }
  return matrix.map((row) => row.slice(n));
}

export function power(a: Matrix, exp: number): Matrix {
  requireSquare(a, 'matrix power');
  if (!Number.isInteger(exp)) throw new MatrixError('The exponent must be a whole number.');
  if (Math.abs(exp) > 64) throw new MatrixError('Use an exponent between -64 and 64.');
  let base = exp < 0 ? inverse(a) : a;
  let e = Math.abs(exp);
  let result = identity(a.length);
  const guard = (x: Matrix, y: Matrix) => {
    // A product's entries need at most about bits(x) + bits(y) bits (plus a few for the sums).
    if (entryBits(x) + entryBits(y) > MAX_ENTRY_BITS) {
      throw new MatrixError(
        `A^${exp} is too large to compute exactly: its entries would have more than about ${Math.round(MAX_ENTRY_BITS * Math.log10(2)).toLocaleString('en-US')} digits. Use a smaller exponent or smaller entries.`,
      );
    }
  };
  while (e > 0) {
    if (e & 1) {
      guard(result, base);
      result = multiply(result, base);
    }
    e >>= 1;
    // The last squaring is never used, and it is the most expensive one.
    if (e > 0) {
      guard(base, base);
      base = multiply(base, base);
    }
  }
  return result;
}

/** Largest numerator + denominator size, in bits, over the entries of `m`. */
export function entryBits(m: Matrix): number {
  let max = 0;
  for (const row of m) {
    for (const v of row) {
      const n = v.num < 0n ? -v.num : v.num;
      const bits = n.toString(16).length * 4 + v.den.toString(16).length * 4;
      if (bits > max) max = bits;
    }
  }
  return max;
}

export function toStrings(m: Matrix, mode: 'fraction' | 'decimal', digits = 8): string[][] {
  return m.map((row) => row.map((v) => (mode === 'fraction' ? v.toString() : v.toDecimal(digits))));
}

/** Tab-separated text, handy for pasting into spreadsheets. */
export function toTsv(m: Matrix, mode: 'fraction' | 'decimal'): string {
  return toStrings(m, mode, 12)
    .map((row) => row.join('\t'))
    .join('\n');
}
