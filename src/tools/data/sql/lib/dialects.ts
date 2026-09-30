import { t } from '@/lib/i18n';
/** SQL dialects, named like sql-formatter's `language` option. */
export type SqlDialect =
  | 'sql'
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'sqlite'
  | 'transactsql'
  | 'plsql'
  | 'bigquery'
  | 'snowflake'
  | 'redshift'
  | 'spark'
  | 'hive'
  | 'trino'
  | 'duckdb'
  | 'clickhouse'
  | 'db2'
  | 'db2i'
  | 'n1ql'
  | 'singlestoredb'
  | 'tidb';

/** Lexical rules the minifier needs to find strings, identifiers and comments correctly. */
export interface LexFeatures {
  /** Backslash escapes a quote inside '…' strings (MySQL, BigQuery, Spark…). */
  backslashEscapes: boolean;
  /** "…" is a string literal rather than a quoted identifier. */
  doubleQuoteStrings: boolean;
  /** Backslash escapes a quote inside "…" (strings in MySQL, identifiers in ClickHouse). */
  doubleQuoteBackslash: boolean;
  /** [identifier] quoting (SQL Server, SQLite). Elsewhere [ ] are array brackets. */
  bracketIdentifiers: boolean;
  /** $$…$$ bodies: 'tagged' also allows $tag$…$tag$. */
  dollarQuotes: 'none' | 'plain' | 'tagged';
  /** # starts a line comment. */
  hashComments: boolean;
  /** // starts a line comment (Snowflake). */
  slashComments: boolean;
  /** Block comments nest: /* a /* b *\/ still a comment *\/. */
  nestedComments: boolean;
  /** "--" only starts a comment when followed by whitespace (MySQL family). */
  dashNeedsSpace: boolean;
  /** '''…''' and """…""" strings (BigQuery). */
  tripleQuotes: boolean;
  /** Oracle q'[…]' alternative quoting. */
  qQuotes: boolean;
  /** E'…' strings with backslash escapes (PostgreSQL, DuckDB). */
  eStrings: boolean;
  /** Client commands that must stay on their own line. */
  directives: 'none' | 'go' | 'slash' | 'delimiter' | 'psql';
}

export interface DialectInfo {
  id: SqlDialect;
  label: string;
  lex: LexFeatures;
}

const BASE: LexFeatures = {
  backslashEscapes: false,
  doubleQuoteStrings: false,
  doubleQuoteBackslash: false,
  bracketIdentifiers: false,
  dollarQuotes: 'none',
  hashComments: false,
  slashComments: false,
  nestedComments: false,
  dashNeedsSpace: false,
  tripleQuotes: false,
  qQuotes: false,
  eStrings: false,
  directives: 'none',
};

const MYSQL: LexFeatures = {
  ...BASE,
  backslashEscapes: true,
  doubleQuoteStrings: true,
  doubleQuoteBackslash: true,
  hashComments: true,
  dashNeedsSpace: true,
  directives: 'delimiter',
};

export const DIALECTS: DialectInfo[] = [
  { id: 'sql', label: t('Standard SQL'), lex: { ...BASE, nestedComments: true, dollarQuotes: 'tagged' } },
  { id: 'postgresql', label: t('PostgreSQL'), lex: { ...BASE, nestedComments: true, dollarQuotes: 'tagged', eStrings: true, directives: 'psql' } },
  { id: 'mysql', label: t('MySQL'), lex: MYSQL },
  { id: 'mariadb', label: t('MariaDB'), lex: MYSQL },
  { id: 'sqlite', label: t('SQLite'), lex: { ...BASE, bracketIdentifiers: true } },
  { id: 'transactsql', label: t('SQL Server (T-SQL)'), lex: { ...BASE, bracketIdentifiers: true, nestedComments: true, directives: 'go' } },
  { id: 'plsql', label: t('Oracle PL/SQL'), lex: { ...BASE, qQuotes: true, directives: 'slash' } },
  {
    id: 'bigquery',
    label: t('Google BigQuery'),
    lex: { ...BASE, backslashEscapes: true, doubleQuoteStrings: true, doubleQuoteBackslash: true, hashComments: true, tripleQuotes: true },
  },
  { id: 'snowflake', label: t('Snowflake'), lex: { ...BASE, backslashEscapes: true, dollarQuotes: 'plain', slashComments: true } },
  { id: 'redshift', label: t('Amazon Redshift'), lex: { ...BASE, dollarQuotes: 'tagged' } },
  { id: 'spark', label: t('Spark SQL'), lex: { ...BASE, backslashEscapes: true, doubleQuoteStrings: true, doubleQuoteBackslash: true } },
  { id: 'hive', label: t('Apache Hive'), lex: { ...BASE, backslashEscapes: true, doubleQuoteStrings: true, doubleQuoteBackslash: true } },
  { id: 'trino', label: t('Trino / Presto'), lex: BASE },
  { id: 'duckdb', label: t('DuckDB'), lex: { ...BASE, nestedComments: true, dollarQuotes: 'tagged', eStrings: true } },
  {
    id: 'clickhouse',
    label: t('ClickHouse'),
    lex: { ...BASE, backslashEscapes: true, doubleQuoteBackslash: true, hashComments: true, dollarQuotes: 'tagged' },
  },
  { id: 'db2', label: t('IBM Db2'), lex: BASE },
  { id: 'db2i', label: t('IBM Db2 for i'), lex: { ...BASE, nestedComments: true } },
  {
    id: 'n1ql',
    label: t('Couchbase N1QL'),
    lex: { ...BASE, backslashEscapes: true, doubleQuoteStrings: true, doubleQuoteBackslash: true, hashComments: true },
  },
  { id: 'singlestoredb', label: t('SingleStoreDB'), lex: MYSQL },
  { id: 'tidb', label: t('TiDB'), lex: MYSQL },
];

const BY_ID = new Map(DIALECTS.map((d) => [d.id, d]));

export function dialectInfo(id: SqlDialect): DialectInfo {
  return BY_ID.get(id) ?? DIALECTS[0];
}

export function isSqlDialect(value: string): value is SqlDialect {
  return BY_ID.has(value as SqlDialect);
}
