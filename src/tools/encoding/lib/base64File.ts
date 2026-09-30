import { bytesToBase64, describeBadBase64Char } from './base64';

/** Multiple of 3 so chunk outputs concatenate into one valid Base64 string. */
export const ENCODE_CHUNK = 3 * 256 * 1024;
/** Multiple of 4 so chunk inputs decode independently. */
export const DECODE_CHUNK = 4 * 256 * 1024;

export interface ChunkContext {
  signal?: AbortSignal;
  progress?: (fraction: number) => void;
  /** Called between chunks so the UI can repaint. */
  yieldFn?: () => Promise<void>;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/** Base64-encode a Blob in chunks, reporting progress. */
export async function blobToBase64(blob: Blob, ctx: ChunkContext = {}): Promise<string> {
  const parts: string[] = [];
  for (let offset = 0; offset < blob.size; offset += ENCODE_CHUNK) {
    checkAbort(ctx.signal);
    const buf = new Uint8Array(await blob.slice(offset, offset + ENCODE_CHUNK).arrayBuffer());
    parts.push(bytesToBase64(buf));
    ctx.progress?.(Math.min(1, (offset + buf.length) / blob.size));
    if (ctx.yieldFn) await ctx.yieldFn();
  }
  return parts.join('');
}

export interface ParsedBase64Payload {
  /** Base64 characters only (standard alphabet, no whitespace, no padding issues). */
  base64: string;
  /** MIME type declared by a data URL prefix, if any. */
  declaredMime: string | null;
}

export type ParsePayloadResult = ({ ok: true } & ParsedBase64Payload) | { ok: false; error: string };

/** Accepts raw Base64, Base64url or a data URL; validates and normalizes it. */
export function parseBase64Payload(input: string): ParsePayloadResult {
  let text = input.trim();
  let prefix = input.length - input.trimStart().length;
  let declaredMime: string | null = null;
  const data = /^data:([^,]*?),/i.exec(text);
  if (data) {
    const meta = data[1].split(';');
    if (!meta.some((m) => m.trim().toLowerCase() === 'base64')) {
      return { ok: false, error: 'This data URL is not Base64-encoded (it has no ";base64" marker).' };
    }
    declaredMime = meta[0].trim().toLowerCase() || null;
    text = text.slice(data[0].length);
    prefix += data[0].length;
  }
  let clean = text.replace(/\s+/g, '');
  if (!clean) return { ok: false, error: 'There is no Base64 data to decode.' };
  const bad = /[^A-Za-z0-9+/\-_=\s]/.exec(text);
  if (bad) return { ok: false, error: describeBadBase64Char(input, prefix + bad.index) };
  if (/[-_]/.test(clean)) {
    if (/[+/]/.test(clean)) return { ok: false, error: 'Invalid Base64: mixes the standard (+ /) and URL-safe (- _) alphabets.' };
    clean = clean.replace(/-/g, '+').replace(/_/g, '/');
  }
  const pad = clean.indexOf('=');
  if (pad !== -1) {
    if (!/^=+$/.test(clean.slice(pad)) || clean.length - pad > 2) {
      return { ok: false, error: 'Invalid Base64: padding "=" can only appear at the end.' };
    }
    clean = clean.slice(0, pad);
  }
  if (clean.length % 4 === 1) return { ok: false, error: 'Invalid Base64: the data length is not valid. The text may be truncated.' };
  clean = clean.padEnd(Math.ceil(clean.length / 4) * 4, '=');
  return { ok: true, base64: clean, declaredMime };
}

/** Decode normalized Base64 (from `parseBase64Payload`) to bytes in chunks. */
export async function base64ToBytes(base64: string, ctx: ChunkContext = {}): Promise<Uint8Array> {
  const total = Math.floor((base64.replace(/=+$/, '').length * 3) / 4);
  const out = new Uint8Array(total);
  let pos = 0;
  for (let offset = 0; offset < base64.length; offset += DECODE_CHUNK) {
    checkAbort(ctx.signal);
    const binary = atob(base64.slice(offset, offset + DECODE_CHUNK));
    for (let i = 0; i < binary.length; i++) out[pos++] = binary.charCodeAt(i);
    ctx.progress?.(Math.min(1, (offset + DECODE_CHUNK) / base64.length));
    if (ctx.yieldFn) await ctx.yieldFn();
  }
  return pos === total ? out : out.subarray(0, pos);
}

export function toDataUrl(base64: string, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${base64}`;
}
