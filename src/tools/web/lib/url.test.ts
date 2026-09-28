import { describe, expect, it } from 'vitest';
import { buildUrl, partsFromUrl, parseUrl, safeDecode, splitQuery, toDisplayUrl, type ParsedUrl } from './url';
import { hostnameToAscii, hostnameToUnicode, punycodeDecode, punycodeEncode } from './urlPunycode';

function ok(input: string, base?: string): ParsedUrl {
  const r = parseUrl(input, base);
  if (!r || !r.ok) throw new Error(`expected success for ${input}: ${r && !r.ok ? r.error : 'null'}`);
  return r.url;
}

function err(input: string, base?: string): string {
  const r = parseUrl(input, base);
  if (!r || r.ok) throw new Error(`expected failure for ${input}`);
  return r.error;
}

describe('parseUrl', () => {
  it('returns null for empty input', () => {
    expect(parseUrl('')).toBeNull();
    expect(parseUrl('   \n')).toBeNull();
  });

  it('splits a full URL into parts', () => {
    const u = ok('https://user:p%40ss@Example.com:8443/a/b%20c/?q=1&q=2&x#frag%20ment');
    expect(u.protocol).toBe('https:');
    expect(u.scheme).toBe('https');
    expect(u.username).toBe('user');
    expect(u.password).toBe('p@ss');
    expect(u.rawPassword).toBe('p%40ss');
    expect(u.hostname).toBe('example.com');
    expect(u.host).toBe('example.com:8443');
    expect(u.port).toBe('8443');
    expect(u.defaultPort).toBe('443');
    expect(u.origin).toBe('https://example.com:8443');
    expect(u.segments.map((s) => s.decoded)).toEqual(['a', 'b c', '']);
    expect(u.params.map((p) => [p.key, p.value])).toEqual([
      ['q', '1'],
      ['q', '2'],
      ['x', ''],
    ]);
    expect(u.params[2].hasEquals).toBe(false);
    expect(u.hash).toBe('frag ment');
    expect(u.rawHash).toBe('frag%20ment');
    expect(u.hasAuthority).toBe(true);
    expect(u.hostKind).toBe('domain');
  });

  it('drops the default port and reports it', () => {
    const u = ok('http://example.com:80/');
    expect(u.port).toBe('');
    expect(u.defaultPort).toBe('80');
    expect(u.segments).toEqual([]);
  });

  it('handles IP hosts', () => {
    expect(ok('http://192.168.0.1/').hostKind).toBe('ipv4');
    const v6 = ok('http://[::1]:3000/');
    expect(v6.hostKind).toBe('ipv6');
    expect(v6.hostname).toBe('[::1]');
    expect(v6.port).toBe('3000');
  });

  it('shows IDN hosts in Unicode', () => {
    const u = ok('https://münchen.de/straße');
    expect(u.hostname).toBe('xn--mnchen-3ya.de');
    expect(u.hostnameUnicode).toBe('münchen.de');
    expect(u.isIdn).toBe(true);
    expect(u.segments[0].decoded).toBe('straße');
    expect(toDisplayUrl(u)).toBe('https://münchen.de/straße');
  });

  it('handles emoji hosts and paths', () => {
    const u = ok('https://☃.net/😀?e=😀');
    expect(u.hostname).toBe('xn--n3h.net');
    expect(u.hostnameUnicode).toBe('☃.net');
    expect(u.segments[0].decoded).toBe('😀');
    expect(u.params[0].value).toBe('😀');
  });

  it('parses non-hierarchical URLs', () => {
    const m = ok('mailto:someone@example.com?subject=Hi%20there');
    expect(m.hasAuthority).toBe(false);
    expect(m.pathname).toBe('someone@example.com');
    expect(m.params[0]).toMatchObject({ key: 'subject', value: 'Hi there' });
    expect(m.origin).toBe('');
    expect(m.segments).toEqual([]);
  });

  it('resolves relative URLs against a base', () => {
    expect(ok('../img/logo.png?v=2', 'https://example.com/docs/guide/intro.html').href).toBe(
      'https://example.com/docs/img/logo.png?v=2',
    );
    expect(ok('//cdn.example.org/x.js', 'https://example.com/').href).toBe('https://cdn.example.org/x.js');
    expect(ok('?page=2', 'https://example.com/list?page=1#top').href).toBe('https://example.com/list?page=2');
    expect(ok('#section', 'https://example.com/a').href).toBe('https://example.com/a#section');
    expect(ok('/root', 'https://example.com/a/b').href).toBe('https://example.com/root');
    // An absolute input ignores the base.
    expect(ok('https://other.test/', 'https://example.com/').href).toBe('https://other.test/');
  });

  it('explains common errors', () => {
    expect(err('example.com/path')).toMatch(/without a scheme/);
    expect(err('/just/a/path')).toMatch(/relative URL/);
    expect(err('https://example.com:99999/')).toMatch(/out of range/);
    expect(err('https://example.com:abc/')).toMatch(/port must be a number/);
    expect(err('https://')).toMatch(/no host/);
    expect(err('https://exa mple.com/')).toMatch(/not allowed/);
    expect(err('x', 'not a url')).toMatch(/base URL is not valid/);
  });

  it('copes with malformed percent-encoding', () => {
    const u = ok('https://example.com/%E0%A4%A?x=%ZZ&y=%41');
    expect(u.params[0].value).toBe('%ZZ');
    expect(u.params[1].value).toBe('A');
  });

  it('handles very long URLs', () => {
    const long = `https://example.com/?${Array.from({ length: 5000 }, (_, i) => `k${i}=${i}`).join('&')}`;
    expect(ok(long).params).toHaveLength(5000);
  });
});

