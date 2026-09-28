import { safeDecode } from './url';

export interface QueryPair {
  key: string;
  value: string;
  /** False for bare keys such as `?debug`. */
  hasEquals: boolean;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Container = JsonValue[] | { [key: string]: JsonValue };

/**
 * Extracts the query part from a full URL, a `?query`, or a bare query string.
 * A fragment (`#...`) is removed.
 */
export function extractQuery(input: string): string {
  let text = input.trim();
  const hash = text.indexOf('#');
  if (hash !== -1) text = text.slice(0, hash);
  const q = text.indexOf('?');
  if (q !== -1) return text.slice(q + 1);
  // A full URL without a query has nothing to parse.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return '';
  return text;
}

/** Splits a query string into decoded pairs. `plusAsSpace` follows application/x-www-form-urlencoded. */
export function parsePairs(input: string, plusAsSpace = true): QueryPair[] {
  const query = extractQuery(input);
  if (!query) return [];
  const out: QueryPair[] = [];
  for (const piece of query.split(/[&\n]/)) {
    const part = piece.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    out.push({ key: safeDecode(rawKey, plusAsSpace), value: safeDecode(rawValue, plusAsSpace), hasEquals: eq !== -1 });
  }
  return out;
}

/**
 * Splits a key written in bracket notation: `a[b][]` → ['a', 'b', ''].
 * Text after an unbalanced bracket is kept literally in the last segment.
 */
export function splitKey(key: string): string[] {
  const open = key.indexOf('[');
  if (open <= 0) return [key];
  const segments = [key.slice(0, open)];
  let rest = key.slice(open);
  while (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close === -1) break;
    segments.push(rest.slice(1, close));
    rest = rest.slice(close + 1);
  }
  if (rest) segments[segments.length - 1] += rest;
  return segments;
}

export type DuplicateMode = 'array' | 'first' | 'last';

export interface ToObjectOptions {
  /** Interpret `a[b]=1` and `a[]=1` as nested objects and arrays. */
  nested: boolean;
  duplicates: DuplicateMode;
}

export interface ToObjectResult {
  value: { [key: string]: JsonValue };
  warnings: string[];
}

/** Highest numeric index turned into an array slot; larger indices become object keys (as in `qs`). */
export const MAX_ARRAY_INDEX = 1000;

function isContainer(v: JsonValue | undefined): v is Container {
  return typeof v === 'object' && v !== null;
}

function setOwn(obj: { [key: string]: JsonValue }, key: string, value: JsonValue) {
  // defineProperty is safe for keys such as "__proto__".
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function getOwn(obj: Container, key: string): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, JsonValue>)[key] : undefined;
}

function toObject(arr: JsonValue[]): { [key: string]: JsonValue } {
  const obj: { [key: string]: JsonValue } = {};
  arr.forEach((v, i) => v !== undefined && setOwn(obj, String(i), v));
  return obj;
}

function combine(existing: JsonValue | undefined, value: string, mode: DuplicateMode, dups: WeakSet<JsonValue[]>): JsonValue {
  if (existing === undefined) return value;
  if (mode === 'first') return existing;
  if (mode === 'last') return value;
  const list = Array.isArray(existing) && dups.has(existing) ? [...existing, value] : [existing, value];
  dups.add(list);
  return list;
}

/** Removes holes left by sparse indices such as `a[5]=x`, recursively. */
function compact(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(compact);
  if (isContainer(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) setOwn(out, k, compact(v));
    return out;
  }
  return value;
}

/** Converts pairs to a JSON object, optionally expanding bracket notation. */
export function pairsToObject(pairs: QueryPair[], options: ToObjectOptions): ToObjectResult {
  const root: { [key: string]: JsonValue } = {};
  const warnings = new Set<string>();
  // Arrays created by repeated keys (a=1&a=2) hold values; they are not bracket structures.
  const dups = new WeakSet<JsonValue[]>();
  const isStructure = (v: JsonValue | undefined): v is Container => isContainer(v) && !(Array.isArray(v) && dups.has(v));

  for (const { key, value } of pairs) {
    const path = options.nested ? splitKey(key) : [key];
    if (path.length === 1) {
      const existing = getOwn(root, key);
      if (isStructure(existing)) {
        warnings.add(`“${key}” is used both as a plain value and as a nested key; the plain value was ignored.`);
        continue;
      }
      setOwn(root, key, combine(existing, value, options.duplicates, dups));
      continue;
    }

    let parent: Container = root;
    let conflict = false;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      const next = path[i + 1];
      const wantArray = next === '' || (/^\d+$/.test(next) && Number(next) <= MAX_ARRAY_INDEX);
      let child: JsonValue | undefined;
      if (Array.isArray(parent)) {
        if (seg === '') {
          child = wantArray ? [] : {};
          parent.push(child);
          parent = child;
          continue;
        }
        child = /^\d+$/.test(seg) ? parent[Number(seg)] : undefined;
      } else {
        child = getOwn(parent, seg);
      }
      if (child === undefined) {
        child = wantArray ? [] : {};
      } else if (!isStructure(child)) {
        warnings.add(`“${path.slice(0, i + 1).join('.')}” is used both as a plain value and as a nested key; the plain value was replaced.`);
        child = wantArray ? [] : {};
      } else if (Array.isArray(child) && !wantArray) {
        child = toObject(child);
      }
      if (Array.isArray(parent)) {
        if (/^\d+$/.test(seg) && Number(seg) <= MAX_ARRAY_INDEX) parent[Number(seg)] = child;
        else {
          conflict = true;
          break;
        }
      } else {
        setOwn(parent, seg, child);
      }
      parent = child;
    }
    if (conflict) {
      warnings.add(`“${key}” mixes array and object notation and was skipped.`);
      continue;
    }

    const last = path[path.length - 1];
    if (Array.isArray(parent)) {
      if (last === '') parent.push(value);
      else {
        const idx = Number(last);
        const current = parent[idx];
        if (isStructure(current)) {
          warnings.add(`“${key}” is used both as a plain value and as a nested key; the plain value was ignored.`);
          continue;
        }
        parent[idx] = combine(current, value, options.duplicates, dups);
      }
    } else {
      const existing = getOwn(parent, last);
      if (isStructure(existing)) {
        warnings.add(`“${key}” is used both as a plain value and as a nested key; the plain value was ignored.`);
        continue;
      }
      setOwn(parent, last, combine(existing, value, options.duplicates, dups));
    }
  }

  return { value: compact(root) as { [key: string]: JsonValue }, warnings: [...warnings] };
}

