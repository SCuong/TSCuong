import { describe, expect, it } from 'vitest';
import { joinPages, runsToLines, type TextRun } from './text';

const run = (str: string, x: number, y: number, width = str.length * 5, size = 10, hasEOL = false): TextRun => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
  hasEOL,
});

describe('runsToLines', () => {
  it('returns nothing for an empty page', () => {
    expect(runsToLines([])).toEqual([]);
    expect(runsToLines([run('', 0, 0, 0, 10, true)])).toEqual([]);
  });

  it('joins runs on the same baseline and inserts spaces for gaps', () => {
    const lines = runsToLines([run('Hello', 10, 700, 25), run('world', 40, 700, 25), run('!', 65, 700, 3)]);
    expect(lines).toEqual(['Hello world!']);
  });

  it('orders runs left to right within a line', () => {
    expect(runsToLines([run('second', 40, 500, 30), run('first', 10, 500, 25)])).toEqual(['first second']);
  });

  it('starts a new line when the baseline changes and on EOL markers', () => {
    const lines = runsToLines([run('one', 10, 700), run('two', 10, 688), run('three', 10, 676, 25, 10, true), run('four', 60, 676)]);
    expect(lines).toEqual(['one', 'two', 'three', 'four']);
  });

  it('adds a blank line for paragraph gaps', () => {
    expect(runsToLines([run('para 1', 10, 700), run('para 2', 10, 640)])).toEqual(['para 1', '', 'para 2']);
  });

  it('tolerates small baseline jitter (subscripts, kerning)', () => {
    expect(runsToLines([run('H', 10, 700, 5), run('2', 15, 698, 4, 6), run('O', 19, 700, 5)])).toEqual(['H2O']);
  });

  it('uses a wide gap for tab-like spacing', () => {
    expect(runsToLines([run('Name', 10, 700, 20), run('Value', 200, 700, 25)])).toEqual(['Name    Value']);
  });

  it('keeps Unicode and emoji intact', () => {
    expect(runsToLines([run('Ünïcødé 日本語 🎉', 10, 700, 80)])).toEqual(['Ünïcødé 日本語 🎉']);
  });

  it('handles rotated text', () => {
    const vertical: TextRun = { str: 'Side', transform: [0, 10, -10, 0, 50, 100], width: 20, height: 10 };
    expect(runsToLines([vertical])).toEqual(['Side']);
  });

  it('handles many runs', () => {
    const runs = Array.from({ length: 5000 }, (_, i) => run(`w${i}`, (i % 50) * 20, 800 - Math.floor(i / 50) * 12, 10));
    const lines = runsToLines(runs);
    expect(lines).toHaveLength(100);
    expect(lines[0].startsWith('w0 w1 w2')).toBe(true);
  });
});

describe('joinPages', () => {
  it('adds page separators when asked', () => {
    const pages = [
      { page: 1, text: 'a' },
      { page: 2, text: 'b' },
    ];
    expect(joinPages(pages, true)).toBe('--- Page 1 ---\na\n\n--- Page 2 ---\nb');
    expect(joinPages(pages, false)).toBe('a\n\nb');
  });
});
