/**
 * Recognises DER structures (certificates, CSRs, CRLs, PKCS#7, SPKI/PKCS#1 public keys, PKCS#8/PKCS#1/SEC1
 * private keys) and reads key metadata (algorithm, size, curve) without exposing key material.
 * Also converts legacy key encodings into the SPKI/PKCS#8 containers that Web Crypto imports.
 */

import {
  DER_NULL,
  TAG,
  bitLength,
  bitStringBytes,
  encodeBitString,
  encodeOctetString,
  encodeOid,
  encodeSequence,
  encodeSmallInteger,
  oidOf,
  parseDer,
  smallInteger,
  type Asn1,
} from './der';
import { CURVES, ENCRYPTION_ALGORITHMS, KEY_ALGORITHMS, OID } from './oids';

export interface KeyInfo {
  /** 'RSA', 'RSA-PSS', 'EC', 'Ed25519', 'X25519', 'DSA', ... */
  algorithm: string;
  algorithmOid: string;
  bits?: number;
  /** Curve display name for EC keys (e.g. "P-256", "secp256k1"). */
  curve?: string;
  curveOid?: string;
  /** Set when the curve is one Web Crypto supports. */
  webCryptoCurve?: 'P-256' | 'P-384' | 'P-521';
  /** The EC key uses explicit curve parameters instead of a named curve. */
  explicitCurve?: boolean;
  /** Short description such as "RSA 2048-bit" or "EC P-256". */
  label: string;
}

export type DerKind =
  | 'certificate'
  | 'csr'
  | 'crl'
  | 'pkcs7'
  | 'spki'
  | 'pkcs1-public'
  | 'pkcs8'
  | 'encrypted-pkcs8'
  | 'pkcs1-private'
  | 'sec1-private'
  | 'unknown';

export const DER_KIND_LABELS: Record<DerKind, string> = {
  certificate: 'X.509 certificate',
  csr: 'Certificate signing request (PKCS#10)',
  crl: 'Certificate revocation list',
  pkcs7: 'PKCS#7 / CMS bundle',
  spki: 'Public key (SPKI)',
  'pkcs1-public': 'RSA public key (PKCS#1)',
  pkcs8: 'Private key (PKCS#8)',
  'encrypted-pkcs8': 'Encrypted private key (PKCS#8)',
  'pkcs1-private': 'RSA private key (PKCS#1)',
  'sec1-private': 'EC private key (SEC1)',
  unknown: 'Unrecognised ASN.1 data',
};

/** PEM label conventionally used for each structure. */
export const PEM_LABEL_FOR: Record<Exclude<DerKind, 'unknown'>, string> = {
  certificate: 'CERTIFICATE',
  csr: 'CERTIFICATE REQUEST',
  crl: 'X509 CRL',
  pkcs7: 'PKCS7',
  spki: 'PUBLIC KEY',
  'pkcs1-public': 'RSA PUBLIC KEY',
  pkcs8: 'PRIVATE KEY',
  'encrypted-pkcs8': 'ENCRYPTED PRIVATE KEY',
  'pkcs1-private': 'RSA PRIVATE KEY',
  'sec1-private': 'EC PRIVATE KEY',
};

export function isPrivateKind(kind: DerKind): boolean {
  return kind === 'pkcs8' || kind === 'encrypted-pkcs8' || kind === 'pkcs1-private' || kind === 'sec1-private';
}

const isSeq = (n: Asn1 | undefined) => n?.tag === TAG.SEQUENCE;
const isInt = (n: Asn1 | undefined) => n?.tag === TAG.INTEGER;
const isTime = (n: Asn1 | undefined) => n?.tag === TAG.UTC_TIME || n?.tag === TAG.GENERALIZED_TIME;
const isAlgId = (n: Asn1 | undefined) => isSeq(n) && n!.children.length >= 1 && n!.children[0].tag === TAG.OID;

