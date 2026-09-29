/**
 * Zoned date arithmetic for the Date Difference and Date Calculator tools.
 * Calendar units (years, months, days) move the wall clock in the time zone;
 * exact units (hours, minutes, seconds) move the instant. This matches how
 * Temporal.ZonedDateTime behaves across daylight-saving changes.
 */
import {
  MONTH_NAMES,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MAX_EPOCH_MS,
  MIN_EPOCH_MS,
  addBusinessDays,
  addDays,
  addMonths,
  compareDates,
  countBusinessDays,
  daysInMonth,
  epochDay,
  formatIsoDate,
  isWeekend,
  datePart,
  utcFromWall,
  type PlainDate,
  type WallTime,
} from './civil';
import { wallInZone, zonedToEpoch, type ZonedResolution } from './tz';

export interface CalendarDiff {
  /** −1 when the end is before the start (the parts are then magnitudes). */
  sign: 1 | -1 | 0;
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface DateDifference {
  diff: CalendarDiff;
  /** Exact elapsed milliseconds (end − start). */
  totalMs: number;
  /**
   * Days between the two calendar dates (as written in their zones): the earlier date is counted,
   * the later one only with `includeEnd`. Negative when the end is before the start.
   */
  calendarDays: number;
  /** Weekdays (Mon–Fri) among those days (same sign convention). */
  businessDays: number;
  weekendDays: number;
  /**
   * Elapsed time minus the wall-clock difference in the start zone: non-zero when a
   * daylight-saving (or other offset) change happens in between, e.g. −3,600,000 when a day has 23 hours.
   */
  offsetShiftMs: number;
}

/**
 * Largest-unit-years difference from `startMs` to `endMs` as seen in `zone`.
 * Whole months are counted with end-of-month clamping (Jan 31 → Feb 29 is one
 * month), then whole days, then the exact remaining time.
 */
export function calendarDiff(startMs: number, endMs: number, zone: string): CalendarDiff {
  if (startMs === endMs) return { sign: 0, years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
  const sign: 1 | -1 = endMs > startMs ? 1 : -1;
  const [aMs, bMs] = sign === 1 ? [startMs, endMs] : [endMs, startMs];
  const a = wallInZone(aMs, zone);
  const b = wallInZone(bMs, zone);
  const at = (date: PlainDate) => zonedToEpoch({ ...a, ...date }, zone).epochMs;

  // Whole months: the largest n with start + n months ≤ end.
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  const monthsFits = (n: number) => at(addMonths(a, n).date) <= bMs;
  while (months > 0 && !monthsFits(months)) months--;
  while (monthsFits(months + 1)) months++;
  const anchor = addMonths(a, months).date;

  // Whole days after that.
  let days = epochDay(b) - epochDay(anchor);
  while (days > 0 && at(addDays(anchor, days)) > bMs) days--;
  while (at(addDays(anchor, days + 1)) <= bMs) days++;

  let rest = bMs - at(addDays(anchor, days));
  const hours = Math.floor(rest / MS_PER_HOUR);
  rest -= hours * MS_PER_HOUR;
  const minutes = Math.floor(rest / MS_PER_MINUTE);
  rest -= minutes * MS_PER_MINUTE;
  const seconds = Math.floor(rest / MS_PER_SECOND);
  rest -= seconds * MS_PER_SECOND;
  return { sign, years: Math.floor(months / 12), months: months % 12, days, hours, minutes, seconds, milliseconds: rest };
}

export function dateDifference(
  start: { epochMs: number; zone: string },
  end: { epochMs: number; zone: string },
  options: { includeEnd?: boolean } = {},
): DateDifference {
  const diff = calendarDiff(start.epochMs, end.epochMs, start.zone);
  const startDate = datePart(wallInZone(start.epochMs, start.zone));
  const endDate = datePart(wallInZone(end.epochMs, end.zone));
  // Count over the ordered range so "inclusive" means the same set of days in both directions.
  const reversed = compareDates(endDate, startDate) < 0;
  const [lo, hi] = reversed ? [endDate, startDate] : [startDate, endDate];
  const upper = options.includeEnd ? addDays(hi, 1) : hi;
  const days = epochDay(upper) - epochDay(lo);
  const business = countBusinessDays(lo, upper);
  const signed = (n: number) => (n === 0 ? 0 : reversed ? -n : n);
  const totalMs = end.epochMs - start.epochMs;
  const wallDelta =
    utcFromWall(wallInZone(end.epochMs, start.zone)) - utcFromWall(wallInZone(start.epochMs, start.zone));
  return {
    diff,
    totalMs,
    calendarDays: signed(days),
    businessDays: signed(business),
    weekendDays: signed(days - business),
    offsetShiftMs: totalMs - wallDelta,
  };
}

// ---------------------------------------------------------------------------
// Adding and subtracting
// ---------------------------------------------------------------------------

export interface DateAmounts {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export const ZERO_AMOUNTS: DateAmounts = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

export interface AddStep {
  label: string;
  detail: string;
}

export type AddResult =
  | {
      ok: true;
      epochMs: number;
      /** Month-end clamping happened, e.g. Jan 31 + 1 month → Feb 29. */
      clamped: boolean;
      resolution: ZonedResolution;
      steps: AddStep[];
    }
  | { ok: false; error: string };

function describeDate(d: PlainDate): string {
  return `${MONTH_NAMES[d.month - 1].slice(0, 3)} ${d.day}, ${d.year}`;
}

/**
 * Add (or with `direction: -1` subtract) amounts to a wall-clock start in `zone`.
 * Order: years and months (with clamping) → weeks and days (optionally business
 * days) → exact hours, minutes and seconds.
 */
export function addToDate(
  start: WallTime,
  zone: string,
  amounts: DateAmounts,
  options: { direction?: 1 | -1; businessDays?: boolean } = {},
): AddResult {
  const dir = options.direction ?? 1;
  const values = Object.values(amounts);
  if (values.some((v) => !Number.isFinite(v))) return { ok: false, error: 'Every amount must be a number.' };
  if (!Number.isInteger(amounts.years) || !Number.isInteger(amounts.months)) {
    return { ok: false, error: 'Years and months must be whole numbers (their length varies).' };
  }
  if (options.businessDays && (!Number.isInteger(amounts.days) || !Number.isInteger(amounts.weeks))) {
    return { ok: false, error: 'Business days must be whole numbers.' };
  }
  if (Math.abs(amounts.years) > 250_000 || Math.abs(amounts.months) > 3_000_000 || Math.abs(amounts.weeks) > 15_000_000 || Math.abs(amounts.days) > 100_000_000) {
    return { ok: false, error: 'That amount goes beyond the range dates support.' };
  }
  const steps: AddStep[] = [];
  let date: PlainDate = datePart(start);
  let clamped = false;
  /** Fractional days (signed), applied as exact 24-hour time. */
  let extraMs = 0;

  const totalMonths = dir * (amounts.years * 12 + amounts.months);
  if (totalMonths) {
    const before = date;
    const r = addMonths(date, totalMonths);
    date = r.date;
    clamped = r.clamped;
    const verb = totalMonths > 0 ? 'Add' : 'Subtract';
    const abs = Math.abs(totalMonths);
    const y = Math.floor(abs / 12);
    const m = abs % 12;
    const amount = [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : '']
      .filter(Boolean)
      .join(' ');
    steps.push({
      label: `${verb} ${amount}`,
      detail: r.clamped
        ? `${describeDate(before)} → ${describeDate(date)}. ${MONTH_NAMES[date.month - 1]} ${date.year} has only ${daysInMonth(date.year, date.month)} days, so day ${before.day} was clamped to the last day of the month.`
        : `${describeDate(before)} → ${describeDate(date)}`,
    });
  }

  if (options.businessDays) {
    const total = dir * (amounts.weeks * 5 + amounts.days);
    if (total) {
      const before = date;
      date = addBusinessDays(date, total);
      const weekendStart = isWeekend(before) ? ' The start falls on a weekend, so counting begins from the next weekday.' : '';
      steps.push({
        label: `${total > 0 ? 'Add' : 'Subtract'} ${Math.abs(total)} business day${Math.abs(total) === 1 ? '' : 's'}`,
        detail: `${describeDate(before)} → ${describeDate(date)}, skipping Saturdays and Sundays${amounts.weeks ? ' (a week counts as 5 business days)' : ''}.${weekendStart}`,
      });
    }
  } else {
    const totalDays = dir * (amounts.weeks * 7 + amounts.days);
    const wholeDays = Math.trunc(totalDays);
    if (wholeDays) {
      const before = date;
      date = addDays(date, wholeDays);
      steps.push({
        label: `${wholeDays > 0 ? 'Add' : 'Subtract'} ${Math.abs(wholeDays)} day${Math.abs(wholeDays) === 1 ? '' : 's'}`,
        detail: `${describeDate(before)} → ${describeDate(date)}`,
      });
    }
    extraMs = (totalDays - wholeDays) * MS_PER_DAY;
  }

  const wall: WallTime = { ...start, ...date };
  if (date.year > 275_759 || date.year < -271_820) return { ok: false, error: 'The result is outside the range dates support.' };
  const resolution = zonedToEpoch(wall, zone);
  if (resolution.status === 'gap') {
    steps.push({
      label: 'Adjust for a daylight-saving gap',
      detail: `${formatIsoDate(date)} ${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')} does not exist in ${zone}; moved forward ${Math.round(resolution.shiftMs / MS_PER_MINUTE)} minutes.`,
    });
  } else if (resolution.status === 'ambiguous') {
    steps.push({
      label: 'Resolve an ambiguous time',
      detail: `That wall time occurs twice in ${zone} (clocks fall back); the earlier one is used.`,
    });
  }

  const exactMs =
    dir * (amounts.hours * MS_PER_HOUR + amounts.minutes * MS_PER_MINUTE + amounts.seconds * MS_PER_SECOND) + extraMs;
  const epochMs = Math.round(resolution.epochMs + exactMs);
  if (exactMs) {
    const abs = Math.abs(exactMs);
    const parts = [
      Math.floor(abs / MS_PER_HOUR) ? `${Math.floor(abs / MS_PER_HOUR)} h` : '',
      Math.floor((abs % MS_PER_HOUR) / MS_PER_MINUTE) ? `${Math.floor((abs % MS_PER_HOUR) / MS_PER_MINUTE)} min` : '',
      (abs % MS_PER_MINUTE) / 1000 ? `${Number(((abs % MS_PER_MINUTE) / 1000).toFixed(3))} s` : '',
    ].filter(Boolean);
    steps.push({
      label: `${exactMs > 0 ? 'Add' : 'Subtract'} ${parts.join(' ')} of elapsed time`,
      detail: extraMs
        ? 'Includes the fractional day, counted as exact 24-hour time.'
        : 'Hours, minutes and seconds are exact elapsed time, so a daylight-saving change in between shifts the wall clock.',
    });
  }
  if (!Number.isFinite(epochMs) || epochMs > MAX_EPOCH_MS || epochMs < MIN_EPOCH_MS) {
    return { ok: false, error: 'The result is outside the range dates support.' };
  }
  return { ok: true, epochMs, clamped, resolution, steps };
}

/** Exact days (24 h) as a decimal, e.g. 1.5. */
export function exactDays(ms: number): number {
  return ms / MS_PER_DAY;
}

/** Join words as "a, b and c". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function unit(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

/** "1 year, 2 months and 5 days" (plus hours, minutes and seconds with `withTime`); zero parts are left out. */
export function formatCalendarDiff(diff: CalendarDiff, withTime = false): string {
  const parts: Array<[number, string]> = [
    [diff.years, 'year'],
    [diff.months, 'month'],
    [diff.days, 'day'],
  ];
  if (withTime) parts.push([diff.hours, 'hour'], [diff.minutes, 'minute'], [diff.seconds, 'second']);
  const text = joinAnd(parts.filter(([n]) => n > 0).map(([n, word]) => unit(n, word)));
  return text || (withTime ? '0 seconds' : '0 days');
}

/** "61 weeks and 3 days" for a (non-negative) number of days. */
export function formatWeeksAndDays(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (!weeks) return unit(rest, 'day');
  return rest ? `${unit(weeks, 'week')} and ${unit(rest, 'day')}` : unit(weeks, 'week');
}
