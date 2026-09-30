/// <reference lib="webworker" />
/**
 * Formats and minifies code off the main thread: Prettier, Terser and CSSO can take seconds on
 * megabyte-sized input. The page terminates this worker to cancel a stale or unwanted job.
 */
import { minifyCss } from './cssMinify';
import { defaultHooks, minifyHtmlDetailed } from './htmlMinify';
import { JsMinifyError, minifyJs } from './jsMinify';
import { describeFormatError, formatCode } from './prettier';
import type { CodeError, CodeRequest, CodeResponse, CodeTask } from './codeTask';

async function run(task: CodeTask): Promise<unknown> {
  switch (task.kind) {
    case 'format':
      return formatCode(task.code, task.parser, task.options);
    case 'minify-js':
      return minifyJs(task.code, task.options);
    case 'minify-css':
      return minifyCss(task.code, task.options);
    case 'minify-html':
      return minifyHtmlDetailed(task.code, task.options, defaultHooks());
  }
}

/** Errors cannot cross the worker boundary with their extra fields, so they are sent as plain data. */
function toCodeError(task: CodeTask, error: unknown): CodeError {
  if (task.kind === 'format') return describeFormatError(error);
  if (error instanceof JsMinifyError) return { message: error.message, line: error.line, column: error.column, frame: null };
  const message = error instanceof Error ? error.message : String(error);
  return { message: message || 'The code could not be processed.', line: null, column: null, frame: null };
}

self.onmessage = async (event: MessageEvent<CodeRequest>) => {
  const { id, task } = event.data;
  let response: CodeResponse;
  try {
    response = { id, ok: true, value: await run(task) };
  } catch (error) {
    response = { id, ok: false, error: toCodeError(task, error) };
  }
  (self as unknown as Worker).postMessage(response);
};
