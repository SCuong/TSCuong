/**
 * Type inference from sample JSON.
 *
 * 1. `inferShape` streams over the JSON text once and builds a merged "shape":
 *    counts of every JSON kind seen at each position, array items merged into one
 *    shape, object fields with presence counts. It keeps key order, tells `1.0`
 *    (float) from `1` (integer) and applies JSON.parse's last-duplicate-wins rule.
 * 2. `buildModel` turns the shape into named object types plus type references
 *    that the language emitters render.
 */
import { detectFormats, formatFromMask, type StringFormat } from './formats';
import { commonSuffix, itemWords, pascalCase, splitWords } from './naming';

/** Nesting deeper than this is not analysed (summarized as an unknown type). */
export const MAX_DEPTH = 100;

export interface Shape {
  nulls: number;
  bools: number;
  ints: number;
  floats: number;
  strings: number;
  /** Formats every string satisfied (valid when `strings > 0`). */
  formats: number;
  array: { count: number; items: Shape | null } | null;
  object: { count: number; fields: Map<string, { present: number; shape: Shape }> } | null;
  /** Content nested past MAX_DEPTH was skipped. */
  deep: boolean;
}

export function emptyShape(): Shape {
  return { nulls: 0, bools: 0, ints: 0, floats: 0, strings: 0, formats: 0, array: null, object: null, deep: false };
}

/** Merges `from` into `into`. `from` must not be used afterwards (subtrees are adopted, not copied). */
export function mergeShape(into: Shape, from: Shape): void {
  into.nulls += from.nulls;
  into.bools += from.bools;
  into.ints += from.ints;
  into.floats += from.floats;
  if (from.strings) {
    into.formats = into.strings ? into.formats & from.formats : from.formats;
    into.strings += from.strings;
  }
  if (from.array) {
    if (!into.array) into.array = from.array;
    else {
      into.array.count += from.array.count;
      if (from.array.items) {
        if (into.array.items) mergeShape(into.array.items, from.array.items);
        else into.array.items = from.array.items;
      }
    }
  }
  if (from.object) {
    if (!into.object) into.object = from.object;
    else {
      const a = into.object;
      a.count += from.object.count;
      for (const [key, field] of from.object.fields) {
        const existing = a.fields.get(key);
        if (existing) {
          existing.present += field.present;
          mergeShape(existing.shape, field.shape);
        } else a.fields.set(key, field);
      }
    }
  }
  if (from.deep) into.deep = true;
}

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

class ShapeParser {
  private i = 0;
  private readonly n: number;
  deep = false;

  constructor(private readonly text: string) {
    this.n = text.length;
    if (text.charCodeAt(0) === 0xfeff) this.i = 1;
  }

  private fail(message: string): never {
    throw new JsonSyntaxError(message, this.i);
  }

  private ws() {
    const t = this.text;
    while (this.i < this.n) {
      const c = t.charCodeAt(this.i);
      if (c === 32 || c === 10 || c === 13 || c === 9) this.i++;
      else break;
    }
  }

  parse(): Shape {
    this.ws();
    if (this.i >= this.n) this.fail('Input is empty');
    const shape = this.value(0);
    this.ws();
    if (this.i < this.n) this.fail('Unexpected data after the JSON value');
    return shape;
  }

  private value(depth: number): Shape {
    if (this.i >= this.n) this.fail('Unexpected end of input');
    const c = this.text.charCodeAt(this.i);
    if (c === 123 || c === 91) {
      if (depth >= MAX_DEPTH) return this.skipDeep();
      return c === 123 ? this.object(depth + 1) : this.array(depth + 1);
    }
    const shape = emptyShape();
    if (c === 34) {
      const s = this.string();
      shape.strings = 1;
      shape.formats = detectFormats(s);
    } else if (c === 116) {
      this.literal('true');
      shape.bools = 1;
    } else if (c === 102) {
      this.literal('false');
      shape.bools = 1;
    } else if (c === 110) {
      this.literal('null');
      shape.nulls = 1;
    } else if (c === 45 || (c >= 48 && c <= 57)) {
      if (this.number()) shape.floats = 1;
      else shape.ints = 1;
    } else this.fail('Unexpected character');
    return shape;
  }