describe('splitQuery / safeDecode', () => {
  it('treats + as a space and keeps raw forms', () => {
    const [p] = splitQuery('?a+b=c%2Bd');
    expect(p).toEqual({ key: 'a b', value: 'c+d', rawKey: 'a+b', rawValue: 'c%2Bd', hasEquals: true });
  });
  it('skips empty pieces and splits on the first =', () => {
    expect(splitQuery('a=1&&b=x=y&').map((p) => [p.key, p.value])).toEqual([
      ['a', '1'],
      ['b', 'x=y'],
    ]);
    expect(splitQuery('')).toEqual([]);
  });
  it('decodes partial runs', () => {
    expect(safeDecode('%C3%A9 %E2')).toBe('é %E2');
  });
});

describe('buildUrl', () => {
  it('round-trips parsed parts', () => {
    const src = 'https://user:pw@example.com:8080/a/b?x=1&y=hello%20world&flag#top';
    const r = buildUrl(partsFromUrl(ok(src)));
    expect(r).toEqual({ ok: true, href: src });
  });

  it('keeps raw encoding for untouched params and encodes edited ones', () => {
    const parts = partsFromUrl(ok('https://example.com/?a=1+2&b=x'));
    parts.params[1].value = 'x & y';
    const r = buildUrl(parts);
    expect(r).toEqual({ ok: true, href: 'https://example.com/?a=1+2&b=x%20%26%20y' });
  });

  it('builds from scratch with Unicode host and credentials', () => {
    const r = buildUrl({
      protocol: 'https://',
      username: 'a b',
      password: 'p@ss:word',
      hostname: 'bücher.example',
      port: '',
      pathname: 'docs/intro',
      params: [
        { key: 'q', value: 'ümlaut & more' },
        { key: '', value: '' },
      ],
      hash: 'part 2',
    });
    expect(r).toEqual({
      ok: true,
      href: 'https://a%20b:p%40ss%3Aword@xn--bcher-kva.example/docs/intro?q=%C3%BCmlaut%20%26%20more#part%202',
    });
  });

  it('wraps IPv6 hosts and validates ports', () => {
    const base = { protocol: 'http', username: '', password: '', pathname: '/', params: [], hash: '' };
    expect(buildUrl({ ...base, hostname: '::1', port: '3000' })).toEqual({ ok: true, href: 'http://[::1]:3000/' });
    expect(buildUrl({ ...base, hostname: 'a.test', port: '70000' })).toMatchObject({ ok: false });
    expect(buildUrl({ ...base, hostname: 'a.test', port: '8o' })).toMatchObject({ ok: false });
    expect(buildUrl({ ...base, hostname: '', port: '' })).toMatchObject({ ok: false, error: 'Enter a host name.' });
    expect(buildUrl({ ...base, protocol: '', hostname: 'a.test', port: '' })).toMatchObject({ ok: false });
    expect(buildUrl({ ...base, protocol: '1http', hostname: 'a.test', port: '' })).toMatchObject({ ok: false });
  });

  it('builds opaque URLs without an authority', () => {
    const r = buildUrl({ protocol: 'mailto', username: '', password: '', hostname: '', port: '', pathname: 'me@example.com', params: [{ key: 'subject', value: 'Hi there' }], hash: '' });
    expect(r).toEqual({ ok: true, href: 'mailto:me@example.com?subject=Hi%20there' });
  });
});

describe('punycode', () => {
  it('matches RFC 3492 samples', () => {
    expect(punycodeEncode('bücher')).toBe('bcher-kva');
    expect(punycodeDecode('bcher-kva')).toBe('bücher');
    expect(punycodeEncode('他们为什么不说中文')).toBe('ihqwcrb4cv8a8dqg056pqjye');
    expect(punycodeDecode('ihqwcrb4cv8a8dqg056pqjye')).toBe('他们为什么不说中文');
    expect(punycodeDecode('n3h')).toBe('☃');
    expect(punycodeEncode('😀')).toBe('e28h');
  });
  it('converts whole hostnames', () => {
    expect(hostnameToUnicode('www.xn--mnchen-3ya.de')).toBe('www.münchen.de');
    expect(hostnameToAscii('WWW.München.de')).toBe('www.xn--mnchen-3ya.de');
    expect(hostnameToUnicode('xn--!!!.com')).toBe('xn--!!!.com');
    expect(hostnameToUnicode('example.com')).toBe('example.com');
  });
});
