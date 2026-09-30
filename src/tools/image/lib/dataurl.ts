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

/** Decode the character references that can appear in an HTML attribute value. */
function decodeHtmlAttr(v: string): string {
  return v.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : _;
  });
}

/** Accept pasted CSS (`background: url(...)`), HTML (`<img src="...">`), Markdown or quoted strings. */
export function unwrap(input: string): string {
  let text = input.trim();
  const src = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/is.exec(text);
  if (src) return decodeHtmlAttr(src[2].trim());
  const md = /^!\[[^\]]*\]\((.*)\)$/s.exec(text);
  if (md) {
    const dest = md[1].trim();
    const angled = /^<(.*)>(?:\s+["'(].*)?$/s.exec(dest);
    if (angled) return angled[1].trim();
    // Drop an optional title: ![alt](url "title")
    return dest.replace(/\s+(["'(]).*$/s, '').trim();
  }
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

/**
 * URL-encoded (non-Base64) SVG data URL: usually smaller than Base64 for SVG.
 * The result never contains `"`, `\`, `<`, `>` or line breaks, so it can be
 * dropped into CSS `url("…")` and HTML attributes as is.
 */
export function svgToDataUrl(svg: string): string {
  let text = svg.replace(/^\uFEFF/, '').trim();
  // Whitespace is insignificant in SVG markup unless the document preserves it.
  const preserves = /xml:space\s*=\s*["']preserve|white-space\s*:\s*(pre|break-spaces)/i.test(text);
  text = preserves ? text.replace(/\r\n?/g, '\n') : text.replace(/[ \t\r\n]+/g, ' ');
  // Swapping " for ' keeps the URL short. It is only safe when the SVG has no ' of its own
  // (e.g. font-family="'Open Sans'") and no " in its text, where the swap would change what is shown.
  const textContent = text.replace(/<[^>]*>/g, '');
  const swap = !text.includes("'") && !textContent.includes('"');
  const encoded = (swap ? text.replace(/"/g, "'") : text).replace(/[%#<>"\\{}\n\t]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return `data:image/svg+xml,${encoded}`;
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function snippets(dataUrl: string, alt = '') {
  // Markdown link destinations cannot contain spaces or unbalanced parentheses.
  const mdUrl = dataUrl.replace(/[ ()]/g, (c) => (c === ' ' ? '%20' : c === '(' ? '%28' : '%29'));
  return {
    dataUrl,
    css: `background-image: url("${dataUrl.replace(/["\\]/g, '\\$&')}");`,
    html: `<img src="${escapeAttr(dataUrl)}" alt="${escapeAttr(alt)}" />`,
    markdown: `![${alt.replace(/[[\]\\]/g, '')}](${mdUrl})`,
  };
}

export function extensionFor(format: ImageFormat | null, declaredMime: string | null): string {
  if (format) return FORMAT_INFO[format].ext;
  const sub = declaredMime?.split('/')[1]?.replace('+xml', '').replace('jpeg', 'jpg');
  return sub && /^[a-z0-9.-]{1,8}$/.test(sub) ? sub : 'bin';
}
