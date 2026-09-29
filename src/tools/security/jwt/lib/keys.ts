/**
 * Turns pasted key text (PEM public/private keys, X.509 certificates, JWK, JWK Sets, bare Base64 DER)
 * into a normalised form the JWT verifier and signer can import, with precise error messages.
 */

import { analyzeBase64Url } from './base64url';
import { jwsAlgorithm, type JwsAlgorithmInfo } from './algorithms';
import { parseDer } from '../../shared-b/der';
import {
  DER_KIND_LABELS,
  classifyAsn1,
  embeddedSpki,
  encryptedPkcs8Scheme,
  pkcs1PrivateToPkcs8,
  pkcs1PublicToSpki,
  pkcs8Info,
  sec1ToPkcs8,
  spkiInfo,
  spkiInfoFromAsn1,
  type DerKind,
  type KeyInfo,
} from '../../shared-b/keyinfo';
import { decodePemBase64, encodePem, scanPem } from '../../shared-b/pem';

/** A JSON Web Key as pasted by the user (loosely typed on purpose). */
export interface Jwk {
  kty?: unknown;
  crv?: unknown;
  n?: unknown;
  e?: unknown;
  x?: unknown;
  y?: unknown;
  d?: unknown;
  k?: unknown;
  kid?: unknown;
  alg?: unknown;
  use?: unknown;
  key_ops?: unknown;
  [member: string]: unknown;
}

export type KeyMaterial =
  | { format: 'spki'; pem: string; info: KeyInfo }
  | { format: 'certificate'; pem: string; info: KeyInfo }
  | { format: 'pkcs8'; pem: string; info: KeyInfo }
  | { format: 'jwk'; jwk: Jwk; isPrivate: boolean; info: KeyInfo }
  | { format: 'jwks'; keys: Jwk[] };

export type ParsedKey = { ok: true; material: KeyMaterial; notes: string[] } | { ok: false; error: string };

const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'priv'];

function base64UrlBitLength(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const bytes = analyzeBase64Url(value).bytes;
  if (!bytes || bytes.length === 0) return undefined;
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i]));
}

/** Key metadata for a JWK (RSA size, EC/OKP curve). */
export function jwkInfo(jwk: Jwk): KeyInfo {
  const kty = typeof jwk.kty === 'string' ? jwk.kty : '?';
  if (kty === 'RSA') {
    const bits = base64UrlBitLength(jwk.n);
    return { algorithm: 'RSA', algorithmOid: '', bits, label: bits ? `RSA ${bits}-bit` : 'RSA' };
  }
  if (kty === 'EC') {
    const curve = typeof jwk.crv === 'string' ? jwk.crv : undefined;
    const webCryptoCurve = curve === 'P-256' || curve === 'P-384' || curve === 'P-521' ? curve : undefined;
    return { algorithm: 'EC', algorithmOid: '', curve, webCryptoCurve, label: `EC ${curve ?? '(no curve)'}` };
  }
  if (kty === 'OKP') {
    const curve = typeof jwk.crv === 'string' ? jwk.crv : 'OKP';
    return { algorithm: curve, algorithmOid: '', label: curve };
  }
  if (kty === 'oct') {
    const bytes = typeof jwk.k === 'string' ? analyzeBase64Url(jwk.k).bytes : null;
    const bits = bytes && bytes.length ? bytes.length * 8 : undefined;
    return { algorithm: 'oct', algorithmOid: '', bits, label: bits ? `Symmetric ${bits}-bit secret` : 'Symmetric secret' };
  }
  return { algorithm: kty, algorithmOid: '', label: kty };
}

export function isPrivateJwk(jwk: Jwk): boolean {
  return jwk.d !== undefined || jwk.priv !== undefined || (jwk.kty === 'oct' && jwk.k !== undefined);
}

/** Copy of a JWK with private members and usage restrictions removed. */
export function publicJwk(jwk: Jwk): Jwk {
  const out: Jwk = {};
  for (const [k, v] of Object.entries(jwk)) {
    if (PRIVATE_JWK_MEMBERS.includes(k) || k === 'key_ops' || k === 'ext') continue;
    out[k] = v;
  }
  return out;
}