export type Encoding = 'rfc3986' | 'form';
export type ArrayFormat = 'brackets' | 'indices' | 'repeat' | 'comma';

export interface StringifyOptions {
  encoding: Encoding;
  arrayFormat: ArrayFormat;
  sortKeys: boolean;
  /** Keep `[` and `]` readable in keys instead of %5B / %5D. */
  readableBrackets: boolean;
}

const pct = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/** Percent-encodes a query component. RFC 3986 keeps only unreserved characters; form encoding matches URLSearchParams. */
export function encodeComponent(value: string, encoding: Encoding): string {
  const encoded = encodeURIComponent(value);
  if (encoding === 'form') return encoded.replace(/[!'()~]/g, pct).replace(/%20/g, '+');
  return encoded.replace(/[!'()*]/g, pct);
}

function encodeKey(key: string, o: StringifyOptions): string {
  const encoded = encodeComponent(key, o.encoding);
  return o.readableBrackets ? encoded.replace(/%5B/g, '[').replace(/%5D/g, ']') : encoded;
}

function scalar(v: JsonValue): string {
  return v === null ? '' : String(v);
}

/** Flattens a JSON value into [key, value] pairs using bracket notation. */
export function flatten(value: JsonValue, options: Pick<StringifyOptions, 'arrayFormat' | 'sortKeys'>, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (Array.isArray(value)) {
    if (options.arrayFormat === 'comma' && prefix && value.every((v) => !isContainer(v))) {
      if (value.length) out.push([prefix, value.map(scalar).join(',')]);
      return out;
    }
    value.forEach((item, i) => {
      let key: string;
      if (isContainer(item) || options.arrayFormat === 'indices') key = `${prefix}[${i}]`;
      else if (options.arrayFormat === 'repeat' || options.arrayFormat === 'comma') key = prefix;
      else key = `${prefix}[]`;
      out.push(...flatten(item, options, key));
    });
    return out;
  }
  if (isContainer(value)) {
    const keys = Object.keys(value);
    if (options.sortKeys) keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) out.push(...flatten(value[k], options, prefix ? `${prefix}[${k}]` : k));
    return out;
  }
  if (!prefix) return out;
  out.push([prefix, scalar(value)]);
  return out;
}

export type StringifyResult = { ok: true; value: string; count: number } | { ok: false; error: string };

/** Converts JSON text to a query string. The top level must be an object (or an array of [key, value] pairs). */
export function jsonToQuery(json: string, options: StringifyOptions): StringifyResult | null {
  if (!json.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : '';
    return { ok: false, error: `The JSON is not valid${msg ? `: ${msg}` : '.'}` };
  }
  let pairs: Array<[string, string]>;
  if (Array.isArray(data) && data.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string')) {
    pairs = (data as Array<[string, JsonValue]>).map(([k, v]) => [k, isContainer(v) ? JSON.stringify(v) : scalar(v)]);
    if (options.sortKeys) pairs = stableSortPairs(pairs);
  } else if (isContainer(data as JsonValue) && !Array.isArray(data)) {
    pairs = flatten(data as JsonValue, options);
  } else {
    return { ok: false, error: 'The top level must be a JSON object such as {"page": 2}, or a list of [key, value] pairs.' };
  }
  return { ok: true, value: pairsToQueryString(pairs, options), count: pairs.length };
}

function stableSortPairs(pairs: Array<[string, string]>): Array<[string, string]> {
  return pairs
    .map((p, i) => [p, i] as const)
    .sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1] - b[1]))
    .map(([p]) => p);
}

export function pairsToQueryString(pairs: Array<[string, string]>, options: StringifyOptions): string {
  return pairs.map(([k, v]) => `${encodeKey(k, options)}=${encodeComponent(v, options.encoding)}`).join('&');
}

/** Re-serializes parsed pairs (normalizing encoding, optionally sorting by key, stable for duplicates). */
export function normalizeQuery(pairs: QueryPair[], options: StringifyOptions): string {
  const list = options.sortKeys
    ? pairs
        .map((p, i) => [p, i] as const)
        .sort((a, b) => (a[0].key < b[0].key ? -1 : a[0].key > b[0].key ? 1 : a[1] - b[1]))
        .map(([p]) => p)
    : pairs;
  return list
    .map((p) =>
      !p.hasEquals && p.value === '' ? encodeKey(p.key, options) : `${encodeKey(p.key, options)}=${encodeComponent(p.value, options.encoding)}`,
    )
    .join('&');
}
