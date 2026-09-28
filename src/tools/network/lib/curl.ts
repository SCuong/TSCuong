/**
 * A dependency-free cURL command parser and generator.
 *
 * `parseCurl(command)` understands the flags people actually paste (including
 * browser "Copy as cURL" output for bash and Windows cmd) and returns a
 * structured {@link ParsedCurl}. `toCurl(request)` turns such a request back
 * into a readable, correctly quoted bash command.
 *
 * Convenience flags are folded into ordinary headers so that consumers only
 * have to deal with one list: `-A` becomes `User-Agent`, `-e` becomes `Referer`,
 * `-b name=value` becomes `Cookie`, `--json` adds `Content-Type`/`Accept`,
 * `-r` becomes `Range` and `--oauth2-bearer` becomes `Authorization`.
 */

/** A single request header. Order and duplicates are preserved. */
export interface CurlHeader {
  name: string;
  value: string;
}

/**
 * How the request body should be interpreted.
 * - `none`: no body.
 * - `raw`: an explicit, non-JSON Content-Type was given; send `body` verbatim.
 * - `json`: Content-Type is JSON (or `--json` was used); `body` holds the JSON text.
 * - `urlencoded`: `-d`/`--data-*` without a Content-Type header. curl sends these as
 *   `application/x-www-form-urlencoded`, so generators should add that header.
 * - `multipart`: `-F`/`--form`; see `formParts`.
 * - `binary`: `--data-binary @file` / `-T file`; `body` is a placeholder and `bodyFile` names the file.
 */
export type CurlBodyType = 'none' | 'raw' | 'json' | 'urlencoded' | 'multipart' | 'binary';

/** One multipart field from `-F` / `--form-string`. */
export interface CurlFormPart {
  name: string;
  /** Text value (absent for file parts). */
  value?: string;
  /** Local file path for `name=@path` uploads. */
  file?: string;
  /** `name=<path`: the field's text value comes from this file. */
  valueFile?: string;
  /** `;type=` for the part. */
  contentType?: string;
  /** `;filename=` override for file parts. */
  filename?: string;
}

export interface CurlBasicAuth {
  type: 'basic';
  user: string;
  password: string;
}

/** The structured result of {@link parseCurl}. */
export interface ParsedCurl {
  /** Upper-case HTTP method (GET when not specified and there is no body). */
  method: string;
  /** Absolute URL. `-G` data is already appended to the query string. */
  url: string;
  headers: CurlHeader[];
  bodyType: CurlBodyType;
  /** Request body for every body type except `none` and `multipart`. */
  body: string | null;
  /** File the body comes from (`-d @file`, `--data-binary @file`, `-T file`), if any. */
  bodyFile?: string;
  formParts: CurlFormPart[];
  auth: CurlBasicAuth | null;
  /** `--compressed`: ask for and transparently decode compressed responses. */
  compressed: boolean;
  /** `-k` / `--insecure`: skip TLS certificate verification. */
  insecure: boolean;
  /** `-L` / `--location`: follow redirects. */
  followRedirects: boolean;
  /** `-m` / `--max-time`, in seconds. */
  maxTime?: number;
  /** `--connect-timeout`, in seconds. */
  connectTimeout?: number;
  /** Human-readable notes about flags that were ignored, unsupported or approximated. */
  warnings: string[];
}

/** Input accepted by {@link toCurl}; a {@link ParsedCurl} satisfies it. */
export interface CurlRequest {
  method?: string;
  url: string;
  headers?: CurlHeader[];
  body?: string | null;
  bodyType?: CurlBodyType;
  bodyFile?: string;
  formParts?: CurlFormPart[];
  auth?: CurlBasicAuth | null;
  compressed?: boolean;
  insecure?: boolean;
  followRedirects?: boolean;
  maxTime?: number;
  connectTimeout?: number;
}

/** Thrown by {@link parseCurl} with a message suitable for showing to users. */
export class CurlParseError extends Error {
  override name = 'CurlParseError';
}

/* -------------------------------------------------------------------------- */
/* Tokenizer                                                                  */
/* -------------------------------------------------------------------------- */

export interface TokenizeResult {
  tokens: string[];
  warnings: string[];
}

const ANSI_SIMPLE: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};

/** Is this command written for Windows cmd.exe (e.g. Chrome's "Copy as cURL (cmd)")? */
export function isCmdStyle(command: string): boolean {
  return /\^\r?\n/.test(command) || /\^"/.test(command);
}

