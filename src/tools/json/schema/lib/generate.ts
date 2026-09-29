import { parseJson, positionAt } from '../../lib/json';
import { buildModel, inferShape, JsonSyntaxError } from '../../typegen/lib/infer';
import { buildJsonSchema } from '../../typegen/lib/emit/jsonSchema';
import type { TextError } from './validate';

export type GenerateSchemaResult = { ok: true; schema: string } | { ok: false; error: TextError };

/**
 * Infers a draft 2020-12 schema from a sample document: types, required keys
 * (present in every object), nullable values, merged array items and
 * conservatively detected formats (date-time, date, time, email, uri, uuid).
 */
export function generateSchema(text: string): GenerateSchemaResult {
  try {
    const model = buildModel(inferShape(text), { rootName: 'Root', nullMode: 'exact' });
    const schema = buildJsonSchema(model, { formats: true, inline: true });
    return { ok: true, schema: `${JSON.stringify(schema, null, 2)}\n` };
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      const parsed = parseJson(text);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      return { ok: false, error: { message: error.message, ...positionAt(text, error.offset) } };
    }
    if (error instanceof RangeError) {
      return { ok: false, error: { message: 'The document is too large or too deeply nested to analyse.', line: 1, column: 1 } };
    }
    throw error;
  }
}
