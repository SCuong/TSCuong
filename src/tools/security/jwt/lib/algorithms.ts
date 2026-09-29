/** JOSE algorithm and header parameter metadata (RFC 7515, 7516, 7518, 8037, 9864). */

export type JwsFamily = 'HMAC' | 'RSA' | 'RSA-PSS' | 'ECDSA' | 'EdDSA';

export interface JwsAlgorithmInfo {
  alg: string;
  family: JwsFamily;
  description: string;
  /** Hash used by the algorithm (for display). */
  hash?: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /** Required curve for ECDSA. */
  curve?: 'P-256' | 'P-384' | 'P-521';
  /** Expected raw signature length in bytes, when fixed. */
  signatureBytes?: number;
  /** Minimum HMAC key length recommended by RFC 7518 §3.2 (bytes). */
  minSecretBytes?: number;
}

export const JWS_ALGORITHMS: JwsAlgorithmInfo[] = [
  { alg: 'HS256', family: 'HMAC', hash: 'SHA-256', description: 'HMAC using SHA-256 (shared secret)', signatureBytes: 32, minSecretBytes: 32 },
  { alg: 'HS384', family: 'HMAC', hash: 'SHA-384', description: 'HMAC using SHA-384 (shared secret)', signatureBytes: 48, minSecretBytes: 48 },
  { alg: 'HS512', family: 'HMAC', hash: 'SHA-512', description: 'HMAC using SHA-512 (shared secret)', signatureBytes: 64, minSecretBytes: 64 },
  { alg: 'RS256', family: 'RSA', hash: 'SHA-256', description: 'RSASSA-PKCS1-v1_5 using SHA-256' },
  { alg: 'RS384', family: 'RSA', hash: 'SHA-384', description: 'RSASSA-PKCS1-v1_5 using SHA-384' },
  { alg: 'RS512', family: 'RSA', hash: 'SHA-512', description: 'RSASSA-PKCS1-v1_5 using SHA-512' },
  { alg: 'PS256', family: 'RSA-PSS', hash: 'SHA-256', description: 'RSASSA-PSS using SHA-256 and MGF1 with SHA-256' },
  { alg: 'PS384', family: 'RSA-PSS', hash: 'SHA-384', description: 'RSASSA-PSS using SHA-384 and MGF1 with SHA-384' },
  { alg: 'PS512', family: 'RSA-PSS', hash: 'SHA-512', description: 'RSASSA-PSS using SHA-512 and MGF1 with SHA-512' },
  { alg: 'ES256', family: 'ECDSA', hash: 'SHA-256', curve: 'P-256', description: 'ECDSA using P-256 and SHA-256', signatureBytes: 64 },
  { alg: 'ES384', family: 'ECDSA', hash: 'SHA-384', curve: 'P-384', description: 'ECDSA using P-384 and SHA-384', signatureBytes: 96 },
  { alg: 'ES512', family: 'ECDSA', hash: 'SHA-512', curve: 'P-521', description: 'ECDSA using P-521 and SHA-512', signatureBytes: 132 },
  { alg: 'EdDSA', family: 'EdDSA', description: 'EdDSA signature (Ed25519)', signatureBytes: 64 },
  { alg: 'Ed25519', family: 'EdDSA', description: 'EdDSA using Ed25519 (fully specified, RFC 9864)', signatureBytes: 64 },
];

const BY_ALG = new Map(JWS_ALGORITHMS.map((a) => [a.alg, a]));

export function jwsAlgorithm(alg: string | null | undefined): JwsAlgorithmInfo | undefined {
  return alg ? BY_ALG.get(alg) : undefined;
}

