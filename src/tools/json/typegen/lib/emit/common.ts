import type { ObjectDef, TypeModel, TypeRef } from '../infer';
import { Namer, pascalCase } from '../naming';

export interface EmitOptions {
  /** Map date-time strings to native date types (and emit string formats in Zod / JSON Schema). */
  formats: boolean;
  /** TypeScript / Zod: add the `export` keyword. */
  exportTypes: boolean;
  /** TypeScript: mark properties `readonly`. */
  readonly: boolean;
  /** Rust, Python, C#, Kotlin: use the language's naming convention and add rename attributes. */
  idiomaticNames: boolean;
  csharpStyle: 'record' | 'class';
  goPackage: string;
}

export const DEFAULT_EMIT_OPTIONS: EmitOptions = {
  formats: true,
  exportTypes: true,
  readonly: false,
  idiomaticNames: true,
  csharpStyle: 'record',
  goPackage: 'main',
};

/** Object types ordered so that each type comes after every type it references. */
export function dependencyOrder(model: TypeModel): ObjectDef[] {
  const out: ObjectDef[] = [];
  const seen = new Set<number>();
  const visitType = (t: TypeRef) => {
    if (t.kind === 'object') visitDef(t.def);
    else if (t.kind === 'array') visitType(t.items);
    else if (t.kind === 'map') visitType(t.values);
    else if (t.kind === 'union') t.members.forEach(visitType);
  };
  const visitDef = (def: ObjectDef) => {
    if (seen.has(def.id)) return;
    seen.add(def.id);
    for (const f of def.fields) visitType(f.type);
    out.push(def);
  };
  visitType(model.root);
  return out;
}

/** Calls `fn` for every type reference in the model (fields, nested items, the root). */
export function forEachType(model: TypeModel, fn: (t: TypeRef) => void) {
  const visit = (t: TypeRef) => {
    fn(t);
    if (t.kind === 'array') visit(t.items);
    else if (t.kind === 'map') visit(t.values);
    else if (t.kind === 'union') t.members.forEach(visit);
  };
  visit(model.root);
  for (const def of model.objects) for (const f of def.fields) visit(f.type);
}

export function usesType(model: TypeModel, test: (t: TypeRef) => boolean): boolean {
  let found = false;
  forEachType(model, (t) => {
    if (!found && test(t)) found = true;
  });
  return found;
}

const KIND_WORDS: Record<TypeRef['kind'], string> = {
  unknown: 'unknown',
  null: 'null',
  boolean: 'boolean',
  integer: 'integer',
  number: 'number',
  string: 'string',
  array: 'array',
  object: 'object',
  map: 'object',
  union: 'mixed',
};

/** "integer or string", "boolean, string or object" — for comments on mixed-type fields. */
export function describeKinds(t: TypeRef): string {
  const words = t.kind === 'union' ? t.members.map((m) => KIND_WORDS[m.kind]) : [KIND_WORDS[t.kind]];
  if (t.nullable) words.push('null');
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

/**
 * Comment for languages without union types: "integer or string", or
 * "items: integer or string" when the mixed values sit inside arrays/maps.
 */
export function mixedNote(t: TypeRef): string | undefined {
  if (t.kind === 'union') return describeKinds(t);
  if (t.kind === 'array' || t.kind === 'map') {
    const inner = t.kind === 'array' ? t.items : t.values;
    const note = mixedNote(inner);
    if (!note) return undefined;
    return inner.kind === 'union' ? `${t.kind === 'array' ? 'items' : 'values'}: ${note}` : note;
  }
  return undefined;
}

/**
 * Allocates a unique type name for every object type (plus the root alias when the
 * root is not an object). `reserved` names get `suffix` appended.
 */
export function nameTypes(
  model: TypeModel,
  reserved: ReadonlySet<string>,
  casing: (words: string[]) => string = (w) => pascalCase(w),
  suffix = 'Object',
): { names: Map<ObjectDef, string>; rootName: string; namer: Namer } {
  const namer = new Namer(reserved, { escape: (n) => `${n}${suffix}` });
  const names = new Map<ObjectDef, string>();
  const rootDef = model.root.kind === 'object' ? model.root.def : null;
  const rootName = namer.claim(casing(model.rootWords) || 'Root');
  if (rootDef) names.set(rootDef, rootName);
  for (const def of model.objects) {
    if (def === rootDef) continue;
    names.set(def, namer.claim(casing(def.words) || 'Type'));
  }
  return { names, rootName, namer };
}

/**
 * Lines up columns like gofmt: every cell except the last non-empty one in its row is
 * padded to the widest such cell of its column; trailing empty cells are dropped.
 */
export function alignColumns(rows: string[][]): string[] {
  const lastCell = (row: string[]) => {
    let last = row.length - 1;
    while (last > 0 && row[last] === '') last--;
    return last;
  };
  const widths: number[] = [];
  for (const row of rows) {
    const last = lastCell(row);
    for (let i = 0; i < last; i++) widths[i] = Math.max(widths[i] ?? 0, row[i].length);
  }
  return rows.map((row) => {
    const last = lastCell(row);
    return row
      .slice(0, last + 1)
      .map((cell, i) => (i < last ? cell.padEnd(widths[i]) : cell))
      .join(' ');
  });
}

/** Escapes a string for a double-quoted literal in languages with C-like escapes but no \f / \b. */
export function quoteString(value: string, options: { dollar?: boolean; braces?: boolean } = {}): string {
  let out = '"';
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '$' && options.dollar) out += '\\$';
    else if (c < 0x20 || c === 0x7f) out += options.braces ? `\\u{${c.toString(16)}}` : `\\u${c.toString(16).padStart(4, '0')}`;
    else if (c >= 0xd800 && c <= 0xdfff) out += options.braces ? '\\u{fffd}' : '\\ufffd';
    else out += ch;
  }
  return `${out}"`;
}
