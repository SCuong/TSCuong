/**
 * Response helpers: status reasons, content classification, pretty printing,
 * download names and honest explanations of network failures.
 */

export interface ApiResponse {
  status: number;
  /** Reason phrase as sent by the server (HTTP/2 servers send none). */
  statusText: string;
  headers: Array<[string, string]>;
  body: Blob;
  timeMs: number;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  via: 'browser' | 'companion';
}

export const PRETTY_LIMIT = 5 * 1024 * 1024;

const REASONS: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  208: 'Already Reported',
  226: 'IM Used',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

/** The server's reason phrase, or the standard one for the code. */
export function statusReason(status: number, statusText = ''): string {
  return statusText.trim() || REASONS[status] || '';
}

export type StatusTone = 'info' | 'success' | 'redirect' | 'client' | 'server';

export function statusTone(status: number): StatusTone {
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  if (status >= 300) return 'redirect';
  if (status >= 200) return 'success';
  return 'info';
}

export function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([n]) => n.toLowerCase() === lower)?.[1];
}

/** Media type without parameters, lower-cased ("" when absent). */
export function mediaType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export type BodyKind = 'empty' | 'json' | 'html' | 'xml' | 'text' | 'image' | 'pdf' | 'binary';

const TEXT_TYPES = /^(text\/|application\/(javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|x-yaml|toml|sql|x-sh|csv)\b)/;

/** Decide how to show a body from its content type, sniffing the first bytes when the type is missing or generic. */
export function classifyBody(contentType: string | undefined, size: number, head: Uint8Array): BodyKind {
  if (size === 0) return 'empty';
  const type = mediaType(contentType);
  if (type === 'application/json' || /\+json$/.test(type) || type === 'application/problem+json') return 'json';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'image/svg+xml') return 'image';
  if (/(^|\/|\+)xml$/.test(type)) return 'xml';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (TEXT_TYPES.test(type)) return 'text';
  // Unknown or generic type: sniff.
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47]) || startsWith(head, [0xff, 0xd8, 0xff]) || startsWith(head, [0x47, 0x49, 0x46])) {
    return 'image';
  }
  if (!looksLikeText(head)) return 'binary';
  const text = new TextDecoder().decode(head).trimStart();
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  if (/^<!doctype html|^<html/i.test(text)) return 'html';
  if (text.startsWith('<?xml')) return 'xml';
  return 'text';
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

/** Heuristic: valid UTF-8 without NUL or many control characters. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  if (control / bytes.length > 0.1) return false;
  try {
    // Allow a truncated multi-byte sequence at the very end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, trimIncompleteUtf8(bytes)));
    return true;
  } catch {
    return false;
  }
}

function trimIncompleteUtf8(bytes: Uint8Array): number {
  let end = bytes.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = bytes[end - i];
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (need > i) end -= i;
    break;
  }
  return end;
}

/**
 * Re-indent valid JSON text without re-serializing values, so big integers,
 * number formatting and string escapes are shown exactly as sent.
 * Returns null when the text is not valid JSON.
 */
export function prettyPrintJson(text: string, indent = 2): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  const pad = ' '.repeat(indent);
  let out = '';
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[++i];
      } else if (ch === '"') inString = false;
      continue;
    }
    switch (ch) {
      case '"':
        inString = true;
        out += ch;
        break;
      case '{':
      case '[': {
        // Keep empty containers compact.
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const close = ch === '{' ? '}' : ']';
        if (text[j] === close) {
          out += ch + close;
          i = j;
        } else {
          depth++;
          out += `${ch}\n${pad.repeat(depth)}`;
        }
        break;
      }
      case '}':
      case ']':
        depth--;
        out += `\n${pad.repeat(depth)}${ch}`;
        break;
      case ',':
        out += `,\n${pad.repeat(depth)}`;
        break;
      case ':':
        out += ': ';
        break;
      case ' ':
      case '\n':
      case '\r':
      case '\t':
        break;
      default:
        out += ch;
    }
  }
  return out;
}

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/ld+json': 'jsonld',
  'application/geo+json': 'geojson',
  'application/problem+json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/xhtml+xml': 'xhtml',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/css': 'css',
  'text/markdown': 'md',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/octet-stream': 'bin',
  'application/wasm': 'wasm',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
};

