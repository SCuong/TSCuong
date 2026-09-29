import { describe, expect, it } from 'vitest';
import { calculateJwkThumbprint } from 'jose';
import { DEFAULT_SPEC, cleanJwk, generateKeyPairFor, openSshPublicKey, planFor, supportsAlgorithm, type KeySpec } from './keygen';
import { parseSshPublicKeyLine } from '../../cert/lib/ssh';
import { pkcs8Info, spkiInfo } from '../../shared-b/keyinfo';
import { scanPem } from '../../shared-b/pem';
import { bytesToBase64Url } from '../../shared-a/bytes';
import { OPENSSH_ECDSA_AS_SPKI, OPENSSH_ECDSA_PUBLIC, OPENSSH_PUBLIC, OPENSSH_RSA_AS_SPKI, OPENSSH_RSA_PUBLIC } from '../../shared-b/testFixtures';

const spec = (over: Partial<KeySpec>): KeySpec => ({ ...DEFAULT_SPEC, ...over });
const der = (pem: string) => scanPem(pem).blocks[0].der!;

describe('planFor', () => {
  it('maps every family to Web Crypto parameters and JOSE names', () => {
    expect(planFor(spec({ family: 'RSA', rsaScheme: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384', rsaSize: 3072 }))).toMatchObject({
      params: { name: 'RSASSA-PKCS1-v1_5', modulusLength: 3072, hash: 'SHA-384' },
      jwsAlg: 'RS384',
      use: 'sig',
    });
    expect(planFor(spec({ family: 'RSA', rsaScheme: 'RSA-PSS', hash: 'SHA-512' })).jwsAlg).toBe('PS512');
    const oaep = planFor(spec({ family: 'RSA', rsaScheme: 'RSA-OAEP', hash: 'SHA-256' }));
    expect(oaep).toMatchObject({ jwkAlg: 'RSA-OAEP-256', use: 'enc' });
    expect(oaep.jwsAlg).toBeUndefined();
    expect(oaep.usages).toContain('encrypt');
    expect(planFor(spec({ family: 'ECDSA', curve: 'P-521' })).jwsAlg).toBe('ES512');
    expect(planFor(spec({ family: 'ECDH', curve: 'P-384' }))).toMatchObject({ params: { name: 'ECDH', namedCurve: 'P-384' }, use: 'enc' });
    expect(planFor(spec({ family: 'Ed25519' })).jwsAlg).toBe('EdDSA');
    expect(planFor(spec({ family: 'X25519' })).usages).toEqual(['deriveKey', 'deriveBits']);
  });
});

describe('cleanJwk', () => {
  it('orders members, adds kid/use/alg and drops Web Crypto internals', () => {
    const out = cleanJwk({ y: 'Y', x: 'X', crv: 'P-256', kty: 'EC', key_ops: ['verify'], ext: true }, { kid: 'k', use: 'sig', alg: 'ES256' });
    expect(Object.keys(out)).toEqual(['kty', 'crv', 'kid', 'use', 'alg', 'x', 'y']);
    expect(cleanJwk({ kty: 'EC' }, { alg: undefined })).toEqual({ kty: 'EC' });
  });
});

describe('openSshPublicKey', () => {
  async function jwkOf(spkiPem: string, algorithm: RsaHashedImportParams | EcKeyImportParams) {
    const key = await crypto.subtle.importKey('spki', new Uint8Array(der(spkiPem)), algorithm, true, ['verify']);
    return crypto.subtle.exportKey('jwk', key);
  }

  it('matches ssh-keygen for RSA and ECDSA keys', async () => {
    const rsa = await jwkOf(OPENSSH_RSA_AS_SPKI, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });
    expect(openSshPublicKey(rsa, 'rsa@localkit')).toBe(OPENSSH_RSA_PUBLIC.trim());
    const ec = await jwkOf(OPENSSH_ECDSA_AS_SPKI, { name: 'ECDSA', namedCurve: 'P-256' });
    expect(openSshPublicKey(ec)).toBe(OPENSSH_ECDSA_PUBLIC.trim());
  });

  it('matches ssh-keygen for Ed25519 keys', () => {
    const parsed = parseSshPublicKeyLine(OPENSSH_PUBLIC)!;
    const x = parsed.blob.subarray(parsed.blob.length - 32);
    expect(openSshPublicKey({ kty: 'OKP', crv: 'Ed25519', x: bytesToBase64Url(x) }, 'test@localkit')).toBe(OPENSSH_PUBLIC.trim());
  });

  it('returns null for keys SSH cannot use', () => {
    expect(openSshPublicKey({ kty: 'OKP', crv: 'X25519', x: 'AAAA' })).toBeNull();
    expect(openSshPublicKey({ kty: 'EC', crv: 'secp256k1', x: 'AA', y: 'AA' })).toBeNull();
    expect(() => openSshPublicKey({ kty: 'RSA', n: '%%%', e: 'AQAB' })).toThrow();
  });
});

describe('generateKeyPairFor', () => {
  it('generates an RSA key with every export format', async () => {
    const pair = await generateKeyPairFor(spec({ family: 'RSA', rsaScheme: 'RSASSA-PKCS1-v1_5', rsaSize: 2048 }));
    expect(spkiInfo(der(pair.publicPem)).label).toBe('RSA 2048-bit');
    expect(pkcs8Info(der(pair.privatePem)).label).toBe('RSA 2048-bit');
    expect(pair.publicJwk).toMatchObject({ kty: 'RSA', kid: pair.thumbprint, use: 'sig', alg: 'RS256', e: 'AQAB' });
    expect(pair.publicJwk.d).toBeUndefined();
    expect(pair.privateJwk.d).toBeTypeOf('string');
    expect(pair.thumbprint).toBe(await calculateJwkThumbprint(pair.publicJwk as Parameters<typeof calculateJwkThumbprint>[0]));
    expect(pair.openssh).toMatch(/^ssh-rsa AAAAB3NzaC1yc2E/);
    expect(parseSshPublicKeyLine(pair.openssh!)?.label).toBe('RSA 2048-bit');
    expect(pair.spkiPin).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(pair.ms).toBeGreaterThanOrEqual(0);
  });

  it.each(['P-256', 'P-384', 'P-521'] as const)('generates ECDSA %s keys that sign and verify', async (curve) => {
    const pair = await generateKeyPairFor(spec({ family: 'ECDSA', curve }));
    expect(spkiInfo(der(pair.publicPem)).curve).toBe(curve);
    expect(parseSshPublicKeyLine(pair.openssh!)?.label).toBe(`ECDSA ${curve}`);
    const priv = await crypto.subtle.importKey('pkcs8', new Uint8Array(der(pair.privatePem)), { name: 'ECDSA', namedCurve: curve }, false, ['sign']);
    const pub = await crypto.subtle.importKey('jwk', pair.publicJwk as JsonWebKey, { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
    const data = new TextEncoder().encode('hello');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data)).toBe(true);
  });

  it('generates key agreement and encryption keys without SSH output', async () => {
    const ecdh = await generateKeyPairFor(spec({ family: 'ECDH', curve: 'P-256' }));
    expect(ecdh.openssh).toBeNull();
    expect(ecdh.publicJwk).toMatchObject({ kty: 'EC', use: 'enc' });
    expect(ecdh.publicJwk.alg).toBeUndefined();
    const oaep = await generateKeyPairFor(spec({ family: 'RSA', rsaScheme: 'RSA-OAEP', rsaSize: 2048 }));
    expect(oaep.publicJwk).toMatchObject({ alg: 'RSA-OAEP-256', use: 'enc' });
    expect(oaep.openssh).toBeNull();
  });

  it('generates Ed25519 and X25519 keys when supported', async () => {
    if (await supportsAlgorithm('Ed25519')) {
      const ed = await generateKeyPairFor(spec({ family: 'Ed25519' }));
      expect(spkiInfo(der(ed.publicPem)).label).toBe('Ed25519');
      expect(ed.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' });
      expect(parseSshPublicKeyLine(ed.openssh!)?.type).toBe('ssh-ed25519');
    }
    if (await supportsAlgorithm('X25519')) {
      const x = await generateKeyPairFor(spec({ family: 'X25519' }));
      expect(spkiInfo(der(x.publicPem)).label).toBe('X25519');
      expect(x.openssh).toBeNull();
    }
    expect(typeof (await supportsAlgorithm('Ed25519'))).toBe('boolean');
  });
});
