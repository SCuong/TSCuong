import type { FieldDef, ObjectDef, TypeModel, TypeRef } from '../infer';
import { isAsciiIdentifier, Namer, snakeCase, splitWords } from '../naming';
import { dependencyOrder, nameTypes, usesType, type EmitOptions } from './common';

export type PythonStyle = 'dataclass' | 'typeddict' | 'pydantic';

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

const PY_RESERVED_TYPES = new Set([
  ...PY_KEYWORDS,
  'Any', 'Optional', 'Union', 'List', 'Dict', 'TypedDict', 'NotRequired', 'Field', 'BaseModel', 'ConfigDict',
  'RootModel', 'Exception', 'BaseException', 'Ellipsis', 'NotImplemented',
]);

/** BaseModel attributes a pydantic field must not shadow. */
const PYDANTIC_RESERVED = new Set([
  'model_config', 'model_fields', 'model_computed_fields', 'model_extra', 'model_fields_set', 'model_construct',
  'model_copy', 'model_dump', 'model_dump_json', 'model_json_schema', 'model_parametrized_name',
  'model_post_init', 'model_rebuild', 'model_validate', 'model_validate_json', 'model_validate_strings', 'copy',
  'dict', 'json', 'parse_obj', 'parse_raw', 'parse_file', 'from_orm', 'construct', 'schema', 'schema_json',
  'validate', 'update_forward_refs',
]);

interface Ctx {
  names: Map<ObjectDef, string>;
  datetime: boolean;
}

function pyType(t: TypeRef, ctx: Ctx): string {
  let base: string;
  switch (t.kind) {
    case 'unknown':
      return 'Any';
    case 'null':
      return 'None';
    case 'boolean':
      base = 'bool';
      break;
    case 'integer':
      base = 'int';
      break;
    case 'number':
      base = 'float';
      break;
    case 'string':
      base = ctx.datetime && t.format === 'date-time' ? 'datetime' : 'str';
      break;
    case 'array':
      base = `list[${pyType(t.items, ctx)}]`;
      break;
    case 'map':
      base = `dict[str, ${pyType(t.values, ctx)}]`;
      break;
    case 'object':
      base = ctx.names.get(t.def)!;
      break;
    case 'union':
      base = t.members.map((m) => pyType(m, ctx)).join(' | ');
      break;
  }
  return t.nullable ? `${base} | None` : base;
}

/** The field's annotation; optional fields that may be missing also accept None. */
function fieldType(f: FieldDef, ctx: Ctx, style: PythonStyle): string {
  const t = pyType(f.type, ctx);
  if (style === 'typeddict') return f.optional ? `NotRequired[${t}]` : t;
  if (f.optional && t !== 'Any' && t !== 'None' && !t.endsWith('| None')) return `${t} | None`;
  return t;
}

interface NamedField {
  f: FieldDef;
  name: string;
}

function fieldNames(def: ObjectDef, options: EmitOptions, style: PythonStyle): NamedField[] {
  const reserved = new Set([...PY_KEYWORDS, ...(style === 'pydantic' ? PYDANTIC_RESERVED : []), 'from_dict']);
  const namer = new Namer(reserved, { escape: (n) => `${n}_`, separator: '_' });
  return def.fields.map((f) => {
    let words = splitWords(f.key);
    if (words.length === 0) words = ['field'];
    else if (/^[0-9]/.test(words[0])) words = ['field', ...words];
    // Leading underscores would make pydantic treat the field as private.
    const keep = !options.idiomaticNames && isAsciiIdentifier(f.key) && !f.key.startsWith('_');
    return { f, name: namer.claim(keep ? f.key : snakeCase(words)) };
  });
}

const pyString = (s: string) => JSON.stringify(s);

/** Python expression converting raw JSON `expr` into the typed value, or null when no conversion is needed. */
function convert(expr: string, t: TypeRef, ctx: Ctx, depth: number): string | null {
  let conv: string | null = null;
  const suffix = depth === 0 ? '' : String(depth + 1);
  const v = `v${suffix}`;
  switch (t.kind) {
    case 'object':
      conv = `${ctx.names.get(t.def)!}.from_dict(${expr})`;
      break;
    case 'array': {
      const inner = convert(v, t.items, ctx, depth + 1);
      if (inner) conv = `[${inner} for ${v} in ${expr}]`;
      break;
    }
    case 'map': {
      const inner = convert(v, t.values, ctx, depth + 1);
      if (inner) conv = `{k${suffix}: ${inner} for k${suffix}, ${v} in ${expr}.items()}`;
      break;
    }
    case 'union': {
      const obj = t.members.find((m) => m.kind === 'object');
      if (obj?.kind === 'object') conv = `${ctx.names.get(obj.def)!}.from_dict(${expr}) if isinstance(${expr}, dict) else ${expr}`;
      break;
    }
  }
  if (conv && t.nullable) conv = `${conv} if ${expr} is not None else None`;
  return conv;
}

