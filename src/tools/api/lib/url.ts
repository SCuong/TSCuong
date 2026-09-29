import { kv, rowId, type KeyValue } from './model';

/**
 * Two-way sync between the URL bar and the query parameter table.
 *
 * The URL text is kept exactly as typed (including `{{variables}}` and existing
 * percent-encoding); parameters are shown raw, so editing either side never
 * re-encodes the other. Disabled table rows are not part of the URL and survive
 * URL edits.
 */

export interface SplitUrl {
  /** Everything before `?` (or before `#` when there is no query). */
  base: string;
  /** Query string without the leading `?`; null when the URL has no `?`. */
  query: string | null;
  /** Fragment including the leading `#`, or ''. */
  hash: string;
}

export function splitUrl(url: string): SplitUrl {
  // A '#' inside {{var}} braces is unusual; treat the first '#' after the query start as the fragment.
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const q = beforeHash.indexOf('?');
  if (q === -1) return { base: beforeHash, query: null, hash };
  return { base: beforeHash.slice(0, q), query: beforeHash.slice(q + 1), hash };
}

export interface QueryPair {
  key: string;
  value: string;
}

/** Split a raw query string into pairs without decoding. Empty segments (`a=1&&b=2`) are skipped. */
export function parseQuery(query: string | null): QueryPair[] {
  if (!query) return [];
  return query
    .split('&')
    .filter((part) => part !== '')
    .map((part) => {
      const eq = part.indexOf('=');
      return eq === -1 ? { key: part, value: '' } : { key: part.slice(0, eq), value: part.slice(eq + 1) };
    });
}

/** Join pairs into a raw query string. A pair with an empty value is written as a bare `key` (flag style). */
export function stringifyQuery(pairs: QueryPair[]): string {
  return pairs.map((p) => (p.value === '' && p.key !== '' ? p.key : `${p.key}=${p.value}`)).join('&');
}

/**
 * Called when the URL text changes: rebuild the enabled rows from the URL's query,
 * reusing row ids by position so React keeps focus, and keep disabled rows.
 */
export function paramsFromUrl(url: string, previous: KeyValue[]): KeyValue[] {
  const pairs = parseQuery(splitUrl(url).query);
  const enabledPrev = previous.filter((p) => p.enabled);
  const disabled = previous.filter((p) => !p.enabled);
  const next = pairs.map((pair, i) => ({ id: enabledPrev[i]?.id ?? rowId(), key: pair.key, value: pair.value, enabled: true }));
  return [...next, ...disabled];
}

/** Called when the param table changes: rewrite the URL's query from the enabled rows. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const pairs = params.filter((p) => p.enabled && (p.key !== '' || p.value !== ''));
  if (pairs.length === 0) return base + hash;
  return `${base}?${stringifyQuery(pairs)}${hash}`;
}

/** Convenience for imports: split a full URL into the URL and the matching params table. */
export function withParamsFromUrl(url: string): { url: string; params: KeyValue[] } {
  return { url, params: parseQuery(splitUrl(url).query).map((p) => kv(p.key, p.value)) };
}

const LOCAL_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|[^/:]+\.localhost|[^/:]+\.test)(:\d+)?(\/|$|\?|#)/i;
const IP_RE = /^(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/|$|\?|#)/;

/**
 * Add a scheme when the user typed a bare host, as API clients do: http:// for
 * local and IP addresses, https:// for everything else.
 */
export function ensureScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (LOCAL_HOST_RE.test(trimmed) || IP_RE.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

/** Append a percent-encoded query parameter to a concrete (already resolved) URL. */
export function appendQueryParam(url: string, key: string, value: string): string {
  const { base, query, hash } = splitUrl(url);
  const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return `${base}?${query ? `${query}&` : ''}${encoded}${hash}`;
}
