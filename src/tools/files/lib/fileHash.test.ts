import { describe, expect, it } from 'vitest';
import { algosForLength, checksumFile, hashRange, parseExpected, verify, type ReadRange } from './fileHash';

const reader =
  (bytes: Uint8Array): ReadRange =>
  async (s, e) =>
    bytes.subarray(s, e);
const enc = (s: string) => new TextEncoder().encode(s);

describe('hashRange', () => {
  it('computes standard test vectors for "abc"', async () => {
    const data = enc('abc');
    const r = await hashRange(reader(data), data.length, ['md5', 'sha1', 'sha256', 'sha384', 'sha512', 'crc32']);
    expect(r.md5).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(r.sha1).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(r.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(r.sha384).toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
    expect(r.sha512.startsWith('ddaf35a193617aba')).toBe(true);
    expect(r.crc32).toBe('352441c2');
  });

  it('hashes the empty input', async () => {
    const r = await hashRange(reader(new Uint8Array(0)), 0, ['sha256', 'md5']);
    expect(r.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(r.md5).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('gives the same result regardless of chunk size, with progress (Unicode input)', async () => {
    const data = enc('héllo wörld 😀 '.repeat(5000));
    const whole = await hashRange(reader(data), data.length, ['sha256', 'crc32']);
    const seen: number[] = [];
    const chunked = await hashRange(reader(data), data.length, ['sha256', 'crc32'], { chunkSize: 997, onProgress: (n) => seen.push(n) });
    expect(chunked).toEqual(whole);
    expect(seen.at(-1)).toBe(data.length);
    expect(seen.length).toBe(Math.ceil(data.length / 997));
  });

  it('can be cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(hashRange(reader(enc('abc')), 3, ['md5'], { signal: ctrl.signal })).rejects.toThrow(/Aborted/);
  });
});

describe('parseExpected', () => {
  it('parses bare, prefixed, GNU and BSD formats', () => {
    expect(parseExpected('  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD ')).toEqual([
      {
        hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      },
    ]);
    expect(parseExpected('sha256:abcdef0123456789')).toEqual([{ hash: 'abcdef0123456789' }]);
    expect(parseExpected('900150983cd24fb0d6963f7d28e17f72  abc.txt\n900150983cd24fb0d6963f7d28e17f73 *b in.bin')).toEqual([
      { hash: '900150983cd24fb0d6963f7d28e17f72', name: 'abc.txt' },
      { hash: '900150983cd24fb0d6963f7d28e17f73', name: 'b in.bin' },
    ]);
    expect(parseExpected('SHA256 (fïlé 😀.iso) = ABCDEF0123456789')).toEqual([{ hash: 'abcdef0123456789', name: 'fïlé 😀.iso' }]);
    expect(parseExpected('# comment\n\nnot a hash')).toEqual([]);
    expect(parseExpected('')).toEqual([]);
  });
});

describe('verify', () => {
  const digests = {
    md5: '900150983cd24fb0d6963f7d28e17f72',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  };
  it('matches by value for unnamed hashes', () => {
    expect(verify('abc.txt', digests, parseExpected(digests.sha256))).toEqual({
      status: 'match',
      algo: 'sha256',
    });
    expect(verify('abc.txt', digests, [{ hash: 'ff'.repeat(16) }])).toEqual({
      status: 'mismatch',
      algo: 'md5',
      computed: true,
    });
    expect(verify('abc.txt', digests, [{ hash: 'ff'.repeat(20) }])).toEqual({
      status: 'mismatch',
      algo: 'sha1',
      computed: false,
    });
    expect(verify('abc.txt', digests, [])).toEqual({ status: 'none' });
  });
  it('uses the entry for this file name from a checksum list', () => {
    const list = parseExpected(`${'0'.repeat(32)}  other.txt\n${digests.md5}  dir/abc.txt`);
    expect(verify('abc.txt', digests, list)).toEqual({
      status: 'match',
      algo: 'md5',
    });
    const wrong = parseExpected(`${'1'.repeat(32)}  abc.txt\n${digests.md5}  other.txt`);
    expect(verify('abc.txt', digests, wrong)).toEqual({
      status: 'mismatch',
      algo: 'md5',
      computed: true,
    });
    expect(verify('unlisted.txt', digests, wrong)).toEqual({ status: 'none' });
  });
  it('knows digest lengths', () => {
    expect(algosForLength('a'.repeat(64))).toEqual(['sha256']);
    expect(algosForLength('a'.repeat(8))).toEqual(['crc32']);
    expect(algosForLength('abc')).toEqual([]);
  });
  it('writes sha256sum-compatible output', () => {
    expect(checksumFile([{ name: 'a.txt', hash: 'ab' }])).toBe('ab  a.txt\n');
    expect(checksumFile([])).toBe('');
  });
});

describe('escaped file names (GNU coreutils)', () => {
  const hash = 'a'.repeat(64);
  // Built from char codes so the escapes under test can't be confused with source escapes.
  const BS = String.fromCharCode(92);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);

  it('parses lines that start with a backslash and unescapes the name', () => {
    // Regression: a name escaped as "back\\slash" kept the doubled backslash, so the file never matched.
    expect(parseExpected(`${BS}${hash}  back${BS}${BS}slash${BS}nline.txt`)).toEqual([{ hash, name: `back${BS}slash${LF}line.txt` }]);
    expect(parseExpected(`${BS}SHA256 (a${BS}${BS}b.txt) = ${hash}`)).toEqual([{ hash, name: `a${BS}b.txt` }]);
    expect(parseExpected(`${hash} *binary.bin${CR}${LF}${hash}  text.txt`)).toEqual([
      { hash, name: 'binary.bin' },
      { hash, name: 'text.txt' },
    ]);
  });

  it('escapes such names when writing a list, so it round-trips', () => {
    const list = checksumFile([
      { name: `a${BS}b.txt`, hash },
      { name: 'plain.txt', hash },
    ]);
    expect(list).toBe(`${BS}${hash}  a${BS}${BS}b.txt${LF}${hash}  plain.txt${LF}`);
    expect(parseExpected(list).map((e) => e.name)).toEqual([`a${BS}b.txt`, 'plain.txt']);
  });
});
