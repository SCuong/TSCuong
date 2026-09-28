/// <reference lib="webworker" />
/**
 * SQLite Studio worker: owns the sql.js database so heavy queries never block
 * the UI. Every statement is re-classified here against exactly what SQLite
 * prepared, and read-only mode is additionally enforced with
 * `PRAGMA query_only`, so writes are blocked even if the UI check is bypassed.
 */
import sqlJsSource from 'sql.js/dist/sql-wasm-browser.js?raw';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { Database, InitSqlJsStatic, SqlJsStatic, Statement } from 'sql.js';
import type {
  BrowseResult,
  DbInfo,
  ExecResult,
  OpenSource,
  SchemaObject,
  StatementResult,
  TableDetails,
  WorkerRequest,
  WorkerResponse,
} from './lib/protocol';
import { buildBrowseQuery, quoteIdent, type BrowseQuery, type SqlValue } from './lib/sqlBuild';
import { classifyStatement, splitStatements, validateWhereClause } from './lib/sqlClassifier';
import { toCsv, toJson, toSqlDump } from './lib/sqlFormat';
import { buildSampleSql } from './lib/sample';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let enginePromise: Promise<SqlJsStatic> | null = null;
let db: Database | null = null;
let readOnly = true;

/**
 * sql.js ships as a UMD script. Loading it as a module from a Blob URL (with a
 * default export appended) works identically in the dev server and in the
 * production build, without any CommonJS interop.
 */
function loadEngine(): Promise<SqlJsStatic> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const blobUrl = URL.createObjectURL(
        // `var module` gives the script's sloppy-mode `module = undefined` a binding in strict module code.
        new Blob([`var module;\n${sqlJsSource}\nexport default initSqlJs;\n`], { type: 'text/javascript' }),
      );
      try {
        const mod = (await import(/* @vite-ignore */ blobUrl)) as { default: InitSqlJsStatic };
        return await mod.default({ locateFile: () => wasmUrl });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })().catch((error: unknown) => {
      enginePromise = null;
      throw new Error(
        `The SQLite engine could not be loaded (${error instanceof Error ? error.message : 'unknown error'}). WebAssembly may be disabled in this browser.`,
      );
    });
  }
  return enginePromise;
}

function requireDb(): Database {
  if (!db) throw new Error('No database is open.');
  return db;
}

function applyReadOnly() {
  requireDb().run(`PRAGMA query_only = ${readOnly ? 1 : 0}`);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/file is not a database|file is encrypted/i.test(message)) {
    return 'SQLite could not read this file. It may be encrypted (for example with SQLCipher) or corrupted.';
  }
  if (/database disk image is malformed/i.test(message)) return 'The database file is corrupted (database disk image is malformed).';
  if (/attempt to write a readonly database/i.test(message)) {
    return 'Blocked: the database is in read-only mode. Turn on Write mode to change it.';
  }
  if (/out of memory|Cannot enlarge memory|Aborted\(OOM\)/i.test(message)) {
    return 'The browser ran out of memory. The database may be too large to open here.';
  }
  return message.replace(/^Error:\s*/, '');
}

function scalar(sql: string, params: SqlValue[] = []): SqlValue {
  const stmt = requireDb().prepare(sql);
  try {
    stmt.bind(params);
    return stmt.step() ? (stmt.get()[0] ?? null) : null;
  } finally {
    stmt.free();
  }
}

function all(sql: string, params: SqlValue[] = []): { columns: string[]; rows: SqlValue[][] } {
  const stmt = requireDb().prepare(sql);
  try {
    stmt.bind(params);
    const rows: SqlValue[][] = [];
    while (stmt.step()) rows.push(stmt.get() as SqlValue[]);
    return { columns: stmt.getColumnNames(), rows };
  } finally {
    stmt.free();
  }
}

