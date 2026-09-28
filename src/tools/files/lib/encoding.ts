/** Text encoding detection, decoding, re-encoding and line-ending conversion. Pure. */

export interface EncodingOption {
  label: string;
  name: string;
  group: string;
}

/** WHATWG TextDecoder labels offered for decoding, grouped for the picker. */
export const DECODE_ENCODINGS: EncodingOption[] = [
  { label: 'utf-8', name: 'UTF-8', group: 'Unicode' },
  { label: 'utf-16le', name: 'UTF-16 LE', group: 'Unicode' },
  { label: 'utf-16be', name: 'UTF-16 BE', group: 'Unicode' },
  {
    label: 'windows-1252',
    name: 'Western (Windows-1252 / ISO-8859-1)',
    group: 'Western',
  },
  {
    label: 'iso-8859-15',
    name: 'Western (ISO-8859-15, with €)',
    group: 'Western',
  },
  { label: 'macintosh', name: 'Western (Mac Roman)', group: 'Western' },
  { label: 'ibm866', name: 'DOS Cyrillic (IBM 866)', group: 'Cyrillic' },
  { label: 'windows-1251', name: 'Cyrillic (Windows-1251)', group: 'Cyrillic' },
  { label: 'koi8-r', name: 'Cyrillic (KOI8-R)', group: 'Cyrillic' },
  { label: 'koi8-u', name: 'Ukrainian (KOI8-U)', group: 'Cyrillic' },
  { label: 'iso-8859-5', name: 'Cyrillic (ISO-8859-5)', group: 'Cyrillic' },
  {
    label: 'windows-1250',
    name: 'Central European (Windows-1250)',
    group: 'European',
  },
  {
    label: 'iso-8859-2',
    name: 'Central European (ISO-8859-2)',
    group: 'European',
  },
  { label: 'iso-8859-4', name: 'Baltic (ISO-8859-4)', group: 'European' },
  { label: 'windows-1257', name: 'Baltic (Windows-1257)', group: 'European' },
  {
    label: 'iso-8859-3',
    name: 'South European (ISO-8859-3)',
    group: 'European',
  },
  { label: 'iso-8859-10', name: 'Nordic (ISO-8859-10)', group: 'European' },
  {
    label: 'iso-8859-16',
    name: 'South-Eastern European (ISO-8859-16)',
    group: 'European',
  },
  {
    label: 'windows-1253',
    name: 'Greek (Windows-1253)',
    group: 'Greek & Turkish',
  },
  { label: 'iso-8859-7', name: 'Greek (ISO-8859-7)', group: 'Greek & Turkish' },
  {
    label: 'windows-1254',
    name: 'Turkish (Windows-1254)',
    group: 'Greek & Turkish',
  },
  {
    label: 'windows-1255',
    name: 'Hebrew (Windows-1255)',
    group: 'Middle Eastern',
  },
  { label: 'iso-8859-8', name: 'Hebrew (ISO-8859-8)', group: 'Middle Eastern' },
  {
    label: 'windows-1256',
    name: 'Arabic (Windows-1256)',
    group: 'Middle Eastern',
  },
  { label: 'iso-8859-6', name: 'Arabic (ISO-8859-6)', group: 'Middle Eastern' },
  { label: 'windows-874', name: 'Thai (Windows-874)', group: 'Asian' },
  { label: 'windows-1258', name: 'Vietnamese (Windows-1258)', group: 'Asian' },
  { label: 'shift_jis', name: 'Japanese (Shift_JIS)', group: 'Asian' },
  { label: 'euc-jp', name: 'Japanese (EUC-JP)', group: 'Asian' },
  { label: 'iso-2022-jp', name: 'Japanese (ISO-2022-JP)', group: 'Asian' },
  { label: 'gbk', name: 'Chinese Simplified (GBK)', group: 'Asian' },
  { label: 'gb18030', name: 'Chinese Simplified (GB18030)', group: 'Asian' },
  { label: 'big5', name: 'Chinese Traditional (Big5)', group: 'Asian' },
  { label: 'euc-kr', name: 'Korean (EUC-KR)', group: 'Asian' },
];

export function encodingName(label: string): string {
  return DECODE_ENCODINGS.find((e) => e.label === label)?.name ?? label;
}

export type Bom = {
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
  length: number;
} | null;

export function detectBom(bytes: Uint8Array): Bom {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', length: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', length: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', length: 2 };
  return null;
}

/** Valid UTF-8? A multi-byte sequence cut off at the very end is tolerated when `truncated`. */
export function isValidUtf8(bytes: Uint8Array, truncated = false): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let cut = 0; cut <= (truncated ? 3 : 0) && cut <= bytes.length; cut++) {
    try {
      decoder.decode(bytes.subarray(0, bytes.length - cut));
      return true;
    } catch {
      // try a shorter slice
    }
  }
  return false;
}

export interface Detection {
  encoding: string;
  bom: Bom;
  /** Why this encoding was chosen, for the UI. */
  reason: string;
  confidence: 'certain' | 'high' | 'guess';
}

/**
 * Best-effort encoding detection: BOM → strict UTF-8 → UTF-16 without BOM
 * (NUL byte pattern) → a legacy single-byte encoding (Windows-1252).
 * Pass `truncated` when `bytes` is only the start of a larger file.
 */
