import { describe, expect, it } from 'vitest';
import { buildHtml, buildManifest, letterMarkText, normalizePath } from './faviconSet';
import { icoSizesFor } from './favicon';

describe('favicon outputs', () => {
  it('normalizes paths', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('icons')).toBe('/icons/');
    expect(normalizePath('/static//img')).toBe('/static/img/');
    expect(normalizePath('https://cdn.example.com/x')).toBe('https://cdn.example.com/x/');
  });

  it('builds a valid manifest', () => {
    const m = JSON.parse(buildManifest({ name: 'Café ☕', shortName: '', themeColor: '#123456', backgroundColor: '#ffffff', path: 'icons' }));
    expect(m.name).toBe('Café ☕');
    expect(m.short_name).toBe('Café ☕');
    expect(m.icons).toHaveLength(3);
    expect(m.icons[0].src).toBe('/icons/android-chrome-192x192.png');
    expect(m.icons[2].purpose).toBe('maskable');
    expect(m.theme_color).toBe('#123456');
  });

  it('builds HTML tags with optional SVG and escaped attributes', () => {
    const html = buildHtml({ path: '/', themeColor: '#fff"<', hasSvg: true });
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">');
    expect(html).toContain('content="#fff&quot;&lt;"');
    expect(buildHtml({ path: '/', themeColor: '#fff', hasSvg: false })).not.toContain('svg');
  });

  it('letterMarkText keeps up to 3 graphemes', () => {
    expect(letterMarkText('  LocalKit ')).toBe('Loc');
    expect(letterMarkText('é')).toBe('é');
    expect(letterMarkText('ÀB')).toBe('ÀB');
    expect(letterMarkText('')).toBe('');
  });

  it('icoSizesFor includes larger sizes only when the source allows', () => {
    expect(icoSizesFor(20, 20)).toEqual([16, 32, 48]);
    expect(icoSizesFor(300, 128)).toEqual([16, 32, 48, 64, 128]);
    expect(icoSizesFor(1024, 1024)).toEqual([16, 32, 48, 64, 128, 256]);
  });
});
