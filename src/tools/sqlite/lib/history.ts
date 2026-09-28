export interface HistoryEntry {
  sql: string;
  at: number;
  ok: boolean;
  ms: number;
}

export const HISTORY_LIMIT = 50;

/** Add a query to the history: newest first, the same SQL is moved to the top, at most `limit` entries. */
export function addToHistory(list: HistoryEntry[], entry: HistoryEntry, limit = HISTORY_LIMIT): HistoryEntry[] {
  const sql = entry.sql.trim();
  if (!sql) return list;
  const rest = list.filter((e) => e.sql.trim() !== sql);
  return [{ ...entry, sql }, ...rest].slice(0, limit);
}

export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (e): e is HistoryEntry =>
          typeof e === 'object' && e !== null && typeof (e as HistoryEntry).sql === 'string' && typeof (e as HistoryEntry).at === 'number',
      )
      .map((e) => ({ sql: e.sql, at: e.at, ok: e.ok !== false, ms: Number(e.ms) || 0 }))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}
