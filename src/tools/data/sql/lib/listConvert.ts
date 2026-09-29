/** How the input is split into items when building a list. */
export type SplitMode = 'lines' | 'commas' | 'whitespace' | 'any';
export type ListFormat = 'sql' | 'json' | 'quoted';
export type QuoteStyle = 'single' | 'double' | 'backtick' | 'none';
/** How a quote character inside an item is escaped. */
export type EscapeStyle = 'double' | 'backslash' | 'none';
export type SortMode = 'none' | 'asc' | 'desc';

export interface CleanOptions {
  trim: boolean;
  removeEmpty: boolean;
  dedupe: boolean;
  /** Compare case-insensitively when removing duplicates. */
  ignoreCase?: boolean;
  sort: SortMode;
}

export interface BuildListOptions extends CleanOptions {
  split: SplitMode;
  format: ListFormat;
  /** Leave items unquoted when every item is a number. */
  unquotedNumbers: boolean;
  /** For the quoted format. */
  quote: QuoteStyle;
  escape: EscapeStyle;
  separator: string;
  prefix: string;
  suffix: string;
  /** Items per output line (0 = everything on one line). */
  perLine: number;
  /** SQL: optional column, giving `column IN (…)`. */
  column: string;
  /** SQL: at most this many items per IN list, joined with OR (Oracle allows 1,000). 0 = no limit. */
  chunk: number;
  /** SQL: write NOT IN. */
  negate?: boolean;
}

export interface ListStats {
  /** Items after splitting (before cleaning). */
  found: number;
  items: number;
  duplicates: number;
  empty: number;
  /** True when numbers were left unquoted. */
  numeric: boolean;
}

export interface BuildListResult {
  output: string;
  stats: ListStats;
  notes: string[];
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function isPlainNumber(value: string): boolean {
  return NUMBER.test(value);
}

export function splitItems(text: string, mode: SplitMode): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n?/g, '\n');
  switch (mode) {
    case 'commas':
      return normalized.split(',');
    case 'whitespace':
      return normalized.split(/\s+/);
    case 'any':
      return normalized.split(/[\n,;\t]/);
    default:
      return normalized.split('\n');
  }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Trim, drop empties, remove duplicates (keeping the first) and sort. */
export function cleanItems(items: string[], options: CleanOptions): { items: string[]; duplicates: number; empty: number } {
  let list = options.trim ? items.map((s) => s.trim()) : items.slice();
  let empty = 0;
  if (options.removeEmpty) {
    const kept = list.filter((s) => s.trim() !== '');
    empty = list.length - kept.length;
    list = kept;
  }
  let duplicates = 0;
  if (options.dedupe) {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const item of list) {
      const key = options.ignoreCase ? item.toLocaleLowerCase() : item;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      kept.push(item);
    }
    list = kept;
  }
  if (options.sort !== 'none') {
    const numeric = list.length > 0 && list.every(isPlainNumber);
    list.sort(numeric ? (a, b) => Number(a) - Number(b) : (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
    if (options.sort === 'desc') list.reverse();
  }
  return { items: list, duplicates, empty };
}

const QUOTE_CHARS: Record<QuoteStyle, string> = { single: "'", double: '"', backtick: '`', none: '' };

export function quoteItem(item: string, quote: QuoteStyle, escape: EscapeStyle): string {
  const q = QUOTE_CHARS[quote];
  if (!q) return item;
  let body = item;
  if (escape === 'double') body = body.split(q).join(q + q);
  else if (escape === 'backslash') body = body.replace(/\\/g, '\\\\').split(q).join(`\\${q}`);
  return q + body + q;
}

function sqlString(item: string): string {
  return `'${item.replace(/'/g, "''")}'`;
}

/** Join values, starting a new line every `perLine` items. `framed` output gets newlines inside its brackets. */
function joinItems(values: string[], separator: string, perLine: number, indent: string, framed = true): string {
  if (!perLine || perLine <= 0 || values.length <= perLine) return values.join(separator);
  const trimmedSep = separator.replace(/\s+$/, '');
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += perLine) lines.push(indent + values.slice(i, i + perLine).join(separator));
  const body = lines.join(`${trimmedSep}\n`);
  return framed ? `\n${body}\n` : body;
}

