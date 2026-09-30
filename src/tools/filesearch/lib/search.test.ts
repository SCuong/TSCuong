import { describe, expect, it } from 'vitest';
import { createSearchIndex, FULLTEXT_OPTIONS, tokenize } from './searchIndex';
import {
  accentInsensitiveSource,
  camelParts,
  compileUserRegex,
  foldTerm,
  highlightSegments,
  matchLines,
  substringsPattern,
  termsPattern,
  windowAround,
} from './snippets';
import { EMPTY_FILTERS, extensionCounts, makeFilter, parseDateInput, scorePathMatch, sortItems, type FileMeta } from './query';

const meta = (id: number, path: string, extra: Partial<FileMeta> = {}): FileMeta => ({
  id,
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  ext: path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '',
  size: 100,
  lastModified: 0,
  status: 'text',
  ...extra,
});

function buildIndex(files: Array<[string, string]>) {
  const metas = files.map(([path], i) => meta(i, path));
  const contents = files.map(([, text]) => text);
  const index = createSearchIndex((id) => contents[id]);
  index.addAll(metas);
  const search = (q: string) => index.search(q, { ...FULLTEXT_OPTIONS, combineWith: 'AND' }).map((r) => metas[r.id as number].path);
  return { search, index };
}

describe('term folding', () => {
  it('drops case and Latin/Greek accents', () => {
    expect(foldTerm('Café')).toBe('cafe');
    expect(foldTerm('Nguyễn')).toBe('nguyen');
    expect(foldTerm('RÉSUMÉ')).toBe('resume');
    expect(foldTerm('Đà Nẵng')).toBe('da nang');
    expect(foldTerm('Łódź')).toBe('lodz');
    expect(foldTerm('άλφα')).toBe('αλφα');
    // Decomposed input folds the same as precomposed input.
    expect(foldTerm('cafe' + String.fromCharCode(0x301))).toBe('cafe');
  });

  it('keeps marks that change the letter in other scripts', () => {
    expect(foldTerm('が')).toBe('が');
    expect(foldTerm('한국어')).toBe('한국어');
    expect(foldTerm('東京')).toBe('東京');
  });
});

describe('tokenizer', () => {
  it('splits on punctuation, symbols, tabs and camelCase', () => {
    expect(tokenize('const x=getValue(a+b);')).toEqual(['const', 'x', 'getValue', 'get', 'Value', 'a', 'b']);
    expect(tokenize('SECRET_TOKEN=envneedle')).toEqual(['SECRET', 'TOKEN', 'envneedle']);
    expect(tokenize('a\tb\tc')).toEqual(['a', 'b', 'c']);
    expect(tokenize('parseHTTPResponse')).toEqual(['parseHTTPResponse', 'parse', 'HTTP', 'Response']);
    expect(camelParts('parseHTTPResponse')).toEqual(['parse', 'HTTP', 'Response']);
  });
});

describe('full-text search', () => {
  const { search } = buildIndex([
    ['README.md', 'The café serves résumé writers. Contact Nguyễn Văn An.'],
    ['src/app.ts', 'export function parseHTTPResponse(raw) {}\nconst x=getValue();'],
    ['i18n/vi.txt', 'Hà Nội là thủ đô.'],
    ['notes.txt', 'lucky seven'],
    ['.env', 'SECRET_TOKEN=envneedle'],
  ]);

  it('is accent-insensitive in both directions', () => {
    expect(search('cafe')).toEqual(['README.md']);
    expect(search('café')).toEqual(['README.md']);
    expect(search('resume')).toEqual(['README.md']);
    expect(search('Nguyen')).toEqual(['README.md']);
    expect(search('Ha Noi')).toEqual(['i18n/vi.txt']);
  });

  it('finds identifiers inside code and camelCase parts', () => {
    expect(search('getValue')).toEqual(['src/app.ts']);
    expect(search('HTTP')).toEqual(['src/app.ts']);
    expect(search('envneedle')).toEqual(['.env']);
  });

  it('matches prefixes and tolerates small typos', () => {
    expect(search('luck')).toEqual(['notes.txt']);
    expect(search('respnse')).toEqual(['src/app.ts']);
    expect(search('lucky unicorn')).toEqual([]);
  });
});

