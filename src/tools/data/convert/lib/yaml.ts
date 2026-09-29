import {
  Document,
  isAlias,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  Lexer,
  LineCounter,
  Pair,
  parseAllDocuments,
  Scalar,
  Schema,
  visit,
  YAMLMap,
  YAMLSeq,
  type ParseOptions,
  type DocumentOptions,
  type SchemaOptions,
  type ScalarTag,
  type CollectionTag,
  type YAMLError,
} from 'yaml';
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

export type YamlVersion = '1.1' | '1.2';
/** How several YAML documents in one stream become JSON. */
export type MultiDocMode = 'array' | 'first' | 'lines';

export interface YamlToJsonOptions {
  indent: IndentOption;
  /** Parse with YAML 1.1 rules (yes/no/on/off booleans, timestamps, sexagesimal numbers). */
  yaml11?: boolean;
  /** Default 'array'. */
  multiDoc?: MultiDocMode;
  /** Resolve AWS CloudFormation short tags (!Ref, !Sub, !GetAtt…) to their JSON form. Default true. */
  cloudFormation?: boolean;
}

export interface JsonToYamlOptions {
  indent: '2' | '4';
  sortKeys?: boolean;
  /** Write each item of a top-level array as its own YAML document (separated by ---). */
  splitDocuments?: boolean;
  /** Fold long strings at 80 columns instead of keeping them on one line. */
  foldLines?: boolean;
  /** Quote strings that YAML 1.1 parsers (e.g. PyYAML, older Kubernetes tooling) would read as non-strings. */
  quoteAmbiguous?: boolean;
  /** Write every string value in double quotes. */
  quoteAll?: boolean;
  /** Indent block sequences inside mappings (`key:\n  - a`). Default true. */
  indentSeq?: boolean;
}

/** A problem found in YAML input. Lines and columns are 1-based. */
export interface YamlDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
  column?: number;
  /** End of the marked range when known (exclusive column). */
  endLine?: number;
  endColumn?: number;
}

/** A plain value that YAML 1.1 and YAML 1.2 read differently (the "Norway problem"). */
export interface VersionDifference {
  text: string;
  line: number;
  column: number;
  /** Value under the version used for parsing. */
  current: unknown;
  /** Value under the other version. */
  other: unknown;
  /** The version the input was parsed with. */
  version: YamlVersion;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** First line of a yaml library error, without the "at line X, column Y" suffix and code frame. */
function cleanMessage(error: YAMLError): string {
  const first = error.message.split('\n')[0] ?? error.message;
  const text = first.replace(/ at line \d+, column \d+:?$/, '').trim();
  return capitalize(text);
}

const CFN_FUNCTIONS = [
  'And', 'Base64', 'Cidr', 'Equals', 'FindInMap', 'ForEach', 'GetAtt', 'GetAZs', 'If', 'ImportValue', 'Join',
  'Length', 'Not', 'Or', 'Select', 'Split', 'Sub', 'ToJsonString', 'Transform',
];

/** A one-entry mapping node wrapping a parsed collection, so aliases inside it still resolve. */
function singleKeyMap(key: string, value: YAMLMap | YAMLSeq): YAMLMap {
  const map = new YAMLMap();
  map.items.push(new Pair(new Scalar(key), value));
  return map;
}

/** Custom tags that turn CloudFormation short forms into the long JSON forms (`!Ref x` → `{"Ref": "x"}`). */
function cloudFormationTags(): Array<ScalarTag | CollectionTag> {
  const tags: Array<ScalarTag | CollectionTag> = [];
  const add = (short: string, key: string, scalar?: (s: string) => unknown) => {
    // Scalar tags must return a plain value (the parser wraps it in a Scalar node).
    tags.push({ tag: `!${short}`, resolve: (s: string) => ({ [key]: scalar ? scalar(s) : s }) });
    tags.push({ tag: `!${short}`, collection: 'seq', resolve: (seq) => singleKeyMap(key, seq) });
    tags.push({ tag: `!${short}`, collection: 'map', resolve: (map) => singleKeyMap(key, map) });
  };
  add('Ref', 'Ref');
  add('Condition', 'Condition');
  for (const fn of CFN_FUNCTIONS) {
    if (fn === 'GetAtt') {
      // `!GetAtt Resource.Attribute.Path` → ["Resource", "Attribute.Path"]
      add(fn, 'Fn::GetAtt', (s) => {
        const dot = s.indexOf('.');
        return dot === -1 ? [s] : [s.slice(0, dot), s.slice(dot + 1)];
      });
    } else {
      add(fn, `Fn::${fn}`);
    }
  }
  return tags;
}

let cfnTagCache: Array<ScalarTag | CollectionTag> | null = null;

function parseOptions(version: YamlVersion, cloudFormation: boolean, lineCounter?: LineCounter): ParseOptions & DocumentOptions & SchemaOptions {
  if (cloudFormation && !cfnTagCache) cfnTagCache = cloudFormationTags();
  return {
    version,
    intAsBigInt: true,
    uniqueKeys: true,
    merge: true,
    logLevel: 'error',
    prettyErrors: true,
    lineCounter,
    customTags: cloudFormation && cfnTagCache ? cfnTagCache : undefined,
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Convert YAML-specific JS values (Set, Map, binary) to JSON-compatible ones. */
function toPlain(value: unknown): unknown {
  // isView also recognizes Buffers and typed arrays from other realms.
  if (ArrayBuffer.isView(value)) return base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Date) return value;
  if (value instanceof Set) return [...value].map(toPlain);
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) setOwn(out, typeof k === 'string' ? k : JSON.stringify(k) ?? String(k), toPlain(v));
    return out;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) setOwn(out, k, toPlain(v));
    return out;
  }
  return value;
}

