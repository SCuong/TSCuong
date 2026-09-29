/**
 * Parsing and formatting for the Timestamp Converter: Unix epochs in any unit
 * (exact, via BigInt), other epochs (Windows FILETIME, .NET ticks, WebKit,
 * Apple Cocoa, Excel serial dates, Julian days), ISO 8601 / RFC 3339 / RFC 9557,
 * RFC 2822 and the three HTTP date formats.
 */
import {
  MAX_EPOCH_MS,
  MIN_EPOCH_MS,
  MONTH_SHORT,
  MS_PER_DAY,
  WEEKDAY_SHORT,
  addDays,
  dayOfWeek,
  formatClock,
  formatIsoDate,
  isValidDate,
  isValidWall,
  utcFromWall,
  type WallTime,
} from './civil';
import { calendarDiff } from './datemath';
import { formatOffset, isValidTimeZone, tzOffsetMs, wallInZone, zonedToEpoch } from './tz';

export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

export const EPOCH_UNIT_LABEL: Record<EpochUnit, string> = {
  s: 'seconds',
  ms: 'milliseconds',
  us: 'microseconds',
  ns: 'nanoseconds',
};

const NS_PER: Record<EpochUnit, bigint> = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n };

/** An instant with nanosecond precision: whole epoch milliseconds plus 0–999,999 extra nanoseconds. */
export interface Instant {
  epochMs: number;
  nanos: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const RANGE_ERROR =
  'That moment is outside the range JavaScript dates support (about 271,821 BCE to 275,760 CE, ±8.64 × 10¹⁵ ms).';

/**
 * Guess the unit of an epoch number from its magnitude. Seconds cover roughly
 * years −1200 to 5138; beyond that the number is taken as ms, then µs, then ns.
 */
export function detectEpochUnit(value: number): EpochUnit {
  const abs = Math.abs(value);
  if (abs < 1e11) return 's';
  if (abs < 1e14) return 'ms';
  if (abs < 1e17) return 'us';
  return 'ns';
}

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** True for text that looks like an epoch number (digit separators `_`, `,` and spaces, and a leading `@`, allowed). */
export function looksNumeric(text: string): boolean {
  return NUMERIC.test(cleanNumber(text));
}

function cleanNumber(text: string): string {
  return text
    .trim()
    .replace(/^@/, '')
    .replace(/[_\s]/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '');
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** Total nanoseconds since the epoch as a BigInt. */
export function toTotalNanos(instant: Instant): bigint {
  return BigInt(instant.epochMs) * 1_000_000n + BigInt(instant.nanos);
}

export function fromTotalNanos(total: bigint): Result<Instant> {
  const ms = floorDiv(total, 1_000_000n);
  if (ms > BigInt(MAX_EPOCH_MS) || ms < BigInt(MIN_EPOCH_MS)) return { ok: false, error: RANGE_ERROR };
  return { ok: true, value: { epochMs: Number(ms), nanos: Number(total - ms * 1_000_000n) } };
}

/** Expand "1.5e9" into plain decimal digits so it can be handled exactly. */
function expandExponent(text: string): string {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?e([+-]?\d+)$/i.exec(text);
  if (!m) return text;
  const [, sign, intDigits, fracDigits = '', expText] = m;
  const exp = Number(expText);
  if (Math.abs(exp) > 40) return 'x'; // absurd exponent: rejected by the caller
  const digits = (intDigits || '0') + fracDigits;
  let point = (intDigits || '0').length + exp;
  let padded = digits;
  if (point < 0) {
    padded = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > padded.length) padded = padded + '0'.repeat(point - padded.length);
  const int = padded.slice(0, point) || '0';
  const frac = padded.slice(point);
  return `${sign}${int}${frac ? `.${frac}` : ''}`;
}

interface Decimal {
  negative: boolean;
  int: string;
  frac: string;
}

function parseDecimal(text: string): Decimal | null {
  const cleaned = expandExponent(cleanNumber(text));
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!cleaned || !m || (!m[2] && !m[3])) return null;
  return { negative: m[1] === '-', int: m[2] || '0', frac: m[3] ?? '' };
}

/** value × unit (in ns), exactly; digits finer than 1 ns are dropped (towards zero). */
function scaleDecimal(dec: Decimal, nsPerUnit: bigint): { total: bigint; truncated: boolean } {
  const scale = 10n ** BigInt(dec.frac.length);
  const numerator = (BigInt(dec.int) * scale + BigInt(dec.frac || '0')) * nsPerUnit;
  const total = numerator / scale;
  return { total: dec.negative ? -total : total, truncated: numerator % scale !== 0n };
}

export interface ParsedEpoch {
  instant: Instant;
  unit: EpochUnit;
  detected: boolean;
  /** Digits after the unit's precision (below 1 ns) were dropped. */
  truncated: boolean;
}

const NUMBER_ERROR = 'Enter a number of seconds, milliseconds, microseconds or nanoseconds.';

/** Parse an epoch number exactly. `unit: 'auto'` detects the unit from the magnitude. */
export function parseEpoch(text: string, unit: EpochUnit | 'auto' = 'auto'): Result<ParsedEpoch> {
  const dec = parseDecimal(text);
  if (!dec) return { ok: false, error: NUMBER_ERROR };
  const resolved: EpochUnit = unit === 'auto' ? detectEpochUnit(Number(dec.int)) : unit;
  const { total, truncated } = scaleDecimal(dec, NS_PER[resolved]);
  const instant = fromTotalNanos(total);
  if (!instant.ok) return instant;
  return { ok: true, value: { instant: instant.value, unit: resolved, detected: unit === 'auto', truncated } };
}

/** Exact decimal representation of the instant in a unit, e.g. "1700000000.5" seconds. */
export function formatEpoch(instant: Instant, unit: EpochUnit): string {
  return formatScaled(toTotalNanos(instant), NS_PER[unit]);
}

/** `total / unit` as an exact decimal string (the unit must be a power of ten). */
function formatScaled(total: bigint, unit: bigint): string {
  const whole = floorDiv(total, unit);
  if (total - whole * unit === 0n) return whole.toString();
  // Present negative fractional values as −(|x|) rather than floor + positive fraction.
  const neg = total < 0n;
  const abs = neg ? -total : total;
  const width = unit.toString().length - 1;
  const frac = (abs % unit).toString().padStart(width, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / unit}.${frac}`;
}

/** Whole units (floored), e.g. the integer Unix seconds used by most APIs. */
export function formatEpochFloor(instant: Instant, unit: EpochUnit): string {
  return floorDiv(toTotalNanos(instant), NS_PER[unit]).toString();
}

// ---------------------------------------------------------------------------
// Other epochs
// ---------------------------------------------------------------------------

export type AltEpoch = 'filetime' | 'dotnet' | 'webkit' | 'cocoa' | 'excel' | 'jd' | 'mjd';

export interface AltEpochSpec {
  id: AltEpoch;
  label: string;
  /** One line on what it is and where it appears. */
  description: string;
  /** Nanoseconds per unit. */
  nsPerUnit: bigint;
  /** Unix nanoseconds of the epoch's zero. Excel is special-cased (wall time). */
  originNs: bigint;
  /** Shown as an integer (tick counts) or a decimal. */
  integer: boolean;
}

const NS_PER_DAY = 86_400_000_000_000n;

export const ALT_EPOCHS: AltEpochSpec[] = [
  {
    id: 'filetime',
    label: 'Windows FILETIME / LDAP',
    description: '100-ns intervals since 1601-01-01 UTC (Active Directory lastLogon, pwdLastSet, NTFS times).',
    nsPerUnit: 100n,
    originNs: -11_644_473_600n * 1_000_000_000n,
    integer: true,
  },
  {
    id: 'dotnet',
    label: '.NET DateTime ticks',
    description: '100-ns ticks since 0001-01-01 (DateTime.Ticks, C# and PowerShell).',
    nsPerUnit: 100n,
    originNs: -62_135_596_800n * 1_000_000_000n,
    integer: true,
  },
  {
    id: 'webkit',
    label: 'Chrome / WebKit time',
    description: 'Microseconds since 1601-01-01 UTC (Chrome history and cookie databases).',
    nsPerUnit: 1000n,
    originNs: -11_644_473_600n * 1_000_000_000n,
    integer: true,
  },
  {
    id: 'cocoa',
    label: 'Apple Cocoa / Core Data',
    description: 'Seconds since 2001-01-01 UTC (NSDate reference date, Core Data, iOS databases).',
    nsPerUnit: 1_000_000_000n,
    originNs: 978_307_200n * 1_000_000_000n,
    integer: false,
  },
  {
    id: 'excel',
    label: 'Excel serial date',
    description: 'Days since 1899-12-30 in the 1900 date system, as wall-clock time in the selected zone.',
    nsPerUnit: NS_PER_DAY,
    originNs: 0n,
    integer: false,
  },
  {
    id: 'jd',
    label: 'Julian Day',
    description: 'Days since noon UTC on 24 November 4714 BCE (astronomy).',
    nsPerUnit: NS_PER_DAY,
    originNs: -210_866_760_000n * 1_000_000_000n,
    integer: false,
  },
  {
    id: 'mjd',
    label: 'Modified Julian Date',
    description: 'Days since 1858-11-17 00:00 UTC (Julian Day − 2,400,000.5).',
    nsPerUnit: NS_PER_DAY,
    originNs: -3_506_716_800n * 1_000_000_000n,
    integer: false,
  },
];

const ALT_BY_ID = new Map(ALT_EPOCHS.map((e) => [e.id, e]));

export function altEpochSpec(id: AltEpoch): AltEpochSpec {
  return ALT_BY_ID.get(id)!;
}

/** Largest .NET tick value (9999-12-31T23:59:59.9999999). */
const DOTNET_MAX_TICKS = 3_155_378_975_999_999_999n;
const EXCEL_ORIGIN_MS = utcFromWall({ year: 1899, month: 12, day: 30, hour: 0, minute: 0, second: 0, millisecond: 0 });
const EXCEL_MARCH_1900_MS = utcFromWall({ year: 1900, month: 3, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });
const EXCEL_MAX_MS = utcFromWall({ year: 10000, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });

/** `total / unit` rounded to `digits` decimals, trailing zeros trimmed. */
function formatRatio(total: bigint, unit: bigint, digits: number): string {
  const scale = 10n ** BigInt(digits);
  const neg = total < 0n;
  const abs = neg ? -total : total;
  const scaled = (abs * scale * 2n + unit) / (unit * 2n); // round half up on the magnitude
  const int = scaled / scale;
  const frac = (scaled % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  const text = frac ? `${int}.${frac}` : `${int}`;
  return neg && scaled !== 0n ? `-${text}` : text;
}

/** The instant in another epoch's units; null when that format cannot represent it. */
export function formatAltEpoch(instant: Instant, epoch: AltEpoch, zone = 'UTC'): string | null {
  const spec = altEpochSpec(epoch);
  if (epoch === 'excel') {
    const wall = wallInZone(instant.epochMs, zone);
    const wallMs = utcFromWall(wall);
    if (!Number.isFinite(wallMs) || wallMs < EXCEL_ORIGIN_MS + MS_PER_DAY || wallMs >= EXCEL_MAX_MS) return null;
    // Excel counts the fictional 29 February 1900, so dates before March 1900 are one lower.
    const origin = wallMs < EXCEL_MARCH_1900_MS ? EXCEL_ORIGIN_MS + MS_PER_DAY : EXCEL_ORIGIN_MS;
    const nanos = BigInt(wallMs - origin) * 1_000_000n + BigInt(instant.nanos);
    return formatRatio(nanos, NS_PER_DAY, 8);
  }
  const rel = toTotalNanos(instant) - spec.originNs;
  if (spec.integer) {
    if (rel < 0n) return null;
    const ticks = rel / spec.nsPerUnit;
    if (epoch === 'dotnet' && ticks > DOTNET_MAX_TICKS) return null;
    return ticks.toString();
  }
  if (spec.nsPerUnit === 1_000_000_000n) return formatScaled(rel, spec.nsPerUnit);
  return formatRatio(rel, spec.nsPerUnit, 8);
}

export interface ParsedAlt {
  instant: Instant;
  notes: string[];
}

/** Read a number in another epoch's units. Excel serials are wall-clock time in `zone`. */
export function parseAltEpoch(text: string, epoch: AltEpoch, zone = 'UTC'): Result<ParsedAlt> {
  const spec = altEpochSpec(epoch);
  const dec = parseDecimal(text);
  if (!dec) return { ok: false, error: `Enter a number for ${spec.label}.` };
  const notes: string[] = [];
  const { total, truncated } = scaleDecimal(dec, spec.nsPerUnit);
  if (truncated) notes.push('Digits finer than one nanosecond were dropped.');
  if (epoch === 'excel') {
    if (total < 0n) return { ok: false, error: 'Excel serial dates cannot be negative (Excel starts at 1900).' };
    const day = total / NS_PER_DAY;
    if (day === 60n) {
      return {
        ok: false,
        error: 'Serial 60 is 29 February 1900, a day that never existed; Excel keeps it for compatibility with Lotus 1-2-3.',
      };
    }
    const originMs = day < 60n ? EXCEL_ORIGIN_MS + MS_PER_DAY : EXCEL_ORIGIN_MS;
    const wallNs = BigInt(originMs) * 1_000_000n + total;
    const wallMs = Number(floorDiv(wallNs, 1_000_000n));
    if (wallMs >= EXCEL_MAX_MS) return { ok: false, error: 'Excel serial dates end at 2958465 (31 December 9999).' };
    const nanos = Number(wallNs - BigInt(wallMs) * 1_000_000n);
    const wall = wallInZone(wallMs, 'UTC');
    const epochMs = resolveWall(wall, zone, notes);
    return { ok: true, value: { instant: { epochMs, nanos }, notes } };
  }
  if (spec.integer && total < 0n) return { ok: false, error: `${spec.label} values cannot be negative.` };
  const instant = fromTotalNanos(total + spec.originNs);
  if (!instant.ok) return instant;
  return { ok: true, value: { instant: instant.value, notes } };
}

// ---------------------------------------------------------------------------
// Text formats
// ---------------------------------------------------------------------------

function fractionDigits(instant: Instant): string {
  const ms = ((instant.epochMs % 1000) + 1000) % 1000;
  const base = String(ms).padStart(3, '0');
  if (!instant.nanos) return base;
  return (base + String(instant.nanos).padStart(6, '0')).replace(/0+$/, '');
}

/** ISO 8601 / RFC 3339 in UTC ("2023-11-14T22:13:20.000Z"), with sub-millisecond digits when present. */
export function formatIsoUtc(instant: Instant): string {
  const w = wallInZone(instant.epochMs, 'UTC');
  return `${formatIsoDate(w)}T${formatClock(w)}.${fractionDigits(instant)}Z`;
}

/** ISO 8601 with the zone's numeric offset ("2023-11-14T17:13:20.000-05:00"). */
export function formatIsoInZone(instant: Instant, zone: string): string {
  const w = wallInZone(instant.epochMs, zone);
  const offset = tzOffsetMs(instant.epochMs, zone);
  return `${formatIsoDate(w)}T${formatClock(w)}.${fractionDigits(instant)}${formatOffset(offset)}`;
}

/** RFC 9557 (Temporal) form: ISO 8601 with offset and the zone name in brackets. */
export function formatRfc9557(instant: Instant, zone: string): string {
  return `${formatIsoInZone(instant, zone)}[${zone}]`;
}

/** RFC 2822 / RFC 5322 date ("Tue, 14 Nov 2023 22:13:20 +0000"). Null for years outside 0–9999. */
export function formatRfc2822(epochMs: number, zone = 'UTC'): string | null {
  const w = wallInZone(epochMs, zone);
  if (w.year < 0 || w.year > 9999) return null;
  const offset = formatOffset(tzOffsetMs(epochMs, zone), '');
  return `${WEEKDAY_SHORT[dayOfWeek(w)]}, ${String(w.day).padStart(2, '0')} ${MONTH_SHORT[w.month - 1]} ${String(w.year).padStart(4, '0')} ${formatClock(w)} ${offset}`;
}

/** HTTP date (RFC 9110 IMF-fixdate, always GMT). Null for years outside 0–9999. */
export function formatHttpDate(epochMs: number): string | null {
  const s = formatRfc2822(epochMs, 'UTC');
  return s ? s.replace(/\+0000$/, 'GMT') : null;
}

/** Long human form in a zone, e.g. "Tuesday, November 14, 2023 at 5:13:20 PM EST". */
export function formatHuman(epochMs: number, zone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long', timeZone: zone }).format(new Date(epochMs));
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
  // unit, length in ms, use while the rounded count is below this
  ['second', 1000, 60],
  ['minute', 60_000, 60],
  ['hour', 3_600_000, 24],
  ['day', MS_PER_DAY, 7],
  ['week', 7 * MS_PER_DAY, 5],
  ['month', 30.436875 * MS_PER_DAY, 12],
  ['year', 365.2425 * MS_PER_DAY, Infinity],
];

/** "3 hours ago", "in 2 days", "now" (rounded to the largest fitting unit). */
export function relativeTime(epochMs: number, nowMs: number, locale = 'en'): string {
  const diff = epochMs - nowMs;
  if (Math.abs(diff) < 1000) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  for (const [unit, size, below] of RELATIVE_UNITS) {
    const count = Math.round(Math.abs(diff) / size);
    if (count < below) return fmt.format(Math.sign(diff) * count, unit);
  }
  return fmt.format(Math.sign(diff) * Math.round(Math.abs(diff) / (365.2425 * MS_PER_DAY)), 'year');
}

/** "2 years, 3 months and 4 days ago": up to `parts` calendar units measured in `zone`. */
export function preciseRelative(epochMs: number, nowMs: number, zone: string, parts = 3): string {
  if (Math.abs(epochMs - nowMs) < 1000) return 'now';
  const d = calendarDiff(Math.min(epochMs, nowMs), Math.max(epochMs, nowMs), zone);
  const units: Array<[number, string]> = [
    [d.years, 'year'],
    [d.months, 'month'],
    [d.days, 'day'],
    [d.hours, 'hour'],
    [d.minutes, 'minute'],
    [d.seconds, 'second'],
  ];
  const first = units.findIndex(([n]) => n > 0);
  const chosen = units
    .slice(first, first + parts)
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`);
  const text = chosen.length > 1 ? `${chosen.slice(0, -1).join(', ')} and ${chosen[chosen.length - 1]}` : chosen[0];
  return epochMs < nowMs ? `${text} ago` : `in ${text}`;
}

