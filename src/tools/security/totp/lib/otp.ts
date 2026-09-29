/** HOTP (RFC 4226) and TOTP (RFC 6238) with Web Crypto HMAC. */

export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface TotpOptions {
  algorithm: OtpAlgorithm;
  digits: number;
  /** Time step in seconds (usually 30). */
  period: number;
  /** Unix time the counter starts at (usually 0). */
  t0?: number;
}

export const DEFAULT_TOTP: TotpOptions = { algorithm: 'SHA-1', digits: 6, period: 30, t0: 0 };

const keyCache = new WeakMap<Uint8Array, Map<OtpAlgorithm, Promise<CryptoKey>>>();

function hmacKey(secret: Uint8Array, algorithm: OtpAlgorithm): Promise<CryptoKey> {
  let byAlg = keyCache.get(secret);
  if (!byAlg) {
    byAlg = new Map();
    keyCache.set(secret, byAlg);
  }
  let key = byAlg.get(algorithm);
  if (!key) {
    key = crypto.subtle.importKey('raw', new Uint8Array(secret), { name: 'HMAC', hash: algorithm }, false, ['sign']);
    byAlg.set(algorithm, key);
  }
  return key;
}

/** RFC 4226 dynamic truncation of an HMAC result to `digits` decimal digits. */
export function truncate(mac: Uint8Array, digits: number): string {
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export async function hotp(secret: Uint8Array, counter: number | bigint, digits = 6, algorithm: OtpAlgorithm = 'SHA-1'): Promise<string> {
  if (secret.length === 0) throw new Error('The secret is empty.');
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new RangeError('Codes have 6 to 8 digits.');
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, algorithm), message));
  return truncate(mac, digits);
}

/** The TOTP counter (time step number) for a Unix time in seconds. */
export function counterAt(timeSeconds: number, period = 30, t0 = 0): number {
  return Math.floor((timeSeconds - t0) / period);
}

/** Seconds until the current code changes. */
export function secondsRemaining(timeSeconds: number, period = 30, t0 = 0): number {
  const elapsed = (((timeSeconds - t0) % period) + period) % period;
  return period - elapsed;
}

export function totp(secret: Uint8Array, timeSeconds: number, options: TotpOptions = DEFAULT_TOTP): Promise<string> {
  return hotp(secret, counterAt(timeSeconds, options.period, options.t0 ?? 0), options.digits, options.algorithm);
}

/**
 * Checks a code against the time steps within ±`window` of now. Returns the matching step offset
 * (0 = current, -1 = previous, +1 = next) or null. Comparison is constant-time per candidate.
 */
export async function verifyTotp(secret: Uint8Array, code: string, timeSeconds: number, options: TotpOptions = DEFAULT_TOTP, window = 1): Promise<number | null> {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== options.digits) return null;
  const counter = counterAt(timeSeconds, options.period, options.t0 ?? 0);
  let match: number | null = null;
  for (let offset = -window; offset <= window; offset++) {
    if (counter + offset < 0) continue;
    const expected = await hotp(secret, counter + offset, options.digits, options.algorithm);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ clean.charCodeAt(i);
    if (diff === 0 && match === null) match = offset;
  }
  return match;
}
