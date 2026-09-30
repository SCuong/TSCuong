export interface CssMinifyOptions {
  restructure: boolean;
  /** Keep /*! license *\/ comments. */
  keepLicense: boolean;
}

export interface CssIssue {
  message: string;
  line: number;
  column: number;
}

export interface CssMinifyResult {
  css: string;
  /** Parts the parser could not read: syntax errors, or syntax newer than CSSO (the output may drop them). */
  issues: CssIssue[];
  /**
   * `csso` optimizes the stylesheet. `compact` is used for CSS nesting, which CSSO cannot parse (it would
   * silently drop nested rules): comments and unneeded whitespace are removed and every rule is kept.
   */
  engine: 'csso' | 'compact';
}

/** css-tree's tokenizer (exposed by CSSO as `syntax.tokenize`, missing from its typings). */
export type Tokenize = (source: string, onToken: (type: number, start: number, end: number) => void) => void;

/** css-tree token types (CSS Syntax Level 3). */
export const TokenType = {
  Ident: 1,
  Function: 2,
  AtKeyword: 3,
  Hash: 4,
  String: 5,
  BadString: 6,
  Url: 7,
  BadUrl: 8,
  Delim: 9,
  Number: 10,
  Percentage: 11,
  Dimension: 12,
  WhiteSpace: 13,
  CDO: 14,
  CDC: 15,
  Colon: 16,
  Semicolon: 17,
  Comma: 18,
  LeftSquareBracket: 19,
  RightSquareBracket: 20,
  LeftParenthesis: 21,
  RightParenthesis: 22,
  LeftCurlyBracket: 23,
  RightCurlyBracket: 24,
  Comment: 25,
} as const;

export interface CssToken {
  type: number;
  text: string;
}

export function tokenizeCss(source: string, tokenize: Tokenize): CssToken[] {
  const list: CssToken[] = [];
  tokenize(source, (type, start, end) => list.push({ type, text: source.slice(start, end) }));
  return list;
}

type Block = 'rule' | 'at' | 'value';

/** Classifies the block a `{` opens, from the significant tokens before it. */
function blockKind(prelude: CssToken[], parent: Block | undefined): Block {
  if (parent === 'value') return 'value';
  const first = prelude[0];
  if (first?.type === TokenType.AtKeyword) return 'at';
  // `--custom: { … }` is a custom property value, not a nested rule.
  if (first?.type === TokenType.Ident && first.text.startsWith('--') && prelude[1]?.type === TokenType.Colon) return 'value';
  return 'rule';
}

/** Whether the stylesheet nests rules inside style rules (CSS Nesting, Sass-like `&:hover { … }`). */
export function usesNesting(tokens: CssToken[]): boolean {
  const stack: Block[] = [];
  let prelude: CssToken[] = [];
  for (const t of tokens) {
    if (t.type === TokenType.WhiteSpace || t.type === TokenType.Comment) continue;
    if (t.type === TokenType.LeftCurlyBracket) {
      const parent = stack[stack.length - 1];
      const kind = blockKind(prelude, parent);
      if (parent === 'rule' && kind !== 'value') return true;
      stack.push(kind);
      prelude = [];
    } else if (t.type === TokenType.RightCurlyBracket) {
      stack.pop();
      prelude = [];
    } else if (t.type === TokenType.Semicolon && stack[stack.length - 1] !== 'value') {
      prelude = [];
    } else {
      prelude.push(t);
    }
  }
  return false;
}

const { Comma, Colon, Semicolon, LeftParenthesis, RightParenthesis, LeftSquareBracket, RightSquareBracket, LeftCurlyBracket, RightCurlyBracket } = TokenType;
/** Whitespace after these tokens never matters. */
const NO_SPACE_AFTER = new Set<number>([LeftCurlyBracket, RightCurlyBracket, Semicolon, Comma, Colon, LeftParenthesis, TokenType.Function, LeftSquareBracket]);
/** Whitespace before these tokens never matters. */
const NO_SPACE_BEFORE = new Set<number>([LeftCurlyBracket, RightCurlyBracket, Semicolon, Comma, RightParenthesis, RightSquareBracket]);
/** Delimiters whose surrounding whitespace never matters (selector combinators, `!important`). */
const TIGHT_DELIMS = new Set(['>', '~', '!']);

const isSpace = (t: CssToken | undefined) => t?.type === TokenType.WhiteSpace;
const isComment = (t: CssToken | undefined) => t?.type === TokenType.Comment;

/**
 * Removes comments and unneeded whitespace without changing any rule: a conservative minifier that works for
 * every syntax the tokenizer understands, including CSS nesting. `/*!` comments are kept when asked.
 */
