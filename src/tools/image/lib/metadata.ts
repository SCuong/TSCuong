/**
 * Lossless metadata removal for JPEG, PNG and WebP by rewriting container
 * segments/chunks. Pixel data is copied byte-for-byte (no re-encoding).
 */

export interface StripOptions {
  /** Keep the embedded ICC color profile (recommended: colors stay accurate). */
  keepIcc: boolean;
  /** For JPEG: re-insert a minimal EXIF block holding only the orientation. */
  keepOrientation: boolean;
}

export interface StripResult {
  bytes: Uint8Array;
  /** Human-readable list of what was removed (may contain duplicates merged with counts). */
  removed: string[];
  kept: string[];
}

export class CorruptImageError extends Error {}

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function summarize(list: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const ORIENTATION_ONLY = 'EXIF orientation';

function isOrientationOnlyExif(b: Uint8Array, tiff: number): boolean {
  const le = b[tiff] === 0x49;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) =>
    le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ifd = tiff + u32(tiff + 4);
  return ifd + 18 <= b.length && u16(ifd) === 1 && u16(ifd + 2) === 0x0112 && u32(ifd + 14) === 0;
}

function app1Kind(b: Uint8Array, payload: number): string {
  if (ascii(b, payload, 6) === 'Exif\0\0') {
    return isOrientationOnlyExif(b, payload + 6) ? ORIENTATION_ONLY : 'EXIF (camera, GPS, dates, thumbnail)';
  }
  const id = ascii(b, payload, 40);
  if (id.startsWith('http://ns.adobe.com/xap/1.0/\0')) return 'XMP metadata';
  if (id.startsWith('http://ns.adobe.com/xmp/extension/')) return 'Extended XMP metadata';
  return 'APP1 segment';
}

/** Read the EXIF orientation (1–8) from a JPEG, or null. */
export function readJpegOrientation(b: Uint8Array): number | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const m = b[o + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (b[o + 2] << 8) | b[o + 3];
    if (m === 0xe1 && ascii(b, o + 4, 6) === 'Exif\0\0') {
      return readTiffOrientation(b, o + 10, o + 2 + len);
    }
    o += 2 + len;
  }
  return null;
}

function readTiffOrientation(b: Uint8Array, tiff: number, end: number): number | null {
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const be = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A minimal APP1 EXIF segment containing only the Orientation tag. */
export function buildOrientationApp1(orientation: number): Uint8Array {
  const payload = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload]);
}