// ---------------------------------------------------------------------------
// Parsing free-form date text
// ---------------------------------------------------------------------------

export type InputKind = 'now' | 'epoch' | 'alt' | 'iso' | 'rfc2822' | 'http' | 'ctime' | 'browser';

export type InputUnit = 'auto' | EpochUnit | AltEpoch;

export interface ParsedInput {
  instant: Instant;
  kind: InputKind;
  /** Unit or epoch used, for numeric input. */
  unit?: EpochUnit | AltEpoch;
  unitDetected?: boolean;
  /** True when the text had no offset and was read as wall time in the chosen zone. */
  usedZone?: boolean;
  /** Human notes, e.g. about DST gaps or truncated digits. */
  notes: string[];
}

const MONTH_INDEX: Record<string, number> = Object.fromEntries(MONTH_SHORT.map((m, i) => [m.toLowerCase(), i + 1]));

/** Zone abbreviations RFC 822/2822 defines (US zones and UT/GMT). Others are ambiguous worldwide. */
const RFC_ZONES: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
};

const ISO_EXTENDED =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?(?:\s*\[([^\]]+)\]|\s+([A-Za-z][\w/+-]*))?$/i;
const ISO_BASIC = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|[+-]\d{2}(?:\d{2})?)?$/i;

const MONTHS_RE = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const RFC2822_RE = new RegExp(
  `^(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(\\d{1,2})\\s+(${MONTHS_RE})[a-z]*\\s+(\\d{2,4})\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*([+-]\\d{4}|[a-z]{1,3})?$`,
  'i',
);
/** RFC 850 (obsolete HTTP date): "Sunday, 06-Nov-94 08:49:37 GMT". */
const RFC850_RE = new RegExp(
  `^(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(\\d{1,2})-(${MONTHS_RE})-(\\d{2}|\\d{4})\\s+(\\d{2}):(\\d{2}):(\\d{2})\\s*(GMT|UTC|UT|Z)?$`,
  'i',
);
/** asctime / ctime / Unix `date`: "Sun Nov  6 08:49:37 1994", "Tue Nov 14 22:13:20 UTC 2023". */
const CTIME_RE = new RegExp(
  `^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\\s+(${MONTHS_RE})[a-z]*\\s+(\\d{1,2})\\s+(\\d{1,2}):(\\d{2}):(\\d{2})\\s+(?:([A-Za-z]{1,5}|[+-]\\d{4})\\s+)?(\\d{4})$`,
  'i',
);

