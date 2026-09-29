import { positionAt } from '@/tools/json/lib/json';
import { dialectInfo, type LexFeatures, type SqlDialect } from './dialects';

export type SqlTokenKind = 'word' | 'op' | 'punct' | 'string' | 'identifier' | 'comment' | 'hint' | 'directive' | 'space';

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
  start: number;
}

export class SqlLexError extends Error {
  offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.offset = offset;
  }
}

export interface SqlLexOptions {
  /** Keep optimizer hints (/*+ … *\/, --+ …) and MySQL/MariaDB executable comments (/*! … *\/). Default true. */
  keepHints?: boolean;
  /** Override whether a backslash escapes quotes inside string literals. */
  backslashEscapes?: boolean;
}

function isSpaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11 || code === 0xa0 || code === 0xfeff ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x3000;
}

const UNICODE_WORD = /[\p{L}\p{M}\p{N}]/u;

function isWordChar(text: string, i: number, lex: LexFeatures): boolean {
  const code = text.charCodeAt(i);
  if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57)) return true;
  if (code === 95 /* _ */ || code === 36 /* $ */ || code === 64 /* @ */) return true;
  if (code === 35 /* # */) return !lex.hashComments;
  if (code < 128) return false;
  if (code >= 0xd800 && code <= 0xdbff) return UNICODE_WORD.test(text.slice(i, i + 2));
  if (code >= 0xdc00 && code <= 0xdfff) return true; // second half of a pair that started a word
  return !isSpaceCode(code) && UNICODE_WORD.test(text[i]);
}

const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y;

function scanQuoted(text: string, i: number, quote: string, backslash: boolean): number {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    const c = text[j];
    if (backslash && c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) {
      if (text[j + 1] === quote) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return -1;
}

function scanBlockComment(text: string, i: number, nested: boolean): number {
  const n = text.length;
  let depth = 1;
  let j = i + 2;
  while (j < n) {
    if (text[j] === '*' && text[j + 1] === '/') {
      depth--;
      j += 2;
      if (depth === 0) return j;
      continue;
    }
    if (nested && text[j] === '/' && text[j + 1] === '*') {
      depth++;
      j += 2;
      continue;
    }
    j++;
  }
  return -1;
}

const Q_CLOSERS: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };

function lineEnd(text: string, i: number): number {
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl;
}

/** Client commands that must stay on a line of their own (checked at the first non-blank character of a line). */
function matchDirective(text: string, i: number, kind: LexFeatures['directives']): { text: string; end: number } | null {
  const end = lineEnd(text, i);
  const line = text.slice(i, end).replace(/\r$/, '');
  let m: RegExpExecArray | null;
  switch (kind) {
    case 'go':
      m = /^GO(?:[ \t]+\d+)?(?=[ \t]*(?:--.*)?$)/i.exec(line);
      return m ? { text: m[0], end } : null;
    case 'slash':
      return /^\/[ \t]*$/.test(line) ? { text: '/', end } : null;
    case 'delimiter':
      return /^DELIMITER[ \t]+\S+[ \t]*$/i.test(line) ? { text: line.trimEnd(), end } : null;
    case 'psql':
      return line.startsWith('\\') ? { text: line.trimEnd(), end } : null;
    default:
      return null;
  }
}

