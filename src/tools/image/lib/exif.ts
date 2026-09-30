/** Metadata reading via exifr (lazy loaded), grouped for display. */
import { foreignMetadata, wrapInJpeg } from './metaContainers';

export type MetaGroups = Record<string, Record<string, unknown>>;

export interface MetaSummary {
  exifTags: number;
  gps: { latitude: number; longitude: number } | null;
  hasXmp: boolean;
  hasIptc: boolean;
  hasIcc: boolean;
  /** Text chunks of a PNG (Author, Comment, Software…). */
  textTags: number;
  camera: string | null;
  date: string | null;
  total: number;
}

const SEGMENTS = ['ifd0', 'ifd1', 'exif', 'gps', 'interop', 'xmp', 'iptc', 'icc', 'jfif', 'ihdr'] as const;

/** Keys exifr adds to the GPS block (decimal degrees computed from the GPS tags). */
const COMPUTED_KEYS = new Set(['latitude', 'longitude']);

/** Fields of a PNG IHDR chunk; anything else exifr puts in `ihdr` comes from PNG text chunks. */
const IHDR_FIELDS = new Set(['ImageWidth', 'ImageHeight', 'BitDepth', 'ColorType', 'Compression', 'Filter', 'Interlace']);

type ParseFn = (input: Uint8Array, options: Record<string, unknown>) => Promise<unknown>;

const BASE_OPTIONS = {
  makerNote: false,
  userComment: true,
  mergeOutput: false,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  multiSegment: true,
};

/** Everything except XMP: EXIF/TIFF, GPS, IPTC, ICC, JFIF and PNG header/text. */
const MAIN_OPTIONS = { ...BASE_OPTIONS, tiff: true, ifd0: {}, ifd1: true, exif: true, gps: true, interop: true, xmp: false, icc: true, iptc: true, jfif: true, ihdr: true };
/** XMP only, so its tiff:/exif: namespaces don't get merged into the real EXIF groups. */
const XMP_OPTIONS = { ...BASE_OPTIONS, tiff: false, ifd0: false, ifd1: false, exif: false, gps: false, interop: false, xmp: true, icc: false, iptc: false, jfif: false, ihdr: false };

async function safeParse(parse: ParseFn, input: Uint8Array, options: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const out = await parse(input, options);
    return out && typeof out === 'object' ? (out as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const isPlainGroup = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !(v instanceof Uint8Array) && !Array.isArray(v) && !(v instanceof Date);

/** exifr output → groups (drops exifr's own `errors` list and empty groups). */
function toGroups(out: Record<string, unknown>, into: MetaGroups) {
  for (const [key, value] of Object.entries(out)) {
    if (key === 'errors') continue;
    if (isPlainGroup(value)) {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length) into[key] = { ...(into[key] ?? {}), ...Object.fromEntries(entries) };
    } else if (value !== undefined) {
      (into.other ??= {})[key] = value;
    }
  }
}

/** XMP namespaces (as exifr returns them) → one `xmp` group keyed "prefix:Name". */
function xmpGroup(out: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [ns, value] of Object.entries(out)) {
    if (ns === 'errors' || value === undefined) continue;
    // exifr files XMP's tiff: namespace under "ifd0"; show the real XMP prefix.
    const prefix = ns === 'ifd0' ? 'tiff' : ns;
    if (isPlainGroup(value)) {
      for (const [k, v] of Object.entries(value)) if (v !== undefined) flat[`${prefix}:${k}`] = v;
    } else {
      flat[prefix] = value;
    }
  }
  return flat;
}

/** Parse all metadata segments. Returns an empty object when there is none. */
export async function readMetadata(input: Blob | Uint8Array): Promise<MetaGroups> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  const exifr = await import('exifr');
  const parse = (exifr.parse ?? exifr.default.parse) as ParseFn;
  // exifr reads JPEG, PNG, HEIC/AVIF and TIFF; WebP and GIF blocks are re-wrapped in a JPEG shell.
  const foreign = foreignMetadata(bytes);
  const source = foreign ? wrapInJpeg(foreign) : bytes;
  const groups: MetaGroups = {};
  toGroups(await safeParse(parse, source, MAIN_OPTIONS), groups);
  if (foreign?.tiff && !groups.ifd0 && !groups.exif) {
    // EXIF too large for a JPEG segment: parse the TIFF structure on its own.
    toGroups(await safeParse(parse, foreign.tiff, MAIN_OPTIONS), groups);
  }
  const xmp = xmpGroup(await safeParse(parse, source, XMP_OPTIONS));
  if (Object.keys(xmp).length) groups.xmp = xmp;
  return groups;
}

