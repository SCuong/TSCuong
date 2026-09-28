import { bcrypt, bcryptVerify } from 'hash-wasm';
import { randomBytes, utf8 } from '../shared-a/bytes';

export const MIN_COST = 4;
export const MAX_COST = 15;
export const DEFAULT_COST = 10;
/** bcrypt only uses the first 72 bytes of the password. */
export const MAX_PASSWORD_BYTES = 72;

export interface BcryptParts {
  version: '2a' | '2b' | '2y';
  cost: number;
  /** 22 characters of bcrypt-base64 (16 bytes). */
  salt: string;
  /** 31 characters of bcrypt-base64 (23 bytes). */
  hash: string;
}

export type ParseBcryptResult = { ok: true; value: BcryptParts } | { ok: false; error: string };

/** Validates and splits a modular-crypt bcrypt hash like `$2b$10$<22 salt><31 hash>`. */
export function parseBcryptHash(input: string): ParseBcryptResult {
  const hash = input.trim();
  if (!hash.startsWith('$2')) {
    return { ok: false, error: 'A bcrypt hash starts with $2a$, $2b$ or $2y$.' };
  }
  const m = /^\$(2[a-z]?)\$/.exec(hash);
  if (!m || !['2a', '2b', '2y'].includes(m[1])) {
    const v = m?.[1] ?? hash.slice(1, 3);
    return {
      ok: false,
      error:
        v === '2x'
          ? '$2x$ hashes come from an old buggy implementation and are not supported.'
          : `Unsupported bcrypt version "$${v}$". Expected $2a$, $2b$ or $2y$.`,
    };
  }
  const rest = /^\$(2[aby])\$(\d{2})\$(.*)$/.exec(hash);
  if (!rest) return { ok: false, error: 'The cost factor must be two digits, like $2b$10$.' };
  const cost = Number(rest[2]);
  if (cost < 4 || cost > 31) return { ok: false, error: `Cost ${cost} is out of range (bcrypt allows 04–31).` };
  const body = rest[3];
  if (!/^[./A-Za-z0-9]*$/.test(body)) {
    return { ok: false, error: 'The salt and hash may only contain letters, digits, "." and "/".' };
  }
  if (body.length !== 53) {
    return {
      ok: false,
      error: `The salt + hash part should be 53 characters, but it is ${body.length}. The whole hash is 60 characters long.`,
    };
  }
  return {
    ok: true,
    value: { version: rest[1] as BcryptParts['version'], cost, salt: body.slice(0, 22), hash: body.slice(22) },
  };
}

export interface PreparedPassword {
  bytes: Uint8Array;
  byteLength: number;
  /** True when the password is longer than 72 bytes and only its first 72 bytes count. */
  truncated: boolean;
}

/** UTF-8 encodes a password and applies bcrypt's 72-byte limit (like OpenBSD/most libraries do). */
export function preparePassword(password: string): PreparedPassword {
  const bytes = utf8(password);
  return {
    bytes: bytes.length > MAX_PASSWORD_BYTES ? bytes.slice(0, MAX_PASSWORD_BYTES) : bytes,
    byteLength: bytes.length,
    truncated: bytes.length > MAX_PASSWORD_BYTES,
  };
}

export function clampCost(cost: number): number {
  return Math.min(MAX_COST, Math.max(MIN_COST, Math.round(cost)));
}

/** Hashes a password with a fresh random 16-byte salt. Output uses the `$2b$` prefix. */
export async function bcryptHash(password: string, cost: number, salt: Uint8Array = randomBytes(16)): Promise<string> {
  const prepared = preparePassword(password);
  if (prepared.bytes.length === 0) throw new Error('Enter a password to hash.');
  if (!Number.isInteger(cost) || cost < MIN_COST || cost > MAX_COST) {
    throw new Error(`Cost must be between ${MIN_COST} and ${MAX_COST}.`);
  }
  const encoded = await bcrypt({ password: prepared.bytes, salt, costFactor: cost, outputType: 'encoded' });
  // hash-wasm emits $2a$; its algorithm is the fixed ($2b$) variant, so label it as such.
  return encoded.replace(/^\$2a\$/, '$2b$');
}

/** Checks a password against a bcrypt hash ($2a$, $2b$ and $2y$ are equivalent for valid inputs). */
export async function bcryptCheck(password: string, hash: string): Promise<boolean> {
  const parsed = parseBcryptHash(hash);
  if (!parsed.ok) throw new Error(parsed.error);
  const prepared = preparePassword(password);
  if (prepared.bytes.length === 0) throw new Error('Enter the password to check.');
  const normalized = `$2a$${String(parsed.value.cost).padStart(2, '0')}$${parsed.value.salt}${parsed.value.hash}`;
  return bcryptVerify({ password: prepared.bytes, hash: normalized });
}

/**
 * Rough duration estimate for a cost factor: bcrypt time doubles per cost step.
 * `msAtCost10` is measured on this device when available.
 */
export function estimateMs(cost: number, msAtCost10 = 80): number {
  return msAtCost10 * 2 ** (cost - 10);
}
