/** Key pair generation with Web Crypto and export to PEM, JWK and OpenSSH formats. */

import { calculateJwkThumbprint } from 'jose';
import { base64ToBytes, bytesToBase64, bytesToHex } from '../../shared-a/bytes';
import { concatBytes } from '../../shared-b/der';
import { encodePem } from '../../shared-b/pem';

export type KeyFamily = 'RSA' | 'ECDSA' | 'ECDH' | 'Ed25519' | 'X25519';
export type RsaScheme = 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'RSA-OAEP';
export type RsaSize = 2048 | 3072 | 4096;
export type Curve = 'P-256' | 'P-384' | 'P-521';
export type HashName = 'SHA-256' | 'SHA-384' | 'SHA-512';

export interface KeySpec {
  family: KeyFamily;
  rsaScheme: RsaScheme;
  rsaSize: RsaSize;
  hash: HashName;
  curve: Curve;
}

export const DEFAULT_SPEC: KeySpec = { family: 'ECDSA', rsaScheme: 'RSASSA-PKCS1-v1_5', rsaSize: 2048, hash: 'SHA-256', curve: 'P-256' };

export interface AlgorithmPlan {
  params: RsaHashedKeyGenParams | EcKeyGenParams | Algorithm;
  usages: KeyUsage[];
  /** JWK "alg" for the key, when there is a standard one. */
  jwkAlg?: string;
  /** JWS algorithm for signing JWTs with this key, if it is a signing key. */
  jwsAlg?: string;
  use: 'sig' | 'enc';
  label: string;
}

const HASH_BITS: Record<HashName, string> = { 'SHA-256': '256', 'SHA-384': '384', 'SHA-512': '512' };
const CURVE_JWS: Record<Curve, string> = { 'P-256': 'ES256', 'P-384': 'ES384', 'P-521': 'ES512' };

export function planFor(spec: KeySpec): AlgorithmPlan {
  switch (spec.family) {
    case 'RSA': {
      const bits = HASH_BITS[spec.hash];
      const params: RsaHashedKeyGenParams = {
        name: spec.rsaScheme,
        modulusLength: spec.rsaSize,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: spec.hash,
      };
      if (spec.rsaScheme === 'RSA-OAEP') {
        return {
          params,
          usages: ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
          jwkAlg: `RSA-OAEP-${bits}`,
          use: 'enc',
          label: `RSA ${spec.rsaSize}-bit · RSA-OAEP with ${spec.hash}`,
        };
      }
      const jws = `${spec.rsaScheme === 'RSA-PSS' ? 'PS' : 'RS'}${bits}`;
      return {
        params,
        usages: ['sign', 'verify'],
        jwkAlg: jws,
        jwsAlg: jws,
        use: 'sig',
        label: `RSA ${spec.rsaSize}-bit · ${spec.rsaScheme === 'RSA-PSS' ? 'RSA-PSS' : 'PKCS#1 v1.5'} with ${spec.hash}`,
      };
    }
    case 'ECDSA':
      return {
        params: { name: 'ECDSA', namedCurve: spec.curve },
        usages: ['sign', 'verify'],
        jwkAlg: CURVE_JWS[spec.curve],
        jwsAlg: CURVE_JWS[spec.curve],
        use: 'sig',
        label: `ECDSA ${spec.curve}`,
      };
    case 'ECDH':
      return { params: { name: 'ECDH', namedCurve: spec.curve }, usages: ['deriveKey', 'deriveBits'], use: 'enc', label: `ECDH ${spec.curve}` };
    case 'Ed25519':
      return { params: { name: 'Ed25519' }, usages: ['sign', 'verify'], jwkAlg: 'EdDSA', jwsAlg: 'EdDSA', use: 'sig', label: 'Ed25519' };
    case 'X25519':
      return { params: { name: 'X25519' }, usages: ['deriveKey', 'deriveBits'], use: 'enc', label: 'X25519' };
  }
}

const supportCache = new Map<string, Promise<boolean>>();

/** Whether this browser's Web Crypto can generate Ed25519 / X25519 keys. */
export function supportsAlgorithm(name: 'Ed25519' | 'X25519'): Promise<boolean> {
  let pending = supportCache.get(name);
  if (!pending) {
    const usages: KeyUsage[] = name === 'Ed25519' ? ['sign', 'verify'] : ['deriveBits'];
    pending = crypto.subtle
      .generateKey({ name }, false, usages)
      .then(() => true)
      .catch(() => false);
    supportCache.set(name, pending);
  }
  return pending;
}

export interface CleanJwk {
  kty: string;
  [member: string]: unknown;
}

