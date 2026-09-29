#!/usr/bin/env node
/**
 * LocalKit local companion: an optional, zero-dependency HTTP proxy for the
 * LocalKit API client. It lets the browser app reach APIs that do not send CORS
 * headers, plain-http servers from an https page, and headers browsers refuse
 * to set (Cookie, Origin, User-Agent, ...).
 *
 * Security model (see companion/README.md):
 * - listens on 127.0.0.1 only, never on a public interface;
 * - every request must carry the random token printed at startup;
 * - CORS is granted only to http(s)://localhost / 127.0.0.1 / [::1] origins plus
 *   explicit --allow-origin values, and the Host header must be a loopback name
 *   (defeats DNS rebinding);
 * - it refuses to proxy to itself, limits request/response sizes and times out.
 *
 * Usage: node companion/server.mjs [--port 17878] [--token <t>] [--allow-origin <origin>]...
 *                                  [--max-bytes 52428800] [--timeout 30000]
 * Requires Node.js 20 or newer (global fetch).
 */
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';
export const NAME = 'localkit-companion';
export const DEFAULT_PORT = 17878;
export const TOKEN_HEADER = 'x-localkit-token';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
/** Hop-by-hop and connection-level headers that fetch manages itself. */
const DROPPED_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'expect', 'te', 'trailer', 'proxy-connection']);
const MAX_TIMEOUT_MS = 5 * 60 * 1000;

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

export function isAllowedOrigin(origin, extra = []) {
  return LOOPBACK_ORIGIN.test(origin) || extra.includes(origin);
}

function isLoopbackAddress(address) {
  if (net.isIPv4(address)) return address.startsWith('127.') || address === '0.0.0.0';
  const lower = address.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('::ffff:127.') || lower === '::ffff:0.0.0.0';
}

/** Does `target` point back at this companion (loopback address + our port)? */
export async function pointsToSelf(target, port) {
  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  if (targetPort !== port) return false;
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  try {
    const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.some((a) => isLoopbackAddress(a.address));
  } catch {
    return false;
  }
}

function tokensEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function isPairList(value) {
  return Array.isArray(value) && value.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string');
}

