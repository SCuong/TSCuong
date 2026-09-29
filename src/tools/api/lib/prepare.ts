import type { AuthConfig, HttpMethod, KeyValue, RequestDraft } from './model';
import { appendQueryParam, ensureScheme } from './url';
import { resolveVars, type DynamicVars, type Scope, defaultDynamicVars } from './vars';

export type PreparedField = { name: string; value: string } | { name: string; file: Blob; fileName: string };

export type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'form'; fields: PreparedField[] }
  | { kind: 'blob'; blob: Blob; fileName: string };

/** A request with every variable resolved and auth applied, ready to send or turn into code. */
export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body: PreparedBody;
  timeoutMs: number;
  /** Names of headers that came from the Auth tab (used to redact code samples). */
  authHeaderNames: string[];
  /** Query parameter added by API-key auth, if any (used to redact code samples). */
  authQueryParam: string | null;
}

export type PrepareResult =
  | { ok: true; request: PreparedRequest; warnings: string[] }
  | { ok: false; error: string; missing: string[] };

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function isValidHeaderName(name: string): boolean {
  return TOKEN_RE.test(name);
}

/** UTF-8 safe base64 (btoa only handles Latin-1). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const RAW_CONTENT_TYPES = {
  text: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
} as const;

function hasHeader(headers: Array<[string, string]>, name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some(([n]) => n.toLowerCase() === lower);
}

function removeHeader(headers: Array<[string, string]>, name: string): boolean {
  const lower = name.toLowerCase();
  let removed = false;
  for (let i = headers.length - 1; i >= 0; i--) {
    if (headers[i][0].toLowerCase() === lower) {
      headers.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

/**
 * Resolve variables, apply auth and build the body for a draft.
 * Returns a human-readable error instead of throwing.
 */
