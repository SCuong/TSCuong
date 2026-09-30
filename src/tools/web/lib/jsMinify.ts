import type { MinifyOptions } from 'terser';

/**
 * How top-level code is treated. A classic script's top-level functions and variables are globals that
 * other scripts and HTML attributes (onclick="…") may use, so they are kept as written; in an ES module
 * they are private, so unused ones may be dropped and the rest renamed.
 */
export type SourceType = 'auto' | 'script' | 'module';

export interface JsMinifyOptions {
  compress: boolean;
  mangle: boolean;
  /** 'auto' treats code with import/export statements (or top-level await) as a module, anything else as a script. */
  sourceType: SourceType;
  /** Keep /*! and @license comments. */
  keepLicense: boolean;
  ecma: 5 | 2015 | 2020;
}

export const DEFAULT_JS_OPTIONS: JsMinifyOptions = { compress: true, mangle: true, sourceType: 'auto', keepLicense: true, ecma: 2020 };

export interface JsMinifyResult {
  code: string;
  /** The mode that was used (the detected one for 'auto'). */
  module: boolean;
}

export class JsMinifyError extends Error {
  override name = 'JsMinifyError';
  constructor(
    message: string,
    public line: number | null,
    public column: number | null,
  ) {
    super(line !== null ? `Line ${line}, column ${column}: ${message}` : message);
  }
}

type Minify = (typeof import('terser'))['minify'];

// Parse only and return the AST (Terser supports these output switches; its typings omit them).
const PARSE_ONLY = { compress: false, mangle: false, format: { ast: true, code: false } } as unknown as MinifyOptions;

/**
 * Detects ES module code: top-level import/export statements, or code that only parses as a module
 * (top-level await). Dynamic import() and everything else is fine in classic scripts.
 */
export async function detectModule(source: string, minify: Minify): Promise<boolean> {
  // Cheap pre-check: without these keywords the code cannot be module-only syntax.
  if (!/\b(?:import|export|await)\b/.test(source)) return false;
  try {
    const parsed = (await minify(source, { ...PARSE_ONLY, module: false })) as { ast?: { body?: Array<{ TYPE?: string }> } };
    const body = parsed.ast?.body ?? [];
    return body.some((node) => node.TYPE === 'Import' || node.TYPE === 'Export');
  } catch {
    try {
      await minify(source, { ...PARSE_ONLY, module: true });
      return true;
    } catch {
      // Invalid either way: minify as a script so the error message refers to what the user most likely wrote.
      return false;
    }
  }
}

/** Minifies JavaScript with Terser (loaded on demand). */
export async function minifyJs(source: string, options: JsMinifyOptions): Promise<JsMinifyResult> {
  const { minify } = await import('terser');
  const sourceType = options.sourceType ?? 'auto';
  const module = sourceType === 'module' ? true : sourceType === 'script' ? false : await detectModule(source, minify);
  try {
    const result = await minify(source, {
      module,
      compress: options.compress ? { ecma: options.ecma } : false,
      mangle: options.mangle,
      ecma: options.ecma,
      format: { comments: options.keepLicense ? 'some' : false, ecma: options.ecma },
    });
    return { code: result.code ?? '', module };
  } catch (error) {
    const e = error as { message?: string; line?: number; col?: number };
    if (typeof e.line === 'number') {
      const msg = (e.message ?? 'Syntax error').replace(/\s*\(line: \d+, col: \d+, pos: \d+\)$/, '');
      throw new JsMinifyError(msg.charAt(0).toUpperCase() + msg.slice(1), e.line, (e.col ?? 0) + 1);
    }
    throw new JsMinifyError(e.message ?? 'The code could not be minified.', null, null);
  }
}
