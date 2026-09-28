import { describe, expect, it, vi } from 'vitest';
import { buildNoteHtml, enhancePreview, prepareInteractive } from './enhance';
import { renderMarkdown } from './render';

function rendered(markdown: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(markdown);
  return div;
}

describe('enhancePreview', () => {
  it('highlights code fences and renders mermaid blocks', async () => {
    const root = rendered('```js\nconst a = 1;\n```\n\n```mermaid\ngraph TD\nA-->B\n```');
    const renderDiagram = vi.fn(async (source: string, theme: string) => `<svg data-src="${source.length}" data-t="${theme}"></svg>`);
    await enhancePreview(root, { theme: 'dark', renderDiagram });
    expect(root.querySelector('code.language-js .tok-keyword')?.textContent).toBe('const');
    const diagram = root.querySelector<HTMLElement>('.lk-note-mermaid')!;
    expect(diagram.dataset.mermaid).toBe('done');
    expect(diagram.dataset.theme).toBe('dark');
    expect(diagram.querySelector('svg')?.getAttribute('data-t')).toBe('dark');
    expect(renderDiagram).toHaveBeenCalledWith('graph TD\nA-->B', 'dark');
  });

  it('caches diagrams per theme and source', async () => {
    const renderDiagram = vi.fn(async () => '<svg></svg>');
    await enhancePreview(rendered('```mermaid\npie\n"a": 1\n```'), { theme: 'default', renderDiagram });
    await enhancePreview(rendered('```mermaid\npie\n"a": 1\n```'), { theme: 'default', renderDiagram });
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it('keeps the source and shows an error for invalid diagrams', async () => {
    const root = rendered('```mermaid\nnot a diagram <b>\n```');
    const renderDiagram = vi.fn(async () => {
      throw new Error('No diagram type detected matching given configuration for text: not a diagram');
    });
    await enhancePreview(root, { theme: 'default', renderDiagram });
    const el = root.querySelector<HTMLElement>('.lk-note-mermaid')!;
    expect(el.dataset.mermaid).toBe('error');
    expect(el.querySelector('code')?.textContent).toBe('not a diagram <b>');
    expect(el.querySelector('.lk-note-mermaid-error')?.textContent).toMatch(/^Diagram error: line 1: No diagram type found/);
    expect(el.querySelector('b')).toBeNull();
  });

  it('does not apply results after cancellation', async () => {
    const root = rendered('```mermaid\ngraph LR\nX-->Y\n```');
    const token = { cancelled: false };
    const done = enhancePreview(root, { theme: 'default', renderDiagram: async () => '<svg id="late"></svg>', token });
    token.cancelled = true;
    await done;
    expect(root.querySelector('#late')).toBeNull();
  });

  it('leaves unknown languages and empty input alone', async () => {
    const root = rendered('```nosuchlang\nx\n```');
    await enhancePreview(root, { theme: 'default', renderDiagram: async () => '' });
    expect(root.querySelector('code')?.innerHTML).toBe('x\n');
    const empty = rendered('');
    await enhancePreview(empty, { theme: 'default', renderDiagram: async () => '' });
    expect(empty.innerHTML).toBe('');
  });
});

describe('prepareInteractive', () => {
  it('enables and numbers task checkboxes and opens external links in a new tab', () => {
    const root = rendered('- [ ] one\n- [x] two\n\n[ext](https://example.com) [anchor](#top)');
    prepareInteractive(root);
    const boxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...boxes].map((b) => [b.disabled, b.dataset.task])).toEqual([
      [false, '0'],
      [false, '1'],
    ]);
    const [ext, anchor] = root.querySelectorAll('a');
    expect(ext.target).toBe('_blank');
    expect(ext.rel).toBe('noopener noreferrer');
    expect(anchor.target).toBe('');
  });
});

describe('buildNoteHtml', () => {
  it('builds a standalone, sanitized document with rendered diagrams', async () => {
    const html = await buildNoteHtml(
      'My <note>',
      '# Hi\n\n<img src=x onerror=alert(1)>\n\n```mermaid\ngraph TD\nA-->B\n```',
      async () => '<svg viewBox="0 0 10 10"><rect width="5" height="5"></rect></svg>',
    );
    expect(html).toContain('<title>My &lt;note&gt;</title>');
    expect(html).toContain('<rect');
    expect(html).toContain('data-theme="light"');
    expect(html).not.toMatch(/onerror|data-mermaid/);
  });
});
