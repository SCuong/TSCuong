export type EscapeLanguage = 'json' | 'js' | 'java' | 'c' | 'sql' | 'regex' | 'shell' | 'csv' | 'xml';

export const ESCAPE_LANGUAGES: Array<{ value: EscapeLanguage; label: string; hint: string }> = [
  { value: 'json', label: 'JSON string', hint: 'Escapes " \\ and control characters; \\uXXXX for the rest.' },
  { value: 'js', label: 'JavaScript', hint: "Escapes quotes, backslashes, line breaks and control characters (\\n, \\t, \\x.., \\u....)." },
  { value: 'java', label: 'Java / C#', hint: 'Escapes " \\ and control characters; \\uXXXX for non-printable characters.' },
  { value: 'c', label: 'C / C++', hint: 'Escapes quotes and control characters; non-ASCII becomes UTF-8 octal bytes.' },
  { value: 'sql', label: 'SQL string', hint: "Doubles single quotes (O'Brien → O''Brien)." },
  { value: 'regex', label: 'Regular expression', hint: 'Escapes . * + ? ^ $ { } ( ) | [ ] \\ / so the text matches literally.' },
  { value: 'shell', label: 'Shell (single-quoted)', hint: "Wraps in '…' and turns ' into '\\'' for POSIX shells." },
  { value: 'csv', label: 'CSV field', hint: 'Quotes the field when needed and doubles inner quotes (RFC 4180).' },
  { value: 'xml', label: 'XML / HTML', hint: 'Escapes & < > " and \' as entities.' },
];

export interface EscapeOptions {
  /** Wrap the result in the language's quotes (JSON, JS, Java, C, SQL). */
  wrap: boolean;
  /** Escape every non-ASCII character too (JSON, JS, Java). */
  asciiOnly: boolean;
  /** JavaScript: which quote to escape/wrap with. */
  quote: '"' | "'" | '`';
}

export const DEFAULT_ESCAPE_OPTIONS: EscapeOptions = { wrap: false, asciiOnly: false, quote: '"' };

const u4 = (code: number) => `\\u${code.toString(16).padStart(4, '0')}`;

function escapeUtf16(ch: string, asciiOnly: boolean): string | null {
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) || code === 0x2028 || code === 0x2029) return u4(code);
  if (asciiOnly && code > 0x7e) {
    return Array.from({ length: ch.length }, (_, i) => u4(ch.charCodeAt(i))).join('');
  }
  return null;
}

function escapeJson(text: string, o: EscapeOptions): string {
  let out = '';
  for (const ch of text) {
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      default: out += escapeUtf16(ch, o.asciiOnly) ?? ch;
    }
  }
  return o.wrap ? `"${out}"` : out;
}

function escapeJs(text: string, o: EscapeOptions): string {
  const q = o.quote;
  let out = '';
  const chars = Array.from(text);
  chars.forEach((ch, i) => {
    switch (ch) {
      case '\\': out += '\\\\'; return;
      case '\n': out += '\\n'; return;
      case '\r': out += '\\r'; return;
      case '\t': out += '\\t'; return;
      case '\b': out += '\\b'; return;
      case '\f': out += '\\f'; return;
      case '\v': out += '\\v'; return;
      case '\0': out += /[0-9]/.test(chars[i + 1] ?? '') ? '\\x00' : '\\0'; return;
    }
    if (ch === q) {
      out += `\\${q}`;
      return;
    }
    if (q === '`' && ch === '$' && chars[i + 1] === '{') {
      out += '\\$';
      return;
    }
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
      return;
    }
    out += escapeUtf16(ch, o.asciiOnly) ?? ch;
  });
  return o.wrap ? `${q}${out}${q}` : out;
}

function escapeJava(text: string, o: EscapeOptions): string {
  let out = '';
  for (const ch of text) {
    switch (ch) {
      case '"': out += '\\"'; break;
      case "'": out += "\\'"; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      default: out += escapeUtf16(ch, o.asciiOnly) ?? ch;
    }
  }
  return o.wrap ? `"${out}"` : out;
}

function escapeC(text: string, o: EscapeOptions): string {
  let out = '';
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    switch (b) {
      case 0x22: out += '\\"'; break;
      case 0x27: out += "\\'"; break;
      case 0x5c: out += '\\\\'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0d: out += '\\r'; break;
      case 0x09: out += '\\t'; break;
      case 0x08: out += '\\b'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0b: out += '\\v'; break;
      case 0x07: out += '\\a'; break;
      case 0x3f:
        // Avoid accidental trigraphs like ??=
        out += bytes[i + 1] === 0x3f ? '\\?' : '?';
        break;
      default:
        // Octal escapes are always exactly 3 digits, so they never swallow a following digit (unlike \x).
        out += b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b);
    }
  }
  return o.wrap ? `"${out}"` : out;
}

