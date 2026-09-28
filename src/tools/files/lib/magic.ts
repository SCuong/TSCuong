/**
 * File type detection from magic bytes (the file's real contents), independent
 * of the name and of the MIME type the browser guesses from the extension.
 * Pure: works on the first bytes of a file (and optionally the last 512+).
 */

export type FileCategory = 'image' | 'audio' | 'video' | 'archive' | 'document' | 'font' | 'executable' | 'data' | 'text' | 'other';

export interface FileType {
  id: string;
  name: string;
  mime: string;
  /** Usual extensions, lower case, without the dot. '' means "no extension is normal". */
  exts: string[];
  category: FileCategory;
  /** Text formats: any extension that no binary format claims is accepted. */
  text?: boolean;
  /** Generic results (binary, empty, …) never cause an extension mismatch. */
  anyExt?: boolean;
}

type Def = Omit<FileType, 'id'>;

const DEFS = {
  // Images
  png: {
    name: 'PNG image',
    mime: 'image/png',
    exts: ['png'],
    category: 'image',
  },
  apng: {
    name: 'Animated PNG',
    mime: 'image/apng',
    exts: ['png', 'apng'],
    category: 'image',
  },
  jpeg: {
    name: 'JPEG image',
    mime: 'image/jpeg',
    exts: ['jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'pjp'],
    category: 'image',
  },
  gif: {
    name: 'GIF image',
    mime: 'image/gif',
    exts: ['gif'],
    category: 'image',
  },
  bmp: {
    name: 'BMP image',
    mime: 'image/bmp',
    exts: ['bmp', 'dib'],
    category: 'image',
  },
  ico: {
    name: 'Windows icon',
    mime: 'image/vnd.microsoft.icon',
    exts: ['ico'],
    category: 'image',
  },
  cur: {
    name: 'Windows cursor',
    mime: 'image/x-win-bitmap',
    exts: ['cur'],
    category: 'image',
  },
  tiff: {
    name: 'TIFF image',
    mime: 'image/tiff',
    exts: ['tif', 'tiff', 'dng', 'cr2', 'nef', 'arw', 'orf', 'rw2', 'pef', 'srw'],
    category: 'image',
  },
  psd: {
    name: 'Photoshop document',
    mime: 'image/vnd.adobe.photoshop',
    exts: ['psd', 'psb'],
    category: 'image',
  },
  webp: {
    name: 'WebP image',
    mime: 'image/webp',
    exts: ['webp'],
    category: 'image',
  },
  heic: {
    name: 'HEIC/HEIF image',
    mime: 'image/heic',
    exts: ['heic', 'heif', 'hif'],
    category: 'image',
  },
  avif: {
    name: 'AVIF image',
    mime: 'image/avif',
    exts: ['avif'],
    category: 'image',
  },
  jxl: {
    name: 'JPEG XL image',
    mime: 'image/jxl',
    exts: ['jxl'],
    category: 'image',
  },
  jp2: {
    name: 'JPEG 2000 image',
    mime: 'image/jp2',
    exts: ['jp2', 'j2k', 'jpf', 'jpx', 'jpm'],
    category: 'image',
  },
  dds: {
    name: 'DirectDraw Surface texture',
    mime: 'image/vnd.ms-dds',
    exts: ['dds'],
    category: 'image',
  },
  exr: {
    name: 'OpenEXR image',
    mime: 'image/x-exr',
    exts: ['exr'],
    category: 'image',
  },
  qoi: {
    name: 'QOI image',
    mime: 'image/qoi',
    exts: ['qoi'],
    category: 'image',
  },
  svg: {
    name: 'SVG image',
    mime: 'image/svg+xml',
    exts: ['svg'],
    category: 'image',
    text: true,
  },
  // Audio
  wav: {
    name: 'WAV audio',
    mime: 'audio/wav',
    exts: ['wav', 'wave'],
    category: 'audio',
  },
  mp3: {
    name: 'MP3 audio',
    mime: 'audio/mpeg',
    exts: ['mp3', 'mp2', 'mpga'],
    category: 'audio',
  },
  aac: {
    name: 'AAC audio (ADTS)',
    mime: 'audio/aac',
    exts: ['aac', 'adts'],
    category: 'audio',
  },
  flac: {
    name: 'FLAC audio',
    mime: 'audio/flac',
    exts: ['flac'],
    category: 'audio',
  },
  ogg: {
    name: 'Ogg Vorbis audio',
    mime: 'audio/ogg',
    exts: ['ogg', 'oga'],
    category: 'audio',
  },
  opus: {
    name: 'Opus audio (Ogg)',
    mime: 'audio/ogg; codecs=opus',
    exts: ['opus', 'ogg', 'oga'],
    category: 'audio',
  },
  ogv: {
    name: 'Ogg Theora video',
    mime: 'video/ogg',
    exts: ['ogv', 'ogg'],
    category: 'video',
  },
  m4a: {
    name: 'MPEG-4 audio',
    mime: 'audio/mp4',
    exts: ['m4a', 'm4b', 'm4p', 'm4r'],
    category: 'audio',
  },
  midi: {
    name: 'MIDI',
    mime: 'audio/midi',
    exts: ['mid', 'midi', 'kar', 'rmi'],
    category: 'audio',
  },
  aiff: {
    name: 'AIFF audio',
    mime: 'audio/aiff',
    exts: ['aif', 'aiff', 'aifc'],
    category: 'audio',
  },
  amr: {
    name: 'AMR audio',
    mime: 'audio/amr',
    exts: ['amr'],
    category: 'audio',
  },
  // Video
  avi: {
    name: 'AVI video',
    mime: 'video/x-msvideo',
    exts: ['avi'],
    category: 'video',
  },
  mp4: {
    name: 'MPEG-4 video',
    mime: 'video/mp4',
    exts: ['mp4', 'm4v', 'f4v', 'm4s', 'mp4v'],
    category: 'video',
  },
  mov: {
    name: 'QuickTime video',
    mime: 'video/quicktime',
    exts: ['mov', 'qt'],
    category: 'video',
  },
  '3gp': {
    name: '3GPP media',
    mime: 'video/3gpp',
    exts: ['3gp', '3g2', '3gpp'],
    category: 'video',
  },
  webm: {
    name: 'WebM video',
    mime: 'video/webm',
    exts: ['webm'],
    category: 'video',
  },
  mkv: {
    name: 'Matroska media',
    mime: 'video/x-matroska',
    exts: ['mkv', 'mka', 'mks', 'mk3d'],
    category: 'video',
  },
  flv: {
    name: 'Flash video',
    mime: 'video/x-flv',
    exts: ['flv'],
    category: 'video',
  },
  asf: {
    name: 'Windows Media (ASF)',
    mime: 'video/x-ms-asf',
    exts: ['wmv', 'wma', 'asf'],
    category: 'video',
  },
  mpeg: {
    name: 'MPEG program stream',
    mime: 'video/mpeg',
    exts: ['mpg', 'mpeg', 'vob', 'm2p', 'mpe'],
    category: 'video',
  },
  // Archives and containers
  zip: {
    name: 'ZIP archive',
    mime: 'application/zip',
    exts: ['zip', 'zipx', 'cbz', 'xpi', 'ipa', 'nupkg', 'vsix', 'whl', 'kmz', 'crx', 'appx', 'msix', 'sketch'],
    category: 'archive',
  },
  docx: {
    name: 'Word document (DOCX)',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    exts: ['docx', 'docm', 'dotx', 'dotm'],
    category: 'document',
  },
  xlsx: {
    name: 'Excel workbook (XLSX)',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    exts: ['xlsx', 'xlsm', 'xltx', 'xltm'],
    category: 'document',
  },
  pptx: {
    name: 'PowerPoint presentation (PPTX)',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    exts: ['pptx', 'pptm', 'potx', 'ppsx', 'ppsm'],
    category: 'document',
  },
  epub: {
    name: 'EPUB e-book',
    mime: 'application/epub+zip',
    exts: ['epub'],
    category: 'document',
  },
  odt: {
    name: 'OpenDocument text',
    mime: 'application/vnd.oasis.opendocument.text',
    exts: ['odt', 'ott'],
    category: 'document',
  },
  ods: {
    name: 'OpenDocument spreadsheet',
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    exts: ['ods', 'ots'],
    category: 'document',
  },
  odp: {
    name: 'OpenDocument presentation',
    mime: 'application/vnd.oasis.opendocument.presentation',
    exts: ['odp', 'otp'],
    category: 'document',
  },
  jar: {
    name: 'Java archive (JAR)',
    mime: 'application/java-archive',
    exts: ['jar', 'war', 'ear'],
    category: 'archive',
  },
  apk: {
    name: 'Android package (APK)',
    mime: 'application/vnd.android.package-archive',
    exts: ['apk', 'aab', 'xapk'],
    category: 'archive',
  },
  gzip: {
    name: 'Gzip compressed data',
    mime: 'application/gzip',
    exts: ['gz', 'tgz', 'gzip', 'svgz'],
    category: 'archive',
  },
  bzip2: {
    name: 'Bzip2 compressed data',
    mime: 'application/x-bzip2',
    exts: ['bz2', 'tbz', 'tbz2', 'bz'],
    category: 'archive',
  },
  xz: {
    name: 'XZ compressed data',
    mime: 'application/x-xz',
    exts: ['xz', 'txz'],
    category: 'archive',
  },
  '7z': {
    name: '7-Zip archive',
    mime: 'application/x-7z-compressed',
    exts: ['7z'],
    category: 'archive',
  },
  rar4: {
    name: 'RAR archive (v1.5–4)',
    mime: 'application/vnd.rar',
    exts: ['rar', 'cbr'],
    category: 'archive',
  },
  rar5: {
    name: 'RAR archive (v5)',
    mime: 'application/vnd.rar',
    exts: ['rar', 'cbr'],
    category: 'archive',
  },
  zstd: {
    name: 'Zstandard compressed data',
    mime: 'application/zstd',
    exts: ['zst', 'tzst', 'zstd'],
    category: 'archive',
  },
  lz4: {
    name: 'LZ4 compressed data',
    mime: 'application/x-lz4',
    exts: ['lz4'],
    category: 'archive',
  },
  cab: {
    name: 'Windows cabinet',
    mime: 'application/vnd.ms-cab-compressed',
    exts: ['cab'],
    category: 'archive',
  },
  deb: {
    name: 'Debian package',
    mime: 'application/vnd.debian.binary-package',
    exts: ['deb', 'udeb'],
    category: 'archive',
  },
  ar: {
    name: 'Unix ar archive',
    mime: 'application/x-archive',
    exts: ['a', 'ar', 'lib'],
    category: 'archive',
  },
  rpm: {
    name: 'RPM package',
    mime: 'application/x-rpm',
    exts: ['rpm'],
    category: 'archive',
  },
  tar: {
    name: 'TAR archive',
    mime: 'application/x-tar',
    exts: ['tar'],
    category: 'archive',
  },
  iso: {
    name: 'ISO 9660 disc image',
    mime: 'application/x-iso9660-image',
    exts: ['iso', 'img'],
    category: 'archive',
  },
  dmg: {
    name: 'Apple disk image (DMG)',
    mime: 'application/x-apple-diskimage',
    exts: ['dmg'],
    category: 'archive',
  },
  riff: {
    name: 'RIFF container',
    mime: 'application/octet-stream',
    exts: [],
    category: 'other',
    anyExt: true,
  },
  // Fonts
  woff: {
    name: 'WOFF font',
    mime: 'font/woff',
    exts: ['woff'],
    category: 'font',
  },
  woff2: {
    name: 'WOFF2 font',
    mime: 'font/woff2',
    exts: ['woff2'],
    category: 'font',
  },
  otf: {
    name: 'OpenType font (CFF)',
    mime: 'font/otf',
    exts: ['otf'],
    category: 'font',
  },
  ttf: {
    name: 'TrueType font',
    mime: 'font/ttf',
    exts: ['ttf', 'otf', 'tte', 'dfont'],
    category: 'font',
  },
  ttc: {
    name: 'TrueType font collection',
    mime: 'font/collection',
    exts: ['ttc', 'otc'],
    category: 'font',
  },
  // Executables and code
  exe: {
    name: 'Windows executable (PE)',
    mime: 'application/vnd.microsoft.portable-executable',
    exts: ['exe', 'dll', 'sys', 'scr', 'ocx', 'cpl', 'efi', 'mui', 'drv', 'node', 'pyd'],
    category: 'executable',
  },
  msdos: {
    name: 'MS-DOS executable',
    mime: 'application/x-msdownload',
    exts: ['exe', 'com'],
    category: 'executable',
  },
  elf: {
    name: 'ELF executable/library',
    mime: 'application/x-elf',
    exts: ['', 'so', 'o', 'elf', 'bin', 'axf', 'ko', 'out', 'node'],
    category: 'executable',
  },
  macho: {
    name: 'Mach-O binary',
    mime: 'application/x-mach-binary',
    exts: ['', 'dylib', 'o', 'bundle', 'so', 'node'],
    category: 'executable',
  },
  class: {
    name: 'Java class file',
    mime: 'application/java-vm',
    exts: ['class'],
    category: 'executable',
  },
  wasm: {
    name: 'WebAssembly module',
    mime: 'application/wasm',
    exts: ['wasm'],
    category: 'executable',
  },
  dex: {
    name: 'Android Dalvik bytecode',
    mime: 'application/vnd.android.dex',
    exts: ['dex'],
    category: 'executable',
  },
  lnk: {
    name: 'Windows shortcut',
    mime: 'application/x-ms-shortcut',
    exts: ['lnk'],
    category: 'other',
  },
  // Documents and data
  pdf: {
    name: 'PDF document',
    mime: 'application/pdf',
    exts: ['pdf', 'ai'],
    category: 'document',
  },
  ole: {
    name: 'Microsoft OLE2 file (legacy Office, MSI)',
    mime: 'application/x-ole-storage',
    exts: ['doc', 'xls', 'ppt', 'msi', 'msg', 'pub', 'vsd', 'dot', 'xlt', 'pps', 'db', 'mpp'],
    category: 'document',
  },
  rtf: {
    name: 'Rich Text Format',
    mime: 'application/rtf',
    exts: ['rtf'],
    category: 'document',
    text: true,
  },
  ps: {
    name: 'PostScript',
    mime: 'application/postscript',
    exts: ['ps', 'eps', 'ai'],
    category: 'document',
    text: true,
  },
  sqlite: {
    name: 'SQLite database',
    mime: 'application/vnd.sqlite3',
    exts: ['sqlite', 'sqlite3', 'db', 'db3', 's3db', 'sl3'],
    category: 'data',
  },
  pcap: {
    name: 'Packet capture (pcap)',
    mime: 'application/vnd.tcpdump.pcap',
    exts: ['pcap', 'cap', 'dmp'],
    category: 'data',
  },
  pcapng: {
    name: 'Packet capture (pcapng)',
    mime: 'application/x-pcapng',
    exts: ['pcapng', 'ntar'],
    category: 'data',
  },
  parquet: {
    name: 'Apache Parquet',
    mime: 'application/vnd.apache.parquet',
    exts: ['parquet'],
    category: 'data',
  },
  // Text
  json: {
    name: 'JSON',
    mime: 'application/json',
    exts: ['json', 'geojson', 'jsonc', 'map', 'webmanifest', 'har'],
    category: 'text',
    text: true,
  },
  xml: {
    name: 'XML document',
    mime: 'application/xml',
    exts: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'kml', 'gpx', 'config'],
    category: 'text',
    text: true,
  },
  html: {
    name: 'HTML document',
    mime: 'text/html',
    exts: ['html', 'htm', 'xhtml'],
    category: 'text',
    text: true,
  },
  pem: {
    name: 'PEM (certificate or key)',
    mime: 'application/x-pem-file',
    exts: ['pem', 'crt', 'cer', 'key', 'csr', 'pub'],
    category: 'text',
    text: true,
  },
  script: {
    name: 'Script (shebang)',
    mime: 'text/x-script',
    exts: ['', 'sh', 'bash', 'zsh', 'py', 'pl', 'rb', 'js', 'mjs', 'php'],
    category: 'text',
    text: true,
  },
  ics: {
    name: 'iCalendar',
    mime: 'text/calendar',
    exts: ['ics', 'ical', 'ifb'],
    category: 'text',
    text: true,
  },
  vcf: {
    name: 'vCard',
    mime: 'text/vcard',
    exts: ['vcf', 'vcard'],
    category: 'text',
    text: true,
  },
  text: {
    name: 'Plain text',
    mime: 'text/plain',
    exts: ['txt'],
    category: 'text',
    text: true,
    anyExt: true,
  },
  utf8bom: {
    name: 'Text (UTF-8 with BOM)',
    mime: 'text/plain; charset=utf-8',
    exts: ['txt'],
    category: 'text',
    text: true,
    anyExt: true,
  },
  utf16: {
    name: 'Text (UTF-16)',
    mime: 'text/plain; charset=utf-16',
    exts: ['txt'],
    category: 'text',
    text: true,
    anyExt: true,
  },
  // Fallbacks
  binary: {
    name: 'Unknown binary data',
    mime: 'application/octet-stream',
    exts: [],
    category: 'other',
    anyExt: true,
  },
  empty: {
    name: 'Empty file',
    mime: 'application/x-empty',
    exts: [],
    category: 'other',
    anyExt: true,
  },
} satisfies Record<string, Def>;