export function prepareRequest(draft: RequestDraft, scope: Scope, dynamic: DynamicVars | null = defaultDynamicVars): PrepareResult {
  const missing = new Set<string>();
  const cyclic = new Set<string>();
  const warnings: string[] = [];
  const r = (text: string) => {
    const res = resolveVars(text, scope, dynamic);
    res.missing.forEach((m) => missing.add(m));
    res.cyclic.forEach((c) => cyclic.add(c));
    return res.text;
  };
  const enabled = (rows: KeyValue[]) => rows.filter((row) => row.enabled && (row.key.trim() !== '' || row.value !== ''));

  if (!draft.url.trim()) return { ok: false, error: 'Enter a URL to send the request to.', missing: [] };

  let url = ensureScheme(r(draft.url));
  const headers: Array<[string, string]> = [];
  for (const h of enabled(draft.headers)) {
    const name = r(h.key).trim();
    if (!name) continue;
    headers.push([name, r(h.value)]);
  }

  // Auth
  const authHeaderNames: string[] = [];
  let authQueryParam: string | null = null;
  const auth: AuthConfig = draft.auth;
  const setAuthHeader = (name: string, value: string) => {
    if (removeHeader(headers, name)) warnings.push(`The ${name} header from the Auth tab replaces the one in the Headers tab.`);
    headers.push([name, value]);
    authHeaderNames.push(name);
  };
  if (auth.type === 'bearer') {
    const token = r(auth.token).trim();
    if (!token) return { ok: false, error: 'Bearer auth is selected but the token is empty.', missing: [...missing] };
    setAuthHeader('Authorization', `Bearer ${token}`);
  } else if (auth.type === 'basic') {
    const user = r(auth.username);
    if (user.includes(':')) return { ok: false, error: 'A Basic auth username cannot contain ":".', missing: [...missing] };
    setAuthHeader('Authorization', `Basic ${base64Utf8(`${user}:${r(auth.password)}`)}`);
  } else if (auth.type === 'apikey') {
    const name = r(auth.apiKeyName).trim();
    if (!name) return { ok: false, error: 'API key auth needs a key name.', missing: [...missing] };
    const value = r(auth.apiKeyValue);
    if (auth.apiKeyIn === 'header') setAuthHeader(name, value);
    else {
      url = appendQueryParam(url, name, value);
      authQueryParam = name;
    }
  }

  // Body
  let body: PreparedBody = { kind: 'none' };
  const b = draft.body;
  if (b.mode === 'raw') {
    body = { kind: 'text', text: r(b.raw) };
    if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', RAW_CONTENT_TYPES[b.rawLanguage]]);
  } else if (b.mode === 'urlencoded') {
    const params = new URLSearchParams();
    for (const row of enabled(b.urlencoded)) params.append(r(row.key), r(row.value));
    body = { kind: 'text', text: params.toString() };
    if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  } else if (b.mode === 'form-data') {
    const fields: PreparedField[] = [];
    for (const row of b.form.filter((f) => f.enabled && (f.key.trim() || f.value || f.file))) {
      const name = r(row.key);
      if (row.kind === 'file') {
        if (!row.file) {
          return {
            ok: false,
            error: `Choose a file for the form field "${name || '(unnamed)'}"${row.fileName ? ` (was ${row.fileName})` : ''}, or disable that row.`,
            missing: [...missing],
          };
        }
        fields.push({ name, file: row.file, fileName: row.fileName || 'file' });
      } else fields.push({ name, value: r(row.value) });
    }
    body = { kind: 'form', fields };
    if (removeHeader(headers, 'content-type')) {
      warnings.push('The Content-Type header was removed: form-data needs the boundary the sender generates.');
    }
  } else if (b.mode === 'binary') {
    if (!b.binary) return { ok: false, error: 'Choose a file to send as the binary body.', missing: [...missing] };
    body = { kind: 'blob', blob: b.binary, fileName: b.binaryName || 'file' };
    if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', b.binary.type || 'application/octet-stream']);
  }

  if (missing.size > 0) {
    const list = [...missing].map((m) => `{{${m}}}`).join(', ');
    return {
      ok: false,
      error: `Unresolved variable${missing.size === 1 ? '' : 's'} ${list}. Define ${missing.size === 1 ? 'it' : 'them'} in the active environment, or write \\{{ to send literal braces.`,
      missing: [...missing],
    };
  }
  if (cyclic.size > 0) {
    return { ok: false, error: `Variables reference each other in a loop: ${[...cyclic].join(', ')}.`, missing: [] };
  }

  for (const [name, value] of headers) {
    if (!isValidHeaderName(name)) return { ok: false, error: `"${name}" is not a valid header name.`, missing: [] };
    if (/[\r\n\0]/.test(value)) return { ok: false, error: `The ${name} header value contains a line break.`, missing: [] };
    if ([...value].some((ch) => ch.codePointAt(0)! > 0xff)) {
      return {
        ok: false,
        error: `The ${name} header value contains characters that HTTP headers cannot carry (such as emoji or non-Latin letters). Percent-encode or Base64-encode it.`,
        missing: [],
      };
    }
  }

  if ((draft.method === 'GET' || draft.method === 'HEAD') && body.kind !== 'none') {
    return {
      ok: false,
      error: `${draft.method} requests cannot have a body in browsers or Node's fetch. Set the body to "None" or use POST.`,
      missing: [],
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `"${url}" is not a valid URL.`, missing: [] };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Only http:// and https:// URLs can be requested (got ${parsed.protocol}//).`, missing: [] };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Credentials in the URL (user:pass@host) are not allowed by fetch. Use Basic auth instead.', missing: [] };
  }

  return {
    ok: true,
    request: { method: draft.method, url, headers, body, timeoutMs: draft.timeoutMs, authHeaderNames, authQueryParam },
    warnings,
  };
}

/** Build the fetch() body. */
export function toBodyInit(body: PreparedBody): BodyInit | null {
  switch (body.kind) {
    case 'none':
      return null;
    case 'text':
      return body.text;
    case 'blob':
      return body.blob;
    case 'form': {
      const fd = new FormData();
      for (const f of body.fields) {
        if ('file' in f) fd.append(f.name, f.file, f.fileName);
        else fd.append(f.name, f.value);
      }
      return fd;
    }
  }
}

/**
 * Header names browsers refuse to set from JavaScript (they are silently dropped),
 * per the Fetch standard's forbidden request-header list.
 */
const FORBIDDEN = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function isForbiddenHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return FORBIDDEN.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

/** Forbidden headers in a header list (unique, as written). Chrome also ignores User-Agent. */
export function forbiddenHeaders(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const lower = name.trim().toLowerCase();
    if ((isForbiddenHeader(name) || lower === 'user-agent') && !out.some((o) => o.toLowerCase() === lower)) out.push(name.trim());
  }
  return out;
}