function parseJsonKey(text: string): ParsedKey {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `The key looks like JSON but does not parse: ${e instanceof Error ? e.message : 'syntax error'}.` };
  }
  if (Array.isArray(json)) json = { keys: json };
  if (!json || typeof json !== 'object') return { ok: false, error: 'A JWK must be a JSON object.' };
  const obj = json as Record<string, unknown>;
  if (Array.isArray(obj.keys)) {
    const keys = obj.keys.filter((k): k is Jwk => !!k && typeof k === 'object' && !Array.isArray(k));
    if (keys.length === 0) return { ok: false, error: 'The JWK Set has no keys.' };
    const notes = keys.length !== obj.keys.length ? ['Some entries of the key set are not JSON objects and were ignored.'] : [];
    return { ok: true, material: { format: 'jwks', keys }, notes };
  }
  if (typeof obj.kty !== 'string') {
    return { ok: false, error: 'This JSON is neither a JWK (it needs a “kty” member) nor a JWK Set (it needs a “keys” array).' };
  }
  const jwk = obj as Jwk;
  return { ok: true, material: { format: 'jwk', jwk, isPrivate: isPrivateJwk(jwk), info: jwkInfo(jwk) }, notes: [] };
}

function fromDer(der: Uint8Array, labelHint: string | null, notes: string[]): ParsedKey {
  let root;
  try {
    root = parseDer(der);
  } catch (e) {
    return {
      ok: false,
      error: `${labelHint ? `The “${labelHint}” block` : 'The key data'} is not valid DER/ASN.1 (${e instanceof Error ? e.message : 'parse error'}).`,
    };
  }
  const kind: DerKind = classifyAsn1(root);
  try {
    switch (kind) {
      case 'spki':
        return { ok: true, material: { format: 'spki', pem: encodePem('PUBLIC KEY', der), info: spkiInfo(der) }, notes };
      case 'pkcs1-public': {
        const spki = pkcs1PublicToSpki(der);
        notes.push('Converted the PKCS#1 “RSA PUBLIC KEY” to the standard SPKI format.');
        return { ok: true, material: { format: 'spki', pem: encodePem('PUBLIC KEY', spki), info: spkiInfo(spki) }, notes };
      }
      case 'certificate': {
        const spki = embeddedSpki(root);
        if (!spki) return { ok: false, error: 'The certificate does not contain a public key.' };
        return { ok: true, material: { format: 'certificate', pem: encodePem('CERTIFICATE', der), info: spkiInfoFromAsn1(spki) }, notes };
      }
      case 'pkcs8':
        return { ok: true, material: { format: 'pkcs8', pem: encodePem('PRIVATE KEY', der), info: pkcs8Info(der) }, notes };
      case 'pkcs1-private': {
        const p8 = pkcs1PrivateToPkcs8(der);
        notes.push('Converted the PKCS#1 “RSA PRIVATE KEY” to PKCS#8.');
        return { ok: true, material: { format: 'pkcs8', pem: encodePem('PRIVATE KEY', p8), info: pkcs8Info(p8) }, notes };
      }
      case 'sec1-private': {
        const p8 = sec1ToPkcs8(der);
        notes.push('Converted the SEC1 “EC PRIVATE KEY” to PKCS#8.');
        return { ok: true, material: { format: 'pkcs8', pem: encodePem('PRIVATE KEY', p8), info: pkcs8Info(p8) }, notes };
      }
      case 'encrypted-pkcs8':
        return {
          ok: false,
          error: `This private key is encrypted with a passphrase (${encryptedPkcs8Scheme(der)}). Decrypt it locally first, e.g. openssl pkcs8 -in key.pem -out key-plain.pem.`,
        };
      case 'csr':
        return { ok: false, error: 'This is a certificate signing request (CSR), not a key. Paste the public key or the issued certificate instead.' };
      default:
        return {
          ok: false,
          error: `This is ${kind === 'unknown' ? 'ASN.1 data that is not a key' : `a ${DER_KIND_LABELS[kind].toLowerCase()}`}. Paste a public key, certificate or private key.`,
        };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The key could not be read.' };
  }
}

/** Parses key text. Returns null for empty input. */
export function parseKeyText(text: string): ParsedKey | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJsonKey(trimmed);
  if (/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp\d+|sk-)[\s]/.test(trimmed)) {
    return {
      ok: false,
      error: 'This is an OpenSSH public key. Convert it to PEM first, e.g. ssh-keygen -e -m PKCS8 -f key.pub.',
    };
  }
  if (/-----BEGIN /.test(trimmed)) {
    const scan = scanPem(trimmed);
    const blocks = scan.blocks.filter((b) => b.label !== 'EC PARAMETERS');
    if (blocks.length === 0) {
      return { ok: false, error: scan.problems[0] ?? 'No complete PEM block was found.' };
    }
    const block = blocks[0];
    if (block.error || !block.der) return { ok: false, error: `The “${block.label}” block is damaged: ${block.error}` };
    if (block.label === 'OPENSSH PRIVATE KEY') {
      return {
        ok: false,
        error: 'This is an OpenSSH-format private key. Convert a copy to PKCS#8 first: ssh-keygen -p -m PKCS8 -f <copy of key>.',
      };
    }
    if (block.headers.some((h) => h.key === 'Proc-Type' && /ENCRYPTED/i.test(h.value))) {
      return {
        ok: false,
        error: 'This private key is encrypted with a passphrase (legacy PEM encryption). Decrypt it locally first, e.g. openssl pkey -in key.pem -out key-plain.pem.',
      };
    }
    const notes: string[] = [];
    const certs = blocks.filter((b) => b.label === 'CERTIFICATE' || b.label === 'TRUSTED CERTIFICATE');
    if (blocks.length > 1) {
      notes.push(
        certs.length > 1 && (block.label === 'CERTIFICATE' || block.label === 'TRUSTED CERTIFICATE')
          ? `Used the first of ${certs.length} certificates (normally the signing certificate).`
          : `Used the first PEM block (“${block.label}”) and ignored the other ${blocks.length - 1}.`,
      );
    }
    return fromDer(block.der, block.label, notes);
  }
  // Bare Base64 (or Base64URL) DER without PEM armour.
  if (/^[A-Za-z0-9+/=_\-\s]+$/.test(trimmed) && trimmed.replace(/\s/g, '').length >= 40) {
    const decoded = decodePemBase64(trimmed.replace(/-/g, '+').replace(/_/g, '/'));
    if (decoded.ok && decoded.bytes[0] === 0x30) {
      return fromDer(decoded.bytes, null, ['Read the text as Base64-encoded DER (no PEM header).']);
    }
  }
  return {
    ok: false,
    error: 'Paste a PEM public key (-----BEGIN PUBLIC KEY-----), an X.509 certificate, a private key, or a JWK / JWK Set (JSON).',
  };
}

