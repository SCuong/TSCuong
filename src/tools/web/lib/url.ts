import { hostnameToUnicode } from './urlPunycode';

export interface UrlParam {
  key: string;
  value: string;
  /** Exactly as written in the URL (still percent-encoded). */
  rawKey: string;
  rawValue: string;
  /** False for bare keys such as `?debug`. */
  hasEquals: boolean;
}

export interface PathSegment {
  raw: string;
  decoded: string;
}

export interface ParsedUrl {
  href: string;
  /** With the trailing colon, e.g. `https:`. */
  protocol: string;
  scheme: string;
  /** Decoded user name and password; the raw forms are what the URL contains. */
  username: string;
  password: string;
  rawUsername: string;
  rawPassword: string;
  host: string;
  /** ASCII hostname (IDNs appear as `xn--` labels). */
  hostname: string;
  /** Human-readable hostname; equals `hostname` unless the host is an IDN. */
  hostnameUnicode: string;
  isIdn: boolean;
  hostKind: 'domain' | 'ipv4' | 'ipv6' | 'none';
  /** Explicit port, or '' when the URL uses the scheme's default. */
  port: string;
  defaultPort: string | null;
  origin: string;
  pathname: string;
  segments: PathSegment[];
  /** Includes the leading `?`, or ''. */
  search: string;
  params: UrlParam[];
  /** Without the `#`, percent-encoded as in the URL. */
  rawHash: string;
  hash: string;
  /** Whether the URL has an authority (`scheme://host`), as opposed to e.g. `mailto:` or `data:`. */
  hasAuthority: boolean;
}

export type UrlResult = { ok: true; url: ParsedUrl } | { ok: false; error: string };

export const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

/** Percent-decodes without throwing on malformed sequences (they are left as written). */
export function safeDecode(value: string, plusAsSpace = false): string {
  const text = plusAsSpace ? value.replace(/\+/g, ' ') : value;
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
}

/** Splits a raw query (with or without `?`) the way URLSearchParams does, keeping raw forms. */
export function splitQuery(search: string): UrlParam[] {
  const text = search.startsWith('?') ? search.slice(1) : search;
  if (!text) return [];
  const out: UrlParam[] = [];
  for (const piece of text.split('&')) {
    if (!piece) continue;
    const eq = piece.indexOf('=');
    const rawKey = eq === -1 ? piece : piece.slice(0, eq);
    const rawValue = eq === -1 ? '' : piece.slice(eq + 1);
    out.push({ key: safeDecode(rawKey, true), value: safeDecode(rawValue, true), rawKey, rawValue, hasEquals: eq !== -1 });
  }
  return out;
}

