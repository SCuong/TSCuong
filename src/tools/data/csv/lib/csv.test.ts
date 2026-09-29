import { describe, expect, it } from 'vitest';
import {
  buildTable,
  countUnsafeUnquoted,
  delimiterName,
  detectDelimiter,
  formatField,
  isNumeric,
  normalizeCustomDelimiter,
  parseCsv,
  stripBom,
  uniqueHeaders,
  validateDelimiter,
  writeCsv,
} from './csv';

describe('parseCsv', () => {
  it('returns an empty table for empty or blank input', () => {
    expect(parseCsv('').table).toEqual({ headers: [], rows: [] });
    expect(parseCsv('  \n\n ').table).toEqual({ headers: [], rows: [] });
  });

  it('parses a simple CSV with a header row', () => {
    const r = parseCsv('name,age\nAda,36\nAlan,41');
    expect(r.table.headers).toEqual(['name', 'age']);
    expect(r.table.rows).toEqual([
      ['Ada', '36'],
      ['Alan', '41'],
    ]);
    expect(r.delimiter).toBe(',');
    expect(r.issues).toEqual([]);
  });

  it('generates column names without a header row', () => {
    const r = parseCsv('a,b\nc,d', { header: false });
    expect(r.table.headers).toEqual(['Column 1', 'Column 2']);
    expect(r.table.rows).toHaveLength(2);
  });

  it('handles quoted fields with delimiters, quotes and embedded newlines', () => {
    const r = parseCsv('id,text\n1,"hello, world"\n2,"she said ""hi"""\n3,"line one\nline two"');
    expect(r.table.rows).toEqual([
      ['1', 'hello, world'],
      ['2', 'she said "hi"'],
      ['3', 'line one\nline two'],
    ]);
  });

  it('strips a BOM and handles CRLF line endings', () => {
    const r = parseCsv('\uFEFFa,b\r\n1,2\r\n');
    expect(r.table.headers).toEqual(['a', 'b']);
    expect(r.table.rows).toEqual([['1', '2']]);
    expect(r.linebreak).toBe('\r\n');
  });

  it('auto-detects semicolons, tabs and pipes', () => {
    expect(parseCsv('a;b;c\n1;2;3').delimiter).toBe(';');
    expect(parseCsv('a\tb\tc\n1\t2\t3').delimiter).toBe('\t');
    expect(parseCsv('a|b|c\n1|2|3').delimiter).toBe('|');
  });

  it('respects an explicit delimiter', () => {
    const r = parseCsv('a;b,c\n1;2,3', { delimiter: ';' });
    expect(r.table.headers).toEqual(['a', 'b,c']);
  });

  it('pads ragged rows and counts them', () => {
    const r = parseCsv('a,b,c\n1,2\n1,2,3,4');
    expect(r.table.headers).toEqual(['a', 'b', 'c', 'Column 4']);
    expect(r.table.rows).toEqual([
      ['1', '2', '', ''],
      ['1', '2', '3', '4'],
    ]);
    expect(r.raggedRows).toBe(1);
  });

  it('reports an unclosed quote as a readable issue', () => {
    const r = parseCsv('a,b\n1,"oops\n2,3');
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0].message).toMatch(/never closed/);
  });

  it('trims cells when asked', () => {
    expect(parseCsv('a , b\n 1 , 2 ', { trim: true }).table).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('keeps Unicode and emoji intact', () => {
    const r = parseCsv('name,emoji\nZoë,👩‍💻\n東京,🍣');
    expect(r.table.rows).toEqual([
      ['Zoë', '👩‍💻'],
      ['東京', '🍣'],
    ]);
  });

  it('parses a large input', () => {
    const lines = ['id,value'];
    for (let i = 0; i < 20_000; i++) lines.push(`${i},"v ${i}"`);
    const r = parseCsv(lines.join('\n'));
    expect(r.table.rows).toHaveLength(20_000);
    expect(r.table.rows[19_999]).toEqual(['19999', 'v 19999']);
  });

  it('keeps empty lines when skipEmptyLines is false', () => {
    const r = parseCsv('a\n\nb', { header: false, skipEmptyLines: false });
    expect(r.table.rows.length).toBe(3);
  });
});

describe('buildTable', () => {
  it('handles no records', () => {
    expect(buildTable([], true)).toEqual({ table: { headers: [], rows: [] }, raggedRows: 0 });
  });
});

