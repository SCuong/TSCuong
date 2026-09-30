import { describe, expect, it } from 'vitest';
import { gifBlocks, gifMetadata, webpMetadata, wrapInJpeg } from './metaContainers';
import { stripGif, CorruptImageError } from './metadata';
import { gpsFromGroups, parseXmpCoordinate, readMetadata, summarizeMetadata } from './exif';
import { groupForDisplay, metadataToJson, xmpLabel } from './exifGroups';

const enc = new TextEncoder();
const concat = (...parts: Array<Uint8Array | number[]>) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u16be = (n: number) => [(n >> 8) & 255, n & 255];
const u32be = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/** Big-endian TIFF: IFD0 (Make, Orientation, GPS pointer) + GPS IFD (48°51'29.4"N 2°17'40"E). */
function tiffWithGps(): Uint8Array {
  // Layout: header(8) | IFD0 @8: 3 entries (2+36+4=42) → 50 | "Cam\0" is ≤4 bytes, inline | GPS IFD @50: 4 entries (2+48+4=54) → 104 | rationals @104
  const ifd0 = [
    ...u16be(3),
    ...u16be(0x010f), ...u16be(2), ...u32be(4), ...enc.encode('Cam\0'), // Make
    ...u16be(0x0112), ...u16be(3), ...u32be(1), ...u16be(6), 0, 0, // Orientation = 6
    ...u16be(0x8825), ...u16be(4), ...u32be(1), ...u32be(50), // GPS IFD pointer
    ...u32be(0),
  ];
  const gps = [
    ...u16be(4),
    ...u16be(1), ...u16be(2), ...u32be(2), ...enc.encode('N'), 0, 0, 0,
    ...u16be(2), ...u16be(5), ...u32be(3), ...u32be(104),
    ...u16be(3), ...u16be(2), ...u32be(2), ...enc.encode('E'), 0, 0, 0,
    ...u16be(4), ...u16be(5), ...u32be(3), ...u32be(128),
    ...u32be(0),
  ];
  const rationals = [
    ...u32be(48), ...u32be(1), ...u32be(51), ...u32be(1), ...u32be(294), ...u32be(10),
    ...u32be(2), ...u32be(1), ...u32be(17), ...u32be(1), ...u32be(40), ...u32be(1),
  ];
  return concat([0x4d, 0x4d, 0, 42, ...u32be(8)], ifd0, gps, rationals);
}

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="XmpCam"><dc:creator><rdf:Seq><rdf:li>Jane Private</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

function chunk(id: string, data: Uint8Array) {
  return concat(enc.encode(id), u32le(data.length), data, data.length & 1 ? [0] : []);
}

/** A WebP container with VP8X + a dummy VP8L + EXIF + XMP chunks. */
function webpWithMetadata(exifPrefix = false): Uint8Array {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x08 | 0x04;
  const body = concat(
    enc.encode('WEBP'),
    chunk('VP8X', vp8x),
    chunk('VP8L', new Uint8Array([0x2f, 0, 0, 0, 0])),
    chunk('EXIF', exifPrefix ? concat(enc.encode('Exif\0\0'), tiffWithGps()) : tiffWithGps()),
    chunk('XMP ', enc.encode(XMP)),
  );
  return concat(enc.encode('RIFF'), u32le(body.length), body);
}

/** A 2-frame GIF with a loop extension, a comment and an XMP application extension. */
function animatedGif(withMeta = true): Uint8Array {
  const header = concat(enc.encode('GIF89a'), [2, 0, 2, 0, 0x80, 0, 0], [255, 0, 0, 0, 0, 255]);
  const loop = concat([0x21, 0xff, 11], enc.encode('NETSCAPE2.0'), [3, 1, 0, 0, 0]);
  const frame = (color: number) =>
    concat([0x21, 0xf9, 4, 0, 10, 0, 0, 0], [0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0], [2, 2, color === 0 ? 0x44 : 0x4c, 0x01, 0]);
  const comment = concat([0x21, 0xfe, 13], enc.encode('secret street'), [0]);
  // XMP is stored raw, followed by the 258-byte "magic trailer" (0x01, 0xFF…0x00, 0x00).
  const trailer = [1, ...Array.from({ length: 256 }, (_, i) => 255 - i), 0];
  const xmp = concat([0x21, 0xff, 11], enc.encode('XMP DataXMP'), enc.encode(XMP), trailer);
  return concat(header, loop, ...(withMeta ? [comment, xmp] : []), frame(0), frame(1), [0x3b]);
}

describe('metadata containers', () => {
  it('extracts EXIF and XMP chunks from WebP (with or without the Exif prefix)', () => {
    for (const prefixed of [false, true]) {
      const m = webpMetadata(webpWithMetadata(prefixed));
      expect(m.tiff?.[0]).toBe(0x4d);
      expect(new TextDecoder().decode(m.xmp)).toContain('Jane Private');
    }
    expect(webpMetadata(new Uint8Array(20))).toEqual({});
  });

  it('walks GIF blocks and extracts raw XMP', () => {
    const gif = animatedGif();
    const blocks = gifBlocks(gif)!;
    expect(blocks.filter((b) => b.kind === 'image')).toHaveLength(2);
    expect(new TextDecoder().decode(gifMetadata(gif).xmp)).toBe(XMP);
    expect(gifBlocks(gif.subarray(0, gif.length - 5))).toBeNull();
  });

  it('wraps blocks in a JPEG shell', () => {
    const jpeg = wrapInJpeg({ tiff: tiffWithGps(), xmp: enc.encode(XMP) });
    expect([jpeg[0], jpeg[1], jpeg[2], jpeg[3]]).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect([jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]]).toEqual([0xff, 0xd9]);
  });
});