/** Split SQL into tokens. Strings, quoted identifiers, dollar-quoted bodies and comments are kept whole. */
export function tokenizeSql(text: string, lex: LexFeatures, options: SqlLexOptions = {}): SqlToken[] {
  const keepHints = options.keepHints !== false;
  const bsSingle = options.backslashEscapes ?? lex.backslashEscapes;
  const bsDouble = lex.doubleQuoteStrings ? (options.backslashEscapes ?? lex.doubleQuoteBackslash) : lex.doubleQuoteBackslash;
  const tokens: SqlToken[] = [];
  const n = text.length;
  let i = 0;
  let lineStart = true;

  const adjacentWord = (): string | null => {
    const prev = tokens[tokens.length - 1];
    return prev && prev.kind === 'word' && prev.start + prev.text.length === i ? prev.text : null;
  };
  const push = (kind: SqlTokenKind, end: number) => {
    tokens.push({ kind, text: text.slice(i, end), start: i });
    i = end;
  };
  const unterminated = (what: string): never => {
    throw new SqlLexError(`Unterminated ${what}`, i);
  };

  while (i < n) {
    const code = text.charCodeAt(i);
    const ch = text[i];

    if (isSpaceCode(code)) {
      let j = i;
      while (j < n && isSpaceCode(text.charCodeAt(j))) {
        if (text.charCodeAt(j) === 10) lineStart = true;
        j++;
      }
      push('space', j);
      continue;
    }

    if (lineStart && lex.directives !== 'none') {
      const d = matchDirective(text, i, lex.directives);
      if (d) {
        tokens.push({ kind: 'directive', text: d.text, start: i });
        i = d.end;
        continue;
      }
    }
    lineStart = false;

    // Line comments.
    const dashComment = ch === '-' && text[i + 1] === '-' && (!lex.dashNeedsSpace || i + 2 >= n || isSpaceCode(text.charCodeAt(i + 2)));
    if (dashComment || (ch === '#' && lex.hashComments) || (ch === '/' && text[i + 1] === '/' && lex.slashComments)) {
      const hint = keepHints && dashComment && text[i + 2] === '+';
      push(hint ? 'hint' : 'comment', lineEnd(text, i));
      continue;
    }

    // Block comments (optimizer hints and executable comments are kept).
    if (ch === '/' && text[i + 1] === '*') {
      const end = scanBlockComment(text, i, lex.nestedComments);
      if (end === -1) unterminated('comment (missing */)');
      const hint = keepHints && (text[i + 2] === '+' || text[i + 2] === '!' || text.startsWith('M!', i + 2));
      push(hint ? 'hint' : 'comment', end);
      continue;
    }

    if (ch === "'" || ch === '"') {
      if (lex.tripleQuotes && text.startsWith(ch.repeat(3), i)) {
        const delim = ch.repeat(3);
        let j = i + 3;
        while (j < n && !text.startsWith(delim, j)) j += text[j] === '\\' ? 2 : 1;
        if (j >= n) unterminated('triple-quoted string');
        push('string', j + 3);
        continue;
      }
      if (ch === "'") {
        const prefix = adjacentWord();
        if (lex.qQuotes && prefix && /^n?q$/i.test(prefix)) {
          const open = text[i + 1];
          if (open && !isSpaceCode(open.charCodeAt(0)) && open !== "'") {
            const close = (Q_CLOSERS[open] ?? open) + "'";
            const end = text.indexOf(close, i + 2);
            if (end === -1) unterminated(`q'${open}…${close} string`);
            push('string', end + 2);
            continue;
          }
        }
        const backslash = bsSingle || (lex.eStrings && prefix !== null && /^e$/i.test(prefix));
        const end = scanQuoted(text, i, "'", backslash);
        if (end === -1) unterminated('string literal');
        push('string', end);
        continue;
      }
      const end = scanQuoted(text, i, '"', bsDouble);
      if (end === -1) unterminated(lex.doubleQuoteStrings ? 'string literal' : 'quoted identifier');
      push(lex.doubleQuoteStrings ? 'string' : 'identifier', end);
      continue;
    }

    if (ch === '`') {
      const end = scanQuoted(text, i, '`', false);
      if (end === -1) unterminated('quoted identifier');
      push('identifier', end);
      continue;
    }

    if (ch === '[' && lex.bracketIdentifiers) {
      let j = i + 1;
      for (;;) {
        const close = text.indexOf(']', j);
        if (close === -1) unterminated('bracketed identifier');
        if (text[close + 1] === ']') {
          j = close + 2;
          continue;
        }
        j = close + 1;
        break;
      }
      push('identifier', j);
      continue;
    }

    if (ch === '$' && lex.dollarQuotes !== 'none') {
      let delim: string | null = null;
      if (lex.dollarQuotes === 'plain') {
        if (text.startsWith('$$', i)) delim = '$$';
      } else {
        DOLLAR_TAG.lastIndex = i;
        const m = DOLLAR_TAG.exec(text);
        if (m) delim = m[0];
      }
      if (delim) {
        const close = text.indexOf(delim, i + delim.length);
        if (close === -1) unterminated(`dollar-quoted string (missing closing ${delim})`);
        push('string', close + delim.length);
        continue;
      }
    }

    if (isWordChar(text, i, lex)) {
      let j = i + 1;
      while (j < n && isWordChar(text, j, lex)) j++;
      push('word', j);
      continue;
    }

    if (ch === '(' || ch === ')' || ch === ',' || ch === ';') {
      push('punct', i + 1);
      continue;
    }
    // Any other character is a one-character operator (kept separate so "--" or "/*" can never form).
    push('op', code >= 0xd800 && code <= 0xdbff ? i + 2 : i + 1);
  }
  return tokens;
}

