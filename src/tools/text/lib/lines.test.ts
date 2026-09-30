import { describe, expect, it } from 'vitest';
import {
  addAffixes,
  cleanWhitespace,
  expandTabs,
  filterLines,
  leadingSpacesToTabs,
  numberLines,
  removeDuplicateLines,
  sortLines,
} from './lines';

describe('sortLines', () => {
  it('sorts naturally by default', () => {
    expect(sortLines('item10\nitem2\nitem1').text).toBe('item1\nitem2\nitem10');
  });

  it('sorts alphabetically, descending, case-insensitively', () => {
    expect(sortLines('b\nA\nc', { mode: 'alpha' }).text).toBe('A\nb\nc');
    expect(sortLines('b\nA\nc', { mode: 'alpha', descending: true }).text).toBe('c\nb\nA');
    expect(sortLines('b\nB\na', { mode: 'codepoint', caseInsensitive: false }).text).toBe('B\na\nb');
  });

  it('sorts by length (graphemes) keeping ties stable', () => {
    expect(sortLines('ccc\na\nbb\nzz', { mode: 'length' }).text).toBe('a\nbb\nzz\nccc');
    expect(sortLines('👩‍👩‍👧\nab', { mode: 'length' }).text).toBe('👩‍👩‍👧\nab');
  });

  it('reverses and shuffles', () => {
    expect(sortLines('1\n2\n3', { mode: 'reverse' }).text).toBe('3\n2\n1');
    const shuffled = sortLines('1\n2\n3\n4\n5', { mode: 'shuffle' }).text.split('\n');
    expect(shuffled.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('unique, trim and remove empty', () => {
    const r = sortLines(' b\na\n\nB\na ', { mode: 'alpha', unique: true, trim: true, removeEmpty: true });
    expect(r.text).toBe('a\nb');
    expect(r.removed).toBe(3);
  });

  it('keeps trailing newline and handles empty input', () => {
    expect(sortLines('b\na\n', { mode: 'alpha' }).text).toBe('a\nb\n');
    expect(sortLines('').text).toBe('');
  });
});

describe('removeDuplicateLines', () => {
  it('keeps the first occurrence', () => {
    const r = removeDuplicateLines('a\nb\na\nc\nb');
    expect(r.text).toBe('a\nb\nc');
    expect(r.removed).toBe(2);
    expect(r.duplicates).toEqual([
      { line: 'a', count: 2 },
      { line: 'b', count: 2 },
    ]);
  });

  it('keeps the last occurrence', () => {
    expect(removeDuplicateLines('a\nb\na', { keep: 'last' }).text).toBe('b\na');
  });

  it('can ignore case and whitespace', () => {
    expect(removeDuplicateLines('Apple\napple', { caseInsensitive: true }).text).toBe('Apple');
    expect(removeDuplicateLines('a b\n a  b ', { whitespace: 'all' }).text).toBe('a b');
    expect(removeDuplicateLines('x\n x', { whitespace: 'trim' }).text).toBe('x');
    expect(removeDuplicateLines('x\n x').text).toBe('x\n x');
  });

  it('can keep blank lines', () => {
    expect(removeDuplicateLines('a\n\nb\n\nc', { keepBlank: true }).text).toBe('a\n\nb\n\nc');
    expect(removeDuplicateLines('a\n\nb\n\nc').text).toBe('a\n\nb\nc');
  });

  it('handles large input quickly', () => {
    const big = Array.from({ length: 100000 }, (_, i) => `line ${i % 1000}`).join('\n');
    const r = removeDuplicateLines(big);
    expect(r.kept).toBe(1000);
  });
});

describe('whitespace helpers', () => {
  it('expands tabs to tab stops', () => {
    expect(expandTabs('a\tb', 4)).toBe('a   b');
    expect(expandTabs('\tx', 2)).toBe('  x');
    expect(expandTabs('abcd\te', 4)).toBe('abcd    e');
  });

  it('converts leading spaces to tabs', () => {
    expect(leadingSpacesToTabs('        x  y', 4)).toBe('\t\tx  y');
    expect(leadingSpacesToTabs('      x', 4)).toBe('\t  x');
    expect(leadingSpacesToTabs('x', 4)).toBe('x');
  });
});

describe('cleanWhitespace', () => {
  it('strips trailing whitespace by default', () => {
    expect(cleanWhitespace('a  \nb\t\n').text).toBe('a\nb\n');
  });

  it('trims, collapses and removes empty lines', () => {
    const r = cleanWhitespace('  a   b  \n\n\n  c  ', { trim: 'both', collapseSpaces: true, emptyLines: 'remove' });
    expect(r.text).toBe('a b\nc');
    expect(r.linesBefore).toBe(4);
    expect(r.linesAfter).toBe(2);
  });

  it('collapses runs of blank lines to one', () => {
    expect(cleanWhitespace('a\n\n\n\nb', { emptyLines: 'collapse' }).text).toBe('a\n\nb');
  });

  it('collapsing keeps indentation', () => {
    expect(cleanWhitespace('    a    b', { collapseSpaces: true }).text).toBe('    a b');
  });

  it('converts line endings', () => {
    expect(cleanWhitespace('a\nb\n', { lineEndings: 'crlf' }).text).toBe('a\r\nb\r\n');
    expect(cleanWhitespace('a\r\nb', { lineEndings: 'lf' }).text).toBe('a\nb');
    expect(cleanWhitespace('a\r\nb').text).toBe('a\r\nb');
  });

  it('tabs to spaces and back', () => {
    expect(cleanWhitespace('\tx', { tabs: 'toSpaces', tabWidth: 2 }).text).toBe('  x');
    expect(cleanWhitespace('    x', { tabs: 'toTabs', tabWidth: 4 }).text).toBe('\tx');
  });

  it('normalizes unicode spaces and trims the document', () => {
    expect(cleanWhitespace('\n\na\u00a0b\u200bc\n\n', { normalizeUnicodeSpaces: true, trimDocument: true }).text).toBe('a bc');
  });

  it('empty input stays empty', () => {
    expect(cleanWhitespace('').text).toBe('');
  });
});

describe('addAffixes', () => {
  it('adds prefix and suffix, skipping empty lines', () => {
    expect(addAffixes('a\n\nb', { prefix: '- ', suffix: ';' })).toBe('- a;\n\n- b;');
    expect(addAffixes('a\n\nb', { prefix: '>', skipEmpty: false })).toBe('>a\n>\n>b');
  });

  it('wraps in quotes and escapes', () => {
    expect(addAffixes("it's\nok", { quote: 'single', escapeQuotes: true })).toBe("'it\\'s'\n'ok'");
    expect(addAffixes('a\nb', { quote: 'double' })).toBe('"a"\n"b"');
  });

  it('can join lines, e.g. for SQL IN lists', () => {
    expect(addAffixes('1\n2\n\n3', { quote: 'single', joinWith: ', ' })).toBe("'1', '2', '3'");
  });
});

describe('numberLines', () => {
  it('numbers from start with step', () => {
    expect(numberLines('a\nb\nc')).toBe('1. a\n2. b\n3. c');
    expect(numberLines('a\nb', { start: 10, step: 10, separator: ': ' })).toBe('10: a\n20: b');
  });

  it('pads numbers', () => {
    const text = Array.from({ length: 10 }, () => 'x').join('\n');
    expect(numberLines(text, { padding: 'zeros' }).split('\n')[0]).toBe('01. x');
    expect(numberLines(text, { padding: 'spaces' }).split('\n')[0]).toBe(' 1. x');
  });

  it('skips empty lines without consuming numbers', () => {
    expect(numberLines('a\n\nb', { skipEmpty: true })).toBe('1. a\n\n2. b');
  });

  it('supports negative steps', () => {
    expect(numberLines('a\nb\nc', { start: 1, step: -1 })).toBe('1. a\n0. b\n-1. c');
  });
});

describe('filterLines', () => {
  const text = 'apple pie\nBanana split\ncherry tart\napple';
  it('keeps lines that contain a term (case-insensitive)', () => {
    const r = filterLines(text, { action: 'keep', condition: 'contains', term: 'APPLE', caseSensitive: false, wholeWord: false });
    expect(r).toMatchObject({ ok: true, text: 'apple pie\napple', matched: 2, total: 4 });
  });

  it('removes lines that start with / end with', () => {
    expect(filterLines(text, { action: 'remove', condition: 'startsWith', term: 'b', caseSensitive: false, wholeWord: false })).toMatchObject({
      text: 'apple pie\ncherry tart\napple',
    });
    expect(filterLines(text, { action: 'keep', condition: 'endsWith', term: 'tart', caseSensitive: true, wholeWord: false })).toMatchObject({
      text: 'cherry tart',
    });
  });

  it('supports regex and whole words', () => {
    expect(filterLines(text, { action: 'keep', condition: 'regex', term: '^\\w+$', caseSensitive: true, wholeWord: false })).toMatchObject({
      text: 'apple',
    });
    expect(filterLines('cat\ncatalog', { action: 'keep', condition: 'contains', term: 'cat', caseSensitive: true, wholeWord: true })).toMatchObject({
      text: 'cat',
    });
  });

  it('reports invalid regex', () => {
    const r = filterLines(text, { action: 'keep', condition: 'regex', term: '(', caseSensitive: true, wholeWord: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/group is never closed/);
      expect(r.error).not.toMatch(/\/\(\//);
    }
  });

  it('filters empty lines', () => {
    expect(filterLines('a\n\n  \nb', { action: 'remove', condition: 'empty', term: '', caseSensitive: false, wholeWord: false })).toMatchObject({
      text: 'a\nb',
      matched: 2,
    });
  });
});
