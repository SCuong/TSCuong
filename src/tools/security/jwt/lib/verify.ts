/** JWS signature verification with jose (signature only; claims are evaluated separately). */

import { compactVerify, errors, exportJWK, importJWK, importPKCS8, importSPKI, importX509 } from 'jose';
import { OTHER_ALGORITHMS, jwsAlgorithm, type JwsAlgorithmInfo } from './algorithms';
import type { DecodedJws } from './decode';
import { jwkInfo, jwkRestriction, keyMismatch, publicJwk, type Jwk, type KeyMaterial } from './keys';

export type VerifyStatus = 'verified' | 'invalid' | 'error';

export interface VerifyOutcome {
  status: VerifyStatus;
  title: string;
  detail: string;
  notes: string[];
}

export type VerifyKey = { kind: 'secret'; bytes: Uint8Array } | { kind: 'material'; material: KeyMaterial };

type ImportedKey = CryptoKey | Uint8Array;

const COULD_NOT = 'Could not verify';

function failure(detail: string, notes: string[] = []): VerifyOutcome {
  return { status: 'error', title: COULD_NOT, detail, notes };
}

/** Maps library and Web Crypto errors to a sentence. */
export function explainKeyError(error: unknown, alg: string): string {
  if (error instanceof errors.JOSENotSupported) {
    return /key format|curve/i.test(error.message)
      ? `This key type or curve cannot be used with ${alg} in this browser.`
      : `${alg} is not supported by this browser.`;
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotSupportedError') return `This browser’s Web Crypto does not support the key or algorithm needed for ${alg}.`;
    if (error.name === 'DataError') return 'The key data is invalid or does not match the algorithm.';
    return `The browser rejected the key (${error.name}).`;
  }
  if (error instanceof Error) {
    const m = error.message;
    if (/modulusLength/.test(m)) return `${alg} requires an RSA key of at least 2048 bits.`;
    if (/namedCurve/.test(m)) return `The key’s curve does not match ${alg}.`;
    if (/must be a public JWK|must be a private JWK/.test(m)) return m;
    return m;
  }
  return 'The key could not be used.';
}

async function importForVerify(material: Exclude<KeyMaterial, { format: 'jwks' }>, alg: JwsAlgorithmInfo, notes: string[]): Promise<ImportedKey> {
  switch (material.format) {
    case 'spki':
      return importSPKI(material.pem, alg.alg);
    case 'certificate':
      return importX509(material.pem, alg.alg);
    case 'pkcs8': {
      const priv = await importPKCS8(material.pem, alg.alg, { extractable: true });
      const jwk = publicJwk((await exportJWK(priv)) as Jwk);
      notes.push('You pasted a private key; its public half was used. Only the public key is needed to verify.');
      return importJWK(jwk as Parameters<typeof importJWK>[0], alg.alg);
    }
    case 'jwk': {
      if (material.isPrivate) notes.push('You pasted a private JWK; its public members were used. Only the public key is needed to verify.');
      return importJWK(publicJwk(material.jwk) as Parameters<typeof importJWK>[0], alg.alg);
    }
  }
}

async function checkSignature(token: string, key: ImportedKey, alg: string): Promise<boolean> {
  try {
    await compactVerify(token, key, { algorithms: [alg] });
    return true;
  } catch (e) {
    if (e instanceof errors.JWSSignatureVerificationFailed) return false;
    throw e;
  }
}

function jwkLabel(jwk: Jwk, index: number, total: number): string {
  const kid = typeof jwk.kid === 'string' ? `kid “${jwk.kid}”` : 'no kid';
  return `key ${index + 1} of ${total} (${kid}, ${jwkInfo(jwk).label})`;
}

/** Keys of a JWK Set that could have produced this signature, best matches first. */
export function jwksCandidates(keys: Jwk[], alg: JwsAlgorithmInfo, kid: unknown): { candidates: Array<{ jwk: Jwk; index: number }>; kidMatched: boolean } {
  const usable = keys
    .map((jwk, index) => ({ jwk, index }))
    .filter(({ jwk }) => {
      if (jwk.use !== undefined && jwk.use !== 'sig') return false;
      if (typeof jwk.alg === 'string' && jwk.alg !== alg.alg) return false;
      if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) return false;
      return keyMismatch(alg, jwkInfo(jwk)) === null;
    });
  if (typeof kid === 'string') {
    const byKid = usable.filter(({ jwk }) => jwk.kid === kid);
    if (byKid.length) return { candidates: byKid, kidMatched: true };
  }
  return { candidates: usable, kidMatched: false };
}