describe('stripGif', () => {
  it('removes comments and XMP but keeps every frame and the loop setting', () => {
    const gif = animatedGif();
    const r = stripGif(gif, { keepIcc: true, keepOrientation: true });
    expect(r.removed).toEqual(['Comment', 'XMP metadata']);
    expect(r.bytes).toEqual(animatedGif(false));
    expect(new TextDecoder().decode(r.bytes)).not.toContain('secret street');
    expect(gifBlocks(r.bytes)!.filter((b) => b.kind === 'image')).toHaveLength(2);
  });
  it('reports clean files and rejects broken ones', () => {
    expect(stripGif(animatedGif(false), { keepIcc: true, keepOrientation: true }).removed).toEqual([]);
    expect(() => stripGif(new Uint8Array([1, 2, 3]), { keepIcc: true, keepOrientation: true })).toThrow(CorruptImageError);
    const truncated = animatedGif().subarray(0, 40);
    expect(() => stripGif(truncated, { keepIcc: true, keepOrientation: true })).toThrow(/truncated/);
  });
});

describe('readMetadata', () => {
  it('reads EXIF, GPS and XMP from WebP (regression: WebP was reported as having no metadata)', async () => {
    const groups = await readMetadata(webpWithMetadata());
    expect(groups.ifd0?.Make).toBe('Cam');
    const s = summarizeMetadata(groups);
    expect(s.gps?.latitude).toBeCloseTo(48 + 51 / 60 + 29.4 / 3600, 6);
    expect(s.gps?.longitude).toBeCloseTo(2 + 17 / 60 + 40 / 3600, 6);
    expect(s.hasXmp).toBe(true);
    // XMP stays in its own group: tiff:Make from XMP does not overwrite the EXIF Make.
    expect(groups.xmp?.['tiff:Make']).toBe('XmpCam');
    expect(groups.xmp?.['dc:creator']).toBe('Jane Private');
  });

  it('reads XMP from GIF', async () => {
    const s = summarizeMetadata(await readMetadata(animatedGif()));
    expect(s.hasXmp).toBe(true);
  });

  it('returns nothing (not an "errors" group) for unreadable data', async () => {
    expect(await readMetadata(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toEqual({});
    expect(await readMetadata(new Uint8Array(0))).toEqual({});
  });
});

describe('metadata helpers', () => {
  it('parses XMP GPS coordinates', () => {
    expect(parseXmpCoordinate('48,51.49N')).toBeCloseTo(48 + 51.49 / 60, 8);
    expect(parseXmpCoordinate('2,17,40W')).toBeCloseTo(-(2 + 17 / 60 + 40 / 3600), 8);
    expect(parseXmpCoordinate('nope')).toBeNull();
    expect(gpsFromGroups({ xmp: { 'exif:GPSLatitude': '33,52.2S', 'exif:GPSLongitude': '151,12.6E' } })).toEqual({
      latitude: -(33 + 52.2 / 60),
      longitude: 151 + 12.6 / 60,
    });
  });

  it('counts real tags only and PNG text chunks', () => {
    const s = summarizeMetadata({
      gps: { GPSLatitude: [1, 2, 3], GPSLatitudeRef: 'N', latitude: 1.03, longitude: 2 },
      ihdr: { ImageWidth: 10, ImageHeight: 10, Author: 'Jane', Comment: 'x' },
    });
    expect(s.exifTags).toBe(2);
    expect(s.textTags).toBe(2);
    expect(s.total).toBe(4);
  });

  it('groups XMP under XMP with its prefix and PNG text separately', () => {
    const groups = groupForDisplay({ xmp: { 'dc:creator': 'Jane', 'xmp:CreatorTool': 'Tool' }, ihdr: { ImageWidth: 1, Author: 'Jane' } });
    const byId = Object.fromEntries(groups.map((g) => [g.id, g.rows]));
    expect(byId.xmp.map((r) => r.label)).toEqual(['Creator (dc)', 'Creator tool (xmp)']);
    expect(byId.text.map((r) => `${r.label}: ${r.value}`)).toEqual(['Author: Jane']);
    expect(byId.image.map((r) => r.label)).toEqual(['Image width']);
    expect(xmpLabel('exif:GPSLatitude')).toBe('GPS latitude (exif)');
  });

  it('exports EXIF dates as the wall-clock time written in the file (regression: shifted to UTC)', () => {
    const json = JSON.parse(metadataToJson({ exif: { DateTimeOriginal: new Date(2024, 4, 6, 7, 8, 9) } }));
    expect(json.exif.DateTimeOriginal).toBe('2024-05-06 07:08:09');
  });
});
