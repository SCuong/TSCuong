import { isSensitiveHeader } from './model';
import type { PreparedRequest } from './prepare';
import { splitUrl, parseQuery, stringifyQuery } from './url';

export type CodeTarget = 'curl' | 'curl-cmd' | 'fetch' | 'node' | 'axios' | 'python' | 'httpie';

export const CODE_TARGETS: Array<{ id: CodeTarget; label: string; language: 'shell' | 'javascript' | 'python' }> = [
  { id: 'curl', label: 'cURL (bash)', language: 'shell' },
  { id: 'curl-cmd', label: 'cURL (Windows cmd)', language: 'shell' },
  { id: 'fetch', label: 'JavaScript fetch', language: 'javascript' },
  { id: 'node', label: 'Node.js fetch', language: 'javascript' },
  { id: 'axios', label: 'axios', language: 'javascript' },
  { id: 'python', label: 'Python requests', language: 'python' },
  { id: 'httpie', label: 'HTTPie', language: 'shell' },
];

export type CodeBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'form'; fields: Array<{ name: string; value: string } | { name: string; fileName: string }> }
  | { kind: 'file'; fileName: string };

/** A request as code samples need it: no Blob contents, secrets optionally replaced by placeholders. */
export interface CodeRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: CodeBody;
  timeoutSeconds: number | null;
}

/**
 * The URL exactly as the browser sends it: WHATWG-normalized, so spaces and
 * non-ASCII characters are percent-encoded (curl, for one, rejects a raw space
 * in a URL). Placeholders such as <apiKey> are kept readable.
 */
export function normalizeRequestUrl(url: string): string {
  try {
    return new URL(url).href.replace(/%3C([\w.$-]+)%3E/gi, '<$1>');
  } catch {
    return url;
  }
}

/** Convert a prepared request, replacing credentials with readable placeholders unless `includeSecrets`. */
export function toCodeRequest(req: PreparedRequest, includeSecrets: boolean): CodeRequest {
  const authNames = new Set(req.authHeaderNames.map((n) => n.toLowerCase()));
  const headers = req.headers.map(([name, value]): [string, string] => {
    if (includeSecrets) return [name, value];
    const lower = name.toLowerCase();
    if (!authNames.has(lower) && !isSensitiveHeader(name)) return [name, value];
    const scheme = /^(Bearer|Basic|Token|Digest)\s+/i.exec(value);
    if (scheme) return [name, `${scheme[1]} <${scheme[1].toLowerCase() === 'basic' ? 'base64-credentials' : 'token'}>`];
    return [name, lower === 'cookie' ? '<cookies>' : '<secret>'];
  });
  let url = normalizeRequestUrl(req.url);
  if (!includeSecrets && req.authQueryParam) {
    const { base, query, hash } = splitUrl(url);
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    const pairs = parseQuery(query).map((p) => (decode(p.key) === req.authQueryParam ? { key: p.key, value: '<api-key>' } : p));
    url = `${base}?${stringifyQuery(pairs)}${hash}`;
  }
  let body: CodeBody;
  switch (req.body.kind) {
    case 'none':
      body = { kind: 'none' };
      break;
    case 'text':
      body = { kind: 'text', text: req.body.text };
      break;
    case 'blob':
      body = { kind: 'file', fileName: req.body.fileName };
      break;
    case 'form':
      body = {
        kind: 'form',
        fields: req.body.fields.map((f) => ('file' in f ? { name: f.name, fileName: f.fileName } : { name: f.name, value: f.value })),
      };
      break;
  }
  return { method: req.method, url, headers, body, timeoutSeconds: req.timeoutMs > 0 ? req.timeoutMs / 1000 : null };
}

/* -------------------------------------------------------------------------- */
/* Quoting                                                                    */
/* -------------------------------------------------------------------------- */