/** Verifies the signature of a decoded JWS with a secret or a key. Never throws. */
export async function verifyJws(decoded: DecodedJws, key: VerifyKey): Promise<VerifyOutcome> {
  const alg = decoded.alg;
  if (!alg) return failure('The token does not name its algorithm (“alg”), so there is nothing to verify against.');
  if (alg.toLowerCase() === 'none') {
    return failure('The token is unsecured (alg “none”): it has no signature. Reject it.');
  }
  const info = jwsAlgorithm(alg);
  if (!info) {
    return failure(`“${alg}” is not a supported signature algorithm${OTHER_ALGORITHMS[alg] ? ` (${OTHER_ALGORITHMS[alg]})` : ''}.`);
  }
  if (decoded.payload.kind === 'detached') {
    return failure('The payload is detached (the middle part is empty), so the signature cannot be checked without it.');
  }
  if (decoded.signature.length === 0) return failure('The signature part is empty.');

  const notes: string[] = [];
  const verified = (detail: string): VerifyOutcome => ({ status: 'verified', title: 'Signature verified', detail, notes });
  const invalid = (detail: string): VerifyOutcome => ({ status: 'invalid', title: 'Invalid signature', detail, notes });

  if (info.family === 'HMAC') {
    if (key.kind !== 'secret') return failure(`${alg} is verified with a shared secret, not a public key.`);
    if (key.bytes.length === 0) return failure('Enter the secret to verify the signature.');
    if (info.minSecretBytes && key.bytes.length < info.minSecretBytes) {
      notes.push(
        `The secret is ${key.bytes.length} byte${key.bytes.length === 1 ? '' : 's'}; RFC 7518 requires at least ${info.minSecretBytes} bytes (${info.minSecretBytes * 8} bits) for ${alg}. Short secrets can be brute-forced offline from any token.`,
      );
    }
    try {
      // Copy: jose checks `instanceof Uint8Array`, which fails for arrays from another realm (e.g. jsdom's TextEncoder).
      return (await checkSignature(decoded.token, new Uint8Array(key.bytes), alg))
        ? verified('The token was signed with this secret and has not been changed since.')
        : invalid('The signature does not match: the token was modified, or it was signed with a different secret (check the secret encoding too).');
    } catch (e) {
      return failure(explainKeyError(e, alg), notes);
    }
  }

  if (key.kind === 'secret') return failure(`${alg} is verified with a public key, not a shared secret.`);
  const material = key.material;

  if (material.format === 'jwks') {
    const { candidates, kidMatched } = jwksCandidates(material.keys, info, decoded.header.kid);
    if (candidates.length === 0) {
      const kids = material.keys.map((k) => (typeof k.kid === 'string' ? k.kid : null)).filter(Boolean);
      return failure(
        `None of the ${material.keys.length} keys in the set can verify ${alg}${
          typeof decoded.header.kid === 'string' ? ` with kid “${decoded.header.kid}”` : ''
        }.${kids.length ? ` Key IDs in the set: ${kids.map((k) => `“${k}”`).join(', ')}.` : ''}`,
      );
    }
    if (typeof decoded.header.kid === 'string' && !kidMatched) {
      notes.push(`No key in the set has kid “${decoded.header.kid}”, so every compatible key was tried.`);
    }
    let lastError: string | null = null;
    for (const { jwk, index } of candidates) {
      try {
        const imported = await importJWK(publicJwk(jwk) as Parameters<typeof importJWK>[0], alg);
        if (await checkSignature(decoded.token, imported, alg)) {
          return verified(`The token was signed with the private key matching ${jwkLabel(jwk, index, material.keys.length)}.`);
        }
      } catch (e) {
        lastError = explainKeyError(e, alg);
      }
    }
    if (lastError && candidates.length === 1) return failure(lastError, notes);
    return invalid(
      candidates.length === 1
        ? `The signature does not match ${jwkLabel(candidates[0].jwk, candidates[0].index, material.keys.length)}: the token was modified or signed with a different key.`
        : `None of the ${candidates.length} compatible keys in the set matches the signature.`,
    );
  }

  const mismatch =
    material.format === 'jwk'
      ? (jwkRestriction(material.jwk, alg) ?? keyMismatch(info, material.info))
      : keyMismatch(info, material.info);
  if (mismatch) return failure(mismatch);

  let imported: ImportedKey;
  try {
    imported = await importForVerify(material, info, notes);
  } catch (e) {
    return failure(explainKeyError(e, alg), notes);
  }
  try {
    return (await checkSignature(decoded.token, imported, alg))
      ? verified(`The token was signed with the private key matching this ${material.info.label} ${material.format === 'certificate' ? 'certificate' : 'public key'}.`)
      : invalid('The signature does not match: the token was modified, or it was signed with a different key.');
  } catch (e) {
    return failure(explainKeyError(e, alg), notes);
  }
}
