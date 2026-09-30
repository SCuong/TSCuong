import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction';
import {
  add,
  determinant,
  identity,
  inverse,
  MatrixError,
  multiply,
  parseMatrix,
  power,
  rank,
  scalar,
  subtract,
  toStrings,
  toTsv,
  transpose,
  type Matrix,
} from './matrix';

const M = (rows: Array<Array<string | number>>): Matrix => parseMatrix(rows.map((r) => r.map(String)), 'A');
const S = (m: Matrix) => toStrings(m, 'fraction');

describe('Fraction', () => {
  it('parses and normalizes', () => {
    expect(Fraction.parse('2/4')!.toString()).toBe('1/2');
    expect(Fraction.parse('-0.25')!.toString()).toBe('-1/4');
    expect(Fraction.parse('1/-3')!.toString()).toBe('-1/3');
    expect(Fraction.parse('1.5/0.5')!.toString()).toBe('3');
    expect(Fraction.parse('2.5e2')!.toString()).toBe('250');
    expect(Fraction.parse('1e-3')!.toString()).toBe('1/1000');
    expect(Fraction.parse('.5')!.toString()).toBe('1/2');
    expect(Fraction.parse('abc')).toBeNull();
    expect(Fraction.parse('1/0')).toBeNull();
    expect(Fraction.parse('')).toBeNull();
    expect(Fraction.parse('.')).toBeNull();
  });
  it('does exact arithmetic', () => {
    const third = Fraction.parse('1/3')!;
    expect(third.add(third).add(third).toString()).toBe('1');
    expect(Fraction.parse('0.1')!.add(Fraction.parse('0.2')!).toString()).toBe('3/10');
    expect(third.toDecimal(6)).toBe('0.333333');
    expect(() => third.div(Fraction.ZERO)).toThrow();
  });
});

