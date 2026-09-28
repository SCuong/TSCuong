/** Browser folder access helpers: File System Access API, webkitdirectory input and dropped folders. */
import { isIgnored, type IgnoreRule } from './ignore';

type PermissionMode = { mode: 'read' | 'readwrite' };

interface PermissionHandle {
  queryPermission?: (d: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (d: PermissionMode) => Promise<PermissionState>;
}

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export function supportsDirectoryInput(): boolean {
  if (typeof document === 'undefined') return false;
  const input = document.createElement('input');
  return 'webkitdirectory' in input;
}

/** Opens the native folder picker. Resolves null when the user cancels. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  try {
    return await picker({ id: 'localkit-file-search', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'NotAllowedError')) {
      throw new Error('The browser did not allow access to that folder. System folders (like the whole home folder or Windows directory) are blocked for safety; choose a sub-folder.', { cause: error });
    }
    throw error;
  }
}

/** Make sure we can read from a stored handle, asking the user if needed (must run in a user gesture). */
export async function ensureReadPermission(handle: FileSystemHandle): Promise<boolean> {
  const h = handle as unknown as PermissionHandle;
  if (!h.queryPermission || !h.requestPermission) return true;
  const mode: PermissionMode = { mode: 'read' };
  if ((await h.queryPermission(mode)) === 'granted') return true;
  return (await h.requestPermission(mode)) === 'granted';
}

/** Resolve a "/"-separated relative path to a file handle below `root`. */
export async function resolveFileHandle(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return dir.getFileHandle(parts[parts.length - 1]);
}

/** Files from <input webkitdirectory>: strips the root folder from webkitRelativePath. */
export function filesFromDirectoryInput(list: FileList | File[]): { rootName: string; files: File[]; paths: string[] } {
  const files = Array.from(list);
  const paths: string[] = [];
  let rootName = '';
  for (const file of files) {
    const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const slash = rel.indexOf('/');
    if (!rootName) rootName = slash === -1 ? 'Selected files' : rel.slice(0, slash);
    paths.push(slash === -1 ? rel : rel.slice(slash + 1));
  }
  return { rootName: rootName || 'Selected folder', files, paths };
}

interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface FileEntryLike extends EntryLike {
  file(success: (file: File) => void, error?: (err: unknown) => void): void;
}
interface DirEntryLike extends EntryLike {
  createReader(): { readEntries(success: (entries: EntryLike[]) => void, error?: (err: unknown) => void): void };
}

/**
 * Walk a dropped folder (DataTransferItem.webkitGetAsEntry) and collect its
 * files. Ignored folders are skipped without being read.
 */
export async function filesFromDroppedEntry(
  root: EntryLike,
  rules: IgnoreRule[],
  skipHidden: boolean,
  onProgress: (count: number) => void,
  signal: AbortSignal,
): Promise<{ files: File[]; paths: string[]; errors: number }> {
  const files: File[] = [];
  const paths: string[] = [];
  let errors = 0;
  const readAll = (dir: DirEntryLike) =>
    new Promise<EntryLike[]>((resolve, reject) => {
      const reader = dir.createReader();
      const out: EntryLike[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) resolve(out);
          else {
            out.push(...batch);
            next();
          }
        }, reject);
      next();
    });
  const getFile = (entry: FileEntryLike) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

  const stack: Array<{ entry: DirEntryLike; prefix: string }> = [{ entry: root as DirEntryLike, prefix: '' }];
  while (stack.length) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { entry, prefix } = stack.pop()!;
    let children: EntryLike[];
    try {
      children = await readAll(entry);
    } catch {
      errors++;
      continue;
    }
    for (const child of children) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (isIgnored(path, rules, skipHidden)) continue;
      if (child.isDirectory) stack.push({ entry: child as DirEntryLike, prefix: path });
      else if (child.isFile) {
        try {
          files.push(await getFile(child as FileEntryLike));
          paths.push(path);
          if ((files.length & 63) === 0) onProgress(files.length);
        } catch {
          errors++;
        }
      }
    }
  }
  onProgress(files.length);
  return { files, paths, errors };
}

export type BrowserSupport = 'full' | 'fallback' | 'none';

export function folderSupport(): BrowserSupport {
  if (supportsDirectoryPicker()) return 'full';
  if (supportsDirectoryInput()) return 'fallback';
  return 'none';
}
