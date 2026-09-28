import { base64ToBytes, bytesToBase64Url, randomBytes, toBuffer, utf8, utf8Decode } from '../shared-a/bytes';

/**
 * Passphrase-based AES-256-GCM encryption with a self-describing envelope.
 *
 * Binary envelope (used for files):
 *   magic "LKAES" (5) | version (1) | kdf id (1) | PBKDF2 iterations (u32 BE)
 *   | salt (16) | iv (12) | AES-GCM ciphertext + 16-byte tag
 * The 39-byte header is authenticated as AES-GCM additional data, so any change
 * to it (e.g. the iteration count) makes decryption fail.
 *
 * Text envelope (same fields, copy-paste friendly):
 *   lkaes1.pbkdf2-sha256.<iterations>.<salt b64url>.<iv b64url>.<ciphertext b64url>
 *
 * Plaintext payload inside the ciphertext: kind (1 byte: 0 = text, 1 = file),
 * then text as UTF-8, or for files: u16 name length, name, u16 type length, type, bytes.
 * The file name is therefore encrypted too.
 */

export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 10_000_000;
const MAGIC = utf8('LKAES');
const VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const HEADER_LEN = MAGIC.length + 2 + 4 + SALT_LEN + IV_LEN; // 39
const TAG_LEN = 16;
export const TEXT_PREFIX = 'lkaes1';
/** Web Crypto AES-GCM is one-shot, so the whole file must fit in memory (a few times over). */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

export const WRONG_PASSPHRASE = 'Wrong passphrase or the data was modified.';

export class AesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AesError';
  }
}

export type Plain = { kind: 'text'; text: string } | { kind: 'file'; name: string; type: string; data: Uint8Array };

interface Envelope {
  iterations: number;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function header(iterations: number, salt: Uint8Array, iv: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_LEN);
  out.set(MAGIC, 0);
  out[5] = VERSION;
  out[6] = KDF_PBKDF2_SHA256;
  new DataView(out.buffer).setUint32(7, iterations);
  out.set(salt, 11);
  out.set(iv, 11 + SALT_LEN);
  return out;
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', toBuffer(utf8(passphrase.normalize('NFC'))), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBuffer(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function encodePlain(plain: Plain): Uint8Array {
  if (plain.kind === 'text') {
    const text = utf8(plain.text);
    const out = new Uint8Array(1 + text.length);
    out[0] = 0;
    out.set(text, 1);
    return out;
  }
  const name = utf8(plain.name).slice(0, 0xffff);
  const type = utf8(plain.type).slice(0, 0xffff);
  const out = new Uint8Array(1 + 2 + name.length + 2 + type.length + plain.data.length);
  const view = new DataView(out.buffer);
  let o = 0;
  out[o++] = 1;
  view.setUint16(o, name.length);
  o += 2;
  out.set(name, o);
  o += name.length;
  view.setUint16(o, type.length);
  o += 2;
  out.set(type, o);
  o += type.length;
  out.set(plain.data, o);
  return out;
}

function decodePlain(bytes: Uint8Array): Plain {
  const corrupt = () => new AesError('The decrypted data has an unexpected layout.');
  if (bytes.length < 1) throw corrupt();
  if (bytes[0] === 0) return { kind: 'text', text: utf8Decode(bytes.subarray(1)) };
  if (bytes[0] !== 1) throw corrupt();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 1;
  if (bytes.length < o + 2) throw corrupt();
  const nameLen = view.getUint16(o);
  o += 2;
  if (bytes.length < o + nameLen + 2) throw corrupt();
  const name = utf8Decode(bytes.subarray(o, o + nameLen));
  o += nameLen;
  const typeLen = view.getUint16(o);
  o += 2;
  if (bytes.length < o + typeLen) throw corrupt();
  const type = utf8Decode(bytes.subarray(o, o + typeLen));
  o += typeLen;
  return { kind: 'file', name: name || 'decrypted', type, data: bytes.slice(o) };
}

export interface EncryptOptions {
  iterations?: number;
  /** For deterministic tests only. */
  salt?: Uint8Array;
  iv?: Uint8Array;
}

async function encryptEnvelope(plain: Plain, passphrase: string, options: EncryptOptions = {}): Promise<Envelope> {
  if (!passphrase) throw new AesError('Enter a passphrase.');
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new AesError(`Iterations must be between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}.`);
  }
  const salt = options.salt ?? randomBytes(SALT_LEN);
  const iv = options.iv ?? randomBytes(IV_LEN);
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(header(iterations, salt, iv)), tagLength: 128 },
      key,
      toBuffer(encodePlain(plain)),
    ),
  );
  return { iterations, salt, iv, ciphertext };
}

async function decryptEnvelope(env: Envelope, passphrase: string): Promise<Plain> {
  if (!passphrase) throw new AesError('Enter the passphrase.');
  const key = await deriveKey(passphrase, env.salt, env.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBuffer(env.iv),
        additionalData: toBuffer(header(env.iterations, env.salt, env.iv)),
        tagLength: 128,
      },
      key,
      toBuffer(env.ciphertext),
    );
  } catch {
    throw new AesError(WRONG_PASSPHRASE);
  }
  return decodePlain(new Uint8Array(plain));
}