export type FileTypeId = keyof typeof DEFS;

export const TYPES = Object.fromEntries(Object.entries(DEFS).map(([id, d]) => [id, { id, ...d } as FileType])) as Record<
  FileTypeId,
  FileType
>;

/** Number of distinct formats the detector knows. */
export const SIGNATURE_COUNT = Object.keys(TYPES).length;

/** Extensions claimed by binary formats: a text file with one of these is a mismatch. */
const BINARY_EXTS = new Set(Object.values(TYPES).flatMap((t) => (t.text || t.anyExt ? [] : t.exts.filter(Boolean))));

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

/** Do `bytes` at `offset` equal `pattern` (null = any byte)? Out of range never matches. */
export function matchAt(bytes: Uint8Array, offset: number, pattern: ReadonlyArray<number | null>): boolean {
  if (offset < 0 || offset + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p !== null && bytes[offset + i] !== p) return false;
  }
  return true;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (bytes: Uint8Array, offset: number, s: string) => matchAt(bytes, offset, ascii(s));
const str = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function indexOf(bytes: Uint8Array, needle: string, from = 0, limit = bytes.length): number {
  const n = ascii(needle);
  const end = Math.min(limit, bytes.length) - n.length;
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Container sub-detection
// ---------------------------------------------------------------------------

function detectFtyp(head: Uint8Array): FileType {
  const boxSize = u32be(head, 0);
  const major = str(head, 8, 12);
  const brands = new Set([major]);
  const end = Math.min(head.length, boxSize >= 16 ? boxSize : 64);
  for (let o = 16; o + 4 <= end; o += 4) brands.add(str(head, o, o + 4));
  if (major === 'qt  ') return TYPES.mov;
  if (/^M4[ABP] $/.test(major)) return TYPES.m4a;
  if (major === 'avif' || major === 'avis') return TYPES.avif;
  if (/^he[iv][cxmsx]$/.test(major)) return TYPES.heic;
  if (major === 'mif1' || major === 'msf1') return brands.has('avif') || brands.has('avis') ? TYPES.avif : TYPES.heic;
  if (major.startsWith('3g')) return TYPES['3gp'];
  if (brands.has('qt  ') && !brands.has('isom')) return TYPES.mov;
  return TYPES.mp4;
}

/** Names of the local file entries visible in the head of a ZIP archive. */
function zipEntries(head: Uint8Array): Array<{ name: string; offset: number }> {
  const out: Array<{ name: string; offset: number }> = [];
  for (let o = 0; o + 30 <= head.length && out.length < 200; o++) {
    if (head[o] !== 0x50 || head[o + 1] !== 0x4b || head[o + 2] !== 3 || head[o + 3] !== 4) continue;
    const nameLen = u16le(head, o + 26);
    if (!nameLen || o + 30 + nameLen > head.length) continue;
    const name = str(head, o + 30, o + 30 + nameLen);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(name)) continue;
    out.push({ name, offset: o });
    o += 29 + nameLen;
  }
  return out;
}

