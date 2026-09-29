import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts } from 'pdf-lib';
import {
  addPageNumbers,
  addTextLayer,
  addWatermark,
  compressLossless,
  crop,
  formatPageNumber,
  hasPageToken,
  imagePlacement,
  imagesToPdf,
  inspectStructure,
  merge,
  organize,
  rotate,
  selectPages,
  setMetadata,
  split,
} from './ops';
import { EMPTY_METADATA, readMetadata } from './metadata';
import { PdfError } from './errors';
import { encryptRc4, load, makePdf, pageIds } from './fixtures.test-util';

// 1×1 red PNG
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

async function contentText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams = contents && 'size' in contents ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i)) : [contents];
  let text = '';
  for (const s of streams) {
    if (s instanceof PDFRawStream) {
      const { decodePDFRawStream } = await import('pdf-lib');
      text += new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());
    } else if (s && 'getContentsString' in s) {
      text += (s as unknown as { getContentsString(): string }).getContentsString();
    }
  }
  return text;
}

describe('merge', () => {
  it('concatenates documents in order with per-file page selections', async () => {
    const a = await makePdf(3);
    const b = await makePdf(2, { sizes: [[210, 300], [211, 300]] });
    const out = await merge({
      files: [
        { bytes: a, name: 'a.pdf' },
        { bytes: b, name: 'b.pdf', pages: [1, 0] },
      ],
    });
    expect(await pageIds(out)).toEqual([0, 1, 2, 11, 10]);
  });

  it('keeps the first document title and reports progress', async () => {
    const a = await makePdf(2, { title: 'First' });
    const b = await makePdf(1, { title: 'Second' });
    const progress: number[] = [];
    const out = await merge(
      { files: [{ bytes: a, name: 'a' }, { bytes: b, name: 'b' }] },
      { progress: (v) => progress.push(v), checkCancelled: () => {} },
    );
    expect((await load(out)).getTitle()).toBe('First');
    expect(progress.length).toBeGreaterThan(1);
    expect(Math.max(...progress)).toBeLessThanOrEqual(1);
  });

  it('rejects an empty list and invalid pages', async () => {
    await expect(merge({ files: [] })).rejects.toBeInstanceOf(PdfError);
    const a = await makePdf(2);
    await expect(merge({ files: [{ bytes: a, name: 'a', pages: [5] }] })).rejects.toThrow(/Page 6 does not exist/);
  });

  it('turns garbage into a friendly corrupt-file error', async () => {
    const junk = new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf');
    await expect(merge({ files: [{ bytes: junk, name: 'junk.pdf' }] })).rejects.toBeInstanceOf(PdfError);
  });
});

describe('split / select', () => {
  it('creates one document per group', async () => {
    const src = await makePdf(5);
    const parts = await split({ bytes: src, groups: [[0, 1], [2], [3, 4]] });
    expect(parts).toHaveLength(3);
    expect(await pageIds(parts[0])).toEqual([0, 1]);
    expect(await pageIds(parts[1])).toEqual([2]);
    expect(await pageIds(parts[2])).toEqual([3, 4]);
  });

  it('extracts pages in the requested order (reverse/odd/even use this)', async () => {
    const src = await makePdf(4);
    expect(await pageIds(await selectPages({ bytes: src, pages: [3, 2, 1, 0] }))).toEqual([3, 2, 1, 0]);
    expect(await pageIds(await selectPages({ bytes: src, pages: [0, 2] }))).toEqual([0, 2]);
  });

  it('refuses to produce an empty document', async () => {
    const src = await makePdf(2);
    await expect(selectPages({ bytes: src, pages: [] })).rejects.toThrow(/no pages/);
  });
});

