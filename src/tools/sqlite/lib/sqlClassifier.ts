/**
 * A small SQLite-aware tokenizer and statement classifier.
 *
 * It is used to keep SQLite Studio read-only by default: every statement is
 * classified as `read`, `write` or `transaction` while ignoring the contents of
 * string literals, quoted identifiers and comments. Classification is
 * deliberately conservative: anything it does not recognise as read-only is
 * treated as a write.
 */

export type TokenType = 'word' | 'ident' | 'string' | 'number' | 'param' | 'punct' | 'semicolon';

export interface Token {
  type: TokenType;
  /** Raw text of the token. For `word` tokens use `upper` for keyword checks. */
  value: string;
  upper: string;
  start: number;
  end: number;
}

export interface TokenizeResult {
  tokens: Token[];
  /** Set when the input ends inside a string, quoted identifier or block comment. */
  unterminated: 'string' | 'identifier' | 'comment' | null;
}

const isWordStart = (c: string) => /[\p{L}_]/u.test(c) || c.charCodeAt(0) > 0x7f;
const isWordPart = (c: string) => /[\p{L}\p{N}_$]/u.test(c) || c.charCodeAt(0) > 0x7f;
const isDigit = (c: string) => c >= '0' && c <= '9';

export function tokenize(sql: string): TokenizeResult {
  const tokens: Token[] = [];
  let unterminated: TokenizeResult['unterminated'] = null;
  let i = 0;
  const n = sql.length;
  const push = (type: TokenType, start: number, end: number) => {
    const value = sql.slice(start, end);
    tokens.push({ type, value, upper: type === 'word' ? value.toUpperCase() : value, start, end });
  };

  while (i < n) {
    const c = sql[i];
    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    // Line comment
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    // Block comment
    if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) {
        unterminated = 'comment';
        i = n;
      } else i = close + 2;
      continue;
    }
    // String literal (and X'..' blob literals, whose X is lexed as a word first)
    if (c === "'") {
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) unterminated = 'string';
      push('string', start, i);
      continue;
    }
    // Quoted identifiers: "x", `x`, [x]
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) unterminated = 'identifier';
      push('ident', start, i);
      continue;
    }
    // Numbers (including .5 and hex)
    if (isDigit(c) || (c === '.' && isDigit(sql[i + 1] ?? ''))) {
      const start = i;
      if (c === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X')) {
        i += 2;
        while (i < n && /[0-9a-fA-F_]/.test(sql[i])) i++;
      } else {
        while (i < n && /[0-9._eE]/.test(sql[i])) {
          if ((sql[i] === 'e' || sql[i] === 'E') && (sql[i + 1] === '+' || sql[i + 1] === '-')) i++;
          i++;
        }
      }
      push('number', start, i);
      continue;
    }
    // Parameters: ?, ?1, :name, @name, $name
    if (c === '?' || ((c === ':' || c === '@' || c === '$') && isWordPart(sql[i + 1] ?? ''))) {
      const start = i;
      i++;
      while (i < n && (isWordPart(sql[i]) || isDigit(sql[i]))) i++;
      push('param', start, i);
      continue;
    }
    if (isWordStart(c)) {
      const start = i;
      i++;
      while (i < n && isWordPart(sql[i])) i++;
      push('word', start, i);
      continue;
    }
    if (c === ';') {
      push('semicolon', i, i + 1);
      i++;
      continue;
    }
    // Multi-char operators are irrelevant for classification; emit single chars.
    push('punct', i, i + 1);
    i++;
  }
  return { tokens, unterminated };
}

export interface SplitStatement {
  /** Source text of the statement without the terminating semicolon. */
  text: string;
  start: number;
  end: number;
  tokens: Token[];
}

/**
 * Split a script into statements on top-level semicolons. Semicolons inside
 * `CREATE TRIGGER … BEGIN … END` bodies do not end the statement.
 */
export function splitStatements(sql: string): SplitStatement[] {
  const { tokens } = tokenize(sql);
  const out: SplitStatement[] = [];
  let current: Token[] = [];
  let inTriggerBody = false;
  let caseDepth = 0;

  const isTrigger = () => {
    // CREATE [TEMP|TEMPORARY] TRIGGER
    if (current[0]?.upper !== 'CREATE') return false;
    const second = current[1]?.upper;
    if (second === 'TRIGGER') return true;
    return (second === 'TEMP' || second === 'TEMPORARY') && current[2]?.upper === 'TRIGGER';
  };

  const flush = () => {
    if (current.length) {
      const start = current[0].start;
      const end = current[current.length - 1].end;
      out.push({ text: sql.slice(start, end), start, end, tokens: current });
    }
    current = [];
    inTriggerBody = false;
    caseDepth = 0;
  };

  for (const token of tokens) {
    if (token.type === 'semicolon' && !inTriggerBody) {
      flush();
      continue;
    }
    current.push(token);
    if (token.type !== 'word') continue;
    if (!inTriggerBody) {
      if (token.upper === 'BEGIN' && isTrigger()) inTriggerBody = true;
    } else if (token.upper === 'CASE') {
      caseDepth++;
    } else if (token.upper === 'END') {
      if (caseDepth > 0) caseDepth--;
      else inTriggerBody = false;
    }
  }
  flush();
  return out;
}

