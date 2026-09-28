/** Typed request/response protocol between SQLite Studio and its worker. */
import type { BrowseQuery, SqlValue } from './sqlBuild';
import type { StatementKind } from './sqlClassifier';

export type { SqlValue };

export interface DbInfo {
  fileSize: number;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  encoding: string;
  userVersion: number;
  applicationId: number;
  journalMode: string;
  sqliteVersion: string;
  counts: { table: number; view: number; index: number; trigger: number };
}

export type SchemaType = 'table' | 'view' | 'index' | 'trigger';

export interface SchemaObject {
  type: SchemaType;
  name: string;
  tableName: string;
  sql: string | null;
  /** Row count for tables and views (null when counting failed, e.g. a broken view). */
  rows: number | null;
  internal: boolean;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  pk: number;
  hidden: number;
}

export interface ForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  onUpdate: string;
  onDelete: string;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface TableDetails {
  name: string;
  type: 'table' | 'view';
  sql: string | null;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  triggers: Array<{ name: string; sql: string | null }>;
}

export interface BrowseResult {
  columns: string[];
  rows: SqlValue[][];
  total: number;
  sql: string;
  timeMs: number;
}

export interface StatementResult {
  index: number;
  sql: string;
  verb: string;
  kind: StatementKind;
  columns: string[];
  rows: SqlValue[][];
  /** True when more rows existed than were returned. */
  truncated: boolean;
  rowsModified: number | null;
  timeMs: number;
}

export interface ExecResult {
  results: StatementResult[];
  error: { index: number; sql: string; message: string } | null;
  totalMs: number;
  /** A statement that may have changed the database ran successfully. */
  wrote: boolean;
}

export type OpenSource = { kind: 'bytes'; bytes: ArrayBuffer } | { kind: 'empty' } | { kind: 'sample' };

export interface RequestMap {
  open: { req: { source: OpenSource; readOnly: boolean }; res: { fileSize: number } };
  setReadOnly: { req: { readOnly: boolean }; res: null };
  info: { req: null; res: DbInfo };
  schema: { req: null; res: SchemaObject[] };
  tableDetails: { req: { name: string }; res: TableDetails };
  browse: { req: BrowseQuery; res: BrowseResult };
  exec: { req: { sql: string; readOnly: boolean; maxRows: number }; res: ExecResult };
  exportDb: { req: null; res: Uint8Array };
  exportTable: { req: { name: string; format: 'csv' | 'json' | 'sql' }; res: { text: string; rows: number } };
}

export type RequestType = keyof RequestMap;

export type WorkerRequest = {
  [K in RequestType]: { id: number; type: K; payload: RequestMap[K]['req'] };
}[RequestType];

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: string };
