/**
 * Time-zone helpers built on `Intl.DateTimeFormat` (no Temporal, no tz database
 * bundled). Offsets are derived from the browser's IANA data, so they include
 * historical rules and daylight-saving transitions.
 */
import { MAX_EPOCH_MS, MIN_EPOCH_MS, MS_PER_DAY, MS_PER_MINUTE, utcFromWall, wallFromUtc, type WallTime } from './civil';

export const UTC = 'UTC';

const FALLBACK_ZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Anchorage',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Ho_Chi_Minh',
  'Asia/Hong_Kong',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Moscow',
  'Europe/Paris',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

/** Legacy zone ids that IANA has renamed. */
const MODERN_NAMES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Enderbury': 'Pacific/Kanton',
};

/** The current IANA name for a legacy alias (when the engine accepts it), else the input. */
export function canonicalZone(zone: string): string {
  const modern = MODERN_NAMES[zone];
  return modern && isValidTimeZone(modern) ? modern : zone;
}

let zoneCache: string[] | null = null;

/** Every IANA zone the browser knows, sorted, always including UTC. */
export function listTimeZones(): string[] {
  if (zoneCache) return zoneCache;
  let zones: string[];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = FALLBACK_ZONES.filter(isValidTimeZone);
  // Some engines still report pre-2016 names (ICU canonical ids); show the current IANA names.
  zones = zones.map(canonicalZone);
  const set = new Set(zones);
  set.add(UTC);
  zoneCache = [...set].sort((a, b) => (a === UTC ? -1 : b === UTC ? 1 : a.localeCompare(b)));
  return zoneCache;
}

const validity = new Map<string, boolean>();

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  const known = validity.get(zone);
  if (known !== undefined) return known;
  let ok = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    ok = false;
  }
  validity.set(zone, ok);
  return ok;
}

/** The browser's own zone (falls back to UTC when unavailable). */
export function localTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? canonicalZone(zone) : UTC;
  } catch {
    return UTC;
  }
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(zone, f);
  }
  return f;
}

/**
 * Wall-clock fields of an instant as seen in `zone`. Never throws: instants beyond the
 * Date range use the offset at the range boundary, and NaN gives NaN fields.
 */
export function wallInZone(epochMs: number, zone: string): WallTime {
  if (zone !== UTC && Number.isFinite(epochMs) && (epochMs > MAX_EPOCH_MS || epochMs < MIN_EPOCH_MS)) {
    return wallFromUtc(epochMs + tzOffsetMs(epochMs, zone));
  }
  if (zone === UTC || !Number.isFinite(epochMs)) {
    const d = new Date(epochMs);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      millisecond: d.getUTCMilliseconds(),
    };
  }
  const parts = partsFormatter(zone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const era = parts.find((p) => p.type === 'era')?.value ?? 'AD';
  let year = get('year');
  if (/^B/i.test(era)) year = 1 - year; // 1 BC = year 0 (proleptic ISO)
  return {
    year,
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
    millisecond: ((epochMs % 1000) + 1000) % 1000,
  };
}

/**
 * UTC offset of `zone` at the instant, in milliseconds (east of UTC is positive).
 * Computed from the difference between the zone's and UTC's wall fields, so it also
 * works at the very ends of the Date range (instants beyond it use the boundary offset).
 */
export function tzOffsetMs(epochMs: number, zone: string): number {
  if (zone === UTC || !Number.isFinite(epochMs)) return 0;
  const t = Math.min(Math.max(epochMs, MIN_EPOCH_MS), MAX_EPOCH_MS);
  const floored = Math.floor(t / 1000) * 1000;
  const local = wallInZone(floored, zone);
  const utc = wallFromUtc(floored);
  // Offsets are under 24 hours, so the two dates differ by at most one day.
  const dayDiff =
    local.year !== utc.year ? Math.sign(local.year - utc.year) : local.month !== utc.month ? Math.sign(local.month - utc.month) : Math.sign(local.day - utc.day);
  return (
    dayDiff * MS_PER_DAY +
    ((local.hour - utc.hour) * 3600 + (local.minute - utc.minute) * 60 + (local.second - utc.second)) * 1000
  );
}