function header(model: TypeModel, style: PythonStyle, ctx: Ctx, extras: { anyNotRequired: boolean; aliases: boolean }): string {
  const groups: string[][] = [];
  if (style === 'dataclass') groups.push(['from __future__ import annotations']);
  const std: string[] = [];
  if (style === 'dataclass') std.push('from dataclasses import dataclass');
  if (ctx.datetime && usesType(model, (t) => t.kind === 'string' && t.format === 'date-time')) std.push('from datetime import datetime');
  const typing: string[] = [];
  if (style === 'dataclass' || usesType(model, (t) => t.kind === 'unknown')) typing.push('Any');
  if (style === 'typeddict') {
    if (extras.anyNotRequired) typing.push('NotRequired');
    typing.push('TypedDict');
  }
  if (typing.length) std.push(`from typing import ${typing.join(', ')}`);
  if (std.length) groups.push(std);
  if (style === 'pydantic') {
    const imports = ['BaseModel'];
    if (extras.aliases) imports.push('ConfigDict', 'Field');
    if (model.root.kind !== 'object') imports.push('RootModel');
    groups.push([`from pydantic import ${imports.join(', ')}`]);
  }
  return groups.map((g) => g.join('\n')).join('\n\n');
}

/** Keys the class-based TypedDict syntax cannot express (invalid names, keywords, mangled `__names`). */
function needsFunctionalSyntax(key: string): boolean {
  return !isAsciiIdentifier(key) || PY_KEYWORDS.has(key) || (key.startsWith('__') && !key.endsWith('__'));
}

export function emitPython(model: TypeModel, options: EmitOptions, style: PythonStyle): string {
  const { names, rootName } = nameTypes(model, PY_RESERVED_TYPES);
  // Only pydantic parses ISO strings into datetime; dataclasses and TypedDicts describe raw JSON values.
  const ctx: Ctx = { names, datetime: options.formats && style === 'pydantic' };
  const blocks: string[] = [];
  let anyNotRequired = false;
  let aliases = false;

  for (const def of dependencyOrder(model)) {
    const name = names.get(def)!;
    const fields = fieldNames(def, options, style);
    if (style === 'typeddict') {
      if (def.fields.some((f) => f.optional)) anyNotRequired = true;
      const functional = def.fields.some((f) => needsFunctionalSyntax(f.key));
      if (functional) {
        const entries = def.fields.map((f) => `    ${pyString(f.key)}: ${fieldType(f, ctx, style)},${f.note ? `  # ${f.note}` : ''}`);
        blocks.push(`${name} = TypedDict(\n    ${pyString(name)},\n    {\n${entries.map((e) => `    ${e}`).join('\n')}\n    },\n)`);
      } else {
        const lines = def.fields.map((f) => `    ${f.key}: ${fieldType(f, ctx, style)}${f.note ? `  # ${f.note}` : ''}`);
        blocks.push(`class ${name}(TypedDict):\n${lines.length ? lines.join('\n') : '    pass'}`);
      }
      continue;
    }

    if (style === 'pydantic') {
      const lines: string[] = [];
      const hasAlias = fields.some(({ f, name: n }) => n !== f.key);
      if (hasAlias) {
        aliases = true;
        lines.push('    model_config = ConfigDict(populate_by_name=True)', '');
      }
      for (const { f, name: n } of fields) {
        const t = fieldType(f, ctx, style);
        const args: string[] = [];
        if (f.optional) args.push('default=None');
        if (n !== f.key) args.push(`alias=${pyString(f.key)}`);
        let value = '';
        if (n !== f.key) value = ` = Field(${args.join(', ')})`;
        else if (f.optional) value = ' = None';
        lines.push(`    ${n}: ${t}${value}${f.note ? `  # ${f.note}` : ''}`);
      }
      blocks.push(`class ${name}(BaseModel):\n${fields.length ? lines.join('\n') : '    pass'}`);
      continue;
    }

    // dataclass: required fields first (fields with defaults must come last), plus from_dict.
    const ordered = [...fields.filter(({ f }) => !f.optional), ...fields.filter(({ f }) => f.optional)];
    const lines = ordered.map(({ f, name: n }) => `    ${n}: ${fieldType(f, ctx, style)}${f.optional ? ' = None' : ''}${f.note ? `  # ${f.note}` : ''}`);
    const args = fields.map(({ f, name: n }) => {
      const access = f.optional ? `data.get(${pyString(f.key)})` : `data[${pyString(f.key)}]`;
      let value = access;
      const conv = convert(`data[${pyString(f.key)}]`, { ...f.type, nullable: false } as TypeRef, ctx, 0);
      if (conv) {
        value = f.optional || f.type.nullable ? `${conv} if data.get(${pyString(f.key)}) is not None else None` : conv;
      }
      return `            ${n}=${value},`;
    });
    const fromDict = [
      '    @classmethod',
      `    def from_dict(cls, data: dict[str, Any]) -> ${name}:`,
      args.length ? `        return cls(\n${args.join('\n')}\n        )` : '        return cls()',
    ];
    blocks.push(`@dataclass\nclass ${name}:\n${lines.length ? `${lines.join('\n')}\n\n` : ''}${fromDict.join('\n')}`);
  }

  if (model.root.kind !== 'object') {
    const note = model.rootNote ? `  # ${model.rootNote}` : '';
    const t = pyType(model.root, ctx);
    blocks.push(style === 'pydantic' ? `class ${rootName}(RootModel[${t}]):\n    pass${note}` : `${rootName} = ${t}${note}`);
  }

  const head = header(model, style, ctx, { anyNotRequired, aliases });
  return `${head ? `${head}\n\n\n` : ''}${blocks.join('\n\n\n')}\n`;
}
