/**
 * Inspects pasted PEM/DER text: certificates (and chains), CSRs, CRLs, PKCS#7 bundles, public keys,
 * and private keys (metadata only: private key material is never returned or displayed).
 */

import type * as X509 from '@peculiar/x509';
import { bytesToBase64, bytesToHex } from '../../shared-a/bytes';
import { encodeBitString, encodeOid, encodeSequence, oidOf, parseDer, type Asn1 } from '../../shared-b/der';
import {
  DER_KIND_LABELS,
  classifyAsn1,
  embeddedSpki,
  encryptedPkcs8Scheme,
  pkcs1PrivateInfo,
  pkcs1PrivateToPkcs8,
  pkcs1PublicToSpki,
  pkcs8Info,
  publicSpkiFromPkcs8,
  sec1Info,
  sec1ToPkcs8,
  spkiInfoFromAsn1,
  type DerKind,
  type KeyInfo,
} from '../../shared-b/keyinfo';
import { HASH_ALGORITHMS, OID, SIGNATURE_ALGORITHMS } from '../../shared-b/oids';
import { decodePemBase64, encodePem, scanPem } from '../../shared-b/pem';
import { analyzeChain, isSelfIssued, type ChainAnalysis } from './chain';
import { EKU_NAMES, EXTENSION_NAMES, POLICY_NAMES, keyUsageNames } from './names';
import { parseOpenSshPrivateHeader, parseSshPublicKeyLine, sshFingerprint } from './ssh';
import { loadX509 } from './x509Loader';

export type ValidityStatus = 'valid' | 'expired' | 'not-yet-valid';

export interface Validity {
  notBefore: Date;
  notAfter: Date;
  status: ValidityStatus;
  /** Whole days until notAfter (negative once expired). */
  daysLeft: number;
  /** Total lifetime in days. */
  lifetimeDays: number;
}

export interface NamePart {
  type: string;
  value: string;
}

export interface SignatureAlgorithm {
  oid: string;
  name: string;
  weak?: string;
}

export interface PublicKeySummary {
  info: KeyInfo;
  /** SHA-256 of the SubjectPublicKeyInfo, Base64 (HPKP / certificate pinning "pin-sha256"). */
  pinSha256: string;
  /** SHA-256 of the SubjectPublicKeyInfo, hex, used to match keys with certificates. */
  spkiSha256Hex: string;
  weak?: string;
}

export interface CertificateSummary {
  der: Uint8Array;
  pem: string;
  version: number;
  subject: string;
  subjectParts: NamePart[];
  issuer: string;
  issuerParts: NamePart[];
  commonName: string | null;
  serial: string;
  validity: Validity;
  signature: SignatureAlgorithm;
  publicKey: PublicKeySummary;
  subjectAltNames: NamePart[];
  keyUsage: string[];
  keyUsageCritical: boolean;
  extendedKeyUsage: Array<{ oid: string; name: string }>;
  basicConstraints: { ca: boolean; pathLength?: number; critical: boolean } | null;
  subjectKeyId: string | null;
  authorityKeyId: string | null;
  ocsp: string[];
  caIssuers: string[];
  crlDistributionPoints: string[];
  policies: Array<{ oid: string; name?: string }>;
  otherExtensions: Array<{ oid: string; name?: string; critical: boolean }>;
  fingerprints: { sha1: string; sha256: string };
  selfIssued: boolean;
  /** The certificate's signature verifies with its own key (null when it could not be checked). */
  selfSigned: boolean | null;
  isCA: boolean;
}

export interface CsrSummary {
  der: Uint8Array;
  subject: string;
  subjectParts: NamePart[];
  signature: SignatureAlgorithm;
  publicKey: PublicKeySummary;
  /** The CSR's self-signature is valid (null when it could not be checked). */
  signatureValid: boolean | null;
  subjectAltNames: NamePart[];
  extensions: Array<{ oid: string; name?: string; critical: boolean }>;
  hasChallengePassword: boolean;
}

export interface CrlSummary {
  issuer: string;
  thisUpdate: Date;
  nextUpdate: Date | null;
  stale: boolean;
  signature: SignatureAlgorithm;
  revoked: Array<{ serial: string; date: Date | null; reason: string | null }>;
  revokedCount: number;
}

