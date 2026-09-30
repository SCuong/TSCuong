import Papa from 'papaparse';

/** A rectangular table of string cells. Every row has exactly `headers.length` cells. */
export interface Table {
  headers: string[];
  rows: string[][];
}

export interface ParseIssue {
  /** 1-based record number in the source (counting the header record, if any). */
  row: number | null;
  message: string;
}

export interface ParsedCsv {
  table: Table;
  /** The delimiter actually used (detected when auto). */
  delimiter: string;
  linebreak: string;
  issues: ParseIssue[];
  /** Number of data records whose field count differed from the widest record (they were padded). */
  raggedRows: number;
}

export interface ParseCsvOptions {
  /** Empty string or undefined = auto-detect. */
  delimiter?: string;
  /** Treat the first record as column names. */
  header?: boolean;
  /** Skip lines that are completely empty (default true). */
  skipEmptyLines?: boolean;
  /** Trim whitespace around each cell. */
  trim?: boolean;
}

export const DELIMITERS = [
  { value: ',', label: 'Comma', short: ',' },
  { value: ';', label: 'Semicolon', short: ';' },
  { value: '\t', label: 'Tab', short: 'Tab' },
  { value: '|', label: 'Pipe', short: '|' },
] as const;

export function delimiterName(delimiter: string): string {
  const known = DELIMITERS.find((d) => d.value === delimiter);
  if (known) return known.label;
  if (delimiter === ' ') return 'Space';
  return `“${delimiter}”`;
}

/** Remove a UTF-8 byte order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Spreadsheet-style column name for index 0 → "Column 1". */
export function defaultColumnName(index: number): string {
  return `Column ${index + 1}`;
}

/** Map Papa Parse's error codes to plain sentences. */
export function describePapaError(error: Papa.ParseError, rowOffset = 0): ParseIssue | null {
  const row = typeof error.row === 'number' ? error.row + rowOffset + 1 : null;
  switch (error.code) {
    case 'UndetectableDelimiter':
      return null; // Single-column input is perfectly valid.
    case 'MissingQuotes':
      return { row, message: 'A quoted field is never closed, so the rest of the file was read as one cell.' };
    case 'InvalidQuotes':
      return { row, message: 'A field contains a stray quote character. It was kept as literal text.' };
    case 'TooFewFields':
    case 'TooManyFields':
      return null; // Reported through `raggedRows`.
    default:
      return { row, message: error.message };
  }
}

/**
 * Turn raw records into a rectangular table. Short rows are padded with empty
 * strings; if the header is shorter than the widest record, generated names
 * are appended.
 */