function hostKind(hostname: string): ParsedUrl['hostKind'] {
  if (!hostname) return 'none';
  if (hostname.startsWith('[')) return 'ipv6';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return 'ipv4';
  return 'domain';
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function explainFailure(input: string, base: string | undefined): string {
  const text = input.trim();
  const port = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:(\d+)(?:[/?#]|$)/i.exec(text);
  if (port && Number(port[1]) > 65535) return `Port ${port[1]} is out of range. Ports go from 0 to 65535.`;
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:[^\d/?#\]]/i.test(text) && !/@/.test(text.split(/[/?#]/)[2] ?? '')) {
    return 'The port must be a number, e.g. https://example.com:8080.';
  }
  if (/^(https?|wss?|ftp):\/{0,2}$/i.test(text) || /^(https?|wss?|ftp):\/\/[/?#]/i.test(text)) return 'The URL has no host name.';
  if (/^(https?|wss?|ftp):\/\/[^/?#]*[\s<>^|]/i.test(text)) return 'The host name contains characters that are not allowed (spaces, <, >, ^ or |).';
  if (!SCHEME_RE.test(text)) {
    if (base === undefined) {
      if (/^(\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(text)) {
        return 'This looks like a URL without a scheme. Add one (e.g. https://), or set a base URL to resolve it against.';
      }
      return 'This is a relative URL. Set a base URL to resolve it, or enter a full URL such as https://example.com/page.';
    }
  }
  return 'This is not a valid URL.';
}

/** Parses an absolute URL, or a relative one against `base`. Returns null for empty input. */
export function parseUrl(input: string, base?: string): UrlResult | null {
  const text = input.trim();
  if (!text) return null;
  const baseText = base?.trim() || undefined;
  if (baseText !== undefined) {
    try {
      new URL(baseText);
    } catch {
      return { ok: false, error: 'The base URL is not valid. It must be absolute, e.g. https://example.com/docs/.' };
    }
  }
  let u: URL;
  try {
    u = new URL(text, baseText);
  } catch {
    return { ok: false, error: explainFailure(text, baseText) };
  }
  const hasAuthority = u.href.slice(u.protocol.length).startsWith('//');
  const hostnameUnicode = hostnameToUnicode(u.hostname);
  const pieces = u.pathname.split('/');
  const segments =
    hasAuthority || u.pathname.startsWith('/')
      ? pieces.slice(1).filter((s, _i, arr) => !(arr.length === 1 && s === ''))
      : [];
  const rawHash = u.hash.slice(1);
  return {
    ok: true,
    url: {
      href: u.href,
      protocol: u.protocol,
      scheme: u.protocol.slice(0, -1),
      username: safeDecode(u.username),
      password: safeDecode(u.password),
      rawUsername: u.username,
      rawPassword: u.password,
      host: u.host,
      hostname: u.hostname,
      hostnameUnicode,
      isIdn: hostnameUnicode !== u.hostname,
      hostKind: hostKind(u.hostname),
      port: u.port,
      defaultPort: DEFAULT_PORTS[u.protocol] ?? null,
      origin: u.origin === 'null' ? '' : u.origin,
      pathname: u.pathname,
      segments: segments.map((raw) => ({ raw, decoded: safeDecode(raw) })),
      search: u.search,
      params: splitQuery(u.search),
      rawHash,
      hash: safeDecode(rawHash),
      hasAuthority,
    },
  };
}

export interface BuilderParam {
  key: string;
  value: string;
  /** Raw forms from the parsed URL; reused while the decoded text is unchanged, so untouched params keep their encoding. */
  rawKey?: string;
  rawValue?: string;
  hasEquals?: boolean;
}

export interface UrlParts {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  params: BuilderParam[];
  /** Fragment without `#`, as written (percent-encoding is added where required). */
  hash: string;
}

export function partsFromUrl(url: ParsedUrl): UrlParts {
  return {
    protocol: url.scheme,
    username: url.username,
    password: url.password,
    hostname: url.hostnameUnicode,
    port: url.port,
    pathname: url.pathname,
    params: url.params.map((p) => ({ ...p })),
    hash: url.rawHash,
  };
}

/** Encodes a query component for a URL (spaces as %20). */
export function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeUserinfo(value: string): string {
  return encodeURIComponent(value);
}

const HIERARCHICAL = new Set(['http', 'https', 'ws', 'wss', 'ftp', 'file']);

export type BuildResult = { ok: true; href: string } | { ok: false; error: string };

/** Rebuilds a URL from editable parts. Validates the result with the URL parser. */
export function buildUrl(parts: UrlParts): BuildResult {
  const scheme = parts.protocol.trim().replace(/:?\/*$/, '').toLowerCase();
  if (!scheme) return { ok: false, error: 'Enter a scheme such as https.' };
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return { ok: false, error: `“${scheme}” is not a valid scheme. Use letters, digits, +, - or . and start with a letter.` };
  const port = parts.port.trim();
  if (port && !/^\d+$/.test(port)) return { ok: false, error: 'The port must be a whole number.' };
  if (port && Number(port) > 65535) return { ok: false, error: `Port ${port} is out of range. Ports go from 0 to 65535.` };

  let host = parts.hostname.trim();
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  const authority = HIERARCHICAL.has(scheme) || host !== '' || parts.username !== '' || parts.password !== '';
  if (authority && scheme !== 'file' && !host) return { ok: false, error: 'Enter a host name.' };

  let out = `${scheme}:`;
  let path = parts.pathname;
  if (authority) {
    out += '//';
    if (parts.username || parts.password) {
      out += encodeUserinfo(parts.username);
      if (parts.password) out += `:${encodeUserinfo(parts.password)}`;
      out += '@';
    }
    out += host;
    if (port) out += `:${port}`;
    if (path && !path.startsWith('/')) path = `/${path}`;
  }
  out += path;

  const query = parts.params
    .filter((p) => p.key !== '' || p.value !== '')
    .map((p) => {
      const k = p.rawKey !== undefined && safeDecode(p.rawKey, true) === p.key ? p.rawKey : encodeQueryComponent(p.key);
      if (p.value === '' && p.hasEquals === false) return k;
      const v = p.rawValue !== undefined && safeDecode(p.rawValue, true) === p.value ? p.rawValue : encodeQueryComponent(p.value);
      return `${k}=${v}`;
    });
  if (query.length) out += `?${query.join('&')}`;
  if (parts.hash) out += `#${parts.hash.replace(/^#/, '')}`;

  try {
    return { ok: true, href: new URL(out).href };
  } catch {
    if (/[\s<>^|%]/.test(host) && !host.startsWith('[')) return { ok: false, error: 'The host name contains characters that are not allowed.' };
    return { ok: false, error: 'These parts do not form a valid URL.' };
  }
}

/** Human-readable form of a URL: Unicode host and decoded path, query and fragment (for display only). */
export function toDisplayUrl(url: ParsedUrl): string {
  if (!url.hasAuthority) return safeDecode(url.href);
  const auth = url.rawUsername ? `${url.username}${url.rawPassword ? ':••••' : ''}@` : '';
  const host = url.hostnameUnicode + (url.port ? `:${url.port}` : '');
  return `${url.protocol}//${auth}${host}${safeDecode(url.pathname)}${safeDecode(url.search)}${url.rawHash ? `#${url.hash}` : ''}`;
}
