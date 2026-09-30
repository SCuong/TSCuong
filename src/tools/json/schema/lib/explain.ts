import { ucs2length, type OutputUnit, type Schema, type SchemaDraft } from '@cfworker/json-schema';
import { escapeToken, fromLocation, lastToken, parsePointer, valueAt } from './pointer';
import { isPlainObject, walkSchema } from './walk';
import { t } from '@/lib/i18n';

/** A validation error explained for people. */
export interface Issue {
  /** JSON Pointer of the offending value in the document ("" is the root). */
  instancePath: string;
  /** The schema keyword that failed (e.g. "type", "required"). */
  keyword: string;
  message: string;
  /** JSON Pointer of the keyword inside the schema document, when it can be resolved. */
  schemaPointer: string | null;
  /** Highlight the property name instead of the value (e.g. a property that is not allowed). */
  target: 'value' | 'key';
  /** Why each branch of an anyOf / oneOf failed. */
  details?: Array<{ label: string; issues: Issue[] }>;
}

interface Node {
  unit: OutputUnit;
  children: Node[];
}

/** Keywords whose errors are followed by the errors of their subschemas. */
const APPLICATORS = new Set([
  'properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties', 'items', 'prefixItems',
  'additionalItems', 'unevaluatedItems', 'contains', 'propertyNames', 'dependentSchemas', 'dependencies', '$ref',
  '$recursiveRef', 'allOf', 'anyOf', 'oneOf', 'if', 'not',
]);
/** Wrapper errors that only say "a subschema failed": their children are shown instead. */
const HOIST = new Set([
  'properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties', 'items', 'prefixItems',
  'additionalItems', 'unevaluatedItems', 'dependentSchemas', 'dependencies', '$ref', '$recursiveRef', 'allOf', 'if',
]);
const PROPERTY_WRAPPERS = new Set(['properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties']);
const ITEM_WRAPPERS = new Set(['items', 'prefixItems', 'additionalItems', 'unevaluatedItems']);

function isDescendant(child: OutputUnit, parent: OutputUnit): boolean {
  if (!APPLICATORS.has(parent.keyword)) return false;
  const pil = parent.instanceLocation;
  const cil = child.instanceLocation;
  if (cil !== pil && !cil.startsWith(`${pil}/`)) return false;
  // The engine reports a `false` subschema's location as the instance location, so trust nesting.
  if (child.keyword === 'false') return true;
  if (parent.keyword === 'if') {
    const base = parent.keywordLocation.slice(0, -'/if'.length);
    return child.keywordLocation.startsWith(`${base}/then/`) || child.keywordLocation.startsWith(`${base}/else/`);
  }
  return child.keywordLocation.startsWith(`${parent.keywordLocation}/`);
}

