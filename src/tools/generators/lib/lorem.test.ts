import { describe, expect, it } from 'vitest';
import { countWords, generateLorem, LOREM_START } from './lorem';
import { SeededRandom } from './mock';

const seeded = (seed = 'lorem') => {
  const r = new SeededRandom(seed);
  return () => r.float();
};

describe('generateLorem', () => {
  it('paragraphs are separated by blank lines and start with Lorem ipsum', () => {
    const t = generateLorem({ unit: 'paragraphs', count: 3, startWithLorem: true, html: false }, seeded());
    const paras = t.split('\n\n');
    expect(paras).toHaveLength(3);
    expect(t.startsWith(`${LOREM_START}`)).toBe(true);
    for (const p of paras) expect(p).toMatch(/^[A-Z].*\.$/);
  });

  it('does not start with Lorem ipsum when disabled', () => {
    const t = generateLorem({ unit: 'sentences', count: 5, startWithLorem: false, html: false }, seeded('x'));
    expect(t.startsWith('Lorem ipsum dolor sit amet')).toBe(false);
    expect(t.match(/\./g)).toHaveLength(5);
  });

  it('words mode gives exactly N words', () => {
    for (const n of [1, 5, 8, 50, 1000]) {
      const t = generateLorem({ unit: 'words', count: n, startWithLorem: true, html: false }, seeded(String(n)));
      expect(countWords(t)).toBe(n);
    }
    expect(generateLorem({ unit: 'words', count: 5, startWithLorem: true, html: false })).toBe('Lorem ipsum dolor sit amet.');
  });

  it('html output wraps paragraphs and lists', () => {
    const p = generateLorem({ unit: 'paragraphs', count: 2, startWithLorem: true, html: true }, seeded());
    expect(p.match(/<p>/g)).toHaveLength(2);
    expect(p.match(/<\/p>/g)).toHaveLength(2);
    const l = generateLorem({ unit: 'list', count: 4, startWithLorem: true, html: true }, seeded());
    expect(l.startsWith('<ul>')).toBe(true);
    expect(l.match(/<li>/g)).toHaveLength(4);
    expect(l).toContain(`<li>${LOREM_START}.</li>`);
  });

  it('plain lists use dashes', () => {
    const l = generateLorem({ unit: 'list', count: 3, startWithLorem: false, html: false }, seeded());
    expect(l.split('\n').every((line) => line.startsWith('- '))).toBe(true);
  });

  it('clamps counts', () => {
    const t = generateLorem({ unit: 'paragraphs', count: 0, startWithLorem: false, html: false }, seeded());
    expect(t.split('\n\n')).toHaveLength(1);
    const many = generateLorem({ unit: 'paragraphs', count: 5000, startWithLorem: false, html: false }, seeded());
    expect(many.split('\n\n')).toHaveLength(100);
  });

  it('is deterministic for a given random source', () => {
    const a = generateLorem({ unit: 'paragraphs', count: 2, startWithLorem: false, html: false }, seeded('s'));
    const b = generateLorem({ unit: 'paragraphs', count: 2, startWithLorem: false, html: false }, seeded('s'));
    expect(a).toBe(b);
  });
});
