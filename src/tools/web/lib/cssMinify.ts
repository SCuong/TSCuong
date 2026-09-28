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
  /** Syntax problems CSSO recovered from (the output may drop the broken parts). */
  issues: CssIssue[];
}

/** Minifies CSS with CSSO (loaded on demand) and reports recoverable syntax errors with positions. */
export async function minifyCss(source: string, options: CssMinifyOptions): Promise<CssMinifyResult> {
  const csso = await import('csso');
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
  return { css: result.css, issues };
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
