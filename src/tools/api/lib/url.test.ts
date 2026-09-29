import { describe, expect, it } from 'vitest';
import { appendQueryParam, ensureScheme, paramsFromUrl, parseQuery, splitUrl, urlWithParams, withParamsFromUrl } from './url';
import { kv } from './model';

describe('splitUrl / parseQuery', () => {
  it('splits base, query and hash', () => {
    expect(splitUrl('https://a.test/p?x=1&y=2#frag')).toEqual({ base: 'https://a.test/p', query: 'x=1&y=2', hash: '#frag' });
    expect(splitUrl('https://a.test/p')).toEqual({ base: 'https://a.test/p', query: null, hash: '' });
    expect(splitUrl('')).toEqual({ base: '', query: null, hash: '' });
  });

  it('parses pairs without decoding and skips empty segments', () => {
    expect(parseQuery('a=1&&b=%20x&flag&c=')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '%20x' },
      { key: 'flag', value: '' },
      { key: 'c', value: '' },
    ]);
    expect(parseQuery(null)).toEqual([]);
  });
});

describe('two-way sync', () => {
  it('builds params from the URL and keeps row ids by position', () => {
    const prev = [kv('a', '1')];
    const next = paramsFromUrl('https://x.test/?a=2&b={{v}}', prev);
    expect(next.map((p) => [p.key, p.value])).toEqual([
      ['a', '2'],
      ['b', '{{v}}'],
    ]);
    expect(next[0].id).toBe(prev[0].id);
  });

  it('keeps disabled rows when the URL changes', () => {
    const disabled = kv('off', '1', false);
    const next = paramsFromUrl('https://x.test/?a=1', [kv('a', '0'), disabled]);
    expect(next).toContainEqual(disabled);
    expect(next.filter((p) => p.enabled)).toHaveLength(1);
  });

  it('rewrites the query from enabled rows and preserves the hash', () => {
    const url = urlWithParams('https://x.test/p?old=1#h', [kv('a', '1'), kv('b', '', true), kv('c', '3', false)]);
    expect(url).toBe('https://x.test/p?a=1&b#h');
  });

  it('removes the ? when no enabled params remain', () => {
    expect(urlWithParams('https://x.test/p?a=1', [kv('a', '1', false)])).toBe('https://x.test/p');
  });

  it('round-trips URL -> params -> URL', () => {
    const url = 'https://x.test/search?q=%E2%9C%93&page=2&tag={{tag}}';
    const params = paramsFromUrl(url, []);
    expect(urlWithParams(url, params)).toBe(url);
  });

  it('keeps Unicode as typed', () => {
    const url = 'https://x.test/?name=héllo 👋';
    expect(urlWithParams(url, paramsFromUrl(url, []))).toBe(url);
  });

  it('withParamsFromUrl returns matching rows', () => {
    const r = withParamsFromUrl('https://x.test/?a=1&b=2');
    expect(r.params.map((p) => p.key)).toEqual(['a', 'b']);
  });
});

describe('ensureScheme', () => {
  it('adds http for local hosts and https otherwise', () => {
    expect(ensureScheme('localhost:3000/api')).toBe('http://localhost:3000/api');
    expect(ensureScheme('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(ensureScheme('192.168.1.2/x')).toBe('http://192.168.1.2/x');
    expect(ensureScheme('api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(ensureScheme('//cdn.test/a')).toBe('https://cdn.test/a');
    expect(ensureScheme('  https://a.test  ')).toBe('https://a.test');
    expect(ensureScheme('')).toBe('');
  });
});

describe('appendQueryParam', () => {
  it('encodes and appends', () => {
    expect(appendQueryParam('https://x.test/p?a=1#h', 'api key', 'v&1')).toBe('https://x.test/p?a=1&api%20key=v%261#h');
    expect(appendQueryParam('https://x.test/p', 'k', 'v')).toBe('https://x.test/p?k=v');
  });
});