export interface PrivateKeySummary {
  format: string;
  info: KeyInfo | null;
  encrypted: boolean;
  encryption?: string;
  /** SHA-256 (hex) of the matching public key, when it can be derived. */
  spkiSha256Hex: string | null;
  sshFingerprint?: string;
  note?: string;
}

export interface SshPublicKeySummary {
  type: string;
  label: string;
  comment: string;
  fingerprint: string;
}

export type InspectedItem = { id: number; source: string } & (
  | { kind: 'certificate'; cert: CertificateSummary }
  | { kind: 'csr'; csr: CsrSummary }
  | { kind: 'crl'; crl: CrlSummary }
  | { kind: 'public-key'; format: string; key: PublicKeySummary }
  | { kind: 'ssh-public-key'; key: SshPublicKeySummary }
  | { kind: 'private-key'; key: PrivateKeySummary }
  | { kind: 'other'; title: string; message: string }
  | { kind: 'error'; title: string; error: string }
);

export interface ChainLinkCheck {
  child: number;
  parent: number;
  /** Signature of `child` verified with `parent`'s key. */
  signatureValid: boolean | null;
}

export interface ChainReport extends ChainAnalysis {
  /** Item ids (not certificate positions) in chain order. */
  itemOrder: number[];
  links: ChainLinkCheck[];
}

export interface Inspection {
  items: InspectedItem[];
  problems: string[];
  chain: ChainReport | null;
  /** Map of SPKI SHA-256 → item ids having that key (to show "matches certificate #1"). */
  keyMatches: Map<string, number[]>;
  containsPrivateKey: boolean;
}

// --- small helpers ---------------------------------------------------------------------------------

export function colonHex(bytes: Uint8Array | string, upper = true): string {
  const hex = typeof bytes === 'string' ? bytes.replace(/[^0-9a-f]/gi, '') : bytesToHex(bytes);
  const pairs = (hex.length % 2 ? `0${hex}` : hex).match(/../g) ?? [];
  const out = pairs.join(':');
  return upper ? out.toUpperCase() : out;
}

async function sha(algorithm: 'SHA-1' | 'SHA-256', data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(data)));
}

export function validityOf(notBefore: Date, notAfter: Date, now: Date): Validity {
  const status: ValidityStatus = now < notBefore ? 'not-yet-valid' : now > notAfter ? 'expired' : 'valid';
  return {
    notBefore,
    notAfter,
    status,
    daysLeft: Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000),
    lifetimeDays: Math.round((notAfter.getTime() - notBefore.getTime()) / 86_400_000),
  };
}

/** Signature algorithm of a signed structure (certificate, CSR, CRL) from its DER. */
export function signatureAlgorithmOf(root: Asn1): SignatureAlgorithm {
  const algId = root.children[1];
  const oid = oidOf(algId?.children[0]) ?? 'unknown';
  const known = SIGNATURE_ALGORITHMS[oid];
  if (oid === OID.rsassaPss) {
    // RSASSA-PSS-params: [0] hashAlgorithm (default SHA-1)
    const hashNode = algId.children[1]?.children.find((n) => n.tag === 0xa0)?.children[0];
    const hash = HASH_ALGORITHMS[oidOf(hashNode?.children[0]) ?? ''] ?? 'SHA-1';
    return { oid, name: `RSASSA-PSS with ${hash}`, weak: hash === 'SHA-1' ? 'SHA-1 is deprecated' : undefined };
  }
  return { oid, name: known?.name ?? `Unknown (${oid})`, weak: known?.weak };
}

function nameParts(json: Array<Record<string, string[]>>): NamePart[] {
  const out: NamePart[] = [];
  for (const rdn of json) for (const [type, values] of Object.entries(rdn)) for (const value of values) out.push({ type, value });
  return out;
}

async function publicKeySummary(spki: Asn1): Promise<PublicKeySummary> {
  const info = spkiInfoFromAsn1(spki);
  const digest = await sha('SHA-256', spki.raw);
  let weak: string | undefined;
  if ((info.algorithm === 'RSA' || info.algorithm === 'RSA-PSS') && info.bits && info.bits < 2048) {
    weak = `${info.bits}-bit RSA keys are too small; use at least 2048 bits.`;
  } else if (info.algorithm === 'DSA') {
    weak = 'DSA is deprecated.';
  } else if (info.algorithm === 'EC' && info.bits && info.bits < 256) {
    weak = 'Curves under 256 bits are too weak.';
  }
  return { info, pinSha256: bytesToBase64(digest), spkiSha256Hex: bytesToHex(digest), weak };
}

