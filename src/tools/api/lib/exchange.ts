import {
  emptyAuth,
  emptyDraft,
  isHttpMethod,
  kv,
  normalizeDraft,
  rowId,
  stripSecrets,
  type ApiCollection,
  type ApiEnvironment,
  type AuthConfig,
  type EnvVariable,
  type FormField,
  type KeyValue,
  type RawLanguage,
  type RequestDraft,
  type SavedRequest,
} from './model';
import { withParamsFromUrl } from './url';

/**
 * Import/export of collections and environments.
 *
 * - LocalKit's own versioned JSON format (`format: "localkit-api"`, `version: 1`).
 * - Postman Collection v2.0/v2.1 and Postman environment files (import only).
 *
 * Every import produces fresh ids so importing twice never overwrites existing data.
 */

export const EXPORT_FORMAT = 'localkit-api';
export const EXPORT_VERSION = 1;

/** A request as written to an export file (no ids of its own besides folder membership, no file contents). */
export interface ExportedRequest {
  name: string;
  folder: string | null;
  favorite: boolean;
  method: string;
  url: string;
  params: Array<Omit<KeyValue, 'id'>>;
  headers: Array<Omit<KeyValue, 'id'>>;
  body: {
    mode: string;
    raw: string;
    rawLanguage: string;
    form: Array<Omit<KeyValue, 'id'> & { kind: 'text' | 'file'; fileName?: string }>;
    urlencoded: Array<Omit<KeyValue, 'id'>>;
    binaryName?: string;
  };
  auth: AuthConfig;
  timeoutMs: number;
}

export interface ExportedCollection {
  name: string;
  folders: string[];
  variables: Array<Omit<KeyValue, 'id'>>;
  requests: ExportedRequest[];
}

export interface ExportedEnvironment {
  name: string;
  variables: Array<Omit<EnvVariable, 'id'>>;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  includesSecrets: boolean;
  collections: ExportedCollection[];
  environments: ExportedEnvironment[];
}

const plainRow = (r: KeyValue) => ({ key: r.key, value: r.value, enabled: r.enabled });

function exportRequest(req: SavedRequest, folderName: string | null, includeSecrets: boolean): ExportedRequest {
  const d = includeSecrets ? req : stripSecrets(req);
  return {
    name: d.name,
    folder: folderName,
    favorite: req.favorite,
    method: d.method,
    url: d.url,
    params: d.params.map(plainRow),
    headers: d.headers.map(plainRow),
    body: {
      mode: d.body.mode,
      raw: d.body.raw,
      rawLanguage: d.body.rawLanguage,
      form: d.body.form.map((f: FormField) => ({
        key: f.key,
        value: f.kind === 'file' ? '' : f.value,
        enabled: f.enabled,
        kind: f.kind,
        ...(f.kind === 'file' && (f.fileName || (f.file instanceof File && f.file.name))
          ? { fileName: f.fileName || (f.file as File).name }
          : {}),
      })),
      urlencoded: d.body.urlencoded.map(plainRow),
      ...(d.body.binaryName ? { binaryName: d.body.binaryName } : {}),
    },
    auth: { ...d.auth },
    timeoutMs: d.timeoutMs,
  };
}