/** Number of comments in YAML source (JSON cannot keep them). */
export function countYamlComments(text: string): number {
  let n = 0;
  for (const token of new Lexer().lex(text)) if (token.charCodeAt(0) === 35 /* # */) n++;
  return n;
}

// ---------------------------------------------------------------------------
// YAML 1.1 vs 1.2
// ---------------------------------------------------------------------------

const schemas: Partial<Record<YamlVersion, Schema>> = {};
function schemaFor(version: YamlVersion): Schema {
  let s = schemas[version];
  if (!s) {
    s = new Schema({ schema: version === '1.1' ? 'yaml-1.1' : 'core', merge: true });
    schemas[version] = s;
  }
  return s;
}

/** Resolve a plain (unquoted) scalar the way a parser for `version` would. */
export function resolvePlainScalar(source: string, version: YamlVersion): unknown {
  const schema = schemaFor(version);
  for (const tag of schema.tags) {
    if (tag.default !== true || !('test' in tag) || !tag.test || !tag.test.test(source)) continue;
    try {
      const resolved = (tag as ScalarTag).resolve(source, () => undefined, { intAsBigInt: true });
      // Some tags (e.g. YAML 1.1 booleans) return a Scalar node rather than a bare value.
      return isScalar(resolved) ? resolved.value : resolved;
    } catch {
      return source;
    }
  }
  return source;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return `date:${Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString()}`;
  if (typeof value === 'bigint' || typeof value === 'number') return `num:${String(value)}`;
  if (value === null) return 'null';
  return `${typeof value}:${String(value)}`;
}

export function describeYamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return `the boolean ${value}`;
  if (typeof value === 'bigint' || typeof value === 'number') return `the number ${String(value)}`;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'an invalid timestamp' : `the timestamp ${value.toISOString().replace('T00:00:00.000Z', '')}`;
  }
  return `the string ${JSON.stringify(String(value))}`;
}

/**
 * Plain scalars whose meaning differs between YAML 1.1 and 1.2 (`no`, `on`, `0755`,
 * `1_000`, `12:30`, `2024-01-02`…). Keys are included (`on:` in GitHub Actions).
 */
export function findVersionDifferences(
  docs: Document.Parsed[],
  lineCounter: LineCounter,
  defaultVersion: YamlVersion,
  limit = 500,
): { items: VersionDifference[]; total: number } {
  const items: VersionDifference[] = [];
  let total = 0;
  for (const doc of docs) {
    // A %YAML directive overrides the default version for its document.
    const declared = doc.directives?.yaml.version;
    const version: YamlVersion = declared === '1.1' ? '1.1' : declared ? '1.2' : defaultVersion;
    const other: YamlVersion = version === '1.1' ? '1.2' : '1.1';
    visit(doc, {
      Scalar(_key, node) {
        if (node.type !== Scalar.PLAIN || node.tag) return;
        const source = node.source;
        if (typeof source !== 'string' || !source || source.length > 48 || source === '<<' || /[\n\r]/.test(source)) return;
        const a = resolvePlainScalar(source, version);
        const b = resolvePlainScalar(source, other);
        if (typeof a === 'string' && typeof b === 'string') return;
        if (canonical(a) === canonical(b)) return;
        total++;
        if (items.length >= limit || !node.range) return;
        const pos = lineCounter.linePos(node.range[0]);
        items.push({ text: source, line: pos.line, column: pos.col, current: a, other: b, version });
      },
    });
  }
  return { items, total };
}