/** Validate a request envelope; returns an error string or null. */
export function validateEnvelope(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return 'The request must be a JSON object.';
  if (typeof env.method !== 'string' || !METHODS.has(env.method)) return `Unsupported method ${JSON.stringify(env.method)}.`;
  if (typeof env.url !== 'string') return 'The request has no URL.';
  let url;
  try {
    url = new URL(env.url);
  } catch {
    return `"${env.url}" is not a valid URL.`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http:// and https:// URLs can be proxied.';
  if (env.headers !== undefined && !isPairList(env.headers)) return 'Headers must be a list of [name, value] pairs.';
  if (env.bodyBase64 !== undefined && env.bodyBase64 !== null && typeof env.bodyBase64 !== 'string') return 'bodyBase64 must be a string or null.';
  if (env.timeoutMs !== undefined && (typeof env.timeoutMs !== 'number' || !Number.isFinite(env.timeoutMs) || env.timeoutMs < 0)) {
    return 'timeoutMs must be a non-negative number.';
  }
  if ((env.method === 'GET' || env.method === 'HEAD') && env.bodyBase64) return `${env.method} requests cannot have a body.`;
  return null;
}

function describeFetchError(error, url, timeoutMs) {
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { status: 504, message: `No response from ${url.host} within ${timeoutMs} ms.` };
  }
  const cause = error && error.cause;
  const code = cause && cause.code;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { status: 502, message: `Could not resolve the host name ${url.hostname}.` };
    case 'ECONNREFUSED':
      return { status: 502, message: `${url.host} refused the connection (is the server running on that port?).` };
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      return { status: 502, message: `${url.host} closed the connection unexpectedly.` };
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return { status: 504, message: `Connecting to ${url.host} timed out.` };
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { status: 502, message: `${url.host} is unreachable from this computer.` };
    default:
      if (typeof code === 'string' && /CERT|SSL|TLS|SELF_SIGNED/i.test(code)) {
        return { status: 502, message: `TLS certificate problem with ${url.host} (${code}).` };
      }
      return { status: 502, message: (cause && cause.message) || (error && error.message) || 'The request failed.' };
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `The request is larger than the companion's limit of ${limit} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readLimited(response, limit, signal) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(502, `The response is larger than the companion's limit of ${limit} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/**
 * Create a companion server (not yet listening).
 * @param {{ port?: number, token?: string, allowOrigins?: string[], maxBytes?: number, timeoutMs?: number, log?: (msg: string) => void }} options
 */
export function createCompanion(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const token = options.token || randomBytes(24).toString('base64url');
  const allowOrigins = options.allowOrigins ?? [];
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
  const defaultTimeout = options.timeoutMs ?? 30_000;
  const log = options.log ?? (() => {});
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const send = (status, body, extra = {}) => {
      const payload = body === null ? '' : JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extra,
      });
      res.end(payload);
    };

    // DNS rebinding defense: only loopback host names may address the companion.
    if (!allowedHosts.has(String(req.headers.host ?? '').toLowerCase())) {
      send(403, { error: 'Requests must address the companion as 127.0.0.1 or localhost.' });
      return;
    }

    let cors = {};
    if (origin !== undefined) {
      if (!isAllowedOrigin(origin, allowOrigins)) {
        log(`Rejected a request from origin ${origin}`);
        send(403, { error: `The origin ${origin} is not allowed. Start the companion with --allow-origin ${origin} to permit it.` });
        return;
      }
      cors = {
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Headers': `content-type, ${TOKEN_HEADER}`,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
      };
      if (req.headers['access-control-request-private-network'] === 'true') cors['Access-Control-Allow-Private-Network'] = 'true';
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== '/health' && url.pathname !== '/proxy') {
      send(404, { error: 'Not found.' }, cors);
      return;
    }
    if (!tokensEqual(req.headers[TOKEN_HEADER] ?? '', token)) {
      send(401, { error: 'Missing or wrong companion token.' }, cors);
      return;
    }
    if (url.pathname === '/health') {
      if (req.method !== 'GET') return send(405, { error: 'Use GET.' }, cors);
      send(200, { name: NAME, version: VERSION }, cors);
      return;
    }
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' }, cors);

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      // base64 is 4/3 of the body, plus room for headers and the URL.
      const raw = await readBody(req, Math.ceil(maxBytes * 1.34) + 1024 * 1024);
      let env;
      try {
        env = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new HttpError(400, 'The request body is not valid JSON.');
      }
      const invalid = validateEnvelope(env);
      if (invalid) throw new HttpError(400, invalid);
      const target = new URL(env.url);
      if (await pointsToSelf(target, port)) throw new HttpError(400, 'The companion does not proxy requests to itself.');

      const body = env.bodyBase64 ? Buffer.from(env.bodyBase64, 'base64') : undefined;
      if (body && body.length > maxBytes) throw new HttpError(413, `The request body is larger than ${maxBytes} bytes.`);
      const headers = new Headers();
      const dropped = [];
      for (const [name, value] of env.headers ?? []) {
        if (DROPPED_HEADERS.has(name.toLowerCase())) {
          dropped.push(name);
          continue;
        }
        try {
          headers.append(name, value);
        } catch {
          throw new HttpError(400, `The header ${name} is not valid.`);
        }
      }
      const timeoutMs = Math.min(env.timeoutMs > 0 ? env.timeoutMs : defaultTimeout, MAX_TIMEOUT_MS);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
      const started = performance.now();
      let response;
      let bytes;
      try {
        response = await fetch(target, { method: env.method, headers, body, redirect: 'follow', signal });
        bytes = await readLimited(response, maxBytes, signal);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        const { status, message } = describeFetchError(error, target, timeoutMs);
        throw new HttpError(status, message);
      }
      const timeMs = performance.now() - started;
      const outHeaders = [];
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') outHeaders.push([name, value]);
      });
      for (const cookie of response.headers.getSetCookie?.() ?? []) outHeaders.push(['set-cookie', cookie]);
      log(`${env.method} ${target.href} -> ${response.status} (${Math.round(timeMs)} ms, ${bytes.length} bytes)`);
      send(
        200,
        {
          status: response.status,
          statusText: response.statusText,
          headers: outHeaders,
          bodyBase64: bytes.toString('base64'),
          timeMs,
          url: response.url || target.href,
          redirected: response.redirected,
          droppedHeaders: dropped,
        },
        cors,
      );
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof HttpError) send(error.status, { error: error.message }, cors);
      else send(500, { error: error instanceof Error ? error.message : 'Internal error.' }, cors);
    }
  });

  return {
    server,
    token,
    port,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

function parseArgs(argv) {
  const out = { allowOrigins: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const next = () => {
      if (inline !== undefined) return inline;
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value.`);
      return value;
    };
    switch (flag) {
      case '--port':
      case '-p':
        out.port = Number(next());
        break;
      case '--token':
        out.token = next();
        break;
      case '--allow-origin':
        out.allowOrigins.push(next().replace(/\/+$/, ''));
        break;
      case '--max-bytes':
        out.maxBytes = Number(next());
        break;
      case '--timeout':
        out.timeoutMs = Number(next());
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        throw new Error(`Unknown option ${arg}. Run with --help for usage.`);
    }
  }
  return out;
}

const USAGE = `LocalKit companion ${VERSION}: a local proxy for the LocalKit API client.

Usage: npm run companion -- [options]
       node companion/server.mjs [options]

Options:
  --port <n>            Port on 127.0.0.1 (default ${DEFAULT_PORT}, env LOCALKIT_COMPANION_PORT)
  --token <t>           Use this token instead of a random one (env LOCALKIT_COMPANION_TOKEN)
  --allow-origin <o>    Also accept requests from this origin, e.g. https://tools.example.com
                        (repeatable; env LOCALKIT_COMPANION_ALLOW_ORIGIN, comma-separated)
  --max-bytes <n>       Request/response body limit in bytes (default 52428800 = 50 MB)
  --timeout <ms>        Default upstream timeout (default 30000)
  -h, --help            Show this help`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const port = args.port ?? Number(process.env.LOCALKIT_COMPANION_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('The port must be a whole number between 1 and 65535.');
    process.exit(2);
  }
  const envOrigins = (process.env.LOCALKIT_COMPANION_ALLOW_ORIGIN ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  const companion = createCompanion({
    port,
    token: args.token || process.env.LOCALKIT_COMPANION_TOKEN || undefined,
    allowOrigins: [...args.allowOrigins, ...envOrigins],
    maxBytes: Number.isFinite(args.maxBytes) && args.maxBytes > 0 ? args.maxBytes : undefined,
    timeoutMs: Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : undefined,
    log: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
  });
  try {
    await companion.listen();
  } catch (error) {
    console.error(
      error && error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Is the companion already running? Use --port to pick another.`
        : `Could not start: ${error.message}`,
    );
    process.exit(1);
  }
  const extra = [...args.allowOrigins, ...envOrigins];
  // One write, so the banner is never interleaved with request logs.
  console.log(
    [
      `LocalKit companion ${VERSION} listening on http://127.0.0.1:${port}`,
      '',
      `  Token: ${companion.token}`,
      '',
      'Paste the token into LocalKit > API Client > Send via: Local companion > Companion settings.',
      `Accepting requests from localhost origins${extra.length ? ` and ${extra.join(', ')}` : ''}. Press Ctrl+C to stop.`,
    ].join('\n'),
  );
  const stop = () => {
    console.log('\nStopping the companion.');
    companion.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
