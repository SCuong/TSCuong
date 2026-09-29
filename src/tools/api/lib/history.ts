import { emptyAuth, isSensitiveHeader, isVariableOnly, type HistoryEntry, type KeyValue, type RequestDraft } from './model';
import { urlWithParams } from './url';

/** Query parameter names that conventionally carry credentials; their values are blanked in history. */
const SENSITIVE_PARAMS = new Set([
  'api_key',
  'apikey',
  'api-key',
  'access_token',
  'id_token',
  'refresh_token',
  'token',
  'auth',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'signature',
  'sig',
]);

export function isSensitiveParam(name: string): boolean {
  return SENSITIVE_PARAMS.has(name.trim().toLowerCase());
}

function redactParams(params: KeyValue[]): { params: KeyValue[]; changed: boolean } {
  let changed = false;
  const out = params.map((p) => {
    if (isSensitiveParam(p.key) && p.value && !isVariableOnly(p.value)) {
      changed = true;
      return { ...p, value: '' };
    }
    return { ...p };
  });
  return { params: out, changed };
}

export const HISTORY_LIMIT = 200;

/**
 * History copy of a request. It NEVER keeps:
 * - the auth configuration (reset to "none"),
 * - sensitive headers (Authorization, Cookie, X-API-Key, Proxy-Authorization, …), removed entirely,
 * - file contents (only file names are remembered),
 * - literal values of credential-like query parameters (api_key, access_token, …).
 */
export function sanitizeForHistory(draft: RequestDraft): RequestDraft {
  const { params, changed } = redactParams(draft.params);
  return {
    name: draft.name,
    method: draft.method,
    url: changed ? urlWithParams(draft.url, params) : draft.url,
    params,
    headers: draft.headers.filter((h) => !isSensitiveHeader(h.key)).map((h) => ({ ...h })),
    body: {
      mode: draft.body.mode,
      raw: draft.body.raw,
      rawLanguage: draft.body.rawLanguage,
      urlencoded: draft.body.urlencoded.map((p) => ({ ...p })),
      form: draft.body.form.map((f) => ({
        id: f.id,
        key: f.key,
        value: f.kind === 'file' ? '' : f.value,
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
