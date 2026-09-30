/** Pure helpers for the hex viewer: offsets, pattern parsing, chunked search, byte inspection. */

export function parseOffset(input: string, size: number): { ok: true; value: number } | { ok: false; error: string } {
  const s = input.trim().replace(/_/g, '');
  if (!s) return { ok: false, error: 'Enter an offset.' };
  let n: number;
  if (/^(0x|\$|#)[0-9a-f]+$/i.test(s)) n = parseInt(s.replace(/^(0x|\$|#)/i, ''), 16);
  else if (/^[0-9a-f]+h$/i.test(s)) n = parseInt(s.slice(0, -1), 16);
  else if (/^\d+$/.test(s)) n = parseInt(s, 10);
  else if (/^[0-9a-f]+$/i.test(s))
    return {
      ok: false,
      error: 'Ambiguous offset: prefix hex values with 0x (e.g. 0x1F).',
    };
  else return { ok: false, error: 'Offsets are decimal (1234) or hex (0x4D2).' };
  if (!Number.isSafeInteger(n)) return { ok: false, error: 'That offset is too large.' };
  if (n >= size)
    return {
      ok: false,
      error: `The file is only ${size.toLocaleString()} bytes (last offset 0x${Math.max(0, size - 1)
        .toString(16)
        .toUpperCase()}).`,
    };
  return { ok: true, value: n };
}

export interface Pattern {
  bytes: Uint8Array;
  /** 1 = must match, 0 = wildcard. */
  mask: Uint8Array;
  caseInsensitive: boolean;
}

/** Parse "DE AD be ef", "DEADBEEF", "de ?? ef" (?? = any byte). */
export function parseHexPattern(input: string): Pattern | { error: string } {
  const cleaned = input
    .trim()
    .replace(/0x/gi, '')
    .replace(/[\s,:-]+/g, ' ');
  if (!cleaned) return { error: 'Enter hex bytes to search for.' };
  const tokens = cleaned.includes(' ') ? cleaned.split(' ') : (cleaned.match(/.{1,2}/g) ?? []);
  const bytes: number[] = [];
  const mask: number[] = [];
  for (const t of tokens) {
    if (t === '??' || t === '?') {
      bytes.push(0);
      mask.push(0);
    } else if (/^[0-9a-f]{1,2}$/i.test(t)) {
      if (!cleaned.includes(' ') && t.length === 1) return { error: 'Hex search needs an even number of digits.' };
      bytes.push(parseInt(t, 16));
      mask.push(1);
    } else
      return {
        error: `“${t}” is not a hex byte. Use pairs like 4F 6B or ?? for any byte.`,
      };
  }
  if (!mask.some(Boolean)) return { error: 'The pattern needs at least one concrete byte.' };
  return {
    bytes: Uint8Array.from(bytes),
    mask: Uint8Array.from(mask),
    caseInsensitive: false,
  };
}

/**
 * UTF-8 search pattern. "Ignore case" folds ASCII letters only (A–Z), on both sides: lower-casing the
 * whole needle would turn "Ä" into "ä", whose UTF-8 bytes never match an "Ä" in the file.
 */
export function textPattern(text: string, caseInsensitive: boolean): Pattern | { error: string } {
  if (!text) return { error: 'Enter text to search for.' };
  const bytes = new TextEncoder().encode(caseInsensitive ? text.replace(/[A-Z]/g, (c) => c.toLowerCase()) : text);
  return { bytes, mask: new Uint8Array(bytes.length).fill(1), caseInsensitive };
}

const lower = (b: number) => (b >= 0x41 && b <= 0x5a ? b + 32 : b);

function matchesAt(buf: Uint8Array, i: number, p: Pattern): boolean {
  const { bytes, mask, caseInsensitive } = p;
  for (let j = 0; j < bytes.length; j++) {
    if (!mask[j]) continue;
    const v = caseInsensitive ? lower(buf[i + j]) : buf[i + j];
    if (v !== bytes[j]) return false;
  }
  return true;
}

/** All match positions of `p` inside `buf` (relative), from `from` (inclusive). */
export function findAll(buf: Uint8Array, p: Pattern, from = 0): number[] {
  const out: number[] = [];
  for (let i = from; i + p.bytes.length <= buf.length; i++) if (matchesAt(buf, i, p)) out.push(i);
  return out;
}

export type Reader = (start: number, end: number) => Promise<Uint8Array>;

/**
 * Find the next match at or after `start` (forward) or at or before `start`
 * (backward), reading the file in chunks with overlap so matches that span
 * chunk boundaries are found. Returns -1 when there is none.
 */
export async function searchFile(
  read: Reader,
  size: number,
  p: Pattern,
  start: number,
  direction: 'forward' | 'backward',
  opts: {
    chunkSize?: number;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<number> {
  const chunk = Math.max(opts.chunkSize ?? 4 * 1024 * 1024, p.bytes.length * 2);
  const overlap = p.bytes.length - 1;
  if (p.bytes.length === 0 || p.bytes.length > size) return -1;
  if (direction === 'forward') {
    let pos = Math.max(0, start);
    while (pos + p.bytes.length <= size) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const end = Math.min(size, pos + chunk + overlap);
      const buf = await read(pos, end);
      for (let i = 0; i + p.bytes.length <= buf.length; i++) if (matchesAt(buf, i, p)) return pos + i;
      opts.onProgress?.(end / size);
      if (end >= size) break;
      pos += chunk;
    }
    return -1;
  }
  let hi = Math.min(start, size - p.bytes.length); // last allowed match start
  while (hi >= 0) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const lo = Math.max(0, hi - chunk + 1);
    const buf = await read(lo, Math.min(size, hi + p.bytes.length));
    for (let i = hi - lo; i >= 0; i--) if (matchesAt(buf, i, p)) return lo + i;
    opts.onProgress?.(1 - lo / size);
    if (lo === 0) break;
    hi = lo - 1;
  }
  return -1;
}

export interface InspectRow {
  label: string;
  le: string;
  be: string;
}

/** Decode the bytes at the cursor as common numeric types (needs up to 8 bytes). */
export function inspectBytes(bytes: Uint8Array): InspectRow[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length;
  const rows: InspectRow[] = [];
  const both = (label: string, need: number, fn: (le: boolean) => string) => {
    if (n < need) rows.push({ label, le: '—', be: '—' });
    else rows.push({ label, le: fn(true), be: fn(false) });
  };
  if (n >= 1) {
    rows.push({
      label: 'int8',
      le: String(v.getInt8(0)),
      be: String(v.getInt8(0)),
    });
    rows.push({
      label: 'uint8',
      le: String(v.getUint8(0)),
      be: String(v.getUint8(0)),
    });
  }
  both('int16', 2, (le) => String(v.getInt16(0, le)));
  both('uint16', 2, (le) => String(v.getUint16(0, le)));
  both('int32', 4, (le) => String(v.getInt32(0, le)));
  both('uint32', 4, (le) => String(v.getUint32(0, le)));
  both('int64', 8, (le) => v.getBigInt64(0, le).toString());
  both('uint64', 8, (le) => v.getBigUint64(0, le).toString());
  const fmt = (x: number) => (Number.isNaN(x) ? 'NaN' : Number.isFinite(x) ? String(x) : x > 0 ? 'Infinity' : '-Infinity');
  both('float32', 4, (le) => fmt(v.getFloat32(0, le)));
  both('float64', 8, (le) => fmt(v.getFloat64(0, le)));
  return rows;
}

/** The UTF-8 character starting at bytes[0], or a description when invalid. */
export function utf8At(bytes: Uint8Array): { char: string; length: number } | null {
  if (!bytes.length) return null;
  const b0 = bytes[0];
  const len = b0 < 0x80 ? 1 : b0 >= 0xc2 && b0 < 0xe0 ? 2 : b0 >= 0xe0 && b0 < 0xf0 ? 3 : b0 >= 0xf0 && b0 < 0xf5 ? 4 : 0;
  if (!len || bytes.length < len) return null;
  try {
    const ch = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, len));
    return { char: ch, length: len };
  } catch {
    return null;
  }
}

export function toHex(n: number, width = 8): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

export function byteToChar(b: number): string {
  return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
}
