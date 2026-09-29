import { describe, expect, it } from 'vitest';
import { CompactSign, exportJWK, generateKeyPair, importPKCS8 } from 'jose';
import { decodeToken, type DecodedJws } from './decode';
import { parseKeyText, type KeyMaterial } from './keys';
import { jwksCandidates, verifyJws, type VerifyKey } from './verify';
import { jwsAlgorithm } from './algorithms';
import { analyzeBase64Url, encodeBase64UrlText } from './base64url';
import { utf8 as encodeUtf8 } from '../../shared-a/bytes';
import * as F from '../../shared-b/testFixtures';

/** Copy into this realm's Uint8Array: jsdom's TextEncoder returns arrays from another realm, which jose rejects. */
const utf8 = (text: string) => new Uint8Array(encodeUtf8(text));

const JWT_IO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const RFC7515_A1 =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7515_KEY = 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow';

function decoded(token: string): DecodedJws {
  const r = decodeToken(token);
  if (!r?.ok || r.value.kind !== 'jws') throw new Error('bad token');
  return r.value;
}

function keyOf(text: string): VerifyKey {
  const r = parseKeyText(text);
  if (!r?.ok) throw new Error(r ? r.error : 'empty');
  return { kind: 'material', material: r.material };
}

const secret = (text: string): VerifyKey => ({ kind: 'secret', bytes: utf8(text) });

async function sign(alg: string, privatePem: string, payload: object = { sub: 'test', iat: 1_800_000_000 }, header: object = {}) {
  const key = await importPKCS8(privatePem, alg);
  return new CompactSign(utf8(JSON.stringify(payload))).setProtectedHeader({ alg, ...header }).sign(key);
}

describe('HMAC', () => {
  it('verifies the jwt.io example and warns about its short secret', async () => {
    const out = await verifyJws(decoded(JWT_IO), secret('your-256-bit-secret'));
    expect(out.status).toBe('verified');
    expect(out.notes[0]).toMatch(/19 bytes; RFC 7518 requires at least 32 bytes/);
  });

  it('rejects a wrong secret and a tampered payload', async () => {
    expect((await verifyJws(decoded(JWT_IO), secret('wrong'))).status).toBe('invalid');
    const [h, , s] = JWT_IO.split('.');
    const tampered = `${h}.${encodeBase64UrlText('{"sub":"1234567890","name":"John Doe","admin":true}')}.${s}`;
    expect((await verifyJws(decoded(tampered), secret('your-256-bit-secret'))).status).toBe('invalid');
  });

  it('verifies RFC 7515 A.1 with a Base64URL key', async () => {
    const out = await verifyJws(decoded(RFC7515_A1), { kind: 'secret', bytes: analyzeBase64Url(RFC7515_KEY).bytes! });
    expect(out.status).toBe('verified');
    expect(out.notes).toEqual([]);
  });

  it('needs a secret, not a key', async () => {
    expect((await verifyJws(decoded(JWT_IO), keyOf(F.RSA_SPKI))).detail).toMatch(/shared secret/);
    expect((await verifyJws(decoded(JWT_IO), secret(''))).status).toBe('error');
  });
});

