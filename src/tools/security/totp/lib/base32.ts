/** RFC 4648 Base32 as used by authenticator apps (A–Z, 2–7; spaces, dashes and padding tolerated). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LOOKALIKES: Record<string, string> = { '0': 'O', '1': 'I', '8': 'B' };

export function encodeBase32(bytes: Uint8Array, padding = false): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  if (padding) while (out.length % 8 !== 0) out += '=';
  return out;
}

export type Base32Result = { ok: true; bytes: Uint8Array; normalized: string } | { ok: false; error: string };

/** Normalises (upper-case, no spaces/dashes/padding) and decodes a Base32 secret. */
export function decodeBase32(input: string): Base32Result {
  const normalized = input.replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase();
  if (!normalized) return { ok: false, error: 'The secret is empty.' };
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (!ALPHABET.includes(ch)) {
      const hint = LOOKALIKES[ch] ? ` Did you mean “${LOOKALIKES[ch]}”?` : '';
      const shown = ch === '=' ? '“=” (padding may only appear at the end)' : `“${ch}”`;
      return { ok: false, error: `${shown} at position ${i + 1} is not a Base32 character; secrets use A–Z and 2–7.${hint}` };
    }
  }
  if ([1, 3, 6].includes(normalized.length % 8)) {
    return { ok: false, error: `A Base32 secret cannot be ${normalized.length} characters long; a character is probably missing or extra.` };
  }
  const out = new Uint8Array(Math.floor((normalized.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const ch of normalized) {
    buffer = ((buffer << 5) | ALPHABET.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return { ok: true, bytes: out, normalized };
}

/** Groups a Base32 secret in blocks of 4 for easier reading/typing. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}