/** Bash word: bare when safe, otherwise single-quoted with `'\''` for embedded quotes. */
export function bashQuote(value: string): string {
  if (value !== '' && /^[A-Za-z0-9_\-.,:/@%+=~]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Windows cmd.exe argument for a native program (curl.exe) using the MS C runtime's
 * argv rules, then caret-escaped so cmd.exe passes it through unchanged.
 */
export function cmdQuote(value: string): string {
  // 1. MSVCRT: backslashes are literal except before a quote; quotes become \".
  let crt = '';
  let slashes = 0;
  for (const ch of value) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    if (ch === '"') {
      crt += '\\'.repeat(slashes * 2 + 1) + '"';
    } else {
      crt += '\\'.repeat(slashes) + ch;
    }
    slashes = 0;
  }
  crt += '\\'.repeat(slashes * 2); // before the closing quote
  // 2. cmd.exe: every quote is caret-escaped, so cmd never enters quote mode and
  //    must see all of its special characters escaped too.
  const escaped = crt
    .replace(/[\^&|<>()!"]/g, '^$&')
    .replace(/%(?=[A-Za-z0-9_])/g, '%^')
    .replace(/\r?\n/g, '^\n\n');
  return `^"${escaped}^"`;
}

function escapeControl(ch: string): string {
  return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** Single-quoted JavaScript string literal. */
export function jsString(value: string): string {
  let out = "'";
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === LINE_SEP) out += '\\u2028';
    else if (ch === PARA_SEP) out += '\\u2029';
    else if (ch < ' ' || ch === '\x7f') out += escapeControl(ch);
    else out += ch;
  }
  return `${out}'`;
}

/** Single-quoted Python 3 string literal. */
export function pyString(value: string): string {
  let out = "'";
  for (const ch of value) {
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch < ' ' || ch === '\x7f') out += escapeControl(ch);
    else out += ch;
  }
  return `${out}'`;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Remove insignificant whitespace (outside strings) from JSON text. */
export function compactJsonText(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i++;
      } else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') out += ch;
  }
  return out;
}

/**
 * Pretty-printed JSON for an object/array body, or null when the text is not JSON
 * or re-serializing it would change it (big integers, `1.0`, escapes, duplicate keys):
 * code samples must send exactly the bytes the user wrote.
 */