function escapeCsv(text: string): string {
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function escapeString(text: string, lang: EscapeLanguage, opts: Partial<EscapeOptions> = {}): string {
  const o = { ...DEFAULT_ESCAPE_OPTIONS, ...opts };
  switch (lang) {
    case 'json':
      return escapeJson(text, o);
    case 'js':
      return escapeJs(text, o);
    case 'java':
      return escapeJava(text, o);
    case 'c':
      return escapeC(text, o);
    case 'sql': {
      const body = text.replace(/'/g, "''");
      return o.wrap ? `'${body}'` : body;
    }
    case 'regex':
      return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    case 'shell':
      return `'${text.replace(/'/g, `'\\''`)}'`;
    case 'csv':
      return escapeCsv(text);
    case 'xml':
      return escapeXml(text);
  }
}

/* ------------------------------------------------------------------------ */
/* Unescape                                                                 */
/* ------------------------------------------------------------------------ */

export type UnescapeResult = { ok: true; text: string } | { ok: false; error: string };

class UnescapeError extends Error {}

function fail(message: string, index: number): never {
  throw new UnescapeError(`${message} at position ${index + 1}.`);
}

function stripQuotes(text: string, quotes: string[]): string {
  const t = text.trim();
  for (const q of quotes) {
    if (t.length >= 2 * q.length && t.startsWith(q) && t.endsWith(q)) return t.slice(q.length, -q.length);
  }
  return text;
}

type Dialect = 'json' | 'js' | 'java' | 'c';

/** Backslash-escape decoder shared by JSON, JavaScript, Java/C# and C. */
function unescapeBackslashes(text: string, dialect: Dialect): string {
  let out = '';
  let bytes: number[] = []; // pending raw bytes (C octal/hex escapes are bytes)
  const flush = () => {
    if (!bytes.length) return;
    const arr = Uint8Array.from(bytes);
    try {
      out += new TextDecoder('utf-8', { fatal: true }).decode(arr);
    } catch {
      out += String.fromCharCode(...arr);
    }
    bytes = [];
  };
  const emit = (s: string) => {
    flush();
    out += s;
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (dialect === 'json' && ch !== '\\' && text.charCodeAt(i) < 0x20) {
      fail('JSON strings cannot contain raw control characters (use \\n, \\t, …)', i);
    }
    if (ch !== '\\') {
      emit(ch);
      i++;
      continue;
    }
    const start = i;
    const e = text[i + 1];
    if (e === undefined) fail('Dangling backslash', start);
    i += 2;
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
    if (dialect !== 'json') Object.assign(simple, { "'": "'", v: '\v' });
    if (dialect === 'c' || dialect === 'java') Object.assign(simple, { a: '\x07', '?': '?' });
    if (dialect === 'java') simple.s = ' ';
    if (dialect === 'js') simple['`'] = '`';
    if (dialect === 'js') simple.$ = '$';

    if (e in simple && !(dialect === 'c' && e === '/')) {
      emit(simple[e]);
      continue;
    }
    if (e === 'u') {
      if (dialect === 'js' && text[i] === '{') {
        const close = text.indexOf('}', i);
        const hex = close === -1 ? '' : text.slice(i + 1, close);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) fail('Invalid \\u{…} escape', start);
        emit(String.fromCodePoint(parseInt(hex, 16)));
        i = close + 1;
        continue;
      }
      if (dialect === 'java') while (text[i] === 'u') i++; // Java allows \uuuu0041
      const hex = text.slice(i, i + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('\\u must be followed by 4 hex digits', start);
      emit(String.fromCharCode(parseInt(hex, 16)));
      i += 4;
      continue;
    }
    if (e === 'U' && (dialect === 'c' || dialect === 'java')) {
      const hex = text.slice(i, i + 8);
      if (!/^[0-9a-fA-F]{8}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) fail('\\U must be followed by 8 hex digits', start);
      emit(String.fromCodePoint(parseInt(hex, 16)));
      i += 8;
      continue;
    }
    if (e === 'x' && dialect !== 'json') {
      const m = (dialect === 'js' ? /^[0-9a-fA-F]{2}/ : dialect === 'java' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]+/).exec(text.slice(i));
      if (!m) fail('\\x must be followed by hex digits', start);
      const value = parseInt(m[0], 16);
      i += m[0].length;
      if (dialect === 'c') {
        if (value > 0xff) fail('\\x escape is out of range for a byte', start);
        bytes.push(value);
      } else emit(String.fromCharCode(value));
      continue;
    }
    if (/[0-7]/.test(e) && dialect !== 'json') {
      if (dialect === 'js' && e === '0' && !/[0-9]/.test(text[i] ?? '')) {
        emit('\0');
        continue;
      }
      const m = /^[0-7]{0,2}/.exec(text.slice(i))!;
      const digits = e + m[0];
      const value = parseInt(digits, 8);
      if (value > 0xff) {
        // Java: \4xx is only two digits
        const short = digits.slice(0, 2);
        i += short.length - 1;
        if (dialect === 'c') bytes.push(parseInt(short, 8));
        else emit(String.fromCharCode(parseInt(short, 8)));
        continue;
      }
      i += m[0].length;
      if (dialect === 'c') bytes.push(value);
      else emit(String.fromCharCode(value));
      continue;
    }
    if (dialect === 'js' && (e === '\n' || e === '\r' || e === '\u2028' || e === '\u2029')) {
      // Line continuation.
      if (e === '\r' && text[i] === '\n') i++;
      flush();
      continue;
    }
    if (dialect === 'js') {
      // Non-escape characters stand for themselves in sloppy-mode JavaScript.
      emit(e);
      continue;
    }
    fail(`Unknown escape sequence "\\${e}"`, start);
  }
  flush();
  return out;
}

function unescapeShell(text: string): string {
  const t = text.trim();
  let out = '';
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (ch === "'") {
      const end = t.indexOf("'", i + 1);
      if (end === -1) fail('Unterminated single quote', i);
      out += t.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '"') {
      let j = i + 1;
      let seg = '';
      while (j < t.length && t[j] !== '"') {
        if (t[j] === '\\' && /["\\$`\n]/.test(t[j + 1] ?? '')) {
          if (t[j + 1] !== '\n') seg += t[j + 1];
          j += 2;
        } else seg += t[j++];
      }
      if (j >= t.length) fail('Unterminated double quote', i);
      out += seg;
      i = j + 1;
    } else if (ch === '\\') {
      if (i + 1 >= t.length) fail('Dangling backslash', i);
      if (t[i + 1] !== '\n') out += t[i + 1];
      i += 2;
    } else if (ch === '$' && t[i + 1] === "'") {
      // ANSI-C quoting: $'...'
      let j = i + 2;
      let raw = '';
      while (j < t.length && t[j] !== "'") {
        if (t[j] === '\\' && j + 1 < t.length) {
          raw += t[j] + t[j + 1];
          j += 2;
        } else raw += t[j++];
      }
      if (j >= t.length) fail("Unterminated $'…' string", i);
      out += unescapeBackslashes(raw, 'c');
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function unescapeCsv(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    const inner = t.slice(1, -1);
    const lone = /(?<!")"(?!")/.exec(inner.replace(/""/g, '\u0000\u0000'));
    if (lone) fail('Unescaped quote inside a quoted CSV field', lone.index + 1);
    return inner.replace(/""/g, '"');
  }
  if (t.includes('"')) fail('A CSV field containing quotes must itself be wrapped in quotes', t.indexOf('"'));
  return text;
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ref: string) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return named[ref] ?? m;
  });
}

