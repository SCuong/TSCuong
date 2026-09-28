import { createHMAC, createMD5 } from 'hash-wasm';
import { toBuffer } from '../shared-a/bytes';

export type HmacAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512' | 'SHA-1' | 'MD5';

export const HMAC_ALGORITHMS: Array<{ value: HmacAlgorithm; label: string; bytes: number; weak?: boolean }> = [
  { value: 'SHA-256', label: 'HMAC-SHA256', bytes: 32 },
  { value: 'SHA-384', label: 'HMAC-SHA384', bytes: 48 },
  { value: 'SHA-512', label: 'HMAC-SHA512', bytes: 64 },
  { value: 'SHA-1', label: 'HMAC-SHA1', bytes: 20, weak: true },
  { value: 'MD5', label: 'HMAC-MD5', bytes: 16, weak: true },
];

/**
 * Computes an HMAC. SHA variants use Web Crypto; MD5 (not in Web Crypto) uses hash-wasm.
 *
 * Web Crypto refuses zero-length HMAC keys. An empty key and a single zero
 * byte produce the same padded key block (K is zero-padded to the block size),
 * so we substitute one zero byte to support the empty-key case exactly.
 */
export async function computeHmac(algorithm: HmacAlgorithm, key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (algorithm === 'MD5') {
    const hasher = await createHMAC(createMD5(), key);
    hasher.init();
    hasher.update(message);
    return hasher.digest('binary');
  }
  const rawKey = key.length === 0 ? new Uint8Array(1) : toBuffer(key);
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, toBuffer(message)));
}
