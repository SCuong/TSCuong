/** Helpers for writing into a folder picked with showDirectoryPicker (File System Access API). */

/** The subset of FileSystemDirectoryHandle these helpers use (easy to fake in tests). */
export interface DirectoryLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown>;
}

function split(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  return { dir: slash >= 0 ? path.slice(0, slash) : '', name: path.slice(slash + 1) };
}

/**
 * The relative, "/"-separated `paths` that already exist as files under `root`, so the caller can ask
 * before replacing anything. Nothing is created while checking.
 */
export async function existingFiles(root: DirectoryLike, paths: string[]): Promise<string[]> {
  const dirs = new Map<string, Promise<DirectoryLike | null>>([['', Promise.resolve(root)]]);
  const dirFor = (dirPath: string): Promise<DirectoryLike | null> => {
    const cached = dirs.get(dirPath);
    if (cached) return cached;
    const { dir, name } = split(dirPath);
    const lookup = dirFor(dir).then((parent) => (parent ? parent.getDirectoryHandle(name).catch(() => null) : null));
    dirs.set(dirPath, lookup);
    return lookup;
  };
  const found: string[] = [];
  for (const path of paths) {
    const { dir, name } = split(path);
    const folder = await dirFor(dir);
    if (!folder) continue;
    try {
      await folder.getFileHandle(name);
      found.push(path);
    } catch {
      // Not there (or a folder of that name, which the write will report).
    }
  }
  return found;
}

/** Creates (or opens) the folder at `path` below `root`, one level at a time. */
export async function ensureFolder<T extends DirectoryLike>(root: T, path: string): Promise<T> {
  let folder: DirectoryLike = root;
  for (const part of path.split('/').filter(Boolean)) folder = await folder.getDirectoryHandle(part, { create: true });
  return folder as T;
}
