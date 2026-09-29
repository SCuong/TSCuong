/**
 * In-memory hand-off between LocalKit's security tools (e.g. "Verify in decoder" from the JWT
 * generator). Values live only in this page's memory: never in the URL, history or storage.
 */

export interface JwtDecoderHandoff {
  token: string;
  /** HMAC secret as typed, with its encoding. */
  secret?: { value: string; encoding: 'text' | 'hex' | 'base64' };
  /** Public key text (PEM or JWK) for asymmetric algorithms. */
  publicKey?: string;
}

export interface JwtGeneratorHandoff {
  alg: string;
  privateKey: string;
  publicKey?: string;
}

interface Handoffs {
  'jwt-decoder': JwtDecoderHandoff;
  'jwt-generator': JwtGeneratorHandoff;
}

const pending = new Map<keyof Handoffs, unknown>();

export function putHandoff<K extends keyof Handoffs>(target: K, value: Handoffs[K]): void {
  pending.set(target, value);
}

/**
 * Reads a pending hand-off without removing it (safe inside React state initialisers, which
 * StrictMode runs twice). Call `clearHandoff` from an effect once it has been applied.
 */
export function peekHandoff<K extends keyof Handoffs>(target: K): Handoffs[K] | null {
  return (pending.get(target) as Handoffs[K] | undefined) ?? null;
}

export function clearHandoff(target: keyof Handoffs): void {
  pending.delete(target);
}