const SAN_TYPES: Record<string, string> = { dns: 'DNS', ip: 'IP', email: 'Email', url: 'URI', dn: 'DN', guid: 'GUID', upn: 'UPN', id: 'Registered ID' };

function generalNamesToParts(names: X509.GeneralName[] | readonly X509.GeneralName[]): NamePart[] {
  return names.map((n) => ({ type: SAN_TYPES[n.type] ?? n.type, value: n.value }));
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

async function summarizeCertificate(x509: typeof X509, der: Uint8Array, now: Date): Promise<CertificateSummary> {
  const root = parseDer(der, { allowTrailing: true });
  const certDer = root.raw;
  const cert = new x509.X509Certificate(new Uint8Array(certDer));
  const spki = embeddedSpki(root);
  if (!spki) throw new Error('The certificate has no public key.');
  const tbs = root.children[0];
  const versionNode = tbs.children[0]?.tag === 0xa0 ? tbs.children[0].children[0] : undefined;
  const version = versionNode ? versionNode.content[0] + 1 : 1;

  const subjectParts = safe(() => nameParts(cert.subjectName.toJSON())) ?? [];
  const issuerParts = safe(() => nameParts(cert.issuerName.toJSON())) ?? [];
  const san = safe(() => cert.getExtension(x509.SubjectAlternativeNameExtension));
  const ku = safe(() => cert.getExtension(x509.KeyUsagesExtension));
  const eku = safe(() => cert.getExtension(x509.ExtendedKeyUsageExtension));
  const bc = safe(() => cert.getExtension(x509.BasicConstraintsExtension));
  const ski = safe(() => cert.getExtension(x509.SubjectKeyIdentifierExtension));
  const aki = safe(() => cert.getExtension(x509.AuthorityKeyIdentifierExtension));
  const aia = safe(() => cert.getExtension(x509.AuthorityInfoAccessExtension));
  const crlDp = safe(() => cert.getExtension(x509.CRLDistributionPointsExtension));
  const policies = safe(() => cert.getExtension(x509.CertificatePolicyExtension));

  const known = new Set(['2.5.29.17', '2.5.29.15', '2.5.29.37', '2.5.29.19', '2.5.29.14', '2.5.29.35', '1.3.6.1.5.5.7.1.1', '2.5.29.31', '2.5.29.32']);
  const otherExtensions = (safe(() => cert.extensions) ?? [])
    .filter((e) => !known.has(e.type))
    .map((e) => ({ oid: e.type, name: EXTENSION_NAMES[e.type], critical: e.critical }));

  const crlUrls: string[] = [];
  for (const dp of crlDp?.distributionPoints ?? []) {
    for (const name of dp.distributionPoint?.fullName ?? []) {
      if (name.uniformResourceIdentifier) crlUrls.push(name.uniformResourceIdentifier);
    }
  }

  const [sha1, sha256, publicKey] = await Promise.all([sha('SHA-1', certDer), sha('SHA-256', certDer), publicKeySummary(spki)]);
  const subject = cert.subject;
  const issuer = cert.issuer;
  const selfIssued = isSelfIssued({ subject, issuer, ski: ski?.keyId, aki: aki?.keyId });
  let selfSigned: boolean | null = false;
  if (selfIssued) {
    try {
      selfSigned = await cert.verify({ signatureOnly: true });
    } catch {
      selfSigned = null;
    }
  }
  const isCA = Boolean(bc?.ca);
  return {
    der: certDer,
    pem: encodePem('CERTIFICATE', certDer),
    version,
    subject,
    subjectParts,
    issuer,
    issuerParts,
    commonName: subjectParts.find((p) => p.type === 'CN')?.value ?? null,
    serial: colonHex(cert.serialNumber),
    validity: validityOf(cert.notBefore, cert.notAfter, now),
    signature: signatureAlgorithmOf(root),
    publicKey,
    subjectAltNames: san ? generalNamesToParts(san.names.items) : [],
    keyUsage: ku ? keyUsageNames(ku.usages) : [],
    keyUsageCritical: Boolean(ku?.critical),
    extendedKeyUsage: (eku?.usages ?? []).map((oid) => ({ oid: String(oid), name: EKU_NAMES[String(oid)] ?? String(oid) })),
    basicConstraints: bc ? { ca: bc.ca, pathLength: bc.pathLength, critical: bc.critical } : null,
    subjectKeyId: ski?.keyId ? colonHex(ski.keyId) : null,
    authorityKeyId: aki?.keyId ? colonHex(aki.keyId) : null,
    ocsp: (aia?.ocsp ?? []).map((n) => n.value),
    caIssuers: (aia?.caIssuers ?? []).map((n) => n.value),
    crlDistributionPoints: crlUrls,
    policies: (policies?.policies ?? []).map((oid) => ({ oid, name: POLICY_NAMES[oid] })),
    otherExtensions,
    fingerprints: { sha1: colonHex(sha1), sha256: colonHex(sha256) },
    selfIssued,
    selfSigned,
    isCA,
  };
}

async function summarizeCsr(x509: typeof X509, der: Uint8Array): Promise<CsrSummary> {
  const root = parseDer(der);
  const csr = new x509.Pkcs10CertificateRequest(new Uint8Array(der));
  const spki = embeddedSpki(root);
  if (!spki) throw new Error('The request has no public key.');
  let signatureValid: boolean | null;
  try {
    signatureValid = await csr.verify();
  } catch {
    signatureValid = null;
  }
  const extensions = safe(() => csr.extensions) ?? [];
  const sanExt = extensions.find((e) => e.type === '2.5.29.17');
  const san = sanExt ? safe(() => new x509.SubjectAlternativeNameExtension(sanExt.rawData)) : null;
  const subjectParts = safe(() => nameParts(csr.subjectName.toJSON())) ?? [];
  return {
    der,
    subject: csr.subject,
    subjectParts,
    signature: signatureAlgorithmOf(root),
    publicKey: await publicKeySummary(spki),
    signatureValid,
    subjectAltNames: san ? generalNamesToParts(san.names.items) : [],
    extensions: extensions.filter((e) => e.type !== '2.5.29.17').map((e) => ({ oid: e.type, name: EXTENSION_NAMES[e.type], critical: e.critical })),
    hasChallengePassword: (safe(() => csr.attributes) ?? []).some((a) => a.type === '1.2.840.113549.1.9.7'),
  };
}

const CRL_REASONS = [
  'Unspecified',
  'Key compromise',
  'CA compromise',
  'Affiliation changed',
  'Superseded',
  'Cessation of operation',
  'Certificate hold',
  '(unused)',
  'Remove from CRL',
  'Privilege withdrawn',
  'AA compromise',
];

function summarizeCrl(x509: typeof X509, der: Uint8Array, now: Date): CrlSummary {
  const root = parseDer(der);
  const crl = new x509.X509Crl(new Uint8Array(der));
  const entries = crl.entries ?? [];
  const nextUpdate = crl.nextUpdate ?? null;
  return {
    issuer: crl.issuer,
    thisUpdate: crl.thisUpdate,
    nextUpdate,
    stale: nextUpdate !== null && nextUpdate < now,
    signature: signatureAlgorithmOf(root),
    revokedCount: entries.length,
    revoked: entries.slice(0, 50).map((e) => ({
      serial: colonHex(e.serialNumber),
      date: e.revocationDate ?? null,
      reason: typeof e.reason === 'number' ? (CRL_REASONS[e.reason] ?? String(e.reason)) : null,
    })),
  };
}

/** SHA-256 hex of the public key belonging to a PKCS#8 key; uses Web Crypto for Ed25519/X25519 without an embedded public key. */
async function privateKeySpkiHash(pkcs8: Uint8Array, info: KeyInfo | null): Promise<string | null> {
  let spki: Uint8Array | null = publicSpkiFromPkcs8(pkcs8);
  if (!spki && info && (info.algorithm === 'Ed25519' || info.algorithm === 'X25519')) {
    try {
      const algorithm = { name: info.algorithm };
      const usages: KeyUsage[] = info.algorithm === 'Ed25519' ? ['sign'] : ['deriveBits'];
      const key = await crypto.subtle.importKey('pkcs8', new Uint8Array(pkcs8), algorithm, true, usages);
      const jwk = await crypto.subtle.exportKey('jwk', key);
      const x = jwk.x ? decodePemBase64(jwk.x.replace(/-/g, '+').replace(/_/g, '/')) : null;
      if (x?.ok) {
        const oid = info.algorithm === 'Ed25519' ? OID.ed25519 : OID.x25519;
        spki = encodeSequence(encodeSequence(encodeOid(oid)), encodeBitString(x.bytes));
      }
    } catch {
      spki = null;
    }
  }
  return spki ? bytesToHex(await sha('SHA-256', spki)) : null;
}

async function summarizePrivateKey(kind: DerKind, der: Uint8Array): Promise<PrivateKeySummary> {
  switch (kind) {
    case 'pkcs8': {
      const info = safe(() => pkcs8Info(der));
      return { format: 'PKCS#8', info, encrypted: false, spkiSha256Hex: await privateKeySpkiHash(der, info) };
    }
    case 'pkcs1-private': {
      const info = safe(() => pkcs1PrivateInfo(der));
      return { format: 'PKCS#1 (traditional RSA)', info, encrypted: false, spkiSha256Hex: await privateKeySpkiHash(pkcs1PrivateToPkcs8(der), info) };
    }
    case 'sec1-private': {
      const info = safe(() => sec1Info(der));
      const p8 = safe(() => sec1ToPkcs8(der));
      return { format: 'SEC1 (traditional EC)', info, encrypted: false, spkiSha256Hex: p8 ? await privateKeySpkiHash(p8, info) : null };
    }
    case 'encrypted-pkcs8':
      return { format: 'Encrypted PKCS#8', info: null, encrypted: true, encryption: encryptedPkcs8Scheme(der), spkiSha256Hex: null };
    default:
      return { format: 'Private key', info: null, encrypted: false, spkiSha256Hex: null };
  }
}

const CERT_LABELS = new Set(['CERTIFICATE', 'TRUSTED CERTIFICATE', 'X509 CERTIFICATE', 'X.509 CERTIFICATE']);

interface Blob_ {
  label: string | null;
  der: Uint8Array;
  source: string;
  headers?: Array<{ key: string; value: string }>;
}

async function inspectBlob(x509: typeof X509, blob: Blob_, now: Date, nextId: () => number): Promise<InspectedItem[]> {
  const { label, der, source } = blob;
  const id = nextId();
  if (label === 'OPENSSH PRIVATE KEY') {
    try {
      const header = parseOpenSshPrivateHeader(der);
      return [
        {
          id,
          source,
          kind: 'private-key',
          key: {
            format: 'OpenSSH',
            info: null,
            encrypted: header.encrypted,
            encryption: header.encrypted ? `${header.cipher} (${header.kdf})` : undefined,
            spkiSha256Hex: null,
            sshFingerprint: header.publicKey ? await sshFingerprint(header.publicKey.blob) : undefined,
            note: header.publicKey ? header.publicKey.label : undefined,
          },
        },
      ];
    } catch (e) {
      return [{ id, source, kind: 'error', title: 'OpenSSH private key', error: e instanceof Error ? e.message : 'Unreadable key.' }];
    }
  }
  if (label && /ENCRYPTED/.test(label) === false && blob.headers?.some((h) => h.key === 'Proc-Type' && /ENCRYPTED/i.test(h.value))) {
    const dek = blob.headers.find((h) => h.key === 'DEK-Info')?.value.split(',')[0];
    return [
      {
        id,
        source,
        kind: 'private-key',
        key: { format: `Legacy encrypted PEM (${label})`, info: null, encrypted: true, encryption: dek, spkiSha256Hex: null },
      },
    ];
  }
  if (label && /PARAMETERS$/.test(label)) {
    return [
      {
        id,
        source,
        kind: 'other',
        title: label === 'EC PARAMETERS' ? 'EC parameters' : label === 'DH PARAMETERS' ? 'Diffie-Hellman parameters' : label.toLowerCase(),
        message:
          label === 'EC PARAMETERS'
            ? `Names the curve for a key${(() => {
                const oid = safe(() => oidOf(parseDer(der)));
                return oid ? ` (${oid === OID.p256 ? 'P-256' : oid === OID.p384 ? 'P-384' : oid === OID.p521 ? 'P-521' : oid})` : '';
              })()}. OpenSSL writes it before “EC PRIVATE KEY”; it contains no key material.`
            : 'Domain parameters only; no key or certificate.',
      },
    ];
  }

  let root: Asn1;
  try {
    root = parseDer(der, { allowTrailing: label !== null && CERT_LABELS.has(label) });
  } catch (e) {
    return [
      {
        id,
        source,
        kind: 'error',
        title: label ? `“${label}” block` : 'Data',
        error: `It is not valid DER/ASN.1 (${e instanceof Error ? e.message : 'parse error'}). The block may be truncated or corrupted.`,
      },
    ];
  }
  const kind = classifyAsn1(root);
  const mismatch = label && kind !== 'unknown' && !labelMatches(label, kind) ? ` (labelled “${label}”)` : '';
  try {
    switch (kind) {
      case 'certificate':
        return [{ id, source: source + mismatch, kind: 'certificate', cert: await summarizeCertificate(x509, der, now) }];
      case 'csr':
        return [{ id, source: source + mismatch, kind: 'csr', csr: await summarizeCsr(x509, der) }];
      case 'crl':
        return [{ id, source: source + mismatch, kind: 'crl', crl: summarizeCrl(x509, der, now) }];
      case 'spki':
        return [{ id, source: source + mismatch, kind: 'public-key', format: 'SPKI', key: await publicKeySummary(root) }];
      case 'pkcs1-public': {
        const spki = parseDer(pkcs1PublicToSpki(der));
        return [{ id, source: source + mismatch, kind: 'public-key', format: 'PKCS#1 (RSA PUBLIC KEY)', key: await publicKeySummary(spki) }];
      }
      case 'pkcs8':
      case 'pkcs1-private':
      case 'sec1-private':
      case 'encrypted-pkcs8':
        return [{ id, source: source + mismatch, kind: 'private-key', key: await summarizePrivateKey(kind, der) }];
      case 'pkcs7': {
        const certs = new x509.X509Certificates(new Uint8Array(der));
        if (certs.length === 0) return [{ id, source, kind: 'other', title: 'PKCS#7 bundle', message: 'The bundle contains no certificates.' }];
        const items: InspectedItem[] = [];
        for (let i = 0; i < certs.length; i++) {
          const certDer = new Uint8Array(certs[i].rawData);
          items.push({
            id: i === 0 ? id : nextId(),
            source: `${source}, certificate ${i + 1} of ${certs.length} in the PKCS#7 bundle`,
            kind: 'certificate',
            cert: await summarizeCertificate(x509, certDer, now),
          });
        }
        return items;
      }
      default:
        return [
          {
            id,
            source,
            kind: 'error',
            title: label ? `“${label}” block` : 'Data',
            error: 'This ASN.1 structure is not a certificate, request, CRL or key that this inspector recognises.',
          },
        ];
    }
  } catch (e) {
    return [
      {
        id,
        source,
        kind: 'error',
        title: DER_KIND_LABELS[kind],
        error: `It could not be parsed: ${e instanceof Error ? e.message : 'unknown error'}.`,
      },
    ];
  }
}

function labelMatches(label: string, kind: DerKind): boolean {
  switch (kind) {
    case 'certificate':
      return CERT_LABELS.has(label);
    case 'csr':
      return label === 'CERTIFICATE REQUEST' || label === 'NEW CERTIFICATE REQUEST';
    case 'crl':
      return label === 'X509 CRL';
    case 'pkcs7':
      return label === 'PKCS7' || label === 'CMS' || label === 'PKCS #7 SIGNED DATA';
    case 'spki':
      return label === 'PUBLIC KEY';
    case 'pkcs1-public':
      return label === 'RSA PUBLIC KEY';
    case 'pkcs8':
      return label === 'PRIVATE KEY';
    case 'pkcs1-private':
      return label === 'RSA PRIVATE KEY';
    case 'sec1-private':
      return label === 'EC PRIVATE KEY';
    case 'encrypted-pkcs8':
      return label === 'ENCRYPTED PRIVATE KEY';
    default:
      return true;
  }
}

/** Collects the binary objects in the input: PEM blocks, or a bare Base64 DER blob, or SSH key lines. */
function collectInput(text: string): { blobs: Blob_[]; sshLines: string[]; problems: string[]; empty: boolean } {
  const scan = scanPem(text);
  const problems = [...scan.problems];
  const blobs: Blob_[] = [];
  const sshLines: string[] = [];
  scan.blocks.forEach((block, i) => {
    const source = `PEM block ${i + 1} (${block.label})`;
    if (!block.der) {
      problems.push(`${source}: ${block.error}`);
      return;
    }
    blobs.push({ label: block.label, der: block.der, source, headers: block.headers });
  });
  if (scan.blocks.length === 0) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const ssh = lines.filter((l) => parseSshPublicKeyLine(l));
    if (ssh.length) sshLines.push(...ssh);
    else {
      const compact = text.replace(/\s+/g, '');
      if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) && compact.length >= 16) {
        const decoded = decodePemBase64(compact.replace(/-/g, '+').replace(/_/g, '/'));
        if (decoded.ok && decoded.bytes[0] === 0x30) blobs.push({ label: null, der: decoded.bytes, source: 'Base64 DER' });
      }
    }
  }
  return { blobs, sshLines, problems, empty: !/\S/.test(text) };
}

