import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync, strToU8, zipSync } from 'fflate';
import {
  buildTree,
  crc32,
  decodeCp437,
  dosDateTime,
  entryDataRange,
  inflateLimited,
  readZipDirectory,
  safeEntryPath,
  savedPercent,
  ZipError,
} from './zip';

const reader = (bytes: Uint8Array) => async (s: number, e: number) => bytes.slice(s, e);

async function dir(bytes: Uint8Array) {
  return readZipDirectory(bytes.length, reader(bytes));
}

describe('readZipDirectory', () => {
  const text = 'hello hello hello hello hello 😀';
  const zip = zipSync(
    {
      'readme.txt': strToU8(text),
      'src/': new Uint8Array(0),
      'src/main.js': [strToU8('console.log(1)'), { level: 0 }],
      'src/deep/ünïcode 文件.md': strToU8('# hi'),
    },
    { mtime: new Date(2024, 4, 17, 10, 30, 0) },
  );

  it('lists entries with sizes, methods and dates', async () => {
    const d = await dir(zip);
    expect(d.entries.map((e) => e.name)).toEqual(['readme.txt', 'src/', 'src/main.js', 'src/deep/ünïcode 文件.md']);
    const readme = d.entries[0];
    expect(readme.size).toBe(strToU8(text).length);
    expect(readme.methodName).toBe('Deflate');
    expect(readme.supported).toBe(true);
    expect(readme.encrypted).toBe(false);
    expect(readme.crc32).toBe(crc32(strToU8(text)));
    expect(readme.modified?.getFullYear()).toBe(2024);
    expect(d.entries[1].isDirectory).toBe(true);
    expect(d.entries[2].methodName).toBe('Stored');
    expect(d.zip64).toBe(false);
  });

  it('extracts entry data that inflates to the original', async () => {
    const d = await dir(zip);
    const e = d.entries[0];
    const [s, end] = await entryDataRange(e, zip.length, reader(zip));
    const out = inflateSync(zip.slice(s, end));
    expect(new TextDecoder().decode(out)).toBe(text);
    const stored = d.entries[2];
    const [s2, e2] = await entryDataRange(stored, zip.length, reader(zip));
    expect(new TextDecoder().decode(zip.slice(s2, e2))).toBe('console.log(1)');
  });

  it('flags encrypted entries', async () => {
    const copy = zip.slice();
    const d = await dir(copy);
    // Set general purpose bit 0 in the central directory record of the first entry.
    const cd = d.cdOffset;
    copy[cd + 8] |= 1;
    const d2 = await dir(copy);
    expect(d2.entries[0].encrypted).toBe(true);
    expect(d2.entries[0].supported).toBe(false);
  });

  it('reports unsupported compression methods', async () => {
    const copy = zip.slice();
    const d = await dir(copy);
    copy[d.cdOffset + 10] = 14; // LZMA
    const e = (await dir(copy)).entries[0];
    expect(e.methodName).toBe('LZMA');
    expect(e.supported).toBe(false);
  });

  it('handles archive comments', async () => {
    const withComment = new Uint8Array(zip.length + 5);
    withComment.set(zip);
    withComment.set(strToU8('hello'), zip.length);
    // patch comment length in EOCD
    withComment[zip.length - 2] = 5;
    const d = await dir(withComment);
    expect(d.comment).toBe('hello');
    expect(d.entries).toHaveLength(4);
  });

  it('rejects truncated, corrupt and non-zip data', async () => {
    await expect(dir(zip.slice(0, zip.length - 30))).rejects.toThrow(/truncated or corrupt/);
    await expect(dir(new Uint8Array(10))).rejects.toThrow(ZipError);
    await expect(dir(strToU8('this is definitely not a zip archive at all'))).rejects.toThrow(/not a ZIP/);
    const broken = zip.slice();
    const d = await dir(broken);
    broken[d.cdOffset] = 0;
    await expect(dir(broken)).rejects.toThrow(/damaged/);
    // Local header damaged
    const lh = zip.slice();
    lh[0] = 0;
    const d3 = await dir(lh);
    await expect(entryDataRange(d3.entries[0], lh.length, reader(lh))).rejects.toThrow(/local header/);
  });

  it('handles an empty archive', async () => {
    const empty = zipSync({});
    expect((await dir(empty)).entries).toEqual([]);
  });
});

describe('helpers', () => {
  it('crc32 matches known values', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    const a = strToU8('hello ');
    const b = strToU8('world');
    expect(crc32(b, crc32(a))).toBe(crc32(strToU8('hello world')));
  });

  it('dosDateTime', () => {
    const d = dosDateTime(((2024 - 1980) << 9) | (5 << 5) | 17, (10 << 11) | (30 << 5) | 5)!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2024, 4, 17, 10, 30, 10]);
    expect(dosDateTime(0, 0)).toBeNull();
  });

  it('buildTree aggregates sizes, creates implicit folders and sorts folders first', async () => {
    const zip = zipSync({
      'b.txt': strToU8('bb'),
      'a/x.txt': strToU8('xxx'),
      'a/b/y.txt': strToU8('yyyy'),
      'c/': new Uint8Array(0),
    });
    const tree = buildTree((await dir(zip)).entries);
    expect(tree.children.map((c) => c.name)).toEqual(['a', 'c', 'b.txt']);
    expect(tree.files).toBe(3);
    expect(tree.size).toBe(9);
    const a = tree.children[0];
    expect(a.children.map((c) => c.name)).toEqual(['b', 'x.txt']);
    expect(a.size).toBe(7);
  });

  it('savedPercent and safeEntryPath', () => {
    expect(savedPercent(100, 25)).toBe(75);
    expect(savedPercent(0, 0)).toBe(0);
    expect(safeEntryPath('a/b/c.txt')).toBe('a/b/c.txt');
    expect(safeEntryPath('./a//b.txt')).toBe('a/b.txt');
    expect(safeEntryPath('../evil.txt')).toBeNull();
    expect(safeEntryPath('a/../../evil')).toBeNull();
    expect(safeEntryPath('C:/Windows/x')).toBeNull();
  });
});

