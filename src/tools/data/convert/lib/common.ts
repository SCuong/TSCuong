import { parseJson, positionAt, stripBom } from '@/tools/json/lib/json';

export interface ConvertError {
  message: string;
  /** 1-based line of the problem in the input, when known. */
  line?: number;
  /** 1-based column of the problem in the input, when known. */
  column?: number;
}

export type ConvertResult =
  | { ok: true; value: string; warnings: string[] }
  | { ok: false; error: ConvertError };

export type IndentOption = '2' | '4' | 'tab';

export function ok(value: string, warnings: string[] = []): ConvertResult {
  return { ok: true, value, warnings };
}

export function fail(message: string, line?: number, column?: number): ConvertResult {
  return { ok: false, error: { message, line, column } };
}

export function indentText(indent: IndentOption): string {
  return indent === 'tab' ? '\t' : ' '.repeat(Number(indent));
}

/** "Message (line 3, column 5)" or just the message when the position is unknown. */
export function formatConvertError(error: ConvertError): string {
  if (error.line === undefined) return error.message;
  return `${error.message} (line ${error.line}${error.column !== undefined ? `, column ${error.column}` : ''})`;
}

/** Parse JSON input and report errors with line/column, as a ConvertResult-compatible shape. */
export function readJson(text: string): { ok: true; value: unknown } | { ok: false; error: ConvertError } {
  const parsed = parseJson(text);
  if (parsed.ok) return parsed;
  return { ok: false, error: { ...parsed.error } };
}

interface ReviverContext {
  source?: string;
}

/** True when this JavaScript engine passes the source text of primitives to JSON.parse revivers. */
export const JSON_SOURCE_SUPPORTED: boolean = (() => {
  try {
    let seen = false;
    JSON.parse('1', function (this: unknown, _key: string, value: unknown, context?: ReviverContext) {
      if (context && context.source === '1') seen = true;
      return value;
    } as (key: string, value: unknown) => unknown);
    return seen;
  } catch {
    return false;
  }
})();

/**
 * Parse JSON while keeping integers beyond ±2^53 exact: they become BigInt values
 * (when the browser exposes the source text to revivers). `lossy` is true when
 * such an integer was found but could not be kept exactly.
 */
export function readJsonLossless(
  text: string,
): { ok: true; value: unknown; lossy: boolean } | { ok: false; error: ConvertError } {
  const source = stripBom(text);
  if (!source.trim()) return { ok: false, error: { message: 'Input is empty', line: 1, column: 1 } };
  // Only integers with 16+ digits can be unsafe; skip the slower reviver path otherwise.
  if (!/\d{16}/.test(source)) return withLossy(readJson(source));
  let lossy = false;
  try {
    const value: unknown = JSON.parse(source, function (this: unknown, _key: string, v: unknown, context?: ReviverContext) {
      if (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)) {
        const raw = context?.source;
        if (raw !== undefined && /^-?\d+$/.test(raw)) return BigInt(raw);
        if (raw === undefined) lossy = true;
      }
      return v;
    } as (key: string, value: unknown) => unknown);
    return { ok: true, value, lossy };
  } catch {
    return withLossy(readJson(source));
  }
}

function withLossy(
  r: { ok: true; value: unknown } | { ok: false; error: ConvertError },
): { ok: true; value: unknown; lossy: boolean } | { ok: false; error: ConvertError } {
  return r.ok ? { ok: true, value: r.value, lossy: false } : r;
}

export const LOSSY_INTEGER_WARNING =
  'Some integers are larger than 2^53. This browser cannot read them exactly, so their last digits may have changed.';

/** Normalize text input: strip a BOM and convert CRLF/CR line endings to LF. */
export function normalizeInput(text: string): string {
  return stripBom(text).replace(/\r\n?/g, '\n');
}

/**
 * Assign an own, enumerable property. Unlike `obj[key] = value`, this also works
 * for the key "__proto__" (which would otherwise replace the prototype and lose the key).
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

const BIGINT_MARK = '\u0000lk-bigint:';

/**
 * JSON.stringify that writes BigInt values as plain JSON numbers (keeping every digit),
 * turns non-finite numbers into strings and serializes Dates through toISOString.
 * `indent: 'min'` writes compact JSON.
 */
export function stringifyJsonLossless(value: unknown, indent: IndentOption | 'min', warnings?: string[]): string {
  let nonFinite = 0;
  const text = JSON.stringify(
    value,
    (_key, v: unknown) => {
      if (typeof v === 'bigint') return BIGINT_MARK + v.toString();
      if (typeof v === 'number' && !Number.isFinite(v)) {
        nonFinite++;
        return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
      }
      return v;
    },
    indent === 'min' ? undefined : indent === 'tab' ? '\t' : Number(indent),
  );
  if (nonFinite && warnings) {
    warnings.push(`${nonFinite} infinite or NaN value${nonFinite === 1 ? ' was' : 's were'} written as a string, because JSON has no such numbers.`);
  }
  if (text === undefined) return '';
  // The marker string is JSON-escaped as \u0000 in the output text.
  return text.replace(/"\\u0000lk-bigint:(-?\d+)"/g, '$1');
}

/** Human description of a JSON path made of keys and indexes, e.g. `$.users[2].name`. */
export function describePath(path: Array<string | number>): string {
  let out = '$';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(seg)) out += `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

/** Count lines of a string (an empty string has 0 lines). */
export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines;
}

/** 1-based line/column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  return positionAt(text, offset);
}

/** "3 values" / "1 value". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/** Upper-case the first character of a message. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** UTF-8 size of a string in bytes (without allocating a Blob). */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Heuristics used to suggest the other conversion direction. */
export function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[') || t.length > 5_000_000) return false;
  try {
    JSON.parse(stripBom(t));
    return true;
  } catch {
    return false;
  }
}

export function looksLikeXml(text: string): boolean {
  return /^\s*</.test(stripBom(text));
}
