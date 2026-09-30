import type { CssMinifyOptions, CssMinifyResult } from './cssMinify';
import type { HtmlMinifyOptions, HtmlMinifyResult } from './htmlMinify';
import type { JsMinifyOptions, JsMinifyResult } from './jsMinify';
import type { FormatOptions, PrettierParser } from './prettier';

/** Jobs run by `code.worker.ts`. */
export type CodeTask =
  | { kind: 'format'; code: string; parser: PrettierParser; options: FormatOptions }
  | { kind: 'minify-js'; code: string; options: JsMinifyOptions }
  | { kind: 'minify-css'; code: string; options: CssMinifyOptions }
  | { kind: 'minify-html'; code: string; options: HtmlMinifyOptions };

/** The value each kind of task resolves with. */
export interface CodeTaskResult {
  format: string;
  'minify-js': JsMinifyResult;
  'minify-css': CssMinifyResult;
  'minify-html': HtmlMinifyResult;
}

/** A failure as plain data (errors lose their extra fields when posted from a worker). */
export interface CodeError {
  message: string;
  line: number | null;
  column: number | null;
  /** Code frame around the error, when the parser provides one. */
  frame: string | null;
}

export interface CodeRequest {
  id: number;
  task: CodeTask;
}

export type CodeResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: CodeError };
