import { describe, expect, it } from 'vitest';
import { buildPreviewDocument } from './preview';

describe('buildPreviewDocument', () => {
  it('wraps fragments and includes CSS', () => {
    const doc = buildPreviewDocument('<p>Hi</p>', 'p{color:red}', 'alert(1)', false);
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('<style>\np{color:red}\n</style>');
    expect(doc).toContain('<p>Hi</p>');
    expect(doc).not.toContain('alert(1)');
    expect(doc).not.toContain('<script');
  });

  it('includes scripts only when enabled', () => {
    const doc = buildPreviewDocument('<p>Hi</p>', '', 'console.log(1)', true, 'tok');
    expect(doc).toContain('<script>\nconsole.log(1)\n</script>');
    expect(doc).toContain('"tok"');
  });

  it('escapes closing tags inside CSS and JS', () => {
    const doc = buildPreviewDocument('', 'a{content:"</style>"}', 'var s="</script>"', true);
    expect(doc).toContain('a{content:"<\\/style>"}');
    expect(doc).toContain('var s="<\\/script>"');
    expect(doc.match(/<\/script>/g)).toHaveLength(1);
  });

  it('injects into full documents', () => {
    const doc = buildPreviewDocument('<!doctype html><html><head><title>x</title></head><body><p>a</p></body></html>', 'p{}', 'go()', true);
    expect(doc.indexOf('<style>')).toBeGreaterThan(doc.indexOf('<head>'));
    expect(doc.indexOf('go()')).toBeLessThan(doc.indexOf('</body>'));
    expect(doc.startsWith('<!doctype html>')).toBe(true);
  });

  it('handles documents without head or html tags', () => {
    const doc = buildPreviewDocument('<!DOCTYPE html><p>x</p>', 'p{}', '', false);
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(doc).toContain('<style>');
    const withHtml = buildPreviewDocument('<html><body>x</body></html>', 'p{}', '', false);
    expect(withHtml).toContain('<html>\n<head>');
  });
});
