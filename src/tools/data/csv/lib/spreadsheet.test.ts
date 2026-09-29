import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { checkSignature, describeWorkbookError, trimRecords, workbookToSheets } from './spreadsheet';

describe('trimRecords', () => {
  it('drops trailing empty rows and columns and pads short rows', () => {
    expect(
      trimRecords([
        ['a', '', ''],
        ['b', 'c'],
        ['', '', ''],
      ]),
    ).toEqual([
      ['a', ''],
      ['b', 'c'],
    ]);
    expect(trimRecords([])).toEqual([]);
    expect(trimRecords([['', '']])).toEqual([]);
  });
});

function roundTrip(book: XLSX.WorkBook, bookType: XLSX.BookType) {
  const data = XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer;
  return XLSX.read(new Uint8Array(data), { type: 'array', dense: true, cellDates: true });
}

describe('workbookToSheets', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Name', 'Qty', 'Price'],
      ['Zoë 🍣', 3, 1.5],
      ['東京', 10, true],
    ]),
    'Items',
  );
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Empty');
  const offset = XLSX.utils.aoa_to_sheet([['x', 'y']], { origin: 'C3' } as XLSX.AOA2SheetOpts);
  offset['!ref'] = 'C3:D3'; // Real files often start their used range away from A1.
  XLSX.utils.book_append_sheet(book, offset, 'Offset');

  for (const type of ['xlsx', 'ods'] as const) {
    it(`reads every sheet from ${type}`, () => {
      const sheets = workbookToSheets(XLSX, roundTrip(book, type));
      expect(sheets.map((s) => s.name)).toEqual(['Items', 'Empty', 'Offset']);
      expect(sheets[0].records).toEqual([
        ['Name', 'Qty', 'Price'],
        ['Zoë 🍣', '3', '1.5'],
        ['東京', '10', 'TRUE'],
      ]);
      expect(sheets[0].range).toBe('A1:C3');
      expect(sheets[1].records).toEqual([]);
    });
  }

  it('reports where an offset range starts', () => {
    const sheets = workbookToSheets(XLSX, roundTrip(book, 'xlsx'));
    expect(sheets[2]).toMatchObject({ firstColumn: 'C', firstRow: 3, records: [['x', 'y']] });
  });
});

describe('checkSignature', () => {
  const text = new TextEncoder().encode('this is not a spreadsheet');
  const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
  it('requires a ZIP package for xlsx/ods', () => {
    expect(checkSignature('a.xlsx', text)).toMatch(/not a valid XLSX/);
    expect(checkSignature('a.ODS', text)).toMatch(/not a valid ODS/);
    expect(checkSignature('a.xlsx', zip)).toBeNull();
  });
  it('lets encrypted (OLE) xlsx through for SheetJS to explain', () => {
    expect(checkSignature('a.xlsx', ole)).toBeNull();
    expect(checkSignature('a.ods', ole)).toMatch(/not a valid/);
  });
  it('accepts anything for legacy xls, rejects empty files', () => {
    expect(checkSignature('a.xls', text)).toBeNull();
    expect(checkSignature('a.xls', new Uint8Array())).toMatch(/empty/);
  });
});

describe('describeWorkbookError', () => {
  it('maps common failures to sentences', () => {
    expect(describeWorkbookError(new Error('File is password-protected'))).toMatch(/password-protected/);
    expect(describeWorkbookError(new Error('Unsupported file 123'))).toMatch(/could not be read/);
    expect(describeWorkbookError(new RangeError('Array buffer allocation failed'))).toMatch(/too large/);
    expect(describeWorkbookError('weird')).toBe('weird');
  });

  it('does not call a corrupt ZIP password-protected', () => {
    expect(describeWorkbookError(new Error('Unsupported ZIP encryption'))).toMatch(/could not be read/);
  });

  it('XLSX rejects garbage input', () => {
    expect(() => XLSX.read(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), { type: 'array' })).toThrow();
  });
});