export function buildList(text: string, options: BuildListOptions): BuildListResult {
  const raw = splitItems(text, options.split);
  const cleaned = cleanItems(raw, options);
  const items = cleaned.items;
  const numeric = options.unquotedNumbers && items.length > 0 && items.every(isPlainNumber);
  const stats: ListStats = { found: raw.length, items: items.length, duplicates: cleaned.duplicates, empty: cleaned.empty, numeric };
  const notes: string[] = [];
  if (!items.length) return { output: '', stats, notes };
  if (options.unquotedNumbers && !numeric && items.some(isPlainNumber)) {
    notes.push('The list mixes numbers and text, so every item was quoted.');
  }
  const perLine = Math.max(0, Math.floor(options.perLine || 0));

  if (options.format === 'json') {
    const values = items.map((s) => (numeric ? s : JSON.stringify(s)));
    return { output: `[${joinItems(values, ', ', perLine, '  ')}]`, stats, notes };
  }

  if (options.format === 'sql') {
    const values = items.map((s) => (numeric ? s : sqlString(s)));
    const column = options.column.trim();
    const op = options.negate ? 'NOT IN' : 'IN';
    const chunk = Math.max(0, Math.floor(options.chunk || 0));
    const lists: string[][] = [];
    if (chunk > 0 && values.length > chunk) {
      for (let i = 0; i < values.length; i += chunk) lists.push(values.slice(i, i + chunk));
    } else {
      lists.push(values);
    }
    if (lists.length > 1 && !column) {
      notes.push('Enter a column name to split the list into several IN lists.');
      return { output: `${op} (${joinItems(values, ', ', perLine, '  ')})`, stats, notes };
    }
    const one = (list: string[]) => `${column ? `${column} ` : ''}${op} (${joinItems(list, ', ', perLine, '  ')})`;
    if (lists.length === 1) return { output: one(lists[0]), stats, notes };
    // NOT IN lists must all hold, IN lists are alternatives.
    const joiner = options.negate ? '\n  AND ' : '\n  OR ';
    notes.push(`Split into ${lists.length} lists of at most ${chunk.toLocaleString('en-US')} items.`);
    return { output: `(${lists.map(one).join(joiner)})`, stats, notes };
  }

  const values = items.map((s) => (numeric ? s : quoteItem(s, options.quote, options.escape)));
  const separator = options.separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const framed = Boolean(options.prefix || options.suffix);
  return { output: `${options.prefix}${joinItems(values, separator, perLine, framed ? '  ' : '', framed)}${options.suffix}`, stats, notes };
}

// ---------------------------------------------------------------------------
// List → lines
// ---------------------------------------------------------------------------

export type ParseSeparator = 'auto' | ',' | ';' | '\t' | '|' | 'whitespace';

export interface ParseListOptions extends CleanOptions {
  separator: ParseSeparator;
  /** Remove surrounding quotes and unescape doubled or backslash-escaped quotes. */
  unquote: boolean;
}

export interface ParseListResult {
  items: string[];
  output: string;
  stats: ListStats;
  /** The separator that was used (for auto). */
  separator: Exclude<ParseSeparator, 'auto'> | 'newline';
}

