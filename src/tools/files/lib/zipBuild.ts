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

export async function buildZip(
  inputs: ZipInput[],
  level: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const { Zip, ZipDeflate, ZipPassThrough } = await import('fflate');
  const total = inputs.reduce((n, i) => n + i.file.size, 0) || 1;
  let done = 0;
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  let resolveEnd!: () => void;
  const ended = new Promise<void>((r) => (resolveEnd = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else chunks.push(chunk);
    if (final || err) resolveEnd();
  });
  const paths = uniquePaths(inputs.map((i) => i.path));
  for (let i = 0; i < inputs.length; i++) {
    if (signal.aborted) {
      zip.terminate();
      throw new DOMException('Aborted', 'AbortError');
    }
    const { file } = inputs[i];
    const entry =
      level === 0
        ? new ZipPassThrough(paths[i])
        : new ZipDeflate(paths[i], {
            level: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
          });
    entry.mtime = file.lastModified ? new Date(file.lastModified) : new Date();
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
      onProgress(Math.min(0.99, done / total));
      // Let the UI breathe between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }
    entry.push(pending ?? new Uint8Array(0), true);
  }
  zip.end();
  await ended;
  if (failure) throw new Error('Could not create the ZIP file.');
  onProgress(1);
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], {
    type: 'application/zip',
  });
}