export function unescapeString(text: string, lang: EscapeLanguage): UnescapeResult {
  try {
    switch (lang) {
      case 'json':
        return { ok: true, text: unescapeBackslashes(stripQuotes(text, ['"']), 'json') };
      case 'js':
        return { ok: true, text: unescapeBackslashes(stripQuotes(text, ['"', "'", '`']), 'js') };
      case 'java':
        return { ok: true, text: unescapeBackslashes(stripQuotes(text, ['"']), 'java') };
      case 'c':
        return { ok: true, text: unescapeBackslashes(stripQuotes(text, ['"']), 'c') };
      case 'sql': {
        const t = text.trim();
        const inner = t.length >= 2 && t.startsWith("'") && t.endsWith("'") ? t.slice(1, -1) : text;
        return { ok: true, text: inner.replace(/''/g, "'") };
      }
      case 'regex':
        return { ok: true, text: text.replace(/\\([.*+?^${}()|[\]\\/-])/g, '$1') };
      case 'shell':
        return { ok: true, text: unescapeShell(text) };
      case 'csv':
        return { ok: true, text: unescapeCsv(text) };
      case 'xml':
        return { ok: true, text: unescapeXml(text) };
    }
  } catch (error) {
    if (error instanceof UnescapeError) return { ok: false, error: error.message };
    throw error;
  }
}
