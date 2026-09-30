/** Regression tests for defects found in the text tools audit. */
import { describe, expect, it } from 'vitest';
import {
  compareCodePoints,
  countCodePoints,
  countGraphemes,
  countLines,
  foldCase,
  graphemeSegments,
  graphemes,
  splitLines,
  stripDiacritics,
} from './common';
import { CASE_VARIANTS, sentenceCase, toTitleChar } from './case';
import { slugify, transliterate } from './slug';
import { removeDuplicateLines, sortLines } from './lines';
import { compileSearch, DEFAULT_FIND_OPTIONS, findAndReplace } from './findReplace';
import { extractEmails, extractUrls, trimUrl } from './extract';
import { analyzeNormalization, ANALYZE_LIMIT, removeDiacritics } from './normalize';
import { markdownToText } from './markdown';
import { collapseWhitespace, computeDiff } from './diff';
import { convertQuotes } from './quotes';
import { charFrequency, wordFrequency } from './frequency';
import { findDuplicateWords, MAX_POSITIONS } from './duplicates';
import { textStats } from './stats';

const convert = (id: string, text: string) => CASE_VARIANTS.find((v) => v.id === id)!.convert(text);

describe('fast grapheme segmentation', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const reference = (text: string) => Array.from(segmenter.segment(text), (s) => ({ segment: s.segment, index: s.index }));
  const samples = [
    '',
    'plain ASCII text\r\nwith CRLF\rand CR\n',
    'é café ǟ',
    '👨‍👩‍👧 👍🏽 🇻🇳🇫🇷 1️⃣ ❤️',
    '©‍© x\u200Dy',
    '؀123 ؁a',
    '한국어 각',
    'हिन्दी ক্ষ',
    '\r\ń \ń',
    '\ud83d lone \ude00 surrogates',
    'Straße ǅ ﬁ Ｆｕｌｌ',
  ];

  it('matches Intl.Segmenter on the whole text for tricky inputs', () => {
    for (const text of samples) {
      expect(graphemeSegments(text)).toEqual(reference(text));
      expect(graphemes(text)).toEqual(reference(text).map((s) => s.segment));
      expect(countGraphemes(text)).toBe(reference(text).length);
    }
  });

  it('matches Intl.Segmenter on random mixtures', () => {
    const pieces = ['a', ' ', '\r', '\n', '\r\n', '́', '\u200D', '👩', '🏽', '🇻', 'é', 'ᄀ', 'ᅡ', 'क', '्', '؀', '1', '️', '⃣', '日'];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 300; n++) {
      let text = '';
      const len = Math.floor(rand() * 20);
      for (let i = 0; i < len; i++) text += pieces[Math.floor(rand() * pieces.length)];
      expect(graphemeSegments(text), JSON.stringify(text)).toEqual(reference(text));
      expect(countGraphemes(text), JSON.stringify(text)).toBe(reference(text).length);
    }
  });

  it('counts lines and code points without allocating, like splitLines / Array.from', () => {
    for (const text of ['', 'a', 'a\n', '\n', '\n\n', 'a\r\nb\rc\nd', 'a\r\n', '\r', 'x\r\n\r\n']) {
      expect(countLines(text), JSON.stringify(text)).toBe(splitLines(text).lines.length);
    }
    for (const text of ['', 'abc', '👩‍👩‍👧', '\ud83d', 'a\ude00b']) expect(countCodePoints(text)).toBe(Array.from(text).length);
  });
});

describe('case conversion titlecase', () => {
  it('uses Unicode titlecase for digraphs and multi-letter uppercase forms', () => {
    expect(toTitleChar('ǆ')).toBe('ǅ');
    expect(toTitleChar('Ǉ')).toBe('ǈ');
    expect(toTitleChar('ß')).toBe('Ss');
    expect(toTitleChar('ﬁ')).toBe('Fi');
    expect(convert('pascal', 'ǆungla ǉubav')).toBe('ǅunglaǈubav');
    expect(convert('title', 'ﬁnance report')).toBe('Finance Report');
    expect(convert('constant', 'ǆungla')).toBe('ǄUNGLA');
  });

  it('keeps "i.e." lowercase in sentence case but capitalizes the pronoun I', () => {
    expect(sentenceCase('use it, i.e. this one; i think i\'m right')).toBe("Use it, i.e. this one; I think I'm right");
    expect(sentenceCase('ǆungla is big.')).toBe('ǅungla is big.');
  });

  it('still splits acronyms and numbers like change-case', () => {
    expect(convert('camel', 'XMLHttpRequest')).toBe('xmlHttpRequest');
    expect(convert('snake', 'HTML5Parser version2Update')).toBe('html5_parser_version2_update');
  });
});

