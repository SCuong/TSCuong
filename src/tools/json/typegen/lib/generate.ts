import { parseJson, positionAt } from '../../lib/json';
import { countFields, inferShape, buildModel, JsonSyntaxError, type NullMode, type TypeModel } from './infer';
import { DEFAULT_EMIT_OPTIONS, type EmitOptions } from './emit/common';
import { emitTypeScript, emitZod } from './emit/typescript';
import { emitGo } from './emit/go';
import { emitRust } from './emit/rust';
import { emitPython } from './emit/python';
import { emitCSharp, emitKotlin } from './emit/csharp';
import { emitJsonSchema } from './emit/jsonSchema';

export type TargetId =
  | 'typescript'
  | 'typescript-type'
  | 'zod'
  | 'go'
  | 'rust'
  | 'python-dataclass'
  | 'python-typeddict'
  | 'python-pydantic'
  | 'csharp'
  | 'kotlin'
  | 'json-schema';

export type TargetOption = 'export' | 'readonly' | 'names' | 'csharpStyle' | 'goPackage';

export interface TargetInfo {
  id: TargetId;
  label: string;
  /** Syntax highlighting mode for the output editor. */
  language: 'typescript' | 'go' | 'rust' | 'python' | 'json' | 'csharp' | 'kotlin';
  filename: string;
  /** Target-specific options shown in the toolbar. */
  options: TargetOption[];
  /** What the date-time switch does for this target. */
  formatsHint: string;
}

export const TARGETS: TargetInfo[] = [
  { id: 'typescript', label: 'TypeScript interfaces', language: 'typescript', filename: 'types.ts', options: ['export', 'readonly'], formatsHint: 'Dates stay strings (JSON has no date type).' },
  { id: 'typescript-type', label: 'TypeScript type aliases', language: 'typescript', filename: 'types.ts', options: ['export', 'readonly'], formatsHint: 'Dates stay strings (JSON has no date type).' },
  { id: 'zod', label: 'Zod schemas', language: 'typescript', filename: 'schemas.ts', options: ['export'], formatsHint: 'Adds .datetime(), .email(), .url() and .uuid() checks.' },
  { id: 'go', label: 'Go structs', language: 'go', filename: 'types.go', options: ['goPackage'], formatsHint: 'Date-time strings become time.Time.' },
  { id: 'rust', label: 'Rust structs (serde)', language: 'rust', filename: 'types.rs', options: ['names'], formatsHint: 'Date-time strings become chrono::DateTime<Utc>.' },
  { id: 'python-dataclass', label: 'Python dataclasses', language: 'python', filename: 'models.py', options: ['names'], formatsHint: 'Dates stay str in dataclasses.' },
  { id: 'python-typeddict', label: 'Python TypedDict', language: 'python', filename: 'models.py', options: [], formatsHint: 'TypedDicts describe raw JSON, so dates stay str.' },
  { id: 'python-pydantic', label: 'Python Pydantic models', language: 'python', filename: 'models.py', options: ['names'], formatsHint: 'Date-time strings become datetime.' },
  { id: 'csharp', label: 'C# (System.Text.Json)', language: 'csharp', filename: 'Models.cs', options: ['csharpStyle', 'names'], formatsHint: 'Date-time strings become DateTimeOffset.' },
  { id: 'kotlin', label: 'Kotlin (kotlinx.serialization)', language: 'kotlin', filename: 'Models.kt', options: ['names'], formatsHint: 'Dates stay String (kotlinx has no built-in date serializer).' },
  { id: 'json-schema', label: 'JSON Schema (2020-12)', language: 'json', filename: 'schema.json', options: [], formatsHint: 'Adds "format" for date-time, date, time, email, URI and UUID strings.' },
];

export function targetInfo(id: TargetId): TargetInfo {
  return TARGETS.find((t) => t.id === id) ?? TARGETS[0];
}

export interface GenerateOptions extends EmitOptions {
  target: TargetId;
  rootName: string;
  nullMode: NullMode;
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  ...DEFAULT_EMIT_OPTIONS,
  target: 'typescript',
  rootName: 'Root',
  nullMode: 'exact',
};

export interface GenerateError {
  message: string;
  line: number;
  column: number;
}

export type GenerateResult =
  | { ok: true; code: string; types: number; fields: number; warnings: string[] }
  | { ok: false; error: GenerateError };

export function emitModel(model: TypeModel, options: GenerateOptions): string {
  switch (options.target) {
    case 'typescript':
      return emitTypeScript(model, options, 'interface');
    case 'typescript-type':
      return emitTypeScript(model, options, 'type');
    case 'zod':
      return emitZod(model, options);
    case 'go':
      return emitGo(model, options);
    case 'rust':
      return emitRust(model, options);
    case 'python-dataclass':
      return emitPython(model, options, 'dataclass');
    case 'python-typeddict':
      return emitPython(model, options, 'typeddict');
    case 'python-pydantic':
      return emitPython(model, options, 'pydantic');
    case 'csharp':
      return emitCSharp(model, options);
    case 'kotlin':
      return emitKotlin(model, options);
    case 'json-schema':
      return emitJsonSchema(model, { formats: options.formats, inline: false });
  }
}

function syntaxError(text: string, error: JsonSyntaxError): GenerateError {
  // The shared parser gives the most precise, browser-independent message.
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed.error;
  const { line, column } = positionAt(text, error.offset);
  return { message: error.message, line, column };
}

/**
 * Returns a generator that remembers the last inferred model, so switching the
 * target language or emit options does not re-parse the input.
 */
export function createTypeGenerator() {
  let cache: { text: string; rootName: string; nullMode: NullMode; model: TypeModel } | null = null;
  return (text: string, options: GenerateOptions): GenerateResult => {
    let model: TypeModel;
    if (cache && cache.text === text && cache.rootName === options.rootName && cache.nullMode === options.nullMode) {
      model = cache.model;
    } else {
      try {
        model = buildModel(inferShape(text), { rootName: options.rootName, nullMode: options.nullMode });
      } catch (error) {
        if (error instanceof JsonSyntaxError) return { ok: false, error: syntaxError(text, error) };
        if (error instanceof RangeError) {
          return { ok: false, error: { message: 'The input is too large or too deeply nested to analyse in this browser.', line: 1, column: 1 } };
        }
        throw error;
      }
      cache = { text, rootName: options.rootName, nullMode: options.nullMode, model };
    }
    const code = emitModel(model, options);
    return { ok: true, code, types: model.objects.length, fields: countFields(model), warnings: model.warnings };
  };
}

/** One-shot generation (tests, simple callers). */
export function generateTypes(text: string, options: Partial<GenerateOptions> = {}): GenerateResult {
  return createTypeGenerator()(text, { ...DEFAULT_GENERATE_OPTIONS, ...options });
}
