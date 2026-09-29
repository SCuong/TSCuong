import { describe, expect, it } from 'vitest';
import { runValidation, MAX_ISSUES, type ValidationJob, type ValidationRun } from './validate';
import { SCHEMA_SAMPLES } from './samples';
import { resolveDraft, draftFromUri } from './drafts';

const json = (v: unknown) => JSON.stringify(v, null, 2);

function check(doc: unknown, schema: unknown, options: Partial<ValidationJob> = {}): ValidationRun {
  return runValidation({
    doc: typeof doc === 'string' ? doc : json(doc),
    schema: typeof schema === 'string' ? schema : json(schema),
    draft: 'auto',
    formats: true,
    ...options,
  });
}

const summary = (run: ValidationRun) => run.issues.map((i) => `${i.keyword} ${i.instancePath || '(root)'}: ${i.message}`);
const problems = (run: ValidationRun, severity: 'error' | 'warning') =>
  run.problems.filter((p) => p.severity === severity).map((p) => `${p.pointer}: ${p.message}`);

describe('samples', () => {
  const sample = (id: string) => SCHEMA_SAMPLES.find((s) => s.id === id)!;
  const runSample = (id: string) => runValidation({ doc: sample(id).doc, schema: sample(id).schema, draft: 'auto', formats: true });

  it('user profile (2020-12) reports every problem once, in document order', () => {
    const run = runSample('user');
    expect(run.outcome).toBe('invalid');
    expect([run.draft, run.draftSource]).toEqual(['2020-12', 'declared']);
    expect(summary(run)).toEqual([
      'format /email: "ada.lovelace@" is not a valid email address.',
      'enum /role: "owner" is not one of the allowed values: "admin", "editor", "viewer".',
      'minimum /age: Must be at least 13, but is 12.',
      'uniqueItems /tags: Items must be unique, but items 0 and 2 are equal.',
      'pattern /tags/1: "Engines" does not match the pattern /^[a-z0-9-]+$/.',
      'pattern /address/country: "uk" does not match the pattern /^[A-Z]{2}$/.',
      'additionalProperties /nickname: Property "nickname" is not allowed.',
    ]);
  });

  it('order (draft-07) is valid', () => {
    const run = runSample('order');
    expect(run.outcome).toBe('valid');
    expect(run.draft).toBe('7');
    expect(run.problems).toEqual([]);
  });

  it('config (draft-04) uses boolean exclusiveMinimum and ignores declared-but-failing properties', () => {
    const run = runSample('config');
    expect(run.draft).toBe('4');
    expect(summary(run)).toEqual([
      'minimum /port: Must be greater than 0, but is 0.',
      'format /hosts/1: "bad host!" is not a valid hostname.',
      'minimum /timeouts/readMs: Must be at least 0, but is -1.',
      'additionalProperties /timeouts/retry: Property "retry" is not allowed.',
    ]);
  });

  it('event explains anyOf options, closed tuples and if/then', () => {
    const run = runSample('event');
    expect(summary(run)).toEqual([
      'required (root): Missing required property "price".',
      'anyOf /location: Does not match any of the 2 allowed schemas (anyOf).',
      'items /slot/2: Item 2 is not allowed here (the array has too many items).',
      'format /ticketUrl: "tickets.example.com" is not a valid absolute URI.',
    ]);
    const anyOf = run.issues[1];
    expect(anyOf.details?.map((d) => [d.label, d.issues.map((i) => i.message)])).toEqual([
      ['Option 1', ['Expected string, but found an object.']],
      ['Option 2', ['Must be at most 180, but is 200.']],
    ]);
    expect(anyOf.details?.[1].issues[0].at).toMatchObject({ line: 5 });
  });

  it('points every issue at the document and at the schema keyword', () => {
    const run = runSample('user');
    const email = run.issues[0];
    expect(email.at).toEqual({ line: 3, column: 12, length: 15 });
    expect(email.schemaPointer).toBe('/properties/email/format');
    expect(email.schemaAt).toMatchObject({ line: 20 });
    const extra = run.issues[6];
    // Properties that are not allowed are highlighted by their name.
    expect(extra.at).toEqual({ line: 17, column: 3, length: 10 });
    const country = run.issues[5];
    expect(country.schemaPointer).toBe('/$defs/address/properties/country/pattern');
  });
});

