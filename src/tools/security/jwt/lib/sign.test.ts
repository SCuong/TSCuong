import { describe, expect, it } from 'vitest';
import { decodeToken, type DecodedJws } from './decode';
import { parseKeyText, type KeyMaterial } from './keys';
import { verifyJws } from './verify';
import { derivePublicKeyPem, generateTestKeyPair, parseJsonObject, randomSecretBytes, setMember, signJwt, signingKeyProblem } from './sign';
import { jwsAlgorithm } from './algorithms';
import { utf8 } from '../../shared-a/bytes';
import * as F from '../../shared-b/testFixtures';

function material(text: string): KeyMaterial {
  const r = parseKeyText(text);
  if (!r?.ok) throw new Error(r ? r.error : 'empty');
  return r.material;
}

function decoded(token: string): DecodedJws {
  const r = decodeToken(token);
  if (!r?.ok || r.value.kind !== 'jws') throw new Error('bad token');
  return r.value;
}

const header = { typ: 'JWT' };
const payload = { sub: 'user-1', name: 'Zoë 😀', iat: 1_800_000_000 };

describe('parseJsonObject / setMember', () => {
  it('accepts objects and explains everything else', () => {
    expect(parseJsonObject('{"a":1}', 'payload')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonObject('', 'payload')).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
    expect(parseJsonObject('[1]', 'payload')).toMatchObject({ ok: false, error: expect.stringMatching(/not an array/) });
    expect(parseJsonObject('null', 'header')).toMatchObject({ ok: false, error: expect.stringMatching(/not null/) });
    expect(parseJsonObject('"x"', 'header')).toMatchObject({ ok: false, error: expect.stringMatching(/not a string/) });
    expect(parseJsonObject('{a:1}', 'payload')).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) });
  });

  it('sets and removes members', () => {
    expect(setMember('{"a":1}', 'exp', 5)).toBe('{\n  "a": 1,\n  "exp": 5\n}');
    expect(setMember('{"a":1,"exp":5}', 'exp', undefined)).toBe('{\n  "a": 1\n}');
    expect(() => setMember('nope', 'a', 1)).toThrow(/not valid JSON/);
  });
});

describe('signJwt', () => {
  it('signs HS256/384/512 tokens that verify with the same secret', async () => {
    for (const alg of ['HS256', 'HS384', 'HS512']) {
      const secret = randomSecretBytes(alg);
      expect(secret.length).toBe(jwsAlgorithm(alg)!.minSecretBytes);
      const token = await signJwt(header, payload, alg, { kind: 'secret', bytes: secret });
      const d = decoded(token);
      expect(d.header).toEqual({ typ: 'JWT', alg });
      expect(d.payload.kind === 'claims' && d.payload.claims).toEqual(payload);
      expect((await verifyJws(d, { kind: 'secret', bytes: secret })).status).toBe('verified');
    }
  });

  it('forces the selected alg over one written in the header', async () => {
    const token = await signJwt({ alg: 'none', typ: 'JWT' }, payload, 'HS256', { kind: 'secret', bytes: utf8('a'.repeat(32)) });
    expect(decoded(token).alg).toBe('HS256');
  });

  it.each(['RS256', 'PS384', 'ES256', 'ES384', 'ES512', 'EdDSA'])('signs %s with a generated key pair that verifies', async (alg) => {
    const pair = await generateTestKeyPair(alg);
    expect(pair.privatePem).toMatch(/BEGIN PRIVATE KEY/);
    expect(pair.publicPem).toMatch(/BEGIN PUBLIC KEY/);
    const token = await signJwt(header, payload, alg, { kind: 'material', material: material(pair.privatePem) });
    const out = await verifyJws(decoded(token), { kind: 'material', material: material(pair.publicPem) });
    expect(out.status).toBe('verified');
    expect(await derivePublicKeyPem(material(pair.privatePem), alg)).toBe(pair.publicPem);
  });

  it('signs with PKCS#1, SEC1 and JWK private keys', async () => {
    const rs = await signJwt(header, payload, 'RS256', { kind: 'material', material: material(F.RSA_PKCS1_PRIVATE) });
    expect((await verifyJws(decoded(rs), { kind: 'material', material: material(F.INTERMEDIATE_CA) })).status).toBe('verified');
    const es = await signJwt(header, payload, 'ES256', { kind: 'material', material: material(F.EC_SEC1_PRIVATE) });
    expect((await verifyJws(decoded(es), { kind: 'material', material: material(F.LEAF_CERT) })).status).toBe('verified');
    const pair = await generateTestKeyPair('ES384');
    const { exportJWK, importPKCS8 } = await import('jose');
    const jwk = await exportJWK(await importPKCS8(pair.privatePem, 'ES384', { extractable: true }));
    const token = await signJwt(header, payload, 'ES384', { kind: 'material', material: material(JSON.stringify({ ...jwk, key_ops: ['sign'] })) });
    expect((await verifyJws(decoded(token), { kind: 'material', material: material(pair.publicPem) })).status).toBe('verified');
    expect(await derivePublicKeyPem(material(JSON.stringify(jwk)), 'ES384')).toBe(pair.publicPem);
  });

  it('explains unusable keys', async () => {
    const sign = (alg: string, text: string) => signJwt(header, payload, alg, { kind: 'material', material: material(text) });
    await expect(sign('RS256', F.RSA_SPKI)).rejects.toThrow(/public key. Signing needs the matching private key/);
    await expect(sign('RS256', F.INTERMEDIATE_CA)).rejects.toThrow(/certificate/);
    await expect(sign('ES256', F.RSA_PKCS8_PRIVATE)).rejects.toThrow(/needs an EC P-256 key/);
    await expect(sign('ES384', F.EC_PKCS8_PRIVATE)).rejects.toThrow(/needs a P-384 key/);
    await expect(sign('ES256', JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }))).rejects.toThrow(/public/);
    await expect(sign('RS256', JSON.stringify({ keys: [{ kty: 'RSA' }] }))).rejects.toThrow(/JWK Set/);
    await expect(signJwt(header, payload, 'HS256', { kind: 'secret', bytes: new Uint8Array() })).rejects.toThrow(/Enter a secret/);
    await expect(signJwt(header, payload, 'RS256', { kind: 'secret', bytes: utf8('x') })).rejects.toThrow(/private key, not a shared secret/);
    await expect(signJwt(header, payload, 'HS256', { kind: 'material', material: material(F.RSA_PKCS8_PRIVATE) })).rejects.toThrow(/shared secret/);
    await expect(signJwt(header, payload, 'none', { kind: 'secret', bytes: utf8('x') })).rejects.toThrow(/not a supported/);
  });

  it('reports problems without throwing through signingKeyProblem', () => {
    const rs256 = jwsAlgorithm('RS256')!;
    expect(signingKeyProblem(material(F.RSA_PKCS8_PRIVATE), rs256)).toBeNull();
    expect(signingKeyProblem(material(F.RSA_SPKI), rs256)).toMatch(/public key/);
  });

  it('does not derive public keys for HMAC or public inputs', async () => {
    expect(await derivePublicKeyPem(material(F.RSA_PKCS8_PRIVATE), 'HS256')).toBeNull();
    expect(await derivePublicKeyPem(material(F.RSA_SPKI), 'RS256')).toBeNull();
  });
});
