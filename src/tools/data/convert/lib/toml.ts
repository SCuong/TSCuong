import { parse, stringify, TomlDate, TomlError } from 'smol-toml';
import {
  capitalize,
  fail,
  LOSSY_INTEGER_WARNING,
  normalizeInput,
  ok,
  plural,
  readJsonLossless,
  setOwn,
  stringifyJsonLossless,
  type ConvertResult,
  type IndentOption,
} from './common';

export interface TomlToJsonOptions {
  indent: IndentOption;
}

/** What to do with JSON null, which TOML cannot represent. */
export type TomlNullMode = 'omit' | 'empty';

export interface JsonToTomlOptions {
  /** Write strings that are valid TOML dates or times (e.g. "2024-05-01", "07:30:00") as TOML date values. Default true. */
  detectDates?: boolean;
  /** Default 'omit'. */
  nulls?: TomlNullMode;
  sortKeys?: boolean;
}

// ---------------------------------------------------------------------------
// TOML → JSON
// ---------------------------------------------------------------------------

/** Count `#` comments outside strings (they cannot be kept in JSON). */
export function countTomlComments(text: string): number {
  if (!text.includes('#')) return 0;
  let count = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '#') {
      count++;
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? n : eol + 1;
    } else if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      const delim = text.slice(i, i + 3);
      let j = i + 3;
      for (;;) {
        const close = text.indexOf(delim, j);
        if (close === -1) return count;
        // In basic multi-line strings an odd run of backslashes escapes the quote.
        let backslashes = 0;
        for (let k = close - 1; delim === '"""' && k >= i + 3 && text[k] === '\\'; k--) backslashes++;
        if (backslashes % 2 === 0) {
          // Up to two extra quotes may directly precede the closing delimiter ("""a"""" is valid).
          let end = close + 3;
          while (text[end] === delim[0] && end - close < 5) end++;
          i = end;
          break;
        }
        j = close + 1;
      }
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') {
        if (ch === '"' && text[j] === '\\') j++;
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return count;
}

/** "Invalid TOML document: expected comma…\n\n<code frame>" → "Expected comma…". */
function cleanTomlMessage(error: TomlError): string {
  const first = error.message.split('\n')[0] ?? error.message;
  return capitalize(first.replace(/^Invalid TOML document:\s*/, '').replace(/\.$/, ''));
}

function dateToString(date: TomlDate): string {
  // Drop the ".000" smol-toml adds when the value has no fractional seconds.
  return date.toISOString().replace(/\.000(?=$|[Zz+-])/, '');
}

export function tomlToJson(input: string, options: TomlToJsonOptions): ConvertResult {
  const text = normalizeInput(input);
  if (!text.trim()) return fail('Input is empty');
  let value: unknown;
  try {
    value = parse(text, { integersAsBigInt: 'asNeeded' });
  } catch (error) {
    if (error instanceof TomlError) return fail(cleanTomlMessage(error), error.line, error.column);
    if (error instanceof RangeError) return fail('The TOML is nested too deeply to convert.');
    return fail(error instanceof Error ? error.message : 'Could not parse the TOML.');
  }
  let dates = 0;
  const convert = (v: unknown): unknown => {
    if (v instanceof TomlDate) {
      dates++;
      return dateToString(v);
    }
    if (Array.isArray(v)) return v.map(convert);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) setOwn(out, k, convert(child));
      return out;
    }
    return v;
  };
  const warnings: string[] = [];
  let json: string;
  try {
    json = stringifyJsonLossless(convert(value), options.indent, warnings);
  } catch (error) {
    if (error instanceof RangeError) return fail('The TOML is nested too deeply to convert.');
    throw error;
  }
  if (dates) warnings.push(`${plural(dates, 'date or time', 'dates and times')} ${dates === 1 ? 'was' : 'were'} written as ${dates === 1 ? 'a string' : 'strings'}, because JSON has no date type.`);
  const comments = countTomlComments(text);
  if (comments) warnings.push(`${plural(comments, 'comment')} ${comments === 1 ? 'was' : 'were'} dropped, because JSON has no comments.`);
  return ok(json, warnings);
}

// ---------------------------------------------------------------------------
// JSON → TOML
// ---------------------------------------------------------------------------

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))?$/;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function validTime(h: number, min: number, s: number): boolean {
  return h <= 23 && min <= 59 && s <= 59;
}

