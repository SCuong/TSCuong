/** Pure grouping/formatting of EXIF tags for the EXIF viewer. */
import { formatMetaValue, type MetaGroups } from './exif';

export type DisplayGroup = 'camera' | 'exposure' | 'dates' | 'gps' | 'image' | 'icc' | 'xmp' | 'iptc' | 'other';

export const GROUP_LABELS: Record<DisplayGroup, string> = {
  camera: 'Camera & lens',
  exposure: 'Exposure',
  dates: 'Dates',
  gps: 'GPS location',
  image: 'Image',
  icc: 'Color profile (ICC)',
  xmp: 'XMP',
  iptc: 'IPTC',
  other: 'Other',
};

const CAMERA = new Set([
  'Make', 'Model', 'LensMake', 'LensModel', 'LensInfo', 'LensSerialNumber', 'Software', 'BodySerialNumber', 'SerialNumber',
  'CameraOwnerName', 'HostComputer', 'Artist', 'Copyright', 'OwnerName', 'ImageDescription',
]);
const EXPOSURE = new Set([
  'ExposureTime', 'FNumber', 'ISO', 'ISOSpeedRatings', 'ExposureProgram', 'ExposureCompensation', 'ExposureBiasValue', 'MeteringMode',
  'Flash', 'FocalLength', 'FocalLengthIn35mmFormat', 'WhiteBalance', 'ApertureValue', 'ShutterSpeedValue', 'BrightnessValue',
  'MaxApertureValue', 'ExposureMode', 'SceneCaptureType', 'DigitalZoomRatio', 'SensingMethod', 'LightSource', 'Contrast',
  'Saturation', 'Sharpness', 'SubjectDistance', 'SubjectDistanceRange', 'GainControl', 'SensitivityType', 'RecommendedExposureIndex',
]);

export interface DisplayRow {
  key: string;
  label: string;
  value: string;
}

/** "ExposureTime" → "Exposure time", "GPSLatitudeRef" → "GPS latitude ref" */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/^GPS/, 'GPS ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b(gps|iso|icc|xmp|iptc|exif|id|uuid|dpi|rgb|xyz|cmm|trc|jfif|utc)\b/g, (m) => m.toUpperCase());
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Seconds → "1/250 s" or "2.5 s". */
export function formatExposureTime(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return String(v);
  if (v >= 1) return `${Math.round(v * 10) / 10} s`;
  return `1/${Math.round(1 / v)} s`;
}

/** [48, 51, 29.4] → 48° 51′ 29.4″ */
export function formatDms(v: number[]): string {
  const [d = 0, m = 0, sec = 0] = v;
  return `${d}° ${m}′ ${Math.round(sec * 100) / 100}″`;
}

const DMS_KEYS = new Set(['GPSLatitude', 'GPSLongitude', 'GPSDestLatitude', 'GPSDestLongitude']);

export function formatTagValue(key: string, v: unknown): string {
  if (DMS_KEYS.has(key) && Array.isArray(v) && v.every((x) => typeof x === 'number')) return formatDms(v as number[]);
  if (typeof v === 'number') {
    if (key === 'ExposureTime') return formatExposureTime(v);
    if (key === 'FNumber' || key === 'ApertureValue' || key === 'MaxApertureValue') return `f/${Math.round(v * 10) / 10}`;
    if (key === 'FocalLength') return `${Math.round(v * 10) / 10} mm`;
    if (key === 'FocalLengthIn35mmFormat') return `${v} mm (35 mm equiv.)`;
    if (key === 'ExposureCompensation' || key === 'ExposureBiasValue') return `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100} EV`;
    if (key === 'GPSAltitude') return `${Math.round(v * 10) / 10} m`;
  }
  return formatMetaValue(v);
}

function classifyTiffKey(key: string): DisplayGroup {
  if (CAMERA.has(key)) return 'camera';
  if (EXPOSURE.has(key)) return 'exposure';
  if (/Date|OffsetTime|SubSecTime/.test(key)) return 'dates';
  return 'image';
}

/** Group parsed segments into display sections (empty sections omitted). */
export function groupForDisplay(groups: MetaGroups): Array<{ id: DisplayGroup; rows: DisplayRow[] }> {
  const out: Record<DisplayGroup, DisplayRow[]> = {
    camera: [], exposure: [], dates: [], gps: [], image: [], icc: [], xmp: [], iptc: [], other: [],
  };
  const seen = new Set<string>();
  for (const [segment, tags] of Object.entries(groups)) {
    // JFIF density/thumbnail fields are container details, not metadata.
    if (segment === 'jfif') continue;
    for (const [key, value] of Object.entries(tags)) {
      if (value === undefined || value === null || value === '') continue;
      // Raw binary blobs (ICC curves, maker data) are only useful in the JSON export.
      if (value instanceof Uint8Array) continue;
      let target: DisplayGroup;
      if (segment === 'gps') target = 'gps';
      else if (segment === 'icc') target = 'icc';
      else if (segment === 'xmp') target = 'xmp';
      else if (segment === 'iptc') target = 'iptc';
      else if (segment === 'ifd0' || segment === 'exif' || segment === 'interop' || segment === 'jfif' || segment === 'ihdr') target = classifyTiffKey(key);
      else if (segment === 'ifd1') target = 'image';
      else target = 'other';
      const label = segment === 'ifd1' ? `Thumbnail ${humanizeKey(key).toLowerCase()}` : humanizeKey(key);
      const id = `${target}:${label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out[target].push({ key: `${segment}.${key}`, label, value: formatTagValue(key, value) });
    }
  }
  return (Object.keys(out) as DisplayGroup[]).filter((k) => out[k].length).map((id) => ({ id, rows: out[id] }));
}

/** JSON-safe copy of parsed metadata (Dates → ISO strings, bytes → length notes). */
export function metadataToJson(groups: MetaGroups): string {
  return JSON.stringify(
    groups,
    (_k, v) => {
      if (v instanceof Uint8Array) return `<${v.length} bytes>`;
      if (typeof v === 'bigint') return v.toString();
      return v;
    },
    2,
  );
}
