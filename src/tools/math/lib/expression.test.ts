import { describe, expect, it } from 'vitest';
import { evaluate, evaluateProgram, ExpressionError, formatResult, tokenize } from './expression';

function err(expr: string, vars: Record<string, number> = {}): ExpressionError {
  try {
    evaluate(expr, vars);
  } catch (e) {
    if (e instanceof ExpressionError) return e;
    throw e;
  }
  throw new Error(`expected "${expr}" to fail`);
}

describe('expression parser: precedence and associativity', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['100 / 10 / 5', 2],
    ['2 ^ 3 ^ 2', 512],
    ['-2 ^ 2', -4],
    ['(-2) ^ 2', 4],
    ['2 ^ -1', 0.5],
    ['2 ^ -2 ^ 2', 2 ** -4],
    ['--3', 3],
    ['-+-3', 3],
    ['3 - -3', 6],
    ['7 % 3', 1],
    ['-7 % 3', -1],
    ['2 * 3 % 4', 2],
    ['1 + 2 * 3 ^ 2', 19],
    ['2 ** 10', 1024],
    ['6 ÷ 2 × 3', 9],
    ['5!', 120],
    ['3!^2', 36],
    ['-3!', -6],
    ['0!', 1],
    ['1e3 + 1', 1001],
    ['2.5e-2', 0.025],
    ['.5 + .25', 0.75],
    ['1_000_000 / 1_000', 1000],
  ])('%s = %d', (expr, expected) => {
    expect(evaluate(expr)).toBeCloseTo(expected, 12);
  });

  it('implicit multiplication', () => {
    expect(evaluate('2pi')).toBeCloseTo(2 * Math.PI);
    expect(evaluate('3(4 + 1)')).toBe(15);
    expect(evaluate('(1 + 2)(3 + 4)')).toBe(21);
    expect(evaluate('2 sqrt(9)')).toBe(6);
    expect(evaluate('2e')).toBeCloseTo(2 * Math.E);
    expect(evaluate('2x^2', { x: 3 })).toBe(18);
    expect(evaluate('6 / 2(1 + 2)')).toBe(9);
  });
});

describe('functions and constants', () => {
  it('evaluates functions', () => {
    expect(evaluate('sqrt(16)')).toBe(4);
    expect(evaluate('cbrt(27)')).toBe(3);
    expect(evaluate('log(1000)')).toBeCloseTo(3);
    expect(evaluate('log(8, 2)')).toBeCloseTo(3);
    expect(evaluate('ln(e)')).toBe(1);
    expect(evaluate('log2(1024)')).toBe(10);
    expect(evaluate('abs(-4.5)')).toBe(4.5);
    expect(evaluate('round(2.5)')).toBe(3);
    expect(evaluate('round(1.005, 2)')).toBe(1.01);
    expect(evaluate('floor(-1.5)')).toBe(-2);
    expect(evaluate('ceil(1.2)')).toBe(2);
    expect(evaluate('min(3, 1, 2)')).toBe(1);
    expect(evaluate('max(3, 1, 2, 10)')).toBe(10);
    expect(evaluate('pow(2, 8)')).toBe(256);
    expect(evaluate('exp(0)')).toBe(1);
    expect(evaluate('sin(pi / 2)')).toBeCloseTo(1);
    expect(evaluate('cos(0)')).toBe(1);
    expect(evaluate('tan(pi / 4)')).toBeCloseTo(1);
    expect(evaluate('atan(1) * 4')).toBeCloseTo(Math.PI);
    expect(evaluate('tau / pi')).toBe(2);
    expect(evaluate('π')).toBe(Math.PI);
  });

  it('supports degrees mode with exact right angles', () => {
    expect(evaluate('sin(90)', {}, { angleMode: 'deg' })).toBe(1);
    expect(evaluate('cos(180)', {}, { angleMode: 'deg' })).toBe(-1);
    expect(evaluate('sin(180)', {}, { angleMode: 'deg' })).toBe(0);
    expect(evaluate('sin(30)', {}, { angleMode: 'deg' })).toBeCloseTo(0.5);
    expect(evaluate('asin(1)', {}, { angleMode: 'deg' })).toBeCloseTo(90);
    expect(() => evaluate('tan(90)', {}, { angleMode: 'deg' })).toThrow(/undefined/);
  });

  it('checks domains and arity', () => {
    expect(err('sqrt(-1)').message).toMatch(/negative/);
    expect(err('ln(0)').message).toMatch(/positive/);
    expect(err('asin(2)').message).toMatch(/between -1 and 1/);
    expect(err('sqrt(1, 2)').message).toBe('sqrt() expects 1 argument, got 2');
    expect(err('max()').message).toBe('max() expects at least 1 argument, got 0');
    expect(err('(-8) ^ 0.5').message).toMatch(/fractional power/);
    expect(err('171!').message).toMatch(/too large/);
    expect(err('2.5!').message).toMatch(/whole numbers/);
  });
});