/** True for strings that are valid TOML offset/local date-times, local dates or local times. */
export function isTomlDateString(value: string): boolean {
  if (value.length > 40) return false;
  let m = DATE.exec(value);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = TIME.exec(value);
  if (m) return validTime(+m[1], +m[2], +m[3]);
  m = DATE_TIME.exec(value);
  if (m) {
    if (!validDate(+m[1], +m[2], +m[3]) || !validTime(+m[4], +m[5], +m[6])) return false;
    return m[7] === undefined || (+m[8] <= 23 && +m[9] <= 59);
  }
  return false;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function compareKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

export function jsonToToml(input: string, options: JsonToTomlOptions = {}): ConvertResult {
  if (!input.trim()) return fail('Input is empty');
  const parsed = readJsonLossless(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const warnings: string[] = parsed.lossy ? [LOSSY_INTEGER_WARNING] : [];
  const detectDates = options.detectDates !== false;
  const nulls = options.nulls ?? 'omit';
  // Raw TOML literals (dates) travel through smol-toml as marked strings and are unquoted afterwards.
  const mark = `\u0000lk-raw-${Math.random().toString(36).slice(2, 10)}:`;
  let nullCount = 0;
  let dateCount = 0;
  let hugeInts = 0;

  const prepare = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (detectDates && isTomlDateString(v)) {
        dateCount++;
        return mark + v;
      }
      return v;
    }
    if (typeof v === 'bigint') {
      if (v < INT64_MIN || v > INT64_MAX) {
        hugeInts++;
        return v.toString();
      }
      return v;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) {
        if (item === null) {
          nullCount++;
          if (nulls === 'empty') out.push('');
          continue;
        }
        out.push(prepare(item));
      }
      return out;
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      const keys = Object.keys(v);
      if (options.sortKeys) keys.sort(compareKeys);
      for (const k of keys) {
        const child = (v as Record<string, unknown>)[k];
        if (child === null) {
          nullCount++;
          if (nulls === 'empty') setOwn(out, k, '');
          continue;
        }
        setOwn(out, k, prepare(child));
      }
      return out;
    }
    return v;
  };

  let root = parsed.value;
  if (Array.isArray(root)) {
    warnings.push('A TOML document must be a table, so the top-level array was placed under the key "items".');
    root = { items: root };
  } else if (root === null || typeof root !== 'object') {
    warnings.push('A TOML document must be a table, so the top-level value was placed under the key "value".');
    root = { value: root };
  }

  let toml: string;
  try {
    toml = stringify(prepare(root));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof RangeError && /surrogate/i.test(message)) return fail('A key contains an invalid Unicode character (a lone surrogate).');
    if (error instanceof RangeError || /maximum object depth/i.test(message)) return fail('The JSON is nested too deeply to convert.');
    return fail(message || 'Could not convert to TOML.');
  }
  const escapedMark = JSON.stringify(mark).slice(1, -1);
  toml = toml.split(`"${escapedMark}`).map((part, i) => (i === 0 ? part : part.replace('"', ''))).join('');
  if (toml.trim() === '') toml = '';

  // Safety net: the result must parse as TOML.
  try {
    parse(toml, { integersAsBigInt: 'asNeeded' });
  } catch (error) {
    return fail(`The converted TOML did not validate: ${error instanceof TomlError ? cleanTomlMessage(error) : String(error)}`);
  }

  if (nullCount) {
    warnings.push(
      nulls === 'empty'
        ? `${plural(nullCount, 'null value')} ${nullCount === 1 ? 'was' : 'were'} written as an empty string, because TOML has no null.`
        : `${plural(nullCount, 'null value')} ${nullCount === 1 ? 'was' : 'were'} left out, because TOML has no null.`,
    );
  }
  if (dateCount) {
    warnings.push(
      `${plural(dateCount, 'string')} that ${dateCount === 1 ? 'looks' : 'look'} like a date or time ${dateCount === 1 ? 'was' : 'were'} written as TOML date/time ${dateCount === 1 ? 'value' : 'values'}.`,
    );
  }
  if (hugeInts) warnings.push(`${plural(hugeInts, 'integer')} outside the 64-bit range ${hugeInts === 1 ? 'was' : 'were'} written as ${hugeInts === 1 ? 'a string' : 'strings'}.`);
  return ok(toml, warnings);
}
