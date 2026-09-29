import { zipSync, type Zippable } from 'fflate';
import { formatPageList } from './ranges';

/** Remove characters that are invalid in file names on common systems. */
export function sanitizeFileName(name: string): string {
  const noControl = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 ? '-' : ch)).join('');
  const clean = noControl
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .trim();
  return clean.slice(0, 180) || 'document';
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "report.pdf" + "merged" → "report-merged.pdf" */
export function outputName(inputName: string, suffix: string, ext = 'pdf'): string {
  const base = sanitizeFileName(stripExtension(inputName || 'document'));
  return `${base}${suffix ? `-${suffix}` : ''}.${ext}`;
}

/** Make the user's typed output name safe and ensure the extension. */
export function ensureExtension(name: string, ext: string): string {
  const trimmed = sanitizeFileName(name.trim());
  return trimmed.toLowerCase().endsWith(`.${ext}`) ? trimmed : `${trimmed}.${ext}`;
}

/** Zero-padded index so files sort correctly: pad(3, 120) → "003". */
export function padIndex(n: number, total: number): string {
  return String(n).padStart(String(total).length, '0');
}

/**
 * Names for the files Split creates from `inputName` (the original file name, with its extension):
 * one per group of 1-based pages. "report.v2.pdf" keeps its "report.v2" base.
 */
export function splitFileNames(
  inputName: string,
  mode: 'single' | 'every' | 'ranges',
  groups: readonly number[][],
  pageCount: number,
): string[] {
  return groups.map((g, i) => {
    if (mode === 'single') return outputName(inputName, `page-${padIndex(g[0], pageCount)}`);
    if (mode === 'every') return outputName(inputName, `part-${padIndex(i + 1, groups.length)}`);
    return outputName(inputName, `pages-${formatPageList(g).replace(/, /g, '_')}`.slice(0, 80));
  });
}

export interface OutputFile {
  name: string;
  data: Uint8Array | Blob;
  type: string;
}

/** Deduplicate names inside an archive: a.pdf, a (2).pdf, ... */
export function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    const candidate = dot > 0 ? `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}` : `${name} (${count + 1})`;
    used.set(candidate.toLowerCase(), 1);
    return candidate;
  });
}

/** Build a ZIP (stored, no recompression: PDFs and images are already compressed). */
export async function zipFiles(files: OutputFile[]): Promise<Blob> {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Zippable = {};
  for (let i = 0; i < files.length; i++) {
    const data = files[i].data;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    entries[names[i]] = [bytes, { level: 0 }];
  }
  const zipped = zipSync(entries);
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

// ---------------------------------------------------------------------------
// Image sniffing

export type ImageKind = 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'svg' | 'unknown';

export function sniffImage(bytes: Uint8Array): ImageKind {
  const b = bytes;
  if (b.length < 12) return 'unknown';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 12))) return 'avif';
  const head = ascii(0, Math.min(256, b.length)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

/**
 * EXIF orientation (1–8) of a JPEG, or 1 when absent. Browsers apply it when
 * displaying, but a JPEG embedded in a PDF is drawn as stored, so rotated
 * photos must be re-encoded upright.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return 1; // end of image / start of scan
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 <= bytes.length && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      if (tiff + 8 > bytes.length) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (p: number) => view.getUint16(p, little);
      const u32 = (p: number) => view.getUint32(p, little);
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}
