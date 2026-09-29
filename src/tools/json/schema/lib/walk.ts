import { escapeToken } from './pointer';

/** Keywords whose value is a single subschema. */
export const SCHEMA_KEYWORDS = [
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
] as const;

/** Keywords whose value is an array of subschemas. */
export const SCHEMA_ARRAY_KEYWORDS = ['prefixItems', 'allOf', 'anyOf', 'oneOf'] as const;

/** Keywords whose value maps names to subschemas. */
export const SCHEMA_MAP_KEYWORDS = ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'] as const;

export interface SchemaNode {
  /** The value at a subschema position (normally an object or boolean, but anything when the schema is wrong). */
  value: unknown;
  /** JSON Pointer of the position inside the schema document. */
  pointer: string;
}

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
export const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Visits every subschema position of a schema in document order (iteratively, so
 * nesting depth is not limited by the call stack).
 */
export function walkSchema(root: unknown, visit: (node: SchemaNode) => void): void {
  const stack: SchemaNode[] = [{ value: root, pointer: '' }];
  while (stack.length) {
    const node = stack.pop()!;
    visit(node);
    if (!isPlainObject(node.value)) continue;
    const obj = node.value;
    const children: SchemaNode[] = [];
    const add = (value: unknown, ...tokens: Array<string | number>) =>
      children.push({ value, pointer: node.pointer + tokens.map((t) => `/${escapeToken(t)}`).join('') });
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if ((SCHEMA_KEYWORDS as readonly string[]).includes(key)) add(value, key);
      else if (key === 'items') {
        if (Array.isArray(value)) value.forEach((item, i) => add(item, key, i));
        else add(value, key);
      } else if ((SCHEMA_ARRAY_KEYWORDS as readonly string[]).includes(key)) {
        if (Array.isArray(value)) value.forEach((item, i) => add(item, key, i));
      } else if ((SCHEMA_MAP_KEYWORDS as readonly string[]).includes(key)) {
        if (isPlainObject(value)) for (const name of Object.keys(value)) add(value[name], key, name);
      } else if (key === 'dependencies' && isPlainObject(value)) {
        // Values are either property lists (arrays) or subschemas.
        for (const name of Object.keys(value)) if (!Array.isArray(value[name])) add(value[name], key, name);
      }
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

/** Removes every `format` keyword from subschema positions (not from property names or data). */
export function stripFormats(root: unknown): void {
  walkSchema(root, ({ value }) => {
    if (isPlainObject(value) && has(value, 'format')) delete value.format;
  });
}
