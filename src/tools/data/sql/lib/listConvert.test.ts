import { describe, expect, it } from 'vitest';
import { buildList, cleanItems, isPlainNumber, parseList, quoteItem, splitItems, splitQuoted, stripWrapper, type BuildListOptions, type ParseListOptions } from './listConvert';

const B: BuildListOptions = {
  split: 'lines',
  trim: true,
  removeEmpty: true,
  dedupe: false,
  sort: 'none',
  format: 'sql',
  unquotedNumbers: true,
  quote: 'single',
  escape: 'double',
  separator: ', ',
  prefix: '',
  suffix: '',
  perLine: 0,
  column: '',
  chunk: 0,
};

const P: ParseListOptions = { separator: 'auto', unquote: true, trim: true, removeEmpty: true, dedupe: false, sort: 'none' };

function build(text: string, options: Partial<BuildListOptions> = {}) {
  return buildList(text, { ...B, ...options });
}

describe('buildList: SQL IN', () => {
  it('quotes and escapes text', () => {
    expect(build("apple\nO'Brien\n  pear  \n\n").output).toBe("IN ('apple', 'O''Brien', 'pear')");
  });

  it('leaves numbers unquoted when every item is a number', () => {
    const r = build('1\n2\n-3.5\n1e3');
    expect(r.output).toBe('IN (1, 2, -3.5, 1e3)');
    expect(r.stats.numeric).toBe(true);
  });

  it('quotes everything in a mixed list and says so', () => {
    const r = build('1\nabc\n007');
    expect(r.output).toBe("IN ('1', 'abc', '007')");
    expect(r.notes[0]).toMatch(/mixes numbers and text/);
  });

  it('keeps leading-zero codes quoted', () => {
    expect(build('007\n0123').output).toBe("IN ('007', '0123')");
  });

  it('adds a column and NOT IN', () => {
    expect(build('1\n2', { column: 'user_id' }).output).toBe('user_id IN (1, 2)');
    expect(build('1\n2', { column: 'user_id', negate: true }).output).toBe('user_id NOT IN (1, 2)');
  });

  it('splits long lists for Oracle-style limits', () => {
    const r = build('1\n2\n3\n4\n5', { column: 'id', chunk: 2 });
    expect(r.output).toBe('(id IN (1, 2)\n  OR id IN (3, 4)\n  OR id IN (5))');
    expect(r.notes).toEqual(['Split into 3 lists of at most 2 items.']);
    expect(build('1\n2\n3', { column: 'id', chunk: 2, negate: true }).output).toBe('(id NOT IN (1, 2)\n  AND id NOT IN (3))');
  });

  it('asks for a column before splitting', () => {
    const r = build('1\n2\n3', { chunk: 2 });
    expect(r.output).toBe('IN (1, 2, 3)');
    expect(r.notes[0]).toMatch(/Enter a column name/);
  });

  it('wraps several items per line', () => {
    expect(build('a\nb\nc\nd\ne', { perLine: 2 }).output).toBe("IN (\n  'a', 'b',\n  'c', 'd',\n  'e'\n)");
  });

  it('returns nothing for empty input', () => {
    expect(build('').output).toBe('');
    expect(build('\n  \n').output).toBe('');
  });
});

