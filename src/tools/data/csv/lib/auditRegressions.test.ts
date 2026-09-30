import { describe, expect, it } from 'vitest';
import { countFormulaCells, looksLikeFormula } from './csv';
import { inferValue, jsonToTable, numberRoundTrips, tableToJsonValue } from './csvJson';
import { decodeQuality, sniffEncoding } from './encoding';
import { toHtmlTable } from './htmlTable';
import { columnStats, detectNumberStyle, parseStyledNumber } from './stats';
import { cellNumber, compareCells, viewIndices } from './table';

describe('CSV → JSON number inference (regression: over-precise decimals were rounded)', () => {
  it('keeps numbers only when their exact value survives', () => {
    expect(numberRoundTrips('1.50')).toBe(true);
    expect(numberRoundTrips('0.1')).toBe(true);
    expect(numberRoundTrips('1e5')).toBe(true);
    expect(numberRoundTrips('0.12345678901234567890')).toBe(false);
    expect(numberRoundTrips('9007199254740993')).toBe(false);
    expect(inferValue('0.12345678901234567890')).toBe('0.12345678901234567890');
    expect(inferValue('12345678901234567890')).toBe('12345678901234567890');
    expect(inferValue('1.50')).toBe(1.5);
    expect(tableToJsonValue({ headers: ['v'], rows: [['3.14159265358979323846']] })).toEqual([{ v: '3.14159265358979323846' }]);
  });
});

describe('JSON → CSV with many array rows (regression: Math.max spread overflowed the stack)', () => {
  it('converts 250,000 arrays', () => {
    const rows = Array.from({ length: 250_000 }, (_, i) => [i, `r${i}`]);
    const t = jsonToTable(rows).table;
    expect(t.headers).toEqual(['Column 1', 'Column 2']);
    expect(t.rows).toHaveLength(250_000);
  });
});

describe('HTML table from CSV without a header row (regression: generated names became a data row)', () => {
  it('leaves generated column names out', () => {
    const html = toHtmlTable({ headers: ['Column 1', 'Column 2'], rows: [['a', 'b']] }, { headerRow: false, indent: 'none' });
    expect(html).toBe('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
    expect(toHtmlTable({ headers: ['h'], rows: [['x']] }, { thead: false, indent: 'none' })).toContain('<td>h</td>');
  });
});

describe('grid sorting (regression: "1,234" sorted before "999")', () => {
  it('reads thousands separators and sorts numerically', () => {
    expect(cellNumber('1,234.5')).toBe(1234.5);
    expect(Number.isNaN(cellNumber('1,23'))).toBe(true);
    expect(compareCells('999', '1,234')).toBeLessThan(0);
    const table = { headers: ['n'], rows: [['1,234'], [''], ['999'], ['abc'], ['12']] };
    expect(viewIndices(table, { sort: { column: 0, dir: 'asc' } })).toEqual([4, 2, 0, 3, 1]);
    expect(viewIndices(table, { sort: { column: 0, dir: 'desc' } })).toEqual([3, 0, 2, 4, 1]);
  });
});

describe('CSV statistics with separators (regression: such columns were profiled as text)', () => {
  it('detects comma thousands and decimal commas', () => {
    expect(detectNumberStyle(['1,234.50', '12', '2,000'])).toBe('grouped');
    expect(detectNumberStyle(['1.234,50', '3,5'])).toBe('decimal-comma');
    expect(detectNumberStyle(['1,234'], true)).toBe('decimal-comma');
    expect(detectNumberStyle(['1.5', '3,14'])).toBeNull();
    expect(parseStyledNumber('1 234,5', 'decimal-comma')).toBe(1234.5);
    const s = columnStats({ headers: ['amount'], rows: [['1,234.50'], ['2,000'], ['12'], ['']] }, 0);
    expect(s).toMatchObject({ type: 'decimal', numberFormat: 'grouped', empty: 1 });
    expect(s.numeric).toMatchObject({ min: 12, max: 2000, sum: 3246.5 });
    const eu = columnStats({ headers: ['p'], rows: [['1.234,5'], ['3,5']] }, 0, { preferDecimalComma: true });
    expect(eu.numeric).toMatchObject({ min: 3.5, max: 1234.5 });
  });
});

describe('file encoding detection (new)', () => {
  it('recognizes byte order marks and BOM-less UTF-16', () => {
    expect(sniffEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0]))).toEqual({ encoding: 'utf-16le', bom: true });
    expect(sniffEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ encoding: 'utf-8', bom: true });
    const utf16 = new Uint8Array([...'a,b\r\n1,2\r\n'].flatMap((c) => [c.charCodeAt(0), 0]));
    expect(sniffEncoding(utf16)).toEqual({ encoding: 'utf-16le', bom: false });
    expect(sniffEncoding(new TextEncoder().encode('name,city\nZoë,Köln\n'))).toBeNull();
    expect(decodeQuality('Zo� Köln')).toEqual({ replaced: 1, nonAscii: 1 });
  });
});

describe('spreadsheet formula detection (new)', () => {
  it('flags cells that spreadsheets would run', () => {
    expect(looksLikeFormula('=HYPERLINK("http://x")')).toBe(true);
    expect(looksLikeFormula('@SUM(A1)')).toBe(true);
    expect(looksLikeFormula('-5')).toBe(false);
    expect(looksLikeFormula('+44 20 7946 0958')).toBe(true);
    expect(countFormulaCells({ headers: ['=h', 'b'], rows: [['1', '=1+1'], ['-2', 'x']] })).toBe(2);
    expect(countFormulaCells({ headers: ['=h'], rows: [] }, false)).toBe(0);
  });
});
