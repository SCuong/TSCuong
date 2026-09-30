import { describe, expect, it } from 'vitest';
import {
  SNIPPET_LANGUAGES,
  getSnippetLanguage,
  languageFromFileName,
  resolveLanguageId,
  snippetFileName,
} from './languages';
import {
  applyDraft,
  createSnippet,
  draftFromSnippet,
  draftsEqual,
  duplicateSnippet,
  duplicateTitle,
  emptyDraft,
  fallbackTitle,
  normalizeTags,
  parseTagInput,
  relativeTime,
  validateDraft,
  type Snippet,
} from './model';
import {
  buildSearchIndex,
  languageCounts,
  parseQuery,
  scoreTerm,
  searchSnippets,
  subsequenceScore,
  tagCounts,
  indexSnippet,
  type SnippetFilters,
} from './search';
import { EXPORT_FORMAT, countConflicts, exportSnippets, parseImport, planImport } from './io';
import { SNIPPET_TEMPLATES } from './templates';
import { highlightCode, loadSnippetLanguage, previewLines, tokensToLines } from './highlight';

const NO_FILTERS: SnippetFilters = { language: null, tag: null, favorites: false };

let seq = 0;
const makeId = () => `id-${++seq}`;

function snip(partial: Partial<Snippet> & { title: string }): Snippet {
  return {
    id: partial.id ?? makeId(),
    description: '',
    language: 'javascript',
    code: '',
    tags: [],
    favorite: false,
    createdAt: 1000,
    updatedAt: 1000,
    copyCount: 0,
    ...partial,
  };
}

describe('languages', () => {
  it('has 30+ unique languages', () => {
    expect(SNIPPET_LANGUAGES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SNIPPET_LANGUAGES.map((l) => l.id)).size).toBe(SNIPPET_LANGUAGES.length);
  });
  it('resolves aliases case-insensitively', () => {
    expect(resolveLanguageId('PY')).toBe('python');
    expect(resolveLanguageId('C#')).toBe('csharp');
    expect(resolveLanguageId('TypeScript')).toBe('typescript');
    expect(resolveLanguageId('yml')).toBe('yaml');
    expect(resolveLanguageId('klingon')).toBeNull();
    expect(resolveLanguageId(42)).toBeNull();
    expect(resolveLanguageId('  ')).toBeNull();
  });
  it('falls back to plain text for unknown ids', () => {
    expect(getSnippetLanguage('nope').id).toBe('plaintext');
  });
  it('guesses languages from file names', () => {
    expect(languageFromFileName('main.rs')).toBe('rust');
    expect(languageFromFileName('Dockerfile')).toBe('dockerfile');
    expect(languageFromFileName('app.Dockerfile')).toBe('dockerfile');
    expect(languageFromFileName('README')).toBe('plaintext');
    expect(languageFromFileName('x.yml')).toBe('yaml');
  });
  it('builds safe download file names', () => {
    expect(snippetFileName('Debounce a function', 'typescript')).toBe('debounce-a-function.ts');
    expect(snippetFileName('Crème brûlée / recipe?', 'python')).toBe('creme-brulee-recipe.py');
    expect(snippetFileName('', 'go')).toBe('snippet.go');
    expect(snippetFileName('🚀🚀', 'rust')).toBe('snippet.rs');
    expect(snippetFileName('whatever', 'dockerfile')).toBe('Dockerfile');
    expect(snippetFileName('x'.repeat(300), 'json').length).toBeLessThanOrEqual(85);
  });
});