/** Guesses what a parsed DER structure is from its shape. */
export function classifyAsn1(root: Asn1): DerKind {
  if (!isSeq(root)) return 'unknown';
  const c = root.children;
  // Signed envelopes: SEQUENCE { tbs SEQUENCE, AlgorithmIdentifier, BIT STRING }
  if (c.length === 3 && isSeq(c[0]) && isAlgId(c[1]) && c[2].tag === TAG.BIT_STRING) {
    const tbs = c[0].children;
    const hasVersion = tbs[0]?.tag === 0xa0;
    const t = hasVersion ? tbs.slice(1) : tbs;
    if (isInt(t[0]) && isAlgId(t[1]) && isSeq(t[2]) && isSeq(t[3]) && isSeq(t[4]) && isSeq(t[5])) return 'certificate';
    if (isInt(tbs[0]) && isSeq(tbs[1]) && isSeq(tbs[2]) && tbs[3]?.tag === 0xa0 && tbs.length === 4) return 'csr';
    const crl = isInt(tbs[0]) ? tbs.slice(1) : tbs;
    if (isAlgId(crl[0]) && isSeq(crl[1]) && isTime(crl[2])) return 'crl';
    return 'unknown';
  }
  if (c.length === 2 && isAlgId(c[0]) && c[1].tag === TAG.BIT_STRING) return 'spki';
  if (c.length === 2 && isAlgId(c[0]) && c[1].tag === TAG.OCTET_STRING) return 'encrypted-pkcs8';
  if (c.length === 2 && isInt(c[0]) && isInt(c[1])) return 'pkcs1-public';
  if (c.length >= 1 && c[0].tag === TAG.OID && (c.length === 1 || c[1].tag === 0xa0)) return 'pkcs7';
  if (c.length >= 3 && isInt(c[0]) && isAlgId(c[1]) && c[2].tag === TAG.OCTET_STRING) return 'pkcs8';
  if (c.length >= 2 && smallInteger(c[0]) === 1 && c[1].tag === TAG.OCTET_STRING && c.slice(2).every((n) => n.tag === 0xa0 || n.tag === 0xa1)) {
    return 'sec1-private';
  }
  if (c.length >= 9 && c.every(isInt)) return 'pkcs1-private';
  return 'unknown';
}

export function classifyDer(der: Uint8Array): DerKind {
  try {
    return classifyAsn1(parseDer(der));
  } catch {
    return 'unknown';
  }
}

function label(info: Omit<KeyInfo, 'label'>): string {
  if (info.algorithm === 'RSA' || info.algorithm === 'RSA-PSS' || info.algorithm === 'RSA-OAEP' || info.algorithm === 'DSA') {
    return info.bits ? `${info.algorithm} ${info.bits}-bit` : info.algorithm;
  }
  if (info.algorithm === 'EC') {
    if (info.explicitCurve) return `EC (explicit curve parameters${info.bits ? `, ${info.bits}-bit` : ''})`;
    return `EC ${info.curve ?? info.curveOid ?? 'unknown curve'}`;
  }
  return info.algorithm;
}

function withLabel(info: Omit<KeyInfo, 'label'>): KeyInfo {
  return { ...info, label: label(info) };
}

function curveInfo(params: Asn1 | undefined): Pick<KeyInfo, 'curve' | 'curveOid' | 'webCryptoCurve' | 'explicitCurve' | 'bits'> {
  const curveOid = oidOf(params);
  if (curveOid) {
    const known = CURVES[curveOid];
    return { curveOid, curve: known?.name, webCryptoCurve: known?.webCrypto, bits: known?.bits };
  }
  if (isSeq(params)) {
    // SpecifiedECDomain: version, fieldID { fieldType, prime }, ...
    const prime = params!.children[1]?.children[1];
    return { explicitCurve: true, bits: prime && isInt(prime) ? bitLength(prime.content) : undefined };
  }
  return {};
}

function rsaBits(rsaKey: Asn1): number | undefined {
  // RSAPublicKey { n, e } or RSAPrivateKey { version, n, e, ... }
  const modulus = rsaKey.children.length === 2 ? rsaKey.children[0] : rsaKey.children[1];
  return modulus && isInt(modulus) ? bitLength(modulus.content) : undefined;
}

const RAW_KEY_BITS: Record<string, number> = {
  [OID.ed25519]: 256,
  [OID.x25519]: 256,
  [OID.ed448]: 456,
  [OID.x448]: 448,
};

