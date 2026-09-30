/** Reading dropped folders (DataTransferItem.webkitGetAsEntry) into Files with relative paths. */

export interface PathedFile {
  file: File;
  path: string;
}

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
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
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

export interface CollectedEntries {
  files: PathedFile[];
  /** Folders with nothing inside (relative paths), so archives can keep them. */
  emptyDirs: string[];
  /** True when more than `limit` files were found and the rest were left out. */
  truncated: boolean;
}

/** Recursively collect every file below the given entries. Paths are relative, without a leading slash. */
export async function collectEntries(entries: FileSystemEntry[], limit = 20000): Promise<CollectedEntries> {
  const files: PathedFile[] = [];
  const emptyDirs: string[] = [];
  const stack = [...entries];
  let truncated = false;
  while (stack.length) {
    const entry = stack.pop()!;
    const path = entry.fullPath.replace(/^\/+/, '') || entry.name;
    if (entry.isFile) {
      if (files.length >= limit) {
        truncated = true;
        break;
      }
      files.push({ file: await fileOf(entry as FileSystemFileEntry), path });
    } else if (entry.isDirectory) {
      const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
      if (!children.length) emptyDirs.push(path);
      stack.push(...children.reverse());
    }
  }
  return { files, emptyDirs, truncated };
}

/**
 * Synchronously grab directory entries from a drop event (they are only
 * available during the event). Returns null when no folder was dropped.
 */
export function droppedDirectories(dt: DataTransfer | null): { names: Set<string>; entries: FileSystemEntry[] } | null {
  if (!dt?.items) return null;
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.some((e) => e.isDirectory)) return null;
  return {
    names: new Set(entries.filter((e) => e.isDirectory).map((e) => e.name)),
    entries,
  };
}