/** Other algorithm identifiers people meet in the wild, with an explanation. */
export const OTHER_ALGORITHMS: Record<string, string> = {
  none: 'No digital signature or MAC (unsecured JWT)',
  ES256K: 'ECDSA using secp256k1 and SHA-256 (not supported by Web Crypto)',
  Ed448: 'EdDSA using Ed448 (not supported by Web Crypto)',
  'ML-DSA-44': 'ML-DSA-44 post-quantum signature',
  'ML-DSA-65': 'ML-DSA-65 post-quantum signature',
  'ML-DSA-87': 'ML-DSA-87 post-quantum signature',
  // JWE key management
  RSA1_5: 'RSAES-PKCS1-v1_5 key encryption (deprecated)',
  'RSA-OAEP': 'RSAES-OAEP key encryption (SHA-1)',
  'RSA-OAEP-256': 'RSAES-OAEP key encryption using SHA-256',
  'RSA-OAEP-384': 'RSAES-OAEP key encryption using SHA-384',
  'RSA-OAEP-512': 'RSAES-OAEP key encryption using SHA-512',
  A128KW: 'AES-128 key wrap',
  A192KW: 'AES-192 key wrap',
  A256KW: 'AES-256 key wrap',
  dir: 'Direct use of a shared symmetric key',
  'ECDH-ES': 'Elliptic-curve Diffie-Hellman ephemeral-static key agreement',
  'ECDH-ES+A128KW': 'ECDH-ES with AES-128 key wrap',
  'ECDH-ES+A192KW': 'ECDH-ES with AES-192 key wrap',
  'ECDH-ES+A256KW': 'ECDH-ES with AES-256 key wrap',
  A128GCMKW: 'AES-128-GCM key wrap',
  A192GCMKW: 'AES-192-GCM key wrap',
  A256GCMKW: 'AES-256-GCM key wrap',
  'PBES2-HS256+A128KW': 'Password-based key wrap (PBES2, HMAC-SHA-256, AES-128)',
  'PBES2-HS384+A192KW': 'Password-based key wrap (PBES2, HMAC-SHA-384, AES-192)',
  'PBES2-HS512+A256KW': 'Password-based key wrap (PBES2, HMAC-SHA-512, AES-256)',
};

/** JWE content encryption algorithms ("enc"). */
export const JWE_ENCRYPTION: Record<string, string> = {
  'A128CBC-HS256': 'AES-128-CBC with HMAC-SHA-256',
  'A192CBC-HS384': 'AES-192-CBC with HMAC-SHA-384',
  'A256CBC-HS512': 'AES-256-CBC with HMAC-SHA-512',
  A128GCM: 'AES-128-GCM',
  A192GCM: 'AES-192-GCM',
  A256GCM: 'AES-256-GCM',
};

export function describeAlgorithm(alg: string): string | undefined {
  return jwsAlgorithm(alg)?.description ?? OTHER_ALGORITHMS[alg];
}

export interface HeaderParamDoc {
  name: string;
  description: string;
}

/** Registered JOSE header parameters. */
export const HEADER_PARAMS: Record<string, HeaderParamDoc> = {
  alg: { name: 'Algorithm', description: 'How the token is signed (JWS) or how the content key is protected (JWE).' },
  typ: { name: 'Type', description: 'Media type of the whole token, usually "JWT".' },
  cty: { name: 'Content type', description: 'Media type of the payload; "JWT" means the payload is itself a nested token.' },
  kid: { name: 'Key ID', description: 'Hint telling the verifier which key was used.' },
  jku: { name: 'JWK Set URL', description: 'URL of a key set containing the verification key.' },
  jwk: { name: 'JSON Web Key', description: 'The public key embedded in the header.' },
  x5u: { name: 'X.509 URL', description: 'URL of the certificate chain for the key.' },
  x5c: { name: 'X.509 certificate chain', description: 'Base64 DER certificates for the signing key.' },
  x5t: { name: 'X.509 SHA-1 thumbprint', description: 'Base64URL SHA-1 fingerprint of the certificate.' },
  'x5t#S256': { name: 'X.509 SHA-256 thumbprint', description: 'Base64URL SHA-256 fingerprint of the certificate.' },
  crit: { name: 'Critical', description: 'Header extensions the recipient must understand.' },
  b64: { name: 'Base64URL-encode payload', description: 'false means the payload is not encoded (RFC 7797).' },
  enc: { name: 'Encryption', description: 'Content encryption algorithm (JWE).' },
  zip: { name: 'Compression', description: 'Compression applied before encryption (JWE).' },
  epk: { name: 'Ephemeral public key', description: 'Sender key for ECDH-ES key agreement (JWE).' },
  apu: { name: 'Agreement PartyUInfo', description: 'ECDH-ES producer information (JWE).' },
  apv: { name: 'Agreement PartyVInfo', description: 'ECDH-ES recipient information (JWE).' },
  iv: { name: 'Initialization vector', description: 'IV for AES-GCM key wrapping (JWE).' },
  tag: { name: 'Authentication tag', description: 'Tag for AES-GCM key wrapping (JWE).' },
  p2s: { name: 'PBES2 salt', description: 'Salt input for password-based key wrapping (JWE).' },
  p2c: { name: 'PBES2 count', description: 'PBKDF2 iteration count (JWE).' },
};
