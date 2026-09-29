import { describe, expect, it } from 'vitest';
import { draftFromCurl, looksLikeCurl, nameFromUrl } from './curlImport';

describe('looksLikeCurl', () => {
  it('detects curl commands', () => {
    expect(looksLikeCurl('curl https://a.test')).toBe(true);
    expect(looksLikeCurl('  curl.exe -X POST x')).toBe(true);
    expect(looksLikeCurl('https://curl.se')).toBe(false);
    expect(looksLikeCurl('curly')).toBe(false);
  });
});

describe('draftFromCurl', () => {
  it('rejects empty input', () => {
    expect(draftFromCurl('  ').ok).toBe(false);
  });

  it('maps method, URL, params, headers and a JSON body', () => {
    const r = draftFromCurl(
      `curl -X PUT 'https://api.example.com/items/1?expand=true' -H 'Accept: application/json' -H 'Content-Type: application/json' --data-raw '{"name":"Zoë 👋"}'`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.draft;
    expect(d.method).toBe('PUT');
    expect(d.url).toBe('https://api.example.com/items/1?expand=true');
    expect(d.params.map((p) => [p.key, p.value])).toEqual([['expand', 'true']]);
    expect(d.headers.map((h) => h.key)).toEqual(['Accept', 'Content-Type']);
    expect(d.body).toMatchObject({ mode: 'raw', raw: '{"name":"Zoë 👋"}', rawLanguage: 'json' });
    expect(d.name).toBe('api.example.com/items/1');
  });

  it('turns Bearer headers and -u into auth settings', () => {
    const bearer = draftFromCurl(`curl https://a.example.com -H 'Authorization: Bearer abc.def'`);
    expect(bearer.ok && bearer.draft.auth).toMatchObject({ type: 'bearer', token: 'abc.def' });
    expect(bearer.ok && bearer.draft.headers).toEqual([]);
    const basic = draftFromCurl('curl -u user:p%ss https://a.example.com');
    expect(basic.ok && basic.draft.auth).toMatchObject({ type: 'basic', username: 'user', password: 'p%ss' });
  });

  it('maps -d key=value pairs to an urlencoded table', () => {
    const r = draftFromCurl(`curl https://a.example.com/login -d 'user=me&note=hello%20world'`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.method).toBe('POST');
    expect(r.draft.body.mode).toBe('urlencoded');
    expect(r.draft.body.urlencoded.map((p) => [p.key, p.value])).toEqual([
      ['user', 'me'],
      ['note', 'hello world'],
    ]);
  });

  it('keeps non key=value -d bodies byte-exact as raw text', () => {
    const r = draftFromCurl(`curl https://a.example.com -d 'just some text'`);
    expect(r.ok && r.draft.body).toMatchObject({ mode: 'raw', raw: 'just some text' });
    expect(r.ok && r.draft.headers.map((h) => h.value)).toEqual(['application/x-www-form-urlencoded']);
  });

  it('maps -F parts and asks to re-select files', () => {
    const r = draftFromCurl(`curl https://a.example.com/up -F 'title=Hi' -F 'file=@/home/me/photo.png'`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.body.mode).toBe('form-data');
    expect(r.draft.body.form.map((f) => [f.key, f.kind, f.value, f.fileName])).toEqual([
      ['title', 'text', 'Hi', undefined],
      ['file', 'file', '', 'photo.png'],
    ]);
    expect(r.warnings.some((w) => w.includes('/home/me/photo.png'))).toBe(true);
  });

  it('parses Windows cmd style commands and -m timeouts', () => {
    const r = draftFromCurl('curl ^"https://a.example.com/x^" ^\n  -H ^"X-Test: 1^" ^\n  -m 5');
    expect(r.ok && r.draft.url).toBe('https://a.example.com/x');
    expect(r.ok && r.draft.timeoutMs).toBe(5000);
  });

  it('rejects unsupported methods with a clear message', () => {
    const r = draftFromCurl('curl -X PROPFIND https://a.example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PROPFIND/);
  });
});

describe('nameFromUrl', () => {
  it('shortens long names and handles invalid URLs', () => {
    expect(nameFromUrl('https://a.example.com/')).toBe('a.example.com');
    expect(nameFromUrl('{{base}}/users')).toBe('{{base}}/users');
    expect(nameFromUrl('')).toBe('Untitled request');
    expect(nameFromUrl(`https://a.example.com/${'x'.repeat(100)}`)).toHaveLength(60);
  });
});