/** Strip `col IN (…)`, `NOT IN (…)`, `[…]`, `(…)` or `{…}` around a list. */
export function stripWrapper(text: string): string {
  let s = text.trim().replace(/;$/, '').trim();
  const inList = /^(?:[\w."`[\]]+\s+)?(?:NOT\s+)?IN\s*\(([\s\S]*)\)$/i.exec(s);
  if (inList) return inList[1];
  if ((s.startsWith('(') && s.endsWith(')')) || (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
    s = s.slice(1, -1);
  }
  return s;
}

function countSeparators(text: string, quoteAware: boolean): Record<string, number> | null {
  let quote = '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0, '\n': 0 };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (quoteAware && (c === "'" || c === '"' || c === '`')) quote = c;
    else if (c in counts) counts[c]++;
  }
  // An unclosed quote makes quote-aware counting meaningless.
  return quote ? null : counts;
}

function detectSeparator(text: string): Exclude<ParseSeparator, 'auto'> | 'newline' {
  const counts = countSeparators(text, true) ?? countSeparators(text, false)!;
  for (const sep of [',', ';', '\t', '|'] as const) if (counts[sep] > 0) return sep;
  if (counts['\n'] > 0) return 'newline';
  return 'whitespace';
}

/**
 * Read a quoted value starting at `start` (the opening quote). Doubled quotes and
 * backslash-escaped quotes or backslashes are unescaped; any other backslash is kept,
 * so Windows paths such as 'C:\new' survive.
 */
function readQuoted(text: string, start: number, quote: string): { value: string; end: number } | null {
  let value = '';
  let k = start + 1;
  while (k < text.length) {
    const c = text[k];
    if (c === '\\' && quote !== '`' && (text[k + 1] === quote || text[k + 1] === '\\')) {
      value += text[k + 1];
      k += 2;
      continue;
    }
    if (c === quote) {
      if (text[k + 1] === quote) {
        value += quote;
        k += 2;
        continue;
      }
      return { value, end: k + 1 };
    }
    value += c;
    k++;
  }
  return null;
}

/** Split a delimited list, respecting quotes. */
export function splitQuoted(text: string, separator: Exclude<ParseSeparator, 'auto'> | 'newline', unquote: boolean): string[] {
  const n = text.length;
  const isSep = (c: string) =>
    separator === 'whitespace' ? /\s/.test(c) : separator === 'newline' ? c === '\n' : c === separator || (separator !== '\t' && c === '\n');
  // After ",", ";" or "|" (and line breaks between items), whitespace is only layout.
  const layout = separator === 'whitespace' || separator === ',' || separator === ';' || separator === '|';
  const items: string[] = [];
  let i = 0;
  for (;;) {
    let j = i;
    while (j < n && text[j] !== '\n' && /\s/.test(text[j]) && !isSep(text[j])) j++;
    const q = text[j];
    let value: string | null = null;
    let end = n;
    if (unquote && (q === "'" || q === '"' || q === '`')) {
      const quoted = readQuoted(text, j, q);
      if (quoted) {
        // Characters between the closing quote and the next separator are ignored.
        let k = quoted.end;
        while (k < n && !isSep(text[k])) k++;
        value = quoted.value;
        end = k;
      }
    }
    if (value === null) {
      let k = i;
      while (k < n && !isSep(text[k])) k++;
      value = text.slice(i, k);
      end = k;
    }
    items.push(value);
    if (end >= n) break;
    i = end + 1;
    if (layout) {
      while (i < n && /\s/.test(text[i]) && (separator === 'whitespace' || text[i] === '\n' || !isSep(text[i]))) i++;
    }
  }
  return items;
}

export function parseList(text: string, options: ParseListOptions): ParseListResult {
  const body = stripWrapper(text.replace(/\r\n?/g, '\n'));
  let raw: string[] | null = null;
  let separator: ParseListResult['separator'] = options.separator === 'auto' ? detectSeparator(body) : options.separator;
  // A JSON array of strings and numbers is read exactly (escapes included).
  const trimmed = text.trim();
  if (options.unquote && trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (Array.isArray(value) && value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
        raw = value.map((v) => (v === null ? 'null' : String(v)));
        separator = ',';
      }
    } catch {
      raw = null;
    }
  }
  if (!raw) raw = body.trim() ? splitQuoted(body, separator, options.unquote) : [];
  const cleaned = cleanItems(raw, options);
  const stats: ListStats = { found: raw.length, items: cleaned.items.length, duplicates: cleaned.duplicates, empty: cleaned.empty, numeric: false };
  return { items: cleaned.items, output: cleaned.items.join('\n'), stats, separator };
}