function objects(sql: string, params: SqlValue[] = []): Array<Record<string, SqlValue>> {
  const { columns, rows } = all(sql, params);
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

async function open(source: OpenSource, ro: boolean, progress: (label: string) => void): Promise<{ fileSize: number }> {
  progress('Starting the SQLite engine…');
  const SQL = await loadEngine();
  db?.close();
  db = null;
  progress(source.kind === 'sample' ? 'Building the sample database…' : 'Opening the database…');
  const next = source.kind === 'bytes' ? new SQL.Database(new Uint8Array(source.bytes)) : new SQL.Database();
  try {
    if (source.kind === 'sample') next.exec(buildSampleSql());
    // Reading the schema fails fast for encrypted or corrupt files.
    next.exec('SELECT count(*) FROM sqlite_master');
    next.run('PRAGMA foreign_keys = ON');
  } catch (error) {
    next.close();
    throw error;
  }
  db = next;
  readOnly = ro;
  applyReadOnly();
  return { fileSize: source.kind === 'bytes' ? source.bytes.byteLength : pageBytes() };
}

function pageBytes(): number {
  return Number(scalar('PRAGMA page_size')) * Number(scalar('PRAGMA page_count'));
}

function info(): DbInfo {
  const counts = { table: 0, view: 0, index: 0, trigger: 0 };
  for (const row of all("SELECT type, count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' GROUP BY type").rows) {
    const type = row[0] as keyof typeof counts;
    if (type in counts) counts[type] = Number(row[1]);
  }
  const pageSize = Number(scalar('PRAGMA page_size'));
  const pageCount = Number(scalar('PRAGMA page_count'));
  return {
    fileSize: pageSize * pageCount,
    pageSize,
    pageCount,
    freelistCount: Number(scalar('PRAGMA freelist_count')),
    encoding: String(scalar('PRAGMA encoding')),
    userVersion: Number(scalar('PRAGMA user_version')),
    applicationId: Number(scalar('PRAGMA application_id')),
    journalMode: String(scalar('PRAGMA journal_mode')),
    sqliteVersion: String(scalar('SELECT sqlite_version()')),
    counts,
  };
}

function schema(): SchemaObject[] {
  const rows = objects('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name COLLATE NOCASE');
  return rows
    .filter((r) => r.type === 'table' || r.type === 'view' || r.type === 'index' || r.type === 'trigger')
    .map((r) => {
      const type = r.type as SchemaObject['type'];
      const name = String(r.name);
      let count: number | null = null;
      if (type === 'table') {
        try {
          count = Number(scalar(`SELECT count(*) FROM ${quoteIdent(name)}`));
        } catch {
          count = null;
        }
      }
      return {
        type,
        name,
        tableName: String(r.tbl_name),
        sql: r.sql === null ? null : String(r.sql),
        rows: count,
        internal: name.startsWith('sqlite_'),
      };
    });
}

function tableDetails(name: string): TableDetails {
  const master = objects('SELECT type, sql FROM sqlite_master WHERE name = ? AND type IN (\'table\', \'view\')', [name])[0];
  if (!master) throw new Error(`There is no table or view named "${name}".`);
  const columns = objects('SELECT cid, name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)', [name]).map((c) => ({
    cid: Number(c.cid),
    name: String(c.name),
    type: String(c.type ?? ''),
    notNull: Number(c.notnull) === 1,
    defaultValue: c.dflt_value === null ? null : String(c.dflt_value),
    pk: Number(c.pk),
    hidden: Number(c.hidden),
  }));
  const foreignKeys = objects('SELECT * FROM pragma_foreign_key_list(?)', [name]).map((f) => ({
    id: Number(f.id),
    seq: Number(f.seq),
    table: String(f.table),
    from: String(f.from),
    to: f.to === null ? null : String(f.to),
    onUpdate: String(f.on_update),
    onDelete: String(f.on_delete),
  }));
  const indexes = objects('SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY seq', [name]).map((ix) => ({
    name: String(ix.name),
    unique: Number(ix.unique) === 1,
    origin: String(ix.origin),
    partial: Number(ix.partial) === 1,
    columns: objects('SELECT name FROM pragma_index_info(?) ORDER BY seqno', [String(ix.name)]).map((c) =>
      c.name === null ? '(expression)' : String(c.name),
    ),
  }));
  const triggers = objects("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name", [name]).map(
    (t) => ({ name: String(t.name), sql: t.sql === null ? null : String(t.sql) }),
  );
  return {
    name,
    type: master.type === 'view' ? 'view' : 'table',
    sql: master.sql === null ? null : String(master.sql),
    columns,
    foreignKeys,
    indexes,
    triggers,
  };
}

function browse(q: BrowseQuery): BrowseResult {
  const whereError = validateWhereClause(q.where ?? '');
  if (whereError) throw new Error(whereError);
  const t0 = performance.now();
  const built = buildBrowseQuery(q);
  const total = Number(scalar(built.countSql, built.params));
  const { columns, rows } = all(built.sql, built.params);
  return { columns, rows, total, sql: built.sql, timeMs: performance.now() - t0 };
}

function firstStatementText(sql: string): string {
  return splitStatements(sql)[0]?.text ?? sql.trim();
}

function exec(sql: string, ro: boolean, maxRows: number): ExecResult {
  const database = requireDb();
  if (ro !== readOnly) {
    readOnly = ro;
    applyReadOnly();
  }
  const results: StatementResult[] = [];
  let error: ExecResult['error'] = null;
  let wrote = false;
  const t0 = performance.now();
  const iterator = database.iterateStatements(sql);
  let index = 0;
  for (;;) {
    const remaining = iterator.getRemainingSQL();
    let stmt: Statement;
    try {
      const next = iterator.next();
      if (next.done) break;
      stmt = next.value;
    } catch (e) {
      error = { index, sql: firstStatementText(remaining ?? ''), message: friendlyError(e) };
      break;
    }
    const text = stmt.getSQL().trim();
    const cls = classifyStatement(text) ?? { kind: 'write' as const, verb: '?', destructive: false };
    if (readOnly && cls.kind === 'write') {
      stmt.free();
      error = {
        index,
        sql: text,
        message: `Blocked in read-only mode: ${cls.verb || 'this statement'} can change the database. Turn on Write mode to run it.`,
      };
      break;
    }
    const start = performance.now();
    try {
      const columns = stmt.getColumnNames();
      const rows: SqlValue[][] = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        rows.push(stmt.get() as SqlValue[]);
      }
      if (cls.kind === 'write') wrote = true;
      results.push({
        index,
        sql: text,
        verb: cls.verb,
        kind: cls.kind,
        columns,
        rows,
        truncated,
        rowsModified: cls.kind === 'write' ? database.getRowsModified() : null,
        timeMs: performance.now() - start,
      });
    } catch (e) {
      error = { index, sql: text, message: friendlyError(e) };
      break;
    } finally {
      stmt.free();
    }
    index++;
  }
  // A PRAGMA in write mode may have changed query_only; keep the flag authoritative.
  applyReadOnly();
  return { results, error, totalMs: performance.now() - t0, wrote };
}

