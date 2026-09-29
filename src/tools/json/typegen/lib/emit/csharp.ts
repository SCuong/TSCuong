import type { ObjectDef, TypeModel, TypeRef } from '../infer';
import { camelCase, isAsciiIdentifier, Namer, pascalCase, splitWords } from '../naming';
import { mixedNote, nameTypes, quoteString, usesType, type EmitOptions } from './common';

const CS_KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const',
  'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
  'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface',
  'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params',
  'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof',
  'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong',
  'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while',
]);

/** Framework type names generated classes must not shadow. */
const CS_RESERVED_TYPES = new Set([
  'Object', 'String', 'Type', 'Guid', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'Action', 'Func', 'Task',
  'Math', 'Convert', 'Attribute', 'Exception', 'Environment', 'Console', 'Array', 'List', 'Dictionary',
  'JsonElement', 'JsonDocument', 'JsonSerializer', 'JsonPropertyName', 'Enum', 'Nullable', 'Int32', 'Int64',
  'Double', 'Boolean', 'Decimal', 'Byte', 'Char', 'Uri', 'Version', 'Random', 'Tuple', 'ValueTuple', 'Span',
  'Memory', 'Index', 'Range', 'Half', 'Delegate', 'GC', 'Buffer', 'Monitor', 'Thread',
]);

/** Members every record/class already has. */
const CS_MEMBERS = ['Equals', 'GetHashCode', 'GetType', 'ToString', 'MemberwiseClone', 'Finalize', 'EqualityContract', 'Deconstruct', 'PrintMembers'];

interface Ctx {
  names: Map<ObjectDef, string>;
  formats: boolean;
}

function csType(t: TypeRef, ctx: Ctx): string {
  let base: string;
  switch (t.kind) {
    case 'unknown':
    case 'union':
      base = 'JsonElement';
      break;
    case 'null':
      return 'JsonElement?';
    case 'boolean':
      base = 'bool';
      break;
    case 'integer':
      base = 'long';
      break;
    case 'number':
      base = 'double';
      break;
    case 'string':
      base = ctx.formats && t.format === 'date-time' ? 'DateTimeOffset' : 'string';
      break;
    case 'array':
      base = `List<${csType(t.items, ctx)}>`;
      break;
    case 'map':
      base = `Dictionary<string, ${csType(t.values, ctx)}>`;
      break;
    case 'object':
      base = ctx.names.get(t.def)!;
      break;
  }
  return t.nullable ? `${base}?` : base;
}

export function emitCSharp(model: TypeModel, options: EmitOptions): string {
  const { names, rootName } = nameTypes(model, CS_RESERVED_TYPES);
  const ctx: Ctx = { names, formats: options.formats };
  const record = options.csharpStyle === 'record';
  const usings: string[] = [];
  if (usesType(model, (t) => options.formats && t.kind === 'string' && t.format === 'date-time')) usings.push('using System;');
  if (usesType(model, (t) => t.kind === 'array' || t.kind === 'map')) usings.push('using System.Collections.Generic;');
  if (usesType(model, (t) => t.kind === 'unknown' || t.kind === 'null' || t.kind === 'union')) usings.push('using System.Text.Json;');
  usings.push('using System.Text.Json.Serialization;');
  const blocks: string[] = [`#nullable enable\n\n${usings.join('\n')}`];

  if (model.root.kind !== 'object') {
    const note = model.rootNote ? ` ${model.rootNote}` : '';
    blocks.push(`// The JSON root is not an object: deserialize it as ${csType(model.root, ctx)} (${rootName}).${note}`);
  }

  for (const def of model.objects) {
    const typeName = names.get(def)!;
    const reserved = new Set([...CS_KEYWORDS, typeName, ...CS_MEMBERS]);
    const props = new Namer(reserved, { escape: (n) => (CS_KEYWORDS.has(n) ? `@${n}` : `${n}Value`) });
    const members = def.fields.map((f) => {
      let words = splitWords(f.key);
      if (words.length === 0) words = ['Field'];
      else if (/^[0-9]/.test(words[0])) words = ['Field', ...words];
      const keep = !options.idiomaticNames && isAsciiIdentifier(f.key);
      const name = props.claim(keep ? f.key : pascalCase(words));
      let type = csType(f.type, ctx);
      if (f.optional && !type.endsWith('?')) type += '?';
      const lines: string[] = [];
      if (f.note) lines.push(`    // ${f.note}`);
      else if (mixedNote(f.type)) lines.push(`    // ${mixedNote(f.type)}`);
      if (name.replace(/^@/, '') !== f.key) lines.push(`    [JsonPropertyName(${JSON.stringify(f.key)})]`);
      const required = f.optional ? '' : 'required ';
      lines.push(`    public ${required}${type} ${name} { get; ${record ? 'init' : 'set'}; }`);
      return lines.join('\n');
    });
    const kind = record ? 'record' : 'class';
    const body = members.length ? `\n{\n${members.join('\n\n')}\n}` : '\n{\n}';
    blocks.push(`public sealed ${kind} ${typeName}${body}`);
  }
  return `${blocks.join('\n\n')}\n`;
}

