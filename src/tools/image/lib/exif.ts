/** Metadata reading via exifr (lazy loaded), grouped for display. */

export type MetaGroups = Record<string, Record<string, unknown>>;

export interface MetaSummary {
  exifTags: number;
  gps: { latitude: number; longitude: number } | null;
  hasXmp: boolean;
  hasIptc: boolean;
  hasIcc: boolean;
  camera: string | null;
  date: string | null;
  total: number;
}

const SEGMENTS = ['ifd0', 'ifd1', 'exif', 'gps', 'interop', 'xmp', 'iptc', 'icc', 'jfif', 'ihdr'] as const;

/** Parse all metadata segments. Returns an empty object when there is none. */
export async function readMetadata(input: Blob | Uint8Array): Promise<MetaGroups> {
  const exifr = await import('exifr');
  const parse = exifr.parse ?? exifr.default.parse;
  let out: unknown;
  try {
    out = await parse(input, {
      tiff: true,
      ifd0: {},
      ifd1: true,
      exif: true,
      gps: true,
      interop: true,
      xmp: true,
      icc: true,
      iptc: true,
      jfif: true,
      ihdr: true,
      makerNote: false,
      userComment: true,
      mergeOutput: false,
      translateValues: true,
      reviveValues: true,
      sanitize: true,
    });
  } catch {
    return {};
  }
  if (!out || typeof out !== 'object') return {};
  const groups: MetaGroups = {};
  for (const [key, value] of Object.entries(out as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !(value instanceof Uint8Array) && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
      if (entries.length) groups[key] = Object.fromEntries(entries);
    } else if (value !== undefined) {
      (groups.other ??= {})[key] = value;
    }
  }
  return groups;
}

/** Convert GPS values (decimal or [deg, min, sec] + ref) to signed decimal degrees. */
export function gpsFromGroups(groups: MetaGroups): { latitude: number; longitude: number } | null {
  const g = groups.gps;
  if (!g) return null;
  const toDec = (v: unknown, ref: unknown): number | null => {
    let n: number | null = null;
    if (typeof v === 'number') n = v;
    else if (Array.isArray(v) && v.length >= 1 && v.every((x) => typeof x === 'number')) n = v[0] + (v[1] ?? 0) / 60 + (v[2] ?? 0) / 3600;
    if (n === null || !Number.isFinite(n)) return null;
    if (typeof ref === 'string' && /^[SW]/i.test(ref)) n = -Math.abs(n);
    return n;
  };
  const lat = typeof g.latitude === 'number' ? g.latitude : toDec(g.GPSLatitude, g.GPSLatitudeRef);
  const lon = typeof g.longitude === 'number' ? g.longitude : toDec(g.GPSLongitude, g.GPSLongitudeRef);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { latitude: lat, longitude: lon };
}

function isTiffGroup(k: string) {
  return k === 'ifd0' || k === 'ifd1' || k === 'exif' || k === 'gps' || k === 'interop';
}

export function summarizeMetadata(groups: MetaGroups): MetaSummary {
  const exifTags = Object.entries(groups)
    .filter(([k]) => isTiffGroup(k))
    .reduce((n, [, v]) => n + Object.keys(v).length, 0);
  const ifd0 = groups.ifd0 ?? {};
  const exif = groups.exif ?? {};
  const make = typeof ifd0.Make === 'string' ? ifd0.Make.trim() : '';
  const model = typeof ifd0.Model === 'string' ? ifd0.Model.trim() : '';
  const camera = [make, model.startsWith(make) ? model.slice(make.length).trim() : model].filter(Boolean).join(' ') || null;
  const rawDate = exif.DateTimeOriginal ?? ifd0.ModifyDate ?? exif.CreateDate;
  const date = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate.toLocaleString() : typeof rawDate === 'string' ? rawDate : null;
  const total = Object.entries(groups)
    .filter(([k]) => k !== 'jfif' && k !== 'ihdr')
    .reduce((n, [, v]) => n + Object.keys(v).length, 0);
  return {
    exifTags,
    gps: gpsFromGroups(groups),
    hasXmp: Boolean(groups.xmp && Object.keys(groups.xmp).length),
    hasIptc: Boolean(groups.iptc && Object.keys(groups.iptc).length),
    hasIcc: Boolean(groups.icc && Object.keys(groups.icc).length),
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
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v).replace(/\0+$/, '');
}

export { SEGMENTS };
