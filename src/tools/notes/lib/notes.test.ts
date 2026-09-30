import { describe, expect, it } from 'vitest';
import {
  collectTags,
  copyTitle,
  createNoteIndex,
  deriveTitle,
  exportMarkdown,
  filterNotes,
  formatRelativeTime,
  noteSnippet,
  toggleInlineMarker,
  normalizeTag,
  noteFileName,
  parseImportedMarkdown,
  parseTags,
  sortNotes,
  stripInlineMarkdown,
  textStats,
  toggleTask,
  UNTITLED,
  type Note,
} from './notes';

function note(partial: Partial<Note> & { id: string }): Note {
  return {
    title: partial.id,
    autoTitle: true,
    content: '',
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('deriveTitle', () => {
  it('uses the first heading', () => {
    expect(deriveTitle('intro line\n\n## **Project** `plan`\n')).toBe('intro line');
    expect(deriveTitle('## **Project** `plan`\nintro')).toBe('Project plan');
    expect(deriveTitle('# Title #\nbody')).toBe('Title');
  });
  it('falls back to the first text line without list/quote markers', () => {
    expect(deriveTitle('\n\n- [ ] Buy [milk](https://x)\n')).toBe('Buy milk');
    expect(deriveTitle('> quoted _thought_')).toBe('quoted thought');
    expect(deriveTitle('1. first')).toBe('first');
  });
  it('skips front matter, code fences and rules', () => {
    expect(deriveTitle('---\ntitle: x\n---\n```js\n# not a heading\n```\n---\nReal text')).toBe('Real text');
  });
  it('handles empty, whitespace and symbol-only content', () => {
    expect(deriveTitle('')).toBe(UNTITLED);
    expect(deriveTitle('   \n\n')).toBe(UNTITLED);
    expect(deriveTitle('#\n##')).toBe(UNTITLED);
  });
  it('keeps Unicode/emoji and truncates long titles', () => {
    expect(deriveTitle('# 🚀 Kế hoạch 2026')).toBe('🚀 Kế hoạch 2026');
    const long = deriveTitle('# ' + '😀'.repeat(200));
    expect([...long]).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
  it('handles CRLF and BOM', () => {
    expect(deriveTitle('\uFEFF# Hello\r\nworld')).toBe('Hello');
  });
});

describe('stripInlineMarkdown', () => {
  it('removes inline syntax', () => {
    expect(stripInlineMarkdown('**a** _b_ ~~c~~ `d` ![img](x.png) <b>e</b>')).toBe('a b c d img e');
  });
});

describe('tags', () => {
  it('normalizes', () => {
    expect(normalizeTag('  #Work Stuff ')).toBe('work-stuff');
    expect(normalizeTag('###')).toBe('');
    expect(normalizeTag('Tiếng-Việt')).toBe('tiếng-việt');
    expect(normalizeTag('a!@$b')).toBe('ab');
    expect(normalizeTag('x'.repeat(50))).toHaveLength(32);
  });
  it('parses lists uniquely', () => {
    expect(parseTags('Work, ideas  #work,,  ')).toEqual(['work', 'ideas']);
    expect(parseTags('')).toEqual([]);
  });
  it('collects with counts', () => {
    expect(collectTags([{ tags: ['b', 'a'] }, { tags: ['a'] }])).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
    ]);
  });
});

describe('filter and sort', () => {
  const notes = [
    note({ id: '1', title: 'banana', favorite: true, tags: ['fruit'], createdAt: 3, updatedAt: 1 }),
    note({ id: '2', title: 'Apple 10', tags: ['fruit', 'red'], createdAt: 1, updatedAt: 3 }),
    note({ id: '3', title: 'apple 9', createdAt: 2, updatedAt: 2 }),
  ];
  it('filters', () => {
    expect(filterNotes(notes, { kind: 'all' })).toHaveLength(3);
    expect(filterNotes(notes, { kind: 'favorites' }).map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(notes, { kind: 'tag', tag: 'red' }).map((n) => n.id)).toEqual(['2']);
    expect(filterNotes(notes, { kind: 'tag', tag: 'none' })).toEqual([]);
  });
  it('sorts without mutating', () => {
    expect(sortNotes(notes, 'updated').map((n) => n.id)).toEqual(['2', '3', '1']);
    expect(sortNotes(notes, 'created').map((n) => n.id)).toEqual(['1', '3', '2']);
    expect(sortNotes(notes, 'title').map((n) => n.id)).toEqual(['3', '2', '1']);
    expect(notes[0].id).toBe('1');
  });
});

describe('createNoteIndex', () => {
  const notes = [
    note({ id: 'a', title: 'Groceries', content: 'milk, eggs and bread', tags: ['home'] }),
    note({ id: 'b', title: 'Release checklist', content: 'Run `npm run build` then deploy', tags: ['work'] }),
    note({ id: 'c', title: 'Ghi chú tiếng Việt', content: 'Xin chào thế giới 🌏' }),
  ];
  const index = createNoteIndex(notes);
  it('returns null for an empty query', () => {
    expect(index.search('   ')).toBeNull();
  });
  it('matches titles, content, tags and prefixes', () => {
    expect(index.search('groc')).toEqual(['a']);
    expect(index.search('eggs')).toEqual(['a']);
    expect(index.search('work')).toEqual(['b']);
    expect(index.search('release deploy')).toEqual(['b']);
  });
  it('tolerates small typos in longer words', () => {
    expect(index.search('checklst')).toContain('b');
  });
  it('matches Unicode and exact substrings with punctuation', () => {
    expect(index.search('chào')).toEqual(['c']);
    expect(index.search('npm run build')).toContain('b');
    expect(index.search('`npm')).toEqual(['b']);
  });
  it('returns nothing for no match', () => {
    expect(index.search('zzzz')).toEqual([]);
  });
  it('handles many notes quickly', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      note({ id: String(i), title: `Note ${i}`, content: `word${i} lorem ipsum `.repeat(50) }),
    );
    const t = performance.now();
    const idx = createNoteIndex(many);
    expect(idx.search('word1999')).toContain('1999');
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe('textStats', () => {
  it('counts words, characters and reading time', () => {
    expect(textStats('')).toEqual({ words: 0, characters: 0, readingMinutes: 0 });
    const s = textStats('# Hello **world**\n\n- one two');
    expect(s.words).toBe(4);
    expect(s.readingMinutes).toBe(1);
  });
  it('counts emoji as single characters', () => {
    expect(textStats('👍🏽 hi').characters).toBe(4);
  });
  it('estimates longer reading times', () => {
    expect(textStats('word '.repeat(1100)).readingMinutes).toBe(5);
  });
  it('ignores link URLs', () => {
    expect(textStats('[docs](https://example.com/a/b/c)').words).toBe(1);
  });
});

describe('toggleTask', () => {
  const md = '- [ ] one\n```\n- [ ] not a task\n```\n* [x] two\n  1. [ ] three';
  it('toggles the n-th task outside code fences', () => {
    expect(toggleTask(md, 0)).toContain('- [x] one');
    expect(toggleTask(md, 1)).toContain('* [ ] two');
    expect(toggleTask(md, 2)).toContain('1. [x] three');
    expect(toggleTask(md, 1)).toContain('- [ ] not a task');
  });
  it('is a no-op for out-of-range indexes', () => {
    expect(toggleTask(md, 9)).toBe(md);
    expect(toggleTask('', 0)).toBe('');
  });
});

describe('names', () => {
  it('copy titles', () => {
    expect(copyTitle('Plan', [])).toBe('Plan (copy)');
    expect(copyTitle('Plan (copy)', ['Plan (copy)'])).toBe('Plan (copy 2)');
    expect(copyTitle('Plan', ['Plan (copy)', 'Plan (copy 2)'])).toBe('Plan (copy 3)');
  });
  it('file names', () => {
    expect(noteFileName('a/b: c?')).toBe('a b c');
    expect(noteFileName('')).toBe('note');
  });
});

describe('parseImportedMarkdown', () => {
  it('uses the first heading and normalizes line endings', () => {
    const r = parseImportedMarkdown('file.md', '\uFEFF# Hello\r\nBody');
    expect(r).toEqual({ title: 'Hello', autoTitle: true, content: '# Hello\nBody', tags: [] });
  });
  it('reads title and tags from front matter', () => {
    const r = parseImportedMarkdown('x.md', '---\ntitle: "My note"\ntags: [Work, ideas]\n---\n\nText');
    expect(r).toEqual({ title: 'My note', autoTitle: false, content: 'Text', tags: ['work', 'ideas'] });
  });
  it('reads YAML list tags', () => {
    const r = parseImportedMarkdown('x.md', '---\ntags:\n  - one\n  - "two words"\n---\nBody');
    expect(r.tags).toEqual(['one', 'two-words']);
    expect(r.content).toBe('Body');
  });
  it('keeps unrecognized front matter in the content', () => {
    const r = parseImportedMarkdown('x.md', '---\nlayout: post\n---\nBody');
    expect(r.content).toBe('---\nlayout: post\n---\nBody');
  });
  it('falls back to the file name', () => {
    expect(parseImportedMarkdown('Meeting notes.markdown', '').title).toBe('Meeting notes');
    expect(parseImportedMarkdown('.md', '   ').title).toBe(UNTITLED);
  });
  it('round-trips exportMarkdown', () => {
    const exported = exportMarkdown({ title: 'Plan "B"', content: '# x\nbody', tags: ['a', 'b-c'] });
    const back = parseImportedMarkdown('p.md', exported);
    expect(back).toEqual({ title: 'Plan "B"', autoTitle: false, content: '# x\nbody', tags: ['a', 'b-c'] });
    expect(exportMarkdown({ title: 't', content: 'plain', tags: [] })).toBe('plain');
  });
});

describe('noteSnippet', () => {
  it('skips the title line, markup, fences and front matter', () => {
    const md = '---\ntitle: x\n---\n# Title\n\n```js\ncode()\n```\n- [x] **Bold** item\n> quote [link](http://a)';
    expect(noteSnippet(md)).toBe('Bold item quote link');
  });
  it('handles empty, emoji and long input', () => {
    expect(noteSnippet('')).toBe('');
    expect(noteSnippet('# Only a title')).toBe('');
    expect(noteSnippet('Title\n🎉 party')).toBe('🎉 party');
    const long = noteSnippet('T\n' + 'word '.repeat(200), 50);
    expect([...long].length).toBeLessThanOrEqual(50);
    expect(long.endsWith('…')).toBe(true);
  });
  it('ignores table separator rows', () => {
    expect(noteSnippet('T\n| a | b |\n|---|:-:|\n| 1 | 2 |')).toBe('a b 1 2');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date(2026, 8, 29, 12, 0, 0).getTime();
  it('formats recent times', () => {
    expect(formatRelativeTime(now - 10_000, now, 'en')).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime(now - 86_400_000, now, 'en')).toBe('yesterday');
  });
  it('falls back to a date for older times', () => {
    expect(formatRelativeTime(new Date(2026, 0, 5).getTime(), now, 'en')).toBe('Jan 5');
    expect(formatRelativeTime(new Date(2024, 0, 5).getTime(), now, 'en')).toBe('Jan 5, 2024');
  });
});

describe('toggleInlineMarker', () => {
  function apply(doc: string, from: number, to: number, marker: string) {
    const e = toggleInlineMarker(doc, from, to, marker);
    const text = doc.slice(0, e.from) + e.insert + doc.slice(e.to);
    return { text, sel: text.slice(e.anchor, e.head) };
  }
  it('wraps a selection and keeps it selected', () => {
    expect(apply('a word b', 2, 6, '**')).toEqual({ text: 'a **word** b', sel: 'word' });
    expect(apply('a word b', 2, 6, '*')).toEqual({ text: 'a *word* b', sel: 'word' });
  });
  it('unwraps markers outside or inside the selection', () => {
    expect(apply('a **word** b', 4, 8, '**')).toEqual({ text: 'a word b', sel: 'word' });
    expect(apply('a **word** b', 2, 10, '**')).toEqual({ text: 'a word b', sel: 'word' });
    expect(apply('a *word* b', 3, 7, '*')).toEqual({ text: 'a word b', sel: 'word' });
  });
  it('does not mistake bold for italic', () => {
    expect(apply('a **word** b', 4, 8, '*')).toEqual({ text: 'a ***word*** b', sel: 'word' });
  });
  it('inserts an empty pair at the cursor', () => {
    const e = toggleInlineMarker('ab', 1, 1, '**');
    expect(e).toEqual({ from: 1, to: 1, insert: '****', anchor: 3, head: 3 });
  });
  it('handles emoji selections', () => {
    expect(apply('x 🎉 y', 2, 4, '**').text).toBe('x **🎉** y');
  });
});

describe('front matter edge cases', () => {
  it('reads single-quoted values and inline quoted tag lists', () => {
    const r = parseImportedMarkdown('x.md', "---\ntitle: 'It''s here'\ntags: [\"two words\", 'b']\n---\nBody");
    expect(r.title).toBe("It's here");
    expect(r.tags).toEqual(['two-words', 'b']);
  });
  it('keeps control characters out of file names', () => {
    expect(noteFileName('a\u0000b\u001fc')).toBe('a b c');
  });
});