  private literal(word: string) {
    if (!this.text.startsWith(word, this.i)) this.fail('Invalid literal');
    this.i += word.length;
  }

  /** Scans a number; returns true when it has a fraction or exponent. */
  private number(): boolean {
    const t = this.text;
    let float = false;
    if (t.charCodeAt(this.i) === 45) this.i++;
    const first = t.charCodeAt(this.i);
    if (first === 48) this.i++;
    else if (first >= 49 && first <= 57) {
      while (this.i < this.n && isDigit(t.charCodeAt(this.i))) this.i++;
    } else this.fail('Invalid number');
    if (t.charCodeAt(this.i) === 46) {
      float = true;
      this.i++;
      if (!isDigit(t.charCodeAt(this.i))) this.fail('Invalid number');
      while (this.i < this.n && isDigit(t.charCodeAt(this.i))) this.i++;
    }
    const e = t.charCodeAt(this.i);
    if (e === 101 || e === 69) {
      float = true;
      this.i++;
      const sign = t.charCodeAt(this.i);
      if (sign === 43 || sign === 45) this.i++;
      if (!isDigit(t.charCodeAt(this.i))) this.fail('Invalid number');
      while (this.i < this.n && isDigit(t.charCodeAt(this.i))) this.i++;
    }
    return float;
  }

  private string(): string {
    const t = this.text;
    const start = ++this.i;
    let escaped = false;
    while (true) {
      if (this.i >= this.n) this.fail('Unterminated string');
      const c = t.charCodeAt(this.i);
      if (c === 34) break;
      if (c === 92) {
        escaped = true;
        const e = t.charCodeAt(this.i + 1);
        if (e === 117) {
          if (!/^[0-9a-fA-F]{4}$/.test(t.slice(this.i + 2, this.i + 6))) this.fail('Invalid escape');
          this.i += 6;
          continue;
        }
        // " \ / b f n r t
        if (e !== 34 && e !== 92 && e !== 47 && e !== 98 && e !== 102 && e !== 110 && e !== 114 && e !== 116) {
          this.fail('Invalid escape');
        }
        this.i += 2;
        continue;
      }
      if (c < 32) this.fail('Control character in string');
      this.i++;
    }
    const raw = t.slice(start, this.i);
    this.i++;
    return escaped ? (JSON.parse(`"${raw}"`) as string) : raw;
  }

  private object(depth: number): Shape {
    this.i++;
    const fields = new Map<string, { present: number; shape: Shape }>();
    const shape = emptyShape();
    shape.object = { count: 1, fields };
    this.ws();
    if (this.text.charCodeAt(this.i) === 125) {
      this.i++;
      return shape;
    }
    while (true) {
      this.ws();
      if (this.text.charCodeAt(this.i) !== 34) this.fail('Expected a property name');
      const key = this.string();
      this.ws();
      if (this.text.charCodeAt(this.i) !== 58) this.fail("Expected ':'");
      this.i++;
      this.ws();
      // A repeated key replaces the earlier value (JSON.parse semantics) but keeps its position.
      fields.set(key, { present: 1, shape: this.value(depth) });
      this.ws();
      const c = this.text.charCodeAt(this.i);
      if (c === 44) {
        this.i++;
        continue;
      }
      if (c === 125) {
        this.i++;
        return shape;
      }
      this.fail("Expected ',' or '}'");
    }
  }

  private array(depth: number): Shape {
    this.i++;
    const shape = emptyShape();
    const array: { count: number; items: Shape | null } = { count: 1, items: null };
    shape.array = array;
    this.ws();
    if (this.text.charCodeAt(this.i) === 93) {
      this.i++;
      return shape;
    }
    while (true) {
      this.ws();
      const item = this.value(depth);
      if (array.items) mergeShape(array.items, item);
      else array.items = item;
      this.ws();
      const c = this.text.charCodeAt(this.i);
      if (c === 44) {
        this.i++;
        continue;
      }
      if (c === 93) {
        this.i++;
        return shape;
      }
      this.fail("Expected ',' or ']'");
    }
  }

