/** Byte helpers shared by the encoding tools. */

export const utf8Encoder = new TextEncoder();

export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export type Utf8DecodeResult = { ok: true; text: string } | { ok: false; error: string; offset: number; lossy: string };

/** Strict UTF-8 decode that reports where the first invalid byte sequence starts. */
export function utf8DecodeStrict(bytes: Uint8Array): Utf8DecodeResult {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    const offset = firstInvalidUtf8(bytes);
    return {
      ok: false,
      offset,
      error: `The bytes are not valid UTF-8 text (first invalid byte at offset ${offset}).`,
      lossy: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
    };
  }
}

/** Offset of the first byte that does not start a valid UTF-8 sequence, or -1. */
export function firstInvalidUtf8(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let min: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
    } else return i;
    let cp = b & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += need + 1;
  }
  return -1;
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return out;
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function toHexByte(b: number, upper = false): string {
  const h = b.toString(16).padStart(2, '0');
  return upper ? h.toUpperCase() : h;
}

/** Hex preview like "48 65 6c 6c 6f …" for error messages and previews. */
export function hexPreview(bytes: Uint8Array, max = 32): string {
  const parts = Array.from(bytes.subarray(0, max), (b) => toHexByte(b));
  return parts.join(' ') + (bytes.length > max ? ' …' : '');
}