function exportDb(): Uint8Array {
  const bytes = requireDb().export();
  // sql.js resets connection pragmas on export; restore them.
  requireDb().run('PRAGMA foreign_keys = ON');
  applyReadOnly();
  return bytes;
}

function exportTable(name: string, format: 'csv' | 'json' | 'sql'): { text: string; rows: number } {
  const master = objects("SELECT type, sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')", [name])[0];
  if (!master) throw new Error(`There is no table or view named "${name}".`);
  const { columns, rows } = all(`SELECT * FROM ${quoteIdent(name)}`);
  if (format === 'csv') return { text: toCsv(columns, rows), rows: rows.length };
  if (format === 'json') return { text: toJson(columns, rows), rows: rows.length };
  if (master.type === 'view') {
    return { text: `${String(master.sql).trim().replace(/;?$/, ';')}\n`, rows: 0 };
  }
  // Include the table's indexes and triggers so the dump restores the full definition.
  const extras = all("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL", [name]).rows.map(
    (r) => `${String(r[0]).trim().replace(/;?$/, ';')}`,
  );
  const dump = toSqlDump(name, master.sql === null ? null : String(master.sql), columns, rows);
  return { text: extras.length ? `${dump}${extras.join('\n')}\n` : dump, rows: rows.length };
}

async function handle(request: WorkerRequest, progress: (label: string) => void): Promise<unknown> {
  switch (request.type) {
    case 'open':
      return open(request.payload.source, request.payload.readOnly, progress);
    case 'setReadOnly':
      readOnly = request.payload.readOnly;
      applyReadOnly();
      return null;
    case 'info':
      return info();
    case 'schema':
      return schema();
    case 'tableDetails':
      return tableDetails(request.payload.name);
    case 'browse':
      return browse(request.payload);
    case 'exec':
      return exec(request.payload.sql, request.payload.readOnly, request.payload.maxRows);
    case 'exportDb':
      return exportDb();
    case 'exportTable':
      return exportTable(request.payload.name, request.payload.format);
  }
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const post = (message: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  try {
    const result = await handle(request, (label) => post({ id: request.id, progress: label }));
    const transfer = result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : [];
    post({ id: request.id, ok: true, result }, transfer);
  } catch (error) {
    post({ id: request.id, ok: false, error: friendlyError(error) });
  }
};