describe('buildList: JSON and quoted lists', () => {
  it('writes a JSON array with escaping', () => {
    expect(build('a "quoted" word\nback\\slash\n😀', { format: 'json' }).output).toBe('["a \\"quoted\\" word", "back\\\\slash", "😀"]');
    expect(build('1\n2', { format: 'json' }).output).toBe('[1, 2]');
    expect(build('1\n2', { format: 'json', unquotedNumbers: false }).output).toBe('["1", "2"]');
  });

  it('writes quoted lists with any quote, separator and wrapper', () => {
    expect(build('a\nb', { format: 'quoted' }).output).toBe("'a', 'b'");
    expect(build('a\nb', { format: 'quoted', quote: 'double', separator: ',' }).output).toBe('"a","b"');
    expect(build('a\nb', { format: 'quoted', quote: 'none', separator: ' | ', prefix: '{', suffix: '}' }).output).toBe('{a | b}');
    expect(build('a\nb', { format: 'quoted', separator: '\\n' }).output).toBe("'a'\n'b'");
    expect(build('a\nb\nc', { format: 'quoted', perLine: 2 }).output).toBe("'a', 'b',\n'c'");
    expect(build('a\nb\nc', { format: 'quoted', perLine: 2, prefix: '(', suffix: ')' }).output).toBe("(\n  'a', 'b',\n  'c'\n)");
  });

  it('escapes quotes by doubling, backslashes or not at all', () => {
    expect(quoteItem("it's", 'single', 'double')).toBe("'it''s'");
    expect(quoteItem("it's \\ ok", 'single', 'backslash')).toBe("'it\\'s \\\\ ok'");
    expect(quoteItem("it's", 'single', 'none')).toBe("'it's'");
    expect(quoteItem('a`b', 'backtick', 'double')).toBe('`a``b`');
    expect(quoteItem('x', 'none', 'double')).toBe('x');
  });
});

describe('cleaning', () => {
  it('trims, removes empty lines and duplicates (keeping the first)', () => {
    const r = cleanItems([' a ', 'b', '', 'a', 'B', '  '], { trim: true, removeEmpty: true, dedupe: true, sort: 'none' });
    expect(r).toEqual({ items: ['a', 'b', 'B'], duplicates: 1, empty: 2 });
  });

  it('can ignore case when removing duplicates', () => {
    expect(cleanItems(['Apple', 'apple', 'APPLE', 'pear'], { trim: true, removeEmpty: true, dedupe: true, ignoreCase: true, sort: 'none' }).items).toEqual(['Apple', 'pear']);
  });

  it('sorts naturally and numerically', () => {
    expect(cleanItems(['item10', 'item2', 'Item1'], { trim: true, removeEmpty: true, dedupe: false, sort: 'asc' }).items).toEqual(['Item1', 'item2', 'item10']);
    expect(cleanItems(['10', '9', '-1', '1.5'], { trim: true, removeEmpty: true, dedupe: false, sort: 'desc' }).items).toEqual(['10', '9', '1.5', '-1']);
  });

  it('keeps whitespace when trimming is off', () => {
    expect(cleanItems([' a '], { trim: false, removeEmpty: true, dedupe: false, sort: 'none' }).items).toEqual([' a ']);
  });

  it('reports counts in the build result', () => {
    const r = build('a\na\n\nb', { dedupe: true });
    expect(r.stats).toEqual({ found: 4, items: 2, duplicates: 1, empty: 1, numeric: false });
  });
});

describe('splitting input', () => {
  it('splits on lines, commas, whitespace or anything', () => {
    expect(splitItems('a\r\nb\nc', 'lines')).toEqual(['a', 'b', 'c']);
    expect(splitItems('a, b,c', 'commas')).toEqual(['a', ' b', 'c']);
    expect(splitItems('a  b\tc\nd', 'whitespace')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitItems('a,b;c\td\ne', 'any')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitItems('', 'lines')).toEqual([]);
  });

  it('builds from a comma-separated row', () => {
    expect(build('1, 2, 3', { split: 'commas' }).output).toBe('IN (1, 2, 3)');
  });

  it('handles large lists', () => {
    const text = Array.from({ length: 50000 }, (_, i) => String(i % 1000)).join('\n');
    const r = build(text, { dedupe: true, sort: 'asc' });
    expect(r.stats.items).toBe(1000);
    expect(r.output.startsWith('IN (0, 1, 2,')).toBe(true);
  });

  it('recognizes plain numbers', () => {
    for (const s of ['0', '-1', '3.14', '1e-5', '12345678901234567890']) expect(isPlainNumber(s), s).toBe(true);
    for (const s of ['007', '+1', '1.', '.5', '1,000', '0x1F', 'NaN', '']) expect(isPlainNumber(s), s).toBe(false);
  });
});