export function detectEncoding(bytes: Uint8Array, truncated = false): Detection {
  const bom = detectBom(bytes);
  if (bom)
    return {
      encoding: bom.encoding,
      bom,
      reason: 'Byte order mark (BOM) at the start of the file.',
      confidence: 'certain',
    };
  if (!bytes.length)
    return {
      encoding: 'utf-8',
      bom: null,
      reason: 'The file is empty.',
      confidence: 'guess',
    };
  // UTF-16 without BOM: lots of NULs in one byte position of each pair.
  const sample = bytes.subarray(0, Math.min(bytes.length, 65536));
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i + 1 < sample.length; i += 2) {
    if (sample[i] === 0) evenNul++;
    if (sample[i + 1] === 0) oddNul++;
  }
  const pairs = Math.floor(sample.length / 2) || 1;
  if (oddNul / pairs > 0.3 && evenNul / pairs < 0.05)
    return {
      encoding: 'utf-16le',
      bom: null,
      reason: 'No BOM, but the NUL byte pattern looks like UTF-16 little-endian.',
      confidence: 'high',
    };
  if (evenNul / pairs > 0.3 && oddNul / pairs < 0.05)
    return {
      encoding: 'utf-16be',
      bom: null,
      reason: 'No BOM, but the NUL byte pattern looks like UTF-16 big-endian.',
      confidence: 'high',
    };
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii)
    return {
      encoding: 'utf-8',
      bom: null,
      reason: 'Plain ASCII: identical in UTF-8 and most legacy encodings.',
      confidence: 'high',
    };
  if (isValidUtf8(bytes, truncated))
    return {
      encoding: 'utf-8',
      bom: null,
      reason: 'Valid UTF-8 with multi-byte characters.',
      confidence: 'high',
    };
  return {
    encoding: 'windows-1252',
    bom: null,
    reason:
      'Not valid UTF-8, so this is a legacy 8-bit encoding. Western (Windows-1252) is a guess: pick another if the preview looks wrong.',
    confidence: 'guess',
  };
}

export interface Decoded {
  text: string;
  /** Number of U+FFFD replacement characters produced by invalid bytes. */
  replacements: number;
}

/** Decode with a TextDecoder label, removing a matching BOM. */
export function decodeBytes(bytes: Uint8Array, label: string): Decoded {
  const decoder = new TextDecoder(label, { fatal: false, ignoreBOM: false });
  const text = decoder.decode(bytes);
  let replacements = 0;
  for (let i = text.indexOf('�'); i >= 0; i = text.indexOf('�', i + 1)) replacements++;
  return { text, replacements };
}

export function isSupportedLabel(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

export type LineEnding = 'keep' | 'lf' | 'crlf' | 'cr';

export function countLineEndings(text: string): {
  crlf: number;
  lf: number;
  cr: number;
} {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  return { crlf, lf, cr };
}

export function describeLineEndings(counts: { crlf: number; lf: number; cr: number }): string {
  const kinds = [
    counts.crlf && `CRLF (Windows) ×${counts.crlf}`,
    counts.lf && `LF (Unix) ×${counts.lf}`,
    counts.cr && `CR (classic Mac) ×${counts.cr}`,
  ].filter(Boolean);
  if (!kinds.length) return 'No line breaks';
  return kinds.length > 1 ? `Mixed: ${kinds.join(', ')}` : String(kinds[0]).replace(/ ×\d+$/, '');
}

export function convertLineEndings(text: string, mode: LineEnding): string {
  if (mode === 'keep') return text;
  const eol = mode === 'lf' ? '\n' : mode === 'crlf' ? '\r\n' : '\r';
  return text.replace(/\r\n|\r|\n/g, eol);
}

export type OutputEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16le-bom' | 'utf-16be-bom';

export const OUTPUT_ENCODINGS: Array<{ value: OutputEncoding; label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-8-bom', label: 'UTF-8 with BOM' },
  { value: 'utf-16le-bom', label: 'UTF-16 LE with BOM' },
  { value: 'utf-16le', label: 'UTF-16 LE (no BOM)' },
  { value: 'utf-16be-bom', label: 'UTF-16 BE with BOM' },
];

/** Encode text (a leading U+FEFF in the text itself is dropped so a BOM is never doubled). */
export function encodeText(input: string, target: OutputEncoding): Uint8Array {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (target === 'utf-8' || target === 'utf-8-bom') {
    const body = new TextEncoder().encode(text);
    if (target === 'utf-8') return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const bom = target !== 'utf-16le';
  const be = target === 'utf-16be-bom';
  const offset = bom ? 2 : 0;
  const out = new Uint8Array(offset + text.length * 2);
  if (bom) out.set(be ? [0xfe, 0xff] : [0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const o = offset + i * 2;
    if (be) {
      out[o] = c >> 8;
      out[o + 1] = c & 0xff;
    } else {
      out[o] = c & 0xff;
      out[o + 1] = c >> 8;
    }
  }
  return out;
}

export function outputFileName(name: string, target: OutputEncoding): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '.txt';
  const tag = target.startsWith('utf-16') ? 'utf16' : 'utf8';
  return `${base}.${tag}${ext}`;
}
