import { describe, expect, it } from 'vitest';
import { escapeHtml, mermaidSource, renderMarkdown, slugify, standaloneHtml } from './render';
import { highlightCode } from './highlight';

describe('renderMarkdown', () => {
  it('renders GFM tables, task lists and strikethrough', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~');
    expect(html).toContain('<table>');
    const div = document.createElement('div');
    div.innerHTML = html;
    const boxes = div.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(html).toContain('<del>old</del>');
  });
  it('adds unique heading ids', () => {
    const html = renderMarkdown('# Hello World\n## Hello World\n## Xin chào!');
    expect(html).toContain('id="hello-world"');
    expect(html).toContain('id="hello-world-1"');
    expect(html).toContain('id="xin-chào"');
  });
  it('turns mermaid fences into escaped placeholders', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\nA-->B"<x>\n```');
    expect(html).toContain('class="lk-mermaid lk-note-mermaid"');
    const div = document.createElement('div');
    div.innerHTML = html;
    const placeholder = div.querySelector('[data-mermaid]');
    expect(placeholder).not.toBeNull();
    expect(mermaidSource(placeholder!)).toBe('graph TD\nA-->B"<x>');
    expect(div.querySelector('x')).toBeNull();
  });
  it('keeps language classes on other fences', () => {
    expect(renderMarkdown('```ts\nconst a = 1;\n```')).toContain('class="language-ts"');
  });
  it('sanitizes scripts, handlers and javascript: links', () => {
    // Separate blocks, so the link is parsed as Markdown rather than kept as text inside an HTML block.
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1)) and [y](https://example.com)\n\n' +
        '<iframe src="https://e.com"></iframe>\n\n<a href="javascript:alert(2)" onclick="alert(3)">z</a>',
    );
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('script, iframe')).toBeNull();
    for (const el of div.querySelectorAll('*')) {
      for (const attr of el.attributes) expect(attr.name.startsWith('on'), attr.name).toBe(false);
    }
    const hrefs = [...div.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => /^\s*javascript:/i.test(h))).toBe(false);
    expect(hrefs).toContain('https://example.com');
    expect(div.querySelector('img')).not.toBeNull();
  });
  it('handles empty and emoji input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('**🎉**')).toContain('<strong>🎉</strong>');
  });
  it('renders large documents', () => {
    const big = '## Section\n\nSome *text* here.\n\n'.repeat(5000);
    expect(renderMarkdown(big).length).toBeGreaterThan(100_000);
  });
});

describe('standaloneHtml', () => {
  it('produces a complete document with escaped title and embedded CSS', () => {
    const doc = standaloneHtml('<Plan & "B">', '<p>Hi</p>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<title>&lt;Plan &amp; &quot;B&quot;&gt;</title>');
    expect(doc).toContain('<style>');
    expect(doc).toContain('<p>Hi</p>');
  });
  it('sanitizes the body again', () => {
    const doc = standaloneHtml(
      't',
      '<p onclick="x()">a</p><script>bad()</script><a href="javascript:bad()">l</a><svg><foreignObject><div>x</div></foreignObject></svg>',
    );
    const body = doc.slice(doc.indexOf('<body>'));
    expect(body).not.toMatch(/onclick|<script|javascript:|foreignObject/i);
  });
  it('keeps SVG diagrams with their styles', () => {
    const doc = standaloneHtml(
      't',
      '<div class="lk-mermaid"><svg viewBox="0 0 10 10"><style>.n{fill:red}</style><rect class="n" width="5" height="5"></rect><text>Hi</text></svg></div>',
    );
    expect(doc).toContain('<svg');
    expect(doc).toContain('.n{fill:red}');
    expect(doc).toContain('<rect');
  });
});

describe('helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('slugifies', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  ')).toBe('');
  });
});

describe('highlightCode', () => {
  it('highlights known languages with tok classes', async () => {
    const html = await highlightCode('const x = "<b>";', 'javascript');
    expect(html).toContain('tok-keyword');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
  it('resolves aliases and returns null for unknown languages', async () => {
    expect(await highlightCode('x = 1', 'py')).toContain('tok-');
    expect(await highlightCode('x', 'no-such-language')).toBeNull();
    expect(await highlightCode('x', '')).toBeNull();
  });
});