describe('model', () => {
  it('normalizes tags', () => {
    expect(normalizeTags(['  React ', '#hooks', 'react', '', 'State Management'])).toEqual([
      'react',
      'hooks',
      'state-management',
    ]);
    expect(parseTagInput('a, b  c,,#d')).toEqual(['a', 'b', 'c', 'd']);
    expect(normalizeTags(Array.from({ length: 50 }, (_, i) => `t${i}`))).toHaveLength(20);
  });
  it('creates snippets with a fallback title', () => {
    const s = createSnippet({ ...emptyDraft('python'), code: '\n\n  print("hi")  \n' }, 'a', 5);
    expect(s.title).toBe('print("hi")');
    expect(s).toMatchObject({ id: 'a', createdAt: 5, updatedAt: 5, copyCount: 0, favorite: false, language: 'python' });
    expect(fallbackTitle('')).toBe('Untitled snippet');
    expect(fallbackTitle('x'.repeat(100))).toHaveLength(58);
  });
  it('validates drafts', () => {
    expect(validateDraft(emptyDraft())).toMatch(/title or some code/);
    expect(validateDraft({ ...emptyDraft(), title: 'x' })).toBeNull();
    expect(validateDraft({ ...emptyDraft(), title: 'x'.repeat(201) })).toMatch(/too long/);
  });
  it('applies drafts and detects changes', () => {
    const s = createSnippet({ ...emptyDraft(), title: 'A', code: 'x' }, 'a', 1);
    const d = draftFromSnippet(s);
    expect(draftsEqual(d, draftFromSnippet(s))).toBe(true);
    expect(draftsEqual(d, { ...d, tags: ['z'] })).toBe(false);
    const updated = applyDraft(s, { ...d, title: '  B ', tags: ['X'] }, 9);
    expect(updated).toMatchObject({ title: 'B', tags: ['x'], createdAt: 1, updatedAt: 9 });
  });
  it('duplicates with unique titles and reset counters', () => {
    expect(duplicateTitle('A', ['A'])).toBe('A (copy)');
    expect(duplicateTitle('A', ['A', 'A (copy)'])).toBe('A (copy 2)');
    expect(duplicateTitle('A (copy)', ['A', 'A (copy)', 'A (copy 2)'])).toBe('A (copy 3)');
    const s = { ...snip({ title: 'A', favorite: true, copyCount: 9 }), tags: ['t'] };
    const d = duplicateSnippet(s, 'new', ['A'], 50);
    expect(d).toMatchObject({ id: 'new', title: 'A (copy)', favorite: false, copyCount: 0, createdAt: 50 });
    d.tags.push('mutated');
    expect(s.tags).toEqual(['t']);
  });
  it('formats relative times', () => {
    const now = 10 * 86_400_000;
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 86_400_000, now)).toBe('yesterday');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(relativeTime(now + 1000, now)).toBe('just now');
  });
});

describe('search', () => {
  const library = [
    snip({ id: '1', title: 'Debounce function', tags: ['utility'], code: 'setTimeout(fn, wait)', updatedAt: 10 }),
    snip({ id: '2', title: 'Fetch with timeout', tags: ['http'], code: 'AbortSignal.timeout(ms)', updatedAt: 30 }),
    snip({ id: '3', title: 'Python CLI', language: 'python', tags: ['cli'], description: 'argparse debounce-free', updatedAt: 20 }),
    snip({ id: '4', title: 'React hook', language: 'tsx', tags: ['react', 'hooks'], favorite: true, copyCount: 5, updatedAt: 5 }),
    snip({ id: '5', title: 'Ünïcode 🚀 ROCKET', tags: ['emoji'], code: 'const 名前 = "値"', updatedAt: 1 }),
  ];
  const index = buildSearchIndex(library);
  const ids = (q: string, f: SnippetFilters = NO_FILTERS, sort: Parameters<typeof searchSnippets>[3] = 'updated') =>
    searchSnippets(index, q, f, sort).map((h) => h.snippet.id);

  it('returns everything sorted when the query is empty', () => {
    expect(ids('')).toEqual(['2', '3', '1', '4', '5']);
    expect(ids('', NO_FILTERS, 'title')).toEqual(['1', '2', '3', '4', '5']);
    expect(ids('', NO_FILTERS, 'copied')[0]).toBe('4');
  });
  it('ranks title matches above description and code matches', () => {
    expect(ids('debounce')).toEqual(['1', '3']);
    expect(ids('timeout')[0]).toBe('2');
  });
  it('requires all terms (AND)', () => {
    expect(ids('fetch timeout')).toEqual(['2']);
    expect(ids('fetch python')).toEqual([]);
  });
  it('matches tags, languages and code', () => {
    expect(ids('hooks')).toEqual(['4']);
    expect(ids('python')).toEqual(['3']);
    expect(ids('abortsignal')).toEqual(['2']);
  });
  it('handles unicode and emoji', () => {
    expect(ids('ünïcode')).toEqual(['5']);
    expect(ids('🚀')).toEqual(['5']);
    expect(ids('名前')).toEqual(['5']);
  });
  it('supports fuzzy subsequence matches on titles', () => {
    expect(ids('dbnc')).toEqual(['1']);
    expect(subsequenceScore('debounce', 'dbc')).toBeGreaterThan(0);
    expect(subsequenceScore('debounce', 'xyz')).toBe(0);
    expect(subsequenceScore('abc', 'abc')).toBe(1);
  });
  it('supports qualifiers', () => {
    expect(parseQuery('lang:py tag:#cli is:fav hello "two words"')).toEqual({
      terms: ['hello', 'two words'],
      languages: ['python'],
      tags: ['cli'],
      favorite: true,
    });
    expect(ids('lang:python')).toEqual(['3']);
    expect(ids('tag:react')).toEqual(['4']);
    expect(ids('is:fav')).toEqual(['4']);
  });
  it('applies filters', () => {
    expect(ids('', { ...NO_FILTERS, language: 'tsx' })).toEqual(['4']);
    expect(ids('', { ...NO_FILTERS, tag: 'http' })).toEqual(['2']);
    expect(ids('', { ...NO_FILTERS, favorites: true })).toEqual(['4']);
  });
  it('scores exact titles highest', () => {
    const e = indexSnippet(snip({ title: 'grep' }));
    expect(scoreTerm(e, 'grep')).toBe(100);
    expect(scoreTerm(e, 'gr')).toBe(70);
    expect(scoreTerm(e, 'zzz')).toBe(0);
  });
  it('reuses cached entries but reflects changed fields', () => {
    const a = snip({ id: 'c1', title: 'Cache me', updatedAt: 1 });
    const first = buildSearchIndex([a]);
    const second = buildSearchIndex([{ ...a, favorite: true }]);
    expect(second[0].snippet.favorite).toBe(true);
    expect(second[0].title).toBe(first[0].title);
    const third = buildSearchIndex([{ ...a, title: 'Renamed', updatedAt: 2 }]);
    expect(third[0].title).toBe('renamed');
  });
  it('is fast for 5 000 snippets', () => {
    const big = Array.from({ length: 5000 }, (_, i) =>
      snip({
        id: `big-${i}`,
        title: `Snippet number ${i} ${i % 7 === 0 ? 'docker' : 'misc'}`,
        tags: [`tag${i % 50}`],
        code: `function f${i}() {\n  return ${i};\n}\n`.repeat(20),
        updatedAt: i,
      }),
    );
    const bigIndex = buildSearchIndex(big);
    const start = performance.now();
    const hits = searchSnippets(bigIndex, 'docker', NO_FILTERS, 'updated');
    const codeHits = searchSnippets(bigIndex, 'return 4999', NO_FILTERS, 'updated');
    const elapsed = performance.now() - start;
    expect(hits.length).toBe(715);
    expect(codeHits.map((h) => h.snippet.id)).toContain('big-4999');
    expect(elapsed).toBeLessThan(250);
  });
  it('counts tags and languages', () => {
    expect(tagCounts(library)[0]).toEqual(['cli', 1]);
    expect(languageCounts(library)[0]).toEqual(['javascript', 3]);
  });
});

