import type { ObjectDef, TypeModel, TypeRef } from '../infer';
import { isAsciiIdentifier, itemWords, Namer, pascalCase, snakeCase, splitWords } from '../naming';
import { nameTypes, quoteString, usesType, type EmitOptions } from './common';

const RUST_KEYWORDS = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super',
  'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box',
  'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try', 'gen', 'union',
]);
/** Keywords that cannot be raw identifiers (`r#self` is invalid). */
const NOT_RAW = new Set(['self', 'Self', 'super', 'crate', '_']);

/** Prelude and imported names generated types must not shadow. */
const RUST_RESERVED_TYPES = new Set([
  'Self', 'Option', 'Result', 'String', 'Vec', 'Box', 'Some', 'None', 'Ok', 'Err', 'HashMap', 'Value',
  'Serialize', 'Deserialize', 'Default', 'Debug', 'Clone', 'Copy', 'PartialEq', 'Eq', 'Hash', 'Ord',
  'PartialOrd', 'Send', 'Sync', 'Sized', 'Drop', 'Fn', 'FnMut', 'FnOnce', 'Iterator', 'IntoIterator',
  'ToString', 'From', 'Into', 'AsRef', 'AsMut', 'ToOwned', 'Unpin',
]);

/** serde's `rename_all = "camelCase"` applied to a Rust field name. */
export function serdeCamel(field: string): string {
  let pascal = '';
  let upper = true;
  for (const ch of field) {
    if (ch === '_') upper = true;
    else if (upper) {
      pascal += ch.toUpperCase();
      upper = false;
    } else pascal += ch;
  }
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

const unraw = (name: string) => (name.startsWith('r#') ? name.slice(2) : name);

function escapeKeyword(name: string): string {
  return NOT_RAW.has(name) ? `${name}_` : `r#${name}`;
}

interface Ctx {
  names: Map<ObjectDef, string>;
  unions: Map<TypeRef, string>;
  formats: boolean;
}

const VARIANT: Record<string, string> = {
  boolean: 'Bool',
  integer: 'Integer',
  number: 'Double',
  string: 'String',
  array: 'Array',
  map: 'Map',
};

function rustType(t: TypeRef, ctx: Ctx): string {
  let base: string;
  switch (t.kind) {
    case 'unknown':
      return 'serde_json::Value';
    case 'null':
      return 'Option<serde_json::Value>';
    case 'boolean':
      base = 'bool';
      break;
    case 'integer':
      base = 'i64';
      break;
    case 'number':
      base = 'f64';
      break;
    case 'string':
      base = ctx.formats && t.format === 'date-time' ? 'chrono::DateTime<chrono::Utc>' : 'String';
      break;
    case 'array':
      base = `Vec<${rustType(t.items, ctx)}>`;
      break;
    case 'map':
      base = `HashMap<String, ${rustType(t.values, ctx)}>`;
      break;
    case 'object':
      base = ctx.names.get(t.def)!;
      break;
    case 'union':
      base = ctx.unions.get(t)!;
      break;
  }
  return t.nullable ? `Option<${base}>` : base;
}

export function emitRust(model: TypeModel, options: EmitOptions): string {
  const { names, rootName, namer } = nameTypes(model, RUST_RESERVED_TYPES);
  const ctx: Ctx = { names, unions: new Map(), formats: options.formats };

  // Mixed-type values become untagged enums, named after the field they appear in.
  const unionOrder: TypeRef[] = [];
  const nameUnions = (t: TypeRef, words: string[], item = false) => {
    if (t.kind === 'union' && !ctx.unions.has(t)) {
      const base = pascalCase(words) || 'Value';
      // A struct inside the union may already own the natural name (e.g. `IdItem`).
      ctx.unions.set(t, namer.claim(namer.isTaken(base) ? `${base}Union` : base));
      unionOrder.push(t);
    }
    const inner = item ? words : itemWords(words);
    if (t.kind === 'array') nameUnions(t.items, inner, true);
    else if (t.kind === 'map') nameUnions(t.values, inner, true);
  };
  nameUnions(model.root, model.rootWords);
  for (const def of model.objects) {
    for (const f of def.fields) {
      const words = splitWords(f.key);
      nameUnions(f.type, words.length ? words : [...def.words, 'Value']);
    }
  }

  const derive = '#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]';
  const blocks: string[] = [];
  const deps = ['serde (with the "derive" feature)'];
  if (usesType(model, (t) => t.kind === 'unknown' || t.kind === 'null')) deps.push('serde_json');
  if (usesType(model, (t) => options.formats && t.kind === 'string' && t.format === 'date-time')) deps.push('chrono (with the "serde" feature)');
  const header = [`// Requires ${deps.join(', ')}.`, 'use serde::{Deserialize, Serialize};'];
  if (usesType(model, (t) => t.kind === 'map')) header.push('use std::collections::HashMap;');
  blocks.push(header.join('\n'));

  if (model.root.kind !== 'object') {
    const note = model.rootNote ? `// ${model.rootNote}\n` : '';
    blocks.push(`${note}pub type ${rootName} = ${rustType(model.root, ctx)};`);
  }

  for (const def of model.objects) {
    const fieldNames = new Namer(RUST_KEYWORDS, { escape: escapeKeyword, separator: '_' });
    const fields = def.fields.map((f) => {
      let words = splitWords(f.key);
      if (words.length === 0) words = ['field'];
      else if (/^[0-9]/.test(words[0])) words = ['field', ...words];
      const keep = !options.idiomaticNames && isAsciiIdentifier(f.key) && f.key !== '_';
      const name = fieldNames.claim(keep ? f.key : snakeCase(words));
      let type = rustType(f.type, ctx);
      if (f.optional && !type.startsWith('Option<')) type = `Option<${type}>`;
      return { f, name, type };
    });
    const plain = fields.filter((x) => x.f.key !== unraw(x.name)).length;
    const camel = fields.filter((x) => x.f.key !== serdeCamel(unraw(x.name))).length;
    const useCamel = camel < plain;
    const lines: string[] = [];
    for (const { f, name, type } of fields) {
      const attrs: string[] = [];
      const serdeName = useCamel ? serdeCamel(unraw(name)) : unraw(name);
      if (serdeName !== f.key) attrs.push(`rename = ${quoteString(f.key, { braces: true })}`);
      if (f.optional) attrs.push('skip_serializing_if = "Option::is_none"');
      if (f.note) lines.push(`    /// ${f.note}`);
      if (attrs.length) lines.push(`    #[serde(${attrs.join(', ')})]`);
      lines.push(`    pub ${name}: ${type},`);
    }
    const attrs = [derive];
    if (useCamel) attrs.push('#[serde(rename_all = "camelCase")]');
    const body = lines.length ? ` {\n${lines.join('\n')}\n}` : ' {}';
    blocks.push(`${attrs.join('\n')}\npub struct ${names.get(def)!}${body}`);
  }

  for (const union of unionOrder) {
    if (union.kind !== 'union') continue;
    const variants = union.members.map((m) => {
      const variant = m.kind === 'object' ? names.get(m.def)! : VARIANT[m.kind] ?? 'Value';
      return `    ${variant}(${rustType({ ...m, nullable: false }, ctx)}),`;
    });
    blocks.push(`${derive}\n#[serde(untagged)]\npub enum ${ctx.unions.get(union)!} {\n${variants.join('\n')}\n}`);
  }
  return `${blocks.join('\n\n')}\n`;
}
