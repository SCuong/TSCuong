import { describe, expect, it } from 'vitest';
import { escapeHtml, firstHeading, markdownToHtml, previewDocument, standaloneDocument } from './markdown';
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

  it('builds an isolated preview document', () => {
    const palette = {
      scheme: 'dark' as const,
      background: '#10141c',
      text: '#e6eaf2',
      textSecondary: '#a7b1c2',
      textMuted: '#8d98ab',
      border: '#1f2633',
      borderStrong: '#2d3646',
      soft: '#1b2130',
      sunken: '#0d1118',
      link: '#7aa7ff',
      accent: '#2563eb;} body{display:none',
    };
    const doc = previewDocument('<p><a href="https://x.test">x</a> <a href="#top">top</a></p><pre><code>a</code></pre>', palette, false);
    // Every request is blocked, remote images included; styles only inline.
    expect(doc).toContain(
      `content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'"`,
    );
    expect(doc).toContain('<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>');
    expect(doc).toContain('<a href="#top">top</a>');
    expect(doc).toContain('<pre tabindex="0">');
    expect(doc).toContain('color-scheme:dark');
    expect(doc).not.toContain('body{display:none');
    expect(previewDocument('', palette, true)).toContain('img-src data: blob: https: http:;');
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
    expect(md).toContain('~~old~~');
    expect(md).toContain('[x]');
  });

  // Regression: a "|" in a cell split it in two, and paragraphs in a cell broke the table.
  it('keeps tables intact when cells contain pipes or several paragraphs', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>a|b</th><th>c</th></tr></thead><tbody><tr><td>x | y</td><td><p>one</p><p>two</p></td></tr><tr><td><code>p|q</code></td><td>l1<br>l2</td></tr></tbody></table>',
      DEFAULT_TURNDOWN,
    );
    expect(md).toBe('| a\\|b | c |\n| --- | --- |\n| x \\| y | one<br><br>two |\n| `p\\|q` | l1<br>l2 |\n');
    // Round trip: the Markdown renders back to the same cells.
    const html = markdownToHtml(md, { breaks: false });
    expect(html).toContain('<th>a|b</th>');
    expect(html).toContain('<td>x | y</td>');
    expect(html).toContain('<td><code>p|q</code></td>');
  });

  // Regression: text such as "<div>" or "&amp;" came out unescaped and rendered as markup.
  it('escapes text that would be read as HTML or entities', () => {
    const md = htmlToMarkdown('<p>Use &lt;div&gt; and &amp;amp; but not AT&amp;T or a &lt; b</p>', DEFAULT_TURNDOWN);
    expect(md).toBe('Use \\<div> and \\&amp; but not AT&T or a < b\n');
    const back = markdownToHtml(md, { breaks: false });
    expect(back).toContain('Use &lt;div&gt; and &amp;amp; but not AT&amp;T or a &lt; b');
  });

  it('round-trips GFM through HTML', () => {
    const source = '# Title\n\nSome **bold**, *em*, ~~del~~ and `code`.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n';
    const md = htmlToMarkdown(markdownToHtml(source, { breaks: false }), DEFAULT_TURNDOWN);
    expect(md).toBe(source);
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
