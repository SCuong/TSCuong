/** Byte/encoding helpers shared by the hash, checksum, HMAC, AES and bcrypt tools. */

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Parses hex, ignoring whitespace, `:` / `-` separators and an optional `0x` prefix. Returns null when invalid. */
export function hexToBytes(input: string): Uint8Array | null {
  const clean = input.trim().replace(/^0x/i, '').replace(/[\s:-]/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parses standard or URL-safe base64 (padding optional, whitespace ignored). Returns null when invalid. */
export function base64ToBytes(input: string): Uint8Array | null {
  let clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  clean = clean.replace(/=+$/, '');
  if (clean.length % 4 === 1) return null;
  clean += '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export type KeyEncoding = 'text' | 'hex' | 'base64';

export type Decoded = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Decodes user input written as UTF-8 text, hex or base64 into bytes, with a human error message. */
export function decodeInput(value: string, encoding: KeyEncoding, what = 'Value'): Decoded {
  if (encoding === 'text') return { ok: true, bytes: utf8(value) };
  if (encoding === 'hex') {
    const bytes = hexToBytes(value);
    return bytes
      ? { ok: true, bytes }
      : { ok: false, error: `${what} is not valid hex. Use pairs of 0–9 / a–f characters.` };
  }
  const bytes = base64ToBytes(value);
  return bytes ? { ok: true, bytes } : { ok: false, error: `${what} is not valid Base64.` };
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Copies into a fresh ArrayBuffer-backed array (what Web Crypto's BufferSource typing wants). */
export function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** Reads a Blob in fixed-size chunks, reporting progress; aborts between chunks. */
export async function readInChunks(
  blob: Blob,
  onChunk: (chunk: Uint8Array) => void,
  options: { chunkSize?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const { chunkSize = 4 * 1024 * 1024, signal, onProgress } = options;
  const total = blob.size;
  onProgress?.(0, total);
  for (let offset = 0; offset < total; offset += chunkSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const buf = await blob.slice(offset, Math.min(total, offset + chunkSize)).arrayBuffer();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onChunk(new Uint8Array(buf));
    onProgress?.(Math.min(total, offset + chunkSize), total);
    // Let the UI repaint between chunks.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
