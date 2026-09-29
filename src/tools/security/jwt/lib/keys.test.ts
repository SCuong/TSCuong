import { describe, expect, it } from 'vitest';
import { isPrivateJwk, jwkInfo, jwkRestriction, keyMismatch, parseKeyText, publicJwk, type KeyMaterial } from './keys';
import { jwsAlgorithm } from './algorithms';
import * as F from '../../shared-b/testFixtures';

function material(text: string): KeyMaterial {
  const r = parseKeyText(text);
  if (!r || !r.ok) throw new Error(r ? r.error : 'empty');
  return r.material;
}

function error(text: string): string {
  const r = parseKeyText(text);
  if (!r || r.ok) throw new Error('expected an error');
  return r.error;
}

describe('parseKeyText', () => {
  it('returns null for empty input', () => {
    expect(parseKeyText('')).toBeNull();
    expect(parseKeyText('  \n')).toBeNull();
  });

  it('reads SPKI public keys of every type', () => {
    expect(material(F.RSA_SPKI)).toMatchObject({ format: 'spki', info: { label: 'RSA 2048-bit' } });
    expect(material(F.EC_SPKI)).toMatchObject({ format: 'spki', info: { curve: 'P-256' } });
    expect(material(F.ED25519_SPKI)).toMatchObject({ format: 'spki', info: { algorithm: 'Ed25519' } });
  });

  it('converts PKCS#1 public and private keys', () => {
    const pub = parseKeyText(F.RSA_PKCS1_PUBLIC);
    expect(pub?.ok && pub.material.format).toBe('spki');
    expect(pub?.ok && pub.notes[0]).toMatch(/PKCS#1/);
    const m = material(F.RSA_PKCS1_PUBLIC);
    expect(m.format === 'spki' && m.pem).toBe(F.RSA_SPKI.replace(/\r/g, ''));
    const priv = material(F.RSA_PKCS1_PRIVATE);
    expect(priv.format === 'pkcs8' && priv.pem).toBe(F.RSA_PKCS8_PRIVATE);
  });

  it('converts SEC1 EC private keys and skips EC PARAMETERS blocks', () => {
    const withParams = `-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----\n${F.EC_SEC1_PRIVATE}`;
    const r = parseKeyText(withParams);
    expect(r?.ok && r.material).toMatchObject({ format: 'pkcs8', info: { curve: 'P-256' } });
    expect(r?.ok && r.notes.join()).toMatch(/SEC1/);
  });

  it('reads certificates and uses the first of a chain', () => {
    const r = parseKeyText(`${F.LEAF_CERT}${F.INTERMEDIATE_CA}`);
    expect(r?.ok && r.material).toMatchObject({ format: 'certificate', info: { label: 'EC P-256' } });
    expect(r?.ok && r.notes[0]).toMatch(/first of 2 certificates/);
  });

  it('accepts bare Base64 DER', () => {
    const body = F.EC_SPKI.replace(/-----[^-]+-----/g, '').trim();
    const r = parseKeyText(body);
    expect(r?.ok && r.material.format).toBe('spki');
    expect(r?.ok && r.notes[0]).toMatch(/Base64-encoded DER/);
  });

  it('reads JWKs and JWK Sets', () => {
    const jwk = { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', kid: 'k1' };
    expect(material(JSON.stringify(jwk))).toMatchObject({ format: 'jwk', isPrivate: false, info: { label: 'EC P-256' } });
    expect(material(JSON.stringify({ ...jwk, d: 'secret' }))).toMatchObject({ format: 'jwk', isPrivate: true });
    const set = material(JSON.stringify({ keys: [jwk, { kty: 'RSA', n: 'AQAB', e: 'AQAB' }] }));
    expect(set.format === 'jwks' && set.keys).toHaveLength(2);
    expect(material(JSON.stringify([jwk])).format).toBe('jwks');
  });

  it('explains unusable input', () => {
    expect(error('{"kty": ')).toMatch(/does not parse/);
    expect(error('{"foo": 1}')).toMatch(/neither a JWK/);
    expect(error('{"keys": []}')).toMatch(/no keys/);
    expect(error(F.EC_ENCRYPTED_PKCS8)).toMatch(/encrypted with a passphrase \(PBES2 · PBKDF2 · AES-256-CBC\)/);
    expect(error(F.RSA_LEGACY_ENCRYPTED)).toMatch(/legacy PEM encryption/);
    expect(error(F.OPENSSH_PRIVATE)).toMatch(/OpenSSH-format private key/);
    expect(error(F.OPENSSH_PUBLIC)).toMatch(/OpenSSH public key/);
    expect(error(F.UTF8_CSR)).toMatch(/certificate signing request/);
    expect(error(F.ROOT_CRL)).toMatch(/revocation list/);
    expect(error('just some words')).toMatch(/Paste a PEM public key/);
    expect(error('-----BEGIN PUBLIC KEY-----\nMII\n')).toMatch(/no matching/);
    expect(error('-----BEGIN PUBLIC KEY-----\nMII%\n-----END PUBLIC KEY-----')).toMatch(/damaged/);
    expect(error('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----')).toMatch(/not valid DER/);
  });
});

describe('key compatibility', () => {
  const alg = (name: string) => jwsAlgorithm(name)!;
  const info = (text: string) => {
    const m = material(text);
    if (m.format === 'jwks') throw new Error('set');
    return m.info;
  };

  it('accepts matching keys', () => {
    expect(keyMismatch(alg('RS256'), info(F.RSA_SPKI))).toBeNull();
    expect(keyMismatch(alg('PS512'), info(F.RSA_SPKI))).toBeNull();
    expect(keyMismatch(alg('ES256'), info(F.EC_SPKI))).toBeNull();
    expect(keyMismatch(alg('EdDSA'), info(F.ED25519_SPKI))).toBeNull();
    expect(keyMismatch(alg('ES384'), info(F.ROOT_CA))).toBeNull();
  });

  it('explains mismatches precisely', () => {
    expect(keyMismatch(alg('ES384'), info(F.EC_SPKI))).toMatch(/needs a P-384 key, but this key uses P-256\. Use ES256\./);
    expect(keyMismatch(alg('RS256'), info(F.EC_SPKI))).toMatch(/needs an RSA key, but this is an EC P-256 key/);
    expect(keyMismatch(alg('ES256'), info(F.RSA_SPKI))).toMatch(/needs an EC P-256 key/);
    expect(keyMismatch(alg('EdDSA'), info(F.RSA_SPKI))).toMatch(/needs an Ed25519 key/);
    expect(keyMismatch(alg('HS256'), info(F.RSA_SPKI))).toMatch(/shared secret/);
    expect(keyMismatch(alg('RS256'), info(F.RSA_1024_SPKI))).toMatch(/only 1024 bits/);
  });

  it('honours JWK restrictions', () => {
    expect(jwkRestriction({ kty: 'RSA', use: 'enc' }, 'RS256')).toMatch(/encryption/);
    expect(jwkRestriction({ kty: 'RSA', alg: 'RS512' }, 'RS256')).toMatch(/restricted to “RS512”/);
    expect(jwkRestriction({ kty: 'oct', k: 'AA' }, 'RS256')).toMatch(/symmetric/);
    expect(jwkRestriction({ kty: 'RSA', alg: 'RS256', use: 'sig' }, 'RS256')).toBeNull();
  });
});

describe('JWK helpers', () => {
  it('describes keys and strips private members', () => {
    expect(jwkInfo({ kty: 'RSA', n: 'AQAB' }).label).toBe('RSA 17-bit');
    expect(jwkInfo({ kty: 'OKP', crv: 'Ed25519' }).label).toBe('Ed25519');
    expect(jwkInfo({ kty: 'oct', k: 'AAAA' }).label).toBe('Symmetric 24-bit secret');
    expect(jwkInfo({ kty: 'oct' }).label).toBe('Symmetric secret');
    expect(jwkInfo({ kty: 'EC' }).label).toBe('EC (no curve)');
    expect(isPrivateJwk({ kty: 'EC', d: 'x' })).toBe(true);
    expect(isPrivateJwk({ kty: 'EC' })).toBe(false);
    expect(publicJwk({ kty: 'RSA', n: 'n', e: 'e', d: 'd', p: 'p', key_ops: ['sign'], ext: true, kid: '1' })).toEqual({ kty: 'RSA', n: 'n', e: 'e', kid: '1' });
  });
});