describe('organize', () => {
  it('reorders, rotates, duplicates, inserts blanks and pages from another file', async () => {
    const main = await makePdf(3);
    const other = await makePdf(1, { sizes: [[250, 300]] });
    const out = await organize({
      sources: [main, other],
      items: [
        { kind: 'page', source: 0, index: 2, rotate: 90 },
        { kind: 'blank', width: 200 + 99, height: 300 },
        { kind: 'page', source: 0, index: 0, rotate: 0 },
        { kind: 'page', source: 0, index: 0, rotate: 180 },
        { kind: 'page', source: 1, index: 0, rotate: 0 },
      ],
    });
    expect(await pageIds(out)).toEqual([2, 99, 0, 0, 50]);
    const doc = await load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 0, 180, 0]);
  });

  it('adds rotation to existing page rotation', async () => {
    const main = await makePdf(1, { rotate: { 0: 270 } });
    const out = await organize({ sources: [main], items: [{ kind: 'page', source: 0, index: 0, rotate: 180 }] });
    expect((await load(out)).getPage(0).getRotation().angle).toBe(90);
  });
});

describe('rotate', () => {
  it('rotates only the selected pages', async () => {
    const src = await makePdf(3, { rotate: { 1: 90 } });
    const out = await rotate({ bytes: src, pages: [1, 2], angle: 270 });
    const doc = await load(out);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 0, 270]);
  });
});

describe('crop', () => {
  it('sets the crop box from visual margins', async () => {
    const src = await makePdf(1, { sizes: [[300, 400]] });
    const out = await crop({ bytes: src, pages: [0], margins: { top: 10, right: 20, bottom: 30, left: 40 } });
    const box = (await load(out)).getPage(0).getCropBox();
    expect(box).toEqual({ x: 40, y: 30, width: 240, height: 360 });
  });

  it('maps margins through page rotation and can set the media box', async () => {
    const src = await makePdf(1, { sizes: [[300, 400]], rotate: { 0: 90 } });
    // Displayed page is 400 wide × 300 tall; a visual top margin becomes the user-space left margin.
    const out = await crop({ bytes: src, pages: [0], margins: { top: 10, right: 0, bottom: 0, left: 0 }, setMediaBox: true });
    const page = (await load(out)).getPage(0);
    expect(page.getCropBox()).toEqual({ x: 10, y: 0, width: 290, height: 400 });
    expect(page.getMediaBox()).toEqual({ x: 10, y: 0, width: 290, height: 400 });
  });

  it('rejects margins larger than the page', async () => {
    const src = await makePdf(1);
    await expect(crop({ bytes: src, pages: [0], margins: { top: 200, right: 0, bottom: 200, left: 0 } })).rejects.toThrow(
      /larger than page 1/,
    );
  });
});

describe('page numbers', () => {
  it('formats placeholders', () => {
    expect(formatPageNumber('{n}', 3, 9)).toBe('3');
    expect(formatPageNumber('Page {n} of {total}', 3, 9)).toBe('Page 3 of 9');
    expect(formatPageNumber('{N}/{TOTAL}', 1, 2)).toBe('1/2');
  });

  it('zero-pads {n:width} and {total:width} for Bates numbering', () => {
    expect(formatPageNumber('ABC{n:6}', 42, 900)).toBe('ABC000042');
    expect(formatPageNumber('{n:3} of {total:3}', 7, 120)).toBe('007 of 120');
    expect(formatPageNumber('{N:4}', 12345, 12345)).toBe('12345'); // wider than the pad: unchanged
    expect(formatPageNumber('{n:25}', 1, 1)).toBe('1'.padStart(20, '0')); // widths are capped at 20
    expect(formatPageNumber('{n:99}', 1, 1)).toBe('1'.padStart(20, '0'));
  });

  it('recognizes the page token in plain and padded forms', () => {
    expect(hasPageToken('Page {n}')).toBe(true);
    expect(hasPageToken('DOC-{n:8}')).toBe(true);
    expect(hasPageToken('{total} pages')).toBe(false);
    expect(hasPageToken('{n:}')).toBe(false);
  });

  it('numbers the selected pages starting at the start number', async () => {
    const src = await makePdf(3);
    const out = await addPageNumbers({
      bytes: src,
      pages: [1, 2],
      position: 'bottom-center',
      format: 'Page {n} of {total}',
      fontSize: 10,
      margin: 20,
      startNumber: 5,
      color: [0, 0, 0],
    });
    const doc = await load(out);
    expect(doc.getPageCount()).toBe(3);
    const first = await contentText(out, 0);
    const second = await contentText(out, 1);
    const third = await contentText(out, 2);
    const hex = (s: string) =>
      Array.from(s)
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    expect(first.toUpperCase()).not.toContain(hex(' of '));
    expect(second.toUpperCase()).toContain(hex('Page 5 of 6'));
    expect(third.toUpperCase()).toContain(hex('Page 6 of 6'));
    // Existing content is wrapped in q/Q before drawing.
    expect(second).toMatch(/^q\b/m);
  });

  it('explains characters the standard font cannot draw', async () => {
    const src = await makePdf(1);
    await expect(
      addPageNumbers({
        bytes: src,
        pages: [0],
        position: 'top-left',
        format: '页 {n}',
        fontSize: 10,
        margin: 20,
        startNumber: 1,
        color: [0, 0, 0],
      }),
    ).rejects.toThrow(/cannot draw/);
  });
});

