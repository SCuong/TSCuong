/** The Date Difference Calculator's computation: input parsing, calendar vs exact modes, and notes. */
import { addDays, compareDates, datePart, parseWall, toWall, utcFromWall, type WallTime } from './civil';
import { dateDifference, type DateDifference } from './datemath';
import { zoneCity, zonedToEpoch } from './tz';
import { formatSpan } from './zoneconvert';

export type DifferenceMode = 'date' | 'datetime';

export interface DifferenceResult {
  d: DateDifference;
  start: WallTime;
  end: WallTime;
  notes: string[];
}

export type DifferenceOutcome = { ok: true; value: DifferenceResult } | { ok: false; error: string } | null;

/**
 * Compare two input values ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM[:SS]").
 * - `date` mode is pure calendar arithmetic (every day has 24 hours); `includeEnd`
 *   counts the last day too and extends the span by one day.
 * - `datetime` mode resolves each wall time in its zone and reports exact elapsed
 *   time, explaining DST gaps, repeated times and offset changes in between.
 * Returns null while either value is empty.
 */
export function computeDifference(
  mode: DifferenceMode,
  startText: string,
  endText: string,
  options: { startZone?: string; endZone?: string; includeEnd?: boolean } = {},
): DifferenceOutcome {
  if (!startText.trim() || !endText.trim()) return null;
  const start = parseWall(startText);
  const end = parseWall(endText);
  if (!start || !end) return { ok: false, error: 'Enter complete, valid dates (for example, February 30 does not exist).' };
  const notes: string[] = [];

  if (mode === 'date') {
    const a = datePart(start);
    const b = datePart(end);
    const reversed = compareDates(b, a) < 0;
    const from = { epochMs: utcFromWall(toWall(a)), zone: 'UTC' };
    // Including the end date extends the span by a day away from the start…
    const endDay = options.includeEnd ? addDays(b, reversed ? -1 : 1) : b;
    const span = dateDifference(from, { epochMs: utcFromWall(toWall(endDay)), zone: 'UTC' });
    // …while day counts always cover the same set of dates, whichever way round they are.
    const counts = dateDifference(from, { epochMs: utcFromWall(toWall(b)), zone: 'UTC' }, { includeEnd: options.includeEnd });
    const d: DateDifference = {
      ...span,
      calendarDays: counts.calendarDays,
      businessDays: counts.businessDays,
      weekendDays: counts.weekendDays,
    };
    return { ok: true, value: { d, start: toWall(a), end: toWall(b), notes } };
  }

  const startZone = options.startZone ?? 'UTC';
  const endZone = options.endZone ?? startZone;
  const resolve = (wall: WallTime, zone: string, label: string) => {
    const r = zonedToEpoch(wall, zone);
    if (r.status === 'gap') {
      notes.push(`The ${label} time does not exist in ${zoneCity(zone)} (clocks jump forward), so it was moved ${formatSpan(r.shiftMs)} later.`);
    } else if (r.status === 'ambiguous') {
      notes.push(`The ${label} time happens twice in ${zoneCity(zone)} (clocks fall back); the first occurrence is used.`);
    }
    return r.epochMs;
  };
  const d = dateDifference(
    { epochMs: resolve(start, startZone, 'start'), zone: startZone },
    { epochMs: resolve(end, endZone, 'end'), zone: endZone },
  );
  if (endZone !== startZone) {
    notes.push(`The years, months and days are counted on the clock in ${zoneCity(startZone)}; the totals are exact elapsed time.`);
  }
  if (d.offsetShiftMs !== 0) {
    notes.push(
      `A daylight-saving or time-zone change happens in between, so the span is ${formatSpan(d.offsetShiftMs)} ${
        d.offsetShiftMs < 0 ? 'shorter' : 'longer'
      } than the clock times suggest.`,
    );
  }
  return { ok: true, value: { d, start, end, notes } };
}

/** "Monday, January 15, 2024" (with ", 09:30" when `withTime`). */
export function longDate(w: WallTime, withTime: boolean): string {
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(utcFromWall(w)));
  if (!withTime) return date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}, ${pad(w.hour)}:${pad(w.minute)}${w.second ? `:${pad(w.second)}` : ''}`;
}