/** "48,51.49N" or "48,51,29.4N" (XMP GPSCoordinate) → signed decimal degrees. */
export function parseXmpCoordinate(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?\s*([NSEW])\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0);
  if (!Number.isFinite(n)) return null;
  return /[SW]/i.test(m[4]) ? -n : n;
}

/** Convert GPS values (decimal or [deg, min, sec] + ref, or XMP coordinates) to signed decimal degrees. */
export function gpsFromGroups(groups: MetaGroups): { latitude: number; longitude: number } | null {
  const toDec = (v: unknown, ref: unknown): number | null => {
    let n: number | null = null;
    if (typeof v === 'number') n = v;
    else if (Array.isArray(v) && v.length >= 1 && v.every((x) => typeof x === 'number')) n = v[0] + (v[1] ?? 0) / 60 + (v[2] ?? 0) / 3600;
    if (n === null || !Number.isFinite(n)) return null;
    if (typeof ref === 'string' && /^[SW]/i.test(ref)) n = -Math.abs(n);
    return n;
  };
  const valid = (lat: number | null, lon: number | null) =>
    lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { latitude: lat, longitude: lon } : null;
  const g = groups.gps;
  if (g) {
    const lat = typeof g.latitude === 'number' ? g.latitude : toDec(g.GPSLatitude, g.GPSLatitudeRef);
    const lon = typeof g.longitude === 'number' ? g.longitude : toDec(g.GPSLongitude, g.GPSLongitudeRef);
    const found = valid(lat, lon);
    if (found) return found;
  }
  const x = groups.xmp;
  if (x) return valid(parseXmpCoordinate(x['exif:GPSLatitude']), parseXmpCoordinate(x['exif:GPSLongitude']));
  return null;
}

function isTiffGroup(k: string) {
  return k === 'ifd0' || k === 'ifd1' || k === 'exif' || k === 'gps' || k === 'interop';
}

/** Tags in a group, leaving out computed keys and raw binary blobs (not shown as tags). */
const countKeys = (group: Record<string, unknown> | undefined, skip: (k: string) => boolean = () => false) =>
  group ? Object.entries(group).filter(([k, v]) => !skip(k) && !(v instanceof Uint8Array)).length : 0;

export function summarizeMetadata(groups: MetaGroups): MetaSummary {
  const exifTags = Object.entries(groups)
    .filter(([k]) => isTiffGroup(k))
    .reduce((n, [, v]) => n + countKeys(v, (key) => COMPUTED_KEYS.has(key)), 0);
  const textTags = countKeys(groups.ihdr, (k) => IHDR_FIELDS.has(k));
  const ifd0 = groups.ifd0 ?? {};
  const exif = groups.exif ?? {};
  const make = typeof ifd0.Make === 'string' ? ifd0.Make.trim() : '';
  const model = typeof ifd0.Model === 'string' ? ifd0.Model.trim() : '';
  const camera = [make, model.startsWith(make) ? model.slice(make.length).trim() : model].filter(Boolean).join(' ') || null;
  const rawDate = exif.DateTimeOriginal ?? ifd0.ModifyDate ?? exif.CreateDate;
  const date = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate.toLocaleString() : typeof rawDate === 'string' ? rawDate : null;
  const total = Object.entries(groups)
    .filter(([k]) => k !== 'jfif' && k !== 'ihdr')
    .reduce((n, [k, v]) => n + countKeys(v, (key) => k === 'gps' && COMPUTED_KEYS.has(key)), 0) + textTags;
  return {
    exifTags,
    gps: gpsFromGroups(groups),
    hasXmp: countKeys(groups.xmp) > 0,
    hasIptc: countKeys(groups.iptc) > 0,
    hasIcc: countKeys(groups.icc) > 0,
    textTags,
    camera,
    date,
    total,
  };
}

export function formatCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(6)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export function osmUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=15/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}

/** Render a metadata value for display. */
export function formatMetaValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid date' : v.toLocaleString();
  if (v instanceof Uint8Array) return `${v.length} bytes of binary data`;
  if (Array.isArray(v)) {
    if (v.length > 16) return `[${v.slice(0, 16).map(formatMetaValue).join(', ')}, … ${v.length} items]`;
    return v.map(formatMetaValue).join(', ');
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'object') {
    // XMP language alternatives: { lang, value }
    const o = v as Record<string, unknown>;
    if (typeof o.value === 'string' && Object.keys(o).every((k) => k === 'value' || k === 'lang')) return o.value;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v).replace(/\0+$/, '');
}

export { SEGMENTS };
