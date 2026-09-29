import type { ObjectDef, TypeModel, TypeRef } from '../infer';
import { isAsciiIdentifier } from '../naming';
import { dependencyOrder, nameTypes, type EmitOptions } from './common';

/** Global type names that generated declarations must not shadow (our own output uses Record). */
const TS_RESERVED = new Set([
  'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Array', 'Function', 'Date', 'RegExp', 'Error',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'JSON', 'Math', 'Record', 'Partial', 'Required', 'Readonly',
  'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'Parameters', 'ReturnType', 'InstanceType', 'Awaited',
  'Iterable', 'Iterator', 'PropertyKey', 'ArrayLike', 'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize',
  'NoInfer', 'ThisType', 'Infinity', 'NaN', 'Intl', 'Reflect', 'Proxy', 'Atomics',
]);

export function propertyKey(key: string): string {
  return isAsciiIdentifier(key, true) ? key : JSON.stringify(key);
}

function tsType(t: TypeRef, names: Map<ObjectDef, string>): string {
  let base: string;
  switch (t.kind) {
    case 'unknown':
      return 'unknown';
    case 'null':
      return 'null';
    case 'boolean':
      base = 'boolean';
      break;
    case 'integer':
    case 'number':
      base = 'number';
      break;
    case 'string':
      base = 'string';
      break;
    case 'array': {
      const item = tsType(t.items, names);
      const compound = t.items.kind === 'union' || (t.items.nullable && t.items.kind !== 'null' && t.items.kind !== 'unknown');
      base = compound ? `(${item})[]` : `${item}[]`;
      break;
    }
    case 'object':
      base = names.get(t.def)!;
      break;
    case 'map':
      base = `Record<string, ${tsType(t.values, names)}>`;
      break;
    case 'union':
      base = t.members.map((m) => tsType(m, names)).join(' | ');
      break;
  }
  return t.nullable ? `${base} | null` : base;
}

export function emitTypeScript(model: TypeModel, options: EmitOptions, style: 'interface' | 'type'): string {
  const { names, rootName } = nameTypes(model, TS_RESERVED);
  const exp = options.exportTypes ? 'export ' : '';
  const ro = options.readonly ? 'readonly ' : '';
  const blocks: string[] = [];
  if (model.root.kind !== 'object') {
    const note = model.rootNote ? ` // ${model.rootNote}` : '';
    blocks.push(`${exp}type ${rootName} = ${tsType(model.root, names)};${note}`);
  }
  for (const def of model.objects) {
    const lines = def.fields.map((f) => {
      const note = f.note ? ` // ${f.note}` : '';
      return `  ${ro}${propertyKey(f.key)}${f.optional ? '?' : ''}: ${tsType(f.type, names)};${note}`;
    });
    const body = lines.length ? `{\n${lines.join('\n')}\n}` : '{}';
    const name = names.get(def)!;
    blocks.push(style === 'interface' ? `${exp}interface ${name} ${body}` : `${exp}type ${name} = ${body};`);
  }
  return `${blocks.join('\n\n')}\n`;
}

// --- Zod -----------------------------------------------------------------------------

const ZOD_FORMATS: Record<string, string> = {
  'date-time': '.datetime({ offset: true })',
  date: '.date()',
  time: '.time()',
  email: '.email()',
  uri: '.url()',
  uuid: '.uuid()',
};

function zodType(t: TypeRef, names: Map<ObjectDef, string>, formats: boolean): string {
  let base: string;
  switch (t.kind) {
    case 'unknown':
      return 'z.unknown()';
    case 'null':
      return 'z.null()';
    case 'boolean':
      base = 'z.boolean()';
      break;
    case 'integer':
      base = 'z.number().int()';
      break;
    case 'number':
      base = 'z.number()';
      break;
    case 'string':
      base = `z.string()${formats && t.format ? ZOD_FORMATS[t.format] : ''}`;
      break;
    case 'array':
      base = `z.array(${zodType(t.items, names, formats)})`;
      break;
    case 'object':
      base = `${names.get(t.def)!}Schema`;
      break;
    case 'map':
      base = `z.record(z.string(), ${zodType(t.values, names, formats)})`;
      break;
    case 'union':
      base = `z.union([${t.members.map((m) => zodType(m, names, formats)).join(', ')}])`;
      break;
  }
  return t.nullable ? `${base}.nullable()` : base;
}

export function emitZod(model: TypeModel, options: EmitOptions): string {
  const reserved = new Set([...TS_RESERVED, 'z', 'Z']);
  const { names, rootName } = nameTypes(model, reserved);
  const exp = options.exportTypes ? 'export ' : '';
  const blocks: string[] = ["import { z } from 'zod';"];
  const declare = (name: string, schema: string, note?: string) => {
    blocks.push(
      `${note ? `// ${note}\n` : ''}${exp}const ${name}Schema = ${schema};\n${exp}type ${name} = z.infer<typeof ${name}Schema>;`,
    );
  };
  for (const def of dependencyOrder(model)) {
    const lines = def.fields.map((f) => {
      const t = zodType(f.type, names, options.formats);
      const note = f.note ? ` // ${f.note}` : '';
      return `  ${propertyKey(f.key)}: ${t}${f.optional ? '.optional()' : ''},${note}`;
    });
    declare(names.get(def)!, lines.length ? `z.object({\n${lines.join('\n')}\n})` : 'z.object({})');
  }
  if (model.root.kind !== 'object') declare(rootName, zodType(model.root, names, options.formats), model.rootNote);
  return `${blocks.join('\n\n')}\n`;
}
