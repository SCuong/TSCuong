import { describe, expect, it } from 'vitest';
import { buildExport, parseImport } from './exchange';
import { emptyDraft, kv, type ApiCollection, type ApiEnvironment, type SavedRequest } from './model';

let n = 0;
const newId = () => `id${++n}`;

function fixture() {
  const collection: ApiCollection = {
    id: 'c1',
    name: 'Shop API',
    folders: [{ id: 'f1', name: 'Orders' }],
    variables: [kv('base', 'https://shop.example.com')],
    createdAt: 1,
    updatedAt: 1,
  };
  const request: SavedRequest = {
    ...emptyDraft(),
    name: 'List orders',
    method: 'GET',
    url: '{{base}}/orders',
    headers: [kv('Authorization', 'Bearer SECRET'), kv('Accept', 'application/json')],
    auth: { ...emptyDraft().auth, type: 'basic', username: 'me', password: 'PW' },
    id: 'r1',
    collectionId: 'c1',
    folderId: 'f1',
    favorite: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const env: ApiEnvironment = {
    id: 'e1',
    name: 'Prod',
    variables: [
      { ...kv('token', 'TOKEN'), secret: true },
      { ...kv('region', 'eu'), secret: false },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  return { collection, request, env };
}

describe('LocalKit export format', () => {
  it('round-trips collections, folders, requests and environments with fresh ids', () => {
    const { collection, request, env } = fixture();
    const file = buildExport([collection], [request], [env], true, new Date(0));
    expect(file).toMatchObject({ format: 'localkit-api', version: 1, includesSecrets: true });
    const r = parseImport(JSON.stringify(file), newId, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { collections, requests, environments } = r.result;
    expect(collections[0].name).toBe('Shop API');
    expect(collections[0].id).not.toBe('c1');
    expect(collections[0].folders.map((f) => f.name)).toEqual(['Orders']);
    expect(requests[0]).toMatchObject({ name: 'List orders', url: '{{base}}/orders', favorite: true, collectionId: collections[0].id });
    expect(requests[0].folderId).toBe(collections[0].folders[0].id);
    expect(requests[0].auth.password).toBe('PW');
    expect(environments[0].variables.map((v) => [v.key, v.value, v.secret])).toEqual([
      ['token', 'TOKEN', true],
      ['region', 'eu', false],
    ]);
  });

  it('leaves secrets out unless asked', () => {
    const { collection, request, env } = fixture();
    const text = JSON.stringify(buildExport([collection], [request], [env], false));
    expect(text).not.toMatch(/SECRET|PW|TOKEN/);
    expect(text).toContain('eu');
    const r = parseImport(text, newId);
    expect(r.ok && r.result.warnings.some((w) => /without secrets/.test(w))).toBe(true);
  });

  it('never exports file contents', () => {
    const { collection, request } = fixture();
    request.method = 'POST';
    request.body = { ...request.body, mode: 'form-data', form: [{ ...kv('f', ''), kind: 'file', file: new File(['x'], 'a.png'), fileName: 'a.png' }] };
    const file = buildExport([collection], [request], [], true);
    expect(file.collections[0].requests[0].body.form[0]).toEqual({ key: 'f', value: '', enabled: true, kind: 'file', fileName: 'a.png' });
  });

  it('validates the file', () => {
    expect(parseImport('', newId)).toMatchObject({ ok: false });
    expect(parseImport('{nope', newId)).toMatchObject({ ok: false, error: 'The file is not valid JSON.' });
    expect(parseImport('[]', newId)).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ format: 'localkit-api' }), newId)).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ format: 'localkit-api', version: 99 }), newId)).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ format: 'localkit-api', version: 1, collections: {} }), newId)).toMatchObject({ ok: false });
    expect(parseImport(JSON.stringify({ format: 'localkit-api', version: 1, collections: [5] }), newId)).toMatchObject({ ok: false });
    const bad = parseImport(
      JSON.stringify({ format: 'localkit-api', version: 1, collections: [{ name: 'C', requests: [{ name: 'X', method: 'TRACE', url: 'x' }] }] }),
      newId,
    );
    expect(bad.ok && bad.result.requests).toEqual([]);
    expect(bad.ok && bad.result.warnings[0]).toMatch(/TRACE/);
  });

  it('accepts a UTF-8 BOM and Unicode names', () => {
    const r = parseImport(String.fromCharCode(0xfeff) + JSON.stringify({ format: 'localkit-api', version: 1, collections: [{ name: 'Café ☕', requests: [] }] }), newId);
    expect(r.ok && r.result.collections[0].name).toBe('Café ☕');
  });
});

