import { t } from '@/lib/i18n';
/**
 * Image format sniffing and header parsing from raw bytes (no decoding).
 * Pure functions: safe to use in workers and unit tests.
 */

export type ImageFormat =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'ico'
  | 'avif'
  | 'heic'
  | 'tiff'
  | 'svg'
  | 'jxl'
  | 'psd';

export interface ImageHeader {
  format: ImageFormat;
  mime: string;
  width?: number;
  height?: number;
  /** Bits per channel (PNG/JPEG/BMP bits per pixel is reported as `bitsPerPixel`). */
  bitDepth?: number;
  bitsPerPixel?: number;
  channels?: number;
  hasAlpha?: boolean;
  animated?: boolean;
  frameCount?: number;
  hasIcc?: boolean;
  hasExif?: boolean;
  hasXmp?: boolean;
  colorType?: string;
  progressive?: boolean;
  /** Human readable sub-format, e.g. "WebP lossless (VP8L)". */
  detail?: string;
}

export const FORMAT_INFO: Record<ImageFormat, { mime: string; label: string; ext: string }> = {
  png: { mime: 'image/png', label: 'PNG', ext: 'png' },
  jpeg: { mime: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  gif: { mime: 'image/gif', label: 'GIF', ext: 'gif' },
  webp: { mime: 'image/webp', label: t('WebP'), ext: 'webp' },
  bmp: { mime: 'image/bmp', label: 'BMP', ext: 'bmp' },
  ico: { mime: 'image/x-icon', label: 'ICO', ext: 'ico' },
  avif: { mime: 'image/avif', label: 'AVIF', ext: 'avif' },
  heic: { mime: 'image/heic', label: 'HEIC/HEIF', ext: 'heic' },
  tiff: { mime: 'image/tiff', label: 'TIFF', ext: 'tiff' },
  svg: { mime: 'image/svg+xml', label: 'SVG', ext: 'svg' },
  jxl: { mime: 'image/jxl', label: 'JPEG XL', ext: 'jxl' },
  psd: { mime: 'image/vnd.adobe.photoshop', label: t('Photoshop PSD'), ext: 'psd' },
};

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}

