import { describe, expect, it } from 'vitest';
import { blockRemoteContent, describeHosts } from './remoteContent';

describe('blockRemoteContent', () => {
  it('replaces remote images with a labelled placeholder and reports hosts', () => {
    const r = blockRemoteContent('<p><img src="https://cdn.example.com/a.png" alt="Logo"> and <img src="http://img.test/b.jpg"></p>');
    expect(r.blocked).toBe(2);
    expect(r.hosts).toEqual(['cdn.example.com', 'img.test']);
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('Logo (not loaded from cdn.example.com)');
    expect(r.html).toContain('aria-label="Remote image not loaded: Logo"');
  });

  it('blocks protocol-relative URLs, srcset, posters, media sources and CSS url()', () => {
    const r = blockRemoteContent(
      [
        '<img src="//tracker.test/pixel.gif">',
        '<picture><source srcset="https://a.test/x.webp 1x, https://a.test/x2.webp 2x"><img src="data:image/png;base64,AAAA" alt="local"></picture>',
        '<video poster="https://v.test/poster.jpg"><source src="https://v.test/movie.mp4"></video>',
        '<div style="color: red; background: url(\'https://bg.test/tile.png\') repeat">x</div>',
      ].join(''),
    );
    expect(r.blocked).toBe(6);
    expect(r.hosts).toEqual(['a.test', 'bg.test', 'tracker.test', 'v.test']);
    // Real attributes are gone; the URLs survive only as inert data-lk-remote-* attributes.
    expect(r.html).not.toMatch(/\s(?:src|srcset|poster)="(?:https?:)?\/\//);
    expect(r.html).toContain('data-lk-remote-poster="https://v.test/poster.jpg"');
    expect(r.html).not.toContain('bg.test/tile.png)');
    expect(r.html).toContain('color: red');
    expect(r.html).toContain('data:image/png;base64,AAAA');
  });

  it('keeps local sources and links untouched', () => {
    const html = '<p><a href="https://example.com">link</a><img src="data:image/gif;base64,R0lG" alt="d"><img src="blob:http://localhost/1" alt="b"><img src="images/local.png" alt="rel"></p>';
    const r = blockRemoteContent(html);
    expect(r.blocked).toBe(0);
    expect(r.hosts).toEqual([]);
    expect(r.html).toContain('href="https://example.com"');
    expect(r.html).toContain('src="images/local.png"');
  });

  it('handles empty input', () => {
    expect(blockRemoteContent('')).toEqual({ html: '', blocked: 0, hosts: [] });
  });
});

describe('describeHosts', () => {
  it('formats host lists for sentences', () => {
    expect(describeHosts([])).toBe('other servers');
    expect(describeHosts(['a.com'])).toBe('a.com');
    expect(describeHosts(['a.com', 'b.com'])).toBe('a.com and b.com');
    expect(describeHosts(['a.com', 'b.com', 'c.com'])).toBe('a.com, b.com and c.com');
    expect(describeHosts(['a', 'b', 'c', 'd', 'e'])).toBe('a, b and 3 more');
  });
});
