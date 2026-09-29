/** Object identifiers used by the key, certificate and JWT tools. */

export const OID = {
  rsaEncryption: '1.2.840.113549.1.1.1',
  rsassaPss: '1.2.840.113549.1.1.10',
  rsaesOaep: '1.2.840.113549.1.1.7',
  ecPublicKey: '1.2.840.10045.2.1',
  ed25519: '1.3.101.112',
  ed448: '1.3.101.113',
  x25519: '1.3.101.110',
  x448: '1.3.101.111',
  dsa: '1.2.840.10040.4.1',
  dh: '1.2.840.113549.1.3.1',
  dhX942: '1.2.840.10046.2.1',
  pbes2: '1.2.840.113549.1.5.13',
  pkcs7SignedData: '1.2.840.113549.1.7.2',
  pkcs7Data: '1.2.840.113549.1.7.1',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  p521: '1.3.132.0.35',
} as const;

/** Named elliptic curves: OID → display name (Web Crypto name where one exists). */
export const CURVES: Record<string, { name: string; bits: number; webCrypto?: 'P-256' | 'P-384' | 'P-521' }> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', bits: 256, webCrypto: 'P-256' },
  '1.3.132.0.34': { name: 'P-384', bits: 384, webCrypto: 'P-384' },
  '1.3.132.0.35': { name: 'P-521', bits: 521, webCrypto: 'P-521' },
  '1.3.132.0.10': { name: 'secp256k1', bits: 256 },
  '1.2.840.10045.3.1.1': { name: 'P-192', bits: 192 },
  '1.3.132.0.33': { name: 'P-224', bits: 224 },
  '1.3.36.3.3.2.8.1.1.7': { name: 'brainpoolP256r1', bits: 256 },
  '1.3.36.3.3.2.8.1.1.11': { name: 'brainpoolP384r1', bits: 384 },
  '1.3.36.3.3.2.8.1.1.13': { name: 'brainpoolP512r1', bits: 512 },
  '1.2.156.10197.1.301': { name: 'SM2', bits: 256 },
};

/** Public key algorithm OIDs → display name. */
export const KEY_ALGORITHMS: Record<string, string> = {
  [OID.rsaEncryption]: 'RSA',
  [OID.rsassaPss]: 'RSA-PSS',
  [OID.rsaesOaep]: 'RSA-OAEP',
  [OID.ecPublicKey]: 'EC',
  [OID.ed25519]: 'Ed25519',
  [OID.ed448]: 'Ed448',
  [OID.x25519]: 'X25519',
  [OID.x448]: 'X448',
  [OID.dsa]: 'DSA',
  [OID.dh]: 'DH',
  [OID.dhX942]: 'DH (X9.42)',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
  '2.16.840.1.101.3.4.4.1': 'ML-KEM-512',
  '2.16.840.1.101.3.4.4.2': 'ML-KEM-768',
  '2.16.840.1.101.3.4.4.3': 'ML-KEM-1024',
  '1.2.156.10197.1.301': 'SM2',
};

/** Signature algorithm OIDs → display name. */
export const SIGNATURE_ALGORITHMS: Record<string, { name: string; weak?: string }> = {
  '1.2.840.113549.1.1.2': { name: 'MD2 with RSA', weak: 'MD2 is broken' },
  '1.2.840.113549.1.1.4': { name: 'MD5 with RSA', weak: 'MD5 is broken; collisions are practical' },
  '1.2.840.113549.1.1.5': { name: 'SHA-1 with RSA', weak: 'SHA-1 is deprecated; collisions are practical' },
  '1.2.840.113549.1.1.14': { name: 'SHA-224 with RSA' },
  '1.2.840.113549.1.1.11': { name: 'SHA-256 with RSA' },
  '1.2.840.113549.1.1.12': { name: 'SHA-384 with RSA' },
  '1.2.840.113549.1.1.13': { name: 'SHA-512 with RSA' },
  '1.2.840.113549.1.1.10': { name: 'RSASSA-PSS' },
  '1.2.840.10045.4.1': { name: 'ECDSA with SHA-1', weak: 'SHA-1 is deprecated' },
  '1.2.840.10045.4.3.1': { name: 'ECDSA with SHA-224' },
  '1.2.840.10045.4.3.2': { name: 'ECDSA with SHA-256' },
  '1.2.840.10045.4.3.3': { name: 'ECDSA with SHA-384' },
  '1.2.840.10045.4.3.4': { name: 'ECDSA with SHA-512' },
  '1.3.101.112': { name: 'Ed25519' },
  '1.3.101.113': { name: 'Ed448' },
  '1.2.840.10040.4.3': { name: 'DSA with SHA-1', weak: 'DSA with SHA-1 is deprecated' },
  '2.16.840.1.101.3.4.3.1': { name: 'DSA with SHA-224' },
  '2.16.840.1.101.3.4.3.2': { name: 'DSA with SHA-256' },
  '2.16.840.1.101.3.4.3.17': { name: 'ML-DSA-44' },
  '2.16.840.1.101.3.4.3.18': { name: 'ML-DSA-65' },
  '2.16.840.1.101.3.4.3.19': { name: 'ML-DSA-87' },
  '1.2.156.10197.1.501': { name: 'SM2 with SM3' },
};

/** Hash OIDs (used inside RSASSA-PSS parameters). */
export const HASH_ALGORITHMS: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.4': 'SHA-224',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

/** Encryption schemes seen in encrypted PKCS#8 keys. */
export const ENCRYPTION_ALGORITHMS: Record<string, string> = {
  '1.2.840.113549.1.5.13': 'PBES2',
  '1.2.840.113549.1.5.12': 'PBKDF2',
  '2.16.840.1.101.3.4.1.2': 'AES-128-CBC',
  '2.16.840.1.101.3.4.1.22': 'AES-192-CBC',
  '2.16.840.1.101.3.4.1.42': 'AES-256-CBC',
  '1.2.840.113549.3.7': '3DES-CBC',
  '1.3.14.3.2.7': 'DES-CBC',
  '1.2.840.113549.1.12.1.3': 'PBE with SHA-1 and 3DES',
  '1.2.840.113549.1.12.1.6': 'PBE with SHA-1 and RC2-40',
  '1.2.840.113549.1.5.3': 'PBE with MD5 and DES',
  '1.2.840.113549.1.5.10': 'PBE with SHA-1 and DES',
  '1.3.6.1.4.1.11591.4.11': 'scrypt',
};
