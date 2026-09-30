import { describe, expect, it } from 'vitest';
import { exportMarkdown, NoteSearchIndex, parseImportedMarkdown, textStats, toggleTask } from './notes';
import { frontMatterLength, prepareSource, referenceDefinitions, renderChunk, renderMarkdown, splitChunks, taskLines, toggleTaskAtLine } from './render';
import { isNewNoteShortcut } from './shortcuts';

function dom(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

/** Source line of the task whose rendered label is `label`, as the preview would toggle it. */
function lineOf(markdown: string, label: string): string | null {
  const box = [...dom(renderMarkdown(markdown)).querySelectorAll<HTMLInputElement>('input[data-lk-task]')].find((b) =>
    b.closest('li')?.textContent?.includes(label),
  );
  if (!box) return null;
  const line = Number(box.dataset.lkTask);
  const toggled = toggleTaskAtLine(markdown, line);
  return toggled === markdown ? null : markdown.split('\n')[line];
}

describe('task checkboxes map to their own source line', () => {
  it('ignores task-like text that is not rendered as a task', () => {
    expect(lineOf('- [ ]\n- [ ] second\n- [ ] third', 'third')).toBe('- [ ] third');
    expect(lineOf('- [x]foo\n- [ ] real', 'real')).toBe('- [ ] real');
    expect(lineOf('Para\n\n    - [ ] in code\n\n- [ ] real one', 'real one')).toBe('- [ ] real one');
    expect(lineOf('<!--\n- [ ] hidden\n-->\n\n- [ ] visible', 'visible')).toBe('- [ ] visible');
    expect(lineOf('<ul><li><input type="checkbox"> raw</li></ul>\n\n- [ ] md task', 'md task')).toBe('- [ ] md task');
  });
  it('makes loose-list, quoted and nested tasks interactive', () => {
    expect(lineOf('- [ ] one\n\n- [ ] loose two', 'loose two')).toBe('- [ ] loose two');
    expect(lineOf('> - [ ] quoted\n\n- [ ] plain', 'quoted')).toBe('> - [ ] quoted');
    expect(lineOf('- parent\n  - [ ] child\n- [ ] same text', 'child')).toBe('  - [ ] child');
  });
  it('keeps line numbers with front matter and toggles by index', () => {
    const md = '---\ntitle: x\n---\n- [ ] a\n- [x] b';
    expect(taskLines(md)).toEqual([3, 4]);
    expect(toggleTask(md, 1)).toBe('---\ntitle: x\n---\n- [ ] a\n- [ ] b');
    expect(toggleTaskAtLine('plain text', 0)).toBe('plain text');
  });
});

describe('preview sanitizer', () => {
  it('drops style elements, style attributes and forms that could take over the app', () => {
    const root = dom(
      renderMarkdown(
        'Intro\n\n<style>body{display:none} @import url(https://remote-images.test/a.css);</style>\n\n' +
          '<div style="position:fixed;inset:0;background:url(https://remote-images.test/x.png)">cover</div>\n\n' +
          '<form action="https://evil.test"><input name="password" type="password"><button>Sign in</button></form>\n\n' +
          '<div class="fixed inset-0 z-50 language-js">classes</div>\n\n<p role="alert" tabindex="1">x</p>',
      ),
    );
    expect(root.querySelector('style, form, button, input, [style], [role], [tabindex]')).toBeNull();
    expect(root.innerHTML).not.toMatch(/class="[^"]*(fixed|inset-0|z-50)/);
    expect(root.querySelector('div.language-js')?.textContent).toBe('classes');
    expect(root.innerHTML).not.toContain('remote-images.test');
  });
  it('keeps task checkboxes, code language classes and Mermaid placeholders', () => {
    const root = dom(renderMarkdown('- [ ] a\n\n```js\nx\n```\n\n```mermaid\ngraph TD\nA-->B\n```'));
    expect(root.querySelectorAll('input[type=checkbox][data-lk-task]')).toHaveLength(1);
    expect(root.querySelector('code.language-js')).not.toBeNull();
    expect(root.querySelector('.lk-note-mermaid[data-mermaid=pending]')).not.toBeNull();
  });
  it('export mode keeps user styling for standalone files', () => {
    expect(renderMarkdown('<span style="color:red">x</span>', 'export')).toContain('style="color:red"');
  });
});