export type Disambiguation = 'compatible' | 'earlier' | 'later';

export interface ZonedResolution {
  epochMs: number;
  /** `gap`: the wall time was skipped (spring forward); `ambiguous`: it happened twice (fall back). */
  status: 'ok' | 'gap' | 'ambiguous';
  /** Both instants for an ambiguous time, earlier first. */
  candidates: number[];
  /** For a gap: how far the time was moved forward, in ms. */
  shiftMs: number;
}

function sameWall(a: WallTime, b: WallTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * The instant at which `zone` shows the given wall-clock time. Follows the
 * Temporal `compatible` rules by default: an ambiguous time resolves to the
 * earlier instant, a skipped time moves forward by the length of the gap.
 */
export function zonedToEpoch(wall: WallTime, zone: string, disambiguation: Disambiguation = 'compatible'): ZonedResolution {
  const guess = utcFromWall(wall);
  if (zone === UTC) return { epochMs: guess, status: 'ok', candidates: [guess], shiftMs: 0 };
  const before = tzOffsetMs(guess - MS_PER_DAY, zone);
  const after = tzOffsetMs(guess + MS_PER_DAY, zone);
  const offsets = [...new Set([before, tzOffsetMs(guess, zone), after])];
  const target = { ...wall, millisecond: 0 };
  const candidates = offsets
    .map((offset) => guess - offset)
    .filter((t) => sameWall(wallInZone(t, zone), target))
    .sort((a, b) => a - b);
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { epochMs: unique[0], status: 'ok', candidates: unique, shiftMs: 0 };
  if (unique.length > 1) {
    const epochMs = disambiguation === 'later' ? unique[unique.length - 1] : unique[0];
    return { epochMs, status: 'ambiguous', candidates: unique, shiftMs: 0 };
  }
  // Skipped wall time: interpret with the offset in effect before the transition (moves forward),
  // or with the later offset for `earlier` (moves backward), as Temporal does.
  const shiftMs = Math.abs(after - before);
  const epochMs = disambiguation === 'earlier' ? guess - after : guess - before;
  return { epochMs, status: 'gap', candidates: [], shiftMs };
}

/** "+05:30", "-08:00", "+00:00". */
export function formatOffset(offsetMs: number, separator = ':'): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const total = Math.round(Math.abs(offsetMs) / MS_PER_MINUTE);
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${sign}${h}${separator}${m}`;
}

/** "UTC", "UTC+5:30", "UTC−8" (short human form). */
export function formatUtcLabel(offsetMs: number): string {
  if (offsetMs === 0) return 'UTC';
  const sign = offsetMs < 0 ? '−' : '+';
  const total = Math.round(Math.abs(offsetMs) / MS_PER_MINUTE);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

const nameFormatters = new Map<string, Intl.DateTimeFormat>();

/** Short zone name such as "EST", "CEST" or "GMT+7", as the browser reports it. */
export function zoneAbbreviation(epochMs: number, zone: string, style: 'short' | 'long' = 'short'): string {
  const key = `${zone}|${style}`;
  let f = nameFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style });
    nameFormatters.set(key, f);
  }
  return f.formatToParts(new Date(epochMs)).find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

/**
 * A real abbreviation such as "EST" or "CEST"; null when the browser only has a
 * generic "GMT+7" / "UTC" form (the numeric offset says the same).
 */
export function namedAbbreviation(epochMs: number, zone: string): string | null {
  const abbr = zoneAbbreviation(epochMs, zone);
  return /^(?:GMT|UTC)(?:[+−-].*)?$/.test(abbr) ? null : abbr;
}

/** Offset observed in January and July of the instant's year (the standard offset is the smaller one). */
export function yearOffsets(epochMs: number, zone: string): { january: number; july: number; standard: number } {
  const year = new Date(epochMs).getUTCFullYear();
  const jan = tzOffsetMs(utcFromWall({ year, month: 1, day: 1, hour: 12, minute: 0, second: 0, millisecond: 0 }), zone);
  const jul = tzOffsetMs(utcFromWall({ year, month: 7, day: 1, hour: 12, minute: 0, second: 0, millisecond: 0 }), zone);
  return { january: jan, july: jul, standard: Math.min(jan, jul) };
}

/** True when the zone observes DST that year and the instant is in the daylight (larger-offset) period. */
export function isDst(epochMs: number, zone: string): boolean {
  const { january, july, standard } = yearOffsets(epochMs, zone);
  if (january === july) return false;
  return tzOffsetMs(epochMs, zone) > standard;
}

/** True when the zone changes its offset during the instant's year. */
export function observesDst(epochMs: number, zone: string): boolean {
  const { january, july } = yearOffsets(epochMs, zone);
  return january !== july;
}

export interface OffsetTransition {
  /** First instant with the new offset. */
  epochMs: number;
  fromOffset: number;
  toOffset: number;
}

/** The next offset change after `fromMs`, searching up to `horizonDays` ahead (null if none). */
export function nextTransition(zone: string, fromMs: number, horizonDays = 400): OffsetTransition | null {
  if (zone === UTC) return null;
  const step = 7 * MS_PER_DAY;
  let lo = fromMs;
  let loOffset = tzOffsetMs(lo, zone);
  const end = fromMs + horizonDays * MS_PER_DAY;
  while (lo < end) {
    const hi = Math.min(lo + step, end);
    const hiOffset = tzOffsetMs(hi, zone);
    if (hiOffset !== loOffset) {
      // Binary search down to the second.
      let a = lo;
      let b = hi;
      while (b - a > 1000) {
        const mid = Math.floor((a + b) / 2000) * 1000;
        if (mid <= a) break;
        if (tzOffsetMs(mid, zone) === loOffset) a = mid;
        else b = mid;
      }
      return { epochMs: b, fromOffset: loOffset, toOffset: hiOffset };
    }
    lo = hi;
    loOffset = hiOffset;
  }
  return null;
}

/** The zone's city part, readable: "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneCity(zone: string): string {
  if (zone === UTC) return 'Coordinated Universal Time';
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** The zone's region part: "America/New_York" → "America". */
export function zoneRegion(zone: string): string {
  if (!zone.includes('/')) return '';
  return zone.split('/')[0].replace(/_/g, ' ');
}

/** Relative day index of `wall` compared to `base` wall date (−1, 0, +1 …). */
export function dayShift(base: WallTime, other: WallTime): number {
  const a = utcFromWall({ ...base, hour: 0, minute: 0, second: 0, millisecond: 0 });
  const b = utcFromWall({ ...other, hour: 0, minute: 0, second: 0, millisecond: 0 });
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Countries, regions and big cities that have no zone id of their own, mapped
 * to the zone people mean ("India" → Asia/Kolkata, "Pacific time" → Los Angeles).
 */
const ZONE_ALIASES: Record<string, string> = {
  india: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  hyderabad: 'Asia/Kolkata',
  china: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  shenzhen: 'Asia/Shanghai',
  guangzhou: 'Asia/Shanghai',
  vietnam: 'Asia/Ho_Chi_Minh',
  hanoi: 'Asia/Ho_Chi_Minh',
  saigon: 'Asia/Ho_Chi_Minh',
  japan: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  korea: 'Asia/Seoul',
  'south korea': 'Asia/Seoul',
  taiwan: 'Asia/Taipei',
  thailand: 'Asia/Bangkok',
  malaysia: 'Asia/Kuala_Lumpur',
  indonesia: 'Asia/Jakarta',
  philippines: 'Asia/Manila',
  pakistan: 'Asia/Karachi',
  bangladesh: 'Asia/Dhaka',
  nepal: 'Asia/Kathmandu',
  'sri lanka': 'Asia/Colombo',
  uae: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh',
  israel: 'Asia/Jerusalem',
  'tel aviv': 'Asia/Jerusalem',
  turkey: 'Europe/Istanbul',
  russia: 'Europe/Moscow',
  uk: 'Europe/London',
  'united kingdom': 'Europe/London',
  england: 'Europe/London',
  britain: 'Europe/London',
  ireland: 'Europe/Dublin',
  france: 'Europe/Paris',
  germany: 'Europe/Berlin',
  munich: 'Europe/Berlin',
  frankfurt: 'Europe/Berlin',
  spain: 'Europe/Madrid',
  barcelona: 'Europe/Madrid',
  italy: 'Europe/Rome',
  milan: 'Europe/Rome',
  netherlands: 'Europe/Amsterdam',
  switzerland: 'Europe/Zurich',
  geneva: 'Europe/Zurich',
  poland: 'Europe/Warsaw',
  sweden: 'Europe/Stockholm',
  portugal: 'Europe/Lisbon',
  ukraine: 'Europe/Kyiv',
  kiev: 'Europe/Kyiv',
  egypt: 'Africa/Cairo',
  nigeria: 'Africa/Lagos',
  kenya: 'Africa/Nairobi',
  'south africa': 'Africa/Johannesburg',
  'cape town': 'Africa/Johannesburg',
  'pacific time': 'America/Los_Angeles',
  california: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  'eastern time': 'America/New_York',
  washington: 'America/New_York',
  boston: 'America/New_York',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  'central time': 'America/Chicago',
  texas: 'America/Chicago',
  dallas: 'America/Chicago',
  houston: 'America/Chicago',
  austin: 'America/Chicago',
  'mountain time': 'America/Denver',
  colorado: 'America/Denver',
  'salt lake city': 'America/Denver',
  arizona: 'America/Phoenix',
  hawaii: 'Pacific/Honolulu',
  alaska: 'America/Anchorage',
  canada: 'America/Toronto',
  ottawa: 'America/Toronto',
  montreal: 'America/Toronto',
  mexico: 'America/Mexico_City',
  brazil: 'America/Sao_Paulo',
  rio: 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo',
  argentina: 'America/Argentina/Buenos_Aires',
  chile: 'America/Santiago',
  colombia: 'America/Bogota',
  peru: 'America/Lima',
  australia: 'Australia/Sydney',
  canberra: 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland',
  wellington: 'Pacific/Auckland',
};

/**
 * Search helper for zone pickers. Ranks exact names first, then city prefixes and
 * country/city aliases, then abbreviations ("EST") and offsets ("+5:30"), then
 * substrings of the id or the long name ("Central European").
 */
export function searchZones(query: string, zones: string[], at: number, limit = 60): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return zones.slice(0, limit);
  const qOffset = q.replace(/^gmt/, 'utc').replace('−', '-');
  const aliasExact = ZONE_ALIASES[q];
  const aliasPrefix = new Set(
    Object.entries(ZONE_ALIASES)
      .filter(([name]) => q.length >= 3 && name.startsWith(q))
      .map(([, zone]) => zone),
  );
  const out: Array<[number, string]> = [];
  for (const zone of zones) {
    const id = zone.toLowerCase();
    const spaced = id.replace(/_/g, ' ');
    const city = zoneCity(zone).toLowerCase();
    let score = -1;
    if (city === q || id === q || zone === aliasExact) score = 0;
    else if (city.startsWith(q) || aliasPrefix.has(zone)) score = 1;
    else {
      const offset = tzOffsetMs(at, zone);
      const label = formatUtcLabel(offset).toLowerCase().replace('−', '-');
      if (zoneAbbreviation(at, zone).toLowerCase() === q) score = 2;
      else if (label === qOffset || formatOffset(offset) === qOffset || label.replace('utc', '') === qOffset) score = 2;
      else if (spaced.includes(q)) score = 3;
      else if (q.length >= 3 && zoneAbbreviation(at, zone, 'long').toLowerCase().includes(q)) score = 4;
    }
    if (score >= 0) out.push([score, zone]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return out.slice(0, limit).map(([, z]) => z);
}

/** Zones most people look for, shown first in pickers (when the browser knows them). */
export const POPULAR_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];
