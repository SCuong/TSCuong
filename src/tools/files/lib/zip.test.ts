import { describe, expect, it } from 'vitest';
import { inflateSync, strToU8, zipSync } from 'fflate';
import { buildTree, crc32, dosDateTime, entryDataRange, readZipDirectory, safeEntryPath, savedPercent, ZipError } from './zip';

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
