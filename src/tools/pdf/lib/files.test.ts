import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import {
  ensureExtension,
  jpegOrientation,
  outputName,
  padIndex,
  sanitizeFileName,
  sniffImage,
  uniqueNames,
  zipFiles,
} from './files';

function jpegWithOrientation(orientation: number, littleEndian = false): Uint8Array {
  const tiff: number[] = littleEndian
    ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0, 0, 0, 0];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = exif.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, 0xff, 0xd9]);
}

describe('file names', () => {
  it('sanitizes names', () => {
    expect(sanitizeFileName('a/b:c*?.pdf')).toBe('a-b-c-.pdf');
    expect(sanitizeFileName('   ')).toBe('document');
    expect(sanitizeFileName('...hidden')).toBe('hidden');
    expect(sanitizeFileName('Résumé 🎉')).toBe('Résumé 🎉');
    expect(sanitizeFileName('x'.repeat(500))).toHaveLength(180);
  });

  it('builds output names', () => {
    expect(outputName('report.pdf', 'merged')).toBe('report-merged.pdf');
    expect(outputName('scan.final.PDF', 'page-01', 'png')).toBe('scan.final-page-01.png');
    expect(outputName('', 'x')).toBe('document-x.pdf');
    expect(outputName('noext', '')).toBe('noext.pdf');
  });

  it('ensures extensions', () => {
    expect(ensureExtension('merged', 'pdf')).toBe('merged.pdf');
    expect(ensureExtension('merged.PDF', 'pdf')).toBe('merged.PDF');
    expect(ensureExtension('  ', 'pdf')).toBe('document.pdf');
  });

  it('pads indices by total', () => {
    expect(padIndex(3, 9)).toBe('3');
    expect(padIndex(3, 120)).toBe('003');
  });

  it('deduplicates names case-insensitively', () => {
    expect(uniqueNames(['a.pdf', 'A.pdf', 'a.pdf', 'b'])).toEqual(['a.pdf', 'A (2).pdf', 'a (3).pdf', 'b']);
  });
});

describe('zipFiles', () => {
  it('creates a readable archive with unique names', async () => {
    const blob = await zipFiles([
      { name: 'one.pdf', data: new Uint8Array([1, 2, 3]), type: 'application/pdf' },
      { name: 'one.pdf', data: new Blob([new Uint8Array([4])]), type: 'application/pdf' },
    ]);
    expect(blob.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['one (2).pdf', 'one.pdf']);
    expect(Array.from(files['one.pdf'])).toEqual([1, 2, 3]);
  });
});

describe('image sniffing', () => {
  it('recognizes common formats', () => {
    const pad = (arr: number[]) => Uint8Array.from([...arr, ...new Array(16).fill(0)]);
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(sniffImage(pad([0xff, 0xd8, 0xff]))).toBe('jpg');
    expect(sniffImage(pad([0x47, 0x49, 0x46, 0x38]))).toBe('gif');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImage(new TextEncoder().encode('\0\0\0\u001cftypavif\0\0'))).toBe('avif');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg');
    expect(sniffImage(new Uint8Array(4))).toBe('unknown');
  });
});

describe('jpegOrientation', () => {
  it('reads big- and little-endian EXIF orientation', () => {
    expect(jpegOrientation(jpegWithOrientation(6))).toBe(6);
    expect(jpegOrientation(jpegWithOrientation(3, true))).toBe(3);
  });
  it('defaults to 1 for missing or invalid data', () => {
    expect(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
    expect(jpegOrientation(Uint8Array.from([0x89, 0x50]))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(42))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(6).slice(0, 20))).toBe(1);
  });
});