describe('matrix operations', () => {
  const A = M([
    [1, 2],
    [3, 4],
  ]);
  const B = M([
    [5, 6],
    [7, 8],
  ]);

  it('adds, subtracts, multiplies, scales, transposes', () => {
    expect(S(add(A, B))).toEqual([
      ['6', '8'],
      ['10', '12'],
    ]);
    expect(S(subtract(A, B))).toEqual([
      ['-4', '-4'],
      ['-4', '-4'],
    ]);
    expect(S(multiply(A, B))).toEqual([
      ['19', '22'],
      ['43', '50'],
    ]);
    expect(S(scalar(A, Fraction.parse('1/2')!))).toEqual([
      ['1/2', '1'],
      ['3/2', '2'],
    ]);
    expect(S(transpose(M([[1, 2, 3]])))).toEqual([['1'], ['2'], ['3']]);
  });

  it('multiplies non-square matrices and checks dimensions', () => {
    const r = multiply(M([[1, 2, 3]]), M([[1], [2], [3]]));
    expect(S(r)).toEqual([['14']]);
    expect(() => multiply(M([[1, 2]]), M([[1, 2]]))).toThrow(/columns \(2\) must equal the second matrix's rows \(1\)/);
    expect(() => add(A, M([[1, 2]]))).toThrow(MatrixError);
  });

  it('computes determinants', () => {
    expect(determinant(A).toString()).toBe('-2');
    expect(
      determinant(
        M([
          [6, 1, 1],
          [4, -2, 5],
          [2, 8, 7],
        ]),
      ).toString(),
    ).toBe('-306');
    expect(
      determinant(
        M([
          [0, 1],
          [1, 0],
        ]),
      ).toString(),
    ).toBe('-1');
    expect(determinant(identity(6)).toString()).toBe('1');
    expect(
      determinant(
        M([
          [1, 2],
          [2, 4],
        ]),
      ).toString(),
    ).toBe('0');
    expect(() => determinant(M([[1, 2]]))).toThrow(/square/);
  });

  it('inverts exactly with fractions', () => {
    expect(S(inverse(A))).toEqual([
      ['-2', '1'],
      ['3/2', '-1/2'],
    ]);
    const C = M([
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ]);
    const inv = inverse(C);
    expect(S(inv)).toEqual([
      ['3/4', '1/2', '1/4'],
      ['1/2', '1', '1/2'],
      ['1/4', '1/2', '3/4'],
    ]);
    expect(S(multiply(C, inv))).toEqual(S(identity(3)));
  });

  it('reports singular matrices', () => {
    expect(() =>
      inverse(
        M([
          [1, 2],
          [2, 4],
        ]),
      ),
    ).toThrow(/singular/);
    expect(() => inverse(M([[0]]))).toThrow(/singular/);
  });

  it('computes rank', () => {
    expect(rank(A)).toBe(2);
    expect(
      rank(
        M([
          [1, 2, 3],
          [2, 4, 6],
          [1, 1, 1],
        ]),
      ),
    ).toBe(2);
    expect(rank(M([[0, 0], [0, 0]]))).toBe(0);
    expect(rank(M([[1, 2, 3, 4]]))).toBe(1);
  });

  it('raises to powers', () => {
    expect(S(power(A, 2))).toEqual(S(multiply(A, A)));
    expect(S(power(A, 0))).toEqual(S(identity(2)));
    expect(S(power(A, -1))).toEqual(S(inverse(A)));
    const fib = power(M([[1, 1], [1, 0]]), 50);
    expect(fib[0][1].toString()).toBe('12586269025');
  });

  it('parses cells with helpful errors', () => {
    expect(() => parseMatrix([['1', '']], 'B')).toThrow('B[1,2] is empty.');
    expect(() => parseMatrix([['1', 'x']], 'A')).toThrow(/A\[1,2\] "x" is not a number/);
  });

  it('formats as decimals and TSV', () => {
    expect(toStrings(inverse(A), 'decimal')).toEqual([
      ['-2', '1'],
      ['1.5', '-0.5'],
    ]);
    expect(toTsv(A, 'fraction')).toBe('1\t2\n3\t4');
  });

  it('handles 6x6 matrices with decimals quickly', () => {
    const big = M(Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? '2.5' : `${(i + j) % 3}/7`))));
    const inv = inverse(big);
    expect(S(multiply(big, inv))).toEqual(S(identity(6)));
  });

  it('stops huge exact powers instead of freezing the page', () => {
    // Regression: a 6x6 matrix with a 1e400/7 cell raised to the 64th power ran for over 10 minutes.
    const grid = (corner: string) =>
      Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === 0 && j === 0 ? corner : `${i * 6 + j + 1}/${(i % 5) + 2}`)));
    const started = Date.now();
    expect(() => power(M(grid('1e400/7')), 64)).toThrow(/too large to compute exactly/);
    expect(Date.now() - started).toBeLessThan(2000);
    // Ordinary powers still work.
    expect(power(M(grid('1/7')), 64)[0][0].isZero()).toBe(false);
  });

  it('rejects overlong cells', () => {
    expect(() => parseMatrix([['1'.repeat(65)]], 'A')).toThrow('A[1,1] is too long (at most 64 characters).');
  });
});

describe('Fraction formatting', () => {
  it('rejects ambiguous chained fraction bars', () => {
    // Regression: "1/2/3" silently parsed as 1 / (2/3) = 3/2.
    expect(Fraction.parse('1/2/3')).toBeNull();
    expect(Fraction.parse('-1.5/2')?.toString()).toBe('-3/4');
  });

  it('keeps integer digits in decimal mode', () => {
    // Regression: 12345678901/2 showed as 6172839500.
    expect(new Fraction(12345678901n, 2n).toDecimal(8)).toBe('6172839450.5');
    expect(new Fraction(-1n, 3n).toDecimal(6)).toBe('-0.333333');
  });

  it('formats values beyond the double range exactly', () => {
    // Regression: these rendered as "Infinityeundefined" and "0".
    expect(new Fraction(10n ** 400n, 3n).toDecimal(8)).toBe('3.3333333e+399');
    expect(new Fraction(-(10n ** 400n) * 2n, 3n).toDecimal(4)).toBe('-6.667e+399');
    expect(new Fraction(1n, 3n * 10n ** 400n).toDecimal(8)).toBe('3.3333333e-401');
    expect(new Fraction(999999n, 1000000n * 10n ** 20n).toExponential(3)).toBe('1e-20');
    expect(new Fraction(1n, 3n).toExponential(5)).toBe('3.3333e-1');
  });
});
