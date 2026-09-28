import { describe, expect, it } from 'vitest';
import { createHMAC, createSHA256 } from 'hash-wasm';
import { computeHmac, type HmacAlgorithm } from './hmac';
import { bytesToBase64, bytesToHex, decodeInput, hexToBytes, utf8 } from '../shared-a/bytes';

const fill = (byte: number, n: number) => new Uint8Array(n).fill(byte);
const seq25 = Uint8Array.from({ length: 25 }, (_, i) => i + 1);

async function hex(algo: HmacAlgorithm, key: Uint8Array, data: Uint8Array | string) {
  return bytesToHex(await computeHmac(algo, key, typeof data === 'string' ? utf8(data) : data));
}

// RFC 4231 (HMAC-SHA-256/384/512). Case 5 (truncated output) is intentionally skipped.
const RFC4231 = [
  {
    name: 'case 1',
    key: fill(0x0b, 20),
    data: 'Hi There',
    'SHA-256': 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    'SHA-384': 'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
    'SHA-512':
      '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
  },
  {
    name: 'case 2',
    key: utf8('Jefe'),
    data: 'what do ya want for nothing?',
    'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    'SHA-384': 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
    'SHA-512':
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
  },
  {
    name: 'case 3',
    key: fill(0xaa, 20),
    data: fill(0xdd, 50),
    'SHA-256': '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    'SHA-384': '88062608d3e6ad8a0aa2ace014c8a86f0aa635d947ac9febe83ef4e55966144b2a5ab39dc13814b94e3ab6e101a34f27',
    'SHA-512':
      'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb',
  },
  {
    name: 'case 4',
    key: seq25,
    data: fill(0xcd, 50),
    'SHA-256': '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    'SHA-384': '3e8a69b7783c25851933ab6290af6ca77a9981480850009cc5577c6e1f573b4e6801dd23c4a7d679ccf8a386c674cffb',
    'SHA-512':
      'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd',
  },
  {
    name: 'case 6',
    key: fill(0xaa, 131),
    data: 'Test Using Larger Than Block-Size Key - Hash Key First',
    'SHA-256': '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    'SHA-384': '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
    'SHA-512':
      '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
  },
  {
    name: 'case 7',
    key: fill(0xaa, 131),
    data: 'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
    'SHA-256': '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    'SHA-384': '6617178e941f020d351e2f254e8fd32c602420feb0b8fb9adccebb82461e99c5a678cc31e799176d3860e6110c46523e',
    'SHA-512':
      'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58',
  },
] as const;

// RFC 2202 (HMAC-SHA-1 and HMAC-MD5).
const RFC2202 = [
  { name: 'case 1', key: fill(0x0b, 20), md5Key: fill(0x0b, 16), data: 'Hi There', sha1: 'b617318655057264e28bc0b6fb378c8ef146be00', md5: '9294727a3638bb1c13f48ef8158bfc9d' },
  { name: 'case 2', key: utf8('Jefe'), md5Key: utf8('Jefe'), data: 'what do ya want for nothing?', sha1: 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79', md5: '750c783e6ab0b503eaa86e310a5db738' },
  { name: 'case 3', key: fill(0xaa, 20), md5Key: fill(0xaa, 16), data: fill(0xdd, 50), sha1: '125d7342b9ac11cd91a39af48aa17b4f63f175d3', md5: '56be34521d144c88dbb8c733f0e8b3f6' },
  { name: 'case 4', key: seq25, md5Key: seq25, data: fill(0xcd, 50), sha1: '4c9007f4026250c6bc8414f9bf50c86c2d7235da', md5: '697eaf0aca3a3aea3a75164746ffaa79' },
  { name: 'case 6', key: fill(0xaa, 80), md5Key: fill(0xaa, 80), data: 'Test Using Larger Than Block-Size Key - Hash Key First', sha1: 'aa4ae5e15272d00e95705637ce8a3b55ed402112', md5: '6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd' },
  { name: 'case 7', key: fill(0xaa, 80), md5Key: fill(0xaa, 80), data: 'Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data', sha1: 'e8e99d0f45237d786d6bbaa7965c7808bbff1a91', md5: '6f630fad67cda0ee1fb1f562db3aa53e' },
];

describe('HMAC RFC 4231', () => {
  for (const tc of RFC4231) {
    for (const algo of ['SHA-256', 'SHA-384', 'SHA-512'] as const) {
      it(`${algo} ${tc.name}`, async () => {
        expect(await hex(algo, tc.key, tc.data)).toBe(tc[algo]);
      });
    }
  }
});

describe('HMAC RFC 2202', () => {
  for (const tc of RFC2202) {
    it(`SHA-1 ${tc.name}`, async () => {
      expect(await hex('SHA-1', tc.key, tc.data)).toBe(tc.sha1);
    });
    it(`MD5 ${tc.name}`, async () => {
      expect(await hex('MD5', tc.md5Key, tc.data)).toBe(tc.md5);
    });
  }
});

describe('HMAC edge cases', () => {
  it('supports an empty key and message', async () => {
    expect(await hex('SHA-256', new Uint8Array(0), '')).toBe('b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad');
    const ref = await createHMAC(createSHA256(), new Uint8Array(0));
    ref.init();
    ref.update(utf8('message'));
    expect(await hex('SHA-256', new Uint8Array(0), 'message')).toBe(ref.digest());
    expect(await hex('MD5', new Uint8Array(0), '')).toBe('74e6f7298a9c2d168935f58c001bad88');
  });

  it('hashes Unicode messages and keys as UTF-8', async () => {
    const ref = await createHMAC(createSHA256(), utf8('clé 🔑'));
    ref.init();
    ref.update(utf8('héllo 🌍'));
    expect(await hex('SHA-256', utf8('clé 🔑'), 'héllo 🌍')).toBe(ref.digest());
  });

  it('accepts keys as hex and base64', async () => {
    const fromHex = decodeInput('4a656665', 'hex');
    const fromB64 = decodeInput('SmVmZQ==', 'base64');
    expect(fromHex.ok && fromB64.ok).toBe(true);
    if (fromHex.ok && fromB64.ok) {
      expect(await hex('SHA-256', fromHex.bytes, 'what do ya want for nothing?')).toBe(RFC4231[1]['SHA-256']);
      expect(bytesToBase64(await computeHmac('SHA-256', fromB64.bytes, utf8('what do ya want for nothing?')))).toBe(
        bytesToBase64(hexToBytes(RFC4231[1]['SHA-256'])!),
      );
    }
    const bad = decodeInput('xyz', 'hex', 'Key');
    expect(bad.ok ? '' : bad.error).toMatch(/Key is not valid hex/);
    const badB64 = decodeInput('***', 'base64', 'Key');
    expect(badB64.ok).toBe(false);
  });

  it('handles long messages', async () => {
    const long = 'a'.repeat(1_000_000);
    const ref = await createHMAC(createSHA256(), utf8('k'));
    ref.init();
    ref.update(utf8(long));
    expect(await hex('SHA-256', utf8('k'), long)).toBe(ref.digest());
  });
});