/** Explains why a key cannot be used with an algorithm, or returns null when it can. */
export function keyMismatch(alg: JwsAlgorithmInfo, info: KeyInfo): string | null {
  const what = info.label;
  switch (alg.family) {
    case 'HMAC':
      return info.algorithm === 'oct' ? null : `${alg.alg} uses a shared secret, but this is ${article(what)} ${what} key.`;
    case 'RSA':
    case 'RSA-PSS':
      if (info.algorithm === 'RSA-PSS') {
        return alg.family === 'RSA-PSS'
          ? 'This key uses the RSASSA-PSS object identifier, which browsers cannot import. Re-export it as a standard RSA (rsaEncryption) key.'
          : `${alg.alg} needs a standard RSA key; this key is restricted to RSASSA-PSS.`;
      }
      if (info.algorithm !== 'RSA') return `${alg.alg} needs an RSA key, but this is ${article(what)} ${what} key.`;
      if (info.bits !== undefined && info.bits < 2048) {
        return `This RSA key is only ${info.bits} bits. Keys under 2048 bits are insecure, and ${alg.alg} verification with them is refused.`;
      }
      return null;
    case 'ECDSA':
      if (info.algorithm !== 'EC') return `${alg.alg} needs an EC ${alg.curve} key, but this is ${article(what)} ${what} key.`;
      if (info.curve !== alg.curve) {
        return `${alg.alg} needs a ${alg.curve} key, but this key uses ${info.curve ?? 'an unnamed curve'}.${
          info.curve === 'P-256' ? ' Use ES256.' : info.curve === 'P-384' ? ' Use ES384.' : info.curve === 'P-521' ? ' Use ES512.' : ''
        }`;
      }
      return null;
    case 'EdDSA':
      if (info.algorithm === 'Ed25519') return null;
      if (info.algorithm === 'Ed448') return 'Ed448 keys are not supported by browsers’ Web Crypto; only Ed25519 is.';
      return `${alg.alg} needs an Ed25519 key, but this is ${article(what)} ${what} key.`;
  }
}

function article(word: string): string {
  return /^[aeiou]|^RSA|^EC\b|^Ed|^X/i.test(word) ? 'an' : 'a';
}

/** Checks a JWK's own restrictions ("use", "alg", "kty") against the token algorithm. */
export function jwkRestriction(jwk: Jwk, alg: string): string | null {
  if (jwk.use === 'enc') return 'This key is marked for encryption (“use”: “enc”), not for signatures.';
  if (typeof jwk.alg === 'string' && jwk.alg !== alg) {
    return `This key is restricted to “${jwk.alg}” by its “alg” member, but the token uses “${alg}”.`;
  }
  const info = jwsAlgorithm(alg);
  if (info && info.family !== 'HMAC' && jwk.kty === 'oct') {
    return `This is a symmetric (“oct”) key; ${alg} needs ${info.family === 'ECDSA' ? 'an EC' : info.family === 'EdDSA' ? 'an Ed25519' : 'an RSA'} key.`;
  }
  return null;
}
