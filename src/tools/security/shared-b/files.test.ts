import { describe, expect, it } from 'vitest';
import { bytesToKeyText, readKeyFile } from './files';
import { scanPem } from './pem';
import { EC_SPKI, LEAF_CERT } from './testFixtures';

const derOf = (pem: string) => scanPem(pem).blocks[0].der!;

describe('bytesToKeyText', () => {
  it('returns PEM and JSON text unchanged', () => {
    const pem = new TextEncoder().encode(LEAF_CERT);
    expect(bytesToKeyText(pem)).toEqual({ text: LEAF_CERT, converted: false });
    expect(bytesToKeyText(new TextEncoder().encode('{"kty":"EC"}')).text).toBe('{"kty":"EC"}');
  });

  it('converts binary DER to PEM with a label guessed from its structure', () => {
    const cert = bytesToKeyText(derOf(LEAF_CERT));
    expect(cert.converted).toBe(true);
    expect(cert.text.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    expect(cert.text).toBe(LEAF_CERT);
    expect(bytesToKeyText(derOf(EC_SPKI)).text).toBe(EC_SPKI);
  });

  it('shows unknown binary as Base64 and handles empty files', () => {
    expect(bytesToKeyText(Uint8Array.of(0xff, 0x00, 0x01)).text).toBe('/wAB');
    expect(bytesToKeyText(new Uint8Array())).toEqual({ text: '', converted: false });
    const unknownDer = bytesToKeyText(Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00));
    expect(unknownDer.text).toMatch(/BEGIN UNKNOWN DER DATA/);
  });
});

describe('readKeyFile', () => {
  it('reads files and rejects huge ones', async () => {
    const file = new File([derOf(LEAF_CERT) as BlobPart], 'leaf.der');
    expect((await readKeyFile(file)).text).toBe(LEAF_CERT);
    const huge = { size: 6 * 1024 * 1024 } as File;
    await expect(readKeyFile(huge)).rejects.toThrow(/6 MB/);
  });
});
