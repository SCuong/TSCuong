import type { OutputFile } from './files';

export function outputToFile(file: OutputFile): File {
  const blob = file.data instanceof Blob ? file.data : new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.type });
  return new File([blob], file.name, { type: file.type });
}

export function supportsFileSharing(type = 'application/pdf'): boolean {
  try {
    return Boolean(typeof navigator.share === 'function' && navigator.canShare?.({ files: [new File([], 'document', { type })] }));
  } catch { return false; }
}

/** Must be called from a user activation. Returns false for an unsupported file set. */
export async function shareOutputs(files: OutputFile[]): Promise<boolean> {
  const outgoing = files.map(outputToFile);
  if (!navigator.canShare?.({ files: outgoing })) return false;
  await navigator.share({ files: outgoing });
  return true;
}