  /** Skips a container without analysing it (iteratively, so any depth is fine). */
  private skipDeep(): Shape {
    const t = this.text;
    let level = 0;
    while (this.i < this.n) {
      const c = t.charCodeAt(this.i);
      if (c === 34) {
        this.string();
        continue;
      }
      if (c === 123 || c === 91) level++;
      else if (c === 125 || c === 93) {
        level--;
        if (level === 0) {
          this.i++;
          this.deep = true;
          const shape = emptyShape();
          shape.deep = true;
          return shape;
        }
      }
      this.i++;
    }
    this.fail('Unexpected end of input');
  }
}

function isDigit(c: number) {
  return c >= 48 && c <= 57;
}

/**
 * Infers the merged shape of a JSON text. Throws `JsonSyntaxError` for invalid JSON
 * (callers report precise errors with the shared JSON parser).
 */
export function inferShape(text: string): Shape {
  const parser = new ShapeParser(text);
  const shape = parser.parse();
  if (parser.deep) {
    // Deeply nested parts were skipped without full validation; make sure the whole text is valid.
    try {
      JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (error) {
      throw new JsonSyntaxError(error instanceof Error ? error.message : 'Invalid JSON', 0);
    }
  }
  return shape;
}

// --- type model -------------------------------------------------------------------

export type UnknownReason = 'empty-array' | 'empty-object' | 'deep' | 'no-data';

export type TypeRef = (
  | { kind: 'unknown'; reason: UnknownReason }
  | { kind: 'null' }
  | { kind: 'boolean' }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string'; format?: StringFormat }
  | { kind: 'array'; items: TypeRef }
  | { kind: 'object'; def: ObjectDef }
  | { kind: 'map'; values: TypeRef }
  | { kind: 'union'; members: TypeRef[] }
) & { nullable?: boolean };

export interface FieldDef {
  /** The JSON property name, exactly as in the sample. */
  key: string;
  type: TypeRef;
  optional: boolean;
  /** Human note about the inference (e.g. only null was seen). */
  note?: string;
}

export interface ObjectDef {
  id: number;
  /** Name words, unique (case-insensitively) across the model. Emitters apply their own casing. */
  words: string[];
  fields: FieldDef[];
  /** Number of sample objects merged into this type. */
  samples: number;
}

export type NullMode = 'exact' | 'loose' | 'all-optional';

export interface InferOptions {
  /** Name of the root type (any text; converted to words). */
  rootName?: string;
  /**
   * exact: optional when a key is missing somewhere, nullable when null was seen;
   * loose: either condition makes a field both optional and nullable;
   * all-optional: every field is optional.
   */
  nullMode?: NullMode;
}

export interface TypeModel {
  root: TypeRef;
  /** Name words of the root type (used for the root alias or the root object). */
  rootWords: string[];
  /** Object types in first-appearance order (root first). */
  objects: ObjectDef[];
  /** Note about the root type (e.g. empty top-level array). */
  rootNote?: string;
  warnings: string[];
}

interface Hint {
  words: string[];
  parent: ObjectDef | null;
  /** The words already name an array item or map value (nested arrays keep them). */
  item?: boolean;
}

const itemHint = (hint: Hint): Hint => (hint.item ? hint : { words: itemWords(hint.words), parent: hint.parent, item: true });

interface PendingDef extends ObjectDef {
  hints: Hint[];
}

const DYNAMIC_KEY =
  /^(?:-?\d+(?:\.\d+)?|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}(?:[Tt ][0-9:.+Zz-]+)?)$/i;

/** Objects whose keys are all ids, numbers or dates are treated as dictionaries. */
function looksLikeMap(fields: Map<string, unknown>): boolean {
  if (fields.size === 0) return false;
  for (const key of fields.keys()) if (!DYNAMIC_KEY.test(key)) return false;
  return true;
}

