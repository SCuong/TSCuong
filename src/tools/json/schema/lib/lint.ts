import { dereference, format as FORMATS, type Schema, type SchemaDraft } from '@cfworker/json-schema';
import { isPlainObject, walkSchema } from './walk';

export interface SchemaProblem {
  /** JSON Pointer of the offending value inside the schema. */
  pointer: string;
  message: string;
  severity: 'error' | 'warning';
  /** Highlight the property name (e.g. unknown keywords) rather than the value. */
  target: 'value' | 'key';
}

export const BASE_URI = new URL('https://localkit.invalid/schema.json');

const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const KNOWN_FORMATS = new Set(Object.keys(FORMATS));

const KEYWORDS = [
  '$schema', '$id', 'id', '$ref', '$anchor', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor',
  '$vocabulary', '$comment', '$defs', 'definitions', 'title', 'description', 'default', 'examples', 'deprecated',
  'readOnly', 'writeOnly', 'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum',
  'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'items', 'prefixItems', 'additionalItems',
  'unevaluatedItems', 'contains', 'minContains', 'maxContains', 'maxItems', 'minItems', 'uniqueItems',
  'maxProperties', 'minProperties', 'required', 'properties', 'patternProperties', 'additionalProperties',
  'unevaluatedProperties', 'propertyNames', 'dependencies', 'dependentRequired', 'dependentSchemas', 'allOf',
  'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'format', 'contentEncoding', 'contentMediaType', 'contentSchema',
];
/** Common non-standard annotations (OpenAPI and friends) that are not typos. */
const EXTRA_ANNOTATIONS = ['nullable', 'discriminator', 'example', 'externalDocs', 'xml', 'markdownDescription', 'errorMessage'];
const KNOWN = new Set([...KEYWORDS, ...EXTRA_ANNOTATIONS]);
/** Keywords that do not validate, so their presence next to `$ref` is harmless in draft 4/7. */
const ANNOTATIONS = new Set(['$comment', 'title', 'description', 'default', 'examples', '$id', 'id', '$schema', '$defs', 'definitions', 'readOnly', 'writeOnly', 'deprecated']);

const NON_NEGATIVE_INTEGER = ['maxLength', 'minLength', 'maxItems', 'minItems', 'maxProperties', 'minProperties', 'minContains', 'maxContains'];

export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  return `${typeof value === 'number' ? 'the number' : 'the boolean'} ${String(value)}`;
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** The closest candidate when it is plausibly a typo of `word`. */
export function suggest(word: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  const lower = word.toLowerCase();
  for (const candidate of candidates) {
    if (candidate.toLowerCase() === lower) return candidate;
    const d = editDistance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  const limit = word.length >= 8 ? 3 : word.length >= 5 ? 2 : word.length >= 3 ? 1 : 0;
  return best !== null && bestDistance <= limit ? best : null;
}

function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern, 'u');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^Invalid regular expression: /, '') : 'invalid pattern';
  }
}