function checkIterations(iterations: number) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new AesError(`This data asks for ${iterations} key-derivation iterations, which is outside the supported range.`);
  }
}

// ---------------------------------------------------------------- text form

export function serializeText(env: Envelope): string {
  return [
    TEXT_PREFIX,
    'pbkdf2-sha256',
    String(env.iterations),
    bytesToBase64Url(env.salt),
    bytesToBase64Url(env.iv),
    bytesToBase64Url(env.ciphertext),
  ].join('.');
}

export function parseText(input: string): Envelope {
  const clean = input.replace(/\s+/g, '');
  const parts = clean.split('.');
  if (parts[0] !== TEXT_PREFIX) {
    throw new AesError(`This isn't LocalKit encrypted text. It should start with "${TEXT_PREFIX}.".`);
  }
  if (parts.length !== 6) throw new AesError('The encrypted text is incomplete. Make sure you copied all of it.');
  if (parts[1] !== 'pbkdf2-sha256') throw new AesError(`Unsupported key derivation "${parts[1]}".`);
  if (!/^\d+$/.test(parts[2])) throw new AesError('The iteration count in the encrypted text is not a number.');
  const iterations = Number(parts[2]);
  checkIterations(iterations);
  const salt = base64ToBytes(parts[3]);
  const iv = base64ToBytes(parts[4]);
  const ciphertext = base64ToBytes(parts[5]);
  if (!salt || salt.length !== SALT_LEN || !iv || iv.length !== IV_LEN || !ciphertext || ciphertext.length < TAG_LEN) {
    throw new AesError('The encrypted text is damaged (bad salt, IV or ciphertext). Make sure you copied all of it.');
  }
  return { iterations, salt, iv, ciphertext };
}

export function looksLikeTextEnvelope(input: string): boolean {
  return input.trimStart().startsWith(`${TEXT_PREFIX}.`);
}

// -------------------------------------------------------------- binary form

export function serializeBinary(env: Envelope): Uint8Array<ArrayBuffer> {
  const head = header(env.iterations, env.salt, env.iv);
  const out = new Uint8Array(head.length + env.ciphertext.length);
  out.set(head, 0);
  out.set(env.ciphertext, head.length);
  return out;
}

export function isBinaryEnvelope(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

export function parseBinary(bytes: Uint8Array): Envelope {
  if (!isBinaryEnvelope(bytes)) throw new AesError('This file was not encrypted with this tool (missing LKAES header).');
  if (bytes.length < HEADER_LEN + TAG_LEN) throw new AesError('The encrypted file is truncated.');
  if (bytes[5] !== VERSION) throw new AesError(`Unsupported format version ${bytes[5]}.`);
  if (bytes[6] !== KDF_PBKDF2_SHA256) throw new AesError('Unsupported key derivation in this file.');
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(7);
  checkIterations(iterations);
  return {
    iterations,
    salt: bytes.slice(11, 11 + SALT_LEN),
    iv: bytes.slice(11 + SALT_LEN, HEADER_LEN),
    ciphertext: bytes.slice(HEADER_LEN),
  };
}

// --------------------------------------------------------------- public API

export async function encryptText(text: string, passphrase: string, options?: EncryptOptions): Promise<string> {
  return serializeText(await encryptEnvelope({ kind: 'text', text }, passphrase, options));
}

export async function decryptText(input: string, passphrase: string): Promise<string> {
  const plain = await decryptEnvelope(parseText(input), passphrase);
  if (plain.kind !== 'text') throw new AesError('This contains an encrypted file. Use File mode to decrypt it.');
  return plain.text;
}

export async function encryptFile(
  file: { name: string; type: string; data: Uint8Array },
  passphrase: string,
  options?: EncryptOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  return serializeBinary(await encryptEnvelope({ kind: 'file', ...file }, passphrase, options));
}

/** Decrypts a binary envelope, or a text envelope saved to a file. */
export async function decryptBytes(bytes: Uint8Array, passphrase: string): Promise<Plain> {
  if (isBinaryEnvelope(bytes)) return decryptEnvelope(parseBinary(bytes), passphrase);
  const asText = utf8Decode(bytes.subarray(0, 64));
  if (looksLikeTextEnvelope(asText)) return decryptEnvelope(parseText(utf8Decode(bytes)), passphrase);
  throw new AesError('This file was not encrypted with this tool (missing LKAES header).');
}

/** Iterations stored in an envelope (for showing progress text before deriving). */
export function envelopeIterations(input: string | Uint8Array): number | null {
  try {
    if (typeof input === 'string') return parseText(input).iterations;
    return isBinaryEnvelope(input) ? parseBinary(input).iterations : null;
  } catch {
    return null;
  }
}

/** Name for the decrypted copy when the envelope has none. */
export function encryptedFileName(name: string): string {
  return `${name || 'file'}.lkenc`;
}
