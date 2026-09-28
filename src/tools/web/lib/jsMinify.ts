export interface JsMinifyOptions {
  compress: boolean;
  mangle: boolean;
  module: boolean;
  /** Keep /*! and @license comments. */
  keepLicense: boolean;
  ecma: 5 | 2015 | 2020;
}

export const DEFAULT_JS_OPTIONS: JsMinifyOptions = { compress: true, mangle: true, module: true, keepLicense: true, ecma: 2020 };

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

/** Minifies JavaScript with Terser (loaded on demand). */
export async function minifyJs(source: string, options: JsMinifyOptions): Promise<string> {
  const { minify } = await import('terser');
  try {
    const result = await minify(source, {
      module: options.module,
      compress: options.compress ? { ecma: options.ecma } : false,
      mangle: options.mangle,
      ecma: options.ecma,
      format: { comments: options.keepLicense ? 'some' : false, ecma: options.ecma },
    });
    return result.code ?? '';
  } catch (error) {
    const e = error as { message?: string; line?: number; col?: number };
    if (typeof e.line === 'number') {
      const msg = (e.message ?? 'Syntax error').replace(/\s*\(line: \d+, col: \d+, pos: \d+\)$/, '');
      throw new JsMinifyError(msg.charAt(0).toUpperCase() + msg.slice(1), e.line, (e.col ?? 0) + 1);
    }
    throw new JsMinifyError(e.message ?? 'The code could not be minified.', null, null);
  }
}
