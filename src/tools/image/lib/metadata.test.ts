import { describe, expect, it } from 'vitest';
import { buildOrientationApp1, CorruptImageError, readJpegOrientation, stripJpeg, stripPng, stripWebp } from './metadata';

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]) => {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
};

function exifPayload(orientation: number) {
  // "Exif\0\0" + little-endian TIFF with Orientation + Make
  return [
    ...enc('Exif\0\0'),
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x02, 0x00,
    0x0f, 0x01, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43, 0x00, // Make "ABC"
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
}

const SOS_AND_DATA = [
  ...seg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, // entropy data with stuffing + restart marker
  0xff, 0xd9,
];

function makeJpeg({ orientation = 6, icc = true, trailing = false } = {}) {
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, [...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, exifPayload(orientation)),
    ...seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')),
    ...(icc ? seg(0xe2, [...enc('ICC_PROFILE\0'), 1, 1, 9, 9, 9]) : []),
    ...seg(0xed, enc('Photoshop 3.0\x008BIM')),
    ...seg(0xee, enc('Adobe\0\0\0\0\0\0\0')),
    ...seg(0xfe, enc('a comment')),
    ...seg(0xdb, [0x00, ...new Array(64).fill(1)]),
    ...seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    ...seg(0xc4, [0x00, ...new Array(16).fill(0)]),
    ...SOS_AND_DATA,
    ...(trailing ? [1, 2, 3, 4] : []),
  ]);
}

const has = (b: Uint8Array, s: string) => new TextDecoder('latin1').decode(b).includes(s);

describe('stripJpeg', () => {
  it('removes EXIF, XMP, IPTC and comments but keeps image data, APP0 and Adobe APP14', () => {
    const src = makeJpeg({ orientation: 1 });
    const { bytes, removed } = stripJpeg(src, { keepIcc: true, keepOrientation: true });
    expect(has(bytes, 'Exif')).toBe(false);
    expect(has(bytes, 'ns.adobe.com')).toBe(false);
    expect(has(bytes, 'Photoshop')).toBe(false);
    expect(has(bytes, 'a comment')).toBe(false);
    expect(has(bytes, 'JFIF')).toBe(true);
    expect(has(bytes, 'Adobe')).toBe(true);
    expect(has(bytes, 'ICC_PROFILE')).toBe(true);
    expect(removed.join('|')).toMatch(/EXIF/);
    expect(removed.join('|')).toMatch(/XMP/);
    expect(removed.join('|')).toMatch(/IPTC/);
    // Entropy-coded data copied verbatim, ends with EOI.
    const tail = Array.from(bytes.slice(-9));
    expect(tail).toEqual([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);
  });

  it('drops the ICC profile when not kept', () => {
    const { bytes, removed } = stripJpeg(makeJpeg(), { keepIcc: false, keepOrientation: false });
    expect(has(bytes, 'ICC_PROFILE')).toBe(false);
    expect(removed).toContain('ICC color profile');
  });

  it('re-inserts a minimal orientation EXIF after APP0', () => {
    const src = makeJpeg({ orientation: 6 });
    expect(readJpegOrientation(src)).toBe(6);
    const { bytes, kept } = stripJpeg(src, { keepIcc: false, keepOrientation: true });
    expect(readJpegOrientation(bytes)).toBe(6);
    expect(kept).toContain('Orientation (6)');
    expect(has(bytes, 'ABC')).toBe(false); // Make removed
    // APP0 stays first
    expect(bytes[2]).toBe(0xff);
    expect(bytes[3]).toBe(0xe0);
  });

  it('does not add an orientation block for orientation 1 or when disabled', () => {
    expect(readJpegOrientation(stripJpeg(makeJpeg({ orientation: 1 }), { keepIcc: false, keepOrientation: true }).bytes)).toBeNull();
    expect(readJpegOrientation(stripJpeg(makeJpeg({ orientation: 8 }), { keepIcc: false, keepOrientation: false }).bytes)).toBeNull();
  });

  it('removes trailing data after EOI', () => {
    const { bytes, removed } = stripJpeg(makeJpeg({ trailing: true }), { keepIcc: true, keepOrientation: false });
    expect(Array.from(bytes.slice(-2))).toEqual([0xff, 0xd9]);
    expect(removed.some((r) => r.startsWith('Trailing data'))).toBe(true);
  });

  it('drops a JFXX thumbnail segment but keeps the JFIF header', () => {
    const base = makeJpeg({ orientation: 1 });
    const jfxx = seg(0xe0, [...enc('JFXX\0'), 0x13, 1, 1, 0xff, 0x00, 0x00]);
    // Insert the JFXX segment right after the JFIF APP0.
    const jfifEnd = 2 + 4 + 14;
    const withThumb = new Uint8Array([...base.slice(0, jfifEnd), ...jfxx, ...base.slice(jfifEnd)]);
    const { bytes, removed } = stripJpeg(withThumb, { keepIcc: true, keepOrientation: true });
    expect(removed).toContain('JFIF thumbnail (JFXX)');
    expect(new TextDecoder().decode(bytes)).toContain('JFIF');
    expect(new TextDecoder().decode(bytes)).not.toContain('JFXX');
  });

  it('is idempotent', () => {
    const once = stripJpeg(makeJpeg(), { keepIcc: true, keepOrientation: true }).bytes;
    const twice = stripJpeg(once, { keepIcc: true, keepOrientation: true });
    expect(Array.from(twice.bytes)).toEqual(Array.from(once));
    expect(twice.removed).toEqual([]);
  });

  it('rejects non-JPEG and truncated input', () => {
    expect(() => stripJpeg(new Uint8Array([1, 2, 3, 4]), { keepIcc: true, keepOrientation: true })).toThrow(CorruptImageError);
    expect(() => stripJpeg(new Uint8Array(0), { keepIcc: true, keepOrientation: true })).toThrow(CorruptImageError);
    const full = makeJpeg();
    expect(() => stripJpeg(full.slice(0, full.length - 2), { keepIcc: true, keepOrientation: true })).toThrow(/truncated/);
    expect(() => stripJpeg(full.slice(0, 30), { keepIcc: true, keepOrientation: true })).toThrow(/truncated|corrupt/);
  });

  it('builds a valid orientation APP1', () => {
    const app1 = buildOrientationApp1(3);
    const jpeg = new Uint8Array([0xff, 0xd8, ...app1, ...SOS_AND_DATA]);
    expect(readJpegOrientation(jpeg)).toBe(3);
  });
});

function chunk(type: string, data: number[]) {
  const len = data.length;
  return [(len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...enc(type), ...data, 0, 0, 0, 0];
}

function makePng(extra: number[] = []) {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk('iCCP', enc('sRGB\0\0xyz')),
    ...chunk('tEXt', enc('Author\0Jane 😀')),
    ...chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x/>')),
    ...chunk('eXIf', [0x4d, 0x4d, 0, 0x2a]),
    ...chunk('tIME', [7, 232, 1, 1, 0, 0, 0]),
    ...chunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1]),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
    ...extra,
  ]);
}

