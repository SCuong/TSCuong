export interface JsonParseError {
  message: string;
  line: number;
  column: number;
}

export type ParseResult<T = unknown> = { ok: true; value: T } | { ok: false; error: JsonParseError };

/** Line/column (1-based) for a character offset. */
export function positionAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

function describe(text: string, error: unknown): JsonParseError {
  const raw = error instanceof Error ? error.message : String(error);
  // V8: "... at position 12 (line 2 column 3)"; Firefox: "... at line 2 column 3 of the JSON data"
  const lineCol = /line (\d+) column (\d+)/i.exec(raw);
  const pos = /position (\d+)/i.exec(raw);
  let line = 1;
  let column = 1;
  if (lineCol) {
    line = Number(lineCol[1]);
    column = Number(lineCol[2]);
  } else if (pos) {
    ({ line, column } = positionAt(text, Number(pos[1])));
  } else if (/end of (JSON )?(data|input)/i.test(raw)) {
    ({ line, column } = positionAt(text, text.length));
  }
  let message = raw
    .replace(/^JSON\.parse: /, '')
    .replace(/ in JSON at position \d+.*$/, '')
    .replace(/ at line \d+ column \d+ of the JSON data$/, '')
    .replace(/, "[\s\S]*" is not valid JSON$/, '')
    .replace(/\s*\(line \d+ column \d+\)$/, '');
  if (!message) message = 'Invalid JSON';
  message = message.charAt(0).toUpperCase() + message.slice(1);
  return { message, line, column };
}

export function parseJson<T = unknown>(text: string): ParseResult<T> {
  if (!text.trim()) return { ok: false, error: { message: 'Input is empty', line: 1, column: 1 } };
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return { ok: false, error: describe(text, error) };
  }
}

export function formatJsonError(error: JsonParseError): string {
  return `${error.message} (line ${error.line}, column ${error.column})`;
}

/** Recursively sort object keys (arrays keep their order). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export type Indent = '2' | '4' | 'tab';

export function stringifyJson(value: unknown, indent: Indent = '2', sortKeys = false): string {
  const v = sortKeys ? sortKeysDeep(value) : value;
  return JSON.stringify(v, null, indent === 'tab' ? '\t' : Number(indent));
}

export function formatJson(text: string, indent: Indent = '2', sortKeys = false): ParseResult<string> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, value: stringifyJson(parsed.value, indent, sortKeys) };
}

export function minifyJson(text: string): ParseResult<string> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value) };
}

export interface JsonStats {
  objects: number;
  arrays: number;
  keys: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  maxDepth: number;
}

export function jsonStats(value: unknown): JsonStats {
  const stats: JsonStats = { objects: 0, arrays: 0, keys: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, maxDepth: 0 };
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (Array.isArray(v)) {
      stats.arrays++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      for (const item of v) stack.push([item, depth + 1]);
    } else if (v && typeof v === 'object') {
      stats.objects++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      for (const [, item] of Object.entries(v)) {
        stats.keys++;
        stack.push([item, depth + 1]);
      }
    } else if (typeof v === 'string') stats.strings++;
    else if (typeof v === 'number') stats.numbers++;
    else if (typeof v === 'boolean') stats.booleans++;
    else if (v === null) stats.nulls++;
  }
  return stats;
}
