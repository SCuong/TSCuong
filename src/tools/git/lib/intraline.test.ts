import { describe, expect, it } from 'vitest';
import { parseDiff } from './diffParse';
import { intraline, pairLines } from './intraline';

describe('pairLines', () => {
  it('pairs removed lines with the added lines that replace them', () => {
    const lines = parseDiff('--- a\n+++ b\n@@ -1,3 +1,3 @@\n a\n-b\n-c\n+B\n d\n').files[0].hunks[0].lines;
    const pairs = pairLines(lines);
    expect(pairs.get(lines[1])).toBe(lines[3]);
    expect(pairs.get(lines[3])).toBe(lines[1]);
    expect(pairs.has(lines[2])).toBe(false);
    expect(pairs.has(lines[0])).toBe(false);
  });
});

describe('intraline', () => {
  it('highlights only the changed words', () => {
    const r = intraline('const total = price * qty;', 'const total = price * quantity;');
    expect(r?.old).toEqual([
      { text: 'const total = price * ', changed: false },
      { text: 'qty', changed: true },
      { text: ';', changed: false },
    ]);
    expect(r?.new.map((s) => s.text).join('')).toBe('const total = price * quantity;');
  });
  it('returns null for identical, very different or very long lines', () => {
    expect(intraline('same', 'same')).toBeNull();
    expect(intraline('alpha beta gamma', 'totally unrelated words here')).toBeNull();
    expect(intraline('x'.repeat(600), 'y'.repeat(600))).toBeNull();
  });
  it('handles unicode and emoji', () => {
    const r = intraline('xin chào 👋 bạn', 'xin chào 🚀 bạn');
    expect(r?.new.find((s) => s.changed)?.text).toBe('🚀');
  });
  it('handles empty strings', () => {
    expect(intraline('', 'abc')).toBeNull();
  });
});