describe('import / export', () => {
  const lib = [snip({ id: 'a', title: 'A', code: 'x', tags: ['t'] }), snip({ id: 'b', title: 'B', code: 'y' })];

  it('round-trips an export', () => {
    const text = exportSnippets(lib, new Date('2024-01-01T00:00:00Z'));
    const data = JSON.parse(text);
    expect(data).toMatchObject({ format: EXPORT_FORMAT, version: 1, count: 2, exportedAt: '2024-01-01T00:00:00.000Z' });
    const parsed = parseImport(text, makeId);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.snippets).toEqual(lib);
  });
  it('rejects invalid files with human messages', () => {
    expect(() => parseImport('{nope', makeId)).toThrow(/not valid JSON/);
    expect(() => parseImport('{"a":1}', makeId)).toThrow(/No snippets found/);
    expect(() => parseImport('{"format":"other","snippets":[]}', makeId)).toThrow(/Unrecognized format/);
    expect(() => parseImport(`{"format":"${EXPORT_FORMAT}","version":99,"snippets":[]}`, makeId)).toThrow(/newer version/);
    expect(() => parseImport('"str"', makeId)).toThrow(/No snippets found/);
  });
  it('validates items, fixes what it can and reports the rest', () => {
    const parsed = parseImport(
      JSON.stringify([
        { title: 'ok', code: 'print(1)', language: 'py', tags: 'a, b', createdAt: '2020-01-01' },
        { title: 'no code' },
        42,
        { title: '', code: '   ' },
        { code: 'z', language: 'klingon', id: 'dup' },
        { name: 'Gist style', content: 'echo hi', id: 'dup' },
      ]),
      makeId,
      777,
    );
    expect(parsed.snippets).toHaveLength(3);
    expect(parsed.snippets[0]).toMatchObject({ language: 'python', tags: ['a', 'b'], createdAt: Date.parse('2020-01-01') });
    expect(parsed.snippets[0].updatedAt).toBe(parsed.snippets[0].createdAt);
    expect(parsed.snippets[1]).toMatchObject({ language: 'plaintext', title: 'z', id: 'dup' });
    expect(parsed.snippets[2].title).toBe('Gist style');
    expect(parsed.snippets[2].id).not.toBe('dup');
    expect(parsed.errors).toEqual([
      'Item 2: missing "code" text.',
      'Item 3: not an object.',
      'Item 4: both title and code are empty.',
    ]);
    expect(parsed.warnings.join(' ')).toMatch(/klingon/);
    expect(parsed.warnings.join(' ')).toMatch(/duplicate id/);
  });
  it('accepts a single snippet object and a BOM', () => {
    const parsed = parseImport('\uFEFF{"title":"x","code":"y"}', makeId);
    expect(parsed.snippets).toHaveLength(1);
  });
  it('plans merges for each conflict strategy', () => {
    const incoming = [
      { ...lib[0] }, // unchanged
      { ...lib[1], code: 'changed' }, // conflict
      snip({ id: 'c', title: 'C' }), // new
    ];
    expect(countConflicts(lib, incoming)).toBe(1);
    const both = planImport(lib, incoming, 'keep-both', () => 'fresh');
    expect(both).toMatchObject({ added: 1, copied: 1, unchanged: 1, conflicts: 1, replaced: 0, skipped: 0 });
    expect(both.toPut.map((s) => s.id)).toEqual(['fresh', 'c']);
    const replace = planImport(lib, incoming, 'replace', makeId);
    expect(replace.toPut.map((s) => s.id)).toEqual(['b', 'c']);
    expect(replace.replaced).toBe(1);
    const skip = planImport(lib, incoming, 'skip', makeId);
    expect(skip.toPut.map((s) => s.id)).toEqual(['c']);
    expect(skip.skipped).toBe(1);
  });
});

