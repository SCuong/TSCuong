import { describe, expect, it } from 'vitest';
import { formatDigest, getAlgorithm, hashBlob, hashBytes, hashHex, HASH_ALGORITHMS, type HashAlgorithmId } from './hash';
import { bytesToHex } from '../shared-a/bytes';

const VECTORS: Record<HashAlgorithmId, { empty: string; abc: string }> = {
  md5: { empty: 'd41d8cd98f00b204e9800998ecf8427e', abc: '900150983cd24fb0d6963f7d28e17f72' },
  sha1: { empty: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', abc: 'a9993e364706816aba3e25717850c26c9cd0d89d' },
  sha224: {
    empty: 'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
    abc: '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7',
  },
  sha256: {
    empty: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    abc: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  sha384: {
    empty: '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
    abc: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
  },
  sha512: {
    empty:
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    abc: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  },
  'sha3-224': {
    empty: '6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7',
    abc: 'e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf',
  },
  'sha3-256': {
    empty: 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    abc: '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
  },
  'sha3-384': {
    empty: '0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004',
    abc: 'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25',
  },
  'sha3-512': {
    empty:
      'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
    abc: 'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0',
  },
  keccak256: {
    empty: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    abc: '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  },
  blake2b: {
    empty:
      '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce',
    abc: 'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  },
  blake2s: {
    empty: '69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9',
    abc: '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982',
  },
  blake3: {
    empty: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
    abc: '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85',
  },
  ripemd160: { empty: '9c1185a5c5e9fc54612808977ee8f548b2258d31', abc: '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc' },
  crc32: { empty: '00000000', abc: '352441c2' },
  xxhash64: { empty: 'ef46db3751d8e999', abc: '44bc2cf5ad770999' },
};

describe('hash algorithms', () => {
  it('covers every algorithm with vectors', () => {
    expect(Object.keys(VECTORS).sort()).toEqual(HASH_ALGORITHMS.map((a) => a.id).sort());
  });

  for (const algo of HASH_ALGORITHMS) {
    it(`${algo.label} matches known vectors`, async () => {
      expect(await hashHex('', algo.id)).toBe(VECTORS[algo.id].empty);
      expect(await hashHex('abc', algo.id)).toBe(VECTORS[algo.id].abc);
      expect(VECTORS[algo.id].abc.length).toBe(algo.bytes * 2);
    });
  }

  it('computes all algorithms in one call', async () => {
    const ids = HASH_ALGORITHMS.map((a) => a.id);
    const map = await hashBytes('abc', ids);
    for (const id of ids) expect(bytesToHex(map[id]!)).toBe(VECTORS[id].abc);
  });

  it('hashes the classic pangram', async () => {
    expect(await hashHex('The quick brown fox jumps over the lazy dog', 'crc32')).toBe('414fa339');
    expect(await hashHex('The quick brown fox jumps over the lazy dog', 'md5')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('hashes Unicode as UTF-8', async () => {
    // printf '😀' | sha256sum
    expect(await hashHex('😀', 'sha256')).toBe('f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9');
    expect(await hashHex('héllo', 'md5')).toBe(await hashHex(new TextEncoder().encode('héllo'), 'md5'));
  });

  it('marks broken algorithms', () => {
    expect(getAlgorithm('md5').note).toMatch(/not for security/);
    expect(getAlgorithm('sha1').note).toMatch(/not for security/);
    expect(getAlgorithm('sha256').note).toBeUndefined();
  });
});

describe('formatDigest', () => {
  const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  it('formats hex, upper hex and base64', () => {
    expect(formatDigest(bytes, 'hex')).toBe('deadbeef');
    expect(formatDigest(bytes, 'HEX')).toBe('DEADBEEF');
    expect(formatDigest(bytes, 'base64')).toBe('3q2+7w==');
  });
});

describe('hashBlob (streaming)', () => {
  it('matches one-shot hashing across chunk boundaries', async () => {
    const data = new Uint8Array(100_003);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    const ids: HashAlgorithmId[] = ['sha256', 'blake3', 'md5', 'crc32', 'xxhash64'];
    const oneShot = await hashBytes(data, ids);
    const progress: number[] = [];
    const streamed = await hashBlob(new Blob([data]), ids, { chunkSize: 4096, onProgress: (f) => progress.push(f) });
    for (const id of ids) expect(bytesToHex(streamed[id]!)).toBe(bytesToHex(oneShot[id]!));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThan(20);
  });

  it('hashes an empty file', async () => {
    const map = await hashBlob(new Blob([]), ['sha256']);
    expect(bytesToHex(map.sha256!)).toBe(VECTORS.sha256.empty);
  });

  it('can be cancelled', async () => {
    const ctrl = new AbortController();
    const blob = new Blob([new Uint8Array(50_000)]);
    const promise = hashBlob(blob, ['sha256'], {
      chunkSize: 1000,
      signal: ctrl.signal,
      onProgress: (f) => {
        if (f > 0.2) ctrl.abort();
      },
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