/** Splits a POSIX shell command line into words. */
export function tokenizeBash(input: string): TokenizeResult {
  const src = input.replace(/\r\n?/g, '\n');
  const tokens: string[] = [];
  const warnings: string[] = [];
  let current = '';
  let inWord = false;
  let i = 0;
  const vars = new Set<string>();

  const push = () => {
    if (inWord) tokens.push(current);
    current = '';
    inWord = false;
  };

  const noteVar = (from: number) => {
    const m = /^\$(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(from));
    if (m) vars.add(m[0]);
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        i += 2;
        continue;
      }
      if (next === undefined) {
        i++;
        continue;
      }
      current += next;
      inWord = true;
      i += 2;
      continue;
    }
    // PowerShell line continuation (backtick at end of line).
    if (c === '`' && src[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n') {
      push();
      i++;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '&' && inWord && src[i + 1] !== undefined && !/[&\s]/.test(src[i + 1])) {
      // An unquoted "&" inside a URL (…?a=1&b=2). A real shell would background the
      // command here, but the user clearly meant a query string.
      current += c;
      i++;
      continue;
    }
    if (c === '|' || c === ';' || c === '&' || c === '>' || c === '<') {
      // Shell control operators and redirections end the curl command.
      const rest = src.slice(i).trim();
      if (rest && rest !== '&') warnings.push(`Ignored everything after "${c}" (only the curl command is converted).`);
      break;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new CurlParseError('A single-quoted string is not closed.');
      current += src.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '$' && src[i + 1] === "'") {
      i += 2;
      let closed = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "'") {
          closed = true;
          i++;
          break;
        }
        if (ch === '\\') {
          const e = src[i + 1];
          if (e === undefined) break;
          if (e in ANSI_SIMPLE) {
            current += ANSI_SIMPLE[e];
            i += 2;
          } else if (e === 'x') {
            const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 2));
            if (m) {
              current += String.fromCharCode(parseInt(m[0], 16));
              i += 2 + m[0].length;
            } else {
              current += '\\x';
              i += 2;
            }
          } else if (e === 'u' || e === 'U') {
            const m = (e === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(src.slice(i + 2));
            if (m) {
              const cp = parseInt(m[0], 16);
              current += cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
              i += 2 + m[0].length;
            } else {
              current += '\\' + e;
              i += 2;
            }
          } else if (/[0-7]/.test(e)) {
            const m = /^[0-7]{1,3}/.exec(src.slice(i + 1))!;
            current += String.fromCharCode(parseInt(m[0], 8) & 0xff);
            i += 1 + m[0].length;
          } else if (e === 'c' && src[i + 2]) {
            current += String.fromCharCode(src.charCodeAt(i + 2) & 0x1f);
            i += 3;
          } else {
            current += '\\' + e;
            i += 2;
          }
          continue;
        }
        current += ch;
        i++;
      }
      if (!closed) throw new CurlParseError("A $'…' string is not closed.");
      inWord = true;
      continue;
    }
    if (c === '"' || (c === '$' && src[i + 1] === '"')) {
      i += c === '$' ? 2 : 1;
      let closed = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        if (ch === '\\') {
          const e = src[i + 1];
          if (e === '\n') {
            i += 2;
            continue;
          }
          if (e === '"' || e === '\\' || e === '$' || e === '`') {
            current += e;
            i += 2;
            continue;
          }
          current += '\\';
          i++;
          continue;
        }
        if (ch === '$') noteVar(i);
        current += ch;
        i++;
      }
      if (!closed) throw new CurlParseError('A double-quoted string is not closed.');
      inWord = true;
      continue;
    }
    if (c === '$') noteVar(i);
    current += c;
    inWord = true;
    i++;
  }
  push();
  if (vars.size) {
    warnings.push(`Shell variables are not expanded: ${[...vars].join(', ')}. They were kept as literal text.`);
  }
  return { tokens, warnings };
}

/**
 * Splits a Windows cmd.exe command line into words: caret escapes and
 * caret-newline continuations are handled first, then the Microsoft C runtime
 * argument rules (double quotes, `\"` and `""`).
 */
