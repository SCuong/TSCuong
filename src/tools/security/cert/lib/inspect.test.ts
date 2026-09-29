import { describe, expect, it } from 'vitest';
import { colonHex, inspectText, validityOf, type InspectedItem, type Inspection } from './inspect';
import * as F from '../../shared-b/testFixtures';

const NOW = new Date('2026-09-29T12:00:00Z');

async function inspect(text: string, now = NOW): Promise<Inspection> {
  const result = await inspectText(text, now);
  if (!result) throw new Error('null result');
  return result;
}

function only<K extends InspectedItem['kind']>(result: Inspection, kind: K): Extract<InspectedItem, { kind: K }> {
  const items = result.items.filter((i) => i.kind === kind);
  expect(items).toHaveLength(1);
  return items[0] as Extract<InspectedItem, { kind: K }>;
}

describe('certificates', () => {
  it('summarises a leaf certificate like openssl x509 -text', async () => {
    const { cert } = only(await inspect(F.LEAF_CERT), 'certificate');
    expect(cert.version).toBe(3);
    expect(cert.subject).toBe('CN=test.localkit.dev');
    expect(cert.commonName).toBe('test.localkit.dev');
    expect(cert.issuer).toBe('C=US, O=LocalKit Test, CN=LocalKit Test Intermediate CA');
    expect(cert.issuerParts).toEqual([
      { type: 'C', value: 'US' },
      { type: 'O', value: 'LocalKit Test' },
      { type: 'CN', value: 'LocalKit Test Intermediate CA' },
    ]);
    expect(cert.serial).toBe('0A:BC:DE:F0:12:34:56:78:9A');
    expect(cert.signature).toEqual({ oid: '1.2.840.113549.1.1.11', name: 'SHA-256 with RSA', weak: undefined });
    expect(cert.publicKey.info.label).toBe('EC P-256');
    expect(cert.publicKey.weak).toBeUndefined();
    expect(cert.subjectAltNames).toEqual([
      { type: 'DNS', value: 'test.localkit.dev' },
      { type: 'DNS', value: '*.localkit.dev' },
      { type: 'IP', value: '127.0.0.1' },
      { type: 'IP', value: '::1' },
      { type: 'Email', value: 'admin@localkit.dev' },
      { type: 'URI', value: 'https://localkit.dev/' },
    ]);
    expect(cert.keyUsage).toEqual(['Digital signature']);
    expect(cert.keyUsageCritical).toBe(true);
    expect(cert.extendedKeyUsage.map((e) => e.name)).toEqual(['TLS server authentication', 'TLS client authentication']);
    expect(cert.basicConstraints).toEqual({ ca: false, pathLength: undefined, critical: true });
    expect(cert.subjectKeyId).toBe('35:73:A3:4A:2E:B5:98:55:A0:6C:6A:B3:E1:B5:6D:EF:8E:DB:6D:66');
    expect(cert.authorityKeyId).toBe('30:5C:CC:CF:4F:F1:CD:30:75:82:B0:4A:AE:1E:8D:58:51:17:EA:3E');
    expect(cert.policies).toEqual([{ oid: '2.23.140.1.2.1', name: 'Domain validated (DV)' }]);
    expect(cert.fingerprints).toEqual(F.FINGERPRINTS.LEAF_CERT);
    expect(cert.selfIssued).toBe(false);
    expect(cert.isCA).toBe(false);
    expect(cert.validity).toMatchObject({ status: 'valid', daysLeft: 93, lifetimeDays: 365 });
  });

  it('reports expiry and weak algorithms', async () => {
    const { cert } = only(await inspect(F.EXPIRED_SHA1_CERT), 'certificate');
    expect(cert.validity.status).toBe('expired');
    expect(cert.validity.daysLeft).toBeLessThan(-2000);
    expect(cert.signature.weak).toMatch(/SHA-1/);
    expect(cert.selfIssued).toBe(true);
    expect(cert.selfSigned).toBe(true);
    const future = only(await inspect(F.LEAF_CERT, new Date('2025-06-01T00:00:00Z')), 'certificate');
    expect(future.cert.validity.status).toBe('not-yet-valid');
  });

  it('reads Ed25519 and EC root certificates', async () => {
    const ed = only(await inspect(F.ED25519_CERT), 'certificate').cert;
    expect(ed.signature.name).toBe('Ed25519');
    expect(ed.publicKey.info.label).toBe('Ed25519');
    expect(ed.selfSigned).toBe(true);
    const root = only(await inspect(F.ROOT_CA), 'certificate').cert;
    expect(root.fingerprints).toEqual(F.FINGERPRINTS.ROOT_CA);
    expect(root.isCA).toBe(true);
    expect(root.keyUsage).toEqual(['Certificate signing', 'CRL signing']);
    expect(root.signature.name).toBe('ECDSA with SHA-384');
  });
});

