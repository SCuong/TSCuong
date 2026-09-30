/** Display names for the encodings the CSV reader can pick on its own. */
export const ENCODING_NAMES: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252 (Western)',
};

/**
 * Identify a text file's encoding from its first bytes: a byte order mark, or the zero bytes of
 * mostly-ASCII UTF-16 text without one (Excel's "Unicode Text" export is UTF-16 LE). Returns null
 * when the bytes say nothing definite.
 */
export function sniffEncoding(bytes: Uint8Array): { encoding: string; bom: boolean } | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', bom: true };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bom: true };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bom: true };
  const n = bytes.length - (bytes.length % 2);
  if (n < 8) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  const pairs = n / 2;
  // Mostly-ASCII UTF-16 text has a zero in every other byte and almost none in the others.
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return { encoding: 'utf-16le', bom: false };
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return { encoding: 'utf-16be', bom: false };
  return null;
}

/** Counts U+FFFD replacement characters (undecodable bytes) and other non-ASCII characters in decoded text. */
export function decodeQuality(text: string): { replaced: number; nonAscii: number } {
  let replaced = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xfffd) replaced++;
    else if (c > 0x7f && c !== 0xfeff) nonAscii++;
  }
  return { replaced, nonAscii };
}
