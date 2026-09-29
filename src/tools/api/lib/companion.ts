import type { PreparedRequest } from './prepare';
import { toBodyInit } from './prepare';
import type { ApiResponse } from './response';

/**
 * Browser side of the optional local companion (companion/server.mjs).
 *
 * The companion listens on 127.0.0.1 only and proxies one request per call:
 *   POST /proxy   { method, url, headers, bodyBase64, timeoutMs }
 *              -> { status, statusText, headers, bodyBase64, timeMs, url, redirected }
 * Every call carries the token printed by the companion at startup in the
 * X-LocalKit-Token header.
 */

export const DEFAULT_COMPANION_PORT = 17878;
export const TOKEN_HEADER = 'X-LocalKit-Token';
export const COMPANION_NAME = 'localkit-companion';

export interface RequestEnvelope {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  /** Base64 of the body bytes; null when there is no body. */
  bodyBase64: string | null;
  timeoutMs: number;
}

export interface ResponseEnvelope {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  bodyBase64: string;
  timeMs: number;
  url: string;
  redirected: boolean;
}

/* -------------------------------- base64 --------------------------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ------------------------------- envelopes -------------------------------- */

/**
 * Serialize a prepared request. Multipart bodies are encoded with the browser's
 * own FormData serializer so the boundary in Content-Type matches the bytes.
 */
export async function encodeRequest(req: PreparedRequest): Promise<RequestEnvelope> {
  const headers = req.headers.map(([n, v]): [string, string] => [n, v]);
  let bodyBase64: string | null = null;
  if (req.body.kind === 'text') {
    bodyBase64 = bytesToBase64(new TextEncoder().encode(req.body.text));
  } else if (req.body.kind === 'blob') {
    bodyBase64 = bytesToBase64(new Uint8Array(await req.body.blob.arrayBuffer()));
  } else if (req.body.kind === 'form') {
    const encoded = new Request('http://localhost/', { method: 'POST', body: toBodyInit(req.body) });
    const contentType = encoded.headers.get('content-type');
    if (contentType) headers.push(['Content-Type', contentType]);
    bodyBase64 = bytesToBase64(new Uint8Array(await encoded.arrayBuffer()));
  }
  return { method: req.method, url: req.url, headers, bodyBase64, timeoutMs: req.timeoutMs };
}

function isPairList(value: unknown): value is Array<[string, string]> {
  return Array.isArray(value) && value.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string');
}

/** Validate a companion response and turn it into an ApiResponse. Throws a readable Error when malformed. */
export function decodeResponse(data: unknown): Omit<ApiResponse, 'via'> {
  if (!data || typeof data !== 'object') throw new Error('The companion sent an unreadable answer.');
  const d = data as Record<string, unknown>;
  if (typeof d.status !== 'number' || !Number.isInteger(d.status) || d.status < 100 || d.status > 999) {
    throw new Error('The companion answer has no valid status code.');
  }
  if (!isPairList(d.headers)) throw new Error('The companion answer has malformed headers.');
  if (typeof d.bodyBase64 !== 'string') throw new Error('The companion answer has no body field.');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(d.bodyBase64);
  } catch {
    throw new Error('The companion answer body is not valid base64.');
  }
  const type = d.headers.find(([n]) => n.toLowerCase() === 'content-type')?.[1] ?? '';
  return {
    status: d.status,
    statusText: typeof d.statusText === 'string' ? d.statusText : '',
    headers: d.headers,
    body: new Blob([bytes], { type }),
    timeMs: typeof d.timeMs === 'number' ? d.timeMs : 0,
    url: typeof d.url === 'string' ? d.url : '',
    redirected: d.redirected === true,
  };
}

/* -------------------------------- client ---------------------------------- */

export function companionBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export type CompanionStatus =
  | { state: 'connected'; version: string }
  | { state: 'not-running' }
  | { state: 'wrong-token' }
  | { state: 'not-companion' };

/** Check whether the companion is running on `port` and accepts `token`. */
export async function checkCompanion(port: number, token: string, signal?: AbortSignal): Promise<CompanionStatus> {
  let res: Response;
  try {
    res = await fetch(`${companionBase(port)}/health`, {
      headers: { [TOKEN_HEADER]: token },
      signal: signal ?? AbortSignal.timeout(3000),
      cache: 'no-store',
    });
  } catch {
    return { state: 'not-running' };
  }
  if (res.status === 401) return { state: 'wrong-token' };
  try {
    const body = (await res.json()) as { name?: string; version?: string };
    if (res.ok && body.name === COMPANION_NAME) return { state: 'connected', version: String(body.version ?? '') };
  } catch {
    /* not JSON */
  }
  return { state: 'not-companion' };
}

/** Send a prepared request through the companion. Network failures throw; HTTP errors from the target are normal responses. */
export async function sendViaCompanion(
  req: PreparedRequest,
  port: number,
  token: string,
  signal: AbortSignal,
): Promise<Omit<ApiResponse, 'via'>> {
  const envelope = await encodeRequest(req);
  let res: Response;
  try {
    res = await fetch(`${companionBase(port)}/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: token },
      body: JSON.stringify(envelope),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error;
    throw new Error(`The local companion is not reachable on port ${port}. Start it with "npm run companion" or switch "Send via" to Browser.`, { cause: error });
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('The companion sent an unreadable answer.');
  }
  if (!res.ok) {
    const message = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : '';
    if (res.status === 401) throw new Error('The companion rejected the token. Copy the token it printed at startup into the companion settings.');
    throw new Error(message || `The companion answered with HTTP ${res.status}.`);
  }
  return decodeResponse(data);
}
