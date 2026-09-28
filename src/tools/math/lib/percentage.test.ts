import { describe, expect, it } from 'vitest';
import {
  addPercent,
  percentChange,
  percentDifference,
  percentOf,
  reversePercent,
  subtractPercent,
  whatPercent,
  type Calc,
} from './percentage';
import { formatNumber, parseNumber } from '../shared-a/format';

const val = (c: Calc) => {
  if (!c.ok) throw new Error(c.error);
  return c.value;
};

describe('percentage formulas', () => {
  it('X% of Y', () => {
    expect(val(percentOf(15, 80))).toBe(12);
    expect(val(percentOf(10, 0.3))).toBeCloseTo(0.03, 15);
    expect(formatNumber(val(percentOf(7, 0.1)))).toBe('0.007');
    expect(val(percentOf(-50, 10))).toBe(-5);
    expect(val(percentOf(250, 4))).toBe(10);
  });

  it('X is what % of Y', () => {
    expect(val(whatPercent(12, 80))).toBe(15);
    expect(val(whatPercent(1, 3))).toBeCloseTo(33.3333333333, 8);
    expect(whatPercent(5, 0)).toEqual({ ok: false, error: 'Cannot divide by zero: Y must not be 0.' });
  });

  it('percentage change', () => {
    expect(val(percentChange(50, 75))).toBe(50);
    expect(val(percentChange(80, 60))).toBe(-25);
    expect(val(percentChange(-50, -25))).toBe(50);
    expect(val(percentChange(-10, 10))).toBe(200);
    expect(val(percentChange(3, 3))).toBe(0);
    expect(percentChange(0, 5).ok).toBe(false);
    expect(percentChange(0, 0)).toMatchObject({ ok: false, error: expect.stringMatching(/no change/) });
  });

  it('add / subtract X%', () => {
    expect(val(addPercent(200, 15))).toBe(230);
    expect(val(subtractPercent(200, 15))).toBe(170);
    expect(formatNumber(val(addPercent(19.99, 20)))).toBe('23.988');
    expect(val(subtractPercent(100, 100))).toBe(0);
    expect(val(addPercent(100, -10))).toBe(90);
  });

  it('reverse percentage', () => {
    expect(val(reversePercent(30, 20))).toBe(150);
    expect(val(reversePercent(115, 115))).toBe(100);
    expect(reversePercent(30, 0).ok).toBe(false);
  });

  it('percentage difference (symmetric)', () => {
    expect(val(percentDifference(10, 20))).toBeCloseTo(66.6666666667, 8);
    expect(val(percentDifference(20, 10))).toBeCloseTo(66.6666666667, 8);
    expect(val(percentDifference(5, 5))).toBe(0);
    expect(val(percentDifference(0, 0))).toBe(0);
    expect(percentDifference(-5, 5).ok).toBe(false);
  });

  it('flags overflow', () => {
    expect(percentOf(1e308, 1e308).ok).toBe(false);
  });
});

describe('formatNumber / parseNumber', () => {
  it('hides floating point noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1.005 * 1000)).toBe('1,005');
    expect(formatNumber(1234567.891)).toBe('1,234,567.891');
    expect(formatNumber(1234567.891, { grouping: false })).toBe('1234567.891');
    expect(formatNumber(-0.5)).toBe('-0.5');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(2 / 3, { precision: 4 })).toBe('0.6667');
  });

  it('uses scientific notation for extremes', () => {
    expect(formatNumber(1.5e21)).toBe('1.5e21');
    expect(formatNumber(6.02214076e23)).toBe('6.02214076e23');
    expect(formatNumber(1.602176634e-19)).toBe('1.602176634e-19');
    expect(formatNumber(1e-8)).toBe('1e-8');
    expect(formatNumber(123456789012)).toBe('123,456,789,012');
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(NaN)).toBe('NaN');
  });

  it('parses user input', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber(' 1 000 ')).toBe(1000);
    expect(parseNumber('1_000')).toBe(1000);
    expect(parseNumber('-3.5')).toBe(-3.5);
    expect(parseNumber('−3')).toBe(-3);
    expect(parseNumber('+2')).toBe(2);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('5.')).toBe(5);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1,2')).toBeNull();
    expect(parseNumber('12%')).toBeNull();
    expect(parseNumber('1e999')).toBeNull();
    expect(parseNumber('🙂')).toBeNull();
  });
});
