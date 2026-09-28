import { describe, expect, it } from 'vitest';
import { escapeHtml, firstHeading, markdownToHtml, standaloneDocument } from './markdown';
import { DEFAULT_TURNDOWN, htmlToMarkdown } from './turndown';

describe('markdownToHtml', () => {
  it('renders GFM', () => {
    const html = markdownToHtml('# Title\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~ https://example.com', { breaks: false });
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>old</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<a href="https://example.com">');
  });

  it('sanitizes dangerous HTML', () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))', { breaks: false });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('respects breaks', () => {
    expect(markdownToHtml('a\nb', { breaks: true })).toContain('<br>');
    expect(markdownToHtml('a\nb', { breaks: false })).not.toContain('<br>');
  });

  it('handles empty and unicode input', () => {
    expect(markdownToHtml('', { breaks: false })).toBe('');
    expect(markdownToHtml('**héllo 🎉**', { breaks: false })).toContain('<strong>héllo 🎉</strong>');
  });

  it('builds a standalone document with an escaped title', () => {
    const doc = standaloneDocument('<p>x</p>', 'A <b> & "c"');
    expect(doc).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('finds the first heading', () => {
    expect(firstHeading('intro\n\n## **Big** title ##\n# Other')).toBe('Big title');
    expect(firstHeading('no headings')).toBeNull();
  });
});

describe('htmlToMarkdown', () => {
  it('converts common elements', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> with <a href="https://x.test">a link</a>.</p><ul><li>One</li><li>Two</li></ul><pre><code>const a = 1;</code></pre>', DEFAULT_TURNDOWN);
    expect(md).toContain('# Title');
    expect(md).toContain('Some **bold** and *italic* with [a link](https://x.test).');
    expect(md).toMatch(/-\s+One/);
    expect(md).toContain('```\nconst a = 1;\n```');
  });

  it('converts GFM tables, strikethrough and task lists', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><p><del>old</del></p><ul><li><input type="checkbox" checked> done</li></ul>',
      DEFAULT_TURNDOWN,
    );
    expect(md).toContain('| A | B |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('~old~');
    expect(md).toContain('[x]');
  });

  it('applies style options', () => {
    const md = htmlToMarkdown('<h2>Sub</h2><ul><li>x</li></ul><p><em>e</em> <strong>s</strong></p><pre><code>x</code></pre>', {
      ...DEFAULT_TURNDOWN,
      headingStyle: 'setext',
      bulletListMarker: '*',
      emDelimiter: '_',
      strongDelimiter: '__',
      fence: '~~~',
    });
    expect(md).toContain('Sub\n---');
    expect(md).toMatch(/\*\s+x/);
    expect(md).toContain('_e_ __s__');
    expect(md).toContain('~~~\nx\n~~~');
  });

  it('removes scripts and styles', () => {
    const md = htmlToMarkdown('<p>ok</p><script>alert(1)</script><style>p{}</style><img src="a.png" alt="A" onerror="x()">', DEFAULT_TURNDOWN);
    expect(md).not.toContain('alert');
    expect(md).not.toContain('p{}');
    expect(md).toContain('![A](a.png)');
  });

  it('handles empty input and unicode', () => {
    expect(htmlToMarkdown('   ', DEFAULT_TURNDOWN)).toBe('');
    expect(htmlToMarkdown('<p>héllo 🎉</p>', DEFAULT_TURNDOWN)).toBe('héllo 🎉\n');
  });
});