export type StatementKind = 'read' | 'write' | 'transaction';

export interface ClassifiedStatement {
  text: string;
  start: number;
  end: number;
  kind: StatementKind;
  /** Main verb, e.g. SELECT, INSERT, PRAGMA, CREATE TABLE. */
  verb: string;
  /** Statements that drop objects or change every row. Confirm before running. */
  destructive: boolean;
  /** Why a statement is destructive, for the confirmation dialog. */
  destructiveReason?: string;
}

/** PRAGMAs that take an argument in parentheses but only read. */
const READ_ARG_PRAGMAS = new Set([
  'table_info',
  'table_xinfo',
  'table_list',
  'index_info',
  'index_xinfo',
  'index_list',
  'foreign_key_list',
  'foreign_key_check',
  'integrity_check',
  'quick_check',
  'function_list',
  'module_list',
  'pragma_list',
  'collation_list',
  'database_list',
  'compile_options',
]);

/** PRAGMAs without an argument that nevertheless change the database or connection. */
const SIDE_EFFECT_PRAGMAS = new Set([
  'optimize',
  'shrink_memory',
  'incremental_vacuum',
  'wal_checkpoint',
  'reset_statistics',
]);

const WRITE_VERBS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'CREATE',
  'DROP',
  'ALTER',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'ANALYZE',
  'UPSERT',
]);

const TRANSACTION_VERBS = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE']);

/** Index of the first depth-0 token after `from` that is one of `words`, or -1. */
function findTopLevel(tokens: Token[], words: Set<string>, from = 0): number {
  let depth = 0;
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'punct') {
      if (t.value === '(') depth++;
      else if (t.value === ')') depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && t.type === 'word' && words.has(t.upper)) return i;
  }
  return -1;
}