// --- Kotlin ------------------------------------------------------------------------

const KOTLIN_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null',
  'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var',
  'when', 'while',
]);

const KOTLIN_RESERVED_TYPES = new Set([
  'Any', 'Unit', 'Nothing', 'String', 'Int', 'Long', 'Double', 'Float', 'Boolean', 'Char', 'Byte', 'Short',
  'List', 'Map', 'Set', 'Array', 'Pair', 'Triple', 'Result', 'Number', 'Comparable', 'Collection', 'Iterable',
  'JsonElement', 'JsonObject', 'JsonArray', 'Serializable', 'SerialName', 'Transient', 'Enum', 'Throwable',
  'Exception', 'Error', 'Lazy', 'Sequence', 'Regex', 'CharSequence', 'Annotation', 'Function',
]);

function ktType(t: TypeRef, names: Map<ObjectDef, string>): string {
  let base: string;
  switch (t.kind) {
    case 'unknown':
    case 'union':
      base = 'JsonElement';
      break;
    case 'null':
      return 'JsonElement?';
    case 'boolean':
      base = 'Boolean';
      break;
    case 'integer':
      base = 'Long';
      break;
    case 'number':
      base = 'Double';
      break;
    case 'string':
      base = 'String';
      break;
    case 'array':
      base = `List<${ktType(t.items, names)}>`;
      break;
    case 'map':
      base = `Map<String, ${ktType(t.values, names)}>`;
      break;
    case 'object':
      base = names.get(t.def)!;
      break;
  }
  return t.nullable ? `${base}?` : base;
}

export function emitKotlin(model: TypeModel, options: EmitOptions): string {
  const { names, rootName } = nameTypes(model, KOTLIN_RESERVED_TYPES);
  const imports = ['import kotlinx.serialization.SerialName', 'import kotlinx.serialization.Serializable'];
  if (usesType(model, (t) => t.kind === 'unknown' || t.kind === 'null' || t.kind === 'union')) {
    imports.push('import kotlinx.serialization.json.JsonElement');
  }
  const blocks: string[] = [];
  let usesSerialName = false;

  if (model.root.kind !== 'object') {
    const note = model.rootNote ? ` // ${model.rootNote}` : '';
    blocks.push(`typealias ${rootName} = ${ktType(model.root, names)}${note}`);
  }

  for (const def of model.objects) {
    const params = new Namer(KOTLIN_KEYWORDS, { escape: (n) => `\`${n}\`` });
    const lines = def.fields.map((f) => {
      let words = splitWords(f.key);
      if (words.length === 0) words = ['field'];
      else if (/^[0-9]/.test(words[0])) words = ['field', ...words];
      const keep = !options.idiomaticNames && isAsciiIdentifier(f.key);
      const name = params.claim(keep ? f.key : camelCase(words));
      let type = ktType(f.type, names);
      if (f.optional && !type.endsWith('?')) type += '?';
      const out: string[] = [];
      if (name.replace(/`/g, '') !== f.key) {
        usesSerialName = true;
        out.push(`    @SerialName(${quoteString(f.key, { dollar: true })})`);
      }
      const mixed = mixedNote(f.type);
      const note = f.note ? ` // ${f.note}` : mixed ? ` // ${mixed}` : '';
      out.push(`    val ${name}: ${type}${f.optional ? ' = null' : ''},${note}`);
      return out.join('\n');
    });
    const name = names.get(def)!;
    blocks.push(lines.length ? `@Serializable\ndata class ${name}(\n${lines.join('\n')}\n)` : `@Serializable\nclass ${name}`);
  }
  if (!usesSerialName) imports.shift();
  return `${[imports.join('\n'), ...blocks].join('\n\n')}\n`;
}