export function describeDifference(d: VersionDifference): string {
  const where = `"${d.text}" (line ${d.line})`;
  if (d.version === '1.2') {
    return `${where} is ${describeYamlValue(d.current)} in YAML 1.2, but ${describeYamlValue(d.other)} for YAML 1.1 parsers such as PyYAML.`;
  }
  return `${where} is ${describeYamlValue(d.current)} in YAML 1.1, but ${describeYamlValue(d.other)} for YAML 1.2 parsers.`;
}

function differenceWarnings(result: { items: VersionDifference[]; total: number }, max = 5): string[] {
  if (!result.total) return [];
  const shown = result.items.slice(0, max).map(describeDifference);
  if (result.total > shown.length) shown.push(`…and ${plural(result.total - shown.length, 'more value')} read differently by YAML 1.1 and 1.2.`);
  return shown;
}

// ---------------------------------------------------------------------------
// YAML → JSON
// ---------------------------------------------------------------------------

export function yamlToJson(input: string, options: YamlToJsonOptions): ConvertResult {
  const text = normalizeInput(input);
  if (!text.trim()) return fail('Input is empty');
  const version: YamlVersion = options.yaml11 ? '1.1' : '1.2';
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, parseOptions(version, options.cloudFormation !== false, lineCounter));
  // parseAllDocuments returns an EmptyStream (array-like with length 0) for comment-only input.
  const list = Array.from(docs) as Document.Parsed[];
  if (list.length === 0) return ok('null', ['The input contains no YAML documents (only comments or whitespace).']);

  for (const doc of list) {
    const error = doc.errors[0];
    if (error) {
      const pos = error.linePos?.[0];
      return fail(cleanMessage(error), pos?.line, pos?.col);
    }
  }

  const warnings: string[] = [];
  for (const doc of list) {
    for (const w of doc.warnings) {
      const pos = w.linePos?.[0];
      warnings.push(`${cleanMessage(w)}${pos ? ` (line ${pos.line})` : ''}.`);
    }
  }
  warnings.push(...differenceWarnings(findVersionDifferences(list, lineCounter, version)));
  const comments = countYamlComments(text);
  if (comments) warnings.push(`${plural(comments, 'comment')} ${comments === 1 ? 'was' : 'were'} dropped, because JSON has no comments.`);

  const mode = options.multiDoc ?? 'array';
  const used = mode === 'first' ? list.slice(0, 1) : list;
  const values: unknown[] = [];
  try {
    for (const doc of used) values.push(toPlain(doc.toJS({ maxAliasCount: 1000 })));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/alias/i.test(message)) return fail('The document expands too many aliases (possible "billion laughs" input).');
    if (error instanceof RangeError) return fail('The YAML is nested too deeply to convert.');
    return fail(message);
  }
  const normalized = values.map((v) => (v === undefined ? null : v));

  if (mode === 'lines') {
    if (list.length > 1) warnings.unshift(`${list.length} YAML documents were written as ${list.length} lines of JSON (JSON Lines).`);
    return ok(normalized.map((v) => stringifyJsonLossless(v, 'min', warnings)).join('\n') + '\n', dedupe(warnings));
  }
  if (mode === 'first' && list.length > 1) warnings.unshift(`Only the first of ${list.length} YAML documents was converted.`);
  let value: unknown;
  if (normalized.length === 1) {
    value = normalized[0];
  } else {
    value = normalized;
    warnings.unshift(`${normalized.length} YAML documents were combined into one JSON array.`);
  }
  return ok(stringifyJsonLossless(value, options.indent, warnings), dedupe(warnings));
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// JSON → YAML
// ---------------------------------------------------------------------------

const YAML11_AMBIGUOUS = [
  /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|true|True|TRUE|false|False|FALSE)$/,
  /^(?:~|null|Null|NULL)$/,
  /^[-+]?0[0-7_]+$/, // YAML 1.1 octal
  /^[-+]?0b[01_]+$/,
  /^[-+]?0o[0-7]+$/, // YAML 1.2 octal
  /^[-+]?0x[0-9a-fA-F_]+$/,
  /^[-+]?[\d_]*\d[\d_]*$/, // integers with underscores
  /^[-+]?(?:\d[\d_]*)?\.[\d_]*(?:[eE][-+]?\d+)?$/,
  /^[-+]?(?:\d[\d_]*)?(?:\.[\d_]*)?[eE][-+]?\d+$/,
  /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?$/, // sexagesimal
  /^\d{4}-\d\d?-\d\d?(?:(?:[Tt]|[ \t]+)\d\d?:\d\d:\d\d(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?)?$/, // timestamp
  /^[-+]?\.(?:inf|Inf|INF)$/,
  /^\.(?:nan|NaN|NAN)$/,
  /^=$/,
  /^<<$/,
];