const MAIN_VERBS = new Set(['SELECT', 'VALUES', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

function classifyDml(tokens: Token[], verbIndex: number): Pick<ClassifiedStatement, 'destructive' | 'destructiveReason'> {
  const verb = tokens[verbIndex].upper;
  if (verb !== 'DELETE' && verb !== 'UPDATE') return { destructive: false };
  const where = findTopLevel(tokens, new Set(['WHERE']), verbIndex + 1);
  if (where !== -1) return { destructive: false };
  return {
    destructive: true,
    destructiveReason:
      verb === 'DELETE' ? 'DELETE without a WHERE clause removes every row.' : 'UPDATE without a WHERE clause changes every row.',
  };
}

export function classifyTokens(tokens: Token[]): Omit<ClassifiedStatement, 'text' | 'start' | 'end'> {
  const first = tokens[0];
  if (!first || first.type !== 'word') {
    return { kind: 'write', verb: first ? first.value : '', destructive: false };
  }
  const verb = first.upper;

  if (verb === 'SELECT' || verb === 'VALUES') return { kind: 'read', verb, destructive: false };

  if (verb === 'EXPLAIN') {
    // EXPLAIN [QUERY PLAN] <stmt> only compiles the statement; it never runs it.
    return { kind: 'read', verb: 'EXPLAIN', destructive: false };
  }

  if (verb === 'WITH') {
    const idx = findTopLevel(tokens, MAIN_VERBS, 1);
    if (idx === -1) return { kind: 'write', verb: 'WITH', destructive: false };
    const main = tokens[idx].upper;
    if (main === 'SELECT' || main === 'VALUES') return { kind: 'read', verb: 'WITH … SELECT', destructive: false };
    return { kind: 'write', verb: `WITH … ${main}`, ...classifyDml(tokens, idx) };
  }

  if (verb === 'PRAGMA') {
    // PRAGMA [schema.]name [= value | (value)]
    let i = 1;
    if (tokens[i + 1]?.value === '.') i += 2;
    const nameTok = tokens[i];
    const name = nameTok ? unquoteIdentifier(nameTok.value).toLowerCase() : '';
    const next = tokens[i + 1];
    if (!next) {
      return SIDE_EFFECT_PRAGMAS.has(name)
        ? { kind: 'write', verb: 'PRAGMA', destructive: false }
        : { kind: 'read', verb: 'PRAGMA', destructive: false };
    }
    if (next.value === '(' && READ_ARG_PRAGMAS.has(name)) return { kind: 'read', verb: 'PRAGMA', destructive: false };
    return { kind: 'write', verb: 'PRAGMA', destructive: false };
  }

  if (TRANSACTION_VERBS.has(verb)) return { kind: 'transaction', verb, destructive: false };

  if (WRITE_VERBS.has(verb)) {
    if (verb === 'DROP') {
      const what = tokens[1]?.upper ?? '';
      return {
        kind: 'write',
        verb: `DROP ${what}`.trim(),
        destructive: true,
        destructiveReason: `DROP ${what.toLowerCase() || 'object'} permanently removes it and its data.`,
      };
    }
    if (verb === 'CREATE' || verb === 'ALTER') {
      let j = 1;
      while (tokens[j] && ['TEMP', 'TEMPORARY', 'UNIQUE', 'VIRTUAL'].includes(tokens[j].upper)) j++;
      const what = tokens[j]?.upper ?? '';
      const label = `${verb} ${what}`.trim();
      if (verb === 'ALTER' && findTopLevel(tokens, new Set(['DROP']), 1) !== -1) {
        return { kind: 'write', verb: label, destructive: true, destructiveReason: 'ALTER TABLE … DROP COLUMN removes a column and its data.' };
      }
      return { kind: 'write', verb: label, destructive: false };
    }
    return { kind: 'write', verb, ...classifyDml(tokens, 0) };
  }

  // Unknown statement: be conservative.
  return { kind: 'write', verb, destructive: false };
}

export function classifyStatement(sql: string): ClassifiedStatement | null {
  const [statement] = splitStatements(sql);
  if (!statement) return null;
  return { text: statement.text, start: statement.start, end: statement.end, ...classifyTokens(statement.tokens) };
}

/** Classify every statement in a script (comments and empty statements are skipped). */
export function classifyScript(sql: string): ClassifiedStatement[] {
  return splitStatements(sql).map((s) => ({ text: s.text, start: s.start, end: s.end, ...classifyTokens(s.tokens) }));
}

/** Statements that must be blocked when the database is in read-only mode. */
export function blockedInReadOnly(statements: ClassifiedStatement[]): ClassifiedStatement[] {
  return statements.filter((s) => s.kind === 'write');
}

/**
 * Best-effort position of an SQLite error inside the failing statement.
 * sql.js does not expose sqlite3_error_offset(), so the position is derived
 * from the message: `near "X"`, `unrecognized token: "X"` and `no such
 * column/table/function: X` are located when X occurs exactly once (anything
 * else would be a guess); `incomplete input` points at the end.
 */
export function errorLocation(statement: string, message: string): { start: number; length: number } | null {
  if (/\bincomplete input\b/i.test(message)) return { start: statement.length, length: 0 };
  const quoted = /(?:near|unrecognized token:)\s+"((?:[^"]|"")*)"/i.exec(message);
  const named = /no such (?:column|table|function|collation sequence|module):\s*(\S+)/i.exec(message);
  if (!quoted && !named) return null;
  const { tokens } = tokenize(statement);
  if (named) {
    // "no such column: t.name" → the last part, matched as a whole (unquoted) identifier.
    const name = named[1].split('.').pop()!.toLowerCase();
    const hits = tokens.filter((t) => (t.type === 'word' || t.type === 'ident') && unquoteIdentifier(t.value).toLowerCase() === name);
    return hits.length === 1 ? { start: hits[0].start, length: hits[0].end - hits[0].start } : null;
  }
  const needle = quoted![1].replace(/""/g, '"');
  if (!needle) return null;
  // Prefer whole tokens so that `near "x"` does not match the x in "max".
  const hits = tokens.filter((t) => t.value === needle);
  if (hits.length === 1) return { start: hits[0].start, length: hits[0].end - hits[0].start };
  if (hits.length > 1) return null;
  const first = statement.indexOf(needle);
  if (first === -1 || statement.indexOf(needle, first + 1) !== -1) return null;
  return { start: first, length: needle.length };
}

/** 1-based line and column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

export function unquoteIdentifier(raw: string): string {
  if (raw.length >= 2) {
    const a = raw[0];
    const b = raw[raw.length - 1];
    if ((a === '"' && b === '"') || (a === '`' && b === '`')) return raw.slice(1, -1).split(a + a).join(a);
    if (a === '[' && b === ']') return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Validate a user-written WHERE expression for the data browser: it must be a
 * single expression without statement separators and without unterminated
 * quotes/comments. Returns an error sentence or null.
 */
export function validateWhereClause(clause: string): string | null {
  if (!clause.trim()) return null;
  const { tokens, unterminated } = tokenize(clause);
  if (unterminated) return `The filter has an unterminated ${unterminated}.`;
  if (tokens.some((t) => t.type === 'semicolon')) return 'The filter must be a single expression (no semicolons).';
  let depth = 0;
  for (const t of tokens) {
    if (t.value === '(' && t.type === 'punct') depth++;
    if (t.value === ')' && t.type === 'punct') depth--;
    if (depth < 0) return 'The filter has an unmatched closing parenthesis.';
  }
  if (depth !== 0) return 'The filter has an unclosed parenthesis.';
  const clauseWords = new Set(['ORDER', 'LIMIT', 'GROUP', 'HAVING', 'WINDOW', 'UNION', 'EXCEPT', 'INTERSECT', 'OFFSET']);
  const banned = findTopLevel(tokens, clauseWords);
  if (banned !== -1) {
    return `Only a WHERE expression is allowed here; use the SQL editor for ${tokens[banned].upper} clauses.`;
  }
  return null;
}