describe('parseList (list → lines)', () => {
  it('reads an SQL IN clause', () => {
    const r = parseList("WHERE x AND status NOT IN ('new', 'O''Brien', 3)", P);
    expect(r.items).toEqual(["WHERE x AND status NOT IN ('new'", "O'Brien", '3)']);
    expect(parseList("status NOT IN ('new', 'O''Brien', 3);", P).items).toEqual(['new', "O'Brien", '3']);
    expect(parseList('IN (1,2,3)', P).output).toBe('1\n2\n3');
  });

  it('reads quoted lists with commas inside quotes', () => {
    expect(parseList('"a, b", \'c\', `d`, e', P).items).toEqual(['a, b', 'c', 'd', 'e']);
  });

  it('unescapes backslash-escaped quotes but keeps Windows paths', () => {
    expect(parseList("'it\\'s', 'C:\\new', 'back\\\\slash'", P).items).toEqual(["it's", 'C:\\new', 'back\\slash']);
  });

  it('reads JSON arrays exactly', () => {
    const r = parseList('["a\\nb", "\\u00e9", 1, true, null]', P);
    expect(r.items).toEqual(['a\nb', 'é', '1', 'true', 'null']);
  });

  it('strips brackets and braces', () => {
    expect(stripWrapper("['a', 'b']")).toBe("'a', 'b'");
    expect(stripWrapper('{1, 2}')).toBe('1, 2');
    expect(stripWrapper('(x)')).toBe('x');
    expect(stripWrapper('t.id IN (1)')).toBe('1');
  });

  it('detects the separator', () => {
    expect(parseList('a;b;c', P)).toMatchObject({ items: ['a', 'b', 'c'], separator: ';' });
    expect(parseList('a\tb', P)).toMatchObject({ items: ['a', 'b'], separator: '\t' });
    expect(parseList('a|b', P)).toMatchObject({ items: ['a', 'b'], separator: '|' });
    expect(parseList('a b  c', P)).toMatchObject({ items: ['a', 'b', 'c'], separator: 'whitespace' });
    expect(parseList('John Smith\nJane Doe', P)).toMatchObject({ items: ['John Smith', 'Jane Doe'], separator: 'newline' });
  });

  it('treats line breaks after commas as layout', () => {
    expect(parseList("'a',\n  'b',\n  'c'", P).items).toEqual(['a', 'b', 'c']);
    expect(parseList('a,,b', { ...P, removeEmpty: false }).items).toEqual(['a', '', 'b']);
  });

  it('can keep quotes', () => {
    expect(parseList("'a', 'b'", { ...P, unquote: false }).items).toEqual(["'a'", "'b'"]);
  });

  it('keeps an unclosed quote as text', () => {
    expect(parseList("'a, b", P).items).toEqual(["'a", 'b']);
  });

  it('dedupes and sorts the result', () => {
    expect(parseList('b, a, b, c', { ...P, dedupe: true, sort: 'asc' }).output).toBe('a\nb\nc');
  });

  it('returns nothing for empty input', () => {
    expect(parseList('', P)).toMatchObject({ items: [], output: '' });
    expect(parseList('IN ()', P)).toMatchObject({ items: [], output: '' });
  });

  it('round-trips with buildList', () => {
    const items = ["O'Brien", 'a, b', 'plain', 'emoji 😀'];
    const built = build(items.join('\n'));
    expect(parseList(built.output, P).items).toEqual(items);
    const json = build(items.join('\n'), { format: 'json' });
    expect(parseList(json.output, P).items).toEqual(items);
  });

  it('splits with a forced separator', () => {
    expect(splitQuoted('a;b,c', ';', true)).toEqual(['a', 'b,c']);
    expect(splitQuoted('a\t\tb', '\t', true)).toEqual(['a', '', 'b']);
  });
});