export function compactCss(tokens: CssToken[], keepLicense: boolean, tokenize: Tokenize): string {
  // 1. Drop comments. When a comment is the only thing between two tokens that would merge if written
  //    together (e.g. `1px/**/2px`), keep an empty comment so the tokens stay separate.
  const kept: CssToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isComment(t)) {
      kept.push(t);
      continue;
    }
    if (keepLicense && t.text.startsWith('/*!')) {
      kept.push(t);
      continue;
    }
    const prev = kept[kept.length - 1];
    let j = i + 1;
    while (isComment(tokens[j]) && !(keepLicense && tokens[j].text.startsWith('/*!'))) j++;
    const next = tokens[j];
    if (prev && next && !isSpace(prev) && !isSpace(next) && !isComment(prev) && !isComment(next)) {
      const joined = tokenizeCss(prev.text + next.text, tokenize);
      if (joined.length !== 2 || joined[0].text !== prev.text || joined[1].text !== next.text) kept.push({ type: TokenType.Comment, text: '/**/' });
    }
    i = j - 1;
  }

  // 2. Collapse whitespace, dropping it where it is never significant, and drop `;` before `}`.
  const out: string[] = [];
  const stack: Block[] = [];
  let prelude: CssToken[] = [];
  // The nearest token that is neither whitespace nor a comment (comments never separate tokens).
  const significant = (from: number, step: 1 | -1) => {
    let k = from;
    while (k >= 0 && k < kept.length && (isSpace(kept[k]) || isComment(kept[k]))) k += step;
    return kept[k];
  };
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i];
    if (isSpace(t)) {
      const prev = significant(i - 1, -1);
      const next = significant(i + 1, 1);
      if (!prev || !next) continue;
      if (NO_SPACE_AFTER.has(prev.type) || NO_SPACE_BEFORE.has(next.type)) continue;
      if ((prev.type === TokenType.Delim && TIGHT_DELIMS.has(prev.text)) || (next.type === TokenType.Delim && TIGHT_DELIMS.has(next.text))) continue;
      out.push(' ');
      // Skip the rest of a whitespace run (the tokenizer already merges runs, but comments may have split them).
      while (isSpace(kept[i + 1])) i++;
      continue;
    }
    if (t.type === Semicolon && stack[stack.length - 1] !== 'value' && significant(i + 1, 1)?.type === RightCurlyBracket) {
      prelude = [];
      continue;
    }
    if (t.type === LeftCurlyBracket) {
      stack.push(blockKind(prelude, stack[stack.length - 1]));
      prelude = [];
    } else if (t.type === RightCurlyBracket) {
      stack.pop();
      prelude = [];
    } else if (t.type === Semicolon) {
      if (stack[stack.length - 1] !== 'value') prelude = [];
    } else if (!isComment(t)) {
      prelude.push(t);
    }
    out.push(t.text);
  }
  return out.join('');
}

/** Minifies CSS with CSSO (loaded on demand) and reports recoverable syntax errors with positions. */
export async function minifyCss(source: string, options: CssMinifyOptions): Promise<CssMinifyResult> {
  const csso = await import('csso');
  const tokenize = (csso.syntax as unknown as { tokenize: Tokenize }).tokenize;
  const tokens = tokenizeCss(source, tokenize);
  if (usesNesting(tokens)) {
    return { css: compactCss(tokens, options.keepLicense, tokenize), issues: unclosedBlocks(source), engine: 'compact' };
  }
  const issues: CssIssue[] = [];
  csso.syntax.parse(source, {
    positions: true,
    onParseError(error: { message?: string; rawMessage?: string; line?: number; column?: number }) {
      issues.push({
        message: (error.rawMessage ?? error.message ?? 'Syntax error').replace(/\.$/, ''),
        line: error.line ?? 1,
        column: error.column ?? 1,
      });
    },
  } as Parameters<typeof csso.syntax.parse>[1]);
  issues.push(...unclosedBlocks(source));
  issues.sort((a, b) => a.line - b.line || a.column - b.column);
  const result = csso.minify(source, { restructure: options.restructure, comments: options.keepLicense ? 'exclamation' : false });
  return { css: result.css, issues, engine: 'csso' };
}

/** Finds "{" that are never closed (CSSO silently closes them at the end of the file). */
export function unclosedBlocks(source: string): CssIssue[] {
  const stack: number[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < source.length && source[i] !== c && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '{') stack.push(i);
    else if (c === '}') stack.pop();
    i++;
  }
  return stack.map((offset) => {
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    return { message: 'This "{" is never closed', line, column: offset - before.lastIndexOf('\n') };
  });
}
