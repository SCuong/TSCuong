import { describe, expect, it } from 'vitest';
import { buildLineRows, collapseRows, computeDiff, createPatch, inlineLineDiff, splitKeepingEol } from './diff';
import { markdownToText } from './markdown';
import { isNormalized, measure, normalizeSegments, normalizeText, removeDiacritics } from './normalize';
import { countTypographic, toSmart, toStraight } from './quotes';
import { reverseEachWord, reverseGraphemes, reverseText, reverseWords } from './reverse';

describe('computeDiff', () => {
  it('diffs lines with stats', () => {
    const r = computeDiff('a\nb\nc\n', 'a\nB\nc\nd\n', { mode: 'line', ignoreCase: false, ignoreWhitespace: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats).toEqual({ added: 2, removed: 1, unchanged: 2, unit: 'lines' });
  });

  it('ignores case and whitespace in line mode', () => {
    const r = computeDiff('Hello\n  world\n', 'hello\nworld\n', { mode: 'line', ignoreCase: true, ignoreWhitespace: true });
    if (r.ok) expect(r.stats.added + r.stats.removed).toBe(0);
  });

  it('diffs words and characters', () => {
    const w = computeDiff('the quick fox', 'the slow fox', { mode: 'word', ignoreCase: false, ignoreWhitespace: false });
    if (w.ok) expect(w.stats).toMatchObject({ added: 1, removed: 1, unit: 'words' });
    const c = computeDiff('cat', 'cut', { mode: 'char', ignoreCase: false, ignoreWhitespace: false });
    if (c.ok) expect(c.stats).toMatchObject({ added: 1, removed: 1, unchanged: 2 });
  });

  it('counts emoji as single characters in char mode', () => {
    const c = computeDiff('a', 'a😀', { mode: 'char', ignoreCase: false, ignoreWhitespace: false });
    if (c.ok) expect(c.stats.added).toBe(1);
  });

  it('identical and empty inputs', () => {
    const r = computeDiff('', '', { mode: 'line', ignoreCase: false, ignoreWhitespace: false });
    expect(r).toMatchObject({ ok: true, stats: { added: 0, removed: 0 } });
  });

  it('handles a large input', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n');
    const b = a.replace('line 10000', 'changed');
    const r = computeDiff(a, b, { mode: 'line', ignoreCase: false, ignoreWhitespace: false });
    if (r.ok) expect(r.stats).toMatchObject({ added: 1, removed: 1 });
  });
});

describe('diff rows', () => {
  it('splits lines keeping EOL', () => {
    expect(splitKeepingEol('a\r\nb\n\nc')).toEqual(['a\r\n', 'b\n', '\n', 'c']);
    expect(splitKeepingEol('')).toEqual([]);
  });

  it('builds side-by-side rows with original text', () => {
    const a = 'one\nTwo\nthree\n';
    const b = 'one\ntwo\nthree\nfour\n';
    const r = computeDiff(a, b, { mode: 'line', ignoreCase: false, ignoreWhitespace: false });
    if (!r.ok) throw new Error('diff failed');
    const rows = buildLineRows(a, b, r.changes);
    expect(rows.map((x) => x.kind)).toEqual(['equal', 'changed', 'equal', 'added']);
    expect(rows[1].left).toEqual({ no: 2, text: 'Two' });
    expect(rows[1].right).toEqual({ no: 2, text: 'two' });
    expect(rows[3].right).toEqual({ no: 4, text: 'four' });
  });

  it('shows the old text on the left even when ignoring case', () => {
    const r = computeDiff('Hello\n', 'hello\n', { mode: 'line', ignoreCase: true, ignoreWhitespace: false });
    if (!r.ok) throw new Error('diff failed');
    const rows = buildLineRows('Hello\n', 'hello\n', r.changes);
    expect(rows[0]).toMatchObject({ kind: 'equal', left: { text: 'Hello' }, right: { text: 'hello' } });
  });

  it('inline diff marks changed words', () => {
    const d = inlineLineDiff('the quick fox', 'the slow fox');
    expect(d.left.filter((p) => p.changed).map((p) => p.text)).toEqual(['quick']);
    expect(d.right.filter((p) => p.changed).map((p) => p.text)).toEqual(['slow']);
  });

  it('collapses unchanged runs', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l10', 'x');
    const r = computeDiff(a, b, { mode: 'line', ignoreCase: false, ignoreWhitespace: false });
    if (!r.ok) throw new Error('diff failed');
    const rows = collapseRows(buildLineRows(a, b, r.changes), 2);
    expect(rows[0]).toMatchObject({ kind: 'skip', count: 8 });
    expect(rows.filter((x) => x.kind === 'skip')).toHaveLength(2);
  });

  it('creates a unified patch', () => {
    const p = createPatch('a\nb\n', 'a\nc\n');
    expect(p).toContain('--- original.txt');
    expect(p).toContain('+++ modified.txt');
    expect(p).toContain('-b');
    expect(p).toContain('+c');
  });
});

