/**
 * Data model for the API client. Everything here is plain data so it can be
 * stored in IndexedDB (File/Blob values survive structured cloning) and, minus
 * files, exported as JSON.
 */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof METHODS)[number];

export function isHttpMethod(value: unknown): value is HttpMethod {
  return typeof value === 'string' && (METHODS as readonly string[]).includes(value);
}

/** One row of a key/value table (params, headers, urlencoded body, variables). */
export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface FormField extends KeyValue {
  kind: 'text' | 'file';
  /** The chosen file (kept in memory / IndexedDB; never exported). */
  file?: Blob | null;
  /** Name of the chosen file, kept even when the file itself is not available (imports, history). */
  fileName?: string;
}

export type BodyMode = 'none' | 'raw' | 'form-data' | 'urlencoded' | 'binary';
export type RawLanguage = 'text' | 'json' | 'xml' | 'html';

export interface RequestBody {
  mode: BodyMode;
  raw: string;
  rawLanguage: RawLanguage;
  form: FormField[];
  urlencoded: KeyValue[];
  binary: Blob | null;
  binaryName?: string;
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

/** Auth settings. All fields are kept so switching the type back and forth does not lose input. */
export interface AuthConfig {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query';
}

export interface RequestDraft {
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: RequestBody;
  auth: AuthConfig;
  /** Milliseconds; 0 disables the timeout. */
  timeoutMs: number;
}

export interface SavedRequest extends RequestDraft {
  id: string;
  collectionId: string;
  folderId: string | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApiFolder {
  id: string;
  name: string;
}

export interface ApiCollection {
  id: string;
  name: string;
  folders: ApiFolder[];
  /** Collection-scoped variables (e.g. from a Postman import); environments override them. */
  variables: KeyValue[];
  createdAt: number;
  updatedAt: number;
}

export interface EnvVariable extends KeyValue {
  /** Masked in the editor and blanked in exports unless secrets are included. */
  secret: boolean;
}

export interface ApiEnvironment {
  id: string;
  name: string;
  variables: EnvVariable[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  at: number;
  method: HttpMethod;
  /** URL template as typed (variables unresolved, so env secrets never end up here). */
  url: string;
  status: number | null;
  timeMs: number | null;
  size: number | null;
  error?: string;
  via: 'browser' | 'companion';
  /** Sanitized copy of the request: no auth, no sensitive headers, no files. */
  request: RequestDraft;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

let counter = 0;
/** Short unique id for table rows (not persisted identity; collisions only matter within one table). */
export function rowId(): string {
  counter = (counter + 1) % 1_000_000;
  return `r${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function kv(key = '', value = '', enabled = true): KeyValue {
  return { id: rowId(), key, value, enabled };
}

export function emptyAuth(): AuthConfig {
  return { type: 'none', token: '', username: '', password: '', apiKeyName: 'X-API-Key', apiKeyValue: '', apiKeyIn: 'header' };
}

export function emptyBody(): RequestBody {
  return { mode: 'none', raw: '', rawLanguage: 'json', form: [], urlencoded: [], binary: null };
}

export function emptyDraft(): RequestDraft {
  return {
    name: 'Untitled request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: emptyBody(),
    auth: emptyAuth(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

/** Pick the draft part of a saved request (drops id, collection and timestamps). */
export function draftOf(req: RequestDraft): RequestDraft {
  return {
    name: req.name,
    method: req.method,
    url: req.url,
    params: req.params,
    headers: req.headers,
    body: req.body,
    auth: req.auth,
    timeoutMs: req.timeoutMs,
  };
}

/** Deep copy with fresh row ids (files are shared by reference, which is fine: Blobs are immutable). */
export function cloneDraft(draft: RequestDraft): RequestDraft {
  const rows = <T extends KeyValue>(list: T[]): T[] => list.map((r) => ({ ...r, id: rowId() }));
  return {
    ...draftOf(draft),
    params: rows(draft.params),
    headers: rows(draft.headers),
    body: { ...draft.body, form: rows(draft.body.form), urlencoded: rows(draft.body.urlencoded) },
    auth: { ...draft.auth },
  };
}

function rowsEqual<T extends KeyValue>(a: T[], b: T[], extra?: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.key === y.key && x.value === y.value && x.enabled === y.enabled && (!extra || extra(x, y));
  });
}

/** Structural equality used for the dirty indicator (row ids are ignored). */
export function draftsEqual(a: RequestDraft, b: RequestDraft): boolean {
  return (
    a.name === b.name &&
    a.method === b.method &&
    a.url === b.url &&
    a.timeoutMs === b.timeoutMs &&
    rowsEqual(a.params, b.params) &&
    rowsEqual(a.headers, b.headers) &&
    a.body.mode === b.body.mode &&
    a.body.raw === b.body.raw &&
    a.body.rawLanguage === b.body.rawLanguage &&
    a.body.binary === b.body.binary &&
    rowsEqual(a.body.urlencoded, b.body.urlencoded) &&
    rowsEqual(a.body.form, b.body.form, (x, y) => x.kind === y.kind && (x.file ?? null) === (y.file ?? null)) &&
    a.auth.type === b.auth.type &&
    a.auth.token === b.auth.token &&
    a.auth.username === b.auth.username &&
    a.auth.password === b.auth.password &&
    a.auth.apiKeyName === b.auth.apiKeyName &&
    a.auth.apiKeyValue === b.auth.apiKeyValue &&
    a.auth.apiKeyIn === b.auth.apiKeyIn
  );
}

/** Coerce loosely typed stored/imported data into a valid draft, filling defaults. */
export function normalizeDraft(input: Partial<RequestDraft> | undefined | null): RequestDraft {
  const base = emptyDraft();
  if (!input) return base;
  const rows = (list: unknown): KeyValue[] =>
    Array.isArray(list)
      ? list
          .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
          .map((r) => ({
            id: typeof r.id === 'string' ? r.id : rowId(),
            key: typeof r.key === 'string' ? r.key : '',
            value: typeof r.value === 'string' ? r.value : '',
            enabled: r.enabled !== false,
          }))
      : [];
  const body = (input.body ?? {}) as Partial<RequestBody>;
  const form: FormField[] = Array.isArray(body.form)
    ? body.form.map((f) => ({
        id: typeof f.id === 'string' ? f.id : rowId(),
        key: typeof f.key === 'string' ? f.key : '',
        value: typeof f.value === 'string' ? f.value : '',
        enabled: f.enabled !== false,
        kind: f.kind === 'file' ? 'file' : 'text',
        file: f.file instanceof Blob ? f.file : null,
        fileName: typeof f.fileName === 'string' ? f.fileName : undefined,
      }))
    : [];
  const auth = { ...base.auth, ...(input.auth ?? {}) };
  if (!['none', 'bearer', 'basic', 'apikey'].includes(auth.type)) auth.type = 'none';
  if (auth.apiKeyIn !== 'query') auth.apiKeyIn = 'header';
  const modes: BodyMode[] = ['none', 'raw', 'form-data', 'urlencoded', 'binary'];
  const langs: RawLanguage[] = ['text', 'json', 'xml', 'html'];
  return {
    name: typeof input.name === 'string' && input.name.trim() ? input.name : base.name,
    method: isHttpMethod(input.method) ? input.method : 'GET',
    url: typeof input.url === 'string' ? input.url : '',
    params: rows(input.params),
    headers: rows(input.headers),
    body: {
      mode: modes.includes(body.mode as BodyMode) ? (body.mode as BodyMode) : 'none',
      raw: typeof body.raw === 'string' ? body.raw : '',
      rawLanguage: langs.includes(body.rawLanguage as RawLanguage) ? (body.rawLanguage as RawLanguage) : 'json',
      form,
      urlencoded: rows(body.urlencoded),
      binary: body.binary instanceof Blob ? body.binary : null,
      binaryName: typeof body.binaryName === 'string' ? body.binaryName : undefined,
    },
    auth,
    timeoutMs:
      typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs >= 0
        ? input.timeoutMs
        : DEFAULT_TIMEOUT_MS,
  };
}

/** Header names whose values are credentials. Never stored in history. */
export const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.trim().toLowerCase());
}

/** A value that is only a variable reference (e.g. "{{token}}" or "Bearer {{token}}") holds no secret itself. */
export function isVariableOnly(value: string): boolean {
  const stripped = value.replace(/\{\{\s*[^{}]+?\s*\}\}/g, '').replace(/^(Bearer|Basic|Token)\s*/i, '').trim();
  return stripped === '';
}

export interface SecretFinding {
  label: string;
}

/** Lists the literal secrets a request would store (variable references are not secrets). */
export function findSecrets(draft: RequestDraft): SecretFinding[] {
  const out: SecretFinding[] = [];
  const a = draft.auth;
  if (a.type === 'bearer' && a.token && !isVariableOnly(a.token)) out.push({ label: 'Bearer token' });
  if (a.type === 'basic' && a.password && !isVariableOnly(a.password)) out.push({ label: 'Basic auth password' });
  if (a.type === 'apikey' && a.apiKeyValue && !isVariableOnly(a.apiKeyValue)) out.push({ label: `API key (${a.apiKeyName || 'key'})` });
  for (const h of draft.headers) {
    if (h.key && h.value && isSensitiveHeader(h.key) && !isVariableOnly(h.value)) out.push({ label: `Header ${h.key.trim()}` });
  }
  return out;
}

/** Remove literal secrets (auth values and sensitive header values) but keep the structure. */
export function stripSecrets(draft: RequestDraft): RequestDraft {
  const a = draft.auth;
  return {
    ...draft,
    auth: {
      ...a,
      token: isVariableOnly(a.token) ? a.token : '',
      password: isVariableOnly(a.password) ? a.password : '',
      apiKeyValue: isVariableOnly(a.apiKeyValue) ? a.apiKeyValue : '',
    },
    headers: draft.headers.map((h) => (isSensitiveHeader(h.key) && !isVariableOnly(h.value) ? { ...h, value: '' } : h)),
  };
}
