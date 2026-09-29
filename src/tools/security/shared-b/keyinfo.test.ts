import { describe, expect, it } from 'vitest';
import { parseDer } from './der';
import {
  classifyDer,
  embeddedSpki,
  encryptedPkcs8Scheme,
  isPrivateKind,
  pkcs1PrivateInfo,
  pkcs1PrivateToPkcs8,
  pkcs1PublicInfo,
  pkcs1PublicToSpki,
  pkcs8Info,
  publicSpkiFromPkcs8,
  sec1Info,
  sec1ToPkcs8,
  spkiInfo,
  spkiInfoFromAsn1,
} from './keyinfo';
import { scanPem } from './pem';
import * as F from './testFixtures';

const der = (pem: string) => scanPem(pem).blocks[0].der!;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('classifyDer', () => {
  it.each([
    ['ROOT_CA', 'certificate'],
    ['LEAF_CERT', 'certificate'],
    ['ED25519_CERT', 'certificate'],
    ['UTF8_CSR', 'csr'],
    ['LEAF_CSR', 'csr'],
    ['ROOT_CRL', 'crl'],
    ['PKCS7_CHAIN', 'pkcs7'],
    ['RSA_SPKI', 'spki'],
    ['EC_SPKI', 'spki'],
    ['ED25519_SPKI', 'spki'],
    ['RSA_PKCS1_PUBLIC', 'pkcs1-public'],
    ['RSA_PKCS8_PRIVATE', 'pkcs8'],
    ['EC_PKCS8_PRIVATE', 'pkcs8'],
    ['ED25519_PKCS8_PRIVATE', 'pkcs8'],
    ['RSA_PKCS1_PRIVATE', 'pkcs1-private'],
    ['EC_SEC1_PRIVATE', 'sec1-private'],
    ['EC_ENCRYPTED_PKCS8', 'encrypted-pkcs8'],
  ] as const)('%s is %s', (name, kind) => {
    expect(classifyDer(der(F[name]))).toBe(kind);
  });

  it('returns unknown for garbage and non-sequences', () => {
    expect(classifyDer(new TextEncoder().encode('not der'))).toBe('unknown');
    expect(classifyDer(Uint8Array.of(0x05, 0x00))).toBe('unknown');
    expect(classifyDer(Uint8Array.of(0x30, 0x00))).toBe('unknown');
  });

  it('knows which kinds are private', () => {
    expect(isPrivateKind('pkcs8')).toBe(true);
    expect(isPrivateKind('sec1-private')).toBe(true);
    expect(isPrivateKind('spki')).toBe(false);
    expect(isPrivateKind('certificate')).toBe(false);
  });
});

describe('key metadata', () => {
  it('reads RSA sizes from every RSA encoding', () => {
    expect(spkiInfo(der(F.RSA_SPKI)).label).toBe('RSA 2048-bit');
    expect(pkcs1PublicInfo(der(F.RSA_PKCS1_PUBLIC)).bits).toBe(2048);
    expect(pkcs1PrivateInfo(der(F.RSA_PKCS1_PRIVATE)).bits).toBe(2048);
    expect(pkcs8Info(der(F.RSA_PKCS8_PRIVATE)).label).toBe('RSA 2048-bit');
    expect(spkiInfo(der(F.RSA_1024_SPKI)).bits).toBe(1024);
  });

  it('reads EC curves and Ed25519', () => {
    const ec = spkiInfo(der(F.EC_SPKI));
    expect(ec).toMatchObject({ algorithm: 'EC', curve: 'P-256', webCryptoCurve: 'P-256', label: 'EC P-256' });
    expect(pkcs8Info(der(F.EC_PKCS8_PRIVATE)).curve).toBe('P-256');
    expect(sec1Info(der(F.EC_SEC1_PRIVATE)).curve).toBe('P-256');
    expect(spkiInfo(der(F.ED25519_SPKI)).label).toBe('Ed25519');
    expect(pkcs8Info(der(F.ED25519_PKCS8_PRIVATE)).algorithm).toBe('Ed25519');
  });

  it('finds the public key inside certificates and CSRs', () => {
    const root = embeddedSpki(parseDer(der(F.ROOT_CA)));
    expect(spkiInfoFromAsn1(root!).label).toBe('EC P-384');
    const inter = embeddedSpki(parseDer(der(F.INTERMEDIATE_CA)));
    expect(spkiInfoFromAsn1(inter!).label).toBe('RSA 2048-bit');
    const csr = embeddedSpki(parseDer(der(F.UTF8_CSR)));
    expect(spkiInfoFromAsn1(csr!).algorithm).toBe('RSA');
    expect(embeddedSpki(parseDer(der(F.RSA_SPKI)))).toBeNull();
  });

  it('describes encrypted PKCS#8 without decrypting', () => {
    expect(encryptedPkcs8Scheme(der(F.EC_ENCRYPTED_PKCS8))).toBe('PBES2 · PBKDF2 · AES-256-CBC');
    expect(encryptedPkcs8Scheme(Uint8Array.of(1, 2, 3))).toBe('unknown scheme');
  });
});

describe('conversions', () => {
  it('wraps PKCS#1 public keys into the same SPKI OpenSSL produces', () => {
    expect(same(pkcs1PublicToSpki(der(F.RSA_PKCS1_PUBLIC)), der(F.RSA_SPKI))).toBe(true);
    expect(() => pkcs1PublicToSpki(der(F.EC_SPKI))).toThrow(/not a PKCS#1/);
  });

  it('wraps PKCS#1 private keys into the same PKCS#8 OpenSSL produces', () => {
    expect(same(pkcs1PrivateToPkcs8(der(F.RSA_PKCS1_PRIVATE)), der(F.RSA_PKCS8_PRIVATE))).toBe(true);
  });

  it('wraps SEC1 keys into PKCS#8 that keeps the curve', () => {
    const p8 = sec1ToPkcs8(der(F.EC_SEC1_PRIVATE));
    expect(classifyDer(p8)).toBe('pkcs8');
    expect(pkcs8Info(p8).curve).toBe('P-256');
    expect(() => sec1ToPkcs8(der(F.RSA_PKCS1_PRIVATE))).toThrow(/not a SEC1/);
  });

  it('derives the public key of RSA and EC private keys', () => {
    expect(same(publicSpkiFromPkcs8(der(F.RSA_PKCS8_PRIVATE))!, der(F.RSA_SPKI))).toBe(true);
    expect(same(publicSpkiFromPkcs8(der(F.EC_PKCS8_PRIVATE))!, der(F.EC_SPKI))).toBe(true);
    // OpenSSL's Ed25519 PKCS#8 has no embedded public key.
    expect(publicSpkiFromPkcs8(der(F.ED25519_PKCS8_PRIVATE))).toBeNull();
    expect(publicSpkiFromPkcs8(Uint8Array.of(0x30, 0x00))).toBeNull();
  });

  it('works with keys that Web Crypto generates', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    expect(spkiInfo(spki).label).toBe('EC P-384');
    expect(pkcs8Info(pkcs8).curve).toBe('P-384');
    const derived = publicSpkiFromPkcs8(pkcs8);
    if (derived) expect(same(derived, spki)).toBe(true);
  });
});
