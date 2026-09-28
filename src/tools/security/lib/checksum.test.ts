import { describe, expect, it } from 'vitest';
import { algorithmFromName, candidatesForLength, compareDigests, parseExpectedHash } from './checksum';
import { hashBlob, hashBytes } from './hash';
import { hexToBytes } from '../shared-a/bytes';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const ABC_SHA256_B64 = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';

function ok(input: string) {
  const r = parseExpectedHash(input);
  if (!r || !r.ok) throw new Error(`expected ok for ${input}: ${JSON.stringify(r)}`);
  return r.value;
}

describe('candidatesForLength', () => {
  it('lists every algorithm of a length', () => {
    expect(candidatesForLength(32)).toEqual(['sha256', 'sha3-256', 'blake3', 'blake2s', 'keccak256']);
    expect(candidatesForLength(16)).toEqual(['md5']);
    expect(candidatesForLength(20)).toEqual(['sha1', 'ripemd160']);
    expect(candidatesForLength(64)).toEqual(['sha512', 'sha3-512', 'blake2b']);
    expect(candidatesForLength(4)).toEqual(['crc32']);
    expect(candidatesForLength(8)).toEqual(['xxhash64']);
    expect(candidatesForLength(13)).toEqual([]);
  });
});

describe('parseExpectedHash', () => {
  it('returns null for empty input', () => {
    expect(parseExpectedHash('')).toBeNull();
    expect(parseExpectedHash('  \n ')).toBeNull();
  });

  it('parses bare hex case-insensitively', () => {
    const v = ok(ABC_SHA256.toUpperCase());
    expect(v.hex).toBe(ABC_SHA256);
    expect(v.encoding).toBe('hex');
    expect(v.candidates[0]).toBe('sha256');
    expect(v.candidates).toHaveLength(5);
  });

  it('parses sha256sum lines (text and binary mode)', () => {
    expect(ok(`${ABC_SHA256}  ubuntu-24.04.iso`).filename).toBe('ubuntu-24.04.iso');
    const bin = ok(`${ABC_SHA256} *my file.bin\n${'0'.repeat(64)}  other`);
    expect(bin.filename).toBe('my file.bin');
    expect(bin.hex).toBe(ABC_SHA256);
  });

  it('picks the matching line from a multi-line SHA256SUMS file', () => {
    const other = 'f'.repeat(64);
    const sums = `# checksums\n${other}  other.iso\n${ABC_SHA256} *dist/Target.ISO\n`;
    expect(ok(sums).hex).toBe(other);
    const v = parseExpectedHash(sums, 'target.iso');
    expect(v && v.ok && v.value.hex).toBe(ABC_SHA256);
    const bsd = `SHA256 (a.txt) = ${other}\nSHA256 (b.txt) = ${ABC_SHA256}`;
    const b = parseExpectedHash(bsd, 'b.txt');
    expect(b && b.ok && b.value.hex).toBe(ABC_SHA256);
    const none = parseExpectedHash(sums, 'missing.bin');
    expect(none && none.ok && none.value.hex).toBe(other);
  });

  it('parses BSD tag lines and uses the named algorithm', () => {
    const v = ok(`SHA256 (file.txt) = ${ABC_SHA256}`);
    expect(v.hint).toBe('sha256');
    expect(v.candidates).toEqual(['sha256']);
    expect(v.filename).toBe('file.txt');
    expect(ok(`SHA3-256 (x) = ${ABC_SHA256}`).candidates).toEqual(['sha3-256']);
  });

  it('parses algo: prefixes and SRI', () => {
    expect(ok(`sha256:${ABC_SHA256}`).candidates).toEqual(['sha256']);
    expect(ok(`SHA-1: ${'a'.repeat(40)}`).candidates).toEqual(['sha1']);
    const sri = ok(`sha256-${ABC_SHA256_B64}`);
    expect(sri.hex).toBe(ABC_SHA256);
    expect(sri.encoding).toBe('base64');
  });

  it('parses base64 digests', () => {
    const v = ok(ABC_SHA256_B64);
    expect(v.hex).toBe(ABC_SHA256);
    expect(v.encoding).toBe('base64');
    // md5("") in base64
    expect(ok('1B2M2Y8AsgTpgAmY7PhCfg==').candidates).toEqual(['md5']);
  });

  it('rejects wrong lengths and junk with a sentence', () => {
    const short = parseExpectedHash('abcdef12345');
    expect(short && !short.ok && short.error).toMatch(/doesn't match any supported hash/);
    const junk = parseExpectedHash('not a hash!!');
    expect(junk && !junk.ok && junk.error).toMatch(/hex|Base64/);
    const mismatch = parseExpectedHash(`md5:${ABC_SHA256}`);
    expect(mismatch && !mismatch.ok && mismatch.error).toMatch(/MD5/);
  });

  it('knows algorithm names', () => {
    expect(algorithmFromName('SHA-512')).toBe('sha512');
    expect(algorithmFromName('blake2b')).toBe('blake2b');
    expect(algorithmFromName('xxh64')).toBe('xxhash64');
    expect(algorithmFromName('nope')).toBeUndefined();
  });
});

describe('compareDigests', () => {
  it('finds the matching algorithm among candidates', async () => {
    const expected = ok(ABC_SHA256);
    const digests = await hashBlob(new Blob(['abc']), expected.candidates);
    const outcome = compareDigests(expected.bytes, digests, expected.candidates);
    expect(outcome).toMatchObject({ match: true, matchedAlgorithm: 'sha256' });
  });

  it('identifies BLAKE3 when that is the right one', async () => {
    const digests = await hashBytes('abc', candidatesForLength(32));
    const b3 = hexToBytes('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85')!;
    expect(compareDigests(b3, digests, candidatesForLength(32)).matchedAlgorithm).toBe('blake3');
  });

  it('reports a mismatch', async () => {
    const digests = await hashBytes('abd', ['sha256']);
    expect(compareDigests(hexToBytes(ABC_SHA256)!, digests, ['sha256']).match).toBe(false);
  });
});