const isNonNegativeInteger = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function checkNode(value: unknown, pointer: string, draft: SchemaDraft, formats: boolean, out: SchemaProblem[]) {
  const error = (message: string, at = pointer, target: SchemaProblem['target'] = 'value') =>
    out.push({ pointer: at, message, severity: 'error', target });
  const warn = (message: string, at = pointer, target: SchemaProblem['target'] = 'value') =>
    out.push({ pointer: at, message, severity: 'warning', target });
  const kw = (name: string) => `${pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;

  if (typeof value === 'boolean') return;
  if (!isPlainObject(value)) {
    const hint = typeof value === 'string' && TYPES.includes(value) ? ` Did you mean {"type": ${JSON.stringify(value)}}?` : '';
    error(`A schema must be an object, true or false, but this is ${describeValue(value)}.${hint}`);
    return;
  }
  const s = value;
  const has = (name: string) => Object.prototype.hasOwnProperty.call(s, name);

  if (has('type')) {
    const t = s.type;
    const list = Array.isArray(t) ? t : [t];
    if (Array.isArray(t) && t.length === 0) error('"type" must not be an empty array.', kw('type'));
    for (const item of list) {
      if (typeof item !== 'string' || !TYPES.includes(item)) {
        const guess = typeof item === 'string' ? suggest(item, TYPES) : null;
        error(
          `${typeof item === 'string' ? JSON.stringify(item) : describeValue(item)} is not a JSON Schema type.${guess ? ` Did you mean "${guess}"?` : ''} Use one of: ${TYPES.join(', ')}.`,
          kw('type'),
        );
      }
    }
  }

  if (has('required')) {
    const r = s.required;
    if (typeof r === 'boolean') {
      error('"required" must be an array of property names. The boolean form is from draft 3: list the name in the parent\'s "required" array instead.', kw('required'));
    } else if (!Array.isArray(r) || r.some((x) => typeof x !== 'string')) {
      error('"required" must be an array of property names (strings).', kw('required'));
    }
  }

  if (has('enum') && !Array.isArray(s.enum)) error('"enum" must be an array of allowed values.', kw('enum'));

  if (has('multipleOf') && !(typeof s.multipleOf === 'number' && s.multipleOf > 0)) {
    error('"multipleOf" must be a number greater than 0.', kw('multipleOf'));
  }
  for (const name of ['minimum', 'maximum']) {
    if (has(name) && typeof s[name] !== 'number') error(`"${name}" must be a number.`, kw(name));
  }
  for (const name of ['exclusiveMinimum', 'exclusiveMaximum']) {
    if (!has(name)) continue;
    const v = s[name];
    const base = name === 'exclusiveMinimum' ? 'minimum' : 'maximum';
    if (draft === '4') {
      if (typeof v === 'number') {
        warn(`In draft 4, "${name}" is a true/false flag for "${base}", so this number is ignored. Write {"${base}": ${v}, "${name}": true}, or select a newer draft.`, kw(name));
      } else if (typeof v !== 'boolean') error(`In draft 4, "${name}" must be true or false.`, kw(name));
    } else if (typeof v === 'boolean') {
      error(`Since draft 6, "${name}" is a number. {"${base}": n, "${name}": true} is draft 4 syntax: write {"${name}": n}, or select draft 4.`, kw(name));
    } else if (typeof v !== 'number') error(`"${name}" must be a number.`, kw(name));
  }
  for (const name of NON_NEGATIVE_INTEGER) {
    if (has(name) && !isNonNegativeInteger(s[name])) error(`"${name}" must be a whole number of 0 or more.`, kw(name));
  }
  if (has('uniqueItems') && typeof s.uniqueItems !== 'boolean') error('"uniqueItems" must be true or false.', kw('uniqueItems'));

  if (has('pattern')) {
    if (typeof s.pattern !== 'string') error('"pattern" must be a regular expression string.', kw('pattern'));
    else {
      const problem = regexError(s.pattern);
      if (problem) error(`Invalid regular expression in "pattern": ${problem}.`, kw('pattern'));
    }
  }
  if (has('patternProperties') && isPlainObject(s.patternProperties)) {
    for (const key of Object.keys(s.patternProperties)) {
      const problem = regexError(key);
      if (problem) error(`Invalid regular expression in "patternProperties": ${problem}.`, `${kw('patternProperties')}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, 'key');
    }
  }

  for (const name of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    if (has(name) && !isPlainObject(s[name])) error(`"${name}" must be an object that maps names to schemas.`, kw(name));
  }
  for (const name of ['allOf', 'anyOf', 'oneOf']) {
    if (has(name) && !(Array.isArray(s[name]) && (s[name] as unknown[]).length > 0)) {
      error(`"${name}" must be a non-empty array of schemas.`, kw(name));
    }
  }
  if (has('prefixItems') && !Array.isArray(s.prefixItems)) error('"prefixItems" must be an array of schemas.', kw('prefixItems'));
  if (has('items') && !(Array.isArray(s.items) || isPlainObject(s.items) || typeof s.items === 'boolean')) {
    error('"items" must be a schema (or, before 2020-12, an array of schemas).', kw('items'));
  }
  if (has('dependentRequired')) {
    const d = s.dependentRequired;
    if (!isPlainObject(d) || Object.values(d).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== 'string'))) {
      error('"dependentRequired" must map property names to arrays of property names.', kw('dependentRequired'));
    }
  }
  if (has('dependencies')) {
    const d = s.dependencies;
    if (!isPlainObject(d)) error('"dependencies" must be an object.', kw('dependencies'));
    else {
      for (const [name, v] of Object.entries(d)) {
        if (Array.isArray(v) && v.some((x) => typeof x !== 'string')) {
          error(`"dependencies" of "${name}" must list property names (strings).`, `${kw('dependencies')}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`);
        }
      }
    }
  }

  if (has('format')) {
    if (typeof s.format !== 'string') error('"format" must be a string.', kw('format'));
    else if (formats && !KNOWN_FORMATS.has(s.format)) {
      warn(`Format "${s.format}" is not checked: this validator knows ${[...KNOWN_FORMATS].join(', ')}.`, kw('format'));
    }
  }

  if (has('$ref') && typeof s.$ref !== 'string') error('"$ref" must be a URI reference string.', kw('$ref'));
  for (const name of ['$dynamicRef', '$dynamicAnchor']) {
    if (has(name)) warn(`"${name}" is not supported by this validator and is ignored.`, kw(name), 'key');
  }
  if (has('$ref') && (draft === '4' || draft === '7')) {
    const ignored = Object.keys(s).filter((k) => k !== '$ref' && !ANNOTATIONS.has(k) && KNOWN.has(k));
    if (ignored.length) {
      warn(
        `In ${draft === '4' ? 'draft 4' : 'draft 7'} and earlier, keywords next to "$ref" are ignored (${ignored.map((k) => `"${k}"`).join(', ')}). Wrap them: {"allOf": [{"$ref": …}, {…}]}.`,
        kw('$ref'),
        'key',
      );
    }
  }

  for (const key of Object.keys(s)) {
    if (KNOWN.has(key) || key.startsWith('$') || key.startsWith('x-')) continue;
    const guess = suggest(key, KEYWORDS);
    if (guess) warn(`Unknown keyword "${key}" is ignored. Did you mean "${guess}"?`, kw(key), 'key');
  }
}

