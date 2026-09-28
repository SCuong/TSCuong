import { Fraction } from './fraction';

export type Matrix = Fraction[][];

export class MatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatrixError';
  }
}

export const MAX_SIZE = 6;

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
  while (e > 0) {
    if (e & 1) result = multiply(result, base);
    base = multiply(base, base);
    e >>= 1;
  }
  return result;
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