describe('highlighting', () => {
  it('highlights folded terms in accented text', () => {
    const re = termsPattern(['cafe', 'resume', 'nguyen'])!;
    const hits = highlightSegments('The café serves résumé writers. Nguyễn', re)
      .filter((s) => s.hit)
      .map((s) => s.text);
    expect(hits).toEqual(['café', 'résumé', 'Nguyễn']);
    // Decomposed accents are part of the match.
    const nfd = 'cafe' + String.fromCharCode(0x301) + '!';
    expect(highlightSegments(nfd, re).filter((s) => s.hit).map((s) => s.text)).toEqual(['cafe' + String.fromCharCode(0x301)]);
  });

  it('matches whole terms and camelCase parts, not arbitrary substrings', () => {
    const re = termsPattern(['http', 'parse', 'response'])!;
    expect(highlightSegments('parseHTTPResponse sparse', re).filter((s) => s.hit).map((s) => s.text)).toEqual(['parse', 'HTTP', 'Response']);
  });

  it('highlights name matches accent-insensitively', () => {
    const re = substringsPattern(['cafe'])!;
    expect(highlightSegments('Café menu.txt', re).filter((s) => s.hit).map((s) => s.text)).toEqual(['Café']);
    expect(new RegExp(accentInsensitiveSource('e'), 'u').test('ë')).toBe(true);
  });

  it('builds snippets with line numbers and windows long lines', () => {
    const re = termsPattern(['needle'])!;
    const res = matchLines('a\nb needle\nc\nneedle again', re, { maxSnippets: 1 });
    expect(res.matchingLines).toBe(2);
    expect(res.snippets).toHaveLength(1);
    expect(res.snippets[0].line).toBe(2);
    const win = windowAround('x'.repeat(500) + 'needle' + 'y'.repeat(500), 500, 100);
    expect(win.text.startsWith('…')).toBe(true);
    expect(win.text.endsWith('…')).toBe(true);
    expect(win.text).toContain('needle');
  });
});

describe('regex search', () => {
  it('rejects invalid, empty-matching and huge patterns with a sentence', () => {
    expect(compileUserRegex('[', false)).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid regular expression/) });
    expect(compileUserRegex('x*', false)).toMatchObject({ ok: false, error: expect.stringMatching(/match empty text/) });
    expect(compileUserRegex('a'.repeat(1001), false).ok).toBe(false);
    const ok = compileUserRegex('ORDER \\d+', true);
    expect(ok.ok && ok.regex.flags.includes('i')).toBe(false);
  });
});

describe('name search and filters', () => {
  it('matches every word in the path, accent-insensitively, preferring names', () => {
    expect(scorePathMatch({ name: 'Café menu.txt', path: 'docs/Café menu.txt' }, [foldTerm('cafe')])).toBeGreaterThan(0);
    expect(scorePathMatch({ name: 'a.txt', path: 'x/a.txt' }, ['b'])).toBe(0);
    const inName = scorePathMatch({ name: 'report.md', path: 'report.md' }, ['report']);
    const inFolder = scorePathMatch({ name: 'a.md', path: 'report/a.md' }, ['report']);
    expect(inName).toBeGreaterThan(inFolder);
  });

  it('filters by type, size, date and folder', () => {
    const files = [meta(0, 'src/a.ts', { size: 10, lastModified: 1000 }), meta(1, 'Docs/Ünïcode/b.md', { size: 5000, lastModified: 5000 }), meta(2, 'Makefile')];
    expect(files.filter(makeFilter({ ...EMPTY_FILTERS, exts: ['ts'] })).map((f) => f.id)).toEqual([0]);
    expect(files.filter(makeFilter({ ...EMPTY_FILTERS, exts: [''] })).map((f) => f.id)).toEqual([2]);
    expect(files.filter(makeFilter({ ...EMPTY_FILTERS, minSize: 1000 })).map((f) => f.id)).toEqual([1]);
    expect(files.filter(makeFilter({ ...EMPTY_FILTERS, modifiedFrom: 2000 })).map((f) => f.id)).toEqual([1]);
    expect(files.filter(makeFilter({ ...EMPTY_FILTERS, pathContains: 'docs\\unicode' })).map((f) => f.id)).toEqual([1]);
    expect(extensionCounts(files)).toEqual([
      { ext: '', count: 1 },
      { ext: 'md', count: 1 },
      { ext: 'ts', count: 1 },
    ]);
    expect(sortItems(files.map((m) => ({ meta: m, score: 0 })), 'size').map((i) => i.meta.id)).toEqual([1, 2, 0]);
    expect(parseDateInput('2024-02-03')).toBe(new Date(2024, 1, 3).getTime());
    expect(parseDateInput('nope')).toBeNull();
  });
});