describe('watermark', () => {
  it('draws tiled text with opacity on selected pages', async () => {
    const src = await makePdf(2);
    const out = await addWatermark({
      bytes: src,
      pages: [0],
      mark: { kind: 'text', text: 'DRAFT', fontSize: 40, color: [1, 0, 0], bold: true },
      opacity: 0.3,
      angle: 45,
      position: 'center',
      tile: true,
      margin: 20,
    });
    const doc = await load(out);
    expect(doc.getPageCount()).toBe(2);
    const text = await contentText(out, 0);
    expect(text.match(/Tj/g)!.length).toBeGreaterThan(1);
    expect(text).toMatch(/\/GS-?\d*|gs/);
    const untouched = await contentText(out, 1);
    expect(untouched).not.toMatch(/gs/);
  });

  it('embeds an image watermark', async () => {
    const src = await makePdf(1);
    const out = await addWatermark({
      bytes: src,
      pages: [0],
      mark: { kind: 'image', bytes: PNG_1PX, format: 'png', scale: 0.5 },
      opacity: 0.5,
      angle: 0,
      position: 'bottom-right',
      tile: false,
      margin: 10,
    });
    expect(await contentText(out, 0)).toMatch(/Do/);
  });

  it('rejects empty text and bad images', async () => {
    const src = await makePdf(1);
    const base = { bytes: src, pages: [0], opacity: 1, angle: 0, position: 'center' as const, tile: false, margin: 0 };
    await expect(addWatermark({ ...base, mark: { kind: 'text', text: ' ', fontSize: 10, color: [0, 0, 0], bold: false } })).rejects.toThrow(
      /Enter the watermark text/,
    );
    await expect(
      addWatermark({ ...base, mark: { kind: 'image', bytes: new Uint8Array([1, 2, 3]), format: 'png', scale: 0.5 } }),
    ).rejects.toThrow(/could not be read/);
  });
});

describe('metadata op', () => {
  it('writes and removes metadata', async () => {
    const src = await makePdf(1, { title: 'Old' });
    const written = await setMetadata({
      bytes: src,
      fields: { ...EMPTY_METADATA, title: 'Nouveau titre — ünïcødé', author: 'Ada', keywords: 'a, b' },
      removeAll: false,
      removeXmp: false,
    });
    const meta = readMetadata(await load(written));
    expect(meta.fields.title).toBe('Nouveau titre — ünïcødé');
    expect(meta.fields.author).toBe('Ada');
    expect(meta.fields.keywords).toBe('a, b');
    expect(meta.fields.producer).toBe('');

    const removed = await setMetadata({ bytes: written, fields: EMPTY_METADATA, removeAll: true, removeXmp: true });
    const after = readMetadata(await load(removed));
    expect(after.fields).toEqual(EMPTY_METADATA);
    expect(after.custom).toEqual([]);
  });
});

