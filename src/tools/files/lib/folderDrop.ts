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

/** Recursively collect every file below the given entries. Paths are relative, without a leading slash. */
export async function collectEntries(entries: FileSystemEntry[], limit = 20000): Promise<PathedFile[]> {
  const out: PathedFile[] = [];
  const stack = [...entries];
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.isFile) {
      out.push({
        file: await fileOf(entry as FileSystemFileEntry),
        path: entry.fullPath.replace(/^\/+/, '') || entry.name,
      });
      if (out.length >= limit) break;
    } else if (entry.isDirectory) {
      stack.push(...(await readAll((entry as FileSystemDirectoryEntry).createReader())).reverse());
    }
  }
  return out;
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