describe('chains', () => {
  it('orders and verifies a pasted chain', async () => {
    const r = await inspect(`${F.LEAF_CERT}\n${F.INTERMEDIATE_CA}\n${F.ROOT_CA}`);
    expect(r.items.map((i) => i.kind)).toEqual(['certificate', 'certificate', 'certificate']);
    expect(r.chain).toMatchObject({ itemOrder: [1, 2, 3], inOrder: true, endsWithRoot: true, missingIssuer: null, unrelated: [] });
    expect(r.chain!.links).toEqual([
      { child: 1, parent: 2, signatureValid: true },
      { child: 2, parent: 3, signatureValid: true },
    ]);
  });

  it('detects wrong order and a missing intermediate', async () => {
    const reversed = await inspect(`${F.ROOT_CA}${F.INTERMEDIATE_CA}${F.LEAF_CERT}`);
    expect(reversed.chain).toMatchObject({ itemOrder: [3, 2, 1], inOrder: false });
    const gap = await inspect(`${F.LEAF_CERT}${F.ROOT_CA}`);
    expect(gap.chain).toMatchObject({ itemOrder: [1], missingIssuer: 'C=US, O=LocalKit Test, CN=LocalKit Test Intermediate CA', unrelated: [2] });
  });

  it('extracts certificates from PKCS#7 bundles', async () => {
    const r = await inspect(F.PKCS7_CHAIN);
    expect(r.items.filter((i) => i.kind === 'certificate')).toHaveLength(2);
    expect(r.items[0].source).toMatch(/certificate 1 of 2 in the PKCS#7 bundle/);
    expect(r.chain?.itemOrder).toEqual([1, 2]);
  });
});

describe('requests, CRLs and keys', () => {
  it('reads CSRs with Unicode subjects and verifies their signature', async () => {
    const { csr } = only(await inspect(F.UTF8_CSR), 'csr');
    expect(csr.subjectParts).toContainEqual({ type: 'O', value: 'Ünïcödé GmbH 🔐' });
    expect(csr.signatureValid).toBe(true);
    expect(csr.subjectAltNames.map((n) => n.value)).toEqual(['api.localkit.dev', 'www.localkit.dev']);
    expect(csr.publicKey.info.label).toBe('RSA 2048-bit');
    expect(csr.hasChallengePassword).toBe(false);
  });

  it('reads CRLs', async () => {
    const { crl } = only(await inspect(F.ROOT_CRL), 'crl');
    expect(crl.issuer).toBe('C=US, O=LocalKit Test, CN=LocalKit Test Root CA');
    expect(crl.revokedCount).toBe(0);
    expect(crl.signature.name).toBe('ECDSA with SHA-384');
    expect(crl.nextUpdate).toBeInstanceOf(Date);
  });

  it('describes public keys with a pin and flags small RSA keys', async () => {
    const pub = only(await inspect(F.EC_SPKI), 'public-key');
    expect(pub.key.info.label).toBe('EC P-256');
    expect(pub.key.pinSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    const pkcs1 = only(await inspect(F.RSA_PKCS1_PUBLIC), 'public-key');
    expect(pkcs1.format).toMatch(/PKCS#1/);
    expect(pkcs1.key.spkiSha256Hex).toBe(only(await inspect(F.RSA_SPKI), 'public-key').key.spkiSha256Hex);
    expect(only(await inspect(F.RSA_1024_SPKI), 'public-key').key.weak).toMatch(/1024-bit/);
  });

  it('recognises private keys without returning key material, and matches them to certificates', async () => {
    const r = await inspect(`${F.LEAF_CERT}${F.EC_SEC1_PRIVATE}${F.RSA_PKCS1_PRIVATE}${F.ED25519_PKCS8_PRIVATE}`);
    expect(r.containsPrivateKey).toBe(true);
    const keys = r.items.filter((i) => i.kind === 'private-key');
    expect(keys.map((k) => k.kind === 'private-key' && k.key.format)).toEqual(['SEC1 (traditional EC)', 'PKCS#1 (traditional RSA)', 'PKCS#8']);
    const json = JSON.stringify(r.items.filter((i) => i.kind === 'private-key'));
    // No private scalar or modulus bytes leak into the summary.
    expect(json.length).toBeLessThan(1500);
    const leafKey = r.items[0].kind === 'certificate' ? r.items[0].cert.publicKey.spkiSha256Hex : '';
    expect(r.keyMatches.get(leafKey)).toEqual([1, 2]);
    const ed = keys[2].kind === 'private-key' ? keys[2].key : null;
    expect(ed?.info?.algorithm).toBe('Ed25519');
    // Web Crypto derives the Ed25519 public key; it matches the Ed25519 certificate.
    const withCert = await inspect(`${F.ED25519_CERT}${F.ED25519_PKCS8_PRIVATE}`);
    const certHash = withCert.items[0].kind === 'certificate' ? withCert.items[0].cert.publicKey.spkiSha256Hex : '';
    expect(withCert.keyMatches.get(certHash)).toEqual([1, 2]);
  });

  it('describes encrypted and OpenSSH private keys', async () => {
    const enc = only(await inspect(F.EC_ENCRYPTED_PKCS8), 'private-key');
    expect(enc.key).toMatchObject({ encrypted: true, encryption: 'PBES2 · PBKDF2 · AES-256-CBC', info: null });
    const legacy = only(await inspect(F.RSA_LEGACY_ENCRYPTED), 'private-key');
    expect(legacy.key).toMatchObject({ encrypted: true, encryption: 'AES-256-CBC' });
    const ssh = only(await inspect(F.OPENSSH_ENCRYPTED_PRIVATE), 'private-key');
    expect(ssh.key).toMatchObject({ format: 'OpenSSH', encrypted: true, sshFingerprint: F.SSH_FINGERPRINTS.ed25519Encrypted });
  });

  it('reads OpenSSH public key lines', async () => {
    const r = await inspect(`${F.OPENSSH_PUBLIC}\n${F.OPENSSH_RSA_PUBLIC}`);
    expect(r.items.map((i) => (i.kind === 'ssh-public-key' ? i.key.fingerprint : null))).toEqual([F.SSH_FINGERPRINTS.ed25519, F.SSH_FINGERPRINTS.rsa]);
  });
});

describe('bad input', () => {
  it('returns null for empty input', async () => {
    expect(await inspectText('   ')).toBeNull();
  });

  it('explains text without anything recognisable', async () => {
    const r = await inspect('hello world');
    expect(r.items).toEqual([]);
    expect(r.problems[0]).toMatch(/No certificate, key or request was found/);
  });

  it('reports damaged blocks individually and keeps the good ones', async () => {
    const truncated = F.LEAF_CERT.split('\n').slice(0, 8).join('\n') + '\n-----END CERTIFICATE-----';
    const r = await inspect(`${truncated}\n${F.ROOT_CA}\n-----BEGIN CERTIFICATE-----\nnot base64 !!\n-----END CERTIFICATE-----\n-----BEGIN PUBLIC KEY-----\nMIIB`);
    expect(r.items[0]).toMatchObject({ kind: 'error' });
    expect(r.items[0].kind === 'error' && r.items[0].error).toMatch(/not valid DER/);
    expect(r.items[1].kind).toBe('certificate');
    expect(r.problems.join('\n')).toMatch(/invalid character/);
    expect(r.problems.join('\n')).toMatch(/no matching “-----END PUBLIC KEY-----”/);
  });

  it('classifies bare Base64 DER and notices wrong labels', async () => {
    const body = F.ROOT_CA.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    expect(only(await inspect(body), 'certificate').source).toBe('Base64 DER');
    const mislabelled = F.UTF8_CSR.replace(/CERTIFICATE REQUEST/g, 'CERTIFICATE');
    expect(only(await inspect(mislabelled), 'csr').source).toMatch(/labelled “CERTIFICATE”/);
  });

  it('explains EC PARAMETERS blocks', async () => {
    const r = await inspect('-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----');
    expect(r.items[0]).toMatchObject({ kind: 'other', title: 'EC parameters' });
    expect(r.items[0].kind === 'other' && r.items[0].message).toMatch(/P-256/);
  });
});

describe('helpers', () => {
  it('formats hex with colons', () => {
    expect(colonHex('abc')).toBe('0A:BC');
    expect(colonHex(Uint8Array.of(1, 255))).toBe('01:FF');
    expect(colonHex('')).toBe('');
  });

  it('computes validity windows', () => {
    const v = validityOf(new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'), NOW);
    expect(v).toMatchObject({ status: 'valid', daysLeft: 92, lifetimeDays: 364 });
  });
});