function typeSignature(t: TypeRef): string {
  const n = t.nullable ? '?' : '';
  switch (t.kind) {
    case 'string':
      return `s${t.format ? `:${t.format}` : ''}${n}`;
    case 'array':
      return `a(${typeSignature(t.items)})${n}`;
    case 'object':
      return `o${t.def.id}${n}`;
    case 'map':
      return `m(${typeSignature(t.values)})${n}`;
    case 'union':
      return `u(${t.members.map(typeSignature).join('|')})${n}`;
    case 'unknown':
      return `x${n}`;
    default:
      return `${t.kind}${n}`;
  }
}

/** Does the type (or its array items / map values) contain an unknown of this reason? */
function containsUnknown(t: TypeRef, reason: UnknownReason): boolean {
  if (t.kind === 'unknown') return t.reason === reason;
  if (t.kind === 'array') return containsUnknown(t.items, reason);
  if (t.kind === 'map') return containsUnknown(t.values, reason);
  if (t.kind === 'union') return t.members.some((m) => containsUnknown(m, reason));
  return false;
}

export function noteFor(t: TypeRef): string | undefined {
  if (t.kind === 'null') return 'Only null in the sample, so the real type is unknown.';
  if (containsUnknown(t, 'empty-array')) return 'Always an empty array in the sample, so the item type is unknown.';
  if (containsUnknown(t, 'empty-object')) return 'Always an empty object in the sample.';
  if (containsUnknown(t, 'deep')) return 'Nested too deeply to analyse.';
  return undefined;
}

class ModelBuilder {
  private nextId = 1;
  private readonly bySignature = new Map<string, PendingDef>();
  deep = false;

  constructor(private readonly nullMode: NullMode) {}

  typeOf(shape: Shape, hint: Hint): TypeRef {
    const members: TypeRef[] = [];
    if (shape.deep) {
      this.deep = true;
      return { kind: 'unknown', reason: 'deep', nullable: shape.nulls > 0 };
    }
    if (shape.bools) members.push({ kind: 'boolean' });
    if (shape.ints || shape.floats) members.push({ kind: shape.floats ? 'number' : 'integer' });
    if (shape.strings) {
      const format = formatFromMask(shape.formats);
      members.push(format ? { kind: 'string', format } : { kind: 'string' });
    }
    if (shape.array) {
      const items = shape.array.items
        ? this.typeOf(shape.array.items, itemHint(hint))
        : ({ kind: 'unknown', reason: 'empty-array' } as TypeRef);
      members.push({ kind: 'array', items });
    }
    if (shape.object) members.push(this.objectType(shape.object, hint));
    const nullable = shape.nulls > 0;
    if (members.length === 0) return nullable ? { kind: 'null' } : { kind: 'unknown', reason: 'no-data' };
    if (members.some((m) => m.kind === 'unknown')) {
      return { kind: 'unknown', reason: 'deep', nullable };
    }
    if (members.length === 1) return nullable ? { ...members[0], nullable: true } : members[0];
    return { kind: 'union', members, nullable: nullable || undefined };
  }

  private objectType(obj: NonNullable<Shape['object']>, hint: Hint): TypeRef {
    if (obj.fields.size === 0) return { kind: 'map', values: { kind: 'unknown', reason: 'empty-object' } };
    if (looksLikeMap(obj.fields)) {
      const values = emptyShape();
      for (const f of obj.fields.values()) mergeShape(values, f.shape);
      return { kind: 'map', values: this.typeOf(values, itemHint(hint)) };
    }
    const def: PendingDef = { id: this.nextId++, words: [], fields: [], samples: obj.count, hints: [hint] };
    for (const [key, field] of obj.fields) {
      let type = this.typeOf(field.shape, { words: splitWords(key), parent: def });
      let optional = field.present < obj.count;
      if (this.nullMode === 'all-optional') optional = true;
      else if (this.nullMode === 'loose' && (optional || type.nullable) && type.kind !== 'null') {
        optional = true;
        if (type.kind !== 'unknown') type = { ...type, nullable: true };
      }
      const note = noteFor(type);
      def.fields.push(note ? { key, type, optional, note } : { key, type, optional });
    }
    const signature = def.fields
      .map((f) => `${JSON.stringify(f.key)}:${typeSignature(f.type)}${f.optional ? '?' : ''}`)
      .sort()
      .join(',');
    const existing = this.bySignature.get(signature);
    if (existing) {
      existing.hints.push(hint);
      existing.samples += def.samples;
      return { kind: 'object', def: existing };
    }
    this.bySignature.set(signature, def);
    return { kind: 'object', def };
  }
}