const ODF: Record<string, FileTypeId> = {
  'application/epub+zip': 'epub',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
};

function detectZip(head: Uint8Array): FileType {
  const entries = zipEntries(head);
  const first = entries[0];
  if (first?.name === 'mimetype') {
    const o = first.offset;
    const start = o + 30 + u16le(head, o + 26) + u16le(head, o + 28);
    const len = Math.min(u32le(head, o + 18), 100);
    const mime = str(head, start, start + len).trim();
    if (ODF[mime]) return TYPES[ODF[mime]];
  }
  const names = entries.map((e) => e.name);
  if (names.some((n) => n === 'AndroidManifest.xml' || n === 'classes.dex')) return TYPES.apk;
  if (names.some((n) => n.startsWith('word/'))) return TYPES.docx;
  if (names.some((n) => n.startsWith('xl/'))) return TYPES.xlsx;
  if (names.some((n) => n.startsWith('ppt/'))) return TYPES.pptx;
  if (names.some((n) => n === 'META-INF/MANIFEST.MF' || n.endsWith('.class'))) return TYPES.jar;
  return TYPES.zip;
}

function detectRiff(head: Uint8Array): FileType {
  const form = str(head, 8, 12);
  if (form === 'WEBP') return TYPES.webp;
  if (form === 'WAVE') return TYPES.wav;
  if (form === 'AVI ') return TYPES.avi;
  const shown = form.replace(/[^\x20-\x7e]/g, '?').trim() || '?';
  return { ...TYPES.riff, name: `RIFF container (${shown})` };
}