/** Identify an image format from its first bytes. Returns null when unknown. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  const b = bytes;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 2) === 'BM' && b.length >= 26) return 'bmp';
  if (startsWith(b, [0, 0, 1, 0]) && b.length >= 6 && u16le(b, 4) > 0) return 'ico';
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (startsWith(b, [0xff, 0x0a]) || startsWith(b, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return 'jxl';
  if (ascii(b, 0, 4) === '8BPS') return 'psd';
  if (ascii(b, 4, 4) === 'ftyp') {
    const size = Math.min(u32be(b, 0), b.length);
    const brands: string[] = [ascii(b, 8, 4)];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, 4));
    if (brands.some((x) => x === 'avif' || x === 'avis')) return 'avif';
    if (brands.some((x) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(x))) return 'heic';
    return null;
  }
  // SVG: text that contains an <svg root near the start.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(b.length, 4096)));
  const trimmed = head.replace(/^\uFEFF/, '').trimStart();
  if ((trimmed.startsWith('<') || trimmed.startsWith('<?xml')) && /<svg[\s>]/i.test(trimmed)) return 'svg';
  return null;
}

function parsePng(b: Uint8Array, h: ImageHeader) {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR') return;
  h.width = u32be(b, 16);
  h.height = u32be(b, 20);
  h.bitDepth = b[24];
  const ct = b[25];
  const types: Record<number, [string, number]> = {
    0: ['Grayscale', 1],
    2: ['RGB', 3],
    3: ['Indexed (palette)', 1],
    4: ['Grayscale + alpha', 2],
    6: ['RGBA', 4],
  };
  const t = types[ct];
  if (t) {
    h.colorType = t[0];
    h.channels = t[1];
  }
  h.hasAlpha = ct === 4 || ct === 6;
  h.progressive = b[28] === 1;
  // Walk chunks for tRNS, iCCP, eXIf, acTL.
  let o = 8;
  while (o + 8 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    if (type === 'tRNS') h.hasAlpha = true;
    else if (type === 'iCCP') h.hasIcc = true;
    else if (type === 'eXIf') h.hasExif = true;
    else if (type === 'iTXt' && ascii(b, o + 8, 17) === 'XML:com.adobe.xmp') h.hasXmp = true;
    else if (type === 'acTL' && o + 16 <= b.length) {
      h.frameCount = u32be(b, o + 8);
      h.animated = h.frameCount > 1;
    } else if (type === 'IDAT' || type === 'IEND') {
      if (type === 'IEND') break;
    }
    o += 12 + len;
  }
  h.detail = h.animated ? 'Animated PNG (APNG)' : undefined;
  if (h.animated === undefined) h.animated = false;
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parseJpeg(b: Uint8Array, h: ImageHeader) {
  let o = 2;
  h.hasAlpha = false;
  h.animated = false;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1];
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = u16be(b, o + 2);
    const segStart = o + 4;
    if (marker === 0xe1) {
      const id = ascii(b, segStart, 29);
      if (id.startsWith('Exif\0\0')) h.hasExif = true;
      else if (id.startsWith('http://ns.adobe.com/xap/1.0/')) h.hasXmp = true;
    } else if (marker === 0xe2 && ascii(b, segStart, 12) === 'ICC_PROFILE\0') {
      h.hasIcc = true;
    } else if (SOF_MARKERS.has(marker) && segStart + 6 <= b.length) {
      h.bitDepth = b[segStart];
      h.height = u16be(b, segStart + 1);
      h.width = u16be(b, segStart + 3);
      h.channels = b[segStart + 5];
      h.progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
      h.colorType = h.channels === 1 ? 'Grayscale' : h.channels === 3 ? 'YCbCr' : h.channels === 4 ? 'CMYK' : undefined;
      h.detail = h.progressive ? 'Progressive JPEG' : 'Baseline JPEG';
    }
    o += 2 + len;
  }
}

function parseGif(b: Uint8Array, h: ImageHeader) {
  h.width = u16le(b, 6);
  h.height = u16le(b, 8);
  h.bitDepth = 8;
  h.colorType = 'Indexed (palette)';
  h.hasAlpha = false;
  const packed = b[10];
  let o = 13;
  if (packed & 0x80) o += 3 * (1 << ((packed & 7) + 1));
  let frames = 0;
  while (o < b.length) {
    const block = b[o];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = b[o + 1];
      if (label === 0xf9 && o + 3 < b.length && b[o + 3] & 1) h.hasAlpha = true;
      if (label === 0xff && ascii(b, o + 3, 11) === 'XMP DataXMP') h.hasXmp = true;
      o += 2;
      while (o < b.length && b[o] !== 0) o += b[o] + 1;
      o++;
    } else if (block === 0x2c) {
      frames++;
      if (o + 10 > b.length) break;
      const p = b[o + 9];
      o += 10;
      if (p & 0x80) o += 3 * (1 << ((p & 7) + 1));
      o++; // LZW min code size
      while (o < b.length && b[o] !== 0) o += b[o] + 1;
      o++;
    } else break;
  }
  h.frameCount = frames || undefined;
  h.animated = frames > 1;
  if (h.animated) h.detail = `Animated GIF (${frames} frames)`;
}

function parseWebp(b: Uint8Array, h: ImageHeader) {
  const chunk = ascii(b, 12, 4);
  h.bitDepth = 8;
  h.animated = false;
  if (chunk === 'VP8 ' && b.length >= 30) {
    h.width = u16le(b, 26) & 0x3fff;
    h.height = u16le(b, 28) & 0x3fff;
    h.hasAlpha = false;
    h.detail = 'WebP lossy (VP8)';
  } else if (chunk === 'VP8L' && b.length >= 25) {
    const bits = u32le(b, 21);
    h.width = (bits & 0x3fff) + 1;
    h.height = ((bits >> 14) & 0x3fff) + 1;
    h.hasAlpha = Boolean((bits >> 28) & 1);
    h.detail = 'WebP lossless (VP8L)';
  } else if (chunk === 'VP8X' && b.length >= 30) {
    const flags = b[20];
    h.hasIcc = Boolean(flags & 0x20);
    h.hasAlpha = Boolean(flags & 0x10);
    h.hasExif = Boolean(flags & 0x08);
    h.hasXmp = Boolean(flags & 0x04);
    h.animated = Boolean(flags & 0x02);
    h.width = u24le(b, 24) + 1;
    h.height = u24le(b, 27) + 1;
    h.detail = h.animated ? 'Animated WebP' : 'WebP (extended)';
    if (h.animated) {
      let frames = 0;
      let o = 12;
      while (o + 8 <= b.length) {
        const id = ascii(b, o, 4);
        const size = u32le(b, o + 4);
        if (id === 'ANMF') frames++;
        o += 8 + size + (size & 1);
      }
      if (frames) h.frameCount = frames;
    }
  }
  h.channels = h.hasAlpha ? 4 : 3;
}

function parseBmp(b: Uint8Array, h: ImageHeader) {
  h.width = Math.abs(i32le(b, 18));
  h.height = Math.abs(i32le(b, 22));
  h.bitsPerPixel = u16le(b, 28);
  h.hasAlpha = h.bitsPerPixel === 32;
  h.animated = false;
}

function parseIco(b: Uint8Array, h: ImageHeader) {
  const count = u16le(b, 4);
  let best = 0;
  for (let i = 0; i < count && 6 + i * 16 + 16 <= b.length; i++) {
    const e = 6 + i * 16;
    const w = b[e] || 256;
    const hh = b[e + 1] || 256;
    if (w * hh > best) {
      best = w * hh;
      h.width = w;
      h.height = hh;
      h.bitsPerPixel = u16le(b, e + 6) || undefined;
    }
  }
  h.frameCount = count;
  h.detail = `${count} icon size${count === 1 ? '' : 's'}`;
  h.hasAlpha = true;
  h.animated = false;
}

function parseIsoBmff(b: Uint8Array, h: ImageHeader) {
  // Find the first 'ispe' (image spatial extents) property box.
  for (let i = 0; i + 20 <= b.length; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
      h.width = u32be(b, i + 8);
      h.height = u32be(b, i + 12);
      break;
    }
  }
  for (let i = 0; i + 12 <= b.length; i++) {
    // 'pixi' box: bits per channel
    if (b[i] === 0x70 && b[i + 1] === 0x69 && b[i + 2] === 0x78 && b[i + 3] === 0x69) {
      const n = b[i + 8];
      if (n > 0 && n <= 4) {
        h.channels = n;
        h.bitDepth = b[i + 9];
      }
      break;
    }
  }
  const text = ascii(b, 0, Math.min(b.length, 4096));
  h.hasIcc = text.includes('colr') ? true : undefined;
  h.hasExif = text.includes('Exif') ? true : undefined;
  if (ascii(b, 8, 4) === 'avis') {
    h.animated = true;
    h.detail = 'AVIF image sequence';
  }
}

function parseTiff(b: Uint8Array, h: ImageHeader) {
  const le = b[0] === 0x49;
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o));
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o));
  const ifd = r32(4);
  if (ifd + 2 > b.length) return;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = r16(e);
    const type = r16(e + 2);
    const val = type === 3 ? r16(e + 8) : r32(e + 8);
    if (tag === 256) h.width = val;
    else if (tag === 257) h.height = val;
    else if (tag === 258) h.bitDepth = type === 3 && r32(e + 4) === 1 ? val : h.bitDepth;
    else if (tag === 277) h.channels = val;
    else if (tag === 34675) h.hasIcc = true;
    else if (tag === 700) h.hasXmp = true;
  }
  if (h.channels === 4 || h.channels === 2) h.hasAlpha = true;
}

function parseSvg(b: Uint8Array, h: ImageHeader) {
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 8192)));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  h.hasAlpha = true;
  h.animated = false;
  if (!tag) return;
  const dims = svgDimensions(tag);
  if (dims) {
    h.width = dims.width;
    h.height = dims.height;
  }
}

/** Parse width/height (px) from an <svg> start tag, falling back to the viewBox. */
export function svgDimensions(svgTag: string): { width: number; height: number; fromViewBox: boolean } | null {
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(svgTag)?.[1];
  const toPx = (v?: string): number | null => {
    if (!v) return null;
    const m = /^\s*([\d.]+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(v);
    if (!m) return null; // percentages or em are not absolute
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'px').toLowerCase();
    const factor: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
    return n * factor[unit];
  };
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbW = vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 ? vb[2] : null;
  const vbH = vb && vb.length === 4 && vb.every(Number.isFinite) && vb[3] > 0 ? vb[3] : null;
  let w = toPx(attr('width'));
  let hh = toPx(attr('height'));
  if (w && hh) return { width: w, height: hh, fromViewBox: false };
  if (vbW && vbH) {
    if (w && !hh) hh = (w * vbH) / vbW;
    else if (hh && !w) w = (hh * vbW) / vbH;
    else {
      w = vbW;
      hh = vbH;
      return { width: w, height: hh, fromViewBox: true };
    }
    return { width: w!, height: hh!, fromViewBox: false };
  }
  return null;
}

/** Sniff and parse what the header reveals. Returns null for non-images. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  const format = sniffImageFormat(bytes);
  if (!format) return null;
  const h: ImageHeader = { format, mime: FORMAT_INFO[format].mime };
  try {
    if (format === 'png') parsePng(bytes, h);
    else if (format === 'jpeg') parseJpeg(bytes, h);
    else if (format === 'gif') parseGif(bytes, h);
    else if (format === 'webp') parseWebp(bytes, h);
    else if (format === 'bmp') parseBmp(bytes, h);
    else if (format === 'ico') parseIco(bytes, h);
    else if (format === 'avif' || format === 'heic') parseIsoBmff(bytes, h);
    else if (format === 'tiff') parseTiff(bytes, h);
    else if (format === 'svg') parseSvg(bytes, h);
  } catch {
    // Truncated headers: return what we have.
  }
  return h;
}

/** Formats that browsers can generally decode with createImageBitmap/<img>. */
export const DECODABLE: ReadonlySet<ImageFormat> = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']);
