import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction';
import { parseRatio, scaleRatio, simplify, solveProportion } from './ratio';

const F = (s: string) => Fraction.parse(s)!;

describe('ratio', () => {
  it('parses and simplifies', () => {
    const r = parseRatio('1920:1080');
    expect(r.ok && simplify(r.value)).toEqual([16n, 9n]);
    const three = parseRatio('4 : 6 : 8');
    expect(three.ok && simplify(three.value)).toEqual([2n, 3n, 4n]);
    const dec = parseRatio('1.5:2');
    expect(dec.ok && simplify(dec.value)).toEqual([3n, 4n]);
    const x = parseRatio('1280x720');
    expect(x.ok && simplify(x.value)).toEqual([16n, 9n]);
    const zero = parseRatio('0:5');
    expect(zero.ok && simplify(zero.value)).toEqual([0n, 1n]);
  });

  it('rejects bad ratios', () => {
    expect(parseRatio('').ok).toBe(false);
    expect(parseRatio('16').ok).toBe(false);
    expect(parseRatio('a:b')).toMatchObject({ ok: false, error: 'Term 1 "a" is not a number.' });
    expect(parseRatio('-1:2').ok).toBe(false);
    expect(parseRatio('0:0').ok).toBe(false);
  });

  it('solves proportions for any unknown', () => {
    const v = { a: '3', b: '4', c: '9', d: '12' };
    expect(solveProportion(v, 'd')).toMatchObject({ ok: true });
    expect(String((solveProportion(v, 'd') as { value: Fraction }).value)).toBe('12');
    expect(String((solveProportion(v, 'a') as { value: Fraction }).value)).toBe('3');
    expect(String((solveProportion(v, 'b') as { value: Fraction }).value)).toBe('4');
    expect(String((solveProportion(v, 'c') as { value: Fraction }).value)).toBe('9');
    expect(String((solveProportion({ a: '2', b: '3', c: '5', d: '' }, 'd') as { value: Fraction }).value)).toBe('15/2');
    expect(solveProportion({ a: '0', b: '3', c: '5', d: '' }, 'd')).toMatchObject({ ok: false });
    expect(solveProportion({ a: '', b: '3', c: '5', d: '' }, 'd')).toMatchObject({ ok: false, error: 'Enter a value for A.' });
    expect(solveProportion({ a: 'x', b: '3', c: '5', d: '' }, 'd')).toMatchObject({ ok: false });
  });

  it('scales ratios', () => {
    const r = scaleRatio(F('16'), F('9'), 'width', F('1280'));
    expect(r.ok && r.value.toString()).toBe('720');
    const h = scaleRatio(F('4'), F('3'), 'height', F('600'));
    expect(h.ok && h.value.toString()).toBe('800');
    expect(scaleRatio(F('0'), F('3'), 'height', F('600')).ok).toBe(false);
  });
});