/** Build an export document. Without `includeSecrets`, auth values, sensitive headers and secret variables are blanked. */
export function buildExport(
  collections: ApiCollection[],
  requests: SavedRequest[],
  environments: ApiEnvironment[],
  includeSecrets: boolean,
  now = new Date(),
): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    includesSecrets: includeSecrets,
    collections: collections.map((c) => ({
      name: c.name,
      folders: c.folders.map((f) => f.name),
      variables: c.variables.map(plainRow),
      requests: requests
        .filter((r) => r.collectionId === c.id)
        .map((r) => exportRequest(r, c.folders.find((f) => f.id === r.folderId)?.name ?? null, includeSecrets)),
    })),
    environments: environments.map((e) => ({
      name: e.name,
      variables: e.variables.map((v) => ({
        key: v.key,
        value: v.secret && !includeSecrets ? '' : v.value,
        enabled: v.enabled,
        secret: v.secret,
      })),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export interface ImportResult {
  kind: 'localkit' | 'postman-collection' | 'postman-environment';
  collections: ApiCollection[];
  requests: SavedRequest[];
  environments: ApiEnvironment[];
  warnings: string[];
}

export type ImportOutcome = { ok: true; result: ImportResult } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback);

function rowsFrom(list: unknown, where: string): KeyValue[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new ImportError(`${where} must be a list.`);
  return list.map((r, i) => {
    if (!isObj(r)) throw new ImportError(`${where} row ${i + 1} is not an object.`);
    return { id: rowId(), key: str(r.key), value: str(r.value), enabled: r.enabled !== false && r.disabled !== true };
  });
}

class ImportError extends Error {}

/** Parse and validate an import file (LocalKit export, Postman collection or Postman environment). */
export function parseImport(text: string, newId: () => string, now = Date.now()): ImportOutcome {
  if (!text.trim()) return { ok: false, error: 'The file is empty.' };
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  try {
    if (isObj(data) && data.format === EXPORT_FORMAT) return { ok: true, result: importLocalKit(data, newId, now) };
    if (isObj(data) && isObj(data.info) && Array.isArray(data.item)) return { ok: true, result: importPostman(data, newId, now) };
    if (isObj(data) && Array.isArray(data.values) && typeof data.name === 'string') {
      return { ok: true, result: importPostmanEnvironment(data, newId, now) };
    }
    return {
      ok: false,
      error: 'Unrecognised file. Import a LocalKit API export, a Postman Collection (v2.0 or v2.1) or a Postman environment.',
    };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, error: error.message };
    throw error;
  }
}

function importLocalKit(data: Obj, newId: () => string, now: number): ImportResult {
  const version = data.version;
  if (typeof version !== 'number') throw new ImportError('The export file has no version number.');
  if (version > EXPORT_VERSION) {
    throw new ImportError(`This file was made by a newer LocalKit (format version ${version}). Update LocalKit to import it.`);
  }
  if (!Array.isArray(data.collections ?? [])) throw new ImportError('"collections" must be a list.');
  if (!Array.isArray(data.environments ?? [])) throw new ImportError('"environments" must be a list.');
  const warnings: string[] = [];
  const collections: ApiCollection[] = [];
  const requests: SavedRequest[] = [];
  const environments: ApiEnvironment[] = [];

  ((data.collections as unknown[]) ?? []).forEach((c, ci) => {
    if (!isObj(c)) throw new ImportError(`Collection ${ci + 1} is not an object.`);
    const name = str(c.name).trim() || `Imported collection ${ci + 1}`;
    const folderNames = Array.isArray(c.folders) ? c.folders.map((f) => str(f).trim()).filter(Boolean) : [];
    const folders = [...new Set(folderNames)].map((f) => ({ id: newId(), name: f }));
    const collection: ApiCollection = {
      id: newId(),
      name,
      folders,
      variables: rowsFrom(c.variables, `Variables of "${name}"`),
      createdAt: now,
      updatedAt: now,
    };
    collections.push(collection);
    if (c.requests !== undefined && !Array.isArray(c.requests)) throw new ImportError(`Requests of "${name}" must be a list.`);
    ((c.requests as unknown[]) ?? []).forEach((r, ri) => {
      if (!isObj(r)) throw new ImportError(`Request ${ri + 1} in "${name}" is not an object.`);
      if (!isHttpMethod(r.method)) {
        warnings.push(`Skipped "${str(r.name) || `request ${ri + 1}`}" in "${name}": unsupported method ${str(r.method) || '(none)'}.`);
        return;
      }
      const draft = normalizeDraft(r as Partial<RequestDraft>);
      let folderId: string | null = null;
      const folderName = str(r.folder).trim();
      if (folderName) {
        let folder = collection.folders.find((f) => f.name === folderName);
        if (!folder) {
          folder = { id: newId(), name: folderName };
          collection.folders.push(folder);
        }
        folderId = folder.id;
      }
      if (draft.body.form.some((f) => f.kind === 'file') || draft.body.mode === 'binary') {
        warnings.push(`"${draft.name}" uses files: choose them again before sending (exports never contain file contents).`);
      }
      requests.push({ ...draft, id: newId(), collectionId: collection.id, folderId, favorite: r.favorite === true, createdAt: now, updatedAt: now });
    });
  });

  ((data.environments as unknown[]) ?? []).forEach((e, ei) => {
    if (!isObj(e)) throw new ImportError(`Environment ${ei + 1} is not an object.`);
    const name = str(e.name).trim() || `Imported environment ${ei + 1}`;
    const rows = rowsFrom(e.variables, `Variables of environment "${name}"`);
    const secrets = Array.isArray(e.variables) ? e.variables.map((v) => isObj(v) && v.secret === true) : [];
    environments.push({
      id: newId(),
      name,
      variables: rows.map((r, i) => ({ ...r, secret: secrets[i] ?? false })),
      createdAt: now,
      updatedAt: now,
    });
  });

  if (data.includesSecrets === false && (collections.length || environments.length)) {
    warnings.push('This export was made without secrets: fill in tokens, passwords and secret variables before sending.');
  }
  return { kind: 'localkit', collections, requests, environments, warnings };
}

/* ------------------------------- Postman --------------------------------- */

function postmanKv(list: unknown): Array<{ key: string; value: string; enabled: boolean; type?: string; src?: unknown }> {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((r) => ({
    key: str(r.key),
    value: str(r.value),
    enabled: r.disabled !== true && r.enabled !== false,
    type: typeof r.type === 'string' ? r.type : undefined,
    src: r.src,
  }));
}

function postmanUrl(url: unknown): string {
  if (typeof url === 'string') return url;
  if (!isObj(url)) return '';
  if (typeof url.raw === 'string') return url.raw;
  // Rebuild from parts.
  const protocol = str(url.protocol);
  const host = Array.isArray(url.host) ? url.host.map((h) => str(h)).join('.') : str(url.host);
  const port = url.port ? `:${str(url.port)}` : '';
  const path = Array.isArray(url.path) ? url.path.map((p) => (isObj(p) ? str(p.value) : str(p))).join('/') : str(url.path);
  const query = postmanKv(url.query)
    .filter((q) => q.enabled)
    .map((q) => (q.value === '' ? q.key : `${q.key}=${q.value}`))
    .join('&');
  return `${protocol ? `${protocol}://` : ''}${host}${port}${path ? `/${path.replace(/^\//, '')}` : ''}${query ? `?${query}` : ''}`;
}

function postmanAuthValue(list: unknown, key: string): string {
  if (!Array.isArray(list)) {
    // v2.0 uses an object map.
    return isObj(list) ? str(list[key]) : '';
  }
  const row = list.find((r) => isObj(r) && r.key === key);
  return isObj(row) ? str(row.value) : '';
}

/** Returns the auth config, or undefined to inherit from the parent. */
function postmanAuth(auth: unknown, warnings: string[], where: string): AuthConfig | undefined {
  if (auth === undefined) return undefined;
  const base = emptyAuth();
  if (auth === null || !isObj(auth)) return base;
  const type = str(auth.type);
  switch (type) {
    case 'noauth':
    case '':
      return base;
    case 'bearer':
      return { ...base, type: 'bearer', token: postmanAuthValue(auth.bearer, 'token') };
    case 'basic':
      return {
        ...base,
        type: 'basic',
        username: postmanAuthValue(auth.basic, 'username'),
        password: postmanAuthValue(auth.basic, 'password'),
      };
    case 'apikey':
      return {
        ...base,
        type: 'apikey',
        apiKeyName: postmanAuthValue(auth.apikey, 'key') || 'X-API-Key',
        apiKeyValue: postmanAuthValue(auth.apikey, 'value'),
        apiKeyIn: postmanAuthValue(auth.apikey, 'in') === 'query' ? 'query' : 'header',
      };
    default:
      warnings.push(`${where}: "${type}" auth is not supported and was left out.`);
      return base;
  }
}

const POSTMAN_LANG: Record<string, RawLanguage> = { json: 'json', xml: 'xml', html: 'html', text: 'text', javascript: 'text' };

function postmanRequest(item: Obj, inheritedAuth: AuthConfig, warnings: string[]): RequestDraft | null {
  const name = str(item.name).trim() || 'Untitled request';
  const r = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : item.request;
  if (!isObj(r)) return null;
  const method = str(r.method, 'GET').toUpperCase();
  if (!isHttpMethod(method)) {
    warnings.push(`Skipped "${name}": unsupported method ${method}.`);
    return null;
  }
  const draft = emptyDraft();
  draft.name = name;
  draft.method = method;
  const { url, params } = withParamsFromUrl(postmanUrl(r.url));
  draft.url = url;
  draft.params = params;
  if (isObj(r.url) && Array.isArray(r.url.query)) {
    // Keep disabled query params from Postman as disabled rows.
    for (const q of postmanKv(r.url.query)) if (!q.enabled) draft.params.push({ id: rowId(), key: q.key, value: q.value, enabled: false });
  }
  if (isObj(r.url) && Array.isArray(r.url.variable) && r.url.variable.length) {
    warnings.push(`"${name}" uses path variables (:name); replace them with {{variables}} or literal values.`);
  }
  draft.headers = postmanKv(r.header).map((h) => ({ id: rowId(), key: h.key, value: h.value, enabled: h.enabled }));
  draft.auth = postmanAuth(r.auth, warnings, `"${name}"`) ?? { ...inheritedAuth };

  const body = r.body;
  if (isObj(body) && body.disabled !== true) {
    const mode = str(body.mode);
    if (mode === 'raw') {
      draft.body.mode = 'raw';
      draft.body.raw = str(body.raw);
      const lang = isObj(body.options) && isObj(body.options.raw) ? str(body.options.raw.language) : '';
      const ct = draft.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
      draft.body.rawLanguage =
        POSTMAN_LANG[lang] ?? (ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : ct.includes('html') ? 'html' : 'text');
    } else if (mode === 'urlencoded') {
      draft.body.mode = 'urlencoded';
      draft.body.urlencoded = postmanKv(body.urlencoded).map((p) => ({ id: rowId(), key: p.key, value: p.value, enabled: p.enabled }));
    } else if (mode === 'formdata') {
      draft.body.mode = 'form-data';
      let files = 0;
      draft.body.form = postmanKv(body.formdata).map((p): FormField => {
        if (p.type === 'file') {
          files++;
          const src = Array.isArray(p.src) ? str(p.src[0]) : str(p.src);
          return { id: rowId(), key: p.key, value: '', enabled: p.enabled, kind: 'file', file: null, fileName: src.split(/[\\/]/).pop() || undefined };
        }
        return { id: rowId(), key: p.key, value: p.value, enabled: p.enabled, kind: 'text' };
      });
      if (files) warnings.push(`"${name}" has file fields: choose the files again before sending.`);
    } else if (mode === 'file') {
      draft.body.mode = 'binary';
      const src = isObj(body.file) ? str(body.file.src) : '';
      draft.body.binaryName = src.split(/[\\/]/).pop() || undefined;
      warnings.push(`"${name}" sends a file: choose it again before sending.`);
    } else if (mode === 'graphql') {
      const gql = isObj(body.graphql) ? body.graphql : {};
      let variables: unknown = {};
      try {
        variables = typeof gql.variables === 'string' && gql.variables.trim() ? JSON.parse(gql.variables) : (gql.variables ?? {});
      } catch {
        warnings.push(`"${name}": the GraphQL variables are not valid JSON and were left out.`);
      }
      draft.body.mode = 'raw';
      draft.body.rawLanguage = 'json';
      draft.body.raw = JSON.stringify({ query: str(gql.query), variables }, null, 2);
      if (!draft.headers.some((h) => h.key.toLowerCase() === 'content-type')) draft.headers.push(kv('Content-Type', 'application/json'));
    } else if (mode) {
      warnings.push(`"${name}": the "${mode}" body type is not supported and was left out.`);
    }
  }
  if ((draft.method === 'GET' || draft.method === 'HEAD') && draft.body.mode !== 'none') {
    warnings.push(`"${name}" is a ${draft.method} request with a body; browsers cannot send that, so the body was switched to None.`);
    draft.body.mode = 'none';
  }
  if (Array.isArray(item.event) && item.event.length) {
    warnings.push(`"${name}" has pre-request or test scripts; scripts are not run here.`);
  }
  return draft;
}

function importPostman(data: Obj, newId: () => string, now: number): ImportResult {
  const info = data.info as Obj;
  const schema = str(info.schema);
  if (schema && !/collection\/v2\.[01]\.\d/.test(schema)) {
    throw new ImportError('Only Postman Collection v2.0 and v2.1 files can be imported. Re-export it from Postman as v2.1.');
  }
  const warnings: string[] = [];
  const collection: ApiCollection = {
    id: newId(),
    name: str(info.name).trim() || 'Postman collection',
    folders: [],
    variables: postmanKv(data.variable).map((v) => ({ id: rowId(), key: v.key, value: v.value, enabled: v.enabled })),
    createdAt: now,
    updatedAt: now,
  };
  const requests: SavedRequest[] = [];
  const rootAuth = postmanAuth(data.auth, warnings, 'Collection') ?? emptyAuth();
  let flattened = false;

  const walk = (items: unknown[], folderPath: string[], auth: AuthConfig) => {
    for (const raw of items) {
      if (!isObj(raw)) continue;
      if (Array.isArray(raw.item)) {
        const folderAuth = postmanAuth(raw.auth, warnings, `Folder "${str(raw.name)}"`) ?? auth;
        const path = [...folderPath, str(raw.name).trim() || 'Folder'];
        if (path.length > 1) flattened = true;
        walk(raw.item, path, folderAuth);
        continue;
      }
      const draft = postmanRequest(raw, auth, warnings);
      if (!draft) continue;
      let folderId: string | null = null;
      if (folderPath.length) {
        const name = folderPath.join(' / ');
        let folder = collection.folders.find((f) => f.name === name);
        if (!folder) {
          folder = { id: newId(), name };
          collection.folders.push(folder);
        }
        folderId = folder.id;
      }
      requests.push({ ...draft, id: newId(), collectionId: collection.id, folderId, favorite: false, createdAt: now, updatedAt: now });
    }
  };
  walk(data.item as unknown[], [], rootAuth);
  if (flattened) warnings.push('Nested folders were flattened into one level (named "Parent / Child").');
  if (!requests.length) warnings.push('The collection contains no requests.');
  return { kind: 'postman-collection', collections: [collection], requests, environments: [], warnings };
}

function importPostmanEnvironment(data: Obj, newId: () => string, now: number): ImportResult {
  const values = (data.values as unknown[]).filter(isObj);
  const env: ApiEnvironment = {
    id: newId(),
    name: str(data.name).trim() || 'Postman environment',
    variables: values.map((v) => ({
      id: rowId(),
      key: str(v.key),
      value: str(v.value),
      enabled: v.enabled !== false,
      secret: v.type === 'secret',
    })),
    createdAt: now,
    updatedAt: now,
  };
  return { kind: 'postman-environment', collections: [], requests: [], environments: [env], warnings: [] };
}