describe('diacritics and slugs keep other scripts intact', () => {
  it('removes Latin/Greek/Cyrillic accents only', () => {
    expect(stripDiacritics('Crème Tiếng Việt Αθήνα й')).toBe('Creme Tieng Viet Αθηνα и');
    // Emoji presentation selectors, keycaps, Japanese voicing marks and Devanagari signs survive.
    expect(removeDiacritics('I ❤️ 1️⃣ がガ हिन्दी')).toBe('I ❤️ 1️⃣ がガ हिन्दी');
  });

  it('keeps non-Latin words readable in slugs', () => {
    expect(slugify('हिन्दी भाषा', { keepUnicode: true })).toBe('हिन्दी-भाषा');
    expect(slugify('ﾄﾞｱ', { keepUnicode: true })).toBe('ドア');
    expect(slugify('I ❤️ NY', { keepUnicode: true })).toBe('i-ny');
    expect(slugify('Café ﬁne')).toBe('cafe-fine');
    expect(transliterate('Tom & Jerry @ 5%', { symbols: true })).toBe('Tom  and  Jerry  at  5 percent ');
    expect(transliterate('Tom & Jerry')).toBe('Tom & Jerry');
  });

  it('transliterates a large mostly-ASCII text quickly', () => {
    const text = 'Crème brûlée & tarte Tatin. '.repeat(40_000);
    const started = performance.now();
    expect(slugify(text).startsWith('creme-brulee-and-tarte-tatin')).toBe(true);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('sorting and de-duplication', () => {
  it('sorts by code point, not UTF-16 unit', () => {
    expect(compareCodePoints('～', '😀')).toBeLessThan(0);
    expect(sortLines('😀\n～\na', { mode: 'codepoint' }).text).toBe('a\n～\n😀');
    expect(sortLines('b\nB\na', { mode: 'codepoint', caseInsensitive: false }).text).toBe('B\na\nb');
  });

  it('folds case fully when ignoring case', () => {
    expect(foldCase('Straße')).toBe(foldCase('STRASSE'));
    expect(removeDuplicateLines('Straße\nSTRASSE\nstrasse', { caseInsensitive: true })).toMatchObject({ text: 'Straße', removed: 2 });
    expect(sortLines('ǅ\nǆ\nǄ', { mode: 'natural', unique: true, caseInsensitive: true }).text).toBe('ǅ');
  });
});

describe('find and replace', () => {
  it('caps returned ranges but counts and replaces every match', () => {
    const r = findAndReplace('a'.repeat(10_000), 'a', 'b', {}, 5_001);
    expect(r).toMatchObject({ ok: true, count: 10_000 });
    if (r.ok) {
      expect(r.ranges).toHaveLength(5_001);
      expect(r.text).toBe('b'.repeat(10_000));
    }
  });

  it('supports every special replacement pattern like String.prototype.replace', () => {
    const r = findAndReplace('abc abc', '(?<x>b)', '[$&|$1|$<x>|$$|$`|$\']', { regex: true });
    expect(r).toMatchObject({ ok: true, text: "a[b|b|b|$|a|c abc]c a[b|b|b|$|abc a|c]c" });
    // Plain mode: "$&" is literal text.
    expect(findAndReplace('a.b', '.', '$&')).toMatchObject({ text: 'a$&b' });
  });

  it('explains invalid patterns in words', () => {
    const c = compileSearch('(a', { ...DEFAULT_FIND_OPTIONS, regex: true });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toBe('A group is never closed: there is a "(" without a matching ")".');
  });
});

describe('URL and e-mail extraction', () => {
  it('stops URLs at CJK punctuation and trims a trailing ellipsis', () => {
    expect(extractUrls('访问https://example.cn/中文。谢谢 and www.example.com… ok（https://x.org/a）')).toEqual([
      'https://example.cn/中文',
      'https://www.example.com',
      'https://x.org/a',
    ]);
    expect(extractUrls('see [docs](https://en.wikipedia.org/wiki/A_(b)), http://[2001:db8::1]:8080/x.')).toEqual([
      'https://en.wikipedia.org/wiki/A_(b)',
      'http://[2001:db8::1]:8080/x',
    ]);
  });

  it('trims trailing brackets in linear time', () => {
    const url = `https://example.com/${')'.repeat(200_000)}`;
    const started = performance.now();
    expect(trimUrl(url)).toBe('https://example.com/');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('finds punycode TLDs, decomposed accents and quoted local parts', () => {
    expect(extractEmails('"john doe"@example.com, user@example.xn--p1ai, josé@example.com, josé@example.com, a@b-.com')).toEqual([
      '"john doe"@example.com',
      'user@example.xn--p1ai',
      'josé@example.com',
    ]);
  });
});

describe('unicode normalizer report', () => {
  it('says how much of a huge text the character analysis covers', () => {
    const text = 'é'.repeat(ANALYZE_LIMIT);
    const r = analyzeNormalization(text, { form: 'NFC', removeDiacritics: false });
    expect(r.analyzedChars).toBe(ANALYZE_LIMIT);
    expect(r.changed).toBe(ANALYZE_LIMIT / 2);
    expect(r.output).toBe('é'.repeat(ANALYZE_LIMIT));
    expect(r.after.graphemes).toBe(ANALYZE_LIMIT);
  });
});

describe('markdown to text', () => {
  it('decodes every HTML5 entity in text but keeps code spans literal', () => {
    expect(markdownToText('`&amp; <b>` text &amp; &euro; &eacute; &#x1F600;')).toBe('&amp; <b> text & € é 😀');
  });
});

describe('text diff', () => {
  it('ignores all whitespace differences (and CRLF) in line mode', () => {
    const r = computeDiff('a  b\r\n  c\n', 'a b\nc  \n', { mode: 'line', ignoreWhitespace: true, ignoreCase: false });
    expect(r.ok && r.stats).toMatchObject({ added: 0, removed: 0, unchanged: 2 });
    const cased = computeDiff('Hello  World\n', 'hello world\n', { mode: 'line', ignoreWhitespace: true, ignoreCase: true });
    expect(cased.ok && cased.stats).toMatchObject({ added: 0, removed: 0 });
    const strict = computeDiff('a  b\n', 'a b\n', { mode: 'line', ignoreWhitespace: false, ignoreCase: false });
    expect(strict.ok && strict.stats).toMatchObject({ added: 1, removed: 1 });
  });

  it('keeps line breaks visible when ignoring whitespace in character mode', () => {
    expect(collapseWhitespace('a  b \n\t c')).toBe('a b\nc');
    const r = computeDiff('hello  world\nfoo', 'hello world\nfoo', { mode: 'char', ignoreWhitespace: true, ignoreCase: false });
    expect(r.ok && r.changes.map((c) => c.value)).toEqual(['hello world\nfoo']);
  });
});

describe('smart quotes count', () => {
  it('counts only the marks that were actually replaced', () => {
    expect(convertQuotes('“a” — b…', 'straight', { quotes: false })).toEqual({ text: '“a” --- b...', marks: 2 });
    expect(convertQuotes('"a" -- b', 'smart')).toEqual({ text: '“a” – b', marks: 3 });
  });
});

describe('analysis on repeated words', () => {
  it('keeps word and character frequencies exact after counting distinct items first', () => {
    const w = wordFrequency('The cat and the Cat’s cat. CAT!', { excludeStopWords: false });
    expect(w.rows.slice(0, 2)).toMatchObject([
      { item: 'cat', count: 3 },
      { item: 'the', count: 2 },
    ]);
    expect(w.total).toBe(7);
    const c = charFrequency('aA👍🏽👍🏽 ', { caseFold: true });
    expect(c.total).toBe(4);
    expect(c.rows.find((r) => r.item === 'a')?.count).toBe(2);
    expect(c.rows.find((r) => r.item === '👍🏽')?.count).toBe(2);
  });

  it('numbers lines after old Mac line breaks and caps stored positions', () => {
    const r = findDuplicateWords('one\rthe the\rtwo');
    expect(r.consecutive[0].position).toMatchObject({ line: 2, column: 5 });
    const many = findDuplicateWords('word '.repeat(MAX_POSITIONS + 10), { excludeStopWords: false });
    expect(many.repeated[0].count).toBe(MAX_POSITIONS + 10);
    expect(many.repeated[0].positions).toHaveLength(MAX_POSITIONS);
  });

  it('computes word-counter statistics on large text in reasonable time', () => {
    const text = 'Lorem ipsum dolor sit amet, café naïve. 👍🏽 '.repeat(20_000);
    const started = performance.now();
    const s = textStats(text);
    expect(s.words).toBe(20_000 * 7);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