describe('errors with positions', () => {
  it('reports unexpected tokens', () => {
    const e = err('1 + * 2');
    expect(e.message).toBe("Unexpected '*' at column 5");
    expect(e.position).toBe(4);
  });
  it('reports unmatched parentheses', () => {
    expect(err('(1 + 2').message).toBe("Missing ')' for '(' at column 1");
    const e = err('1 + 2)');
    expect(e.message).toBe("Unmatched ')' at column 6");
    expect(e.position).toBe(5);
    expect(err('max(1, 2').message).toMatch(/Missing '\)' to close 'max\('/);
    expect(err('()').message).toMatch(/Empty parentheses/);
  });
  it('reports unknown names', () => {
    expect(err('foo(2)').message).toBe("Unknown function 'foo' at column 1");
    const e = err('2 * y');
    expect(e.message).toBe("Undefined variable 'y' at column 5");
    expect(e.position).toBe(4);
    expect(err('sqrt').message).toMatch(/is a function/);
    expect(err('toString').message).toMatch(/Undefined variable/);
    expect(err('constructor(1)').message).toMatch(/Unknown function/);
  });
  it('reports bad characters and numbers', () => {
    expect(err('2 $ 3').message).toBe("Unexpected character '$' at column 3");
    expect(err('1.2.3').message).toMatch(/Malformed number/);
    expect(err('1 +').message).toMatch(/Unexpected end of expression/);
    expect(err('').message).toBe('Empty expression');
    expect(err('2 3').message).toBe("Unexpected number '3' at column 3");
  });
  it('reports division by zero and overflow', () => {
    expect(err('1 / 0').message).toBe('Division by zero at column 3');
    expect(err('5 % 0').message).toMatch(/Division by zero/);
    expect(err('0 ^ -1').message).toMatch(/Division by zero/);
    expect(err('10 ^ 400').message).toMatch(/too large/);
    expect(err('1e999').message).toMatch(/too large/);
  });
  it('handles deep nesting without crashing', () => {
    const deep = '('.repeat(500) + '1' + ')'.repeat(500);
    expect(evaluate(deep)).toBe(1);
    const long = Array.from({ length: 5000 }, () => '1').join(' + ');
    expect(evaluate(long)).toBe(5000);
    const absurd = '('.repeat(200_000) + '1' + ')'.repeat(200_000);
    expect(() => evaluate(absurd)).toThrow(ExpressionError);
  });
  it('rejects code-like input rather than executing it', () => {
    expect(() => evaluate('alert(1)')).toThrow(ExpressionError);
    expect(() => evaluate('this.constructor')).toThrow(ExpressionError);
    expect(() => evaluate('"abc"')).toThrow(ExpressionError);
  });
});

describe('programs, variables and ans', () => {
  it('evaluates lines in order with variables', () => {
    const r = evaluateProgram('x = 3\ny = x * 2\n\n# comment\nx + y  # trailing comment\nans * 2');
    expect(r.lines.map((l) => l.formatted)).toEqual(['3', '6', '9', '18']);
    expect(r.lines[0].assigned).toBe('x');
    expect(r.vars.get('y')).toBe(6);
    expect(r.last).toBe(18);
  });
  it('keeps going after an error line', () => {
    const r = evaluateProgram('1 +\n2 + 2');
    expect(r.lines[0].error?.message).toMatch(/Unexpected end/);
    expect(r.lines[1].value).toBe(4);
  });
  it('refuses to reassign built-ins', () => {
    const r = evaluateProgram('pi = 3\nans = 2\nsin = 1');
    expect(r.lines[0].error?.message).toMatch(/built-in/);
    expect(r.lines[1].error?.message).toMatch(/ans/);
    expect(r.lines[2].error?.message).toMatch(/built-in/);
  });
  it('accepts initial variables', () => {
    const r = evaluateProgram('ans + 1', {}, [['ans', 41]]);
    expect(r.last).toBe(42);
  });
});

describe('formatResult', () => {
  it('removes float noise', () => {
    expect(formatResult(0.1 + 0.2)).toBe('0.3');
    expect(formatResult(1 / 3)).toBe('0.333333333333');
    expect(formatResult(-0)).toBe('0');
    expect(formatResult(123456789)).toBe('123456789');
    expect(formatResult(1e25)).toBe('1e+25');
    expect(formatResult(1.5e-12)).toBe('1.5e-12');
    expect(formatResult(2 ** 53)).toBe('9007199254740992');
  });
});

describe('tokenize', () => {
  it('tokenizes identifiers and numbers', () => {
    expect(tokenize('ab1 + 2.5').map((t) => t.value)).toEqual(['ab1', '+', '2.5', '']);
  });
});
