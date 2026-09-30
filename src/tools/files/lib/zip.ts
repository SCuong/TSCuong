/**
 * ZIP central-directory parsing (incl. ZIP64), entry extraction helpers,
 * CRC-32 and folder-tree building. Parsing works on byte ranges so large
 * archives never have to be loaded in full.
 */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  size: number;
  method: number;
  methodName: string;
  encrypted: boolean;
  /** Can this tool extract it (stored/deflate and not encrypted)? */
  supported: boolean;
  crc32: number;
  modified: Date | null;
  localHeaderOffset: number;
  comment: string;
  flags: number;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  comment: string;
  zip64: boolean;
  /** Offset of the central directory. */
  cdOffset: number;
}

const METHODS: Record<number, string> = {
  0: 'Stored',
  1: 'Shrunk',
  6: 'Imploded',
  8: 'Deflate',
  9: 'Deflate64',
  12: 'BZIP2',
  14: 'LZMA',
  93: 'Zstandard',
  95: 'XZ',
  98: 'PPMd',
  99: 'AES encrypted',
};

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

/** IBM code page 437 (the ZIP default for names without the UTF-8 flag), bytes 0x80–0xFF. */
const CP437_HIGH = [
  0xc7, 0xfc, 0xe9, 0xe2, 0xe4, 0xe0, 0xe5, 0xe7, 0xea, 0xeb, 0xe8, 0xef, 0xee, 0xec, 0xc4, 0xc5,
  0xc9, 0xe6, 0xc6, 0xf4, 0xf6, 0xf2, 0xfb, 0xf9, 0xff, 0xd6, 0xdc, 0xa2, 0xa3, 0xa5, 0x20a7, 0x192,
  0xe1, 0xed, 0xf3, 0xfa, 0xf1, 0xd1, 0xaa, 0xba, 0xbf, 0x2310, 0xac, 0xbd, 0xbc, 0xa1, 0xab, 0xbb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f, 0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x3b1, 0xdf, 0x393, 0x3c0, 0x3a3, 0x3c3, 0xb5, 0x3c4, 0x3a6, 0x398, 0x3a9, 0x3b4, 0x221e, 0x3c6, 0x3b5, 0x2229,
  0x2261, 0xb1, 0x2265, 0x2264, 0x2320, 0x2321, 0xf7, 0x2248, 0xb0, 0x2219, 0xb7, 0x221a, 0x207f, 0xb2, 0x25a0, 0xa0,
];

export function decodeCp437(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b < 0x80 ? b : CP437_HIGH[b - 0x80]);
  return out;
}

/**
 * Entry names and comments: UTF-8 when the archive says so (flag bit 11); otherwise UTF-8 if the bytes are
 * valid UTF-8 (macOS and many tools omit the flag), else the ZIP default, code page 437 — which is what
 * older Windows versions and DOS tools wrote ("Müller.txt" is 4D 81 6C 6C 65 72).
 */
export function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return decodeCp437(bytes);
  }
}

export function dosDateTime(date: number, time: number): Date | null {
  if (!date) return null;
  const year = 1980 + (date >> 9);
  const month = ((date >> 5) & 15) - 1;
  const day = date & 31;
  const d = new Date(year, month, day, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) || month < 0 || month > 11 || day < 1 ? null : d;
}

/** Locate the end-of-central-directory record in the archive's tail bytes. */
export function findEocd(tail: Uint8Array): number {
  for (let i = tail.length - 22; i >= Math.max(0, tail.length - 22 - 0xffff); i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      const commentLen = u16(tail, i + 20);
      if (i + 22 + commentLen <= tail.length) return i;
    }
  }
  return -1;
}

