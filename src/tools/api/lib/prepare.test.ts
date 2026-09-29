import { describe, expect, it } from 'vitest';
import { base64Utf8, forbiddenHeaders, prepareRequest } from './prepare';
import { emptyDraft, kv, type RequestDraft } from './model';

const scope = (obj: Record<string, string> = {}) => new Map(Object.entries(obj));

function draft(patch: Partial<RequestDraft> = {}): RequestDraft {
  return { ...emptyDraft(), url: 'https://api.test/x', ...patch };
}

describe('prepareRequest', () => {
  it('requires a URL', () => {
    const r = prepareRequest(draft({ url: '  ' }), scope());
    expect(r.ok).toBe(false);
  });

  it('resolves variables everywhere and adds a scheme', () => {
    const d = draft({
      url: '{{host}}/users?id={{id}}',
      headers: [kv('X-Trace', '{{id}}'), kv('Off', 'x', false)],
      body: { ...emptyDraft().body, mode: 'raw', raw: '{"id": "{{id}}"}', rawLanguage: 'json' },
      method: 'POST',
    });
    const r = prepareRequest(d, scope({ host: 'api.example.com', id: '7' }), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.url).toBe('https://api.example.com/users?id=7');
    expect(r.request.headers).toEqual([
      ['X-Trace', '7'],
      ['Content-Type', 'application/json'],
    ]);
    expect(r.request.body).toEqual({ kind: 'text', text: '{"id": "7"}' });
  });

  it('lists unresolved variables', () => {
    const r = prepareRequest(draft({ url: 'https://{{host}}/{{path}}' }), scope(), null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(['host', 'path']);
    expect(r.error).toMatch(/\{\{host\}\}/);
  });

  it('applies bearer, basic and API key auth', () => {
    const bearer = prepareRequest(draft({ auth: { ...emptyDraft().auth, type: 'bearer', token: '{{t}}' } }), scope({ t: 'abc' }), null);
    expect(bearer.ok && bearer.request.headers).toEqual([['Authorization', 'Bearer abc']]);

    const basic = prepareRequest(draft({ auth: { ...emptyDraft().auth, type: 'basic', username: 'ü', password: 'p' } }), scope(), null);
    expect(basic.ok && basic.request.headers[0][1]).toBe(`Basic ${base64Utf8('ü:p')}`);

    const query = prepareRequest(
      draft({ auth: { ...emptyDraft().auth, type: 'apikey', apiKeyName: 'api key', apiKeyValue: 'a&b', apiKeyIn: 'query' } }),
      scope(),
      null,
    );
    expect(query.ok && query.request.url).toBe('https://api.test/x?api%20key=a%26b');
    expect(query.ok && query.request.authQueryParam).toBe('api key');
  });

  it('auth header replaces a manual header with a warning', () => {
    const r = prepareRequest(
      draft({ headers: [kv('authorization', 'old')], auth: { ...emptyDraft().auth, type: 'bearer', token: 't' } }),
      scope(),
      null,
    );
    expect(r.ok && r.request.headers).toEqual([['Authorization', 'Bearer t']]);
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it('rejects empty bearer tokens, bad header names and line breaks', () => {
    expect(prepareRequest(draft({ auth: { ...emptyDraft().auth, type: 'bearer', token: ' ' } }), scope()).ok).toBe(false);
    expect(prepareRequest(draft({ headers: [kv('Bad Name', 'x')] }), scope()).ok).toBe(false);
    expect(prepareRequest(draft({ headers: [kv('X', 'a{{nl}}b')] }), scope({ nl: '\n' }), null).ok).toBe(false);
  });

  it('rejects header values that HTTP cannot carry', () => {
    const r = prepareRequest(draft({ headers: [kv('X-Name', '👋')] }), scope());
    expect(r.ok).toBe(false);
    expect(prepareRequest(draft({ headers: [kv('X-Name', 'café')] }), scope()).ok).toBe(true);
  });

  it('builds urlencoded bodies', () => {
    const d = draft({ method: 'POST', body: { ...emptyDraft().body, mode: 'urlencoded', urlencoded: [kv('a b', '1&2'), kv('c', 'ü')] } });
    const r = prepareRequest(d, scope(), null);
    expect(r.ok && r.request.body).toEqual({ kind: 'text', text: 'a+b=1%262&c=%C3%BC' });
    expect(r.ok && r.request.headers).toContainEqual(['Content-Type', 'application/x-www-form-urlencoded']);
  });

  it('builds form-data and drops a manual Content-Type', () => {
    const file = new Blob(['x'], { type: 'text/plain' });
    const d = draft({
      method: 'POST',
      headers: [kv('Content-Type', 'multipart/form-data')],
      body: {
        ...emptyDraft().body,
        mode: 'form-data',
        form: [
          { ...kv('name', 'v'), kind: 'text' },
          { ...kv('upload', ''), kind: 'file', file, fileName: 'a.txt' },
        ],
      },
    });
    const r = prepareRequest(d, scope(), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.headers).toEqual([]);
    expect(r.request.body.kind).toBe('form');
    expect(r.warnings[0]).toMatch(/boundary/);
  });

  it('requires chosen files', () => {
    const d = draft({ method: 'POST', body: { ...emptyDraft().body, mode: 'form-data', form: [{ ...kv('f', ''), kind: 'file', file: null, fileName: 'x.png' }] } });
    const r = prepareRequest(d, scope());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/x\.png/);
    expect(prepareRequest(draft({ method: 'PUT', body: { ...emptyDraft().body, mode: 'binary' } }), scope()).ok).toBe(false);
  });

  it('refuses bodies on GET and non-http URLs', () => {
    expect(prepareRequest(draft({ body: { ...emptyDraft().body, mode: 'raw', raw: 'x' } }), scope()).ok).toBe(false);
    expect(prepareRequest(draft({ url: 'ftp://files.test/a' }), scope()).ok).toBe(false);
    expect(prepareRequest(draft({ url: 'https://u:p@a.test/' }), scope()).ok).toBe(false);
    expect(prepareRequest(draft({ url: 'https://exa mple' }), scope()).ok).toBe(false);
  });

  it('supports escaped braces', () => {
    const r = prepareRequest(draft({ method: 'POST', body: { ...emptyDraft().body, mode: 'raw', raw: '\\{{literal}}', rawLanguage: 'text' } }), scope(), null);
    expect(r.ok && r.request.body).toEqual({ kind: 'text', text: '{{literal}}' });
  });
});

describe('forbiddenHeaders', () => {
  it('lists headers browsers refuse to set', () => {
    expect(forbiddenHeaders(['Cookie', 'Host', 'Accept', 'origin', 'Sec-Fetch-Mode', 'Proxy-Foo', 'User-Agent', 'cookie'])).toEqual([
      'Cookie',
      'Host',
      'origin',
      'Sec-Fetch-Mode',
      'Proxy-Foo',
      'User-Agent',
    ]);
  });
});
