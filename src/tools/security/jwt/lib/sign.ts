/** Creating and signing test JWTs with jose (HS*, RS*, PS*, ES*, EdDSA). */

import { CompactSign, exportJWK, exportPKCS8, exportSPKI, generateKeyPair, importJWK, importPKCS8 } from 'jose';
import { utf8 } from '../../shared-a/bytes';
import { jwsAlgorithm, type JwsAlgorithmInfo } from './algorithms';
import { isPrivateJwk, jwkRestriction, keyMismatch, publicJwk, type Jwk, type KeyMaterial } from './keys';
import { explainKeyError } from './verify';

export type SignKey = { kind: 'secret'; bytes: Uint8Array } | { kind: 'material'; material: KeyMaterial };

export type JsonObjectResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Parses text that must be a JSON object, with a readable error. */
export function parseJsonObject(text: string, what: string): JsonObjectResult {
  if (!text.trim()) return { ok: false, error: `The ${what} is empty. It must be a JSON object such as {}.` };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `The ${what} is not valid JSON: ${e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'syntax error'}.` };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `The ${what} must be a JSON object ({ … }), not ${Array.isArray(value) ? 'an array' : value === null ? 'null' : `a ${typeof value}`}.` };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/** Returns the JSON text with one member set (or removed when value is undefined), pretty-printed. */
export function setMember(text: string, key: string, value: unknown): string {
  const parsed = parseJsonObject(text, 'JSON');
  if (!parsed.ok) throw new Error(parsed.error);
  const next = { ...parsed.value };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return JSON.stringify(next, null, 2);
}

/** Checks that key material can sign with `alg`; returns an explanation when it cannot. */
export function signingKeyProblem(material: KeyMaterial, alg: JwsAlgorithmInfo): string | null {
  switch (material.format) {
    case 'jwks':
      return 'A JWK Set holds public keys for verification. Paste a single private key to sign.';
    case 'spki':
    case 'certificate':
      return `That is a ${material.format === 'spki' ? 'public key' : 'certificate'}. Signing needs the matching private key (PKCS#8 PEM, “RSA/EC PRIVATE KEY” PEM or a private JWK).`;
    case 'jwk':
      if (!isPrivateJwk(material.jwk)) return 'This JWK is public (it has no “d” member). Signing needs the private JWK.';
      return jwkRestriction(material.jwk, alg.alg) ?? keyMismatch(alg, material.info);
    case 'pkcs8':
      return keyMismatch(alg, material.info);
  }
}

async function importSigningKey(key: SignKey, alg: JwsAlgorithmInfo): Promise<CryptoKey | Uint8Array> {
  if (alg.family === 'HMAC') {
    if (key.kind !== 'secret') throw new Error(`${alg.alg} signs with a shared secret, not a key pair.`);
    if (key.bytes.length === 0) throw new Error('Enter a secret to sign the token.');
    return new Uint8Array(key.bytes);
  }
  if (key.kind === 'secret') throw new Error(`${alg.alg} signs with a private key, not a shared secret.`);
  const problem = signingKeyProblem(key.material, alg);
  if (problem) throw new Error(problem);
  const material = key.material;
  try {
    if (material.format === 'pkcs8') return await importPKCS8(material.pem, alg.alg);
    if (material.format === 'jwk') {
      const { key_ops: _ops, ext: _ext, use: _use, ...jwk } = material.jwk;
      return (await importJWK(jwk as Parameters<typeof importJWK>[0], alg.alg)) as CryptoKey;
    }
  } catch (e) {
    throw new Error(explainKeyError(e, alg.alg), { cause: e });
  }
  throw new Error('Unsupported key.');
}

/**
 * Signs `payload` (serialised compactly) with a protected header whose "alg" is forced to `alg`.
 * Throws an Error with a human-readable message on any problem.
 */
export async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  algName: string,
  key: SignKey,
): Promise<string> {
  const alg = jwsAlgorithm(algName);
  if (!alg) throw new Error(`“${algName}” is not a supported signing algorithm.`);
  const signingKey = await importSigningKey(key, alg);
  const protectedHeader = { ...header, alg: alg.alg };
  try {
    return await new CompactSign(new Uint8Array(utf8(JSON.stringify(payload)))).setProtectedHeader(protectedHeader).sign(signingKey);
  } catch (e) {
    throw new Error(explainKeyError(e, alg.alg), { cause: e });
  }
}

/** SPKI PEM of the public half of a private key, so the token can be verified elsewhere. */
export async function derivePublicKeyPem(material: KeyMaterial, algName: string): Promise<string | null> {
  const alg = jwsAlgorithm(algName);
  if (!alg || alg.family === 'HMAC') return null;
  try {
    let jwk: Jwk;
    if (material.format === 'pkcs8') {
      jwk = (await exportJWK(await importPKCS8(material.pem, alg.alg, { extractable: true }))) as Jwk;
    } else if (material.format === 'jwk') {
      jwk = material.jwk;
    } else {
      return null;
    }
    const pub = await importJWK(publicJwk(jwk) as Parameters<typeof importJWK>[0], alg.alg, { extractable: true });
    return await exportSPKI(pub as CryptoKey);
  } catch {
    return null;
  }
}

export interface TestKeyPair {
  privatePem: string;
  publicPem: string;
}

/** Generates a fresh key pair for trying out an asymmetric algorithm (RSA keys are 2048-bit). */
export async function generateTestKeyPair(algName: string): Promise<TestKeyPair> {
  const alg = jwsAlgorithm(algName);
  if (!alg || alg.family === 'HMAC') throw new Error(`${algName} does not use a key pair.`);
  const { privateKey, publicKey } = await generateKeyPair(alg.alg === 'Ed25519' ? 'EdDSA' : alg.alg, { extractable: true });
  return { privatePem: await exportPKCS8(privateKey), publicPem: await exportSPKI(publicKey) };
}

/** Random HMAC secret of the length RFC 7518 recommends for the algorithm (Base64URL). */
export function randomSecretBytes(algName: string): Uint8Array {
  const alg = jwsAlgorithm(algName);
  const bytes = new Uint8Array(alg?.minSecretBytes ?? 32);
  crypto.getRandomValues(bytes);
  return bytes;
}
