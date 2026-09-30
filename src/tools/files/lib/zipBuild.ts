/** Creating ZIP archives from File objects with progress (fflate streaming). */

export interface ZipInput {
  path: string;
  file: File;
}

/** Normalize and de-duplicate archive paths ("a.txt", "a (2).txt"), keeping folders. */
export function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.map((raw) => {
    const clean =
      raw
        .replace(/\\/g, '/')
        .split('/')
        .filter((p) => p && p !== '.' && p !== '..')
        .join('/') || 'file';
    let candidate = clean;
    const slash = clean.lastIndexOf('/');
    const dir = slash >= 0 ? clean.slice(0, slash + 1) : '';
    const base = clean.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let n = 2;
    while (seen.has(candidate.toLowerCase())) candidate = `${dir}${stem} (${n++})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Classic ZIP limits. The writer (fflate) has no ZIP64 support, so larger archives would get truncated
 * 32-bit sizes and offsets and come out corrupt: they are refused with an explanation instead.
 */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

export class ZipLimitError extends Error {}

/** DOS timestamps only cover 1980–2107 and fflate accepts 1980–2099: clamp instead of failing. */
export function zipDate(ms: number): Date {
  const d = ms ? new Date(ms) : new Date();
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) return new Date(1980, 0, 1);
  if (d.getFullYear() > 2099) return new Date(2099, 11, 31, 23, 59, 58);
  return d;
}

/** Checks that `inputs` (plus `folders` empty folder entries) fit a classic ZIP; returns a sentence or null. */
export function zipLimitProblem(inputs: ZipInput[], folders = 0): string | null {
  if (inputs.length + folders > ZIP_MAX_ENTRIES) {
    return `A ZIP file can hold at most ${ZIP_MAX_ENTRIES.toLocaleString('en-US')} entries without ZIP64, which this tool can’t write; this one would have ${(inputs.length + folders).toLocaleString('en-US')}. Split the files into several archives.`;
  }
  const big = inputs.find((i) => i.file.size >= ZIP_MAX_BYTES);
  if (big) return `“${big.path}” is 4 GB or larger, which needs ZIP64 (not supported here).`;
  return null;
}

export async function buildZip(
  inputs: ZipInput[],
  level: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  folders: string[] = [],
): Promise<Blob> {
  const problem = zipLimitProblem(inputs, folders.length);
  if (problem) throw new ZipLimitError(problem);
  const { Zip, ZipDeflate, ZipPassThrough } = await import('fflate');
  const total = inputs.reduce((n, i) => n + i.file.size, 0) || 1;
  let done = 0;
  const chunks: Uint8Array[] = [];
  let written = 0;
  let failure: Error | null = null;
  let resolveEnd!: () => void;
  const ended = new Promise<void>((r) => (resolveEnd = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else {
      chunks.push(chunk);
      written += chunk.length;
    }
    if (final || err) resolveEnd();
  });
  const tooLarge = () =>
    new ZipLimitError('The ZIP file would be larger than 4 GB, which needs ZIP64 (not supported here). Split the files into several archives or compress more.');
  const paths = uniquePaths(inputs.map((i) => i.path));
  // Folders that contain a file are implied by its path; only empty folders need their own entry.
  const occupied = new Set<string>();
  for (const p of paths) {
    const parts = p.toLowerCase().split('/');
    for (let k = 1; k < parts.length; k++) occupied.add(parts.slice(0, k).join('/'));
  }
  for (const folder of uniquePaths(folders)) {
    if (occupied.has(folder.toLowerCase())) continue;
    const dirEntry = new ZipPassThrough(`${folder}/`);
    dirEntry.mtime = zipDate(Date.now());
    zip.add(dirEntry);
    dirEntry.push(new Uint8Array(0), true);
  }
  for (let i = 0; i < inputs.length; i++) {
    if (signal.aborted) {
      zip.terminate();
      throw new DOMException('Aborted', 'AbortError');
    }
    if (written > ZIP_MAX_BYTES) {
      zip.terminate();
      throw tooLarge();
    }
    const { file } = inputs[i];
    const entry =
      level === 0
        ? new ZipPassThrough(paths[i])
        : new ZipDeflate(paths[i], {
            level: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
          });
    entry.mtime = zipDate(file.lastModified);
    zip.add(entry);
    const reader = file.stream().getReader();
    let pending: Uint8Array | null = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (signal.aborted) {
        await reader.cancel();
        zip.terminate();
        throw new DOMException('Aborted', 'AbortError');
      }
      if (finished) break;
      if (pending) entry.push(pending, false);
      pending = value;
      done += value.length;
      if (written > ZIP_MAX_BYTES) {
        await reader.cancel();
        zip.terminate();
        throw tooLarge();
      }
      onProgress(Math.min(0.99, done / total));
      // Let the UI breathe between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }
    entry.push(pending ?? new Uint8Array(0), true);
  }
  // The central directory's offset is a 32-bit field.
  if (written > ZIP_MAX_BYTES) {
    zip.terminate();
    throw tooLarge();
  }
  zip.end();
  await ended;
  if (failure) throw new Error('Could not create the ZIP file.');
  onProgress(1);
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], {
    type: 'application/zip',
  });
}