describe('detectDelimiter', () => {
  it('falls back to a comma for empty or single-column text', () => {
    expect(detectDelimiter('')).toBe(',');
    expect(detectDelimiter('one\ntwo')).toBe(',');
  });
  it('detects a semicolon', () => {
    expect(detectDelimiter('\uFEFFa;b\n1;2')).toBe(';');
  });
});

describe('writeCsv', () => {
  const table = {
    headers: ['name', 'note'],
    rows: [
      ['Ada', 'a, b'],
      ['Bob', 'say "hi"'],
      ['Cy', 'two\nlines'],
    ],
  };

  it('quotes only when needed by default', () => {
    expect(writeCsv(table)).toBe('name,note\nAda,"a, b"\nBob,"say ""hi"""\nCy,"two\nlines"');
  });

  it('round-trips through parseCsv', () => {
    const text = writeCsv(table);
    expect(parseCsv(text).table).toEqual(table);
  });

  it('supports other delimiters, CRLF, BOM and no header', () => {
    const out = writeCsv(
      { headers: ['a', 'b'], rows: [['1', '2']] },
      { delimiter: '\t', newline: '\r\n', bom: true, includeHeader: false },
    );
    expect(out).toBe('\uFEFF1\t2');
    expect(writeCsv({ headers: ['a', 'b'], rows: [['1', '2']] }, { newline: '\r\n' })).toBe('a,b\r\n1,2');
  });

  it('quotes all or non-numeric fields', () => {
    const t = { headers: ['n', 's'], rows: [['1.5', 'x']] };
    expect(writeCsv(t, { quote: 'all' })).toBe('"n","s"\n"1.5","x"');
    expect(writeCsv(t, { quote: 'nonnumeric' })).toBe('"n","s"\n1.5,"x"');
  });

  it('never quotes in "none" mode', () => {
    expect(writeCsv({ headers: ['a'], rows: [['x,y']] }, { quote: 'none' })).toBe('a\nx,y');
  });

  it('uses a custom quote character', () => {
    expect(writeCsv({ headers: ['a'], rows: [["it's, ok"]] }, { quoteChar: "'" })).toBe("a\n'it''s, ok'");
  });

  it('escapes spreadsheet formulas when asked', () => {
    const t = { headers: ['v'], rows: [['=SUM(A1)'], ['-5'], ['@cmd'], ['+x']] };
    expect(writeCsv(t, { escapeFormulae: true })).toBe("v\n'=SUM(A1)\n-5\n'@cmd\n'+x");
  });

  it('quotes fields with leading or trailing spaces', () => {
    expect(formatField(' x', { delimiter: ',', quoteChar: '"', quote: 'minimal', escapeFormulae: false })).toBe('" x"');
  });

  it('writes an empty table as just the header', () => {
    expect(writeCsv({ headers: [], rows: [] })).toBe('');
  });
});

describe('helpers', () => {
  it('stripBom', () => {
    expect(stripBom('\uFEFFx')).toBe('x');
    expect(stripBom('x')).toBe('x');
  });

  it('isNumeric', () => {
    expect(isNumeric('12')).toBe(true);
    expect(isNumeric('-1.5e3')).toBe(true);
    expect(isNumeric('1,000')).toBe(false);
    expect(isNumeric('')).toBe(false);
  });

  it('delimiterName', () => {
    expect(delimiterName('\t')).toBe('Tab');
    expect(delimiterName(' ')).toBe('Space');
    expect(delimiterName('#')).toBe('“#”');
  });

  it('countUnsafeUnquoted', () => {
    expect(countUnsafeUnquoted({ headers: ['a,b'], rows: [['x'], ['y\nz'], ['"q']] }, ',')).toBe(3);
    expect(countUnsafeUnquoted({ headers: ['a,b'], rows: [] }, ',', '"', false)).toBe(0);
  });

  it('uniqueHeaders makes names unique and non-empty', () => {
    expect(uniqueHeaders(['a', 'a', '', 'a_2', 'b'])).toEqual(['a', 'a_2', 'column_3', 'a_2_2', 'b']);
  });

  it('normalizeCustomDelimiter', () => {
    expect(normalizeCustomDelimiter('\\t')).toBe('\t');
    expect(normalizeCustomDelimiter('TAB')).toBe('\t');
    expect(normalizeCustomDelimiter('space')).toBe(' ');
    expect(normalizeCustomDelimiter('~')).toBe('~');
  });

  it('validateDelimiter', () => {
    expect(validateDelimiter('')).toMatch(/Enter/);
    expect(validateDelimiter('\n')).toMatch(/line break/);
    expect(validateDelimiter('"')).toMatch(/quote/);
    expect(validateDelimiter(';')).toBeNull();
  });
});