const postman = {
  info: { name: 'Petstore', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'https://petstore.example.com' }],
  item: [
    {
      name: 'Pets',
      item: [
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            header: [
              { key: 'Content-Type', value: 'application/json' },
              { key: 'X-Off', value: '1', disabled: true },
            ],
            body: { mode: 'raw', raw: '{"name":"Rex"}', options: { raw: { language: 'json' } } },
            url: { raw: '{{baseUrl}}/pets?x=1', host: ['{{baseUrl}}'], path: ['pets'], query: [{ key: 'x', value: '1' }, { key: 'y', value: '2', disabled: true }] },
          },
        },
        {
          name: 'Deep',
          item: [{ name: 'Login', request: { method: 'POST', auth: { type: 'noauth' }, url: '{{baseUrl}}/login', body: { mode: 'urlencoded', urlencoded: [{ key: 'u', value: 'me' }, { key: 'p', value: 'x', disabled: true }] } } }],
        },
      ],
    },
    {
      name: 'Upload',
      request: {
        method: 'PUT',
        auth: { type: 'basic', basic: [{ key: 'username', value: 'a' }, { key: 'password', value: 'b' }] },
        url: '{{baseUrl}}/upload',
        body: { mode: 'formdata', formdata: [{ key: 'note', value: 'hi', type: 'text' }, { key: 'file', type: 'file', src: '/tmp/cat.jpg' }] },
      },
      event: [{ listen: 'test', script: { exec: ['pm.test()'] } }],
    },
    { name: 'Weird', request: { method: 'COPY', url: 'x' } },
    { name: 'Key', request: { method: 'GET', auth: { type: 'apikey', apikey: [{ key: 'key', value: 'k' }, { key: 'value', value: 'v' }, { key: 'in', value: 'query' }] }, url: 'https://x.example.com' } },
  ],
};

describe('Postman v2.1 import', () => {
  const r = parseImport(JSON.stringify(postman), newId, 7);
  if (!r.ok) throw new Error(r.error);
  const { collections, requests, warnings } = r.result;
  const byName = (name: string) => requests.find((q) => q.name === name)!;

  it('creates one collection with variables and one folder level', () => {
    expect(r.result.kind).toBe('postman-collection');
    expect(collections[0].name).toBe('Petstore');
    expect(collections[0].variables.map((v) => [v.key, v.value])).toEqual([['baseUrl', 'https://petstore.example.com']]);
    expect(collections[0].folders.map((f) => f.name)).toEqual(['Pets', 'Pets / Deep']);
    expect(warnings.some((w) => /flattened/.test(w))).toBe(true);
  });

  it('maps requests, headers, raw bodies and params', () => {
    const create = byName('Create pet');
    expect(create.method).toBe('POST');
    expect(create.url).toBe('{{baseUrl}}/pets?x=1');
    expect(create.params.map((p) => [p.key, p.enabled])).toEqual([
      ['x', true],
      ['y', false],
    ]);
    expect(create.headers.map((h) => [h.key, h.enabled])).toEqual([
      ['Content-Type', true],
      ['X-Off', false],
    ]);
    expect(create.body).toMatchObject({ mode: 'raw', raw: '{"name":"Rex"}', rawLanguage: 'json' });
    expect(create.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
    expect(create.folderId).toBe(collections[0].folders[0].id);
  });

  it('maps urlencoded, formdata and auth overrides', () => {
    const login = byName('Login');
    expect(login.auth.type).toBe('none');
    expect(login.body.urlencoded.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['u', 'me', true],
      ['p', 'x', false],
    ]);
    const upload = byName('Upload');
    expect(upload.auth).toMatchObject({ type: 'basic', username: 'a', password: 'b' });
    expect(upload.body.form.map((f) => [f.key, f.kind, f.fileName ?? null])).toEqual([
      ['note', 'text', null],
      ['file', 'file', 'cat.jpg'],
    ]);
    expect(upload.folderId).toBeNull();
    expect(byName('Key').auth).toMatchObject({ type: 'apikey', apiKeyName: 'k', apiKeyValue: 'v', apiKeyIn: 'query' });
  });

  it('skips unsupported methods and warns about scripts', () => {
    expect(requests.some((q) => q.name === 'Weird')).toBe(false);
    expect(warnings.some((w) => /COPY/.test(w))).toBe(true);
    expect(warnings.some((w) => /scripts/.test(w))).toBe(true);
  });

  it('rejects v1 collections', () => {
    const v1 = { ...postman, info: { ...postman.info, schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json' } };
    expect(parseImport(JSON.stringify(v1), newId)).toMatchObject({ ok: false });
  });

  it('imports Postman environments with secret flags', () => {
    const env = parseImport(
      JSON.stringify({ name: 'Dev', values: [{ key: 'token', value: 't', type: 'secret', enabled: true }, { key: 'off', value: '1', enabled: false }] }),
      newId,
    );
    expect(env.ok && env.result.environments[0].variables.map((v) => [v.key, v.secret, v.enabled])).toEqual([
      ['token', true, true],
      ['off', false, false],
    ]);
  });
});