export function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (JSON.stringify(value) !== compactJsonText(trimmed)) return null;
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function indentLines(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

function hasDuplicateHeaders(headers: Array<[string, string]>): boolean {
  const seen = new Set<string>();
  for (const [n] of headers) {
    const l = n.toLowerCase();
    if (seen.has(l)) return true;
    seen.add(l);
  }
  return false;
}

/** Merge duplicate header names with ", " for libraries that take a plain object. */
function mergedHeaders(headers: Array<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of headers) {
    const existing = out.find(([n]) => n.toLowerCase() === name.toLowerCase());
    if (existing) existing[1] = `${existing[1]}, ${value}`;
    else out.push([name, value]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* cURL                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A file name for curl's -F syntax: names with `;`, `,`, `"` or `\` must be
 * double-quoted there, or curl reads `;type=…`-style options out of them.
 */
function curlFormFile(fileName: string): string {
  return /[;,"\\]/.test(fileName) ? `"${fileName.replace(/[\\"]/g, '\\$&')}"` : fileName;
}

function curlArgs(req: CodeRequest, quote: (v: string) => string): string[] {
  const args: string[] = [];
  const hasBody = req.body.kind !== 'none';
  // curl treats [] and {} in URLs as glob patterns (e.g. filter[name]=x fails) unless globbing is off.
  if (/[[\]{}]/.test(req.url)) args.push('--globoff');
  if (req.method === 'HEAD') args.push('--head');
  else if (!(req.method === 'GET' && !hasBody) && !(req.method === 'POST' && hasBody)) args.push(`-X ${req.method}`);
  for (const [name, value] of req.headers) {
    args.push(`-H ${quote(value === '' ? `${name};` : `${name}: ${value}`)}`);
  }
  const body = req.body;
  if (body.kind === 'text') args.push(`--data-raw ${quote(body.text)}`);
  else if (body.kind === 'file') args.push(`--data-binary ${quote(`@${body.fileName}`)}`);
  else if (body.kind === 'form') {
    for (const f of body.fields) {
      if ('fileName' in f) args.push(`-F ${quote(`${f.name}=@${curlFormFile(f.fileName)}`)}`);
      else args.push(`--form-string ${quote(`${f.name}=${f.value}`)}`);
    }
  }
  if (req.timeoutSeconds) args.push(`--max-time ${req.timeoutSeconds}`);
  return args;
}

export function toCurlBash(req: CodeRequest): string {
  const args = curlArgs(req, bashQuote);
  const head = `curl ${bashQuote(req.url)}`;
  return args.length ? [head, ...args.map((a) => `  ${a}`)].join(' \\\n') : head;
}

export function toCurlCmd(req: CodeRequest): string {
  const args = curlArgs(req, cmdQuote);
  const head = `curl ${cmdQuote(req.url)}`;
  return args.length ? [head, ...args.map((a) => `  ${a}`)].join(' ^\n') : head;
}

/* -------------------------------------------------------------------------- */
/* JavaScript                                                                 */
/* -------------------------------------------------------------------------- */

function jsHeaders(headers: Array<[string, string]>, pad: string): string {
  if (hasDuplicateHeaders(headers)) {
    return `[\n${headers.map(([n, v]) => `${pad}  [${jsString(n)}, ${jsString(v)}],`).join('\n')}\n${pad}]`;
  }
  return `{\n${headers.map(([n, v]) => `${pad}  ${jsString(n)}: ${jsString(v)},`).join('\n')}\n${pad}}`;
}

function jsTextBody(text: string, pad: string): string {
  const pretty = prettyJson(text);
  if (pretty !== null) return `JSON.stringify(${indentLines(pretty, pad)})`;
  return jsString(text);
}

function jsFetch(req: CodeRequest, runtime: 'browser' | 'node'): string {
  const lines: string[] = [];
  const body = req.body;
  if (runtime === 'node' && (body.kind === 'file' || (body.kind === 'form' && body.fields.some((f) => 'fileName' in f)))) {
    lines.push("import { openAsBlob } from 'node:fs';", '');
  }
  if (runtime === 'browser' && body.kind === 'file') {
    lines.push(`const file = fileInput.files[0]; // ${body.fileName} (any File or Blob)`, '');
  }
  if (runtime === 'node' && body.kind === 'file') lines.push(`const file = await openAsBlob(${jsString(body.fileName)});`, '');
  if (body.kind === 'form') {
    lines.push('const form = new FormData();');
    for (const f of body.fields) {
      if ('fileName' in f) {
        lines.push(
          runtime === 'node'
            ? `form.append(${jsString(f.name)}, await openAsBlob(${jsString(f.fileName)}), ${jsString(f.fileName)});`
            : `form.append(${jsString(f.name)}, fileInput.files[0]); // ${f.fileName}`,
        );
      } else lines.push(`form.append(${jsString(f.name)}, ${jsString(f.value)});`);
    }
    lines.push('');
  }
  const opts: string[] = [`  method: ${jsString(req.method)},`];
  if (req.headers.length) opts.push(`  headers: ${jsHeaders(req.headers, '  ')},`);
  if (body.kind === 'text') opts.push(`  body: ${jsTextBody(body.text, '  ')},`);
  else if (body.kind === 'form') opts.push('  body: form,');
  else if (body.kind === 'file') opts.push('  body: file,');
  if (req.timeoutSeconds) opts.push(`  signal: AbortSignal.timeout(${Math.round(req.timeoutSeconds * 1000)}),`);
  lines.push(`const response = await fetch(${jsString(req.url)}, {`, ...opts, '});', '');
  lines.push('console.log(response.status, response.statusText);');
  lines.push(req.method === 'HEAD' ? 'console.log(Object.fromEntries(response.headers));' : 'console.log(await response.text());');
  return lines.join('\n');
}

function jsAxios(req: CodeRequest): string {
  const lines: string[] = [];
  const body = req.body;
  const needsFs = body.kind === 'file' || (body.kind === 'form' && body.fields.some((f) => 'fileName' in f));
  lines.push("import axios from 'axios';");
  if (needsFs) lines.push("import { openAsBlob } from 'node:fs';");
  lines.push('');
  if (body.kind === 'form') {
    lines.push('const form = new FormData();');
    for (const f of body.fields) {
      if ('fileName' in f) lines.push(`form.append(${jsString(f.name)}, await openAsBlob(${jsString(f.fileName)}), ${jsString(f.fileName)});`);
      else lines.push(`form.append(${jsString(f.name)}, ${jsString(f.value)});`);
    }
    lines.push('');
  }
  const opts: string[] = [`  method: ${jsString(req.method.toLowerCase())},`, `  url: ${jsString(req.url)},`];
  const headers = mergedHeaders(req.headers);
  if (headers.length) opts.push(`  headers: ${jsHeaders(headers, '  ')},`);
  if (body.kind === 'text') {
    // Pass strings through untouched so axios does not re-serialize them.
    const pretty = prettyJson(body.text);
    opts.push(pretty !== null ? `  data: ${indentLines(pretty, '  ')},` : `  data: ${jsString(body.text)},`);
  } else if (body.kind === 'form') opts.push('  data: form,');
  else if (body.kind === 'file') opts.push(`  data: await openAsBlob(${jsString(body.fileName)}),`);
  if (req.timeoutSeconds) opts.push(`  timeout: ${Math.round(req.timeoutSeconds * 1000)},`);
  opts.push('  validateStatus: () => true, // resolve for every HTTP status');
  lines.push('const response = await axios.request({', ...opts, '});', '');
  lines.push('console.log(response.status, response.statusText);', 'console.log(response.data);');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Python                                                                     */
/* -------------------------------------------------------------------------- */

function pythonRequests(req: CodeRequest): string {
  const lines = ['import requests', '', `url = ${pyString(req.url)}`];
  const headers = mergedHeaders(req.headers);
  if (headers.length) {
    lines.push('headers = {', ...headers.map(([n, v]) => `    ${pyString(n)}: ${pyString(v)},`), '}');
  }
  const args = [pyString(req.method), 'url'];
  if (headers.length) args.push('headers=headers');
  const body = req.body;
  if (body.kind === 'text') {
    lines.push(`data = ${pyString(body.text)}`);
    args.push("data=data.encode('utf-8')");
  } else if (body.kind === 'form') {
    lines.push('files = [');
    for (const f of body.fields) {
      if ('fileName' in f) lines.push(`    (${pyString(f.name)}, (${pyString(f.fileName)}, open(${pyString(f.fileName)}, 'rb'))),`);
      else lines.push(`    (${pyString(f.name)}, (None, ${pyString(f.value)})),`);
    }
    lines.push(']');
    args.push('files=files');
  } else if (body.kind === 'file') {
    lines.push(`data = open(${pyString(body.fileName)}, 'rb')`);
    args.push('data=data');
  }
  if (req.timeoutSeconds) args.push(`timeout=${req.timeoutSeconds}`);
  lines.push('', `response = requests.request(${args.join(', ')})`, '', 'print(response.status_code, response.reason)');
  lines.push(req.method === 'HEAD' ? 'print(response.headers)' : 'print(response.text)');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* HTTPie                                                                     */
/* -------------------------------------------------------------------------- */

/** Escape HTTPie request-item separators in a field name. */
function httpieKey(name: string): string {
  return name.replace(/([\\=:@;])/g, '\\$1');
}

/**
 * A value after an item separator: HTTPie takes the longest separator at the
 * first position, so a value starting with "=" or "@" would turn `a=@x` into a
 * file embed, `a==x` into a query parameter and `H:=x` into a raw JSON field.
 */
function httpieValue(value: string): string {
  return /^[=@]/.test(value) ? `\\${value}` : value;
}

function httpie(req: CodeRequest): string {
  const parts: string[] = ['http'];
  const body = req.body;
  if (body.kind === 'form') parts.push('--multipart');
  if (req.timeoutSeconds) parts.push(`--timeout=${req.timeoutSeconds}`);
  parts.push(req.method, bashQuote(req.url));
  const items: string[] = [];
  for (const [name, value] of req.headers) {
    items.push(bashQuote(value === '' ? `${name};` : `${name}:${httpieValue(value)}`));
  }
  if (body.kind === 'form') {
    for (const f of body.fields) {
      if ('fileName' in f) items.push(bashQuote(`${httpieKey(f.name)}@${f.fileName}`));
      else items.push(bashQuote(`${httpieKey(f.name)}=${httpieValue(f.value)}`));
    }
  }
  let cmd = parts.join(' ');
  if (body.kind === 'text') cmd = `http --raw ${bashQuote(body.text)} ${parts.slice(1).join(' ')}`;
  const lines = [cmd, ...items];
  let out = lines.length > 1 ? [lines[0], ...lines.slice(1).map((l) => `  ${l}`)].join(' \\\n') : lines[0];
  if (body.kind === 'file') out += ` \\\n  < ${bashQuote(body.fileName)}`;
  return out;
}

export function generateCode(req: CodeRequest, target: CodeTarget): string {
  switch (target) {
    case 'curl':
      return toCurlBash(req);
    case 'curl-cmd':
      return toCurlCmd(req);
    case 'fetch':
      return jsFetch(req, 'browser');
    case 'node':
      return jsFetch(req, 'node');
    case 'axios':
      return jsAxios(req);
    case 'python':
      return pythonRequests(req);
    case 'httpie':
      return httpie(req);
  }
}
