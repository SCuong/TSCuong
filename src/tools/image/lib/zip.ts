/** ZIP output for batch results (fflate, async so large batches stay responsive). */

/** Make file names unique by appending " (2)", " (3)"… before the extension (case-insensitive). */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const clean = name.replace(/[\\/]/g, '_') || 'file';
    let candidate = clean;
    let n = 2;
    const dot = clean.lastIndexOf('.');
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    while (seen.has(candidate.toLowerCase())) candidate = `${base} (${n++})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function zipBlobs(entries: Array<{ name: string; data: Blob | Uint8Array | string }>, level: 0 | 6 = 0): Promise<Blob> {
  const { zip } = await import('fflate');
  const names = uniqueNames(entries.map((e) => e.name));
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < entries.length; i++) {
    const d = entries[i].data;
    files[names[i]] =
      typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(await d.arrayBuffer());
  }
  const out = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level }, (err, data) => (err ? reject(new Error('Could not create the ZIP file.')) : resolve(data))),
  );
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