describe('compressLossless', () => {
  it('removes unreachable objects and deflates raw streams without changing pages', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const font = await doc.embedFont(StandardFonts.Courier);
    page.drawText('hello '.repeat(200), { x: 10, y: 10, size: 6, font });
    // An orphan object that nothing references.
    doc.context.register(doc.context.flateStream('orphan '.repeat(1000)));
    // An uncompressed stream referenced from the catalog.
    const raw = doc.context.stream('x'.repeat(5000));
    doc.catalog.set(PDFName.of('Extra'), doc.context.register(raw));
    const bytes = await doc.save({ useObjectStreams: false });

    const { bytes: out, stats } = await compressLossless({ bytes });
    expect(stats.removedObjects).toBeGreaterThanOrEqual(1);
    expect(stats.compressedStreams).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThan(bytes.length);
    const loaded = await load(out);
    expect(loaded.getPageCount()).toBe(1);
  });
});

describe('images to PDF', () => {
  it('computes placements for fit, A4 and orientation', () => {
    expect(imagePlacement({ width: 96, height: 192 }, { pageSize: 'fit', orientation: 'auto', margin: 0 })).toMatchObject({
      pageWidth: 72,
      pageHeight: 144,
    });
    const a4 = imagePlacement({ width: 2000, height: 1000 }, { pageSize: 'a4', orientation: 'auto', margin: 36 });
    expect(a4.pageWidth).toBeGreaterThan(a4.pageHeight); // auto → landscape for wide images
    expect(a4.width).toBeCloseTo(a4.pageWidth - 72, 3);
    const portrait = imagePlacement({ width: 2000, height: 1000 }, { pageSize: 'letter', orientation: 'portrait', margin: 0 });
    expect(portrait).toMatchObject({ pageWidth: 612, pageHeight: 792 });
    expect(portrait.y).toBeGreaterThan(0);
  });

  it('builds one page per image', async () => {
    const out = await imagesToPdf({
      images: [
        { bytes: PNG_1PX, format: 'png', width: 1, height: 1 },
        { bytes: PNG_1PX, format: 'png', width: 1, height: 1, pageWidth: 100, pageHeight: 50 },
      ],
      layout: { pageSize: 'a4', orientation: 'portrait', margin: 10 },
    });
    const doc = await load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(Math.round(doc.getPage(1).getWidth())).toBe(100);
  });

  it('rejects broken image bytes', async () => {
    await expect(
      imagesToPdf({ images: [{ bytes: new Uint8Array(10), format: 'jpg', width: 1, height: 1 }], layout: { pageSize: 'fit', orientation: 'auto', margin: 0 } }),
    ).rejects.toThrow(/could not be embedded/);
  });
});

describe('addTextLayer', () => {
  it('adds invisible text that replaces unsupported characters', async () => {
    const src = await makePdf(1, { sizes: [[200, 100]] });
    const out = await addTextLayer({
      bytes: src,
      pages: [
        {
          index: 0,
          imageWidth: 400,
          imageHeight: 200,
          lines: [
            [
              { text: 'Hello', x0: 10, y0: 10, x1: 60, y1: 30 },
              { text: 'wörld✓', x0: 70, y0: 10, x1: 140, y1: 30 },
            ],
          ],
        },
      ],
    });
    const text = await contentText(out, 0);
    expect(text).toMatch(/3 Tr/);
    expect(text.match(/Tj/g)!.length).toBeGreaterThanOrEqual(3); // original + 2 words
  });
});

describe('inspectStructure', () => {
  it('lists fonts with embedding info', async () => {
    const src = await makePdf(2);
    const info = await inspectStructure({ bytes: src });
    expect(info.fonts).toHaveLength(1);
    expect(info.fonts[0]).toMatchObject({ name: 'Helvetica', type: 'Type1', embedded: false, pages: [1, 2] });
    expect(info.encrypted).toBe(false);
    expect(info.hasAcroForm).toBe(false);
    expect(info.objectCount).toBeGreaterThan(3);
  });
});

/** Every object in the file — reachable or not — as text, with streams decoded. */
async function everyObjectText(bytes: Uint8Array): Promise<string> {
  const { decodePDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const parts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      parts.push(obj.dict.toString());
      try {
        parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()));
      } catch {
        parts.push(new TextDecoder('latin1').decode(obj.contents));
      }
    } else {
      parts.push(obj.toString());
    }
  }
  return parts.join('\n');
}