export function buildTable(records: string[][], header: boolean): { table: Table; raggedRows: number } {
  let width = 0;
  for (const r of records) if (r.length > width) width = r.length;
  const headerRow = header && records.length ? records[0] : null;
  const data = header ? records.slice(1) : records;
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    const name = headerRow?.[i];
    headers.push(name !== undefined ? name : defaultColumnName(i));
  }
  let raggedRows = 0;
  const rows = data.map((r) => {
    if (r.length === width) return r;
    raggedRows++;
    const padded = r.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
  return { table: { headers, rows }, raggedRows };
}

/** Parse CSV/TSV/DSV text. Handles quoted fields, embedded newlines, CRLF and a BOM. */
export function parseCsv(input: string, options: ParseCsvOptions = {}): ParsedCsv {
  const text = stripBom(input);
  const { delimiter = '', header = true, skipEmptyLines = true, trim = false } = options;
  if (!text.trim()) {
    return { table: { headers: [], rows: [] }, delimiter: delimiter || ',', linebreak: '\n', issues: [], raggedRows: 0 };
  }
  const result = Papa.parse<string[]>(text, {
    delimiter,
    header: false,
    skipEmptyLines: skipEmptyLines ? 'greedy' : false,
    transform: trim ? (value: string) => value.trim() : undefined,
  });
  const issues = result.errors.map((e) => describePapaError(e)).filter((e): e is ParseIssue => e !== null);
  const { table, raggedRows } = buildTable(result.data, header);
  return { table, delimiter: result.meta.delimiter, linebreak: result.meta.linebreak || '\n', issues, raggedRows };
}

/** Guess the delimiter of some text (comma, semicolon, tab or pipe). Falls back to comma. */
export function detectDelimiter(input: string): string {
  const text = stripBom(input);
  if (!text.trim()) return ',';
  const sample = text.length > 64_000 ? text.slice(0, 64_000) : text;
  const result = Papa.parse<string[]>(sample, { delimiter: '', preview: 50, skipEmptyLines: 'greedy' });
  return result.meta.delimiter || ',';
}

export type QuoteMode = 'minimal' | 'all' | 'nonnumeric' | 'none';

export interface WriteOptions {
  delimiter?: string;
  quoteChar?: string;
  quote?: QuoteMode;
  newline?: '\n' | '\r\n';
  includeHeader?: boolean;
  /** Prefix cells that start with = + - @ (or tab/CR) with an apostrophe, so spreadsheets do not run them as formulas. */
  escapeFormulae?: boolean;
  /** Start the output with a UTF-8 BOM (helps Excel detect UTF-8). */
  bom?: boolean;
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function isNumeric(value: string): boolean {
  return NUMERIC.test(value);
}

/**
 * True for a cell a spreadsheet app would run as a formula when it opens the CSV
 * (it starts with = + - @, a tab or a carriage return and is not a plain number).
 */
export function looksLikeFormula(value: string): boolean {
  return FORMULA_START.test(value) && !isNumeric(value);
}

/** Number of cells (and header names, when written) that spreadsheets would treat as formulas. */
export function countFormulaCells(table: Table, includeHeader = true): number {
  let n = 0;
  if (includeHeader) for (const h of table.headers) if (looksLikeFormula(h)) n++;
  for (const row of table.rows) for (const cell of row) if (cell && looksLikeFormula(cell)) n++;
  return n;
}

/** Serialize a single field. */
export function formatField(
  value: string,
  options: Required<Pick<WriteOptions, 'delimiter' | 'quoteChar' | 'quote' | 'escapeFormulae'>>,
): string {
  let v = value;
  if (options.escapeFormulae && looksLikeFormula(v)) v = `'${v}`;
  const q = options.quoteChar;
  const needs = v.includes(options.delimiter) || v.includes(q) || v.includes('\n') || v.includes('\r') || /^\s|\s$/.test(v);
  let quote: boolean;
  switch (options.quote) {
    case 'all':
      quote = true;
      break;
    case 'nonnumeric':
      quote = needs || !isNumeric(v);
      break;
    case 'none':
      quote = false;
      break;
    default:
      quote = needs;
  }
  if (!quote) return v;
  return q + v.split(q).join(q + q) + q;
}

/** Serialize a table to delimited text. */
export function writeCsv(table: Table, options: WriteOptions = {}): string {
  const opts = {
    delimiter: options.delimiter ?? ',',
    quoteChar: options.quoteChar ?? '"',
    quote: options.quote ?? 'minimal',
    escapeFormulae: options.escapeFormulae ?? false,
  };
  const newline = options.newline ?? '\n';
  const lines: string[] = [];
  const line = (cells: string[]) => cells.map((c) => formatField(c ?? '', opts)).join(opts.delimiter);
  if (options.includeHeader ?? true) lines.push(line(table.headers));
  for (const row of table.rows) lines.push(line(row));
  return (options.bom ? '\uFEFF' : '') + lines.join(newline);
}

/**
 * Number of cells that would make unquoted output ambiguous (they contain the
 * delimiter, a quote or a line break). Used to warn when quoting is off.
 */
export function countUnsafeUnquoted(table: Table, delimiter: string, quoteChar = '"', includeHeader = true): number {
  let n = 0;
  const check = (v: string) => {
    if (v.includes(delimiter) || v.includes(quoteChar) || v.includes('\n') || v.includes('\r')) n++;
  };
  if (includeHeader) table.headers.forEach(check);
  for (const row of table.rows) row.forEach(check);
  return n;
}

/** Make column names unique and non-empty (for use as object keys). */
export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  return headers.map((raw, i) => {
    let name = raw.trim() ? raw : `column_${i + 1}`;
    if (taken.has(name)) {
      let n = seen.get(name) ?? 1;
      let candidate: string;
      do {
        n++;
        candidate = `${name}_${n}`;
      } while (taken.has(candidate));
      seen.set(name, n);
      name = candidate;
    }
    taken.add(name);
    return name;
  });
}

/** Parse a user-typed delimiter: supports "\t", "tab", "space" and single characters. */
export function normalizeCustomDelimiter(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (raw === '\\t' || lower === 'tab') return '\t';
  if (lower === 'space' || raw === ' ') return ' ';
  return raw;
}

export function validateDelimiter(delimiter: string, quoteChar = '"'): string | null {
  if (!delimiter) return 'Enter a delimiter.';
  if (delimiter.includes('\n') || delimiter.includes('\r')) return 'The delimiter cannot contain a line break.';
  if (delimiter.includes(quoteChar)) return 'The delimiter cannot contain the quote character.';
  return null;
}