describe('asymmetric algorithms', () => {
  it.each(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'])('%s with SPKI, PKCS#1, certificate and private key', async (alg) => {
    const token = await sign(alg, F.RSA_PKCS8_PRIVATE);
    for (const text of [F.RSA_SPKI, F.RSA_PKCS1_PUBLIC, F.INTERMEDIATE_CA]) {
      const out = await verifyJws(decoded(token), keyOf(text));
      expect(out.status, `${alg} with ${text.slice(0, 30)}`).toBe('verified');
    }
    const withPrivate = await verifyJws(decoded(token), keyOf(F.RSA_PKCS1_PRIVATE));
    expect(withPrivate.status).toBe('verified');
    expect(withPrivate.notes[0]).toMatch(/public half/);
  });

  it('ES256 with SPKI, certificate and SEC1 private key', async () => {
    const token = await sign('ES256', F.EC_PKCS8_PRIVATE);
    expect((await verifyJws(decoded(token), keyOf(F.EC_SPKI))).status).toBe('verified');
    expect((await verifyJws(decoded(token), keyOf(F.LEAF_CERT))).status).toBe('verified');
    expect((await verifyJws(decoded(token), keyOf(F.EC_SEC1_PRIVATE))).status).toBe('verified');
  });

  it('EdDSA with an Ed25519 SPKI and certificate', async () => {
    const token = await sign('EdDSA', F.ED25519_PKCS8_PRIVATE);
    expect((await verifyJws(decoded(token), keyOf(F.ED25519_SPKI))).status).toBe('verified');
    expect((await verifyJws(decoded(token), keyOf(F.ED25519_CERT))).status).toBe('verified');
  });

  it('reports invalid signatures with the right key type', async () => {
    const token = await sign('RS256', F.RSA_PKCS8_PRIVATE);
    const { publicKey } = await generateKeyPair('RS256', { extractable: true });
    const otherJwk = await exportJWK(publicKey);
    const out = await verifyJws(decoded(token), keyOf(JSON.stringify(otherJwk)));
    expect(out).toMatchObject({ status: 'invalid', title: 'Invalid signature' });
  });

  it('explains algorithm/key mismatches instead of failing silently', async () => {
    const es = await sign('ES256', F.EC_PKCS8_PRIVATE);
    expect((await verifyJws(decoded(es), keyOf(F.RSA_SPKI))).detail).toMatch(/needs an EC P-256 key/);
    expect((await verifyJws(decoded(es), keyOf(F.ROOT_CA))).detail).toMatch(/needs a P-256 key, but this key uses P-384/);
    expect((await verifyJws(decoded(es), secret('x'))).detail).toMatch(/public key, not a shared secret/);
    const rs = await sign('RS256', F.RSA_PKCS8_PRIVATE);
    expect((await verifyJws(decoded(rs), keyOf(F.RSA_1024_SPKI))).detail).toMatch(/only 1024 bits/);
  });
});