describe('markdownToText', () => {
  it('strips formatting', () => {
    const md = '# Title\n\nSome **bold**, *italic*, `code` and ~~gone~~ text with a [link](https://x.com).\n\n> quoted\n\n---\n\n![alt text](img.png)';
    expect(markdownToText(md)).toBe('Title\n\nSome bold, italic, code and gone text with a link.\n\nquoted\n\nalt text');
  });

  it('keeps list markers and tasks', () => {
    const md = '- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo';
    expect(markdownToText(md)).toBe('- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo');
    expect(markdownToText('- one\n- two', { listMarkers: false })).toBe('one\ntwo');
  });

  it('can show link URLs and hide code blocks', () => {
    expect(markdownToText('[site](https://a.com)', { linkUrls: true })).toBe('site (https://a.com)');
    expect(markdownToText('<https://a.com>', { linkUrls: true })).toBe('https://a.com');
    expect(markdownToText('text\n\n```js\nconst a = 1;\n```', { codeBlocks: false })).toBe('text');
    expect(markdownToText('```js\nconst a = 1;\n```')).toBe('const a = 1;');
  });

  it('converts tables to tab-separated rows', () => {
    expect(markdownToText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a\tb\n1\t2');
  });

  it('decodes entities, removes HTML tags and handles escapes', () => {
    expect(markdownToText('Tom &amp; Jerry <b>bold</b> \\*not italic\\*')).toBe('Tom & Jerry bold *not italic*');
    expect(markdownToText('<div>block <script>alert(1)</script></div>')).toBe('block');
  });

  it('uppercases headings when asked and handles empty input', () => {
    expect(markdownToText('## hi', { uppercaseHeadings: true })).toBe('HI');
    expect(markdownToText('')).toBe('');
  });
});

describe('unicode normalization', () => {
  const composed = 'é'; // U+00E9
  const decomposed = 'é';
  it('converts between forms', () => {
    expect(normalizeText(decomposed, { form: 'NFC', removeDiacritics: false })).toBe(composed);
    expect(normalizeText(composed, { form: 'NFD', removeDiacritics: false })).toBe(decomposed);
    expect(normalizeText('ﬁ①', { form: 'NFKC', removeDiacritics: false })).toBe('fi1');
    expect(isNormalized(composed, 'NFC')).toBe(true);
    expect(isNormalized(decomposed, 'NFC')).toBe(false);
  });

  it('removes diacritics but keeps base letters and emoji', () => {
    expect(removeDiacritics('Crème brûlée, Tiếng Việt 👍🏽')).toBe('Creme brulee, Tieng Viet 👍🏽');
  });

  it('reports changed segments and measures', () => {
    const segs = normalizeSegments(`a${decomposed}b`, { form: 'NFC', removeDiacritics: false });
    expect(segs.map((s) => s.changed)).toEqual([false, true, false]);
    expect(measure(decomposed)).toEqual({ codePoints: 2, utf16: 2, bytes: 3, graphemes: 1 });
  });
});

describe('smart quotes', () => {
  it('curls quotes, apostrophes, dashes and ellipsis', () => {
    expect(toSmart('"Hello," she said. "It\'s fine..."')).toBe('“Hello,” she said. “It’s fine…”');
    expect(toSmart("'single' and 'quoted'")).toBe('‘single’ and ‘quoted’');
    expect(toSmart("the '90s rock 'n' roll")).toBe('the ’90s rock ’n’ roll');
    expect(toSmart('a -- b --- c')).toBe('a – b — c');
    expect(toSmart('a -- b', { dashes: 'em' })).toBe('a — b');
    expect(toSmart('He said ("yes")')).toBe('He said (“yes”)');
  });

  it('can limit to some conversions', () => {
    expect(toSmart('"a"...', { quotes: false })).toBe('"a"…');
    expect(toSmart('a--b', { dashes: 'off' })).toBe('a--b');
  });

  it('straightens typographic punctuation', () => {
    expect(toStraight('“Hello” — it’s… ‘ok’ – fine')).toBe('"Hello" --- it\'s... \'ok\' -- fine');
    expect(toStraight('a—b', { dashes: 'em' })).toBe('a--b');
    expect(countTypographic('“a” … b')).toBe(3);
  });

  it('round-trips', () => {
    const text = '"Don\'t," he said -- twice...';
    expect(toStraight(toSmart(text))).toBe(text);
  });
});

describe('reverse', () => {
  it('reverses graphemes keeping emoji intact', () => {
    expect(reverseGraphemes('ab👩‍👩‍👧🇻🇳é')).toBe('é🇻🇳👩‍👩‍👧ba');
    expect(reverseGraphemes('')).toBe('');
  });

  it('reverses words and lines', () => {
    expect(reverseWords('one two  three')).toBe('three  two one');
    expect(reverseText('a\nb\nc\n', { mode: 'lines', perLine: false })).toBe('c\nb\na\n');
    expect(reverseText('ab cd\nef', { mode: 'characters', perLine: true })).toBe('dc ba\nfe');
    expect(reverseText('ab\ncd', { mode: 'characters', perLine: false })).toBe('dc\nba');
    expect(reverseText('a b\nc d', { mode: 'words', perLine: true })).toBe('b a\nd c');
  });

  it('keeps CRLF intact when reversing all characters', () => {
    expect(reverseText('ab\r\ncd', { mode: 'characters', perLine: false })).toBe('dc\r\nba');
  });

  it('reverses letters within each word', () => {
    expect(reverseEachWord('Hello, world!')).toBe('olleH, dlrow!');
  });
});
