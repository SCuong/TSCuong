import { describe, expect, it } from 'vitest';
import {
  countGraphemes,
  detectEol,
  escapeRegExp,
  graphemes,
  joinLines,
  mapLines,
  secureRandomInt,
  secureShuffle,
  sentences,
  splitLines,
  utf8Length,
  words,
} from './common';

describe('splitLines / joinLines', () => {
  it('handles empty input', () => {
    expect(splitLines('')).toEqual({ lines: [], trailingNewline: false, eol: '\n' });
    expect(joinLines([])).toBe('');
  });

  it('splits on LF, CRLF and CR and remembers the trailing newline', () => {
    const r = splitLines('a\r\nb\r\nc\r\n');
    expect(r.lines).toEqual(['a', 'b', 'c']);
    expect(r.trailingNewline).toBe(true);
    expect(r.eol).toBe('\r\n');
    expect(joinLines(r.lines, r.eol, r.trailingNewline)).toBe('a\r\nb\r\nc\r\n');
    expect(splitLines('a\rb').lines).toEqual(['a', 'b']);
  });

  it('keeps a single newline as one empty line', () => {
    expect(splitLines('\n')).toMatchObject({ lines: [''], trailingNewline: true });
  });

  it('detects the dominant line ending', () => {
    expect(detectEol('a\nb\r\nc\r\n')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
    expect(detectEol('a\rb\rc')).toBe('\r');
  });

  it('mapLines preserves structure', () => {
    expect(mapLines('a\nb\n', (l, i) => `${i}${l}`)).toBe('0a\n1b\n');
  });
});

describe('graphemes', () => {
  it('keeps emoji ZWJ sequences, flags and combining marks together', () => {
    expect(graphemes('👩‍👩‍👧🇻🇳é')).toEqual(['👩‍👩‍👧', '🇻🇳', 'é']);
    expect(countGraphemes('👍🏽a')).toBe(2);
    expect(countGraphemes('')).toBe(0);
  });
});

describe('words and sentences', () => {
  it('finds word-like segments including contractions and CJK', () => {
    expect(words("Don't stop, 42 times!").map((w) => w.word)).toEqual(["Don't", 'stop', '42', 'times']);
    expect(words('').length).toBe(0);
    expect(words('日本語のテキスト').length).toBeGreaterThan(1);
  });

  it('counts sentences', () => {
    expect(sentences('Hello there. How are you? Fine!')).toHaveLength(3);
    expect(sentences('   ')).toHaveLength(0);
  });
});

describe('utf8Length', () => {
  it('matches TextEncoder for mixed text', () => {
    for (const s of ['', 'abc', 'é', '€', '😀', 'a😀b€é\n']) {
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
    }
  });

  it('counts a lone surrogate as U+FFFD', () => {
    expect(utf8Length('\ud800')).toBe(3);
  });
});

describe('escapeRegExp', () => {
  it('escapes syntax characters so the pattern is valid in unicode mode', () => {
    const special = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p-q';
    const re = new RegExp(escapeRegExp(special), 'u');
    expect(re.test(special)).toBe(true);
  });
});

describe('secure random', () => {
  it('stays in range', () => {
    for (let i = 0; i < 200; i++) {
      const n = secureRandomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
    expect(secureRandomInt(1)).toBe(0);
  });

  it('shuffle is a permutation', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = secureShuffle(input);
    expect(out).toHaveLength(50);
    expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    expect(input[0]).toBe(0);
  });
});
