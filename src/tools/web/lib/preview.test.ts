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

  // Regression: `<head[^>]*>` also matched `<header>`, so styles and the console bridge landed inside it.
  it('does not mistake <header> for <head>', () => {
    const doc = buildPreviewDocument('<!doctype html><html><body><header>Top</header></body></html>', 'p{}', '', false);
    expect(doc).toContain('<header>Top</header>');
    expect(doc.indexOf('<style>')).toBeLessThan(doc.indexOf('<body>'));
    expect(doc).toContain('<html>\n<head>');
  });

  it('forwards console output readably and supports console.clear', () => {
    const doc = buildPreviewDocument('', '', 'console.log(1)', true, 'tok');
    const bridge = /<script>(\(function\(\)\{[\s\S]*?\}\)\(\);)<\/script>/.exec(doc)?.[1] ?? '';
    const posted: Array<{ level: string; text: string }> = [];
    const noop = (...args: unknown[]) => void args;
    const fakeConsole: Record<'log' | 'info' | 'warn' | 'error' | 'debug' | 'clear' | 'table' | 'dir' | 'assert', (...args: unknown[]) => void> = {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      clear: noop,
      table: noop,
      dir: noop,
      assert: noop,
    };
    const scope = { parent: { postMessage: (m: { level: string; text: string }) => posted.push(m) }, console: fakeConsole, addEventListener: () => {} };
    new Function('parent', 'console', 'addEventListener', bridge)(scope.parent, scope.console, scope.addEventListener);
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    fakeConsole.log('text', undefined, null, 10n, function named() {}, Symbol('s'), { nested: [1, { b: 2 }] }, circular);
    fakeConsole.error(new TypeError('bad'));
    fakeConsole.clear();
    fakeConsole.assert(false, 'must hold');
    expect(posted[0]).toMatchObject({ level: 'log' });
    expect(posted[0].text).toContain('text undefined null 10n ƒ named() Symbol(s)');
    expect(posted[0].text).toContain('"b": 2');
    expect(posted[0].text).toContain('"self": "[Circular]"');
    expect(posted[1]).toEqual({ __lk: 'tok', level: 'error', text: 'TypeError: bad' });
    expect(posted[2]).toMatchObject({ level: 'clear' });
    expect(posted[3]).toMatchObject({ level: 'error', text: 'Assertion failed: must hold' });
  });

  it('handles documents without head or html tags', () => {
    const doc = buildPreviewDocument('<!DOCTYPE html><p>x</p>', 'p{}', '', false);
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(doc).toContain('<style>');
    const withHtml = buildPreviewDocument('<html><body>x</body></html>', 'p{}', '', false);
    expect(withHtml).toContain('<html>\n<head>');
  });
});
