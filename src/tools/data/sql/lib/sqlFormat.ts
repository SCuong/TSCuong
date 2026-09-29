import type { FormatOptionsWithLanguage, SqlLanguage } from 'sql-formatter';
import type { SqlDialect } from './dialects';

export type CaseOption = 'preserve' | 'upper' | 'lower';
export type SqlIndent = '2' | '4' | 'tab';
export type IndentStyle = 'standard' | 'tabularLeft' | 'tabularRight';

export interface SqlFormatSettings {
  dialect: SqlDialect;
  keywordCase: CaseOption;
  functionCase: CaseOption;
  dataTypeCase: CaseOption;
  indent: SqlIndent;
  /** Blank lines between statements (0–5). */
  linesBetweenQueries: number;
  indentStyle: IndentStyle;
  /** Put AND/OR at the start of the line ("before") or at the end ("after"). */
  logicalOperatorNewline: 'before' | 'after';
  denseOperators: boolean;
  newlineBeforeSemicolon: boolean;
  /** Maximum width of parenthesized expressions kept on one line. */
  expressionWidth: number;
  /** Treat Jinja/dbt templates ({{ }}, {% %}, {# #}) as opaque placeholders. */
  templates: boolean;
}

export const DEFAULT_FORMAT_SETTINGS: SqlFormatSettings = {
  dialect: 'sql',
  keywordCase: 'upper',
  functionCase: 'preserve',
  dataTypeCase: 'preserve',
  indent: '2',
  linesBetweenQueries: 1,
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  denseOperators: false,
  newlineBeforeSemicolon: false,
  expressionWidth: 50,
  templates: false,
};

const TEMPLATE_PARAMS = [String.raw`\{\{[\s\S]*?\}\}`, String.raw`\{%[\s\S]*?%\}`, String.raw`\{#[\s\S]*?#\}`];

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Map UI settings to sql-formatter options. */
export function toFormatOptions(settings: SqlFormatSettings): FormatOptionsWithLanguage {
  return {
    language: settings.dialect as SqlLanguage,
    tabWidth: settings.indent === '4' ? 4 : 2,
    useTabs: settings.indent === 'tab',
    keywordCase: settings.keywordCase,
    functionCase: settings.functionCase,
    dataTypeCase: settings.dataTypeCase,
    indentStyle: settings.indentStyle,
    logicalOperatorNewline: settings.logicalOperatorNewline,
    linesBetweenQueries: clamp(settings.linesBetweenQueries, 0, 5, 1),
    denseOperators: settings.denseOperators,
    newlineBeforeSemicolon: settings.newlineBeforeSemicolon,
    expressionWidth: clamp(settings.expressionWidth, 10, 200, 50),
    ...(settings.templates ? { paramTypes: { custom: TEMPLATE_PARAMS.map((regex) => ({ regex })) } } : {}),
  };
}

export interface SqlFormatError {
  message: string;
  line?: number;
  column?: number;
}

/** Turn sql-formatter's parser dump into one readable sentence with a position. */
export function describeFormatError(error: unknown, dialect: SqlDialect): SqlFormatError {
  const raw = error instanceof Error ? error.message : String(error);
  const first = raw.split('\n')[0] ?? raw;
  const pos = /at line (\d+) column (\d+)/i.exec(first);
  const line = pos ? Number(pos[1]) : undefined;
  const column = pos ? Number(pos[2]) : undefined;
  let message: string;
  const unexpected = /^Parse error: Unexpected "([\s\S]*?)" at line/.exec(first);
  const token = /^Parse error at token: (.*?) at line/.exec(first);
  if (unexpected) {
    message = `Could not parse the SQL near “${unexpected[1].trim()}”`;
  } else if (token) {
    message = token[1].includes('EOF') ? 'The SQL ends too early (an unclosed parenthesis or unfinished clause?)' : `Could not parse the SQL near “${token[1].trim()}”`;
  } else {
    message = first.replace(/^Error:\s*/, '').replace(/\.$/, '') || 'Could not format this SQL';
  }
  if (dialect === 'sql' && /likely happens because you're using the default "sql" dialect/.test(raw)) {
    message += '. Choosing the specific SQL dialect may fix this';
  }
  return { message, line, column };
}

export type FormatFn = (query: string, options: FormatOptionsWithLanguage) => string;

export function formatSql(format: FormatFn, input: string, settings: SqlFormatSettings): { ok: true; value: string } | { ok: false; error: SqlFormatError } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  try {
    const value = format(text, toFormatOptions(settings));
    return { ok: true, value: value.endsWith('\n') ? value : `${value}\n` };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: { message: 'The SQL is nested too deeply to format.' } };
    return { ok: false, error: describeFormatError(error, settings.dialect) };
  }
}