/** Key metadata from a SubjectPublicKeyInfo node. */
export function spkiInfoFromAsn1(spki: Asn1): KeyInfo {
  const algId = spki.children[0];
  const algorithmOid = oidOf(algId?.children[0]);
  if (!algorithmOid) throw new Error('The public key has no algorithm identifier.');
  const algorithm = KEY_ALGORITHMS[algorithmOid] ?? `Unknown (${algorithmOid})`;
  const base = { algorithm, algorithmOid };
  if (algorithmOid === OID.ecPublicKey) return withLabel({ ...base, ...curveInfo(algId.children[1]) });
  if (algorithmOid === OID.rsaEncryption || algorithmOid === OID.rsassaPss || algorithmOid === OID.rsaesOaep) {
    try {
      const key = parseDer(bitStringBytes(spki.children[1]));
      return withLabel({ ...base, bits: rsaBits(key) });
    } catch {
      return withLabel(base);
    }
  }
  if (algorithmOid === OID.dsa) {
    const p = algId.children[1]?.children[0];
    return withLabel({ ...base, bits: p && isInt(p) ? bitLength(p.content) : undefined });
  }
  return withLabel({ ...base, bits: RAW_KEY_BITS[algorithmOid] });
}

export function spkiInfo(der: Uint8Array): KeyInfo {
  return spkiInfoFromAsn1(parseDer(der));
}

/** The SubjectPublicKeyInfo node inside a certificate or CSR, or null when the structure is different. */
export function embeddedSpki(root: Asn1): Asn1 | null {
  const kind = classifyAsn1(root);
  const tbs = root.children[0]?.children ?? [];
  if (kind === 'certificate') return tbs[tbs[0]?.tag === 0xa0 ? 6 : 5] ?? null;
  if (kind === 'csr') return tbs[2] ?? null;
  return null;
}

/** Key metadata from a PKCS#8 PrivateKeyInfo. Never returns key material. */
export function pkcs8Info(der: Uint8Array): KeyInfo {
  const root = parseDer(der);
  const algId = root.children[1];
  const algorithmOid = oidOf(algId?.children[0]);
  if (!algorithmOid) throw new Error('The private key has no algorithm identifier.');
  const algorithm = KEY_ALGORITHMS[algorithmOid] ?? `Unknown (${algorithmOid})`;
  const base = { algorithm, algorithmOid };
  if (algorithmOid === OID.ecPublicKey) {
    let curve = curveInfo(algId.children[1]);
    if (!curve.curveOid && !curve.explicitCurve) {
      // Fall back to the parameters inside ECPrivateKey.
      try {
        const inner = parseDer(root.children[2].content);
        const params = inner.children.find((n) => n.tag === 0xa0)?.children[0];
        curve = curveInfo(params);
      } catch {
        // keep what we have
      }
    }
    return withLabel({ ...base, ...curve });
  }
  if (algorithmOid === OID.rsaEncryption || algorithmOid === OID.rsassaPss) {
    try {
      return withLabel({ ...base, bits: rsaBits(parseDer(root.children[2].content)) });
    } catch {
      return withLabel(base);
    }
  }
  if (algorithmOid === OID.dsa) {
    const p = algId.children[1]?.children[0];
    return withLabel({ ...base, bits: p && isInt(p) ? bitLength(p.content) : undefined });
  }
  return withLabel({ ...base, bits: RAW_KEY_BITS[algorithmOid] });
}

export function pkcs1PublicInfo(der: Uint8Array): KeyInfo {
  return withLabel({ algorithm: 'RSA', algorithmOid: OID.rsaEncryption, bits: rsaBits(parseDer(der)) });
}

export function pkcs1PrivateInfo(der: Uint8Array): KeyInfo {
  return withLabel({ algorithm: 'RSA', algorithmOid: OID.rsaEncryption, bits: rsaBits(parseDer(der)) });
}

export function sec1Info(der: Uint8Array): KeyInfo {
  const root = parseDer(der);
  const params = root.children.find((n) => n.tag === 0xa0)?.children[0];
  return withLabel({ algorithm: 'EC', algorithmOid: OID.ecPublicKey, ...curveInfo(params) });
}

