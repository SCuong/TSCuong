import { describe, expect, it } from 'vitest';
import { findAndReplace, compileSearch, interpretEscapes, DEFAULT_FIND_OPTIONS } from './findReplace';
import { charFrequency, frequencyToCsv, wordFrequency } from './frequency';
import { formatMinutes, textStats } from './stats';
import { findDuplicateWords, removeConsecutiveDuplicates } from './duplicates';
import { extractEmails, extractUrls, groupByDomain, trimUrl } from './extract';

describe('findAndReplace', () => {
  it('replaces plain text case-insensitively and counts', () => {
    const r = findAndReplace('Cat cat CAT', 'cat', 'dog');
    expect(r).toMatchObject({ ok: true, text: 'dog dog dog', count: 3 });
  });

  it('treats special characters literally in plain mode', () => {
    expect(findAndReplace('a.b.c', '.', '-')).toMatchObject({ text: 'a-b-c', count: 2 });
    expect(findAndReplace('price $5', '$5', '$$10')).toMatchObject({ text: 'price $$10' });
  });

  it('supports case-sensitive and whole word', () => {
    expect(findAndReplace('Cat cat', 'cat', 'x', { caseSensitive: true })).toMatchObject({ text: 'Cat x' });
    expect(findAndReplace('cat catalog', 'cat', 'x', { wholeWord: true })).toMatchObject({ text: 'x catalog', count: 1 });
    expect(findAndReplace('café cafés', 'café', 'x', { wholeWord: true })).toMatchObject({ text: 'x cafés' });
  });

  it('supports regex groups', () => {
    expect(findAndReplace('2024-01-15', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', { regex: true })).toMatchObject({ text: '15/01/2024' });
    expect(findAndReplace('John Smith', '(?<first>\\w+) (?<last>\\w+)', '$<last>, $<first>', { regex: true })).toMatchObject({
      text: 'Smith, John',
    });
  });

  it('interprets escapes in the replacement', () => {
    expect(findAndReplace('a,b', ',', '\\n')).toMatchObject({ text: 'a\nb' });
    expect(findAndReplace('a,b', ',', '\\n', { escapes: false })).toMatchObject({ text: 'a\\nb' });
    expect(interpretEscapes('\\t\\\\')).toBe('\t\\');
  });

  it('reports invalid regex as a human sentence (no engine prefix)', () => {
    const r = findAndReplace('abc', '[a-', 'x', { regex: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/character class is never closed/);
      expect(r.error).not.toMatch(/\/\[a-\//);
    }
  });

  it('falls back to non-unicode regex for legacy patterns', () => {
    const c = compileSearch('[\\w-.]+', { ...DEFAULT_FIND_OPTIONS, regex: true });
    expect(c.ok).toBe(true);
  });

  it('handles zero-length regex matches without hanging', () => {
    const r = findAndReplace('abc', '', 'x', { regex: true });
    expect(r).toMatchObject({ ok: true, text: 'abc', count: 0 });
    const r2 = findAndReplace('abc', '(?:)', '-', { regex: true });
    expect(r2).toMatchObject({ ok: true, text: '-a-b-c-', count: 4 });
    if (r2.ok) expect(r2.ranges).toHaveLength(0);
  });

  it('returns match ranges', () => {
    const r = findAndReplace('ab ab', 'ab', 'x');
    if (r.ok) expect(r.ranges).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
  });

  it('matches emoji correctly in unicode mode', () => {
    expect(findAndReplace('a😀b😀', '😀', '!')).toMatchObject({ text: 'a!b!', count: 2 });
    expect(findAndReplace('a😀b', '.', '_', { regex: true })).toMatchObject({ text: '___', count: 3 });
  });
});

describe('wordFrequency', () => {
  const text = 'The cat and the hat. The CAT sat on the mat with a hat, hat!';
  it('counts with stop words removed and case folded', () => {
    const r = wordFrequency(text);
    expect(r.rows[0]).toMatchObject({ item: 'hat', count: 3 });
    expect(r.rows[1]).toMatchObject({ item: 'cat', count: 2 });
    expect(r.rows.find((x) => x.item === 'the')).toBeUndefined();
    expect(r.rows.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100);
  });

  it('keeps stop words and case when asked', () => {
    const r = wordFrequency(text, { excludeStopWords: false, caseFold: false });
    expect(r.rows.find((x) => x.item === 'The')?.count).toBe(2);
    expect(r.rows.find((x) => x.item === 'the')?.count).toBe(2);
  });

  it('applies min length and number filters', () => {
    expect(wordFrequency('go gone 42 42', { minLength: 3 }).rows.map((r) => r.item)).toEqual(['gone']);
    expect(wordFrequency('42 42 x', { includeNumbers: true, excludeStopWords: false }).rows[0]).toMatchObject({ item: '42', count: 2 });
  });

  it('handles empty and unicode text', () => {
    expect(wordFrequency('').total).toBe(0);
    expect(wordFrequency('café café naïve').rows[0]).toMatchObject({ item: 'café', count: 2 });
  });

  it('exports CSV', () => {
    const csv = frequencyToCsv([{ item: 'a,b', count: 2, percent: 50 }], 'word');
    expect(csv).toBe('word,count,percent\r\n"a,b",2,50.00\r\n');
  });
});

describe('charFrequency', () => {
  it('counts graphemes and ignores whitespace by default', () => {
    const r = charFrequency('aab 👍🏽👍🏽');
    expect(r.rows.find((x) => x.item === 'a')?.count).toBe(2);
    expect(r.rows.find((x) => x.item === '👍🏽')?.count).toBe(2);
    expect(r.rows.find((x) => x.item === ' ')).toBeUndefined();
    expect(r.total).toBe(5);
  });

  it('can include whitespace, fold case, and restrict to letters', () => {
    expect(charFrequency('a A', { includeWhitespace: true }).rows.find((x) => x.item === ' ')?.count).toBe(1);
    expect(charFrequency('aA', { caseFold: true }).rows[0]).toMatchObject({ item: 'a', count: 2 });
    expect(charFrequency('a!?', { lettersOnly: true }).total).toBe(1);
  });
});

describe('textStats', () => {
  it('counts everything', () => {
    const s = textStats('Hello world. This is a test!\n\nSecond paragraph here.');
    expect(s.words).toBe(9);
    expect(s.sentences).toBe(3);
    expect(s.paragraphs).toBe(2);
    expect(s.lines).toBe(3);
    expect(s.longestWord).toBe('paragraph');
    expect(s.characters).toBe(52);
    expect(s.charactersNoSpaces).toBe(43);
  });

  it('counts characters as graphemes and still reports code points, UTF-16 units and bytes', () => {
    const s = textStats('👩‍👩‍👧é');
    expect(s.characters).toBe(2);
    expect(s.codePoints).toBe(6);
    expect(s.utf16Units).toBe(9);
    expect(s.bytes).toBe(new TextEncoder().encode('👩‍👩‍👧é').length);
  });

  it('counts a decomposed accent and an emoji ZWJ sequence as one character each', () => {
    const s = textStats('é 👨‍👩‍👧 x');
    expect(s.characters).toBe(5);
    expect(s.charactersNoSpaces).toBe(3);
    expect(s.codePoints).toBe(10);
  });

  it('treats CRLF as one character and NBSP / ideographic space as spaces', () => {
    const s = textStats('a\r\nb c　d');
    expect(s.characters).toBe(7);
    expect(s.charactersNoSpaces).toBe(4);
  });

  it('is all zero for empty text', () => {
    const s = textStats('');
    expect(s).toMatchObject({ characters: 0, words: 0, sentences: 0, paragraphs: 0, lines: 0, bytes: 0, avgWordLength: 0, longestWord: '' });
  });

  it('formats minutes', () => {
    expect(formatMinutes(0)).toBe('0 sec');
    expect(formatMinutes(0.25)).toBe('15 sec');
    expect(formatMinutes(3.2)).toBe('3 min');
    expect(formatMinutes(75)).toBe('1 h 15 min');
  });
});

describe('findDuplicateWords', () => {
  it('finds consecutive duplicates across whitespace and lines with positions', () => {
    const r = findDuplicateWords('This is the the test.\nIt is is\nis fine.');
    expect(r.consecutive.map((d) => d.word)).toEqual(['the', 'is', 'is']);
    expect(r.consecutive[0].position).toMatchObject({ line: 1, column: 13 });
    expect(r.consecutive[2].position.line).toBe(3);
  });

  it('is case-insensitive by default and ignores punctuation-separated repeats', () => {
    expect(findDuplicateWords('The the').consecutive).toHaveLength(1);
    expect(findDuplicateWords('The the', { caseSensitive: true }).consecutive).toHaveLength(0);
    expect(findDuplicateWords('that, that').consecutive).toHaveLength(0);
    expect(findDuplicateWords('that, that', { whitespaceOnly: false }).consecutive).toHaveLength(1);
  });

  it('lists repeated words overall', () => {
    const r = findDuplicateWords('Apple banana apple cherry banana apple');
    expect(r.repeated[0]).toMatchObject({ word: 'apple', count: 3 });
    expect(r.repeated[1]).toMatchObject({ word: 'banana', count: 2 });
  });

  it('removes consecutive duplicates', () => {
    const text = 'the the the cat sat sat.';
    const r = findDuplicateWords(text);
    expect(removeConsecutiveDuplicates(text, r.consecutive)).toBe('the cat sat.');
  });

  it('handles empty text', () => {
    expect(findDuplicateWords('')).toEqual({ consecutive: [], repeated: [], totalWords: 0 });
  });
});

describe('URL extraction', () => {
  it('extracts http, https, ftp and www links, trimming punctuation', () => {
    const text = 'See https://example.com/a?b=1, and (www.test.org). Also ftp://files.example.net/x.zip!';
    expect(extractUrls(text)).toEqual(['https://example.com/a?b=1', 'https://www.test.org', 'ftp://files.example.net/x.zip']);
  });

  it('keeps balanced parentheses', () => {
    expect(trimUrl('https://en.wikipedia.org/wiki/Foo_(bar))')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(extractUrls('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  it('dedupes and sorts', () => {
    const text = 'https://b.com https://a.com https://B.com https://a.com';
    expect(extractUrls(text)).toEqual(['https://b.com', 'https://a.com']);
    expect(extractUrls(text, { sort: true, dedupe: false })).toHaveLength(4);
    expect(extractUrls(text, { sort: true })).toEqual(['https://a.com', 'https://b.com']);
  });

  it('respects protocol filters and addProtocol', () => {
    expect(extractUrls('www.a.com ftp://b.com', { protocols: { http: true, ftp: false, www: true }, addProtocol: false })).toEqual(['www.a.com']);
  });

  it('ignores bare schemes', () => {
    expect(extractUrls('https:// and www.')).toEqual([]);
    expect(extractUrls('')).toEqual([]);
  });
});

describe('email extraction', () => {
  it('extracts, lowercases and dedupes', () => {
    const text = 'Contact John.Doe@Example.com or jane+news@mail.example.co.uk. Again: john.doe@example.com; bad@x, @nope.com';
    expect(extractEmails(text)).toEqual(['john.doe@example.com', 'jane+news@mail.example.co.uk']);
    expect(extractEmails(text, { lowercase: false })).toEqual(['John.Doe@example.com', 'jane+news@mail.example.co.uk']);
  });

  it('extracts from mailto and URLs', () => {
    expect(extractEmails('<a href="mailto:a@b.io">x</a> https://x.com/?email=c@d.org')).toEqual(['a@b.io', 'c@d.org']);
  });

  it('handles unicode domains', () => {
    expect(extractEmails('user@exämple.de')).toEqual(['user@exämple.de']);
  });

  it('groups by domain', () => {
    const groups = groupByDomain(['a@x.com', 'b@y.com', 'c@x.com']);
    expect(groups[0]).toEqual({ domain: 'x.com', emails: ['a@x.com', 'c@x.com'] });
  });
});