export function tokenizeCmd(input: string): TokenizeResult {
  const src = input.replace(/\r\n?/g, '\n');
  // Pass 1: cmd.exe caret handling.
  let unescaped = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '^') {
      const next = src[i + 1];
      if (next === '\n') {
        i++;
        continue;
      }
      if (next !== undefined) {
        unescaped += next;
        i++;
      }
      continue;
    }
    unescaped += c;
  }
  // Pass 2: MSVCRT argv rules.
  const tokens: string[] = [];
  let current = '';
  let inWord = false;
  let inQuotes = false;
  for (let i = 0; i < unescaped.length; i++) {
    const c = unescaped[i];
    if (c === '\\') {
      let n = 0;
      while (unescaped[i + n] === '\\') n++;
      if (unescaped[i + n] === '"') {
        current += '\\'.repeat(Math.floor(n / 2));
        if (n % 2 === 1) {
          current += '"';
          i += n; // skip the escaped quote as well
        } else {
          i += n - 1; // the quote is processed next iteration
        }
      } else {
        current += '\\'.repeat(n);
        i += n - 1;
      }
      inWord = true;
      continue;
    }
    if (c === '"') {
      if (inQuotes && unescaped[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      inWord = true;
      continue;
    }
    if (!inQuotes && (c === ' ' || c === '\t' || c === '\n')) {
      if (inWord) tokens.push(current);
      current = '';
      inWord = false;
      continue;
    }
    current += c;
    inWord = true;
  }
  if (inQuotes) throw new CurlParseError('A double-quoted string is not closed.');
  if (inWord) tokens.push(current);
  return { tokens, warnings: [] };
}

/* -------------------------------------------------------------------------- */
/* Option table                                                               */
/* -------------------------------------------------------------------------- */

type OptionKind =
  | 'request'
  | 'header'
  | 'data'
  | 'data-raw'
  | 'data-binary'
  | 'data-urlencode'
  | 'json'
  | 'form'
  | 'form-string'
  | 'user'
  | 'url'
  | 'cookie'
  | 'user-agent'
  | 'referer'
  | 'max-time'
  | 'connect-timeout'
  | 'range'
  | 'upload-file'
  | 'oauth2-bearer'
  | 'ignore-value'
  | 'warn-value'
  | 'get'
  | 'head'
  | 'compressed'
  | 'insecure'
  | 'location'
  | 'ignore'
  | 'warn-flag';

interface OptionSpec {
  kind: OptionKind;
  takesValue: boolean;
  /** Warning for warn-* kinds. */
  note?: string;
}

const V = (kind: OptionKind, note?: string): OptionSpec => ({ kind, takesValue: true, note });
const F = (kind: OptionKind, note?: string): OptionSpec => ({ kind, takesValue: false, note });

const LONG: Record<string, OptionSpec> = {
  request: V('request'),
  header: V('header'),
  data: V('data'),
  'data-ascii': V('data'),
  'data-raw': V('data-raw'),
  'data-binary': V('data-binary'),
  'data-urlencode': V('data-urlencode'),
  json: V('json'),
  form: V('form'),
  'form-string': V('form-string'),
  user: V('user'),
  url: V('url'),
  cookie: V('cookie'),
  'user-agent': V('user-agent'),
  referer: V('referer'),
  'max-time': V('max-time'),
  'connect-timeout': V('connect-timeout'),
  range: V('range'),
  'upload-file': V('upload-file'),
  'oauth2-bearer': V('oauth2-bearer'),
  get: F('get'),
  head: F('head'),
  compressed: F('compressed'),
  insecure: F('insecure'),
  location: F('location'),
  'location-trusted': F('location'),
  // Output / diagnostics: harmless, ignored silently.
  output: V('ignore-value'),
  'cookie-jar': V('ignore-value'),
  'dump-header': V('ignore-value'),
  'write-out': V('ignore-value'),
  'trace-ascii': V('ignore-value'),
  trace: V('ignore-value'),
  stderr: V('ignore-value'),
  retry: V('ignore-value'),
  'retry-delay': V('ignore-value'),
  'retry-max-time': V('ignore-value'),
  'limit-rate': V('ignore-value'),
  'speed-limit': V('ignore-value'),
  'speed-time': V('ignore-value'),
  'max-redirs': V('ignore-value'),
  'keepalive-time': V('ignore-value'),
  interface: V('ignore-value'),
  'output-dir': V('ignore-value'),
  'expect100-timeout': V('ignore-value'),
  silent: F('ignore'),
  'show-error': F('ignore'),
  verbose: F('ignore'),
  include: F('ignore'),
  fail: F('ignore'),
  'fail-with-body': F('ignore'),
  'no-buffer': F('ignore'),
  globoff: F('ignore'),
  'progress-bar': F('ignore'),
  'no-progress-meter': F('ignore'),
  'remote-name': F('ignore'),
  'remote-name-all': F('ignore'),
  'remote-header-name': F('ignore'),
  'create-dirs': F('ignore'),
  'http1.0': F('ignore'),
  'http1.1': F('ignore'),
  http2: F('ignore'),
  'http2-prior-knowledge': F('ignore'),
  http3: F('ignore'),
  'http3-only': F('ignore'),
  ipv4: F('ignore'),
  ipv6: F('ignore'),
  'tcp-nodelay': F('ignore'),
  'tcp-fastopen': F('ignore'),
  'no-keepalive': F('ignore'),
  'path-as-is': F('ignore'),
  'tr-encoding': F('ignore'),
  raw: F('ignore'),
  'ssl-no-revoke': F('ignore'),
  basic: F('ignore'),
  'junk-session-cookies': F('ignore'),
  'disable-epsv': F('ignore'),
  'styled-output': F('ignore'),
  'no-styled-output': F('ignore'),
  disable: F('ignore'),
  // Supported by curl, but not representable in generated code.
  proxy: V('warn-value', 'Proxy settings (-x/--proxy) are not included in the generated code.'),
  'proxy-user': V('warn-value', 'Proxy credentials (--proxy-user) are not included in the generated code.'),
  cacert: V('warn-value', 'Custom CA certificates (--cacert) are not included in the generated code.'),
  capath: V('warn-value', 'Custom CA paths (--capath) are not included in the generated code.'),
  cert: V('warn-value', 'Client certificates (--cert) are not included in the generated code.'),
  key: V('warn-value', 'Client keys (--key) are not included in the generated code.'),
  'cert-type': V('warn-value', 'Client certificate options are not included in the generated code.'),
  pass: V('warn-value', 'Key passphrases (--pass) are not included in the generated code.'),
  resolve: V('warn-value', 'Custom DNS resolution (--resolve) is not included in the generated code.'),
  'connect-to': V('warn-value', '--connect-to is not included in the generated code.'),
  config: V('warn-value', 'Config files (-K/--config) cannot be read here.'),
  'unix-socket': V('warn-value', 'Unix sockets (--unix-socket) are not included in the generated code.'),
  'aws-sigv4': V('warn-value', 'AWS SigV4 signing (--aws-sigv4) is not included in the generated code.'),
  digest: F('warn-flag', 'Digest authentication (--digest) is not supported; credentials are shown as Basic auth.'),
  ntlm: F('warn-flag', 'NTLM authentication (--ntlm) is not supported; credentials are shown as Basic auth.'),
  negotiate: F('warn-flag', 'Negotiate authentication (--negotiate) is not supported.'),
  anyauth: F('warn-flag', '--anyauth is not supported; credentials are shown as Basic auth.'),
  netrc: F('warn-flag', '.netrc credentials (-n/--netrc) cannot be read here.'),
};

const SHORT: Record<string, string> = {
  X: 'request',
  H: 'header',
  d: 'data',
  F: 'form',
  u: 'user',
  b: 'cookie',
  A: 'user-agent',
  e: 'referer',
  m: 'max-time',
  r: 'range',
  T: 'upload-file',
  G: 'get',
  I: 'head',
  k: 'insecure',
  L: 'location',
  o: 'output',
  c: 'cookie-jar',
  D: 'dump-header',
  w: 'write-out',
  s: 'silent',
  S: 'show-error',
  v: 'verbose',
  i: 'include',
  f: 'fail',
  N: 'no-buffer',
  g: 'globoff',
  '#': 'progress-bar',
  O: 'remote-name',
  J: 'remote-header-name',
  '0': 'http1.0',
  '4': 'ipv4',
  '6': 'ipv6',
  j: 'junk-session-cookies',
  q: 'disable',
  x: 'proxy',
  U: 'proxy-user',
  E: 'cert',
  K: 'config',
  n: 'netrc',
};

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

/** Percent-encodes like curl's `--data-urlencode` (everything but unreserved characters). */
export function curlEscape(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

interface DataPiece {
  kind: 'data' | 'data-raw' | 'data-binary' | 'data-urlencode' | 'json';
  value: string;
}

function hasHeader(headers: CurlHeader[], name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some((h) => h.name.toLowerCase() === lower);
}

function headerValue(headers: CurlHeader[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

function parseFormArg(arg: string, literal: boolean, warnings: string[]): CurlFormPart {
  const eq = arg.indexOf('=');
  if (eq <= 0) throw new CurlParseError(`The form field "${arg}" must look like name=value.`);
  const name = arg.slice(0, eq);
  const rest = arg.slice(eq + 1);
  if (literal) return { name, value: rest };
  if (rest.startsWith('@') || rest.startsWith('<')) {
    const [path, ...params] = splitFormParams(rest.slice(1));
    const part: CurlFormPart = { name };
    if (rest.startsWith('@')) part.file = path;
    else {
      part.valueFile = path;
      warnings.push(`The value of form field "${name}" is read from the file "${path}", which cannot be read here.`);
    }
    for (const p of params) {
      const m = /^\s*(type|filename|headers|encoder)=(.*)$/i.exec(p);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = unquoteParam(m[2]);
      if (key === 'type') part.contentType = value;
      else if (key === 'filename') part.filename = value;
      else warnings.push(`The form option "${key}=" on field "${name}" was ignored.`);
    }
    return part;
  }
  // Plain values may carry ;type= too (e.g. -F 'meta={"a":1};type=application/json').
  if (rest.startsWith('"')) {
    // A quoted value may contain ';' literally: -F 'a="x;y";type=text/plain'.
    const m = /^"((?:[^"\\]|\\.)*)"(.*)$/.exec(rest);
    if (m) {
      const type = /;type=([^;]+)/i.exec(m[2]);
      const value = m[1].replace(/\\(.)/g, '$1');
      return type ? { name, value, contentType: type[1] } : { name, value };
    }
  }
  const typeMatch = /^(.*);type=([^;]+)$/i.exec(rest);
  if (typeMatch) return { name, value: typeMatch[1], contentType: typeMatch[2] };
  return { name, value: rest };
}

function splitFormParams(text: string): string[] {
  // Split on ';' outside double quotes.
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function unquoteParam(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1');
  return v;
}

function positiveNumber(value: string, flag: string, warnings: string[]): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    warnings.push(`${flag} expects a number of seconds; "${value}" was ignored.`);
    return undefined;
  }
  return n;
}