/** Describes the encryption of an EncryptedPrivateKeyInfo (e.g. "PBES2 · AES-256-CBC"). */
export function encryptedPkcs8Scheme(der: Uint8Array): string {
  try {
    const root = parseDer(der);
    const algId = root.children[0];
    const oid = oidOf(algId.children[0]);
    if (!oid) return 'unknown scheme';
    const name = ENCRYPTION_ALGORITHMS[oid] ?? oid;
    if (oid !== OID.pbes2) return name;
    const params = algId.children[1];
    const kdf = oidOf(params?.children[0]?.children[0]);
    const cipher = oidOf(params?.children[1]?.children[0]);
    return [name, kdf && (ENCRYPTION_ALGORITHMS[kdf] ?? kdf), cipher && (ENCRYPTION_ALGORITHMS[cipher] ?? cipher)]
      .filter(Boolean)
      .join(' · ');
  } catch {
    return 'unknown scheme';
  }
}

// --- conversions ------------------------------------------------------------------------------

const RSA_ALGORITHM_ID = () => encodeSequence(encodeOid(OID.rsaEncryption), DER_NULL);

/** Wraps a PKCS#1 RSAPublicKey in a SubjectPublicKeyInfo. */
export function pkcs1PublicToSpki(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const key = parseDer(pkcs1);
  if (classifyAsn1(key) !== 'pkcs1-public') throw new Error('This is not a PKCS#1 RSA public key.');
  return encodeSequence(RSA_ALGORITHM_ID(), encodeBitString(pkcs1));
}

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo. */
export function pkcs1PrivateToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const key = parseDer(pkcs1);
  if (classifyAsn1(key) !== 'pkcs1-private') throw new Error('This is not a PKCS#1 RSA private key.');
  return encodeSequence(encodeSmallInteger(0), RSA_ALGORITHM_ID(), encodeOctetString(pkcs1));
}

/** Wraps a SEC1 ECPrivateKey in a PKCS#8 PrivateKeyInfo (the curve must be named inside the key). */
export function sec1ToPkcs8(sec1: Uint8Array): Uint8Array<ArrayBuffer> {
  const key = parseDer(sec1);
  if (classifyAsn1(key) !== 'sec1-private') throw new Error('This is not a SEC1 EC private key.');
  const curveOid = oidOf(key.children.find((n) => n.tag === 0xa0)?.children[0]);
  if (!curveOid) throw new Error('The EC private key does not name its curve, so it cannot be converted.');
  return encodeSequence(
    encodeSmallInteger(0),
    encodeSequence(encodeOid(OID.ecPublicKey), encodeOid(curveOid)),
    encodeOctetString(sec1),
  );
}

/**
 * Derives the SubjectPublicKeyInfo that belongs to a PKCS#8 private key when the public part is
 * present in the structure (RSA always; EC and Ed25519 when the optional public key was stored).
 * Returns null when it cannot be derived without doing elliptic-curve math.
 */
export function publicSpkiFromPkcs8(pkcs8: Uint8Array): Uint8Array<ArrayBuffer> | null {
  try {
    const root = parseDer(pkcs8);
    const algId = root.children[1];
    const algorithmOid = oidOf(algId?.children[0]);
    const inner = root.children[2];
    if (algorithmOid === OID.rsaEncryption || algorithmOid === OID.rsassaPss) {
      const rsa = parseDer(inner.content);
      const [, n, e] = rsa.children;
      if (!isInt(n) || !isInt(e)) return null;
      const pub = encodeSequence(n.raw, e.raw);
      return encodeSequence(algId.raw, encodeBitString(pub));
    }
    if (algorithmOid === OID.ecPublicKey) {
      const ec = parseDer(inner.content);
      const pubNode = ec.children.find((n) => n.tag === 0xa1)?.children[0];
      if (!pubNode || pubNode.tag !== TAG.BIT_STRING) return null;
      const params = algId.children[1] ?? ec.children.find((n) => n.tag === 0xa0)?.children[0];
      if (!params) return null;
      return encodeSequence(encodeSequence(encodeOid(OID.ecPublicKey), params.raw), pubNode.raw);
    }
    // OneAsymmetricKey v2 may carry the public key as [1] IMPLICIT BIT STRING.
    const pub = root.children.find((n) => n.tag === 0x81 || n.tag === 0xa1);
    if (pub && algorithmOid) {
      const bits = pub.tag === 0x81 ? pub.content : pub.children[0]?.content;
      if (!bits || bits.length < 2) return null;
      return encodeSequence(encodeSequence(encodeOid(algorithmOid)), encodeBitString(bits.subarray(1)));
    }
    return null;
  } catch {
    return null;
  }
}