// ---------------------------------------------------------------------------
// Binary signatures, in priority order
// ---------------------------------------------------------------------------

function detectBinary(h: Uint8Array, tail?: Uint8Array): FileType | null {
  const b0 = h[0];
  // Images
  if (matchAt(h, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const actl = indexOf(h, 'acTL', 8);
    const idat = indexOf(h, 'IDAT', 8);
    return actl >= 0 && (idat < 0 || actl < idat) ? TYPES.apng : TYPES.png;
  }
  if (matchAt(h, 0, [0xff, 0xd8, 0xff])) return TYPES.jpeg;
  if (has(h, 0, 'GIF87a') || has(h, 0, 'GIF89a')) return TYPES.gif;
  if (has(h, 0, 'BM') && h.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(u32le(h, 14))) return TYPES.bmp;
  if (matchAt(h, 0, [0, 0, 1, 0]) && h.length >= 6 && u16le(h, 4) > 0) return TYPES.ico;
  if (matchAt(h, 0, [0, 0, 2, 0]) && h.length >= 6 && u16le(h, 4) > 0) return TYPES.cur;
  if (matchAt(h, 0, [0x49, 0x49, 0x2a, 0]) || matchAt(h, 0, [0x4d, 0x4d, 0, 0x2a])) return TYPES.tiff;
  if (has(h, 0, '8BPS')) return TYPES.psd;
  if (matchAt(h, 0, [0xff, 0x0a]) || matchAt(h, 0, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return TYPES.jxl;
  if (matchAt(h, 0, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]) || matchAt(h, 0, [0xff, 0x4f, 0xff, 0x51]))
    return TYPES.jp2;
  if (has(h, 0, 'DDS ')) return TYPES.dds;
  if (matchAt(h, 0, [0x76, 0x2f, 0x31, 0x01])) return TYPES.exr;
  if (has(h, 0, 'qoif')) return TYPES.qoi;
  // Containers
  if (has(h, 0, 'RIFF') && h.length >= 12) return detectRiff(h);
  if (has(h, 4, 'ftyp')) return detectFtyp(h);
  if (has(h, 0, 'FORM') && (has(h, 8, 'AIFF') || has(h, 8, 'AIFC'))) return TYPES.aiff;
  if (matchAt(h, 0, [0x50, 0x4b, 3, 4]) || matchAt(h, 0, [0x50, 0x4b, 5, 6]) || matchAt(h, 0, [0x50, 0x4b, 7, 8])) return detectZip(h);
  // Text encodings with a byte order mark are handled by the caller; check before MPEG sync (FF FE).
  if (matchAt(h, 0, [0xff, 0xfe]) || matchAt(h, 0, [0xfe, 0xff])) return TYPES.utf16;
  // Compression and archives
  if (matchAt(h, 0, [0x1f, 0x8b, 0x08])) return TYPES.gzip;
  if (has(h, 0, 'BZh') && h[3] >= 0x31 && h[3] <= 0x39) return TYPES.bzip2;
  if (matchAt(h, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return TYPES.xz;
  if (matchAt(h, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return TYPES['7z'];
  if (matchAt(h, 0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])) return TYPES.rar5;
  if (matchAt(h, 0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])) return TYPES.rar4;
  if (matchAt(h, 0, [0x28, 0xb5, 0x2f, 0xfd])) return TYPES.zstd;
  if (matchAt(h, 0, [0x04, 0x22, 0x4d, 0x18])) return TYPES.lz4;
  if (has(h, 0, 'MSCF')) return TYPES.cab;
  if (has(h, 0, '!<arch>\n')) return has(h, 8, 'debian-binary') ? TYPES.deb : TYPES.ar;
  if (matchAt(h, 0, [0xed, 0xab, 0xee, 0xdb])) return TYPES.rpm;
  if (has(h, 257, 'ustar')) return TYPES.tar;
  if (has(h, 0x8001, 'CD001') || has(h, 0x8801, 'CD001') || has(h, 0x9001, 'CD001')) return TYPES.iso;
  if (tail && tail.length >= 512 && has(tail, tail.length - 512, 'koly')) return TYPES.dmg;
  // Documents and data
  if (has(h, 0, '%PDF-')) return TYPES.pdf;
  if (matchAt(h, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return TYPES.ole;
  if (has(h, 0, 'SQLite format 3\0')) return TYPES.sqlite;
  if (
    matchAt(h, 0, [0xd4, 0xc3, 0xb2, 0xa1]) ||
    matchAt(h, 0, [0xa1, 0xb2, 0xc3, 0xd4]) ||
    matchAt(h, 0, [0x4d, 0x3c, 0xb2, 0xa1]) ||
    matchAt(h, 0, [0xa1, 0xb2, 0x3c, 0x4d])
  )
    return TYPES.pcap;
  if (matchAt(h, 0, [0x0a, 0x0d, 0x0d, 0x0a])) return TYPES.pcapng;
  if (has(h, 0, 'PAR1')) return TYPES.parquet;
  // Audio and video
  if (has(h, 0, 'ID3')) return TYPES.mp3;
  if (has(h, 0, 'fLaC')) return TYPES.flac;
  if (has(h, 0, 'OggS')) {
    if (has(h, 28, 'OpusHead')) return TYPES.opus;
    if (matchAt(h, 28, [0x80, ...ascii('theora')])) return TYPES.ogv;
    return TYPES.ogg;
  }
  if (has(h, 0, 'MThd')) return TYPES.midi;
  if (has(h, 0, '#!AMR')) return TYPES.amr;
  if (matchAt(h, 0, [0x1a, 0x45, 0xdf, 0xa3])) return indexOf(h, 'webm', 4, 4096) >= 0 ? TYPES.webm : TYPES.mkv;
  if (has(h, 0, 'FLV') && h[3] === 1) return TYPES.flv;
  if (matchAt(h, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return TYPES.asf;
  if (matchAt(h, 0, [0, 0, 1, 0xba]) || matchAt(h, 0, [0, 0, 1, 0xb3])) return TYPES.mpeg;
  // Fonts
  if (has(h, 0, 'wOFF')) return TYPES.woff;
  if (has(h, 0, 'wOF2')) return TYPES.woff2;
  if (has(h, 0, 'OTTO')) return TYPES.otf;
  if (has(h, 0, 'ttcf')) return TYPES.ttc;
  if (matchAt(h, 0, [0, 1, 0, 0, 0]) || (has(h, 0, 'true') && h[4] === 0 && h[5] > 0)) return TYPES.ttf;
  // Executables
  if (has(h, 0, 'MZ')) {
    const pe = h.length >= 64 ? u32le(h, 60) : 0;
    return pe >= 64 && has(h, pe, 'PE\0\0') ? TYPES.exe : TYPES.msdos;
  }
  if (matchAt(h, 0, [0x7f, 0x45, 0x4c, 0x46])) return TYPES.elf;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(u32be(h, 0)) && h.length >= 4) return TYPES.macho;
  if (matchAt(h, 0, [0xca, 0xfe, 0xba, 0xbe]) && h.length >= 8) return u32be(h, 4) < 40 ? TYPES.macho : TYPES.class;
  if (matchAt(h, 0, [0x00, 0x61, 0x73, 0x6d])) return TYPES.wasm;
  if (has(h, 0, 'dex\n')) return TYPES.dex;
  if (matchAt(h, 0, [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0x00])) return TYPES.lnk;
  // MPEG audio frame sync (after everything else starting with 0xFF).
  if (b0 === 0xff && h.length >= 2 && (h[1] & 0xe0) === 0xe0) {
    const layer = (h[1] >> 1) & 3;
    const version = (h[1] >> 3) & 3;
    if (layer === 0 && (h[1] & 0xf6) === 0xf0) return TYPES.aac;
    if (layer !== 0 && version !== 1) return TYPES.mp3;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text detection
// ---------------------------------------------------------------------------

/** Decode as UTF-8, tolerating a multi-byte sequence cut off at the end of a truncated head. */
function decodeUtf8(bytes: Uint8Array, truncated: boolean): string | null {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let cut = 0; cut <= (truncated ? 3 : 0) && cut < bytes.length; cut++) {
    try {
      return decoder.decode(bytes.subarray(0, bytes.length - cut));
    } catch {
      // try a shorter slice
    }
  }
  return null;
}

/** True when bytes look like text in a single-byte or UTF-8 encoding (no NULs, very few control characters). */
function looksTextual(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  let controls = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) return false;
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 11 && c !== 27) controls++;
    else if (c === 0x7f) controls++;
  }
  return controls / bytes.length < 0.01;
}

function classifyText(text: string, complete: boolean): FileType {
  const t = text.trimStart();
  const lower = t.slice(0, 1024).toLowerCase();
  if (t.startsWith('#!')) return TYPES.script;
  if (lower.startsWith('<?xml')) return /<svg[\s>]/.test(lower) ? TYPES.svg : /<html[\s>]/.test(lower) ? TYPES.html : TYPES.xml;
  if (lower.startsWith('<svg')) return TYPES.svg;
  if (lower.startsWith('<!doctype html') || /^<html[\s>]/.test(lower) || (lower.startsWith('<') && /<(head|body)[\s>]/.test(lower)))
    return TYPES.html;
  if (t.startsWith('-----BEGIN ')) return TYPES.pem;
  if (t.startsWith('{\\rtf')) return TYPES.rtf;
  if (t.startsWith('%!PS')) return TYPES.ps;
  if (/^BEGIN:VCALENDAR/i.test(t)) return TYPES.ics;
  if (/^BEGIN:VCARD/i.test(t)) return TYPES.vcf;
  if (t.startsWith('{') || t.startsWith('[')) {
    if (complete) {
      try {
        JSON.parse(t);
        return TYPES.json;
      } catch {
        return TYPES.text;
      }
    }
    if (/^\{\s*("|\})/.test(t) || /^\[\s*([[{"\]\d-]|true|false|null)/.test(t)) return TYPES.json;
  }
  return TYPES.text;
}

export interface DetectInput {
  /** The first bytes of the file (64 KB is plenty). */
  head: Uint8Array;
  /** The last bytes of the file (at least 512 for DMG detection), when the head doesn't cover the whole file. */
  tail?: Uint8Array;
  /** Total file size, when known. */
  size?: number;
}

/** Identify a file from its leading (and optionally trailing) bytes. */
export function detectFileType({ head, tail, size }: DetectInput): FileType {
  if (size === 0 || head.length === 0) return TYPES.empty;
  // Text-like signatures that must win before generic binary checks.
  if (has(head, 0, '{\\rtf')) return TYPES.rtf;
  const binary = detectBinary(head, tail);
  if (binary) return binary;
  const complete = size === undefined || size <= head.length;
  if (matchAt(head, 0, [0xef, 0xbb, 0xbf])) {
    const text = decodeUtf8(head.subarray(3), !complete);
    const kind = text !== null ? classifyText(text, complete) : TYPES.utf8bom;
    return kind.id === 'text' ? TYPES.utf8bom : kind;
  }
  const utf8 = decodeUtf8(head, !complete);
  if (utf8 !== null && looksTextual(head)) return classifyText(utf8, complete);
  if (utf8 === null && looksTextual(head)) {
    // Legacy 8-bit text (e.g. Windows-1252): still text, but mostly ASCII.
    let high = 0;
    for (let i = 0; i < head.length; i++) if (head[i] >= 0x80) high++;
    if (high / head.length < 0.3) return classifyText(new TextDecoder('windows-1252').decode(head), complete);
  }
  return TYPES.binary;
}

// ---------------------------------------------------------------------------
// Names and previews
// ---------------------------------------------------------------------------

/** Lower-case extension without the dot; '' for none or dotfiles like ".bashrc". */
export function extensionOf(filename: string): string {
  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Does the file name's extension fit the detected type? */
export function extensionMatches(type: FileType, filename: string): boolean {
  const ext = extensionOf(filename);
  if (type.exts.includes(ext)) return true;
  if (type.anyExt) return !(type.text && BINARY_EXTS.has(ext));
  if (type.text) return !BINARY_EXTS.has(ext);
  return false;
}

/** "89 50 4E 47" for the first `count` bytes. */
export function hexPreview(bytes: Uint8Array, count = 16): string {
  return Array.from(bytes.subarray(0, count), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** Printable ASCII for the first `count` bytes, with "." for everything else. */
export function asciiPreview(bytes: Uint8Array, count = 32): string {
  return Array.from(bytes.subarray(0, count), (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}