export interface LintResult {
  problems: SchemaProblem[];
  /** Resolved `$ref` targets, ready for validation (null when the schema has errors). */
  lookup: Record<string, Schema | boolean> | null;
}

/**
 * Checks a parsed schema for mistakes that would make validation meaningless or
 * crash the engine (wrong keyword types, invalid regexes, unresolvable `$ref`s),
 * plus likely typos. Errors block validation; warnings do not.
 */
export function lintSchema(schema: unknown, draft: SchemaDraft, formats: boolean): LintResult {
  const problems: SchemaProblem[] = [];
  const refs: Array<{ node: Record<string, unknown>; pointer: string }> = [];
  walkSchema(schema, ({ value, pointer }) => {
    checkNode(value, pointer, draft, formats, problems);
    if (isPlainObject(value) && typeof value.$ref === 'string') refs.push({ node: value, pointer });
  });
  if (problems.some((p) => p.severity === 'error')) return { problems, lookup: null };

  let lookup: Record<string, Schema | boolean>;
  try {
    lookup = dereference(schema as Schema | boolean, Object.create(null) as Record<string, Schema | boolean>, BASE_URI);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    problems.push({
      pointer: '',
      message: /Duplicate schema URI/.test(message)
        ? 'Two subschemas declare the same "$id". Every "$id" must be unique.'
        : `The schema's "$id" values could not be resolved (${message}).`,
      severity: 'error',
      target: 'value',
    });
    return { problems, lookup: null };
  }

  const definitions = new Set<string>();
  if (isPlainObject(schema)) {
    for (const container of ['$defs', 'definitions']) {
      const defs = schema[container];
      if (isPlainObject(defs)) for (const name of Object.keys(defs)) definitions.add(`#/${container}/${name}`);
    }
  }
  for (const { node, pointer } of refs) {
    const ref = node.$ref as string;
    const absolute = (node as { __absolute_ref__?: string }).__absolute_ref__ ?? ref;
    if (lookup[absolute] !== undefined) continue;
    let message: string;
    if (ref.startsWith('#')) {
      const guess = suggest(ref, definitions);
      message = `"$ref": ${JSON.stringify(ref)} points to nothing in this schema.${guess && guess !== ref ? ` Did you mean ${JSON.stringify(guess)}?` : ''}`;
    } else {
      message = `"$ref": ${JSON.stringify(ref)} refers to another document. Schemas are never downloaded here: copy it into "$defs" and reference it as "#/$defs/…".`;
    }
    problems.push({ pointer: `${pointer}/$ref`, message, severity: 'error', target: 'value' });
  }
  return { problems, lookup: problems.some((p) => p.severity === 'error') ? null : lookup };
}
