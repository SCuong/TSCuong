/// <reference lib="webworker" />
/**
 * Formats SQL off the main thread: sql-formatter's parser can take a while on
 * long scripts, and the tool restarts this worker to cancel stale jobs.
 */
import { format } from 'sql-formatter';
import { formatSql, type SqlFormatError, type SqlFormatSettings } from '../lib/sqlFormat';

export interface SqlFormatRequest {
  id: number;
  text: string;
  settings: SqlFormatSettings;
}

export type SqlFormatResponse = { id: number } & ({ ok: true; value: string } | { ok: false; error: SqlFormatError });

self.onmessage = (event: MessageEvent<SqlFormatRequest>) => {
  const { id, text, settings } = event.data;
  let response: SqlFormatResponse;
  try {
    response = { id, ...formatSql(format, text, settings) };
  } catch (error) {
    response = { id, ok: false, error: { message: error instanceof Error ? error.message : 'Could not format this SQL' } };
  }
  (self as unknown as Worker).postMessage(response);
};