describe('drafts', () => {
  it('detects the draft from $schema', () => {
    expect(draftFromUri('http://json-schema.org/draft-04/schema#')?.draft).toBe('4');
    expect(draftFromUri('http://json-schema.org/draft-06/schema#')).toMatchObject({ draft: '7', name: 'draft-06' });
    expect(draftFromUri('http://json-schema.org/draft-07/schema')?.draft).toBe('7');
    expect(draftFromUri('https://json-schema.org/draft/2019-09/schema')?.draft).toBe('2019-09');
    expect(draftFromUri('https://json-schema.org/draft/2020-12/schema')?.draft).toBe('2020-12');
    expect(draftFromUri('http://json-schema.org/draft-03/schema#')).toMatchObject({ draft: '4', name: 'draft-03' });
    expect(draftFromUri('https://example.com/my-meta')).toBeNull();
  });

  it('defaults to 2020-12 and explains unknown or mismatched declarations', () => {
    expect(resolveDraft({}, 'auto')).toEqual({ draft: '2020-12', source: 'default', notes: [] });
    expect(resolveDraft(true, 'auto').draft).toBe('2020-12');
    expect(resolveDraft({ $schema: 'https://example.com/meta' }, 'auto').notes[0]).toMatch(/Unrecognized "\$schema"/);
    const mismatch = resolveDraft({ $schema: 'http://json-schema.org/draft-07/schema#' }, '2020-12');
    expect(mismatch).toMatchObject({ draft: '2020-12', source: 'selected' });
    expect(mismatch.notes[0]).toMatch(/declares draft-07/);
    expect(resolveDraft({ $schema: 'http://json-schema.org/draft-06/schema#' }, 'auto').notes[0]).toMatch(/Draft 6/);
  });

  it('draft 4: exclusiveMinimum is a flag; a numeric one is ignored with a warning', () => {
    const schema = { $schema: 'http://json-schema.org/draft-04/schema#', minimum: 5, exclusiveMinimum: true };
    expect(summary(check(5, schema))).toEqual(['minimum (root): Must be greater than 5, but is 5.']);
    expect(check(6, schema).outcome).toBe('valid');
    const numeric = check(5, { minimum: 1, exclusiveMinimum: 5 }, { draft: '4' });
    expect(numeric.outcome).toBe('valid');
    expect(problems(numeric, 'warning')[0]).toMatch(/draft 4, "exclusiveMinimum" is a true\/false flag/);
  });

  it('draft 2020-12: boolean exclusiveMinimum is a schema error', () => {
    const run = check(5, { minimum: 5, exclusiveMinimum: true });
    expect(run.outcome).toBe('skipped');
    expect(problems(run, 'error')[0]).toMatch(/Since draft 6, "exclusiveMinimum" is a number/);
    expect(summary(check(5, { exclusiveMinimum: 5 }))).toEqual(['exclusiveMinimum (root): Must be greater than 5, but is 5.']);
  });

  it('draft 7 ignores keywords next to $ref (with a warning); 2019-09 applies them', () => {
    const schema = { definitions: { n: { type: 'number' } }, properties: { a: { $ref: '#/definitions/n', minimum: 10 } } };
    const d7 = check({ a: 1 }, schema, { draft: '7' });
    expect(d7.outcome).toBe('valid');
    expect(problems(d7, 'warning')[0]).toMatch(/keywords next to "\$ref" are ignored \("minimum"\)/);
    const d2019 = check({ a: 1 }, schema, { draft: '2019-09' });
    expect(summary(d2019)).toEqual(['minimum /a: Must be at least 10, but is 1.']);
  });

  it('2020-12 closes tuples with prefixItems and items: false', () => {
    const schema = { prefixItems: [{ type: 'integer' }, { type: 'string' }], items: false };
    expect(check([1, 'a'], schema).outcome).toBe('valid');
    expect(summary(check([1, 'a', true], schema))).toEqual(['items /2: Item 2 is not allowed here (the array has too many items).']);
    expect(summary(check(['x'], schema))).toEqual(['type /0: Expected integer, but found the string "x".']);
  });

  it('2019-09 supports dependentRequired and unevaluatedProperties', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2019-09/schema',
      allOf: [{ properties: { a: { type: 'string' } } }],
      properties: { b: { type: 'number' } },
      dependentRequired: { b: ['a'] },
      unevaluatedProperties: false,
    };
    expect(summary(check({ b: 1, c: true }, schema))).toEqual([
      'dependentRequired (root): Property "a" is required when "b" is present.',
      'unevaluatedProperties /c: Property "c" is not allowed.',
    ]);
    expect(check({ a: 'x', b: 1 }, schema).outcome).toBe('valid');
  });
});