/** Orders JWK members conventionally and drops Web Crypto's key_ops/ext in favour of kid/use/alg. */
export function cleanJwk(jwk: JsonWebKey, extra: { kid?: string; use?: string; alg?: string }): CleanJwk {
  const order = ['kty', 'crv', 'kid', 'use', 'alg', 'n', 'e', 'x', 'y', 'd', 'p', 'q', 'dp', 'dq', 'qi'];
  const source: Record<string, unknown> = { ...jwk, ...extra };
  delete source.key_ops;
  delete source.ext;
  const out: Record<string, unknown> = {};
  for (const key of order) if (source[key] !== undefined) out[key] = source[key];
  for (const [key, value] of Object.entries(source)) if (!(key in out) && value !== undefined) out[key] = value;
  return out as CleanJwk;
}

function b64urlToBytes(value: string | undefined): Uint8Array {
  const bytes = value ? base64ToBytes(value) : null;
  if (!bytes) throw new Error('Invalid key component.');
  return bytes;
}

function sshString(data: Uint8Array | string): Uint8Array {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, bytes.length);
  return concatBytes(len, bytes);
}

function sshMpint(unsigned: Uint8Array): Uint8Array {
  let i = 0;
  while (i < unsigned.length && unsigned[i] === 0) i++;
  let body = unsigned.subarray(i);
  if (body.length && body[0] & 0x80) body = concatBytes(Uint8Array.of(0), body);
  return sshString(body);
}

/** OpenSSH "authorized_keys" line for RSA, ECDSA (NIST curves) and Ed25519 public keys, else null. */
export function openSshPublicKey(jwk: JsonWebKey, comment = ''): string | null {
  let blob: Uint8Array;
  let type: string;
  if (jwk.kty === 'RSA') {
    type = 'ssh-rsa';
    blob = concatBytes(sshString(type), sshMpint(b64urlToBytes(jwk.e)), sshMpint(b64urlToBytes(jwk.n)));
  } else if (jwk.kty === 'EC' && (jwk.crv === 'P-256' || jwk.crv === 'P-384' || jwk.crv === 'P-521')) {
    const curve = `nistp${jwk.crv.slice(2)}`;
    type = `ecdsa-sha2-${curve}`;
    const point = concatBytes(Uint8Array.of(4), b64urlToBytes(jwk.x), b64urlToBytes(jwk.y));
    blob = concatBytes(sshString(type), sshString(curve), sshString(point));
  } else if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    type = 'ssh-ed25519';
    blob = concatBytes(sshString(type), sshString(b64urlToBytes(jwk.x)));
  } else {
    return null;
  }
  return `${type} ${bytesToBase64(blob)}${comment ? ` ${comment}` : ''}`;
}

export interface GeneratedKeyPair {
  spec: KeySpec;
  plan: AlgorithmPlan;
  publicPem: string;
  privatePem: string;
  publicJwk: CleanJwk;
  privateJwk: CleanJwk;
  /** RFC 7638 SHA-256 thumbprint, also used as the JWK "kid". */
  thumbprint: string;
  /** SHA-256 of the SPKI, Base64 (public key pin). */
  spkiPin: string;
  spkiSha256Hex: string;
  openssh: string | null;
  /** Generation time in milliseconds. */
  ms: number;
}

export async function generateKeyPairFor(spec: KeySpec, now: () => number = () => performance.now()): Promise<GeneratedKeyPair> {
  const plan = planFor(spec);
  const start = now();
  const pair = (await crypto.subtle.generateKey(plan.params, true, plan.usages)) as CryptoKeyPair;
  const ms = now() - start;
  const [spki, pkcs8, pubJwk, privJwk] = await Promise.all([
    crypto.subtle.exportKey('spki', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);
  const thumbprint = await calculateJwkThumbprint(pubJwk as Parameters<typeof calculateJwkThumbprint>[0], 'sha256');
  const extra = { kid: thumbprint, use: plan.use, alg: plan.jwkAlg };
  const spkiBytes = new Uint8Array(spki);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spkiBytes));
  return {
    spec,
    plan,
    publicPem: encodePem('PUBLIC KEY', spkiBytes),
    privatePem: encodePem('PRIVATE KEY', new Uint8Array(pkcs8)),
    publicJwk: cleanJwk(pubJwk, extra),
    privateJwk: cleanJwk(privJwk, extra),
    thumbprint,
    spkiPin: bytesToBase64(digest),
    spkiSha256Hex: bytesToHex(digest),
    openssh: plan.use === 'sig' ? openSshPublicKey(pubJwk, 'localkit-generated') : null,
    ms,
  };
}
