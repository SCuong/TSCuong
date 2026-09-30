import { emptyAuth, isSensitiveHeader, isSensitiveName, isVariableOnly, type HistoryEntry, type KeyValue, type RequestDraft } from './model';
import { splitUrl } from './url';

/** Query parameter names that conventionally carry credentials (api_key, access_token, sig, X-Amz-Signature …). */
export function isSensitiveParam(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // keep the raw name
  }
  return isSensitiveName(decoded);
}

/** A literal value that must not be kept (variable references like {{token}} are fine). */
const isSecretValue = (name: string, value: string) => value !== '' && isSensitiveParam(name) && !isVariableOnly(value);

function redactRows<T extends KeyValue>(rows: T[]): T[] {
  return rows.map((r) => (isSecretValue(r.key, r.value) ? { ...r, value: '' } : { ...r }));
}

/** Rewrite a URL's query with credential values blanked; `key=` stays visible so it is clear a value was removed. */
function redactUrl(url: string): string {
  const { base, query, hash } = splitUrl(url);
  if (!query) return url;
  const parts = query.split('&').map((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return part;
    const key = part.slice(0, eq);
    return isSecretValue(key, part.slice(eq + 1)) ? `${key}=` : part;
  });
  return `${base}?${parts.join('&')}${hash}`;
}

/**
 * Blank the values of credential-named fields in a JSON body, keeping its
 * exact text otherwise (formatting, numbers, other values). Nested objects and
 * arrays are walked; their own keys decide. Returns null when the text is not JSON.
 */
export function redactJsonText(text: string): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = '';
  let redactNext = false;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      j++;
      const token = text.slice(i, j);
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      const value = JSON.parse(token) as string;
      if (text[k] === ':') {
        redactNext = isSensitiveName(value);
        out += token;
      } else {
        out += redactNext && value !== '' && !isVariableOnly(value) ? '""' : token;
        redactNext = false;
      }
      i = j;
      continue;
    }
    if (redactNext && (ch === '-' || (ch >= '0' && ch <= '9') || ch === 't' || ch === 'f')) {
      let j = i;
      while (j < text.length && !/[\s,}\]]/.test(text[j])) j++;
      out += '""';
      redactNext = false;
      i = j;
      continue;
    }
    if (redactNext && (ch === '{' || ch === '[' || ch === 'n')) redactNext = false;
    out += ch;
    i++;
  }
  return out;
}

/** Raw bodies: JSON field values and `a=b&c=d` form values with credential names are blanked. */
function redactRawBody(raw: string): string {
  const json = redactJsonText(raw);
  if (json !== null) return json;
  if (/^[^\s=&]+=[^\s&]*(?:&[^\s=&]+=[^\s&]*)*$/.test(raw.trim())) return redactUrl(`?${raw.trim()}`).slice(1);
  return raw;
}

export const HISTORY_LIMIT = 200;

/**
 * History copy of a request. It NEVER keeps:
 * - the auth configuration (reset to "none"),
 * - credential headers (Authorization, Cookie, X-API-Key, Private-Token, X-Goog-Api-Key, …), removed entirely,
 * - file contents (only file names are remembered),
 * - literal values of credential-named query parameters and body fields (api_key, access_token,
 *   password, client_secret, …) in the URL, form/URL-encoded tables and JSON bodies.
 * Variable references such as {{token}} hold no secret and are kept.
 */
export function sanitizeForHistory(draft: RequestDraft): RequestDraft {
  return {
    name: draft.name,
    method: draft.method,
    url: redactUrl(draft.url),
    params: redactRows(draft.params),
    headers: draft.headers.filter((h) => !isSensitiveHeader(h.key)).map((h) => ({ ...h })),
    body: {
      mode: draft.body.mode,
      raw: draft.body.raw ? redactRawBody(draft.body.raw) : draft.body.raw,
      rawLanguage: draft.body.rawLanguage,
      urlencoded: redactRows(draft.body.urlencoded),
      form: draft.body.form.map((f) => ({
        id: f.id,
        key: f.key,
        value: f.kind === 'file' || isSecretValue(f.key, f.value) ? '' : f.value,
        enabled: f.enabled,
        kind: f.kind,
        file: null,
        fileName: f.kind === 'file' ? f.fileName : undefined,
      })),
      binary: null,
      binaryName: draft.body.binaryName,
    },
    auth: emptyAuth(),
    timeoutMs: draft.timeoutMs,
  };
}

/** Ids of the entries that fall outside the newest `limit` entries. */
export function historyOverflow(entries: Pick<HistoryEntry, 'id' | 'at'>[], limit = HISTORY_LIMIT): string[] {
  if (entries.length <= limit) return [];
  return [...entries]
    .sort((a, b) => b.at - a.at)
    .slice(limit)
    .map((e) => e.id);
}

export interface HistoryGroup {
  label: string;
  entries: HistoryEntry[];
}

/** Group entries (newest first) into Today / Yesterday / dated buckets. */
export function groupHistory(entries: HistoryEntry[], now = Date.now()): HistoryGroup[] {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const day = startOfDay(e.at);
    const label =
      day === today
        ? 'Today'
        : day === yesterday
          ? 'Yesterday'
          : new Date(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const list = groups.get(label);
    if (list) list.push(e);
    else groups.set(label, [e]);
  }
  return [...groups].map(([label, list]) => ({ label, entries: list }));
}

/** Build a history record; the stored URL and request are always the sanitized versions. */
export function makeHistoryEntry(
  draft: RequestDraft,
  outcome: { status: number | null; timeMs: number | null; size: number | null; error?: string },
  via: HistoryEntry['via'],
  id: string,
  at = Date.now(),
): HistoryEntry {
  const request = sanitizeForHistory(draft);
  return {
    id,
    at,
    method: draft.method,
    url: request.url,
    status: outcome.status,
    timeMs: outcome.timeMs,
    size: outcome.size,
    ...(outcome.error ? { error: outcome.error } : {}),
    via,
    request,
  };
}
