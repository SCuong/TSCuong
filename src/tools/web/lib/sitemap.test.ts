import { describe, expect, it } from 'vitest';
import { buildSitemap, depthPriority, escapeXml, isValidW3cDate, todayIso, toXml, MAX_URLS, type SitemapOptions } from './sitemap';

const opts = (o: Partial<SitemapOptions> = {}): SitemapOptions => ({
  baseUrl: '',
  lastmod: 'none',
  lastmodValue: '2026-09-29',
  changefreq: 'none',
  priority: 'none',
  priorityValue: 0.5,
  removeDuplicates: true,
  stripFragments: true,
  ...o,
});

describe('helpers', () => {
  it('escapes XML', () => {
    expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });
  it('validates W3C dates', () => {
    expect(isValidW3cDate('2026-09-29')).toBe(true);
    expect(isValidW3cDate('2026')).toBe(true);
    expect(isValidW3cDate('2026-09')).toBe(true);
    expect(isValidW3cDate('2026-09-29T10:00:00+02:00')).toBe(true);
    expect(isValidW3cDate('2026-09-29T10:00Z')).toBe(true);
    expect(isValidW3cDate('2026-02-30')).toBe(false);
    expect(isValidW3cDate('2026-09-29T10:00:00')).toBe(false);
    expect(isValidW3cDate('29/09/2026')).toBe(false);
    expect(isValidW3cDate('')).toBe(false);
  });
  it('formats today and depth priority', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(depthPriority(new URL('https://e.com/'))).toBe(1);
    expect(depthPriority(new URL('https://e.com/a'))).toBe(0.8);
    expect(depthPriority(new URL('https://e.com/a/b/'))).toBe(0.6);
    expect(depthPriority(new URL('https://e.com/a/b/c/d/e/f'))).toBe(0.1);
  });
});

describe('buildSitemap', () => {
  it('generates valid XML with options', () => {
    const r = buildSitemap('https://example.com/\nhttps://example.com/blog/post?a=1&b=2', opts({ lastmod: 'date', changefreq: 'weekly', priority: 'depth' }));
    expect(r.errors).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>https://example.com/</loc>',
        '    <lastmod>2026-09-29</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>1.0</priority>',
        '  </url>',
        '  <url>',
        '    <loc>https://example.com/blog/post?a=1&amp;b=2</loc>',
        '    <lastmod>2026-09-29</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.6</priority>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n'),
    );
    expect(r.bytes).toBe(new TextEncoder().encode(r.xml).length);
    const doc = new DOMParser().parseFromString(r.xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.getElementsByTagName('loc')[1].textContent).toBe('https://example.com/blog/post?a=1&b=2');
  });

  it('percent-encodes Unicode and emoji URLs', () => {
    const r = buildSitemap('https://münchen.example/straße?q=😀', opts());
    expect(r.entries[0].loc).toBe('https://xn--mnchen-3ya.example/stra%C3%9Fe?q=%F0%9F%98%80');
  });

  it('reports relative, invalid and non-http URLs per line', () => {
    const r = buildSitemap('/about\n\n# comment\nhttps://exa mple.com\nftp://example.com/file\nhttps://example.com/ok', opts());
    expect(r.entries.map((e) => e.loc)).toEqual(['https://example.com/ok']);
    expect(r.issues.map((i) => [i.line, i.level])).toEqual([
      [1, 'error'],
      [4, 'error'],
      [5, 'error'],
    ]);
    expect(r.issues[0].message).toMatch(/Relative URL/);
  });

  it('resolves relative paths against a base URL', () => {
    const r = buildSitemap('/\nabout\n/blog/', opts({ baseUrl: 'https://example.com/' }));
    expect(r.entries.map((e) => e.loc)).toEqual(['https://example.com/', 'https://example.com/about', 'https://example.com/blog/']);
    expect(buildSitemap('/', opts({ baseUrl: 'nope' })).errors[0]).toMatch(/base URL/);
    expect(buildSitemap('/', opts({ baseUrl: 'ftp://x.test/' })).errors[0]).toMatch(/http/);
  });

  it('handles duplicates and fragments', () => {
    const text = 'https://e.com/a#x\nhttps://e.com/a\nhttps://e.com/a';
    const dedup = buildSitemap(text, opts());
    expect(dedup.entries).toHaveLength(1);
    expect(dedup.issues.filter((i) => /Duplicate/.test(i.message))).toHaveLength(2);
    const keep = buildSitemap(text, opts({ removeDuplicates: false, stripFragments: false }));
    expect(keep.entries).toHaveLength(3);
    expect(keep.issues.map((i) => i.message)).toEqual(['Contains a #fragment, which search engines ignore.', 'Duplicate URL.']);
  });

  it('warns about other hosts and mixed schemes', () => {
    const r = buildSitemap('https://a.com/\nhttps://b.com/\nhttp://a.com/x', opts());
    expect(r.issues.filter((i) => /Different host/.test(i.message))).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/mixes http/);
    expect(r.xml).not.toBe('');
  });

  it('validates options', () => {
    expect(buildSitemap('https://e.com/', opts({ lastmod: 'date', lastmodValue: '2026-13-01' })).errors[0]).toMatch(/W3C date/);
    expect(buildSitemap('https://e.com/', opts({ priority: 'fixed', priorityValue: 1.5 })).errors[0]).toMatch(/between/);
    const fixed = buildSitemap('https://e.com/', opts({ priority: 'fixed', priorityValue: 0.75 }));
    expect(fixed.xml).toContain('<priority>0.8</priority>');
  });

  it('returns empty output for empty input', () => {
    const r = buildSitemap('  \n', opts());
    expect(r).toMatchObject({ entries: [], issues: [], errors: [], xml: '', bytes: 0 });
  });

  it('enforces the 50,000 URL limit', () => {
    const text = Array.from({ length: MAX_URLS + 1 }, (_, i) => `https://e.com/p${i}`).join('\n');
    const r = buildSitemap(text, opts());
    expect(r.entries).toHaveLength(MAX_URLS + 1);
    expect(r.errors[0]).toMatch(/at most 50,000/);
    expect(r.xml).toBe('');
  });

  it('toXml escapes all fields', () => {
    expect(toXml([{ loc: "https://e.com/?a='1'&b=<2>" }])).toContain("<loc>https://e.com/?a=&apos;1&apos;&amp;b=&lt;2&gt;</loc>");
  });
});
