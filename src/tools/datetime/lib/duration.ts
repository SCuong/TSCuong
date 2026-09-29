/**
 * Duration parsing and formatting: ISO 8601 durations, human text ("1h 30m",
 * "2 days 4 hours"), clock notation (HH:MM:SS) and plain numbers.
 * Durations are held as a (possibly fractional) number of milliseconds.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from './civil';

/** Average Gregorian year (400-year cycle) and month, used only for nominal Y/M units. */
export const MS_PER_YEAR = 365.2425 * MS_PER_DAY;
export const MS_PER_MONTH = MS_PER_YEAR / 12;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

export type DurationUnit = 'ns' | 'us' | 'ms' | 's' | 'min' | 'h' | 'd' | 'w' | 'mo' | 'y';

export const UNIT_MS: Record<DurationUnit, number> = {
  ns: 1e-6,
  us: 1e-3,
  ms: 1,
  s: MS_PER_SECOND,
  min: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
  w: MS_PER_WEEK,
  mo: MS_PER_MONTH,
  y: MS_PER_YEAR,
};

export const UNIT_LABEL: Record<DurationUnit, string> = {
  ns: 'Nanoseconds',
  us: 'Microseconds',
  ms: 'Milliseconds',
  s: 'Seconds',
  min: 'Minutes',
  h: 'Hours',
  d: 'Days',
  w: 'Weeks',
  mo: 'Months (avg.)',
  y: 'Years (avg.)',
};

export type DurationFormat = 'iso' | 'human' | 'clock' | 'timespan' | 'number';

export interface ParsedDuration {
  ms: number;
  format: DurationFormat;
  /** True when years or months were involved, which have no fixed length. */
  nominal: boolean;
  /** How an ambiguous input was read, e.g. "01:30" as minutes and seconds. */
  note?: string;
}

/** Largest duration handled (about 31.7 billion years); beyond this the digits would be meaningless. */
export const MAX_DURATION_MS = 1e21;

export type DurationResult = { ok: true; value: ParsedDuration } | { ok: false; error: string };

const ISO_DURATION =
  /^([+-])?P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;

function num(text: string | undefined): number {
  return text ? Number(text.replace(',', '.')) : 0;
}

/** Parse an ISO 8601 duration such as "P1DT2H", "PT1.5S", "-P2W" or "P1Y2M". */
export function parseIsoDuration(text: string): DurationResult {
  const t = text.trim();
  const m = ISO_DURATION.exec(t);
  if (!m || /^[+-]?P$/i.test(t) || /T$/i.test(t)) {
    return { ok: false, error: 'Not a valid ISO 8601 duration. Examples: P1DT2H30M, PT45S, P2W, P1Y2M10D.' };
  }
  const [, sign, y, mo, w, d, h, mi, s] = m;
  const fields = [y, mo, w, d, h, mi, s];
  const fractional = fields.map((f, i) => (f && /[.,]/.test(f) ? i : -1)).filter((i) => i >= 0);
  const lastPresent = fields.reduce((last, f, i) => (f ? i : last), -1);
  if (fractional.length > 1 || (fractional.length === 1 && fractional[0] !== lastPresent)) {
    return { ok: false, error: 'Only the smallest unit of an ISO 8601 duration may have a fraction.' };
  }
  const ms =
    num(y) * MS_PER_YEAR +
    num(mo) * MS_PER_MONTH +
    num(w) * MS_PER_WEEK +
    num(d) * MS_PER_DAY +
    num(h) * MS_PER_HOUR +
    num(mi) * MS_PER_MINUTE +
    num(s) * MS_PER_SECOND;
  return { ok: true, value: { ms: sign === '-' ? -ms : ms, format: 'iso', nominal: Boolean(y || mo) } };
}

