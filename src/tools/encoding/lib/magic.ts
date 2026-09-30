/** File type detection from magic bytes (the first bytes of a file). */

export interface DetectedType {
  mime: string;
  ext: string;
  label: string;
  /** Guessed from text content only (plain text, JSON): a declared type is more specific. */
  weak?: boolean;
}

function startsWith(bytes: Uint8Array, sig: Array<number | null>, offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => b === null || bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = start; i < Math.min(bytes.length, start + length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

const T = (mime: string, ext: string, label: string): DetectedType => ({ mime, ext, label });

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length === 0) return null;
  const b = bytes;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return T('image/png', 'png', 'PNG image');
  if (startsWith(b, [0xff, 0xd8, 0xff])) return T('image/jpeg', 'jpg', 'JPEG image');
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return T('image/gif', 'gif', 'GIF image');
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return T('image/webp', 'webp', 'WebP image');
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return T('audio/wav', 'wav', 'WAV audio');
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'AVI ') return T('video/x-msvideo', 'avi', 'AVI video');
  if (ascii(b, 0, 2) === 'BM' && b.length > 14) return T('image/bmp', 'bmp', 'BMP image');
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00])) return T('image/x-icon', 'ico', 'Icon');
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return T('image/tiff', 'tif', 'TIFF image');
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return T('image/avif', 'avif', 'AVIF image');
    if (/^hei[cxs]|^heim|^heis|^mif1|^msf1/.test(brand)) return T('image/heic', 'heic', 'HEIC image');
    if (brand === 'qt  ') return T('video/quicktime', 'mov', 'QuickTime video');
    if (/^M4A/.test(brand)) return T('audio/mp4', 'm4a', 'M4A audio');
    if (/^3gp/.test(brand)) return T('video/3gpp', '3gp', '3GP video');
    return T('video/mp4', 'mp4', 'MP4 video');
  }
  if (ascii(b, 0, 4) === '8BPS') return T('image/vnd.adobe.photoshop', 'psd', 'Photoshop document');
  if (ascii(b, 0, 5) === '%PDF-') return T('application/pdf', 'pdf', 'PDF document');
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) {
    const head = ascii(b, 0, Math.min(b.length, 2000));
    if (head.includes('word/')) return T('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'Word document');
    if (head.includes('xl/')) return T('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 'Excel workbook');
    if (head.includes('ppt/')) return T('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', 'PowerPoint presentation');
    if (head.includes('mimetypeapplication/epub+zip')) return T('application/epub+zip', 'epub', 'EPUB book');
    if (head.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return T('application/vnd.oasis.opendocument.text', 'odt', 'OpenDocument text');
    return T('application/zip', 'zip', 'ZIP archive');
  }
  if (startsWith(b, [0x1f, 0x8b])) return T('application/gzip', 'gz', 'Gzip archive');
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return T('application/x-7z-compressed', '7z', '7-Zip archive');
  if (ascii(b, 0, 6) === 'Rar!\x1a\x07') return T('application/vnd.rar', 'rar', 'RAR archive');
  if (startsWith(b, [0x42, 0x5a, 0x68])) return T('application/x-bzip2', 'bz2', 'Bzip2 archive');
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return T('application/x-xz', 'xz', 'XZ archive');
  if (ascii(b, 257, 5) === 'ustar') return T('application/x-tar', 'tar', 'TAR archive');
  if (ascii(b, 0, 3) === 'ID3' || startsWith(b, [0xff, 0xfb]) || startsWith(b, [0xff, 0xf3]) || startsWith(b, [0xff, 0xf2])) {
    return T('audio/mpeg', 'mp3', 'MP3 audio');
  }
  if (ascii(b, 0, 4) === 'OggS') return T('audio/ogg', 'ogg', 'Ogg media');
  if (ascii(b, 0, 4) === 'fLaC') return T('audio/flac', 'flac', 'FLAC audio');
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = ascii(b, 0, 64);
    return head.includes('webm') ? T('video/webm', 'webm', 'WebM video') : T('video/x-matroska', 'mkv', 'Matroska video');
  }
  if (ascii(b, 0, 4) === 'wOFF') return T('font/woff', 'woff', 'WOFF font');
  if (ascii(b, 0, 4) === 'wOF2') return T('font/woff2', 'woff2', 'WOFF2 font');
  if (startsWith(b, [0x00, 0x01, 0x00, 0x00, 0x00])) return T('font/ttf', 'ttf', 'TrueType font');
  if (ascii(b, 0, 4) === 'OTTO') return T('font/otf', 'otf', 'OpenType font');
  if (startsWith(b, [0x00, 0x61, 0x73, 0x6d])) return T('application/wasm', 'wasm', 'WebAssembly module');
  if (ascii(b, 0, 16) === 'SQLite format 3\0') return T('application/vnd.sqlite3', 'sqlite', 'SQLite database');
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return T('application/x-elf', 'elf', 'ELF executable');
  if (ascii(b, 0, 2) === 'MZ') return T('application/vnd.microsoft.portable-executable', 'exe', 'Windows executable');
  if (startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) return T('application/java-vm', 'class', 'Java class file');
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return T('application/x-ole-storage', 'doc', 'Legacy Office document');
  if (ascii(b, 0, 5) === '{\\rtf') return T('application/rtf', 'rtf', 'Rich Text document');

  // Text-based formats.
  let start = 0;
  if (startsWith(b, [0xef, 0xbb, 0xbf])) start = 3;
  const head = ascii(b, start, 512).trimStart();
  const lower = head.toLowerCase();
  if (lower.startsWith('<svg') || (lower.startsWith('<?xml') && lower.includes('<svg'))) return T('image/svg+xml', 'svg', 'SVG image');
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return T('text/html', 'html', 'HTML document');
  if (lower.startsWith('<?xml')) return T('application/xml', 'xml', 'XML document');
  if (/^[{[]/.test(head) && looksLikeText(b)) return { ...T('application/json', 'json', 'JSON (probably)'), weak: true };
  if (looksLikeText(b)) return { ...T('text/plain', 'txt', 'Plain text'), weak: true };
  return null;
}

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-ms-bmp': 'image/bmp',
  'image/vnd.microsoft.icon': 'image/x-icon',
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'text/xml': 'application/xml',
  'application/x-zip-compressed': 'application/zip',
  'application/x-gzip': 'application/gzip',
  'application/font-woff': 'font/woff',
  'application/x-font-ttf': 'font/ttf',
  'application/x-javascript': 'text/javascript',
  'application/javascript': 'text/javascript',
};

/** Lower-cased MIME type without parameters, with common aliases mapped (image/jpg → image/jpeg). */
export function canonicalMime(mime: string): string {
  const base = mime.toLowerCase().split(';')[0].trim();
  return MIME_ALIASES[base] ?? base;
}

/** Heuristic: valid UTF-8 without NUL bytes or many control characters in the first 4 KB. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control++;
  }
  if (control / sample.length > 0.02) return false;
  try {
    // Allow a sequence cut at the sample boundary.
    new TextDecoder('utf-8', { fatal: true }).decode(sample.length === bytes.length ? sample : sample.subarray(0, sample.length - 3));
    return true;
  } catch {
    return false;
  }
}

/** Extension for a MIME type given in a data URL, when magic bytes are inconclusive. */
export function extensionForMime(mime: string): string {
  const m = canonicalMime(mime);
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'application/pdf': 'pdf', 'application/zip': 'zip',
    'application/json': 'json', 'text/plain': 'txt', 'text/html': 'html', 'text/css': 'css', 'text/csv': 'csv',
    'text/javascript': 'js', 'application/javascript': 'js', 'application/xml': 'xml', 'text/xml': 'xml',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm',
    'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/wasm': 'wasm',
    'text/markdown': 'md', 'text/tab-separated-values': 'tsv', 'text/yaml': 'yaml', 'application/yaml': 'yaml',
    'text/calendar': 'ics', 'text/vcard': 'vcf', 'application/rtf': 'rtf', 'image/tiff': 'tif', 'image/heic': 'heic',
    'audio/flac': 'flac', 'audio/mp4': 'm4a', 'video/quicktime': 'mov', 'application/gzip': 'gz', 'application/x-tar': 'tar',
  };
  return map[m] ?? 'bin';
}