function wallOf(y: number, mo: number, d: number, h: number, mi: number, s: number, frac: string): WallTime {
  return {
    year: y,
    month: mo,
    day: d,
    hour: h,
    minute: mi,
    second: s,
    millisecond: Number((frac || '').slice(0, 3).padEnd(3, '0')),
  };
}

function nanosOf(frac: string | undefined): number {
  return Number((frac ?? '').slice(3, 9).padEnd(6, '0'));
}

function resolveWall(wall: WallTime, zone: string, notes: string[]): number {
  const r = zonedToEpoch(wall, zone);
  if (r.status === 'gap') {
    notes.push(
      `That wall time does not exist in ${zone} (clocks jump forward), so it was moved ${Math.round(r.shiftMs / 60000)} minutes later.`,
    );
  } else if (r.status === 'ambiguous') {
    notes.push(`That wall time happens twice in ${zone} (clocks fall back); the earlier occurrence is used.`);
  }
  return r.epochMs;
}

function checkRange(epochMs: number): Result<number> {
  if (!Number.isFinite(epochMs) || epochMs > MAX_EPOCH_MS || epochMs < MIN_EPOCH_MS) return { ok: false, error: RANGE_ERROR };
  return { ok: true, value: epochMs };
}

function parseOffset(text: string): number | null {
  if (/^z$/i.test(text)) return 0;
  const om = /^([+-])(\d{2}):?(\d{2})?$/.exec(text);
  if (!om) return null;
  const hours = Number(om[2]);
  const minutes = Number(om[3] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return (om[1] === '-' ? -1 : 1) * (hours * 60 + minutes) * 60000;
}

function zoneNameError(name: string): string {
  return `Unknown time zone “${name}”. Use an offset such as +05:30 or an IANA zone such as Asia/Kolkata (abbreviations like IST or CST are ambiguous).`;
}

const US_ZONE_NAMES: Record<string, string> = {
  EST: 'US Eastern Standard Time',
  EDT: 'US Eastern Daylight Time',
  CST: 'US Central Standard Time',
  CDT: 'US Central Daylight Time',
  MST: 'US Mountain Standard Time',
  MDT: 'US Mountain Daylight Time',
  PST: 'US Pacific Standard Time',
  PDT: 'US Pacific Daylight Time',
};

type ZoneNameKind =
  | { type: 'utc' }
  | { type: 'iana'; zone: string }
  | { type: 'abbr'; offsetMs: number; name: string }
  | { type: 'unknown' };

/**
 * Classify a zone name written after a date. Browsers also accept ICU's legacy
 * three-letter ids ("BST" is Asia/Dhaka, "IST" is India), which rarely mean what
 * the writer intended, so only Area/Location ids and POSIX ids such as EST5EDT
 * count as IANA zones; the US abbreviations from RFC 822 map to fixed offsets.
 */
function classifyZoneName(name: string): ZoneNameKind {
  if (/^(?:utc|gmt|ut|z|etc\/utc|etc\/gmt|etc\/uct)$/i.test(name)) return { type: 'utc' };
  if ((name.includes('/') || /^[a-z]{3,4}\d{1,2}[a-z]{3,4}$/i.test(name)) && isValidTimeZone(name)) {
    return { type: 'iana', zone: name };
  }
  const upper = name.toUpperCase();
  const hours = RFC_ZONES[upper];
  if (hours !== undefined && US_ZONE_NAMES[upper]) return { type: 'abbr', offsetMs: hours * 3_600_000, name: US_ZONE_NAMES[upper] };
  return { type: 'unknown' };
}

interface IsoParts {
  y: string;
  mo: string;
  d: string;
  h?: string;
  mi?: string;
  s?: string;
  frac?: string;
  offset?: string;
  zoneName?: string;
}

function parseIsoParts(p: IsoParts, zone: string): Result<ParsedInput> {
  const notes: string[] = [];
  if (p.y === '-000000') return { ok: false, error: 'The year −000000 is not valid ISO 8601; write +000000.' };
  let wall = wallOf(Number(p.y), Number(p.mo), Number(p.d), Number(p.h ?? 0), Number(p.mi ?? 0), Number(p.s ?? 0), p.frac ?? '');
  let endOfDay = false;
  if (wall.hour === 24 && wall.minute === 0 && wall.second === 0 && wall.millisecond === 0 && !nanosOf(p.frac)) {
    endOfDay = true;
    wall = { ...wall, hour: 0 };
  }
  if (wall.second === 60) return { ok: false, error: 'Leap seconds (:60) cannot be represented by JavaScript dates.' };
  if (!isValidWall(wall)) return { ok: false, error: 'That date or time does not exist (check the month, day and hour values).' };
  if (endOfDay) {
    wall = { ...wall, ...addDays(wall, 1) };
    notes.push('24:00 means midnight at the end of the day, so it is the start of the next day.');
  }

  let zoneName: string | undefined;
  let offsetMs: number | null = null;
  if (p.offset) {
    offsetMs = parseOffset(p.offset);
    if (offsetMs === null) return { ok: false, error: `The offset ${p.offset} is not valid.` };
  }
  if (p.zoneName) {
    const kind = classifyZoneName(p.zoneName);
    if (kind.type === 'iana') {
      zoneName = kind.zone;
    } else if (kind.type === 'utc') {
      if (offsetMs !== null && offsetMs !== 0) notes.push(`The offset ${p.offset} was used; “${p.zoneName}” was treated as a label.`);
      offsetMs ??= 0;
    } else if (offsetMs === null) {
      // With an explicit offset, a trailing name is only a label (Go prints "+0100 CET").
      if (kind.type === 'unknown') return { ok: false, error: zoneNameError(p.zoneName) };
      offsetMs = kind.offsetMs;
      const hours = kind.offsetMs / 3_600_000;
      notes.push(`${p.zoneName.toUpperCase()} was read as UTC${hours < 0 ? '−' : '+'}${Math.abs(hours)} (${kind.name}).`);
    }
  }

  let epochMs: number;
  let usedZone = false;
  if (offsetMs !== null) {
    epochMs = utcFromWall(wall) - offsetMs;
    // "Z[Zone]" is valid RFC 9557: the instant is exact and the zone is only for display.
    if (zoneName && !/^z$/i.test(p.offset ?? '') && tzOffsetMs(epochMs, zoneName) !== offsetMs) {
      notes.push(`The offset ${p.offset} does not match ${zoneName} at that moment; the offset was used.`);
    }
  } else if (zoneName) {
    epochMs = resolveWall(wall, zoneName, notes);
  } else {
    usedZone = true;
    epochMs = resolveWall(wall, zone, notes);
  }
  const range = checkRange(epochMs);
  if (!range.ok) return range;
  return { ok: true, value: { instant: { epochMs, nanos: nanosOf(p.frac) }, kind: 'iso', usedZone, notes } };
}

function twoDigitYear(text: string): number {
  let year = Number(text);
  if (text.length === 2) year += year < 50 ? 2000 : 1900;
  else if (text.length === 3) year += 1900;
  return year;
}

function weekdayNote(weekday: string | undefined, wall: WallTime, notes: string[]) {
  if (weekday && WEEKDAY_SHORT[dayOfWeek(wall)].toLowerCase() !== weekday.slice(0, 3).toLowerCase()) {
    notes.push(`The weekday does not match: ${formatIsoDate(wall)} is a ${WEEKDAY_SHORT[dayOfWeek(wall)]}.`);
  }
}

function zoneOffset(zoneText: string | undefined, notes: string[], missingNote: string): Result<number> {
  if (!zoneText) {
    notes.push(missingNote);
    return { ok: true, value: 0 };
  }
  if (/^[+-]\d{4}$/.test(zoneText)) {
    const sign = zoneText[0] === '-' ? -1 : 1;
    const hours = Number(zoneText.slice(1, 3));
    const minutes = Number(zoneText.slice(3));
    if (minutes > 59) return { ok: false, error: `The offset ${zoneText} is not valid.` };
    return { ok: true, value: sign * (hours * 60 + minutes) * 60000 };
  }
  const known = RFC_ZONES[zoneText.toUpperCase()];
  if (known === undefined) return { ok: false, error: `Unknown zone “${zoneText}”; use a numeric offset such as +0000.` };
  return { ok: true, value: known * 3_600_000 };
}

function finishFixed(
  wall: WallTime,
  offsetMs: number,
  kind: InputKind,
  notes: string[],
): Result<ParsedInput> {
  if (!isValidWall(wall)) return { ok: false, error: 'That date or time does not exist (check the day and time values).' };
  const range = checkRange(utcFromWall(wall) - offsetMs);
  if (!range.ok) return range;
  return { ok: true, value: { instant: { epochMs: range.value, nanos: 0 }, kind, notes } };
}

function parseRfc2822(m: RegExpExecArray): Result<ParsedInput> {
  const [, weekday, d, mon, yText, h, mi, s, zoneText] = m;
  const wall = wallOf(twoDigitYear(yText), MONTH_INDEX[mon.slice(0, 3).toLowerCase()], Number(d), Number(h), Number(mi), Number(s ?? 0), '');
  const notes: string[] = [];
  const offset = zoneOffset(zoneText, notes, 'No zone was given, so UTC was assumed.');
  if (!offset.ok) return offset;
  if (isValidDate(wall)) weekdayNote(weekday, wall, notes);
  return finishFixed(wall, offset.value, 'rfc2822', notes);
}

function parseRfc850(m: RegExpExecArray): Result<ParsedInput> {
  const [, weekday, d, mon, yText, h, mi, s] = m;
  const wall = wallOf(twoDigitYear(yText), MONTH_INDEX[mon.toLowerCase()], Number(d), Number(h), Number(mi), Number(s), '');
  const notes = ['Read as an RFC 850 HTTP date (always GMT).'];
  if (isValidDate(wall)) weekdayNote(weekday, wall, notes);
  return finishFixed(wall, 0, 'http', notes);
}

function parseCtime(m: RegExpExecArray): Result<ParsedInput> {
  const [, weekday, mon, d, h, mi, s, zoneText, y] = m;
  const wall = wallOf(Number(y), MONTH_INDEX[mon.slice(0, 3).toLowerCase()], Number(d), Number(h), Number(mi), Number(s), '');
  const notes: string[] = [];
  const offset = zoneOffset(zoneText, notes, 'No zone was given (asctime format), so UTC was assumed, as HTTP requires.');
  if (!offset.ok) return offset;
  if (isValidDate(wall)) weekdayNote(weekday, wall, notes);
  return finishFixed(wall, offset.value, 'ctime', notes);
}

/** A note when an 8-digit number also reads as a YYYYMMDD date. */
function yyyymmddNote(text: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(cleanNumber(text));
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (date.year < 1900 || date.year > 2199 || !isValidDate(date)) return null;
  return `If you meant the date ${formatIsoDate(date)} (YYYYMMDD), type it as ${formatIsoDate(date)}.`;
}

/**
 * Parse whatever the user typed: "now", an epoch number, ISO 8601 / RFC 3339
 * (with optional offset, [Zone] or trailing zone name), RFC 2822, RFC 850 or
 * asctime/ctime. Text without an offset is read as wall time in `zone`.
 */
export function parseDateInput(
  text: string,
  options: { zone: string; unit?: InputUnit; now?: number },
): Result<ParsedInput> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Enter a timestamp or a date.' };
  if (/^now$/i.test(trimmed)) {
    return { ok: true, value: { instant: { epochMs: options.now ?? Date.now(), nanos: 0 }, kind: 'now', notes: [] } };
  }
  const unit = options.unit ?? 'auto';
  if (looksNumeric(trimmed)) {
    if (unit !== 'auto' && !(unit in NS_PER)) {
      const alt = parseAltEpoch(trimmed, unit as AltEpoch, options.zone);
      if (!alt.ok) return alt;
      return {
        ok: true,
        value: { instant: alt.value.instant, kind: 'alt', unit, unitDetected: false, usedZone: unit === 'excel', notes: alt.value.notes },
      };
    }
    const parsed = parseEpoch(trimmed, unit as EpochUnit | 'auto');
    if (!parsed.ok) return parsed;
    const notes = parsed.value.truncated ? ['Digits finer than one nanosecond were dropped.'] : [];
    const dateLike = yyyymmddNote(trimmed);
    if (dateLike) notes.push(dateLike);
    return {
      ok: true,
      value: {
        instant: parsed.value.instant,
        kind: 'epoch',
        unit: parsed.value.unit,
        unitDetected: parsed.value.detected,
        notes,
      },
    };
  }
  const iso = ISO_EXTENDED.exec(trimmed);
  if (iso) {
    const [, y, mo, d, h, mi, s, frac, offset, bracket, trailing] = iso;
    return parseIsoParts({ y, mo, d, h, mi, s, frac, offset, zoneName: bracket ?? trailing }, options.zone);
  }
  const basic = ISO_BASIC.exec(trimmed);
  if (basic) {
    const [, y, mo, d, h, mi, s, frac, offset] = basic;
    return parseIsoParts({ y, mo, d, h, mi, s, frac, offset }, options.zone);
  }
  const withoutComment = trimmed.replace(/\s+\([^)]*\)$/, '');
  const rfc = RFC2822_RE.exec(withoutComment);
  if (rfc) return parseRfc2822(rfc);
  const rfc850 = RFC850_RE.exec(withoutComment);
  if (rfc850) return parseRfc850(rfc850);
  const ctime = CTIME_RE.exec(withoutComment.replace(/\s+/g, ' '));
  if (ctime) return parseCtime(ctime);
  // Last resort: the browser's own parser, but only for text that names a month or weekday,
  // because Date.parse accepts surprising inputs ("1" → 2001) in some engines.
  if (new RegExp(`\\b(${MONTHS_RE}|mon|tue|wed|thu|fri|sat|sun)[a-z]*\\b`, 'i').test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) {
      return {
        ok: true,
        value: {
          instant: { epochMs: ms, nanos: 0 },
          kind: 'browser',
          notes: ['Interpreted by the browser’s date parser; without an explicit offset it uses your device’s time zone.'],
        },
      };
    }
  }
  return {
    ok: false,
    error:
      'Could not read that date. Try a Unix timestamp (1700000000), ISO 8601 (2023-11-14T22:13:20Z) or RFC 2822 (Tue, 14 Nov 2023 22:13:20 +0000).',
  };
}

export interface Interpretation {
  unit: EpochUnit | AltEpoch;
  instant: Instant;
}

const ALL_UNITS: Array<EpochUnit | AltEpoch> = ['s', 'ms', 'us', 'ns', ...ALT_EPOCHS.map((e) => e.id)];

/**
 * Other plausible readings of a number (landing in 1980–2099), excluding `current`,
 * to help identify a mystery timestamp.
 */
export function interpretNumber(text: string, zone: string, current?: EpochUnit | AltEpoch): Interpretation[] {
  if (!looksNumeric(text)) return [];
  const out: Interpretation[] = [];
  const lo = Date.UTC(1980, 0, 1);
  const hi = Date.UTC(2100, 0, 1);
  for (const unit of ALL_UNITS) {
    if (unit === current) continue;
    const r = unit in NS_PER ? parseEpoch(text, unit as EpochUnit) : parseAltEpoch(text, unit as AltEpoch, zone);
    if (!r.ok) continue;
    const instant = r.value.instant;
    if (instant.epochMs >= lo && instant.epochMs < hi) out.push({ unit, instant });
  }
  return out;
}