const UNIT_ALIASES: Array<[RegExp, DurationUnit]> = [
  [/^(?:ns|nanos?|nanoseconds?)$/, 'ns'],
  [/^(?:us|\u00b5s|\u03bcs|micros?|microseconds?)$/, 'us'],
  [/^(?:ms|millis?|milliseconds?|msecs?)$/, 'ms'],
  [/^(?:s|secs?|seconds?)$/, 's'],
  [/^(?:m|mins?|minutes?)$/, 'min'],
  [/^(?:h|hrs?|hours?)$/, 'h'],
  [/^(?:d|days?)$/, 'd'],
  [/^(?:w|wks?|weeks?)$/, 'w'],
  [/^(?:mo|mos|mon|months?)$/, 'mo'],
  [/^(?:y|yrs?|years?)$/, 'y'],
];

export function unitFromText(text: string): DurationUnit | null {
  const t = text.toLowerCase();
  for (const [re, unit] of UNIT_ALIASES) if (re.test(t)) return unit;
  return null;
}

/** Parse "1h 30m", "2 days, 4 hours and 5 minutes", "1.5h", "-90s", "1d2h". */
export function parseHumanDuration(text: string): DurationResult {
  let t = text.trim().toLowerCase();
  let negative = false;
  if (t.startsWith('-')) {
    negative = true;
    t = t.slice(1).trim();
  } else if (t.startsWith('+')) t = t.slice(1).trim();
  t = t.replace(/\band\b/g, ' ').replace(/,/g, ' ');
  const token = /(\d+(?:\.\d+)?|\.\d+)\s*([a-z\u00b5\u03bc]+)/gy;
  let ms = 0;
  let nominal = false;
  let count = 0;
  let pos = 0;
  const seen = new Set<DurationUnit>();
  while (pos < t.length) {
    while (t[pos] === ' ') pos++;
    if (pos >= t.length) break;
    token.lastIndex = pos;
    const m = token.exec(t);
    if (!m) return { ok: false, error: `Could not read “${t.slice(pos).split(' ')[0]}”. Use amounts with units, like 1h 30m or 2 days 4 hours.` };
    const unit = unitFromText(m[2]);
    if (!unit) return { ok: false, error: `Unknown unit “${m[2]}”. Use ms, s, m, h, d, w, mo or y.` };
    if (seen.has(unit)) return { ok: false, error: `The unit “${m[2]}” appears twice.` };
    seen.add(unit);
    if (unit === 'mo' || unit === 'y') nominal = true;
    ms += Number(m[1]) * UNIT_MS[unit];
    count++;
    pos = token.lastIndex;
  }
  if (count === 0) return { ok: false, error: 'Enter a duration such as 1h 30m.' };
  return { ok: true, value: { ms: negative ? -ms : ms, format: 'human', nominal } };
}

/** Parse clock notation: "HH:MM:SS(.fff)", "MM:SS", or "D:HH:MM:SS"; hours may exceed 24. */
export function parseClockDuration(text: string): DurationResult {
  const t = text.trim();
  const m = /^([+-])?(\d+(?::\d+){1,3})(?:[.,](\d+))?$/.exec(t);
  if (!m) return { ok: false, error: 'Use HH:MM:SS, MM:SS or D:HH:MM:SS.' };
  const parts = m[2].split(':').map(Number);
  const units = [MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND].slice(4 - parts.length);
  for (let i = 1; i < parts.length; i++) {
    const limit = units[i] === MS_PER_HOUR ? 23 : 59;
    if (parts[i] > limit) {
      return { ok: false, error: `${parts[i]} is out of range in “${t}” (each part after the first must be at most ${limit}).` };
    }
  }
  let ms = parts.reduce((sum, p, i) => sum + p * units[i], 0);
  if (m[3]) ms += Number(`0.${m[3]}`) * MS_PER_SECOND;
  const note =
    parts.length === 2
      ? `Read as minutes:seconds (${parts[0]} min ${parts[1]} s). For ${parts[0]} h ${parts[1]} min, type ${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}:00.`
      : undefined;
  return { ok: true, value: { ms: m[1] === '-' ? -ms : ms, format: 'clock', nominal: false, note } };
}

