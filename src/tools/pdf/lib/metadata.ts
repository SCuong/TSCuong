import { PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument } from 'pdf-lib';

/** Document information dictionary fields that users edit. Dates are ISO strings or ''. */
export interface MetadataFields {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string;
  modDate: string;
}

export const EMPTY_METADATA: MetadataFields = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: '',
  producer: '',
  creationDate: '',
  modDate: '',
};

const TEXT_KEYS: Array<[keyof MetadataFields, string]> = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords'],
  ['creator', 'Creator'],
  ['producer', 'Producer'],
];

const DATE_KEYS: Array<[keyof MetadataFields, string]> = [
  ['creationDate', 'CreationDate'],
  ['modDate', 'ModDate'],
];

export interface ReadMetadata {
  fields: MetadataFields;
  /** Other (custom) keys in the Info dictionary, decoded as text. */
  custom: Array<{ key: string; value: string }>;
  hasXmp: boolean;
  /** Raw date strings that could not be parsed. */
  invalidDates: string[];
}

/** Get (or create) the document information dictionary. */
export function infoDict(doc: PDFDocument, create = false): PDFDict | null {
  const ref = doc.context.trailerInfo.Info;
  const existing = ref ? doc.context.lookup(ref) : undefined;
  if (existing instanceof PDFDict) return existing;
  if (!create) return null;
  const dict = doc.context.obj({});
  doc.context.trailerInfo.Info = doc.context.register(dict);
  return dict;
}

function decodeText(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try {
      return value.decodeText();
    } catch {
      return null;
    }
  }
  if (value instanceof PDFName) return value.decodeText();
  return null;
}

/**
 * Parse a PDF date string "D:YYYYMMDDHHmmSSOHH'mm'" (every part after the year optional).
 * Returns null when it is not a valid date.
 */
export function parsePdfDate(raw: string): Date | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz+-])(?:(\d{2})'?(\d{2})?'?)?)?/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz, tzh = '00', tzm = '00'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(utc) || +mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) return null;
  let offset = 0;
  if (tz === '+' || tz === '-') offset = (tz === '+' ? 1 : -1) * (+tzh * 60 + +tzm);
  // Without a timezone the spec says "unknown"; treat it as UTC for a stable result.
  return new Date(utc - offset * 60_000);
}

/** Format a Date as a PDF date string in UTC: D:YYYYMMDDHHmmSSZ */
export function formatPdfDate(date: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `D:${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(
    date.getUTCMinutes(),
  )}${p(date.getUTCSeconds())}Z`;
}

export function readMetadata(doc: PDFDocument): ReadMetadata {
  const dict = infoDict(doc);
  const fields = { ...EMPTY_METADATA };
  const invalidDates: string[] = [];
  const custom: Array<{ key: string; value: string }> = [];
  if (dict) {
    for (const [field, key] of TEXT_KEYS) fields[field] = decodeText(dict.lookup(PDFName.of(key))) ?? '';
    for (const [field, key] of DATE_KEYS) {
      const raw = decodeText(dict.lookup(PDFName.of(key)));
      if (!raw) continue;
      const date = parsePdfDate(raw);
      if (date) fields[field] = date.toISOString();
      else invalidDates.push(raw);
    }
    const known = new Set([...TEXT_KEYS, ...DATE_KEYS].map(([, k]) => k));
    for (const [name, value] of dict.entries()) {
      const key = name.decodeText();
      if (known.has(key)) continue;
      const text = decodeText(dict.lookup(name));
      custom.push({ key, value: text ?? value.toString() });
    }
  }
  return { fields, custom, hasXmp: doc.catalog.has(PDFName.of('Metadata')), invalidDates };
}

/** Encode text so non-Latin characters survive (UTF-16BE hex string when needed). */
function encodeText(value: string) {
  // PDFDocEncoding is close to Latin-1 for printable ASCII; use a literal string only for plain ASCII.
  return /^[\x20-\x7e]*$/.test(value) ? PDFString.of(escapeLiteral(value)) : PDFHexString.fromText(value);
}

function escapeLiteral(value: string): string {
  return value.replace(/[\\()]/g, (c) => `\\${c}`);
}

export interface WriteMetadataOptions {
  /** Remove the XMP metadata stream so viewers do not show stale values from it. */
  removeXmp?: boolean;
}

/** Write fields to the Info dictionary. Empty fields are removed. */
export function writeMetadata(doc: PDFDocument, fields: MetadataFields, options: WriteMetadataOptions = {}): void {
  const dict = infoDict(doc, true)!;
  for (const [field, key] of TEXT_KEYS) {
    const value = fields[field].trim();
    if (value) dict.set(PDFName.of(key), encodeText(value));
    else dict.delete(PDFName.of(key));
  }
  for (const [field, key] of DATE_KEYS) {
    const value = fields[field].trim();
    if (!value) {
      dict.delete(PDFName.of(key));
      continue;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`"${value}" is not a valid date.`);
    dict.set(PDFName.of(key), PDFString.of(formatPdfDate(date)));
  }
  if (options.removeXmp) doc.catalog.delete(PDFName.of('Metadata'));
}

/** Remove the Info dictionary contents and the XMP metadata stream. */
export function removeAllMetadata(doc: PDFDocument): void {
  const dict = infoDict(doc);
  if (dict) for (const key of dict.keys()) dict.delete(key);
  const xmp = doc.catalog.get(PDFName.of('Metadata'));
  doc.catalog.delete(PDFName.of('Metadata'));
  if (xmp instanceof PDFRef) doc.context.delete(xmp);
  // Drop the Info reference entirely so no empty dictionary remains.
  const info = doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) doc.context.delete(info);
  delete (doc.context.trailerInfo as { Info?: unknown }).Info;
}