type SpacingClass = 'glue' | 'op' | 'safe' | 'hint';

function spacingClass(token: SqlToken): SpacingClass {
  switch (token.kind) {
    case 'punct':
      return 'safe';
    case 'hint':
      return 'hint';
    case 'op':
      // "t . c", ": name" and "? 1" must not fuse into names, named or numbered parameters.
      return token.text === '.' || token.text === ':' || token.text === '?' ? 'glue' : 'op';
    default:
      return 'glue';
  }
}

/** Whether whitespace between two tokens must be kept as a single space. */
function needsSpace(prev: SqlToken, next: SqlToken): boolean {
  const a = spacingClass(prev);
  const b = spacingClass(next);
  if (a === 'safe' || b === 'safe') return false;
  if (a === 'hint' || b === 'hint') return true;
  // "U & 'x'" must not become PostgreSQL's U&'x' Unicode string.
  if (prev.text === '&' && (next.kind === 'string' || next.kind === 'identifier')) return true;
  // Two words (or quoted tokens) would merge; two operators could form "--", "/*", "<=", "::"…
  return a === b;
}

export interface SqlMinifyOptions extends SqlLexOptions {
  dialect: SqlDialect;
}

export type SqlMinifyResult =
  | { ok: true; value: string; commentsRemoved: number; hintsKept: number }
  | { ok: false; error: { message: string; line: number; column: number } };

/**
 * Minify SQL: remove comments (except optimizer hints) and collapse whitespace
 * outside strings, quoted identifiers and dollar-quoted bodies. A space is kept
 * only where removing it would merge two tokens.
 */
export function minifySql(input: string, options: SqlMinifyOptions): SqlMinifyResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const lex = dialectInfo(options.dialect).lex;
  let tokens: SqlToken[];
  try {
    tokens = tokenizeSql(text, lex, options);
  } catch (error) {
    if (error instanceof SqlLexError) {
      const { line, column } = positionAt(text, error.offset);
      return { ok: false, error: { message: `${error.message}, starting at line ${line}, column ${column}`, line, column } };
    }
    throw error;
  }
  const out: string[] = [];
  let prev: SqlToken | null = null;
  let pending = false;
  let newline = false;
  let commentsRemoved = 0;
  let hintsKept = 0;
  for (const token of tokens) {
    if (token.kind === 'space') {
      pending = true;
      continue;
    }
    if (token.kind === 'comment') {
      commentsRemoved++;
      pending = true;
      continue;
    }
    if (token.kind === 'directive') {
      if (out.length) out.push('\n');
      out.push(token.text);
      newline = true;
      pending = false;
      prev = token;
      continue;
    }
    if (newline) out.push('\n');
    else if (prev && pending && needsSpace(prev, token)) out.push(' ');
    out.push(token.text);
    newline = false;
    if (token.kind === 'hint') {
      hintsKept++;
      // A kept line comment (--+ hint) must end its line.
      if (token.text.startsWith('--')) newline = true;
    }
    prev = token;
    pending = false;
  }
  return { ok: true, value: out.join(''), commentsRemoved, hintsKept };
}
