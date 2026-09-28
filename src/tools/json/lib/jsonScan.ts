/** Maps offsets to 1-based line/column using a lazily built index of line starts. */
export function createLineIndex(text: string) {
  let starts: number[] | null = null;
  return (offset: number): { line: number; column: number } => {
    if (!starts) {
      starts = [0];
      for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) starts.push(k + 1);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

/**
 * A strict, allocation-light JSON scanner (RFC 8259) that reports precise,
 * browser-independent error messages with positions, and finds duplicate keys
 * that JSON.parse silently collapses (last one wins).
 */

export interface ScanError {
  message: string;
  offset: number;
  line: number;
  column: number;
  /** Characters to underline at the error position. */
  length: number;
}

export interface DuplicateKey {
  key: string;
  /** JSONPath of the object that contains the duplicate. */
  path: string;
  line: number;
  column: number;
  firstLine: number;
}

export interface ScanResult {
  ok: boolean;
  error: ScanError | null;
  duplicates: DuplicateKey[];
  /** True when nesting was deeper than the scanner follows (duplicates are then incomplete). */
  truncated: boolean;
}

const MAX_DEPTH = 1500;
const MAX_DUPLICATES = 500;

class Fail extends Error {
  constructor(
    public readonly msg: string,
    public readonly at: number,
    public readonly len = 1,
  ) {
    super(msg);
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function pathSegment(key: string | number): string {
  if (typeof key === 'number') return `[${key}]`;
  return IDENT.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function describeChar(ch: string): string {
  if (ch === '\n') return 'a line break';
  if (ch === '\t') return 'a tab';
  if (ch === ' ') return 'a space';
  return `'${ch}'`;
}

export function scanJson(input: string): ScanResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const bom = text === input ? 0 : 1;
  const n = text.length;
  let i = 0;
  let truncated = false;
  let lastComma = 0;
  const duplicates: DuplicateKey[] = [];
  const positionAt = createLineIndex(text);

  function ws() {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else if (c === 47 /* / */ && (text[i + 1] === '/' || text[i + 1] === '*')) {
        throw new Fail('Comments are not allowed in JSON', i, 2);
      } else break;
    }
  }

  function unexpected(context: string): never {
    if (i >= n) throw new Fail(`Unexpected end of input ${context}`, n, 0);
    const ch = text[i];
    if (ch === "'") throw new Fail('Strings must use double quotes, not single quotes', i);
    throw new Fail(`Unexpected ${describeChar(ch)} ${context}`, i);
  }

  /** Scans a string starting at the opening quote; returns the raw slice (without quotes). */
  function string(): string {
    const start = i;
    i++; // opening quote
    let hasEscape = false;
    while (true) {
      if (i >= n) throw new Fail('Unterminated string (missing closing quote)', start, 1);
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        break;
      }
      if (c === 92) {
        hasEscape = true;
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            throw new Fail('Invalid Unicode escape: \\u must be followed by 4 hex digits', i, 2);
          }
          i += 6;
          continue;
        }
        if (e === undefined) throw new Fail('Unterminated string (missing closing quote)', start, 1);
        if (!'"\\/bfnrt'.includes(e)) throw new Fail(`Invalid escape sequence '\\${e}' in string`, i, 2);
        i += 2;
        continue;
      }
      if (c < 0x20) {
        const name = c === 10 ? 'line break' : c === 9 ? 'tab' : 'control character';
        throw new Fail(
          c === 10 || c === 13
            ? 'Unterminated string or raw line break inside a string (use \\n)'
            : `Raw ${name} inside a string is not allowed (escape it)`,
          i,
        );
      }
      i++;
    }
    const raw = text.slice(start + 1, i - 1);
    return hasEscape ? (JSON.parse(`"${raw}"`) as string) : raw;
  }

  function number() {
    const start = i;
    if (text[i] === '-') i++;
    if (text[i] === '0') {
      i++;
      if (i < n && text[i] >= '0' && text[i] <= '9') throw new Fail('Numbers cannot have leading zeros', start, i - start + 1);
    } else if (text[i] >= '1' && text[i] <= '9') {
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    } else {
      throw new Fail('Invalid number', start, Math.max(1, i - start + 1));
    }
    if (text[i] === '.') {
      i++;
      if (!(text[i] >= '0' && text[i] <= '9')) throw new Fail('Invalid number: expected digits after the decimal point', start, i - start);
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!(text[i] >= '0' && text[i] <= '9')) throw new Fail('Invalid number: expected digits in the exponent', start, i - start);
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    }
  }

  function literal(word: string) {
    if (text.startsWith(word, i)) {
      i += word.length;
      return;
    }
    let end = i;
    while (end < n && /[A-Za-z0-9_]/.test(text[end])) end++;
    const got = text.slice(i, end) || text[i];
    const hint =
      got === 'True' || got === 'False' || got === 'None' || got === 'NaN' || got === 'Infinity' || got === 'undefined'
        ? ` ('${got}' is not a JSON value; use true, false or null)`
        : '';
    throw new Fail(`Unexpected token '${got}'${hint}`, i, Math.max(1, end - i));
  }

  function value(path: string, depth: number) {
    ws();
    if (i >= n) unexpected('(expected a value)');
    const c = text[i];
    if (c === '{') return object(path, depth + 1);
    if (c === '[') return array(path, depth + 1);
    if (c === '"') return void string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    if (c === 't') return literal('true');
    if (c === 'f') return literal('false');
    if (c === 'n') return literal('null');
    if (c === ']' || c === '}') throw new Fail(`Unexpected '${c}' (expected a value)`, i);
    if (c === ',') throw new Fail("Unexpected ',' (expected a value)", i);
    if (/[A-Za-z_]/.test(c)) return literal('#');
    if (c === '+' || c === '.') throw new Fail('Invalid number', i);
    unexpected('(expected a value)');
  }

  function skipNested(open: string, close: string) {
    // Past the depth limit: stay strict about brackets/strings but stop tracking keys.
    truncated = true;
    let level = 0;
    const start = i;
    while (i < n) {
      const ch = text[i];
      if (ch === '"') {
        string();
        continue;
      }
      if (ch === '[' || ch === '{') level++;
      else if (ch === ']' || ch === '}') {
        level--;
        if (level === 0) {
          i++;
          return;
        }
      }
      i++;
    }
    throw new Fail(`Unexpected end of input (missing '${close}' for the '${open}' opened here)`, start, 1);
  }

  function object(path: string, depth: number) {
    if (depth > MAX_DEPTH) return skipNested('{', '}');
    const open = i;
    i++;
    const seen = new Map<string, number>();
    ws();
    if (text[i] === '}') {
      i++;
      return;
    }
    while (true) {
      ws();
      if (i >= n) throw new Fail("Unexpected end of input (missing '}' to close the object)", open, 1);
      const c = text[i];
      if (c !== '"') {
        if (c === '}') throw new Fail('Trailing comma is not allowed before }', lastComma, 1);
        if (c === "'") throw new Fail('Property names must use double quotes, not single quotes', i);
        if (/[A-Za-z_$]/.test(c)) {
          let end = i;
          while (end < n && /[A-Za-z0-9_$]/.test(text[end])) end++;
          throw new Fail(`Property name '${text.slice(i, end)}' must be wrapped in double quotes`, i, end - i);
        }
        unexpected('(expected a property name in double quotes)');
      }
      const keyAt = i;
      const key = string();
      if (duplicates.length < MAX_DUPLICATES) {
        const first = seen.get(key);
        if (first !== undefined) {
          const pos = positionAt(keyAt);
          duplicates.push({
            key,
            path: path || '$',
            line: pos.line,
            column: pos.column + (pos.line === 1 ? bom : 0),
            firstLine: positionAt(first).line,
          });
        } else seen.set(key, keyAt);
      }
      ws();
      if (text[i] !== ':') unexpected("(expected ':' after the property name)");
      i++;
      value(path + pathSegment(key), depth);
      ws();
      if (text[i] === ',') {
        lastComma = i;
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return;
      }
      if (i >= n) throw new Fail("Unexpected end of input (missing '}' to close the object)", open, 1);
      if (text[i] === '"') throw new Fail("Missing ',' between properties", i);
      unexpected("(expected ',' or '}' after a property value)");
    }
  }

  function array(path: string, depth: number) {
    if (depth > MAX_DEPTH) return skipNested('[', ']');
    const open = i;
    i++;
    ws();
    if (text[i] === ']') {
      i++;
      return;
    }
    let index = 0;
    while (true) {
      ws();
      if (text[i] === ']' && index > 0) throw new Fail('Trailing comma is not allowed before ]', lastComma, 1);
      value(path + `[${index}]`, depth);
      index++;
      ws();
      if (text[i] === ',') {
        lastComma = i;
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return;
      }
      if (i >= n) throw new Fail("Unexpected end of input (missing ']' to close the array)", open, 1);
      unexpected("(expected ',' or ']' after an array item)");
    }
  }

  try {
    ws();
    if (i >= n) throw new Fail('Input is empty', 0, 0);
    value('$', 0);
    ws();
    if (i < n) throw new Fail('Unexpected data after the end of the JSON value', i, 1);
    return { ok: true, error: null, duplicates, truncated };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    const pos = positionAt(e.at);
    return {
      ok: false,
      error: {
        message: e.msg,
        offset: e.at + bom,
        line: pos.line,
        column: pos.column + (pos.line === 1 ? bom : 0),
        length: e.len,
      },
      duplicates,
      truncated,
    };
  }
}