function collectObjects(root: TypeRef): PendingDef[] {
  const order: PendingDef[] = [];
  const seen = new Set<number>();
  const visit = (t: TypeRef) => {
    switch (t.kind) {
      case 'object':
        if (seen.has(t.def.id)) return;
        seen.add(t.def.id);
        order.push(t.def as PendingDef);
        for (const f of t.def.fields) visit(f.type);
        return;
      case 'array':
        return visit(t.items);
      case 'map':
        return visit(t.values);
      case 'union':
        return t.members.forEach(visit);
    }
  };
  visit(root);
  return order;
}

const nameKey = (words: readonly string[]) => pascalCase(words).toLowerCase();

function assignNames(defs: PendingDef[], rootWords: string[], root: TypeRef) {
  const taken = new Set<string>();
  const rootDef = root.kind === 'object' ? root.def : null;
  // The root name is claimed first: by the root object, or by the alias for an array/primitive root.
  taken.add(nameKey(rootWords));
  for (const def of defs) {
    if (def === rootDef) {
      def.words = rootWords;
      continue;
    }
    const distinct = [...new Map(def.hints.map((h) => [nameKey(h.words), h])).values()];
    let base = distinct.length > 1 ? commonSuffix(distinct.map((h) => h.words)) : [];
    if (base.length === 0) base = distinct[0].words;
    const parent = def.hints[0].parent;
    if (base.length === 0) base = parent ? [...parent.words, 'Value'] : ['Type'];
    let words = base;
    if (taken.has(nameKey(words)) && parent && parent.words.length) {
      const prefixed = [...parent.words, ...base];
      if (!taken.has(nameKey(prefixed))) words = prefixed;
    }
    if (taken.has(nameKey(words))) {
      let i = 2;
      while (taken.has(nameKey([...base, String(i)]))) i++;
      words = [...base, String(i)];
    }
    taken.add(nameKey(words));
    def.words = words;
  }
}

/** Builds the named type model from an inferred shape. */
export function buildModel(shape: Shape, options: InferOptions = {}): TypeModel {
  const rootWords = splitWords(options.rootName ?? '');
  const words = rootWords.length ? rootWords : ['Root'];
  const builder = new ModelBuilder(options.nullMode ?? 'exact');
  const root = builder.typeOf(shape, { words, parent: null });
  // Items of a top-level array are named after the singular root name (Users → User, Root → RootItem).
  const defs = collectObjects(root);
  assignNames(defs, words, root);
  const warnings: string[] = [];
  if (builder.deep) warnings.push(`Parts nested deeper than ${MAX_DEPTH} levels were not analysed and are typed as unknown.`);
  const objects: ObjectDef[] = defs.map(({ id, words: w, fields, samples }) => ({ id, words: w, fields, samples }));
  // Point references at the clean defs (without naming hints).
  const byId = new Map(objects.map((d) => [d.id, d]));
  const relink = (t: TypeRef): TypeRef => {
    switch (t.kind) {
      case 'object':
        return { ...t, def: byId.get(t.def.id)! };
      case 'array':
        return { ...t, items: relink(t.items) };
      case 'map':
        return { ...t, values: relink(t.values) };
      case 'union':
        return { ...t, members: t.members.map(relink) };
      default:
        return t;
    }
  };
  for (const def of objects) def.fields = def.fields.map((f) => ({ ...f, type: relink(f.type) }));
  const rootRef = relink(root);
  const rootNote = rootRef.kind === 'object' ? undefined : noteFor(rootRef);
  return { root: rootRef, rootWords: words, objects, rootNote, warnings };
}

/** Convenience: infer the model straight from JSON text. */
export function inferModel(text: string, options: InferOptions = {}): TypeModel {
  return buildModel(inferShape(text), options);
}

/** Total number of fields across all object types. */
export function countFields(model: TypeModel): number {
  return model.objects.reduce((n, d) => n + d.fields.length, 0);
}
