import { describe, expect, it } from 'vitest';
import {
  DEFAULT_META,
  LENGTHS,
  breadcrumbUrl,
  charCount,
  escapeAttr,
  generateMetaTags,
  isAbsoluteHttpUrl,
  isValidColor,
  lengthStatus,
  normalizeHandle,
  truncate,
  validateMeta,
  type MetaInput,
} from './metaTags';

const m = (o: Partial<MetaInput> = {}): MetaInput => ({ ...DEFAULT_META, ...o });

describe('lengths', () => {
  it('counts graphemes', () => {
    expect(charCount('abc')).toBe(3);
    expect(charCount('👍🏽👨‍👩‍👧')).toBe(2);
    expect(charCount('é')).toBe(1);
  });
  it('classifies lengths', () => {
    expect(lengthStatus('', LENGTHS.title)).toBe('empty');
    expect(lengthStatus('   ', LENGTHS.title)).toBe('empty');
    expect(lengthStatus('Short', LENGTHS.title)).toBe('short');
    expect(lengthStatus('A good title that is long enough to show', LENGTHS.title)).toBe('good');
    expect(lengthStatus('x'.repeat(61), LENGTHS.title)).toBe('long');
  });
});

describe('helpers', () => {
  it('escapes attributes', () => {
    expect(escapeAttr(`"Tom & Jerry" <b>`)).toBe('&quot;Tom &amp; Jerry&quot; &lt;b&gt;');
  });
  it('normalizes handles', () => {
    expect(normalizeHandle('localkit')).toBe('@localkit');
    expect(normalizeHandle('@@localkit')).toBe('@localkit');
    expect(normalizeHandle('https://x.com/localkit?s=1')).toBe('@localkit');
    expect(normalizeHandle('https://twitter.com/localkit/')).toBe('@localkit');
    expect(normalizeHandle('  ')).toBe('');
  });
  it('checks URLs and colors', () => {
    expect(isAbsoluteHttpUrl('https://e.com/x')).toBe(true);
    expect(isAbsoluteHttpUrl('/x')).toBe(false);
    expect(isAbsoluteHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidColor('#fff')).toBe(true);
    expect(isValidColor('rgb(1 2 3)')).toBe(true);
    expect(isValidColor('')).toBe(false);
    expect(isValidColor('#ggg')).toBe(false);
  });
  it('truncates at word boundaries', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('The quick brown fox jumps over the lazy dog', 20)).toBe('The quick brown fox…');
    expect(truncate('Supercalifragilisticexpialidocious', 10)).toBe('Supercalif…');
    expect(truncate('😀'.repeat(12), 10)).toBe(`${'😀'.repeat(10)}…`);
  });
  it('builds breadcrumbs', () => {
    expect(breadcrumbUrl('https://www.example.com/shoes/trail%20running')).toEqual({ host: 'example.com', path: ['shoes', 'trail running'] });
    expect(breadcrumbUrl('https://xn--mnchen-3ya.de/')).toEqual({ host: 'münchen.de', path: [] });
    expect(breadcrumbUrl('not a url')).toBeNull();
    expect(breadcrumbUrl('ftp://e.com/')).toBeNull();
  });
});

describe('generateMetaTags', () => {
  it('generates the default set', () => {
    const html = generateMetaTags(m({ image: 'https://www.example.com/og.jpg', imageAlt: 'Shoes', twitterSite: 'northfield' }));
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(html).toContain('<title>Trail Running Shoes for Every Terrain | Northfield</title>');
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(html).toContain('<link rel="canonical" href="https://www.example.com/shoes/trail-running" />');
    expect(html).toContain('<meta name="theme-color" content="#1f6f50" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:image" content="https://www.example.com/og.jpg" />');
    expect(html).toContain('<meta property="og:image:alt" content="Shoes" />');
    expect(html).toContain('<meta property="og:locale" content="en_US" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta name="twitter:site" content="@northfield" />');
    expect(html).toContain('<meta name="twitter:image:alt" content="Shoes" />');
    expect(html).not.toContain('twitter:title');
  });

  it('escapes user text', () => {
    const html = generateMetaTags(m({ title: '<script>alert("x")</script> & co', description: 'He said "hi"' }));
    expect(html).toContain('<title>&lt;script&gt;alert("x")&lt;/script&gt; &amp; co</title>');
    expect(html).toContain('content="He said &quot;hi&quot;"');
    expect(html).not.toContain('<script>');
  });

  it('omits empty and disabled parts', () => {
    const html = generateMetaTags(
      m({ title: '', description: '', url: '', themeColor: '', includeCharset: false, includeViewport: false, includeOpenGraph: false, includeTwitter: false, largeImagePreview: false }),
    );
    expect(html).toBe('');
  });

  it('writes noindex/nofollow', () => {
    expect(generateMetaTags(m({ robotsIndex: false, robotsFollow: false }))).toContain('content="noindex, nofollow"');
    expect(generateMetaTags(m({ robotsIndex: true, robotsFollow: true, largeImagePreview: false }))).not.toContain('name="robots"');
  });

  it('uses a summary card without an image and repeats fields when OG is off', () => {
    expect(generateMetaTags(m({ image: '' }))).toContain('<meta name="twitter:card" content="summary" />');
    const html = generateMetaTags(m({ includeOpenGraph: false, image: 'https://e.com/i.png' }));
    expect(html).toContain('twitter:title');
    expect(html).toContain('twitter:description');
    expect(html).toContain('<meta name="twitter:image" content="https://e.com/i.png" />');
    expect(html).not.toContain('og:');
  });

  it('collapses whitespace and keeps Unicode', () => {
    const html = generateMetaTags(m({ title: '  Café\n  😀  Menu ' }));
    expect(html).toContain('<title>Café 😀 Menu</title>');
  });
});

describe('validateMeta', () => {
  it('accepts the defaults', () => {
    expect(validateMeta(DEFAULT_META)).toEqual([]);
  });
  it('flags problems', () => {
    const issues = validateMeta(m({ title: '', description: ' ', url: '/relative', image: 'img.png', themeColor: 'nope!', locale: 'english', twitterSite: 'this_handle_is_way_too_long' }));
    const fields = issues.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'description', 'url', 'image', 'imageAlt', 'themeColor', 'locale', 'twitterSite']));
    expect(issues.find((i) => i.field === 'url')?.level).toBe('error');
  });
});