function detectAndParse(t: string, numberUnit: DurationUnit): DurationResult {
  if (/^[+-]?P/i.test(t)) return parseIsoDuration(t);
  // .NET TimeSpan: days.hours:minutes:seconds[.fraction]
  const timespan = /^([+-]?)(\d+)\.(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)$/.exec(t);
  if (timespan) {
    const r = parseClockDuration(`${timespan[1]}${timespan[2]}:${timespan[3]}`);
    return r.ok ? { ok: true, value: { ...r.value, format: 'timespan' } } : r;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) {
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: 'That number is too large.' };
    return { ok: true, value: { ms: n * UNIT_MS[numberUnit], format: 'number', nominal: numberUnit === 'mo' || numberUnit === 'y' } };
  }
  if (/^[+-]?\d+(?::\d+)+(?:[.,]\d+)?$/.test(t)) return parseClockDuration(t);
  return parseHumanDuration(t);
}

/** Detect the notation and parse. A bare number is read in `numberUnit` (seconds by default). */
export function parseDuration(text: string, numberUnit: DurationUnit = 's'): DurationResult {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Enter a duration.' };
  const result = detectAndParse(t, numberUnit);
  if (result.ok && !(Math.abs(result.value.ms) <= MAX_DURATION_MS)) {
    return { ok: false, error: 'That duration is too large to work with (over 30 billion years).' };
  }
  return result;
}

export interface DurationParts {
  negative: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  /** Sub-millisecond remainder in nanoseconds (0–999,999). */
  nanoseconds: number;
}

/**
 * Whole nanoseconds of a duration. Below about 104 days the value is exact to the nanosecond;
 * beyond that a double cannot hold nanoseconds, so it is rounded to whole milliseconds
 * (exact integer arithmetic from there on, so no floating-point crumbs appear).
 */
export function durationNanos(ms: number): bigint {
  const abs = Math.abs(ms);
  const ns = abs * 1e6 <= Number.MAX_SAFE_INTEGER ? BigInt(Math.round(abs * 1e6)) : BigInt(Math.round(abs)) * 1_000_000n;
  return ms < 0 ? -ns : ns;
}

const NS_DAY = 86_400_000_000_000n;
const NS_HOUR = 3_600_000_000_000n;
const NS_MINUTE = 60_000_000_000n;
const NS_SECOND = 1_000_000_000n;
const NS_MS = 1_000_000n;

/** Split into exact-length parts (days are 24 hours; no months or years). */
export function splitDuration(ms: number): DurationParts {
  let ns = durationNanos(ms);
  const negative = ns < 0n;
  if (negative) ns = -ns;
  const take = (size: bigint) => {
    const q = ns / size;
    ns -= q * size;
    return Number(q);
  };
  const days = take(NS_DAY);
  const hours = take(NS_HOUR);
  const minutes = take(NS_MINUTE);
  const seconds = take(NS_SECOND);
  const milliseconds = take(NS_MS);
  return { negative, days, hours, minutes, seconds, milliseconds, nanoseconds: Number(ns) };
}

