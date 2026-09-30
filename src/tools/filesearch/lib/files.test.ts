import { describe, expect, it } from 'vitest';
import { decodeText, detectBom, extractFromBytes, extractText, isBinary, looksLikeText } from './extract';
import { DEFAULT_IGNORES, isIgnored, parseIgnoreList } from './ignore';
import { filesFromDirectoryInput } from './folders';
import { extensionOf, isKnownBinaryFile, isTextFile, languageFor } from './textFormats';

const bytes = (...parts: Array<string | number[]>) => {
  const chunks = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/** A File-like object whose slices can be read (independent of the test DOM's Blob support). */
const fakeFile = (name: string, data: Uint8Array) => ({
  name,
  size: data.length,
  slice: (start = 0, end = data.length) => ({ arrayBuffer: async () => data.slice(start, end).buffer }) as unknown as Blob,
});

describe('text extraction', () => {
  it('detects BOMs and NUL-byte binaries', () => {
    expect(detectBom(bytes([0xef, 0xbb, 0xbf], 'x'))).toEqual({ encoding: 'utf-8', skip: 3 });
    expect(detectBom(bytes([0xff, 0xfe], [0x61, 0]))).toEqual({ encoding: 'utf-16le', skip: 2 });
    expect(isBinary(bytes('abc', [0], 'def'))).toBe(true);
    // UTF-16 text is full of NUL bytes but is text when it has a BOM.
    expect(isBinary(bytes([0xff, 0xfe], [0x61, 0, 0x62, 0]))).toBe(false);
  });

  it('decodes UTF-8, UTF-16 and falls back to Windows-1252 for legacy files', () => {
    expect(decodeText(bytes('Zoë 🎉'))).toBe('Zoë 🎉');
    expect(decodeText(bytes([0xff, 0xfe], [0x68, 0, 0x69, 0]))).toBe('hi');
    expect(decodeText(bytes([0xfe, 0xff], [0, 0x68, 0, 0x69]))).toBe('hi');
    // "café" in Latin-1 is not valid UTF-8.
    expect(decodeText(bytes([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });

  it('sniffs files with unknown extensions', () => {
    expect(looksLikeText(bytes('plugins { id "java" }\n'))).toBe(true);
    expect(looksLikeText(bytes([0x4d, 0x5a, 0x90, 0, 3]))).toBe(false);
    expect(looksLikeText(bytes([1, 2, 3, 4, 5, 6, 7, 8, 0x41]))).toBe(false);
  });

  it('reads known and sniffed text formats and skips binaries by name or content', async () => {
    expect(await extractText(fakeFile('build.gradle', bytes("dependencies { implementation 'x' }")), 1000)).toMatchObject({ status: 'text' });
    expect(await extractText(fakeFile('notes.custom', bytes('custom text format')), 1000)).toMatchObject({ status: 'text', text: 'custom text format' });
    expect(await extractText(fakeFile('tool.custom', bytes([0x4d, 0x5a, 0])), 1000)).toMatchObject({ status: 'binary', text: null });
    expect(await extractText(fakeFile('photo.png', bytes('not really a png')), 1000)).toMatchObject({ status: 'not-text' });
    expect(await extractText(fakeFile('big.txt', bytes('x'.repeat(2000))), 1000)).toMatchObject({ status: 'too-large' });
    expect(await extractText(fakeFile('empty.md', bytes()), 1000)).toMatchObject({ status: 'empty', text: '' });
    expect(extractFromBytes(bytes('abc', [0]))).toMatchObject({ status: 'binary' });
  });
});

describe('ignore rules', () => {
  const rules = parseIgnoreList(['node_modules', '*.min.js', '/dist', 'docs/**/draft*', '**/tmp', '# comment', 'build/', ''].join('\n'));

  it('matches names anywhere and paths from the root', () => {
    expect(isIgnored('node_modules', rules)).toBe(true);
    expect(isIgnored('pkg/node_modules/x/index.js', rules)).toBe(true);
    expect(isIgnored('src/app.min.js', rules)).toBe(true);
    expect(isIgnored('src/app.js', rules)).toBe(false);
    // A leading "/" anchors to the indexed folder's root.
    expect(isIgnored('dist', rules)).toBe(true);
    expect(isIgnored('dist/bundle.js', rules)).toBe(true);
    expect(isIgnored('packages/dist/bundle.js', rules)).toBe(false);
    // "**/" also matches zero folders.
    expect(isIgnored('docs/draft-1.md', rules)).toBe(true);
    expect(isIgnored('docs/a/b/draft-2.md', rules)).toBe(true);
    expect(isIgnored('tmp/x', rules)).toBe(true);
    expect(isIgnored('a/tmp/x', rules)).toBe(true);
    expect(isIgnored('build/out.txt', rules)).toBe(true);
    expect(rules.map((r) => r.pattern)).toEqual(['node_modules', '*.min.js', 'dist', 'docs/**/draft*', '**/tmp', 'build']);
  });

  it('skips hidden files on request and handles the defaults', () => {
    expect(isIgnored('.github/workflows/ci.yml', [], true)).toBe(true);
    expect(isIgnored('.github/workflows/ci.yml', [], false)).toBe(false);
    const defaults = parseIgnoreList(DEFAULT_IGNORES.join('\n'));
    expect(isIgnored('.git/config', defaults)).toBe(true);
    expect(isIgnored('src/index.ts', defaults)).toBe(false);
  });
});

describe('folder input and formats', () => {
  it('strips the root folder from webkitRelativePath', () => {
    const file = (rel: string) => Object.assign(new File(['x'], rel.split('/').pop()!), { webkitRelativePath: rel }) as File;
    expect(filesFromDirectoryInput([file('proj/a.txt'), file('proj/src/b.ts')])).toMatchObject({ rootName: 'proj', paths: ['a.txt', 'src/b.ts'] });
  });

  it('knows text and binary formats', () => {
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('Makefile')).toBe('');
    expect(isTextFile('Dockerfile')).toBe(true);
    expect(isTextFile('.env.production')).toBe(true);
    expect(isTextFile('notes.jsonl')).toBe(true);
    expect(isKnownBinaryFile('photo.JPG')).toBe(true);
    expect(isKnownBinaryFile('server.key')).toBe(false);
    expect(languageFor('app.tsx')).toBe('tsx');
  });
});