describe('document and schema problems are separated', () => {
  it('reports a document parse error without touching the schema', () => {
    const run = check('{"a": 1,}', { type: 'object' });
    expect(run.docError).toMatchObject({ line: 1 });
    expect(run.docError?.message).toMatch(/Trailing comma/);
    expect(run.schemaError).toBeNull();
    expect(run.outcome).toBe('skipped');
  });

  it('reports a schema parse error without touching the document', () => {
    const run = check({ a: 1 }, '{\n  "type": "object"\n  "required": []\n}');
    expect(run.schemaError).toMatchObject({ line: 3 });
    expect(run.docError).toBeNull();
    expect(run.outcome).toBe('skipped');
  });

  it('reports both when both are broken, and nothing when both are empty', () => {
    const both = check('[1', '{');
    expect(both.docError).not.toBeNull();
    expect(both.schemaError).not.toBeNull();
    const empty = check('', '   ');
    expect([empty.docError, empty.schemaError, empty.outcome]).toEqual([null, null, 'skipped']);
  });

  it('checks the schema even when there is no document yet', () => {
    const run = check('', { type: 'strng' });
    expect(run.outcome).toBe('skipped');
    expect(problems(run, 'error')[0]).toBe('/type: "strng" is not a JSON Schema type. Did you mean "string"? Use one of: string, number, integer, boolean, object, array, null.');
    expect(run.problems[0].at).toMatchObject({ line: 2 });
  });
});

describe('schema checks', () => {
  const errorsOf = (schema: unknown) => problems(check({}, schema), 'error');
  const warningsOf = (schema: unknown, options: Partial<ValidationJob> = {}) => problems(check({}, schema, options), 'warning');

  it('catches schemas written as strings', () => {
    expect(errorsOf({ properties: { age: 'integer' } })).toEqual([
      '/properties/age: A schema must be an object, true or false, but this is the string "integer". Did you mean {"type": "integer"}?',
    ]);
    expect(errorsOf([1])[0]).toMatch(/this is an array/);
  });

  it('catches wrong keyword types', () => {
    expect(errorsOf({ required: true })[0]).toMatch(/boolean form is from draft 3/);
    expect(errorsOf({ required: ['a', 1] })[0]).toMatch(/"required" must be an array of property names/);
    expect(errorsOf({ enum: 'a' })[0]).toMatch(/"enum" must be an array/);
    expect(errorsOf({ minLength: -1 })[0]).toMatch(/"minLength" must be a whole number/);
    expect(errorsOf({ multipleOf: 0 })[0]).toMatch(/greater than 0/);
    expect(errorsOf({ anyOf: [] })[0]).toMatch(/non-empty array/);
    expect(errorsOf({ properties: [] })[0]).toMatch(/"properties" must be an object/);
    expect(errorsOf({ type: [] })[0]).toMatch(/must not be an empty array/);
    expect(errorsOf({ items: 'x' })[0]).toMatch(/"items" must be a schema/);
    expect(errorsOf({ format: 5 })[0]).toMatch(/"format" must be a string/);
    expect(errorsOf({ dependentRequired: { a: 'b' } })[0]).toMatch(/dependentRequired/);
  });

  it('catches invalid regular expressions', () => {
    expect(errorsOf({ pattern: '([a-z]' })[0]).toMatch(/^\/pattern: Invalid regular expression in "pattern"/);
    expect(errorsOf({ patternProperties: { '*x': {} } })[0]).toMatch(/^\/patternProperties\/\*x: Invalid regular expression/);
  });

  it('catches unresolvable references with suggestions', () => {
    expect(errorsOf({ definitions: { Address: {} }, $ref: '#/definitions/Adress' })).toEqual([
      '/$ref: "$ref": "#/definitions/Adress" points to nothing in this schema. Did you mean "#/definitions/Address"?',
    ]);
    expect(errorsOf({ $ref: 'https://example.com/other.json' })[0]).toMatch(/refers to another document/);
    expect(errorsOf({ $defs: { a: { $id: 'https://x.test/a' }, b: { $id: 'https://x.test/a' } } })[0]).toMatch(/same "\$id"/);
  });

  it('resolves $id, anchors and nested references', () => {
    const schema = {
      $id: 'https://example.com/root.json',
      $defs: { pos: { $anchor: 'positive', type: 'number', exclusiveMinimum: 0 }, list: { type: 'array', items: { $ref: '#positive' } } },
      properties: { a: { $ref: '#/$defs/list' }, b: { $ref: 'root.json#/$defs/pos' } },
    };
    const run = check({ a: [1, -2], b: 0 }, schema);
    expect(run.problems).toEqual([]);
    expect(summary(run)).toEqual(['exclusiveMinimum /a/1: Must be greater than 0, but is -2.', 'exclusiveMinimum /b: Must be greater than 0, but is 0.']);
    expect(run.issues[0].schemaPointer).toBe('/$defs/pos/exclusiveMinimum');
  });

  it('warns about likely keyword typos and misplaced properties, not custom annotations', () => {
    expect(warningsOf({ type: 'object', requried: ['a'], maxlength: 3, 'x-internal': true, nullable: true, myNote: 'hi' })).toEqual([
      '/requried: Unknown keyword "requried" is ignored. Did you mean "required"?',
      '/maxlength: Unknown keyword "maxlength" is ignored. Did you mean "maxLength"?',
    ]);
  });

  it('warns about unknown formats only when formats are checked', () => {
    expect(warningsOf({ format: 'phone' })[0]).toMatch(/Format "phone" is not checked/);
    expect(warningsOf({ format: 'phone' }, { formats: false })).toEqual([]);
  });

  it('warns that $dynamicRef is not supported', () => {
    expect(warningsOf({ $dynamicAnchor: 'node' })[0]).toMatch(/"\$dynamicAnchor" is not supported/);
  });

  it('accepts boolean schemas', () => {
    expect(check({ a: 1 }, true).outcome).toBe('valid');
    expect(summary(check({ a: 1 }, false))).toEqual(['false (root): No value is allowed here (the schema is false).']);
  });
});

