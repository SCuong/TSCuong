import { describe, expect, it } from 'vitest';
import { format as FORMATS } from '@cfworker/json-schema';
import { generateSchema } from './generate';
import { runValidation } from './validate';
import { SCHEMA_SAMPLES } from './samples';
import { detectFormats, formatFromMask } from '../../typegen/lib/formats';

function generated(doc: string): Record<string, unknown> {
  const r = generateSchema(doc);
  if (!r.ok) throw new Error(r.error.message);
  return JSON.parse(r.schema);
}

const roundTrip = (doc: string) => {
  const r = generateSchema(doc);
  if (!r.ok) throw new Error(r.error.message);
  return runValidation({ doc, schema: r.schema, draft: 'auto', formats: true });
};

describe('generateSchema', () => {
  it('infers types, required keys, nullability and formats (draft 2020-12)', () => {
    const schema = generated(
      JSON.stringify([
        { id: 1, email: 'a@example.com', at: '2024-01-01T10:00:00Z', tags: ['x'], score: null, meta: { ok: true } },
        { id: 2, email: 'b@example.com', at: '2024-01-02T10:00:00+01:00', tags: [], score: 1.5 },
      ]),
    );
    expect(schema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          at: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
          score: { type: ['number', 'null'] },
          meta: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        },
        required: ['id', 'email', 'at', 'tags', 'score'],
      },
    });
  });

  it('handles primitives, empty containers and mixed values', () => {
    expect(generated('"hello"')).toEqual({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' });
    expect(generated('[]')).toMatchObject({ type: 'array', items: {}, $comment: expect.stringMatching(/empty array/) });
    expect(generated('{}')).toMatchObject({ type: 'object' });
    expect(generated('[1, "a", null, {"x": 1}]')).toMatchObject({
      items: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'object' }, { type: 'null' }] },
    });
  });

  it('reports invalid JSON with a position', () => {
    const r = generateSchema('{\n  "a": [1, 2\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBeGreaterThanOrEqual(2);
  });

  it.each(SCHEMA_SAMPLES.map((s) => [s.id, s.doc]))('the schema generated from the %s sample accepts it', (_id, doc) => {
    const run = roundTrip(doc);
    expect(run.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(run.outcome).toBe('valid');
  });

  it('accepts its own source for awkward documents', () => {
    const docs = [
      '{"__proto__": {"a": 1}, "": null, "a/b": [], "名前": "x", "🚀": [1.5, 2]}',
      '[[1, [2, [3]]], [], [[]]]',
      '{"dup": 1, "dup": "two"}',
      JSON.stringify({ when: ['2024-02-29', '2023-12-31'], ids: ['123e4567-e89b-12d3-a456-426614174000'], url: 'https://x.io/a?b=c#d' }),
      JSON.stringify(Array.from({ length: 500 }, (_, i) => (i % 3 ? { n: i, s: `v${i}` } : { n: i / 7, extra: [i] }))),
    ];
    for (const doc of docs) expect(roundTrip(doc).outcome, doc.slice(0, 60)).toBe('valid');
  });

  it('only emits formats that the validator itself accepts', () => {
    const samples = [
      '2024-03-18T09:30:00Z', '2024-03-18T09:30:00.5-05:30', '2024-02-29', '23:59:59Z', 'first.last+tag@mail.example.co.uk',
      'https://example.com/a/b?c=d#e', 'ftp://files.example.com/pub', '123E4567-E89B-12D3-A456-426614174000',
    ];
    for (const s of samples) {
      const detected = formatFromMask(detectFormats(s));
      expect(detected, s).toBeDefined();
      expect(FORMATS[detected!](s), `${s} as ${detected}`).toBe(true);
    }
  });
});
