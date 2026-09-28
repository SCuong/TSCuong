/** Data URL / Base64 helpers for the image ⇄ data URL tools. */
import { FORMAT_INFO, sniffImageFormat, type ImageFormat } from './formats';

export interface ParsedDataUrl {
  bytes: Uint8Array;
  /** MIME declared in the data URL (if any). */
  declaredMime: string | null;
  /** Format detected from the decoded bytes. */
  detected: ImageFormat | null;
  wasDataUrl: boolean;
}

export class DataUrlError extends Error {}

function base64ToBytes(b64: string): Uint8Array {
  let clean = b64.replace(/[\s\r\n]+/g, '');
  // Accept URL-safe base64 too.
  clean = clean.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new DataUrlError('The Base64 data contains invalid characters.');
  }
  const rem = clean.replace(/=+$/, '').length % 4;
  if (rem === 1) throw new DataUrlError('The Base64 data has an invalid length (it may be truncated).');
  if (rem) clean = clean.replace(/=+$/, '') + '='.repeat(4 - rem);
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    throw new DataUrlError('The Base64 data could not be decoded.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Accept pasted CSS (`background: url(...)`), HTML (`<img src="...">`), Markdown or quoted strings. */
export function unwrap(input: string): string {
  let text = input.trim();
  const src = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/is.exec(text);
  if (src) return src[2].trim();
  const md = /^!\[[^\]]*\]\((.*)\)$/s.exec(text);
  if (md) return md[1].trim();
  text = text.replace(/^background(-image)?\s*:\s*/i, '').replace(/;\s*$/, '').trim();
  const url = /^url\(\s*(["']?)(.*)\1\s*\)$/is.exec(text);
  if (url) text = url[2];
  const quoted = /^(["'])(.*)\1$/s.exec(text);
  if (quoted) text = quoted[2];
  return text.trim();
}

/** Parse a `data:` URL or bare Base64 string into bytes and detect the image type. */
export function parseDataUrl(input: string): ParsedDataUrl {
  const text = unwrap(input);
  if (!text) throw new DataUrlError('Paste a data URL or Base64 string.');
  let bytes: Uint8Array;
  let declaredMime: string | null = null;
  let wasDataUrl = false;
  if (/^data:/i.test(text)) {
    wasDataUrl = true;
    const comma = text.indexOf(',');
    if (comma < 0) throw new DataUrlError('This data URL has no comma separating the header from the data.');
    const header = text.slice(5, comma);
    const payload = text.slice(comma + 1);
    const parts = header.split(';').map((p) => p.trim());
    declaredMime = parts[0] ? parts[0].toLowerCase() : null;
    const isBase64 = parts.slice(1).some((p) => p.toLowerCase() === 'base64');
    if (isBase64) bytes = base64ToBytes(payload);
    else {
      let decoded: string;
      try {
        decoded = decodeURIComponent(payload);
      } catch {
        throw new DataUrlError('The data URL contains invalid percent-encoding.');
      }
      bytes = new TextEncoder().encode(decoded);
    }
  } else {
    bytes = base64ToBytes(text);
  }
  if (bytes.length === 0) throw new DataUrlError('The data is empty.');
  return { bytes, declaredMime, detected: sniffImageFormat(bytes), wasDataUrl };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** URL-encoded (non-Base64) SVG data URL: usually smaller than Base64 for SVG. */
export function svgToDataUrl(svg: string): string {
  const encoded = svg
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/{/g, '%7B')
    .replace(/}/g, '%7D');
  return `data:image/svg+xml,${encoded}`;
}

export function snippets(dataUrl: string, alt = '') {
  const safeAlt = alt.replace(/"/g, '&quot;');
  return {
    dataUrl,
    css: `background-image: url("${dataUrl}");`,
    html: `<img src="${dataUrl}" alt="${safeAlt}" />`,
    markdown: `![${alt.replace(/[[\]]/g, '')}](${dataUrl})`,
  };
}

export function extensionFor(format: ImageFormat | null, declaredMime: string | null): string {
  if (format) return FORMAT_INFO[format].ext;
  const sub = declaredMime?.split('/')[1]?.replace('+xml', '').replace('jpeg', 'jpg');
  return sub && /^[a-z0-9.-]{1,8}$/.test(sub) ? sub : 'bin';
}