describe('stripPng', () => {
  it('removes text, XMP, EXIF and time chunks and keeps pixel/physical chunks', () => {
    const { bytes, removed, kept } = stripPng(makePng(), { keepIcc: true, keepOrientation: false });
    expect(has(bytes, 'tEXt')).toBe(false);
    expect(has(bytes, 'iTXt')).toBe(false);
    expect(has(bytes, 'eXIf')).toBe(false);
    expect(has(bytes, 'tIME')).toBe(false);
    for (const t of ['IHDR', 'iCCP', 'pHYs', 'IDAT', 'IEND']) expect(has(bytes, t)).toBe(true);
    expect(removed.length).toBe(4);
    expect(kept).toContain('ICC color profile');
  });

  it('can remove the ICC profile and trailing junk', () => {
    const { bytes, removed } = stripPng(makePng([9, 9, 9]), { keepIcc: false, keepOrientation: false });
    expect(has(bytes, 'iCCP')).toBe(false);
    expect(removed).toContain('ICC color profile');
    expect(removed.some((r) => r.startsWith('Trailing'))).toBe(true);
    expect(has(bytes.slice(-8), 'IEND')).toBe(true);
  });

  it('rejects invalid and truncated PNGs', () => {
    expect(() => stripPng(new Uint8Array([1, 2, 3]), { keepIcc: true, keepOrientation: false })).toThrow(CorruptImageError);
    const full = makePng();
    expect(() => stripPng(full.slice(0, full.length - 6), { keepIcc: true, keepOrientation: false })).toThrow(CorruptImageError);
  });
});

function riffChunk(id: string, data: number[]) {
  const n = data.length;
  return [...enc(id), n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, 0, ...data, ...(n & 1 ? [0] : [])];
}

function makeWebp() {
  const body = [
    ...riffChunk('VP8X', [0x2c, 0, 0, 0, 9, 0, 0, 9, 0, 0]), // ICC|EXIF|XMP flags
    ...riffChunk('ICCP', [1, 2, 3]),
    ...riffChunk('VP8L', [0x2f, 1, 2, 3, 4]),
    ...riffChunk('EXIF', enc('MM\0*')),
    ...riffChunk('XMP ', enc('<x/>')),
  ];
  const size = 4 + body.length;
  return new Uint8Array([...enc('RIFF'), size & 0xff, (size >> 8) & 0xff, 0, 0, ...enc('WEBP'), ...body]);
}

describe('stripWebp', () => {
  it('removes EXIF/XMP chunks, clears flags and fixes the RIFF size', () => {
    const { bytes, removed } = stripWebp(makeWebp(), { keepIcc: true, keepOrientation: false });
    expect(has(bytes, 'EXIF')).toBe(false);
    expect(has(bytes, 'XMP ')).toBe(false);
    expect(has(bytes, 'ICCP')).toBe(true);
    expect(removed).toEqual(['EXIF (camera, GPS, dates)', 'XMP metadata']);
    const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16);
    expect(riffSize).toBe(bytes.length - 8);
    expect(bytes[20] & 0x0c).toBe(0);
    expect(bytes[20] & 0x20).toBe(0x20);
  });

  it('removes ICC and its flag when requested', () => {
    const { bytes } = stripWebp(makeWebp(), { keepIcc: false, keepOrientation: false });
    expect(has(bytes, 'ICCP')).toBe(false);
    expect(bytes[20] & 0x20).toBe(0);
  });

  it('rejects non-WebP', () => {
    expect(() => stripWebp(new Uint8Array(30), { keepIcc: true, keepOrientation: false })).toThrow(CorruptImageError);
  });
});