describe('front matter', () => {
  it('renders leading YAML as a code block, not a rule and a heading', () => {
    const root = dom(renderMarkdown('---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body'));
    expect(root.querySelector('pre.lk-note-frontmatter code.language-yaml')?.textContent).toContain('title: Hello');
    expect(root.querySelector('hr, h2')).toBeNull();
    expect(prepareSource('---\ntitle: x\n---\nBody').split('\n')).toHaveLength(4);
  });
  it('treats a leading rule followed by prose as Markdown', () => {
    expect(frontMatterLength('---\nJust some text here\n---\n')).toBe(0);
    expect(frontMatterLength('---\ndate: 2024-05-01\n---\nBody')).toBe(25);
  });
  it('keeps other keys on import and merges title/tags back on export', () => {
    const imported = parseImportedMarkdown('fm.md', '\uFEFF---\r\ntitle: "Q"\r\ndate: 2024-05-01\r\ntags:\r\n  - alpha\r\n---\r\n\r\n# Heading\r\nBody\r\n');
    expect(imported).toEqual({ title: 'Q', autoTitle: false, content: '---\ndate: 2024-05-01\n---\n\n# Heading\nBody\n', tags: ['alpha'] });
    const exported = exportMarkdown(imported);
    expect(exported.match(/^---$/gm)).toHaveLength(2);
    expect(parseImportedMarkdown('fm.md', exported)).toEqual(imported);
  });
  it('exports a custom title even without tags', () => {
    const note = { title: 'My plan', autoTitle: false, content: '# Something else\nbody', tags: [] };
    expect(parseImportedMarkdown('My plan.md', exportMarkdown(note)).title).toBe('My plan');
    expect(exportMarkdown({ ...note, autoTitle: true })).toBe(note.content);
  });
});

describe('large notes', () => {
  const block = (i: number) => `## Part ${i}\n\nText with [ref] and \`<div>\` code, item ${i}.\n\n- [ ] task ${i}\n\n`;
  const src = prepareSource(Array.from({ length: 3000 }, (_, i) => block(i)).join('') + '[ref]: https://example.com\n');

  it('splits into chunks that cover the source and render like the whole note', () => {
    const chunks = splitChunks(src);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.map((c) => c.text).join('')).toBe(src);
    const defs = referenceDefinitions(src);
    const html = chunks.map((c) => renderChunk(c.text, defs)).join('');
    const root = dom(html);
    expect(root.querySelectorAll('h2')).toHaveLength(3000);
    expect(root.querySelectorAll('a[href="https://example.com"]')).toHaveLength(3000);
    // Task line numbers are relative to each chunk; with the chunk offset they point at the source.
    const lines = src.split('\n');
    for (const c of [chunks[1], chunks[chunks.length - 1]]) {
      const first = dom(renderChunk(c.text, defs)).querySelector<HTMLInputElement>('input[data-lk-task]')!;
      expect(lines[c.line + Number(first.dataset.lkTask)]).toMatch(/^- \[ \] task \d+$/);
    }
  });
  it('never cuts inside fences or HTML blocks', () => {
    const tricky = prepareSource(('x\n\n```\n\n# not a heading\n\n```\n\n<details>\n\n# inside\n\n</details>\n\n'.repeat(2000)));
    for (const c of splitChunks(tricky)) {
      expect((c.text.match(/^```$/gm) ?? []).length % 2).toBe(0);
      expect((c.text.match(/<details>/g) ?? []).length).toBe((c.text.match(/<\/details>/g) ?? []).length);
    }
  });
  it('counts big texts quickly', () => {
    const t = performance.now();
    const stats = textStats('word café 漢字 '.repeat(60_000));
    expect(performance.now() - t).toBeLessThan(3000);
    expect(stats.words).toBe(240_000);
  });
});

describe('NoteSearchIndex', () => {
  it('updates only changed notes and forgets deleted ones', () => {
    const index = new NoteSearchIndex();
    const a = { id: 'a', title: 'Alpha', content: 'apples', tags: [], updatedAt: 1 };
    const b = { id: 'b', title: 'Beta', content: 'bananas', tags: [], updatedAt: 1 };
    index.sync([a, b]);
    expect(index.search('apples')).toEqual(['a']);
    index.sync([{ ...a, content: 'cherries', updatedAt: 2 }, b]);
    expect(index.search('apples')).toEqual([]);
    expect(index.search('cherries')).toEqual(['a']);
    index.sync([b]);
    expect(index.search('cherries')).toEqual([]);
  });
  it('finds text beyond the indexed part of huge notes', () => {
    const index = new NoteSearchIndex().sync([{ id: 'h', title: 'Huge', content: 'x '.repeat(80_000) + 'needle', tags: [] }]);
    expect(index.search('needle')).toEqual(['h']);
  });
});

describe('Ctrl+Alt+N', () => {
  const editor = document.createElement('div');
  editor.className = 'cm-editor';
  const content = document.createElement('div');
  content.contentEditable = 'true';
  editor.appendChild(content);
  const base = { ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, code: 'KeyN', target: content as EventTarget };
  it('creates a note', () => {
    expect(isNewNoteShortcut({ ...base, key: 'n' })).toBe(true);
    expect(isNewNoteShortcut({ ...base, key: 'Dead', metaKey: true, ctrlKey: false })).toBe(true);
  });
  it('leaves AltGr characters such as "ń" to the editor', () => {
    expect(isNewNoteShortcut({ ...base, key: 'ń' })).toBe(false);
    expect(isNewNoteShortcut({ ...base, key: 'n', getModifierState: (k) => k === 'AltGraph' })).toBe(false);
  });
});