/**
 * Inspects everything in `text`. Returns null for empty input. Never throws for malformed input:
 * problems are reported per item.
 */
export async function inspectText(text: string, now: Date = new Date()): Promise<Inspection | null> {
  if (!text.trim()) return null;
  const { blobs, sshLines, problems } = collectInput(text);
  const items: InspectedItem[] = [];
  let counter = 0;
  const nextId = () => ++counter;

  for (const line of sshLines) {
    const key = parseSshPublicKeyLine(line)!;
    items.push({
      id: nextId(),
      source: 'OpenSSH public key',
      kind: 'ssh-public-key',
      key: { type: key.type, label: key.label, comment: key.comment, fingerprint: await sshFingerprint(key.blob) },
    });
  }

  if (blobs.length) {
    const x509 = await loadX509();
    for (const blob of blobs) items.push(...(await inspectBlob(x509, blob, now, nextId)));
  }

  if (items.length === 0 && problems.length === 0) {
    problems.push(
      'No certificate, key or request was found. Paste text that starts with a line like “-----BEGIN CERTIFICATE-----”, an OpenSSH public key, or open a .pem, .crt, .cer, .der, .csr or .key file.',
    );
  }

  // Chains
  const certItems = items.filter((i): i is InspectedItem & { kind: 'certificate' } => i.kind === 'certificate');
  let chain: ChainReport | null = null;
  if (certItems.length > 1) {
    const analysis = analyzeChain(
      certItems.map((item, index) => ({
        index,
        subject: item.cert.subject,
        issuer: item.cert.issuer,
        ski: item.cert.subjectKeyId ?? undefined,
        aki: item.cert.authorityKeyId ?? undefined,
        isCA: item.cert.isCA,
      })),
    );
    const x509 = await loadX509();
    const links: ChainLinkCheck[] = [];
    for (let i = 0; i + 1 < analysis.order.length; i++) {
      const child = certItems[analysis.order[i]];
      const parent = certItems[analysis.order[i + 1]];
      let signatureValid: boolean | null;
      try {
        const childCert = new x509.X509Certificate(new Uint8Array(child.cert.der));
        const parentCert = new x509.X509Certificate(new Uint8Array(parent.cert.der));
        signatureValid = await childCert.verify({ publicKey: parentCert.publicKey, signatureOnly: true });
      } catch {
        signatureValid = null;
      }
      links.push({ child: child.id, parent: parent.id, signatureValid });
    }
    chain = {
      ...analysis,
      itemOrder: analysis.order.map((i) => certItems[i].id),
      unrelated: analysis.unrelated.map((i) => certItems[i].id),
      links,
    };
  }

  // Which items share a key
  const keyMatches = new Map<string, number[]>();
  const addKey = (hash: string | null | undefined, id: number) => {
    if (!hash) return;
    keyMatches.set(hash, [...(keyMatches.get(hash) ?? []), id]);
  };
  for (const item of items) {
    if (item.kind === 'certificate') addKey(item.cert.publicKey.spkiSha256Hex, item.id);
    else if (item.kind === 'csr') addKey(item.csr.publicKey.spkiSha256Hex, item.id);
    else if (item.kind === 'public-key') addKey(item.key.spkiSha256Hex, item.id);
    else if (item.kind === 'private-key') addKey(item.key.spkiSha256Hex, item.id);
  }

  return {
    items,
    problems,
    chain,
    keyMatches,
    containsPrivateKey: items.some((i) => i.kind === 'private-key'),
  };
}