describe('metadata privacy', () => {
  async function withLeftovers(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle('Current title');
    doc.setAuthor('Current Author');
    const xmp = doc.context.stream('<x:xmpmeta><dc:creator>XMP Secret Author</dc:creator></x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    // An older Info dictionary left behind by an incremental save: nothing refers to it any more.
    doc.context.register(doc.context.obj({ Author: PDFString.of('Orphan Old Author') }));
    return doc.save({ useObjectStreams: false });
  }

  it('does not keep the removed XMP packet or orphaned Info dictionaries in the saved file', async () => {
    const src = await withLeftovers();
    expect(await everyObjectText(src)).toMatch(/XMP Secret Author[\s\S]*Orphan Old Author|Orphan Old Author[\s\S]*XMP Secret Author/);
    const out = await setMetadata({ bytes: src, fields: { ...EMPTY_METADATA, title: 'New title' }, removeAll: false, removeXmp: true });
    const text = await everyObjectText(out);
    expect(text).not.toContain('XMP Secret Author');
    expect(text).not.toContain('Orphan Old Author');
    expect(readMetadata(await load(out)).fields.title).toBe('New title');
  });

  it('"remove all" leaves none of the old values anywhere in the file', async () => {
    const out = await setMetadata({ bytes: await withLeftovers(), fields: EMPTY_METADATA, removeAll: true, removeXmp: true });
    const text = await everyObjectText(out);
    for (const old of ['Current title', 'Current Author', 'XMP Secret Author', 'Orphan Old Author']) expect(text).not.toContain(old);
    expect((await load(out)).getPageCount()).toBe(1);
  });
});

describe('encrypted input', () => {
  it('saves edits of an encrypted file without object streams, keeping /Encrypt, /ID and the encrypted content', async () => {
    const enc = await encryptRc4(await makePdf(2), '', 'owner');
    const before = await PDFDocument.load(enc, { ignoreEncryption: true, updateMetadata: false });
    const out = await rotate({ bytes: enc, pages: [0], angle: 90, ignoreEncryption: true });
    const text = new TextDecoder('latin1').decode(out);
    // Objects packed into a new (unencrypted) object stream would be "decrypted" into garbage by readers.
    expect(text).not.toContain('/ObjStm');
    const after = await PDFDocument.load(out, { ignoreEncryption: true, updateMetadata: false });
    expect(after.getPage(0).getRotation().angle).toBe(90);
    expect(after.context.trailerInfo.Encrypt?.toString()).toBe(before.context.trailerInfo.Encrypt?.toString());
    expect(after.context.trailerInfo.ID?.toString()).toBe(before.context.trailerInfo.ID?.toString());
    // Same object number, same encrypted bytes: the page content still decrypts with the original key.
    const contents = (d: PDFDocument) => d.getPage(0).node.get(PDFName.of('Contents'))!.toString();
    expect(contents(after)).toBe(contents(before));
  });

  it('keeps the protection when compressing or stripping metadata', async () => {
    const enc = await encryptRc4(await makePdf(1, { title: 'Secret' }), 'user', 'owner', -4);
    const { bytes } = await compressLossless({ bytes: enc, ignoreEncryption: true });
    expect(new TextDecoder('latin1').decode(bytes)).toMatch(/\/Encrypt \d+ 0 R/);
    const stripped = await setMetadata({ bytes: enc, fields: EMPTY_METADATA, removeAll: true, removeXmp: true, ignoreEncryption: true });
    const text = new TextDecoder('latin1').decode(stripped);
    expect(text).toMatch(/\/Encrypt \d+ 0 R/);
    expect(text).not.toContain('/ObjStm');
  });

  it('explains an encrypted file pdf-lib cannot parse instead of calling it damaged', async () => {
    const text = '%PDF-1.7\n1 0 obj << /Length 5 >>\nstream\n\x01\x02garbage\ntrailer << /Root 9 0 R /Encrypt 7 0 R >>\n%%EOF';
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const error = await rotate({ bytes, pages: [0], angle: 90, ignoreEncryption: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).kind).toBe('encrypted');
    expect((error as PdfError).message).toMatch(/encrypted/);
  });
});