export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/** Parse the central directory using a random-access reader over a file of `size` bytes. */
export async function readZipDirectory(size: number, read: ReadRange): Promise<ZipDirectory> {
  if (size < 22) throw new ZipError('This file is too small to be a ZIP archive.');
  const tailStart = Math.max(0, size - (0xffff + 22 + 20));
  const tail = await read(tailStart, size);
  const eocdRel = findEocd(tail);
  if (eocdRel < 0) {
    const head = await read(0, Math.min(4, size));
    if (head[0] === 0x50 && head[1] === 0x4b)
      throw new ZipError('The ZIP archive is truncated or corrupt: its central directory (at the end of the file) is missing.');
    throw new ZipError('This is not a ZIP archive.');
  }
  const eocd = tailStart + eocdRel;
  const e = tail.subarray(eocdRel);
  if (u16(e, 4) !== 0 && u16(e, 4) !== 0xffff) throw new ZipError('Multi-part (split) ZIP archives are not supported.');
  let count = u16(e, 10);
  let cdSize = u32(e, 12);
  let cdOffset = u32(e, 16);
  const comment = decodeName(e.subarray(22, 22 + u16(e, 20)), false);
  let zip64 = false;
  /** Where the central directory must end: the ZIP64 end record, or the classic end record. */
  let cdEnd = eocd;
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locRel = eocdRel - 20;
    if (locRel < 0 || u32(tail, locRel) !== 0x07064b50) throw new ZipError('The ZIP64 archive is corrupt (missing ZIP64 locator).');
    let recOffset = u64(tail, locRel + 8);
    let rec = recOffset + 56 <= size ? await read(recOffset, recOffset + 56) : new Uint8Array(0);
    if (rec.length < 56 || u32(rec, 0) !== 0x06064b50) {
      // Data prepended to the archive shifts every offset; the record normally sits right before the locator.
      recOffset = tailStart + locRel - 56;
      rec = recOffset >= 0 ? await read(recOffset, recOffset + 56) : new Uint8Array(0);
      if (rec.length < 56 || u32(rec, 0) !== 0x06064b50) throw new ZipError('The ZIP64 archive is corrupt (bad ZIP64 end record).');
    }
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
    zip64 = true;
    cdEnd = recOffset;
  }
  if (count > 1_000_000) throw new ZipError('This archive lists more than a million entries; it is too large to browse here.');
  // Self-extracting archives (and ZIPs with anything else prepended) keep offsets relative to where the
  // archive began. The central directory really ends where the end record starts, so derive the shift.
  let shift = 0;
  const actualCd = cdEnd - cdSize;
  if (count > 0 && actualCd > cdOffset) {
    const head = cdOffset + 4 <= size ? await read(cdOffset, cdOffset + 4) : new Uint8Array(0);
    if (head.length < 4 || u32(head, 0) !== 0x02014b50) {
      const probe = await read(actualCd, actualCd + 4);
      if (probe.length === 4 && u32(probe, 0) === 0x02014b50) shift = actualCd - cdOffset;
    }
  }
  cdOffset += shift;
  if (cdOffset + cdSize > cdEnd || cdOffset > size)
    throw new ZipError('The ZIP archive is truncated or corrupt (central directory out of range).');
  const cd = await read(cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let o = 0;
  for (let i = 0; i < count; i++) {
    if (o + 46 > cd.length || u32(cd, o) !== 0x02014b50)
      throw new ZipError(`The ZIP archive is corrupt (entry ${i + 1} of ${count} is damaged).`);
    const flags = u16(cd, o + 8);
    const method = u16(cd, o + 10);
    const time = u16(cd, o + 12);
    const date = u16(cd, o + 14);
    const crc = u32(cd, o + 16);
    let compressedSize = u32(cd, o + 20);
    let uncompressed = u32(cd, o + 24);
    const nameLen = u16(cd, o + 28);
    const extraLen = u16(cd, o + 30);
    const commentLen = u16(cd, o + 32);
    let localHeaderOffset = u32(cd, o + 42);
    const rawName = cd.subarray(o + 46, o + 46 + nameLen);
    let name = decodeName(rawName, Boolean(flags & 0x800));
    let x = o + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x);
      const len = u16(cd, x + 2);
      if (id === 0x0001) {
        // ZIP64 extended information.
        let p = x + 4;
        if (uncompressed === 0xffffffff) {
          uncompressed = u64(cd, p);
          p += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, p);
          p += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, p);
      } else if (id === 0x7075 && len >= 5 && cd[x + 4] === 1 && !(flags & 0x800) && x + 4 + len <= xEnd) {
        // Info-ZIP Unicode Path: the UTF-8 name, valid while its CRC matches the legacy name it replaces.
        if (u32(cd, x + 5) === crc32(rawName)) name = new TextDecoder('utf-8').decode(cd.subarray(x + 9, x + 4 + len));
      }
      x += 4 + len;
    }
    localHeaderOffset += shift;
    const encrypted = Boolean(flags & 1) || method === 99;
    const isDirectory = name.endsWith('/') || name.endsWith('\\');
    entries.push({
      name: name.replace(/\\/g, '/'),
      isDirectory,
      compressedSize,
      size: uncompressed,
      method,
      methodName: METHODS[method] ?? `Method ${method}`,
      encrypted,
      supported: !encrypted && (method === 0 || method === 8),
      crc32: crc,
      modified: dosDateTime(date, time),
      localHeaderOffset,
      comment: decodeName(cd.subarray(xEnd, xEnd + commentLen), Boolean(flags & 0x800)),
      flags,
    });
    o = xEnd + commentLen;
  }
  return { entries, comment, zip64, cdOffset };
}