/** A minimal ZIP writer with full control over name bytes, flags and extra fields (fflate always writes UTF-8). */
function rawZip(entries: Array<{ name: Uint8Array; data: Uint8Array; flags?: number; extra?: Uint8Array }>, prefix = new Uint8Array(0)) {
  const parts: Uint8Array[] = [prefix];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const extra = e.extra ?? new Uint8Array(0);
    const lh = new Uint8Array(30);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, e.flags ?? 0, true);
    lv.setUint32(14, crc32(e.data), true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, e.name.length, true);
    lv.setUint16(28, extra.length, true);
    parts.push(lh, e.name, extra, e.data);
    const ch = new Uint8Array(46);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, e.flags ?? 0, true);
    cv.setUint32(16, crc32(e.data), true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, e.name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true); // relative to the archive start, as SFX builders write them
    central.push(ch, e.name, extra);
    offset += 30 + e.name.length + extra.length + e.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('names without the UTF-8 flag', () => {
  it('decodes code page 437, the ZIP default, instead of Latin-1', async () => {
    // Regression: "Müller.txt" (81 = ü in CP437) showed as "Mller.txt" with an invisible U+0081.
    const zip = rawZip([{ name: Uint8Array.from([0x4d, 0x81, 0x6c, 0x6c, 0x65, 0x72, 0x2e, 0x74, 0x78, 0x74]), data: strToU8('x') }]);
    expect((await dir(zip)).entries[0].name).toBe('Müller.txt');
    expect(decodeCp437(Uint8Array.from([0x84, 0x94, 0xe1, 0x9c, 0xff]))).toBe(`äöß£${String.fromCharCode(0xa0)}`);
  });

  it('prefers valid UTF-8, and the Info-ZIP Unicode Path field when its CRC matches', async () => {
    const legacy = Uint8Array.from([0x53, 0x84, 0x75, 0x72, 0x65, 0x2e, 0x74, 0x78, 0x74]); // "Säure.txt" in CP437
    const unicode = strToU8('Säure-ü.txt');
    const field = (crc: number) => {
      const f = new Uint8Array(9 + unicode.length);
      const v = new DataView(f.buffer);
      v.setUint16(0, 0x7075, true);
      v.setUint16(2, 5 + unicode.length, true);
      f[4] = 1;
      v.setUint32(5, crc, true);
      f.set(unicode, 9);
      return f;
    };
    const zip = rawZip([
      { name: strToU8('plain-utf8-ü.txt'), data: strToU8('a') },
      { name: legacy, data: strToU8('b'), extra: field(crc32(legacy)) },
      { name: legacy, data: strToU8('c'), extra: field(12345) },
    ]);
    const names = (await dir(zip)).entries.map((e) => e.name);
    expect(names).toEqual(['plain-utf8-ü.txt', 'Säure-ü.txt', 'Säure.txt']);
  });
});

describe('self-extracting archives', () => {
  it('finds entries when data is prepended to the archive', async () => {
    // Regression: offsets are relative to the archive start, so SFX files were reported as corrupt.
    const zip = rawZip([{ name: strToU8('inside.txt'), data: strToU8('inside sfx') }], new Uint8Array(4096).fill(0x4d));
    const d = await dir(zip);
    expect(d.entries[0].name).toBe('inside.txt');
    const [s, e] = await entryDataRange(d.entries[0], zip.length, reader(zip));
    expect(new TextDecoder().decode(zip.slice(s, e))).toBe('inside sfx');
  });
});

describe('inflateLimited', () => {
  const data = strToU8('abc'.repeat(10_000));
  const compressed = deflateSync(data);

  it('inflates to the declared size', async () => {
    const out = await inflateLimited(compressed, data.length);
    expect(out.length).toBe(data.length);
    expect(new TextDecoder().decode(out)).toBe('abc'.repeat(10_000));
    expect(crc32(out)).toBe(crc32(data));
  });

  it('refuses output beyond the declared size (zip bomb)', async () => {
    // Regression: a 64 KB entry declaring 10 bytes was inflated to 64 MB in memory before the size check.
    const bomb = deflateSync(new Uint8Array(8 * 1024 * 1024));
    await expect(inflateLimited(bomb, 10)).rejects.toThrow(/expands beyond the size the archive declares/);
  });

  it('reports corrupt data in words', async () => {
    await expect(inflateLimited(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 100)).rejects.toThrow('The compressed data is corrupt.');
  });
});
