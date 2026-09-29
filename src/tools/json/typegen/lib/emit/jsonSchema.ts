import type { ObjectDef, TypeModel, TypeRef } from '../infer';
import { nameTypes } from './common';

export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

export interface JsonSchemaOptions {
  /** Emit `format` for detected string formats. */
  formats: boolean;
  /** Inline nested objects instead of `$defs` + `$ref`. */
  inline: boolean;
}

type Schema = Record<string, unknown>;

const SIMPLE_TYPES: Partial<Record<TypeRef['kind'], string>> = {
  boolean: 'boolean',
  integer: 'integer',
  number: 'number',
  string: 'string',
  null: 'null',
};

/** Adds "null" to a schema's allowed types (or wraps it in anyOf when it has no `type`). */
function withNull(schema: Schema): Schema {
  const type = schema.type;
  if (typeof type === 'string') return { ...schema, type: type === 'null' ? 'null' : [type, 'null'] };
  if (Array.isArray(type)) return type.includes('null') ? schema : { ...schema, type: [...type, 'null'] };
  if (Object.keys(schema).length === 0) return schema;
  if (Array.isArray(schema.anyOf) && Object.keys(schema).length === 1) return { anyOf: [...schema.anyOf, { type: 'null' }] };
  return { anyOf: [schema, { type: 'null' }] };
}

class SchemaBuilder {
  constructor(
    private readonly names: Map<ObjectDef, string>,
    private readonly options: JsonSchemaOptions,
  ) {}

  type(t: TypeRef): Schema {
    let schema: Schema;
    switch (t.kind) {
      case 'unknown':
        schema = {};
        break;
      case 'null':
        return { type: 'null' };
      case 'boolean':
      case 'integer':
      case 'number':
        schema = { type: SIMPLE_TYPES[t.kind] };
        break;
      case 'string':
        schema = this.options.formats && t.format ? { type: 'string', format: t.format } : { type: 'string' };
        break;
      case 'array':
        schema = { type: 'array', items: this.type(t.items) };
        break;
      case 'map':
        schema = t.values.kind === 'unknown' ? { type: 'object' } : { type: 'object', additionalProperties: this.type(t.values) };
        break;
      case 'object':
        schema = this.options.inline ? this.object(t.def) : { $ref: `#/$defs/${this.names.get(t.def)!}` };
        break;
      case 'union': {
        const members = t.members.map((m) => this.type(m));
        const simple = members.every((m) => typeof m.type === 'string' && Object.keys(m).every((k) => k === 'type' || k === 'format'));
        if (simple) {
          const formats = members.filter((m) => m.format);
          schema = { type: members.map((m) => m.type) };
          if (formats.length === 1) schema.format = formats[0].format;
        } else schema = { anyOf: members };
        break;
      }
    }
    return t.nullable ? withNull(schema) : schema;
  }

  object(def: ObjectDef): Schema {
    const properties: Schema = {};
    const required: string[] = [];
    for (const f of def.fields) {
      const property = this.type(f.type);
      // defineProperty: a "__proto__" key must become a real property, not the prototype.
      Object.defineProperty(properties, f.key, {
        value: f.note ? { $comment: f.note, ...property } : property,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      if (!f.optional) required.push(f.key);
    }
    const schema: Schema = { type: 'object', properties };
    if (required.length) schema.required = required;
    return schema;
  }
}

/** Builds a draft 2020-12 JSON Schema object describing the inferred model. */
export function buildJsonSchema(model: TypeModel, options: JsonSchemaOptions): Schema {
  const { names, rootName } = nameTypes(model, new Set());
  const builder = new SchemaBuilder(names, options);
  const root: Schema = { $schema: DRAFT_2020_12 };
  if (!options.inline) root.title = rootName;
  if (model.root.kind === 'object' && !options.inline) Object.assign(root, builder.object(model.root.def));
  else Object.assign(root, builder.type(model.root));
  if (model.rootNote) root.$comment = model.rootNote;
  if (!options.inline) {
    const defs: Schema = {};
    for (const def of model.objects) {
      if (model.root.kind === 'object' && def === model.root.def) continue;
      defs[names.get(def)!] = builder.object(def);
    }
    if (Object.keys(defs).length) root.$defs = defs;
  }
  return root;
}

export function emitJsonSchema(model: TypeModel, options: JsonSchemaOptions): string {
  return `${JSON.stringify(buildJsonSchema(model, options), null, 2)}\n`;
}
