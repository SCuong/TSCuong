export type EscapeFormat = 'js' | 'es6' | 'python32' | 'utf8hex' | 'html' | 'htmlDec' | 'uplus' | 'css';

export const ESCAPE_FORMATS: Array<{ value: EscapeFormat; label: string; example: string }> = [
  { value: 'js', label: '\\uXXXX', example: '\\u00e9 \\ud83d\\ude00' },
  { value: 'es6', label: '\\u{X}', example: '\\u{e9} \\u{1f600}' },
  { value: 'python32', label: '\\UXXXXXXXX', example: '\\u00e9 \\U0001f600' },
  { value: 'utf8hex', label: '\\xXX (UTF-8)', example: '\\xc3\\xa9' },
  { value: 'html', label: '&#xX;', example: '&#xE9; &#x1F600;' },
  { value: 'htmlDec', label: '&#N;', example: '&#233; &#128512;' },
  { value: 'uplus', label: 'U+XXXX', example: 'U+00E9 U+1F600' },
  { value: 'css', label: 'CSS \\XX', example: '\\e9 \\1f600' },
];

export type EscapeScope = 'nonAscii' | 'nonPrintable' | 'all';

export interface UnicodeEscapeOptions {
  format: EscapeFormat;
  /** nonAscii: everything above U+007E. nonPrintable: non-ASCII + ASCII control characters. all: every character. */
  scope: EscapeScope;
  uppercase: boolean;
}

function hex(n: number, width: number, upper: boolean): string {
  const h = n.toString(16).padStart(width, '0');
  return upper ? h.toUpperCase() : h;
}

function escapeCodePoint(cp: number, next: string | undefined, o: UnicodeEscapeOptions): string {
  const up = o.uppercase;
  switch (o.format) {
    case 'js':
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        return `\\u${hex(0xd800 + (v >> 10), 4, up)}\\u${hex(0xdc00 + (v & 0x3ff), 4, up)}`;
      }
      return `\\u${hex(cp, 4, up)}`;
    case 'es6':
      return `\\u{${hex(cp, 0, up)}}`;
    case 'python32':
      return cp > 0xffff ? `\\U${hex(cp, 8, up)}` : `\\u${hex(cp, 4, up)}`;
    case 'utf8hex':
      return Array.from(new TextEncoder().encode(String.fromCodePoint(cp)), (b) => `\\x${hex(b, 2, up)}`).join('');
    case 'html':
      return `&#x${hex(cp, 0, true)};`;
    case 'htmlDec':
      return `&#${cp};`;
    case 'uplus':
      return `U+${hex(cp, 4, true)}`;
    case 'css': {
      // A space terminates the escape when the next character could be read as part of it.
      const needsSpace = next !== undefined && /[0-9a-fA-F\s]/.test(next);
      return `\\${hex(cp, 2, up)}${needsSpace ? ' ' : ''}`;
    }
  }
}

function shouldEscape(cp: number, scope: EscapeScope): boolean {
  if (scope === 'all') return true;
  if (cp > 0x7e) return true;
  if (scope === 'nonPrintable') return (cp < 0x20 && cp !== 0x0a && cp !== 0x0d && cp !== 0x09) || cp === 0x7f;
  return false;
}

export function escapeUnicode(text: string, o: UnicodeEscapeOptions): string {
  const chars = Array.from(text);
  if (o.format === 'uplus') {
    // U+ notation is a list of code points; with every character escaped they are separated by spaces.
    return chars
      .map((c) => {
        const cp = c.codePointAt(0)!;
        return shouldEscape(cp, o.scope) ? `U+${hex(cp, 4, true)}` : c;
      })
      .join(o.scope === 'all' ? ' ' : '');
  }
  let out = '';
  chars.forEach((c, i) => {
    const cp = c.codePointAt(0)!;
    out += shouldEscape(cp, o.scope) ? escapeCodePoint(cp, chars[i + 1], o) : c;
  });
  return out;
}

export interface UnescapeResult {
  text: string;
  /** Number of escape sequences decoded. */
  count: number;
  warnings: string[];
}

