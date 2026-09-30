/**
 * Pull metadata blocks (EXIF/TIFF, XMP, ICC) out of containers that the EXIF
 * reader (exifr) does not understand — WebP and GIF — and re-wrap them in a
 * minimal JPEG so exifr can parse them. Pure functions.
 */

export interface MetadataBlocks {
  /** A TIFF structure ("II*\0" / "MM\0*"), as stored in EXIF blocks. */
  tiff?: Uint8Array;
  /** An XMP packet (UTF-8 XML). */
  xmp?: Uint8Array;
  /** An ICC color profile. */
  icc?: Uint8Array;
}

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function isWebp(b: Uint8Array): boolean {
  return b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP';
}

export function isGif(b: Uint8Array): boolean {
  const sig = ascii(b, 0, 6);
  return sig === 'GIF87a' || sig === 'GIF89a';
}

/** EXIF payloads are raw TIFF by spec, but some writers keep JPEG's "Exif\0\0" prefix. */
function stripExifPrefix(b: Uint8Array): Uint8Array {
  return ascii(b, 0, 6) === 'Exif\0\0' ? b.subarray(6) : b;
}

/** EXIF, XMP and ICC chunks of a WebP file. */
export function webpMetadata(b: Uint8Array): MetadataBlocks {
  const out: MetadataBlocks = {};
  if (!isWebp(b)) return out;
  const end = Math.min(b.length, 8 + u32le(b, 4));
  let o = 12;
  while (o + 8 <= end) {
    const id = ascii(b, o, 4);
    const size = u32le(b, o + 4);
    const data = b.subarray(o + 8, Math.min(o + 8 + size, b.length));
    if (id === 'EXIF' && !out.tiff) out.tiff = stripExifPrefix(data);
    else if (id === 'XMP ' && !out.xmp) out.xmp = data;
    else if (id === 'ICCP' && !out.icc) out.icc = data;
    o += 8 + size + (size & 1);
  }
  return out;
}

/** Skip GIF data sub-blocks starting at `o`; returns the offset after the terminator. */
function skipSubBlocks(b: Uint8Array, o: number): number {
  while (o < b.length && b[o] !== 0) o += b[o] + 1;
  return o + 1;
}

/** Offsets of GIF blocks: [start, end) for each extension or image, in file order. */
export function gifBlocks(b: Uint8Array): Array<{ kind: 'extension' | 'image'; label: number; start: number; end: number }> | null {
  if (!isGif(b) || b.length < 13) return null;
  let o = 13;
  const packed = b[10];
  if (packed & 0x80) o += 3 * (1 << ((packed & 7) + 1));
  const blocks: Array<{ kind: 'extension' | 'image'; label: number; start: number; end: number }> = [];
  while (o < b.length) {
    const start = o;
    const id = b[o];
    if (id === 0x3b) return blocks; // trailer
    if (id === 0x21) {
      const label = b[o + 1];
      const end = skipSubBlocks(b, o + 2);
      if (end > b.length) return null;
      blocks.push({ kind: 'extension', label, start, end });
      o = end;
    } else if (id === 0x2c) {
      if (o + 10 > b.length) return null;
      const p = b[o + 9];
      o += 10;
      if (p & 0x80) o += 3 * (1 << ((p & 7) + 1));
      o += 1; // LZW minimum code size
      const end = skipSubBlocks(b, o);
      if (end > b.length) return null;
      blocks.push({ kind: 'image', label: 0x2c, start, end });
      o = end;
    } else {
      return null;
    }
  }
  return null; // no trailer: truncated
}

/** The 11-byte identifier of a GIF application extension block. */
export function gifAppId(b: Uint8Array, start: number): string {
  return b[start + 2] === 11 ? ascii(b, start + 3, 11) : '';
}

/** The XMP packet of a GIF (stored raw in an "XMP DataXMP" application extension). */
export function gifMetadata(b: Uint8Array): MetadataBlocks {
  const blocks = gifBlocks(b);
  if (!blocks) return {};
  for (const blk of blocks) {
    if (blk.kind !== 'extension' || blk.label !== 0xff || gifAppId(b, blk.start) !== 'XMP DataXMP') continue;
    // The packet is written without sub-block framing and followed by a 258-byte "magic trailer".
    const raw = b.subarray(blk.start + 14, blk.end);
    const text = new TextDecoder().decode(raw);
    const endTag = /<\?xpacket end=["'][rw]["']\s*\?>/.exec(text);
    const xml = endTag ? text.slice(0, endTag.index + endTag[0].length) : text.slice(0, text.lastIndexOf('>') + 1);
    if (xml.includes('<')) return { xmp: new TextEncoder().encode(xml) };
  }
  return {};
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  const out = new Uint8Array(len + 2);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (len >> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const MAX_SEGMENT = 65533; // payload bytes that fit one JPEG APPn segment

/**
 * A metadata-only JPEG (SOI, APP1 EXIF, APP1 XMP, APP2 ICC, EOI) that exifr can
 * parse. Blocks too large for a single segment are left out (the TIFF can be
 * parsed on its own instead).
 */
export function wrapInJpeg(blocks: MetadataBlocks): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  if (blocks.tiff && blocks.tiff.length + 6 <= MAX_SEGMENT) parts.push(segment(0xe1, concat([enc.encode('Exif\0\0'), blocks.tiff])));
  const xmpId = enc.encode('http://ns.adobe.com/xap/1.0/\0');
  if (blocks.xmp && blocks.xmp.length + xmpId.length <= MAX_SEGMENT) parts.push(segment(0xe1, concat([xmpId, blocks.xmp])));
  if (blocks.icc) {
    const chunk = MAX_SEGMENT - 14;
    const count = Math.ceil(blocks.icc.length / chunk);
    if (count > 0 && count < 256) {
      for (let i = 0; i < count; i++) {
        const head = concat([enc.encode('ICC_PROFILE\0'), new Uint8Array([i + 1, count])]);
        parts.push(segment(0xe2, concat([head, blocks.icc.subarray(i * chunk, (i + 1) * chunk)])));
      }
    }
  }
  parts.push(new Uint8Array([0xff, 0xd9]));
  return concat(parts);
}

/** Metadata blocks for containers exifr cannot read directly, else null. */
export function foreignMetadata(b: Uint8Array): MetadataBlocks | null {
  if (isWebp(b)) return webpMetadata(b);
  if (isGif(b)) return gifMetadata(b);
  return null;
}