describe('messages', () => {
  it('explains common keywords', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'integer' },
        s: { type: 'string', minLength: 3, maxLength: 4 },
        e: { type: 'string', maxLength: 2 },
        c: { const: 'x' },
        m: { multipleOf: 0.5 },
        l: { type: 'array', minItems: 2, contains: { type: 'string' } },
        o: { type: 'object', maxProperties: 1 },
        p: { type: 'object', propertyNames: { pattern: '^[a-z]+$' } },
        x: { not: { type: 'null' } },
        one: { oneOf: [{ type: 'number' }, { type: 'integer' }] },
        mx: { maximum: 3, exclusiveMaximum: 3 },
      },
      required: ['zz'],
    };
    const doc = { n: 1.5, s: 'ab', e: '😀😀😀', c: 'y', m: 0.3, l: [1], o: { a: 1, b: 2 }, p: { Bad: 1 }, x: null, one: 2, mx: 3 };
    expect(summary(check(doc, schema))).toEqual([
      'required (root): Missing required property "zz".',
      'type /n: Expected integer, but found the number 1.5.',
      'minLength /s: Must be at least 3 characters long, but has 2.',
      'maxLength /e: Must be at most 2 characters long, but has 3.',
      'const /c: Must be exactly "x", but found "y".',
      'multipleOf /m: Must be a multiple of 0.5, but is 0.3.',
      'minItems /l: Must have at least 2 items, but has 1.',
      'contains /l: No item matches the "contains" schema.',
      'maxProperties /o: Must have at most 1 property, but has 2.',
      'propertyNames /p/Bad: Property name "Bad" is not allowed: "Bad" does not match the pattern /^[a-z]+$/.',
      'not /x: Must not match the "not" schema, but it does.',
      'oneOf /one: Matches 2 of the options (options 1 and 2), but exactly one must match (oneOf).',
      'exclusiveMaximum /mx: Must be less than 3, but is 3.',
    ]);
  });

  it('handles Unicode, slashes and tildes in property names', () => {
    const run = check({ '名前': 1, 'a/b~c': 2 }, { properties: { 'a/b~c': { type: 'string' } }, additionalProperties: false });
    expect(summary(run)).toEqual([
      'additionalProperties /名前: Property "名前" is not allowed.',
      'type /a~1b~0c: Expected string, but found the integer 2.',
    ]);
    expect(run.issues[0].at).toEqual({ line: 2, column: 3, length: 4 });
    expect(run.issues[1].at).toMatchObject({ line: 3 });
  });

  it('can skip format checks', () => {
    const schema = { type: 'string', format: 'email' };
    expect(check('"nope"', schema).outcome).toBe('invalid');
    expect(check('"nope"', schema, { formats: false }).outcome).toBe('valid');
  });
});

describe('robustness', () => {
  it('turns a $ref loop into a clear failure instead of a crash', () => {
    const run = check({ a: 1 }, { $ref: '#' });
    expect(run.outcome).toBe('failed');
    expect(run.failure).toMatch(/loops back to itself/);
  });

  it('truncates very long error lists but keeps the total', () => {
    const doc = Array.from({ length: 3000 }, (_, i) => ({ id: String(i) }));
    const run = check(doc, { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } } } });
    expect(run.totalIssues).toBe(3000);
    expect(run.issues).toHaveLength(MAX_ISSUES);
    expect(run.issues[0]).toMatchObject({ instancePath: '/0/id', at: { line: 3 } });
  });

  it('validates a large valid document', () => {
    const doc = Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `n${i}`, tags: ['a', 'b'] }));
    const schema = {
      type: 'array',
      items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
    };
    const run = check(JSON.stringify(doc), schema);
    expect(run.outcome).toBe('valid');
  });
});
