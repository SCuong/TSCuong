import type { ObjectDef, TypeModel, TypeRef } from '../infer';
import { GO_INITIALISMS, Namer, pascalCase, splitWords } from '../naming';
import { alignColumns, mixedNote, nameTypes, usesType, type EmitOptions } from './common';

const goName = (words: string[]) => pascalCase(words, GO_INITIALISMS);

/** Characters encoding/json accepts in a struct tag name (besides letters and digits). */
const TAG_PUNCTUATION = "!#$%&()*+-./:;<=>?@[]^_{|}~ ";

function validTagName(key: string): boolean {
  if (key === '') return false;
  for (const ch of key) {
    if (TAG_PUNCTUATION.includes(ch)) continue;
    if (/[\p{L}\p{N}]/u.test(ch)) continue;
    return false;
  }
  return true;
}

function isDateTime(t: TypeRef, formats: boolean) {
  return formats && t.kind === 'string' && t.format === 'date-time';
}

function goType(t: TypeRef, names: Map<ObjectDef, string>, formats: boolean, forcePointer = false): string {
  let base: string;
  let pointable = true;
  switch (t.kind) {
    case 'unknown':
    case 'null':
    case 'union':
      return 'any';
    case 'boolean':
      base = 'bool';
      break;
    case 'integer':
      base = 'int64';
      break;
    case 'number':
      base = 'float64';
      break;
    case 'string':
      base = isDateTime(t, formats) ? 'time.Time' : 'string';
      break;
    case 'array':
      base = `[]${goType(t.items, names, formats)}`;
      pointable = false;
      break;
    case 'map':
      base = `map[string]${goType(t.values, names, formats)}`;
      pointable = false;
      break;
    case 'object':
      base = names.get(t.def)!;
      break;
  }
  // Slices and maps are already nil-able; scalars and structs become pointers.
  return pointable && (t.nullable || forcePointer) ? `*${base}` : base;
}

function packageName(input: string): string {
  const name = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : 'main';
}

export function emitGo(model: TypeModel, options: EmitOptions): string {
  const { names, rootName } = nameTypes(model, new Set(), goName);
  const out: string[] = [`package ${packageName(options.goPackage)}`];
  if (usesType(model, (t) => isDateTime(t, options.formats))) out.push('import "time"');

  if (model.root.kind !== 'object') {
    const t = goType(model.root, names, options.formats);
    const mixed = mixedNote(model.root);
    const note = model.rootNote ? ` // ${model.rootNote}` : mixed ? ` // ${mixed}` : '';
    // `any` roots need an alias; everything else gets a named type.
    out.push(`type ${rootName} ${t === 'any' ? '= ' : ''}${t}${note}`);
  }

  for (const def of model.objects) {
    const fieldNames = new Namer();
    const rows = def.fields.map((f) => {
      let words = splitWords(f.key);
      if (words.length === 0) words = ['Field'];
      else if (/^[0-9]/.test(words[0])) words = ['Field', ...words];
      const name = fieldNames.claim(goName(words));
      const type = goType(f.type, names, options.formats, f.optional);
      const notes: string[] = [];
      let tag = '';
      if (validTagName(f.key)) {
        const tagName = f.key === '-' ? '-,' : f.key;
        tag = `\`json:"${tagName}${f.optional ? ',omitempty' : ''}"\``;
      } else {
        notes.push(`JSON key ${JSON.stringify(f.key)} cannot be expressed in a Go struct tag`);
      }
      if (f.note) notes.push(f.note);
      else {
        const mixed = mixedNote(f.type);
        if (mixed) notes.push(mixed);
      }
      return [name, type, tag, notes.length ? `// ${notes.join('; ')}` : ''];
    });
    const body = rows.length ? `\n${alignColumns(rows).map((l) => `\t${l}`).join('\n')}\n` : '';
    out.push(`type ${names.get(def)!} struct {${body}}`);
  }
  return `${out.join('\n\n')}\n`;
}