export function extensionFor(contentType: string | undefined, kind?: BodyKind): string {
  const type = mediaType(contentType);
  if (EXTENSIONS[type]) return EXTENSIONS[type];
  if (/\+json$/.test(type)) return 'json';
  if (/\+xml$/.test(type)) return 'xml';
  switch (kind) {
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'xml':
      return 'xml';
    case 'text':
      return 'txt';
    case 'pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

/** Filename from Content-Disposition (filename*= preferred), without any path. */
export function dispositionFilename(disposition: string | undefined): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return sanitizeFilename(decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i.exec(disposition);
  if (plain) return sanitizeFilename((plain[2] ?? plain[1]).replace(/\\(.)/g, '$1').trim());
  return null;
}

function sanitizeFilename(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? '';
  const base = [...last.replace(/[<>:"|?*]/g, '_')]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .trim();
  return base && base !== '.' && base !== '..' ? base : null;
}

/** A download name for a response: Content-Disposition, else the URL's last path segment, with an extension. */
export function responseFilename(url: string, headers: Array<[string, string]>, kind: BodyKind): string {
  const fromHeader = dispositionFilename(headerValue(headers, 'content-disposition'));
  if (fromHeader) return fromHeader;
  const ext = extensionFor(headerValue(headers, 'content-type'), kind);
  let base = 'response';
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    const clean = sanitizeFilename(segment);
    if (clean) base = clean;
  } catch {
    /* keep default */
  }
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) return base;
  return `${base}.${ext}`;
}

/* -------------------------------------------------------------------------- */
/* Honest network error explanations                                          */
/* -------------------------------------------------------------------------- */

export interface FailureContext {
  /** The request URL (already resolved). */
  url: string;
  /** `location.protocol` of the page (e.g. "https:"). */
  pageProtocol: string;
  /** `navigator.onLine`. */
  online: boolean;
  via: 'browser' | 'companion';
}

export type FailureKind = 'offline' | 'mixed-content' | 'blocked-or-unreachable' | 'timeout' | 'cancelled' | 'companion' | 'other';

export interface FailureExplanation {
  kind: FailureKind;
  title: string;
  detail: string;
  /** Possible causes, most likely first. Browsers do not reveal which one happened. */
  causes: string[];
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\./.test(hostname);
}

export function explainFailure(error: unknown, ctx: FailureContext): FailureExplanation {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (name === 'TimeoutError') {
    return {
      kind: 'timeout',
      title: 'The request timed out',
      detail: 'No complete response arrived before the timeout. Increase the timeout in the request settings or check the server.',
      causes: [],
    };
  }
  if (name === 'AbortError') {
    return { kind: 'cancelled', title: 'Request cancelled', detail: 'You cancelled the request before a response arrived.', causes: [] };
  }
  if (ctx.via === 'companion') {
    return {
      kind: 'companion',
      title: 'The companion could not complete the request',
      detail: message || 'The local companion did not answer.',
      causes: [],
    };
  }
  if (!ctx.online) {
    return {
      kind: 'offline',
      title: 'You appear to be offline',
      detail: 'Your browser reports no network connection, so the request could not be sent.',
      causes: [],
    };
  }
  let target: URL | null = null;
  try {
    target = new URL(ctx.url);
  } catch {
    /* ignore */
  }
  if (target && ctx.pageProtocol === 'https:' && target.protocol === 'http:' && !isLoopbackHost(target.hostname)) {
    return {
      kind: 'mixed-content',
      title: 'Blocked as mixed content',
      detail:
        'This page is served over HTTPS, and browsers block requests from it to plain http:// servers. Use the https:// URL, or send it through the local companion.',
      causes: [],
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: 'blocked-or-unreachable',
      title: 'The browser could not get a response',
      detail:
        'The browser stopped the request without saying why. For security reasons it does not reveal which of these happened, so no response is shown:',
      causes: [
        'CORS: the server did not allow requests from this page (its response lacks a matching Access-Control-Allow-Origin header, or it rejected the preflight OPTIONS request).',
        'The server is unreachable: wrong host or port, DNS failure, server not running, or a firewall.',
        'A TLS problem, such as an invalid or self-signed certificate.',
        'A browser extension (for example an ad blocker) blocked the request.',
      ],
    };
  }
  return { kind: 'other', title: 'The request failed', detail: message || 'An unknown error occurred.', causes: [] };
}
