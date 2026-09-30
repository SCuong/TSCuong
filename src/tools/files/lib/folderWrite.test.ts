import { describe, expect, it } from 'vitest';
import { ensureFolder, existingFiles, type DirectoryLike } from './folderWrite';

/** An in-memory folder: nested Maps for folders, `true` for files. */
type Tree = Map<string, Tree | true>;

function fakeDir(tree: Tree): DirectoryLike {
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  return {
    async getDirectoryHandle(name, options) {
      let child = tree.get(name);
      if (child === undefined && options?.create) {
        child = new Map();
        tree.set(name, child);
      }
      if (!(child instanceof Map)) throw notFound();
      return fakeDir(child);
    },
    async getFileHandle(name, options) {
      const child = tree.get(name);
      if (child === true) return {};
      if (child instanceof Map) throw Object.assign(new Error('is a folder'), { name: 'TypeMismatchError' });
      if (options?.create) {
        tree.set(name, true);
        return {};
      }
      throw notFound();
    },
  };
}

describe('existingFiles', () => {
  it('reports only paths that already exist as files, without creating anything', async () => {
    const tree: Tree = new Map<string, Tree | true>([
      ['a.txt', true],
      ['docs', new Map<string, Tree | true>([['readme.md', true]])],
      ['folder-not-file', new Map()],
    ]);
    const found = await existingFiles(fakeDir(tree), ['a.txt', 'b.txt', 'docs/readme.md', 'docs/new.md', 'missing/x.txt', 'folder-not-file']);
    expect(found).toEqual(['a.txt', 'docs/readme.md']);
    expect(tree.has('missing')).toBe(false);
  });
});

describe('ensureFolder', () => {
  it('creates nested folders, including empty ones', async () => {
    const tree: Tree = new Map();
    const root = fakeDir(tree);
    await ensureFolder(root, 'a/b/c');
    await ensureFolder(root, '');
    const a = tree.get('a');
    expect(a instanceof Map && a.get('b') instanceof Map).toBe(true);
  });
});
