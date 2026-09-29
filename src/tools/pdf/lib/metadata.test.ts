import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  EMPTY_METADATA,
  customInfoEntries,
  formatPdfDate,
  infoDict,
  parsePdfDate,
  readMetadata,
  removeAllMetadata,
  writeMetadata,
} from './metadata';

async function roundTrip(doc: PDFDocument) {
  return PDFDocument.load(await doc.save(), { updateMetadata: false });
}

describe('PDF dates', () => {
  it('parses full dates with timezone offsets', () => {
    expect(parsePdfDate("D:20240131120000+02'00'")!.toISOString()).toBe('2024-01-31T10:00:00.000Z');
    expect(parsePdfDate("D:20240131120000-05'30")!.toISOString()).toBe('2024-01-31T17:30:00.000Z');
    expect(parsePdfDate('D:20240131120000Z')!.toISOString()).toBe('2024-01-31T12:00:00.000Z');
  });

  it('accepts partial dates and a missing prefix', () => {
    expect(parsePdfDate('D:2023')!.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    expect(parsePdfDate('20230704')!.toISOString()).toBe('2023-07-04T00:00:00.000Z');
  });

  it('rejects invalid dates', () => {
    expect(parsePdfDate('yesterday')).toBeNull();
    expect(parsePdfDate('D:20231340')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
  });

  it('formats in UTC and round-trips', () => {
    const d = new Date('2021-03-04T05:06:07Z');
    expect(formatPdfDate(d)).toBe('D:20210304050607Z');
    expect(parsePdfDate(formatPdfDate(d))!.getTime()).toBe(d.getTime());
  });
});

describe('read/write metadata', () => {
  it('reads an empty document', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const meta = readMetadata(doc);
    expect(meta.fields).toEqual(EMPTY_METADATA);
    expect(meta.hasXmp).toBe(false);
  });

  it('writes every field and reads it back, including Unicode and emoji', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    writeMetadata(doc, {
      title: 'Rapport annuel 🥚 (draft)',
      author: 'Zoë Ångström',
      subject: 'Back\\slash and (parens)',
      keywords: 'pdf, local, 日本語',
      creator: 'LocalKit',
      producer: 'Test',
      creationDate: '2020-01-02T03:04:05.000Z',
      modDate: '2021-06-07T08:09:10.000Z',
    });
    const meta = readMetadata(await roundTrip(doc));
    expect(meta.fields).toEqual({
      title: 'Rapport annuel 🥚 (draft)',
      author: 'Zoë Ångström',
      subject: 'Back\\slash and (parens)',
      keywords: 'pdf, local, 日本語',
      creator: 'LocalKit',
      producer: 'Test',
      creationDate: '2020-01-02T03:04:05.000Z',
      modDate: '2021-06-07T08:09:10.000Z',
    });
  });

  it('removes fields that are cleared', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    writeMetadata(doc, { ...EMPTY_METADATA, title: 'x', author: 'y' });
    writeMetadata(doc, { ...EMPTY_METADATA, title: 'x' });
    const dict = infoDict(doc)!;
    expect(dict.has(PDFName.of('Author'))).toBe(false);
    expect(readMetadata(doc).fields.title).toBe('x');
  });

  it('trims whitespace-only values to nothing', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    writeMetadata(doc, { ...EMPTY_METADATA, title: '   ' });
    expect(infoDict(doc)!.has(PDFName.of('Title'))).toBe(false);
  });

  it('rejects an invalid date', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    expect(() => writeMetadata(doc, { ...EMPTY_METADATA, creationDate: 'not a date' })).toThrow(/not a valid date/);
  });

  it('reports custom keys and unparseable dates', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const dict = infoDict(doc, true)!;
    dict.set(PDFName.of('Company'), PDFString.of('ACME'));
    dict.set(PDFName.of('CreationDate'), PDFString.of('garbage'));
    const meta = readMetadata(await roundTrip(doc));
    expect(meta.custom).toEqual([{ key: 'Company', value: 'ACME' }]);
    expect(meta.invalidDates).toEqual(['garbage']);
    expect(meta.fields.creationDate).toBe('');
  });

  it('removes the XMP stream when asked', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const ref = doc.context.register(doc.context.stream('<x:xmpmeta/>'));
    doc.catalog.set(PDFName.of('Metadata'), ref);
    expect(readMetadata(doc).hasXmp).toBe(true);
    writeMetadata(doc, { ...EMPTY_METADATA, title: 'T' }, { removeXmp: true });
    expect(readMetadata(doc).hasXmp).toBe(false);
    // The packet itself is deleted too, not just unlinked (it would otherwise still be saved).
    expect(doc.context.lookup(ref)).toBeUndefined();
  });

  it('removeAllMetadata strips Info and XMP', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Secret');
    doc.setAuthor('Someone');
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream('<x:xmpmeta/>')));
    removeAllMetadata(doc);
    const loaded = await roundTrip(doc);
    const meta = readMetadata(loaded);
    expect(meta.fields).toEqual(EMPTY_METADATA);
    expect(meta.hasXmp).toBe(false);
    const saved = new TextDecoder('latin1').decode(await loaded.save());
    expect(saved).not.toContain('Secret');
  });
});

describe('datetime-local helpers', () => {
  it('round-trips local input values', async () => {
    const { isoToLocalInput, localInputToIso } = await import('./dates');
    const iso = localInputToIso('2024-02-29T13:45:10');
    expect(isoToLocalInput(iso)).toBe('2024-02-29T13:45:10');
    expect(isoToLocalInput(localInputToIso('2024-02-29T13:45'))).toBe('2024-02-29T13:45:00');
    expect(localInputToIso('')).toBe('');
    expect(localInputToIso('garbage')).toBe('');
    expect(isoToLocalInput('')).toBe('');
    expect(isoToLocalInput('not a date')).toBe('');
  });
});

describe('customInfoEntries (pdf.js getMetadata().info.Custom)', () => {
  it('reads the Map that pdf.js 6 returns', () => {
    const custom = new Map<string, unknown>([
      ['Company', 'ACME'],
      ['Approved', true],
      ['Pages', 12],
      ['Kind', { name: 'Report' }],
    ]);
    expect(customInfoEntries(custom)).toEqual([
      { key: 'Company', value: 'ACME' },
      { key: 'Approved', value: 'true' },
      { key: 'Pages', value: '12' },
      { key: 'Kind', value: 'Report' },
    ]);
  });

  it('still reads plain objects (older pdf.js) and ignores missing values', () => {
    expect(customInfoEntries({ Company: 'ACME' })).toEqual([{ key: 'Company', value: 'ACME' }]);
    expect(customInfoEntries(undefined)).toEqual([]);
    expect(customInfoEntries(null)).toEqual([]);
    expect(customInfoEntries(new Map())).toEqual([]);
  });
});