describe('JWK and JWK Sets', () => {
  async function jwkSet() {
    const a = await generateKeyPair('ES256', { extractable: true });
    const b = await generateKeyPair('RS256', { extractable: true });
    const c = await generateKeyPair('ES256', { extractable: true });
    const keys = [
      { ...(await exportJWK(a.publicKey)), kid: 'ec-a', use: 'sig' },
      { ...(await exportJWK(b.publicKey)), kid: 'rsa-b', alg: 'RS256' },
      { ...(await exportJWK(c.publicKey)), kid: 'ec-c' },
    ];
    return { a, b, c, keys };
  }

  async function signWith(key: CryptoKey, alg: string, kid?: string) {
    return new CompactSign(utf8('{"sub":"x"}')).setProtectedHeader({ alg, ...(kid ? { kid } : {}) }).sign(key);
  }

  it('verifies with a single public or private JWK', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES384', { extractable: true });
    const token = await signWith(privateKey, 'ES384');
    expect((await verifyJws(decoded(token), keyOf(JSON.stringify(await exportJWK(publicKey))))).status).toBe('verified');
    const priv = await verifyJws(decoded(token), keyOf(JSON.stringify({ ...(await exportJWK(privateKey)), key_ops: ['sign'] })));
    expect(priv.status).toBe('verified');
    expect(priv.notes[0]).toMatch(/private JWK/);
  });

  it('honours JWK alg and use restrictions', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const token = await signWith(privateKey, 'RS256');
    const jwk = await exportJWK(publicKey);
    expect((await verifyJws(decoded(token), keyOf(JSON.stringify({ ...jwk, alg: 'RS512' })))).detail).toMatch(/restricted to “RS512”/);
    expect((await verifyJws(decoded(token), keyOf(JSON.stringify({ ...jwk, use: 'enc' })))).detail).toMatch(/encryption/);
  });

  it('selects the key by kid from a set', async () => {
    const { c, keys } = await jwkSet();
    const token = await signWith(c.privateKey, 'ES256', 'ec-c');
    const out = await verifyJws(decoded(token), keyOf(JSON.stringify({ keys })));
    expect(out.status).toBe('verified');
    expect(out.detail).toMatch(/key 3 of 3 \(kid “ec-c”, EC P-256\)/);
  });

  it('tries all compatible keys when the kid is missing or unknown', async () => {
    const { a, keys } = await jwkSet();
    const noKid = await verifyJws(decoded(await signWith(a.privateKey, 'ES256')), keyOf(JSON.stringify({ keys })));
    expect(noKid.status).toBe('verified');
    expect(noKid.detail).toMatch(/kid “ec-a”/);
    const unknownKid = await verifyJws(decoded(await signWith(a.privateKey, 'ES256', 'nope')), keyOf(JSON.stringify({ keys })));
    expect(unknownKid.status).toBe('verified');
    expect(unknownKid.notes[0]).toMatch(/No key in the set has kid “nope”/);
  });

  it('reports sets without a usable key', async () => {
    const { keys } = await jwkSet();
    const { privateKey } = await generateKeyPair('PS256', { extractable: true });
    const out = await verifyJws(decoded(await signWith(privateKey, 'PS256', 'x')), keyOf(JSON.stringify({ keys })));
    expect(out.status).toBe('error');
    expect(out.detail).toMatch(/None of the 3 keys in the set can verify PS256 with kid “x”\. Key IDs in the set: “ec-a”, “rsa-b”, “ec-c”/);
  });

  it('reports a set whose compatible keys do not match', async () => {
    const { keys } = await jwkSet();
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    const out = await verifyJws(decoded(await signWith(privateKey, 'ES256')), keyOf(JSON.stringify({ keys })));
    expect(out.status).toBe('invalid');
    expect(out.detail).toMatch(/None of the 2 compatible keys/);
  });

  it('filters candidates by use, alg, key_ops and type', () => {
    const alg = jwsAlgorithm('ES256')!;
    const keys = [
      { kty: 'EC', crv: 'P-256', use: 'enc' },
      { kty: 'EC', crv: 'P-256', alg: 'ES384' },
      { kty: 'EC', crv: 'P-256', key_ops: ['sign'] },
      { kty: 'EC', crv: 'P-384' },
      { kty: 'RSA' },
      { kty: 'EC', crv: 'P-256', kid: 'ok' },
    ];
    const { candidates } = jwksCandidates(keys, alg, undefined);
    expect(candidates.map((c) => c.index)).toEqual([5]);
  });
});

describe('tokens that cannot be verified', () => {
  const material = (text: string): KeyMaterial => {
    const r = parseKeyText(text);
    if (!r?.ok) throw new Error('bad');
    return r.material;
  };

  it('refuses alg none, unknown algorithms and detached payloads', async () => {
    const none = decoded(`${encodeBase64UrlText('{"alg":"none"}')}.${encodeBase64UrlText('{}')}.`);
    expect((await verifyJws(none, secret('x'))).detail).toMatch(/unsecured/);
    const unknown = decoded(`${encodeBase64UrlText('{"alg":"ES256K"}')}.${encodeBase64UrlText('{}')}.AAAA`);
    expect((await verifyJws(unknown, secret('x'))).detail).toMatch(/secp256k1/);
    const detached = decoded(`${encodeBase64UrlText('{"alg":"HS256"}')}..AAAA`);
    expect((await verifyJws(detached, secret('x'))).detail).toMatch(/detached/);
    const noAlg = decoded(`${encodeBase64UrlText('{"typ":"JWT"}')}.${encodeBase64UrlText('{}')}.AAAA`);
    expect((await verifyJws(noAlg, { kind: 'material', material: material(F.RSA_SPKI) })).detail).toMatch(/does not name its algorithm/);
  });
});

describe('built-in sample', () => {
  it('verifies with its documented secret and has a long-lived exp', async () => {
    const { SAMPLE_SECRET, SAMPLE_TOKEN } = await import('./sample');
    const d = decoded(SAMPLE_TOKEN);
    expect(d.issues.filter((i) => i.level !== 'info')).toEqual([]);
    expect(d.payload.kind === 'claims' && d.payload.claims.exp).toBe(2051222400);
    const out = await verifyJws(d, secret(SAMPLE_SECRET));
    expect(out.status).toBe('verified');
    expect(out.notes).toEqual([]);
  });
});