/** True for strings that some YAML parser (1.1 or 1.2) would read as a non-string when unquoted. */
export function isYaml11Ambiguous(value: string): boolean {
  return YAML11_AMBIGUOUS.some((re) => re.test(value));
}

function keyText(key: unknown): string {
  if (!isScalar(key)) return String(key);
  return typeof key.value === 'symbol' ? '<<' : String(key.value);
}

/** Key order for "sort keys": merge keys (<<) stay first, the rest alphabetical. */
function compareKeys(a: unknown, b: unknown): number {
  const x = keyText(a);
  const y = keyText(b);
  if (x === '<<' || y === '<<') return x === y ? 0 : x === '<<' ? -1 : 1;
  return x.localeCompare(y);
}

function renderDocument(value: unknown, options: JsonToYamlOptions): string {
  const doc = new Document(value, {
    sortMapEntries: options.sortKeys ? (a, b) => compareKeys(a.key, b.key) : false,
  });
  visit(doc, {
    Scalar(key, node) {
      if (typeof node.value !== 'string') return;
      if (options.quoteAll && key !== 'key') node.type = Scalar.QUOTE_DOUBLE;
      else if (options.quoteAmbiguous !== false && isYaml11Ambiguous(node.value)) node.type = Scalar.QUOTE_DOUBLE;
    },
  });
  return doc.toString({
    indent: Number(options.indent),
    indentSeq: options.indentSeq !== false,
    lineWidth: options.foldLines ? 80 : 0,
    minContentWidth: options.foldLines ? 20 : 0,
    flowCollectionPadding: false,
  });
}