/** Rebuilds the error tree from the engine's flat, depth-first error list. */
export function buildErrorTree(units: OutputUnit[]): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const unit of units) {
    const node: Node = { unit, children: [] };
    while (stack.length && !isDescendant(unit, stack[stack.length - 1].unit)) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

// --- message helpers ------------------------------------------------------------

export function preview(value: unknown, max = 60): string {
  let s: string;
  try {
    s = JSON.stringify(value) ?? String(value);
  } catch {
    s = String(value);
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function describeInstance(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return `the string ${preview(value, 40)}`;
  if (typeof value === 'number') return Number.isInteger(value) ? `the integer ${value}` : `the number ${value}`;
  return `the boolean ${String(value)}`;
}

function orList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const FORMAT_NOUNS: Record<string, string> = {
  'date-time': 'date-time (RFC 3339, e.g. 2024-01-31T09:30:00Z)',
  date: 'date (YYYY-MM-DD)',
  time: 'time (HH:MM:SS)',
  duration: 'ISO 8601 duration (e.g. P3DT4H)',
  email: 'email address',
  hostname: 'hostname',
  ipv4: 'IPv4 address',
  ipv6: 'IPv6 address',
  uri: 'absolute URI',
  'uri-reference': 'URI reference',
  'uri-template': 'URI template',
  url: 'URL',
  uuid: 'UUID',
  regex: 'regular expression',
  'json-pointer': 'JSON Pointer',
  'json-pointer-uri-fragment': 'JSON Pointer URI fragment',
  'relative-json-pointer': 'relative JSON Pointer',
};

/** Cleans an engine message for display when no better wording is available. */
function cleanMessage(error: string): string {
  const first = error.split('\n')[0].replace(/\s{2,}/g, ' ').trim();
  return first.replace(/^Instance /, 'Value ');
}

// --- keyword locations -------------------------------------------------------------

export interface SchemaIndex {
  root: unknown;
  lookup: Record<string, Schema | boolean>;
  /** Static pointer of every subschema object. */
  pointers: Map<object, string>;
}

export function indexSchema(root: unknown, lookup: Record<string, Schema | boolean>): SchemaIndex {
  const pointers = new Map<object, string>();
  walkSchema(root, ({ value, pointer }) => {
    if (isPlainObject(value) && !pointers.has(value)) pointers.set(value, pointer);
  });
  return { root, lookup, pointers };
}

/**
 * Follows an engine keyword location (which runs through `$ref`s) to the keyword's
 * value and its static pointer in the schema document.
 */
export function resolveKeyword(index: SchemaIndex, keywordLocation: string): { value: unknown; pointer: string } | null {
  const tokens = parsePointer(fromLocation(keywordLocation));
  let cur: unknown = index.root;
  let pointer = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if ((token === '$ref' || token === '$recursiveRef') && isPlainObject(cur) && i < tokens.length - 1) {
      const target =
        token === '$ref' ? index.lookup[(cur as { __absolute_ref__?: string }).__absolute_ref__ ?? String(cur.$ref)] : index.root;
      if (!target || typeof target !== 'object') return null;
      const targetPointer = index.pointers.get(target);
      if (targetPointer === undefined) return null;
      cur = target;
      pointer = targetPointer;
      continue;
    }
    if (Array.isArray(cur)) {
      cur = cur[Number(token)];
    } else if (isPlainObject(cur) && Object.prototype.hasOwnProperty.call(cur, token)) {
      cur = cur[token];
    } else return null;
    if (cur === undefined) return null;
    pointer += `/${escapeToken(token)}`;
  }
  return { value: cur, pointer };
}

// --- explanation ------------------------------------------------------------------------

interface Context {
  instance: unknown;
  index: SchemaIndex;
  draft: SchemaDraft;
  /** Inside propertyNames the checked value is the property name, not the property's value. */
  nameCheck?: { path: string; name: string };
}

function issue(unit: OutputUnit, ctx: Context, message: string, extra: Partial<Issue> = {}): Issue {
  return {
    instancePath: fromLocation(unit.instanceLocation),
    keyword: unit.keyword,
    message,
    schemaPointer: resolveKeyword(ctx.index, unit.keywordLocation)?.pointer ?? null,
    target: 'value',
    ...extra,
  };
}

function explainUnit(unit: OutputUnit, ctx: Context, node: Node): Issue {
  const path = fromLocation(unit.instanceLocation);
  const value = ctx.nameCheck && ctx.nameCheck.path === path ? ctx.nameCheck.name : valueAt(ctx.instance, path);
  const kw = resolveKeyword(ctx.index, unit.keywordLocation)?.value;
  const num = typeof kw === 'number' ? kw : undefined;
  switch (unit.keyword) {
    case 'type': {
      const expected = Array.isArray(kw) ? kw.map(String) : typeof kw === 'string' ? [kw] : [];
      if (!expected.length) break;
      return issue(unit, ctx, `Expected ${orList(expected)}, but found ${describeInstance(value)}.`);
    }
    case 'required': {
      const name = /required property "([\s\S]*)"\.$/.exec(unit.error)?.[1];
      if (name === undefined) break;
      return issue(unit, ctx, `Missing required property "${name}".`);
    }
    case 'const':
      if (kw === undefined) break;
      return issue(unit, ctx, `Must be exactly ${preview(kw)}, but found ${preview(value)}.`);
    case 'enum': {
      if (!Array.isArray(kw)) break;
      const shown = kw.slice(0, 8).map((v) => preview(v, 30));
      const more = kw.length > 8 ? ` and ${kw.length - 8} more` : '';
      return issue(unit, ctx, `${preview(value, 40)} is not one of the allowed values: ${shown.join(', ')}${more}.`);
    }
    case 'format': {
      if (typeof kw !== 'string') break;
      return issue(unit, ctx, `${preview(value, 50)} is not a valid ${FORMAT_NOUNS[kw] ?? `"${kw}"`}.`);
    }
    case 'pattern':
      if (typeof kw !== 'string') break;
      return issue(unit, ctx, `${preview(value, 50)} does not match the pattern /${kw}/.`);
    case 'minLength':
    case 'maxLength': {
      if (num === undefined || typeof value !== 'string') break;
      const length = ucs2length(value);
      const bound = unit.keyword === 'minLength' ? 'at least' : 'at most';
      return issue(unit, ctx, `Must be ${bound} ${plural(num, 'character')} long, but has ${length}.`);
    }
    case 'minimum':
    case 'maximum': {
      if (num === undefined) break;
      const lower = unit.keyword === 'minimum';
      const exclusive = ctx.draft === '4' && /or equal to/.test(unit.error);
      const rule = exclusive ? (lower ? 'greater than' : 'less than') : lower ? 'at least' : 'at most';
      return issue(unit, ctx, `Must be ${rule} ${num}, but is ${preview(value)}.`);
    }
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      if (num === undefined) break;
      return issue(unit, ctx, `Must be ${unit.keyword === 'exclusiveMinimum' ? 'greater' : 'less'} than ${num}, but is ${preview(value)}.`);
    case 'multipleOf':
      if (num === undefined) break;
      return issue(unit, ctx, `Must be a multiple of ${num}, but is ${preview(value)}.`);
    case 'minItems':
    case 'maxItems': {
      if (num === undefined || !Array.isArray(value)) break;
      const bound = unit.keyword === 'minItems' ? 'at least' : 'at most';
      return issue(unit, ctx, `Must have ${bound} ${plural(num, 'item')}, but has ${value.length}.`);
    }
    case 'minProperties':
    case 'maxProperties': {
      if (num === undefined || !isPlainObject(value)) break;
      const bound = unit.keyword === 'minProperties' ? 'at least' : 'at most';
      return issue(unit, ctx, `Must have ${bound} ${plural(num, 'property', 'properties')}, but has ${Object.keys(value).length}.`);
    }
    case 'uniqueItems': {
      const m = /indexes (\d+) and (\d+)/.exec(unit.error);
      if (!m) break;
      return issue(unit, ctx, `Items must be unique, but items ${m[1]} and ${m[2]} are equal.`);
    }
    case 'dependentRequired':
    case 'dependencies': {
      const m = /has "([\s\S]*)" but does not have "([\s\S]*)"\.$/.exec(unit.error);
      if (!m) break;
      return issue(unit, ctx, `Property "${m[2]}" is required when "${m[1]}" is present.`);
    }
    case 'contains':
      return issue(
        unit,
        ctx,
        Array.isArray(value) && value.length === 0
          ? 'The array is empty, but it must contain an item matching the "contains" schema.'
          : 'No item matches the "contains" schema.',
      );
    case 'not':
      return issue(unit, ctx, 'Must not match the "not" schema, but it does.');
    case 'anyOf': {
      const count = Array.isArray(kw) ? kw.length : undefined;
      const schemas = count === undefined ? 'allowed schemas' : `${count} allowed schemas`;
      return issue(unit, ctx, `Does not match any of the ${schemas} (anyOf).`, {
        details: branchDetails(node, ctx),
      });
    }
    case 'oneOf': {
      const count = Array.isArray(kw) ? kw.length : 0;
      const matches = Number(/\((\d+) matches\)/.exec(unit.error)?.[1] ?? 0);
      if (matches === 0) {
        return issue(unit, ctx, `Does not match any of the ${count} options; exactly one must match (oneOf).`, { details: branchDetails(node, ctx) });
      }
      const failed = new Set(branchGroups(node).keys());
      const matched = Array.from({ length: count }, (_, i) => i).filter((i) => !failed.has(i));
      const which = matched.length === matches ? ` (options ${matched.map((i) => i + 1).join(' and ')})` : '';
      return issue(unit, ctx, `Matches ${matches} of the options${which}, but exactly one must match (oneOf).`);
    }
    case 'propertyNames': {
      const name = /Property name "([\s\S]*)" does not match/.exec(unit.error)?.[1];
      if (name === undefined) break;
      const namePath = `${path}/${escapeToken(name)}`;
      const detail = node.children.length ? flatten(node.children, { ...ctx, nameCheck: { path: namePath, name } }, node.unit) : [];
      return {
        ...issue(unit, ctx, `Property name "${name}" is not allowed${detail[0] ? `: ${lowerFirst(detail[0].message)}` : '.'}`),
        instancePath: namePath,
        target: 'key',
      };
    }
  }
  return issue(unit, ctx, cleanMessage(unit.error));
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Children of an anyOf/oneOf error grouped by branch index. */
function branchGroups(node: Node): Map<number, Node[]> {
  const base = `${node.unit.keywordLocation}/`;
  const groups = new Map<number, Node[]>();
  for (const child of node.children) {
    const index = child.unit.keywordLocation.startsWith(base) ? parseInt(child.unit.keywordLocation.slice(base.length), 10) : NaN;
    const key = Number.isNaN(index) ? -1 : index;
    groups.set(key, [...(groups.get(key) ?? []), child]);
  }
  return groups;
}

function branchDetails(node: Node, ctx: Context): Issue['details'] {
  const details = [...branchGroups(node).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, children]) => ({
      label: index >= 0 ? t('Option {index}', { index: index + 1 }) : t('Another option'),
      issues: flatten(children, ctx, node.unit),
    }))
    .filter((d) => d.issues.length);
  return details.length ? details : undefined;
}

function falseSchemaIssue(unit: OutputUnit, parent: OutputUnit | null, ctx: Context): Issue {
  const path = fromLocation(unit.instanceLocation);
  const wrapper = parent?.keyword ?? '';
  const base = parent ?? unit;
  const schemaPointer = parent ? (resolveKeyword(ctx.index, parent.keywordLocation)?.pointer ?? null) : '';
  if (PROPERTY_WRAPPERS.has(wrapper)) {
    return { instancePath: path, keyword: wrapper, message: `Property "${lastToken(path)}" is not allowed.`, schemaPointer, target: 'key' };
  }
  if (ITEM_WRAPPERS.has(wrapper)) {
    return { instancePath: path, keyword: wrapper, message: `Item ${lastToken(path)} is not allowed here (the array has too many items).`, schemaPointer, target: 'value' };
  }
  return {
    instancePath: path,
    keyword: base === unit ? 'false' : wrapper,
    message: 'No value is allowed here (the schema is false).',
    schemaPointer,
    target: 'value',
  };
}

/**
 * The engine only marks a property as evaluated when it passes its schema, so a
 * declared property that fails (say, a bad email) is also reported by
 * `additionalProperties` / `unevaluatedProperties`. Per the spec those keywords
 * only concern properties not covered by `properties` / `patternProperties`.
 */
function isSpuriousAdditional(unit: OutputUnit, ctx: Context): boolean {
  if (unit.keyword !== 'additionalProperties' && unit.keyword !== 'unevaluatedProperties') return false;
  const name = /^Property "([\s\S]*)" does not match/.exec(unit.error)?.[1];
  if (name === undefined) return false;
  const owner = resolveKeyword(ctx.index, unit.keywordLocation.slice(0, -unit.keyword.length - 1))?.value;
  if (!isPlainObject(owner)) return false;
  if (isPlainObject(owner.properties) && Object.prototype.hasOwnProperty.call(owner.properties, name)) return true;
  if (isPlainObject(owner.patternProperties)) {
    for (const pattern of Object.keys(owner.patternProperties)) {
      try {
        if (new RegExp(pattern, 'u').test(name)) return true;
      } catch {
        // Invalid patterns are reported by the schema checks.
      }
    }
  }
  return false;
}

function flatten(nodes: Node[], ctx: Context, parent: OutputUnit | null): Issue[] {
  const out: Issue[] = [];
  for (const node of nodes) {
    const unit = node.unit;
    if (isSpuriousAdditional(unit, ctx)) continue;
    if (unit.keyword === 'false') {
      out.push(falseSchemaIssue(unit, parent, ctx));
      continue;
    }
    if (HOIST.has(unit.keyword) && node.children.length) {
      out.push(...flatten(node.children, ctx, unit));
      continue;
    }
    out.push(explainUnit(unit, ctx, node));
  }
  return out;
}

/**
 * Explains the engine's errors: wrapper errors are replaced by the errors they
 * contain, anyOf/oneOf failures carry per-option details, duplicates are removed.
 */
export function explainErrors(units: OutputUnit[], instance: unknown, index: SchemaIndex, draft: SchemaDraft): Issue[] {
  const issues = flatten(buildErrorTree(units), { instance, index, draft }, null);
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.instancePath}\u0000${i.keyword}\u0000${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