/** `n / unit` as a decimal with trailing zeros trimmed (unit is a power of ten). */
function ratio(n: bigint, unit: bigint): string {
  const whole = n / unit;
  const frac = (n % unit).toString().padStart(unit.toString().length - 1, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

const GO_MAX_NS = 9_223_372_036_854_775_807n;

/** Go's time.Duration string ("1h30m0s", "1.5s", "300ms", "2µs"); null beyond Go's ±292-year range. */
export function formatGoDuration(ms: number): string | null {
  let ns = durationNanos(ms);
  if (ns > GO_MAX_NS || ns < -GO_MAX_NS - 1n) return null;
  if (ns === 0n) return '0s';
  const sign = ns < 0n ? '-' : '';
  if (ns < 0n) ns = -ns;
  if (ns < 1000n) return `${sign}${ns}ns`;
  if (ns < NS_MS) return `${sign}${ratio(ns, 1000n)}µs`;
  if (ns < NS_SECOND) return `${sign}${ratio(ns, NS_MS)}ms`;
  const hours = ns / NS_HOUR;
  const minutes = (ns % NS_HOUR) / NS_MINUTE;
  const seconds = ratio(ns % NS_MINUTE, NS_SECOND);
  if (hours) return `${sign}${hours}h${minutes}m${seconds}s`;
  if (minutes) return `${sign}${minutes}m${seconds}s`;
  return `${sign}${seconds}s`;
}

function trimNumber(n: number, maxFraction = 6): string {
  return Number(n.toFixed(maxFraction)).toString();
}

/** Normalized ISO 8601 duration using D/H/M/S ("P1DT2H30M", "PT0.5S", "PT0S"). */
export function formatIsoDuration(ms: number): string {
  const p = splitDuration(ms);
  const secFraction = p.milliseconds * 1e6 + p.nanoseconds;
  const seconds = secFraction ? `${p.seconds}.${String(secFraction).padStart(9, '0').replace(/0+$/, '')}` : String(p.seconds);
  let time = '';
  if (p.hours) time += `${p.hours}H`;
  if (p.minutes) time += `${p.minutes}M`;
  if (p.seconds || secFraction) time += `${seconds}S`;
  let out = 'P';
  if (p.days) out += `${p.days}D`;
  if (time) out += `T${time}`;
  if (out === 'P') out = 'PT0S';
  return (p.negative && out !== 'PT0S' ? '-' : '') + out;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** "1 day, 2 hours, 30 minutes" (exact parts, zero parts omitted). */
export function formatHumanDuration(ms: number): string {
  const p = splitDuration(ms);
  const parts: string[] = [];
  if (p.days) parts.push(plural(p.days, 'day'));
  if (p.hours) parts.push(plural(p.hours, 'hour'));
  if (p.minutes) parts.push(plural(p.minutes, 'minute'));
  if (p.seconds) parts.push(plural(p.seconds, 'second'));
  if (p.milliseconds) parts.push(plural(p.milliseconds, 'millisecond'));
  if (p.nanoseconds) {
    const us = p.nanoseconds / 1000;
    parts.push(`${trimNumber(us, 3)} microsecond${us === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return '0 seconds';
  return (p.negative ? '−' : '') + parts.join(', ');
}

/** "1d 2h 30m 5s 250ms". */
export function formatCompactDuration(ms: number): string {
  const p = splitDuration(ms);
  const parts: string[] = [];
  if (p.days) parts.push(`${p.days}d`);
  if (p.hours) parts.push(`${p.hours}h`);
  if (p.minutes) parts.push(`${p.minutes}m`);
  if (p.seconds) parts.push(`${p.seconds}s`);
  if (p.milliseconds) parts.push(`${p.milliseconds}ms`);
  if (p.nanoseconds) parts.push(`${trimNumber(p.nanoseconds / 1000, 3)}\u00b5s`);
  if (parts.length === 0) return '0s';
  return (p.negative ? '-' : '') + parts.join(' ');
}

/** Clock notation with total hours: "26:30:05" (".250" when there are milliseconds). */
export function formatClockDuration(ms: number): string {
  const p = splitDuration(ms);
  const hours = p.days * 24 + p.hours;
  const base = `${String(hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}:${String(p.seconds).padStart(2, '0')}`;
  const frac = p.milliseconds ? `.${String(p.milliseconds).padStart(3, '0')}` : '';
  return (p.negative ? '-' : '') + base + frac;
}

/** "1.02:30:05" (.NET TimeSpan style: days.hours:minutes:seconds). */
export function formatDayClockDuration(ms: number): string {
  const p = splitDuration(ms);
  const clock = `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}:${String(p.seconds).padStart(2, '0')}`;
  const frac = p.milliseconds ? `.${String(p.milliseconds).padStart(3, '0')}` : '';
  return (p.negative ? '-' : '') + (p.days ? `${p.days}.` : '') + clock + frac;
}

/** The duration expressed in one unit, e.g. 5400000 ms → 1.5 in hours. */
export function convertDuration(ms: number, unit: DurationUnit): number {
  return ms / UNIT_MS[unit];
}

/** Readable number with up to `digits` significant decimals and no float noise. */
export function formatUnitValue(value: number, maxFraction = 6): string {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 1e-6) return value.toExponential(4);
  if (Math.abs(value) >= 1e21) return value.toExponential(6);
  const fixed = Number(value.toFixed(maxFraction));
  return fixed.toLocaleString('en-US', { maximumFractionDigits: maxFraction, useGrouping: false });
}
