/**
 * Proleptic Gregorian calendar arithmetic on plain (time-zone free) dates and
 * wall-clock times. Everything here is pure and works for any year JavaScript
 * dates support, including years 0–99 and negative (BCE) years.
 */

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** The ECMAScript time value range: ±100,000,000 days around the epoch. */
export const MAX_EPOCH_MS = 8.64e15;
export const MIN_EPOCH_MS = -8.64e15;

export interface PlainDate {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}

export interface WallTime extends PlainDate {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Floor modulo that is always non-negative for a positive divisor. */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** UTC time value for wall-clock fields. Handles years 0–99, which `Date.UTC` would map to 1900–1999. */
export function utcFromWall(w: WallTime): number {
  const d = new Date(0);
  d.setUTCFullYear(w.year, w.month - 1, w.day);
  d.setUTCHours(w.hour, w.minute, w.second, w.millisecond);
  return d.getTime();
}

/** Wall-clock fields of a UTC time value. */
export function wallFromUtc(ms: number): WallTime {
  const d = new Date(ms);
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

export function toWall(date: PlainDate, hour = 0, minute = 0, second = 0, millisecond = 0): WallTime {
  return { year: date.year, month: date.month, day: date.day, hour, minute, second, millisecond };
}

export function datePart(w: PlainDate): PlainDate {
  return { year: w.year, month: w.month, day: w.day };
}

/** Days since 1970-01-01. */
export function epochDay(date: PlainDate): number {
  return Math.round(utcFromWall(toWall(date)) / MS_PER_DAY);
}

export function fromEpochDay(days: number): PlainDate {
  return datePart(wallFromUtc(days * MS_PER_DAY));
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: PlainDate): number {
  return mod(epochDay(date) + 4, 7); // 1970-01-01 was a Thursday
}

/** 1 = Monday … 7 = Sunday. */
export function isoDayOfWeek(date: PlainDate): number {
  return dayOfWeek(date) || 7;
}

export function isWeekend(date: PlainDate): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromEpochDay(epochDay(date) + days);
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return epochDay(a) - epochDay(b);
}

export function isValidDate(date: PlainDate): boolean {
  return (
    Number.isInteger(date.year) &&
    Number.isInteger(date.month) &&
    Number.isInteger(date.day) &&
    date.month >= 1 &&
    date.month <= 12 &&
    date.day >= 1 &&
    date.day <= daysInMonth(date.year, date.month)
  );
}

export function isValidWall(w: WallTime): boolean {
  return (
    isValidDate(w) &&
    [w.hour, w.minute, w.second, w.millisecond].every(Number.isInteger) &&
    w.hour >= 0 &&
    w.hour <= 23 &&
    w.minute >= 0 &&
    w.minute <= 59 &&
    w.second >= 0 &&
    w.second <= 59 &&
    w.millisecond >= 0 &&
    w.millisecond <= 999
  );
}

export interface MonthAddResult {
  date: PlainDate;
  /** True when the target month is shorter and the day was clamped to its last day. */
  clamped: boolean;
}

/** Add calendar months, clamping the day to the end of shorter months (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: PlainDate, months: number): MonthAddResult {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = mod(index, 12) + 1;
  const max = daysInMonth(year, month);
  return { date: { year, month, day: Math.min(date.day, max) }, clamped: date.day > max };
}

/**
 * Add business days (Monday–Friday). Each step moves one calendar day and only
 * weekdays are counted, so starting on a Saturday and adding 1 lands on Monday.
 */
export function addBusinessDays(date: PlainDate, days: number): PlainDate {
  if (!Number.isInteger(days)) throw new RangeError('Business days must be a whole number.');
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  let current = epochDay(date);
  // Skip whole weeks in O(1): every 7 calendar days contain exactly 5 weekdays.
  const weeks = Math.floor(Math.max(0, remaining - 5) / 5);
  current += step * weeks * 7;
  remaining -= weeks * 5;
  while (remaining > 0) {
    current += step;
    const dow = mod(current + 4, 7);
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return fromEpochDay(current);
}

/** Weekdays (Mon–Fri) in the half-open range [start, end). Returns a negative count when end is before start. */
export function countBusinessDays(start: PlainDate, end: PlainDate): number {
  const a = epochDay(start);
  const b = epochDay(end);
  if (b < a) return -countBusinessDays(end, start);
  const total = b - a;
  const weeks = Math.floor(total / 7);
  let count = weeks * 5;
  for (let day = a + weeks * 7; day < b; day++) {
    const dow = mod(day + 4, 7);
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function dayOfYear(date: PlainDate): number {
  return epochDay(date) - epochDay({ year: date.year, month: 1, day: 1 }) + 1;
}

export function quarter(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

/** ISO 8601 week-numbering year and week (weeks start Monday; week 1 contains the year's first Thursday). */
export function isoWeek(date: PlainDate): { weekYear: number; week: number; weekday: number } {
  const weekday = isoDayOfWeek(date);
  const thursday = addDays(date, 4 - weekday);
  const week = Math.floor((dayOfYear(thursday) - 1) / 7) + 1;
  return { weekYear: thursday.year, week, weekday };
}

export function isoWeeksInYear(year: number): 52 | 53 {
  return isoWeek({ year, month: 12, day: 28 }).week === 53 ? 53 : 52;
}

/** The date of the given ISO week and weekday (1 = Monday). */
export function fromIsoWeek(weekYear: number, week: number, weekday = 1): PlainDate {
  const jan4 = { year: weekYear, month: 1, day: 4 };
  const mondayOfWeek1 = addDays(jan4, 1 - isoDayOfWeek(jan4));
  return addDays(mondayOfWeek1, (week - 1) * 7 + (weekday - 1));
}

/**
 * Week number where weeks start on `firstDay` (0 = Sunday … 6 = Saturday) and
 * week 1 is the week containing January 1 (the US/"simple" convention).
 */
export function simpleWeekNumber(date: PlainDate, firstDay = 0): number {
  const jan1 = { year: date.year, month: 1, day: 1 };
  const offset = mod(dayOfWeek(jan1) - firstDay, 7);
  return Math.floor((dayOfYear(date) - 1 + offset) / 7) + 1;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/** ISO 8601 year: 4 digits for 0000–9999, otherwise the expanded ±YYYYYY form. */
export function formatIsoYear(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  return `${year < 0 ? '-' : '+'}${pad(year, 6)}`;
}

export function formatIsoDate(date: PlainDate): string {
  return `${formatIsoYear(date.year)}-${pad(date.month)}-${pad(date.day)}`;
}

export function formatClock(w: Pick<WallTime, 'hour' | 'minute' | 'second' | 'millisecond'>, withMs = false): string {
  const base = `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
  return withMs ? `${base}.${pad(w.millisecond, 3)}` : base;
}

/** "YYYY-MM-DDTHH:MM:SS" (with ".mmm" when non-zero), as used by <input type="datetime-local">. */
export function formatWallIso(w: WallTime, sep = 'T'): string {
  return `${formatIsoDate(w)}${sep}${formatClock(w, w.millisecond !== 0)}`;
}

/**
 * Parse a plain date-time such as "2024-03-10", "2024-03-10T02:30", "2024-03-10 02:30:15.250"
 * (also the expanded "+012345-01-01" year form). Returns null when the text is not such a value
 * or names a date/time that does not exist (e.g. February 30).
 */
export function parseWall(text: string): WallTime | null {
  const m = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?$/.exec(text.trim());
  if (!m) return null;
  if (m[1] === '-000000') return null;
  const w: WallTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
    millisecond: m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0,
  };
  return isValidWall(w) ? w : null;
}