/**
 * Parses a curl command line.
 * @throws {CurlParseError} with a user-facing message when the command cannot be understood.
 */
export function parseCurl(command: string): ParsedCurl {
  const trimmed = command.trim().replace(/^\$\s+/, '');
  if (!trimmed) throw new CurlParseError('Paste a curl command to convert.');
  const { tokens, warnings: tokenWarnings } = isCmdStyle(trimmed) ? tokenizeCmd(trimmed) : tokenizeBash(trimmed);
  const warnings = [...tokenWarnings];
  if (tokens.length === 0) throw new CurlParseError('Paste a curl command to convert.');
  const first = tokens[0];
  if (!/(^|[\\/])curl(\.exe)?$/i.test(first)) {
    throw new CurlParseError(`The command must start with "curl" (found "${first.slice(0, 40)}").`);
  }

  let method: string | null = null;
  const headers: CurlHeader[] = [];
  const data: DataPiece[] = [];
  const formParts: CurlFormPart[] = [];
  const urls: string[] = [];
  let auth: CurlBasicAuth | null = null;
  let get = false;
  let head = false;
  let compressed = false;
  let insecure = false;
  let followRedirects = false;
  let maxTime: number | undefined;
  let connectTimeout: number | undefined;
  let uploadFile: string | undefined;
  const cookies: string[] = [];
  let userAgent: string | undefined;
  let referer: string | undefined;

  const apply = (spec: OptionSpec, flag: string, value: string) => {
    switch (spec.kind) {
      case 'request':
        method = value.toUpperCase();
        if (!method) warnings.push(`${flag} was given an empty method and was ignored.`);
        break;
      case 'header': {
        if (value.startsWith('@')) {
          warnings.push(`Headers read from a file (${flag} ${value}) cannot be loaded here.`);
          break;
        }
        const colon = value.indexOf(':');
        if (colon < 0) {
          if (value.endsWith(';') && value.length > 1) {
            headers.push({ name: value.slice(0, -1).trim(), value: '' });
          } else {
            warnings.push(`Ignored the header "${value}" because it has no ":".`);
          }
          break;
        }
        const name = value.slice(0, colon).trim();
        const headerVal = value.slice(colon + 1).trim();
        if (!name) {
          warnings.push(`Ignored the header "${value}" because it has no name.`);
          break;
        }
        if (headerVal === '') {
          warnings.push(`"${name}:" with no value tells curl to remove that header; it was left out.`);
          break;
        }
        headers.push({ name, value: headerVal });
        break;
      }
      case 'data':
      case 'data-raw':
      case 'data-binary':
      case 'data-urlencode':
      case 'json':
        data.push({ kind: spec.kind, value });
        break;
      case 'form':
      case 'form-string':
        formParts.push(parseFormArg(value, spec.kind === 'form-string', warnings));
        break;
      case 'user': {
        const colon = value.indexOf(':');
        if (colon < 0) {
          auth = { type: 'basic', user: value, password: '' };
          warnings.push('No password was given with -u; curl would prompt for one. An empty password is used.');
        } else {
          auth = { type: 'basic', user: value.slice(0, colon), password: value.slice(colon + 1) };
        }
        break;
      }
      case 'url':
        urls.push(value);
        break;
      case 'cookie':
        if (value.includes('=')) cookies.push(value);
        else warnings.push(`Cookies read from the file "${value}" cannot be loaded here.`);
        break;
      case 'user-agent':
        userAgent = value;
        break;
      case 'referer':
        referer = value.replace(/;auto$/, '');
        break;
      case 'max-time':
        maxTime = positiveNumber(value, flag, warnings);
        break;
      case 'connect-timeout':
        connectTimeout = positiveNumber(value, flag, warnings);
        break;
      case 'range':
        headers.push({ name: 'Range', value: `bytes=${value}` });
        break;
      case 'upload-file':
        uploadFile = value;
        warnings.push(`The upload file "${value}" cannot be read here; the generated code uses a placeholder body.`);
        break;
      case 'oauth2-bearer':
        headers.push({ name: 'Authorization', value: `Bearer ${value}` });
        break;
      case 'get':
        get = true;
        break;
      case 'head':
        head = true;
        break;
      case 'compressed':
        compressed = true;
        break;
      case 'insecure':
        insecure = true;
        break;
      case 'location':
        followRedirects = true;
        break;
      case 'warn-value':
      case 'warn-flag':
        if (spec.note && !warnings.includes(spec.note)) warnings.push(spec.note);
        break;
      case 'ignore':
      case 'ignore-value':
        break;
    }
  };

  let endOfOptions = false;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (endOfOptions || !tok.startsWith('-') || tok === '-') {
      urls.push(tok);
      continue;
    }
    if (tok === '--') {
      endOfOptions = true;
      continue;
    }
    if (tok.startsWith('--')) {
      let name = tok.slice(2);
      if (name.includes('=') && !LONG[name]) {
        warnings.push(`curl does not accept "--option=value" syntax; "${tok}" was ignored.`);
        continue;
      }
      let negated = false;
      if (!LONG[name] && name.startsWith('no-') && LONG[name.slice(3)] && !LONG[name.slice(3)].takesValue) {
        name = name.slice(3);
        negated = true;
      }
      const spec = LONG[name];
      if (!spec) {
        warnings.push(`Unknown option "${tok}" was ignored.`);
        continue;
      }
      if (negated) {
        if (spec.kind === 'compressed') compressed = false;
        else if (spec.kind === 'insecure') insecure = false;
        else if (spec.kind === 'location') followRedirects = false;
        else if (spec.kind === 'get') get = false;
        else if (spec.kind === 'head') head = false;
        continue;
      }
      if (spec.takesValue) {
        if (i + 1 >= tokens.length) throw new CurlParseError(`The option "${tok}" needs a value.`);
        apply(spec, tok, tokens[++i]);
      } else apply(spec, tok, '');
      continue;
    }
    // Short options, possibly combined (-sSL) or with an attached value (-XPOST).
    for (let j = 1; j < tok.length; j++) {
      const ch = tok[j];
      const long = SHORT[ch];
      if (!long) {
        warnings.push(`Unknown option "-${ch}" was ignored.`);
        continue;
      }
      const spec = LONG[long];
      if (spec.takesValue) {
        let value = tok.slice(j + 1);
        if (!value) {
          if (i + 1 >= tokens.length) throw new CurlParseError(`The option "-${ch}" needs a value.`);
          value = tokens[++i];
        }
        apply(spec, `-${ch}`, value);
        break;
      }
      apply(spec, `-${ch}`, '');
    }
  }

  if (urls.length === 0) throw new CurlParseError('The curl command has no URL.');
  if (urls.length > 1) warnings.push(`Only the first URL is converted; ${urls.length - 1} more ${urls.length === 2 ? 'was' : 'were'} ignored.`);
  let url = urls[0];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = `http://${url}`;
    warnings.push('The URL has no scheme, so http:// was assumed (as curl does).');
  }
  if (!/^https?:\/\//i.test(url)) {
    warnings.push(`Only HTTP(S) URLs are supported by the generated code (found ${url.split(':')[0]}).`);
  }
  try {
    new URL(url);
  } catch {
    throw new CurlParseError(`"${urls[0]}" is not a valid URL.`);
  }

  if (userAgent !== undefined && !hasHeader(headers, 'User-Agent')) headers.push({ name: 'User-Agent', value: userAgent });
  if (referer !== undefined && !hasHeader(headers, 'Referer')) headers.push({ name: 'Referer', value: referer });
  if (cookies.length && !hasHeader(headers, 'Cookie')) headers.push({ name: 'Cookie', value: cookies.join('; ') });

  // Build the body.
  let body: string | null = null;
  let bodyFile: string | undefined;
  let bodyType: CurlBodyType = 'none';
  const usesJsonFlag = data.some((d) => d.kind === 'json');

  if (formParts.length && data.length) {
    throw new CurlParseError('A command cannot mix -F/--form with -d/--data options (curl refuses this too).');
  }

  if (data.length) {
    const encoded: string[] = [];
    let jsonText = '';
    for (const piece of data) {
      if (piece.kind === 'json') {
        if (piece.value.startsWith('@')) {
          bodyFile = piece.value.slice(1);
          jsonText += `<contents of ${bodyFile}>`;
          warnings.push(`The body file "${bodyFile}" cannot be read here; the generated code uses a placeholder.`);
        } else jsonText += piece.value;
        continue;
      }
      if (piece.kind === 'data-urlencode') {
        const v = piece.value;
        const at = v.indexOf('@');
        const eq = v.indexOf('=');
        if (v.startsWith('@') || (at > 0 && (eq < 0 || at < eq))) {
          const name = v.startsWith('@') ? '' : v.slice(0, at);
          const file = v.slice(at + 1);
          warnings.push(`The file "${file}" for --data-urlencode cannot be read here; the generated code uses a placeholder.`);
          encoded.push(name ? `${name}=<urlencoded contents of ${file}>` : `<urlencoded contents of ${file}>`);
        } else if (eq === 0) {
          encoded.push(curlEscape(v.slice(1)));
        } else if (eq > 0) {
          encoded.push(`${v.slice(0, eq)}=${curlEscape(v.slice(eq + 1))}`);
        } else {
          encoded.push(curlEscape(v));
        }
        continue;
      }
      if ((piece.kind === 'data' || piece.kind === 'data-binary') && piece.value.startsWith('@')) {
        bodyFile = piece.value.slice(1);
        warnings.push(`The body file "${bodyFile}" cannot be read here; the generated code uses a placeholder.`);
        encoded.push(`<contents of ${bodyFile}>`);
        continue;
      }
      encoded.push(piece.value);
    }
    const joined = [encoded.join('&'), jsonText].filter(Boolean).join('&');
    if (usesJsonFlag) {
      if (!hasHeader(headers, 'Content-Type')) headers.push({ name: 'Content-Type', value: 'application/json' });
      if (!hasHeader(headers, 'Accept')) headers.push({ name: 'Accept', value: 'application/json' });
    }
    if (get) {
      if (joined) url += (url.includes('?') ? '&' : '?') + joined;
    } else {
      body = joined;
      const ct = headerValue(headers, 'Content-Type');
      const onlyBinaryFile = bodyFile !== undefined && data.length === 1 && data[0].kind === 'data-binary';
      if (ct && /[/+]json\b/i.test(ct)) bodyType = 'json';
      else if (onlyBinaryFile) bodyType = 'binary';
      else if (ct) bodyType = /^application\/x-www-form-urlencoded/i.test(ct) ? 'urlencoded' : 'raw';
      else {
        bodyType = 'urlencoded';
        const t = joined.trim();
        if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
          warnings.push(
            'The body looks like JSON, but no Content-Type header was given, so curl sends it as application/x-www-form-urlencoded. Add -H "Content-Type: application/json" if the server expects JSON.',
          );
        }
      }
    }
  } else if (formParts.length) {
    bodyType = 'multipart';
    if (get) warnings.push('-G cannot be combined with -F; the form is sent as a multipart body.');
  } else if (uploadFile !== undefined) {
    bodyType = 'binary';
    bodyFile = uploadFile;
    body = `<contents of ${uploadFile}>`;
  }

  let finalMethod: string;
  if (head) finalMethod = 'HEAD';
  else if (method) finalMethod = method;
  else if (get) finalMethod = 'GET';
  else if (uploadFile !== undefined) finalMethod = 'PUT';
  else if (bodyType !== 'none') finalMethod = 'POST';
  else finalMethod = 'GET';

  if (head && method && method !== 'HEAD') warnings.push(`-I (HEAD) overrides -X ${method}.`);
  if ((finalMethod === 'GET' || finalMethod === 'HEAD') && bodyType !== 'none') {
    warnings.push(`A ${finalMethod} request with a body is unusual; some libraries drop the body.`);
  }

  return {
    method: finalMethod,
    url,
    headers,
    bodyType,
    body,
    ...(bodyFile !== undefined ? { bodyFile } : {}),
    formParts,
    auth,
    compressed,
    insecure,
    followRedirects,
    ...(maxTime !== undefined ? { maxTime } : {}),
    ...(connectTimeout !== undefined ? { connectTimeout } : {}),
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Generator                                                                  */
/* -------------------------------------------------------------------------- */

/** Quotes a word for bash. Safe words are left bare; everything else is single-quoted. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_\-.,:/@%+=~]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Produces a readable multi-line bash curl command for a request. */
export function toCurl(req: CurlRequest): string {
  const args: string[] = [];
  const method = (req.method ?? 'GET').toUpperCase();
  const bodyType = req.bodyType ?? (req.formParts?.length ? 'multipart' : req.body ? 'raw' : 'none');
  const hasBody = bodyType === 'multipart' ? Boolean(req.formParts?.length) : req.body != null && bodyType !== 'none';
  if (method === 'HEAD') args.push('--head');
  else if (!((method === 'GET' && !hasBody) || (method === 'POST' && hasBody))) args.push(`-X ${shellQuote(method)}`);

  for (const h of req.headers ?? []) {
    args.push(h.value === '' ? `-H ${shellQuote(`${h.name};`)}` : `-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  }
  if (req.auth) args.push(`-u ${shellQuote(`${req.auth.user}:${req.auth.password}`)}`);

  if (bodyType === 'multipart') {
    for (const part of req.formParts ?? []) {
      if (part.file !== undefined || part.valueFile !== undefined) {
        let spec = `${part.name}=${part.file !== undefined ? '@' : '<'}${part.file ?? part.valueFile}`;
        if (part.contentType) spec += `;type=${part.contentType}`;
        if (part.filename) spec += `;filename=${part.filename}`;
        args.push(`-F ${shellQuote(spec)}`);
      } else if (part.contentType) {
        args.push(`-F ${shellQuote(`${part.name}=${part.value ?? ''};type=${part.contentType}`)}`);
      } else {
        args.push(`--form-string ${shellQuote(`${part.name}=${part.value ?? ''}`)}`);
      }
    }
  } else if (hasBody) {
    if (req.bodyFile !== undefined && (req.body ?? '') === `<contents of ${req.bodyFile}>`) {
      args.push(`--data-binary ${shellQuote(`@${req.bodyFile}`)}`);
    } else {
      args.push(`--data-raw ${shellQuote(req.body ?? '')}`);
    }
  }
  if (req.compressed) args.push('--compressed');
  if (req.insecure) args.push('--insecure');
  if (req.followRedirects) args.push('--location');
  if (req.maxTime !== undefined) args.push(`--max-time ${req.maxTime}`);
  if (req.connectTimeout !== undefined) args.push(`--connect-timeout ${req.connectTimeout}`);

  const head = `curl ${shellQuote(req.url)}`;
  if (args.length === 0) return head;
  return [head, ...args.map((a) => `  ${a}`)].join(' \\\n');
}