export function jsonToYaml(input: string, options: JsonToYamlOptions): ConvertResult {
  if (!input.trim()) return fail('Input is empty');
  const parsed = readJsonLossless(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const warnings: string[] = parsed.lossy ? [LOSSY_INTEGER_WARNING] : [];
  try {
    return renderAll(parsed.value, options, warnings);
  } catch (error) {
    if (error instanceof RangeError) return fail('The JSON is nested too deeply to convert.');
    return fail(error instanceof Error ? error.message : 'Could not convert to YAML.');
  }
}

function renderAll(value: unknown, options: JsonToYamlOptions, warnings: string[]): ConvertResult {
  if (options.splitDocuments && Array.isArray(value)) {
    if (value.length === 0) {
      warnings.push('The top-level array is empty, so there are no documents to split.');
      return ok(renderDocument([], options), warnings);
    }
    const parts = value.map((item) => renderDocument(item, options));
    return ok(parts.map((p) => `---\n${p}`).join(''), warnings);
  }
  if (options.splitDocuments && !Array.isArray(value)) {
    warnings.push('Split into documents only applies when the top-level value is an array.');
  }
  return ok(renderDocument(value, options), warnings);
}

// ---------------------------------------------------------------------------
// Validation and formatting
// ---------------------------------------------------------------------------

export interface YamlStats {
  documents: number;
  mappings: number;
  sequences: number;
  keys: number;
  scalars: number;
  anchors: number;
  aliases: number;
  comments: number;
  maxDepth: number;
}

export interface YamlValidation {
  /** Number of documents in the stream. */
  documents: number;
  errors: YamlDiagnostic[];
  warnings: YamlDiagnostic[];
  differences: { items: VersionDifference[]; total: number };
  stats: YamlStats | null;
}

function toDiagnostic(error: YAMLError, severity: 'error' | 'warning'): YamlDiagnostic {
  const [start, end] = error.linePos ?? [];
  return {
    severity,
    message: cleanMessage(error),
    line: start?.line,
    column: start?.col,
    endLine: end?.line,
    endColumn: end?.col,
  };
}

function collectStats(docs: Document.Parsed[], text: string): YamlStats {
  const stats: YamlStats = { documents: docs.length, mappings: 0, sequences: 0, keys: 0, scalars: 0, anchors: 0, aliases: 0, comments: 0, maxDepth: 0 };
  const walk = (node: unknown, depth: number) => {
    if (!node) return;
    if (isAlias(node)) {
      stats.aliases++;
      return;
    }
    if (isNode(node) && node.anchor) stats.anchors++;
    if (isMap(node)) {
      stats.mappings++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      for (const pair of node.items) {
        stats.keys++;
        walk(pair.key, depth + 1);
        walk(pair.value, depth + 1);
      }
    } else if (isSeq(node)) {
      stats.sequences++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      for (const item of node.items) walk(item, depth + 1);
    } else if (isPair(node)) {
      walk(node.key, depth);
      walk(node.value, depth);
    } else if (isScalar(node)) {
      stats.scalars++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
    }
  };
  for (const doc of docs) walk(doc.contents, 1);
  stats.comments = countYamlComments(text);
  return stats;
}

/** Check YAML syntax, duplicate keys and version-dependent values; count what the stream contains. */
export function validateYaml(input: string, options: { version: YamlVersion; cloudFormation?: boolean }): YamlValidation {
  const text = normalizeInput(input);
  const lineCounter = new LineCounter();
  const docs = Array.from(parseAllDocuments(text, parseOptions(options.version, options.cloudFormation !== false, lineCounter))) as Document.Parsed[];
  const errors: YamlDiagnostic[] = [];
  const warnings: YamlDiagnostic[] = [];
  for (const doc of docs) {
    for (const e of doc.errors) errors.push(toDiagnostic(e, 'error'));
    for (const w of doc.warnings) warnings.push(toDiagnostic(w, 'warning'));
  }
  if (errors.length) {
    return { documents: docs.length, errors, warnings, differences: { items: [], total: 0 }, stats: null };
  }
  const differences = findVersionDifferences(docs, lineCounter, options.version);
  let stats: YamlStats | null;
  try {
    stats = collectStats(docs, text);
  } catch {
    // Only extremely deep documents can overflow the walker; the input itself is still valid.
    stats = null;
  }
  // Resolving aliases can still fail (alias bombs); report that as an error.
  for (const doc of docs) {
    try {
      doc.toJS({ maxAliasCount: 1000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        severity: 'error',
        message: /alias/i.test(message) ? 'The document expands too many aliases (possible "billion laughs" input).' : message,
      });
      break;
    }
  }
  return { documents: docs.length, errors, warnings, differences, stats };
}

export interface YamlFormatOptions {
  indent: '2' | '4';
  /** Indent block sequences inside mappings. Default true. */
  indentSeq?: boolean;
  sortKeys?: boolean;
  /** Fold long strings at 80 columns. */
  foldLines?: boolean;
  /** Rewrite flow collections ({a: 1}, [1, 2]) in block style. */
  blockStyle?: boolean;
  version: YamlVersion;
}

function sortMapsDeep(doc: Document.Parsed) {
  visit(doc, {
    Map(_key, node) {
      node.items.sort((a, b) => compareKeys(a.key, b.key));
    },
  });
}

/** Re-indent YAML while keeping comments, anchors, tags and scalar styles. */
export function formatYaml(input: string, options: YamlFormatOptions): ConvertResult {
  const text = normalizeInput(input);
  if (!text.trim()) return fail('Input is empty');
  // CloudFormation tags stay off here: resolving them would rewrite `!Ref x` into a mapping.
  const docs = Array.from(parseAllDocuments(text, parseOptions(options.version, false))) as Document.Parsed[];
  for (const doc of docs) {
    const error = doc.errors[0];
    if (error) {
      const pos = error.linePos?.[0];
      return fail(cleanMessage(error), pos?.line, pos?.col);
    }
  }
  if (docs.length === 0) return ok(text.trim() ? `${text.trim()}\n` : '');
  const parts: string[] = [];
  try {
    docs.forEach((doc, i) => {
      if (options.sortKeys) sortMapsDeep(doc);
      if (options.blockStyle) {
        visit(doc, {
          Map(_k, node) {
            node.flow = false;
          },
          Seq(_k, node) {
            node.flow = false;
          },
        });
      }
      // Every document after the first needs an explicit start marker.
      if (i > 0) doc.directives.docStart = true;
      parts.push(
        doc.toString({
          indent: Number(options.indent),
          indentSeq: options.indentSeq !== false,
          lineWidth: options.foldLines ? 80 : 0,
          minContentWidth: options.foldLines ? 20 : 0,
          flowCollectionPadding: false,
        }),
      );
    });
  } catch (error) {
    if (error instanceof RangeError) return fail('The YAML is nested too deeply to format.');
    return fail(error instanceof Error ? error.message : 'Could not format the YAML.');
  }
  return ok(parts.join(''));
}