/** Byte range of an entry's compressed data, from its local header. */
export async function entryDataRange(entry: ZipEntry, size: number, read: ReadRange): Promise<[number, number]> {
  const lh = await read(entry.localHeaderOffset, Math.min(size, entry.localHeaderOffset + 30));
  if (lh.length < 30 || u32(lh, 0) !== 0x04034b50) throw new ZipError(`The local header for “${entry.name}” is damaged.`);
  const start = entry.localHeaderOffset + 30 + u16(lh, 26) + u16(lh, 28);
  const end = start + entry.compressedSize;
  if (end > size) throw new ZipError(`“${entry.name}” is truncated: the archive ends before its data.`);
  return [start, end];
}

/**
 * Inflate raw DEFLATE data into at most `limit` bytes (the entry's declared size). A forged size can't
 * make the page allocate gigabytes ("zip bomb"): decompression stops as soon as the output would exceed
 * the declared size. Input is fed in small slices with pauses so the UI stays responsive.
 */
export async function inflateLimited(raw: Uint8Array, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  const { Inflate } = await import('fflate');
  const out = new Uint8Array(limit);
  let length = 0;
  let overflow = false;
  const inflater = new Inflate((chunk) => {
    if (overflow) return;
    if (length + chunk.length > limit) {
      overflow = true;
      return;
    }
    out.set(chunk, length);
    length += chunk.length;
  });
  // DEFLATE expands at most ~1032:1, so a 32 KB slice produces at most ~33 MB before the check below runs.
  const SLICE = 32 * 1024;
  let lastPause = performance.now();
  let pos = 0;
  do {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(raw.length, pos + SLICE);
    try {
      inflater.push(raw.subarray(pos, end), end >= raw.length);
    } catch {
      throw new ZipError('The compressed data is corrupt.');
    }
    if (overflow) throw new ZipError('The data expands beyond the size the archive declares (a possible “zip bomb”), so it was not extracted.');
    pos = end;
    if (performance.now() - lastPause > 30) {
      await new Promise((r) => setTimeout(r, 0));
      lastPause = performance.now();
    }
  } while (pos < raw.length);
  return length === limit ? out : out.subarray(0, length);
}

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array, crc = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export interface TreeNode {
  name: string;
  path: string;
  entry?: ZipEntry;
  children: TreeNode[];
  size: number;
  compressedSize: number;
  files: number;
}

/** Build a folder tree (folders first, then files, alphabetical). */
export function buildTree(entries: ZipEntry[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    children: [],
    size: 0,
    compressedSize: 0,
    files: 0,
  };
  const folders = new Map<string, TreeNode>([['', root]]);
  const folder = (path: string): TreeNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const parent = folder(parentPath);
    const node: TreeNode = {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      children: [],
      size: 0,
      compressedSize: 0,
      files: 0,
    };
    parent.children.push(node);
    folders.set(path, node);
    return node;
  };
  for (const e of entries) {
    const clean = e.name.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!clean) continue;
    if (e.isDirectory) {
      folder(clean).entry = e;
      continue;
    }
    const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    const parent = folder(parentPath);
    parent.children.push({
      name: clean.slice(clean.lastIndexOf('/') + 1),
      path: clean,
      entry: e,
      children: [],
      size: e.size,
      compressedSize: e.compressedSize,
      files: 1,
    });
  }
  const finish = (n: TreeNode) => {
    n.children.sort(
      (a, b) =>
        Number(Boolean(b.children.length || b.entry?.isDirectory)) - Number(Boolean(a.children.length || a.entry?.isDirectory)) ||
        a.name.localeCompare(b.name),
    );
    for (const c of n.children) {
      if (c.children.length || c.entry?.isDirectory) finish(c);
      n.size += c.size;
      n.compressedSize += c.compressedSize;
      n.files += c.files;
    }
  };
  finish(root);
  return root;
}

/** Compression ratio as "space saved" percent (0 when stored or empty). */
export function savedPercent(size: number, compressed: number): number {
  if (!size) return 0;
  return Math.max(-999, ((size - compressed) / size) * 100);
}

/** Reject names that would escape the target folder ("zip slip"). */
export function safeEntryPath(name: string): string | null {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..') || /^[a-zA-Z]:/.test(parts[0] ?? '')) return null;
  return parts.join('/');
}