const UNESCAPE_RE = new RegExp(
  [
    String.raw`\\u\{([0-9a-fA-F]{1,6})\}`, // 1: ES6
    String.raw`\\u([0-9a-fA-F]{4})`, // 2: \uXXXX
    String.raw`\\U([0-9a-fA-F]{8})`, // 3: \UXXXXXXXX
    String.raw`((?:\\x[0-9a-fA-F]{2})+)`, // 4: run of \xXX bytes
    String.raw`&#[xX]([0-9a-fA-F]{1,6});`, // 5: &#xX;
    String.raw`&#([0-9]{1,7});`, // 6: &#N;
    String.raw`[Uu]\+([0-9a-fA-F]{4,6})(?![0-9a-fA-F])`, // 7: U+XXXX
    // 8: CSS \XX…XXXXXX with at least two hex digits (or the newline \A), optional terminating space. A single
    // digit is left alone so that JavaScript escapes such as \b, \f and \0 are not misread as CSS.
    String.raw`\\([0-9a-fA-F]{2,6}|[aA](?![0-9a-fA-F])) ?`,
  ].join('|'),
  'g',
);

const UPLUS_LIST = /^\s*(?:[Uu]\+[0-9a-fA-F]{4,6}\s*)+$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function surrogateWarning(text: string): string[] {
  return LONE_SURROGATE.test(text)
    ? ['The result contains an unpaired surrogate (half of a \\uXXXX pair), which is not a valid character.']
    : [];
}

export interface UnescapeOptions {
  /** Decode CSS-style \XX escapes (turn off for text with Windows paths like C:\dev). */
  css: boolean;
  /** Decode U+XXXX notation. */
  uplus: boolean;
}

/** Decode every supported escape style found in the text, combining surrogate pairs. */
export function unescapeUnicode(text: string, opts: Partial<UnescapeOptions> = {}): UnescapeResult {
  const o = { css: true, uplus: true, ...opts };

  // A pure U+ list ("U+0048 U+0069") is a sequence of code points: the separators are not part of the text.
  if (o.uplus && UPLUS_LIST.test(text)) {
    const cps = text.trim().split(/\s+/).map((t) => parseInt(t.slice(2), 16));
    if (cps.every((cp) => cp <= 0x10ffff)) {
      const decoded = String.fromCodePoint(...cps);
      return { text: decoded, count: cps.length, warnings: surrogateWarning(decoded) };
    }
  }

  const warnings = new Set<string>();
  let count = 0;
  const fromCp = (cp: number, raw: string) => {
    if (cp > 0x10ffff) {
      warnings.add(`${raw.trim()} is beyond the last Unicode code point (U+10FFFF) and was left as is.`);
      return raw;
    }
    count++;
    return String.fromCodePoint(cp);
  };
  const out = text.replace(
    UNESCAPE_RE,
    (m: string, es6?: string, u4?: string, u8?: string, xRun?: string, htmlHex?: string, htmlDec?: string, uplus?: string, css?: string) => {
      if (es6) return fromCp(parseInt(es6, 16), m);
      if (u4) {
        count++;
        return String.fromCharCode(parseInt(u4, 16));
      }
      if (u8) return fromCp(parseInt(u8, 16), m);
      if (xRun) {
        const bytes = Uint8Array.from(xRun.split('\\x').filter(Boolean), (h) => parseInt(h, 16));
        count += bytes.length;
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          warnings.add('Some \\x byte sequences are not valid UTF-8, so they were read as Latin-1 characters.');
          return String.fromCharCode(...bytes);
        }
      }
      if (htmlHex) return fromCp(parseInt(htmlHex, 16), m);
      if (htmlDec) return fromCp(parseInt(htmlDec, 10), m);
      if (uplus) return o.uplus ? fromCp(parseInt(uplus, 16), m) : m;
      if (css) return o.css ? fromCp(parseInt(css, 16), m) : m;
      return m;
    },
  );
  for (const w of surrogateWarning(out)) warnings.add(w);
  return { text: out, count, warnings: Array.from(warnings) };
}

export interface UnicodeEscapeSettings extends UnicodeEscapeOptions {
  /** Unescape only: decode CSS escapes. */
  css: boolean;
}

/** Escape (encode) or unescape (decode) in one call, so large texts can be processed in a worker. */
export function convertUnicodeEscapes(text: string, direction: 'encode' | 'decode', settings: UnicodeEscapeSettings): UnescapeResult {
  if (direction === 'encode') return { text: escapeUnicode(text, settings), count: 0, warnings: [] };
  return unescapeUnicode(text, { css: settings.css });
}