describe('templates', () => {
  it('are valid, unique and use known languages', () => {
    const known = new Set(SNIPPET_LANGUAGES.map((l) => l.id));
    expect(SNIPPET_TEMPLATES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(SNIPPET_TEMPLATES.map((t) => t.id)).size).toBe(SNIPPET_TEMPLATES.length);
    for (const t of SNIPPET_TEMPLATES) {
      expect(known.has(t.language), t.id).toBe(true);
      expect(t.code.trim().length).toBeGreaterThan(20);
      expect(validateDraft(t)).toBeNull();
    }
    expect(new Set(SNIPPET_TEMPLATES.map((t) => t.language)).size).toBeGreaterThanOrEqual(10);
  });
});

describe('highlight', () => {
  it('returns a plain token without a parser', () => {
    expect(highlightCode('a\nb', null)).toEqual([{ text: 'a\nb', cls: '' }]);
    expect(highlightCode('', null)).toEqual([]);
  });
  it('highlights javascript and keeps every character', async () => {
    const { parser } = await loadSnippetLanguage('javascript');
    const code = 'const x = "hi"; // note\nfunction f() { return 42 }';
    const tokens = highlightCode(code, parser);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
    expect(tokens.find((t) => t.text === 'const')?.cls).toMatch(/tok-keyword/);
    expect(tokens.find((t) => t.text === '"hi"')?.cls).toMatch(/tok-string/);
    expect(tokens.some((t) => t.cls.includes('tok-comment'))).toBe(true);
  });
  it('highlights legacy stream languages', async () => {
    const { parser, extension } = await loadSnippetLanguage('ruby');
    expect(parser).not.toBeNull();
    expect(extension).toBeTruthy();
    const tokens = highlightCode('def hi\n  puts "x"\nend', parser);
    expect(tokens.find((t) => t.text === 'def')?.cls).toMatch(/tok-keyword/);
  });
  it('splits tokens into lines', () => {
    const lines = tokensToLines([
      { text: 'a\nb', cls: 'tok-x' },
      { text: 'c\n', cls: '' },
    ]);
    expect(lines).toEqual([[{ text: 'a', cls: 'tok-x' }], [{ text: 'b', cls: 'tok-x' }, { text: 'c', cls: '' }], []]);
  });
  it('takes preview lines', () => {
    expect(previewLines('1\n2\n3\n4', 2)).toBe('1\n2');
    expect(previewLines('1\n2', 5)).toBe('1\n2');
    expect(previewLines('x'.repeat(1000), 3, 50)).toHaveLength(50);
    expect(previewLines('a\n\n\n', 5)).toBe('a');
  });
});