export function stripJpeg(b: Uint8Array, opts: StripOptions): StripResult {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new CorruptImageError('This is not a valid JPEG file.');
  const orientation = opts.keepOrientation ? readJpegOrientation(b) : null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  const removed: string[] = [];
  const kept: string[] = [];
  let o = 2;
  let inScan = false;
  let ended = false;
  let insertAt = 1; // index in parts after which the orientation block goes

  const decide = (m: number, start: number, end: number) => {
    const payload = start + 4;
    let keep = true;
    let label = '';
    if (m === 0xe0) {
      keep = true;
    } else if (m === 0xe1) {
      keep = false;
      label = app1Kind(b, payload);
    } else if (m === 0xe2) {
      if (ascii(b, payload, 12) === 'ICC_PROFILE\0') {
        keep = opts.keepIcc;
        label = 'ICC color profile';
        if (keep) kept.push(label);
      } else {
        keep = false;
        label = ascii(b, payload, 4) === 'MPF\0' ? 'Multi-picture index (MPF)' : 'APP2 segment';
      }
    } else if (m === 0xed) {
      keep = false;
      label = 'IPTC / Photoshop metadata';
    } else if (m === 0xee) {
      keep = true; // Adobe APP14: needed for correct color transform
    } else if (m >= 0xe3 && m <= 0xef) {
      keep = false;
      label = `APP${m - 0xe0} segment`;
    } else if (m === 0xfe) {
      keep = false;
      label = 'Comment';
    }
    if (keep) {
      parts.push(b.subarray(start, end));
      if (m === 0xe0 && parts.length === 2) insertAt = 2;
    } else removed.push(label);
  };

  while (o < b.length && !ended) {
    if (inScan) {
      // Entropy-coded data: find the next real marker.
      const scanStart = o;
      while (o < b.length) {
        if (b[o] === 0xff) {
          const n = b[o + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) {
            o += n === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        o++;
      }
      parts.push(b.subarray(scanStart, o));
      inScan = false;
      if (o >= b.length) throw new CorruptImageError('The JPEG file is truncated (no end-of-image marker).');
      continue;
    }
    if (b[o] !== 0xff) throw new CorruptImageError('The JPEG file is corrupt (unexpected data between segments).');
    while (b[o + 1] === 0xff) o++; // fill bytes
    const m = b[o + 1];
    if (m === 0xd9) {
      parts.push(b.subarray(o, o + 2));
      o += 2;
      ended = true;
      break;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      parts.push(b.subarray(o, o + 2));
      o += 2;
      continue;
    }
    if (o + 4 > b.length) throw new CorruptImageError('The JPEG file is truncated.');
    const len = (b[o + 2] << 8) | b[o + 3];
    const end = o + 2 + len;
    if (len < 2 || end > b.length) throw new CorruptImageError('The JPEG file is truncated or corrupt.');
    if (m === 0xda) {
      parts.push(b.subarray(o, end));
      inScan = true;
    } else decide(m, o, end);
    o = end;
  }
  if (!ended) throw new CorruptImageError('The JPEG file is truncated (no end-of-image marker).');
  if (o < b.length) removed.push(`Trailing data after the image (${b.length - o} bytes)`);
  let finalRemoved = removed;
  if (orientation && orientation !== 1) {
    parts.splice(insertAt, 0, buildOrientationApp1(orientation));
    kept.push(`Orientation (${orientation})`);
    finalRemoved = removed.filter((r) => r !== ORIENTATION_ONLY);
  }
  return { bytes: concat(parts), removed: summarize(finalRemoved), kept };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PNG_LABELS: Record<string, string> = {
  tEXt: 'Text chunk (tEXt)',
  zTXt: 'Compressed text (zTXt)',
  iTXt: 'International text / XMP (iTXt)',
  eXIf: 'EXIF (eXIf)',
  tIME: 'Modification time (tIME)',
  iCCP: 'ICC color profile',
  caBX: 'Content credentials (caBX)',
  dSIG: 'Digital signature (dSIG)',
};

export function stripPng(b: Uint8Array, opts: StripOptions): StripResult {
  if (b.length < 8 || !PNG_SIG.every((v, i) => b[i] === v)) throw new CorruptImageError('This is not a valid PNG file.');
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  const kept: string[] = [];
  let o = 8;
  let sawEnd = false;
  while (o + 12 <= b.length) {
    const len = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const type = ascii(b, o + 4, 4);
    const end = o + 12 + len;
    if (end > b.length) throw new CorruptImageError('The PNG file is truncated or corrupt.');
    const label = PNG_LABELS[type];
    const drop = label !== undefined && !(type === 'iCCP' && opts.keepIcc);
    if (drop) removed.push(label);
    else {
      if (type === 'iCCP') kept.push(label);
      parts.push(b.subarray(o, end));
    }
    o = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new CorruptImageError('The PNG file is truncated (no IEND chunk).');
  if (o < b.length) removed.push(`Trailing data after the image (${b.length - o} bytes)`);
  return { bytes: concat(parts), removed: summarize(removed), kept };
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

export function stripWebp(b: Uint8Array, opts: StripOptions): StripResult {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') throw new CorruptImageError('This is not a valid WebP file.');
  const riffEnd = Math.min(b.length, 8 + (((b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0)));
  const chunks: Uint8Array[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  let vp8x: Uint8Array | null = null;
  let o = 12;
  while (o + 8 <= riffEnd) {
    const id = ascii(b, o, 4);
    const size = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
    const end = o + 8 + size + (size & 1);
    if (o + 8 + size > b.length) throw new CorruptImageError('The WebP file is truncated or corrupt.');
    const chunk = b.slice(o, Math.min(end, b.length));
    if (id === 'EXIF') removed.push('EXIF (camera, GPS, dates)');
    else if (id === 'XMP ') removed.push('XMP metadata');
    else if (id === 'ICCP' && !opts.keepIcc) removed.push('ICC color profile');
    else {
      if (id === 'ICCP') kept.push('ICC color profile');
      if (id === 'VP8X') vp8x = chunk;
      chunks.push(chunk);
    }
    o = end;
  }
  if (vp8x) {
    // Clear the EXIF (0x08) and XMP (0x04) flags, and ICC (0x20) if removed.
    vp8x[8] &= ~(0x08 | 0x04 | (opts.keepIcc ? 0 : 0x20));
  }
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  out.set(body, 12);
  const riffSize = 4 + body.length;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  return { bytes: out, removed: summarize(removed), kept };
}
