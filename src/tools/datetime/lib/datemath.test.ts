import { describe, expect, it } from 'vitest';
import type { WallTime } from './civil';
import {
  ZERO_AMOUNTS,
  addToDate,
  calendarDiff,
  dateDifference,
  formatCalendarDiff,
  formatWeeksAndDays,
  joinAnd,
} from './datemath';
import { wallInZone, zonedToEpoch } from './tz';

const NY = 'America/New_York';
const w = (year: number, month: number, day: number, hour = 0, minute = 0): WallTime => ({
  year,
  month,
  day,
  hour,
  minute,
  second: 0,
  millisecond: 0,
});
const at = (wall: WallTime, zone = 'UTC') => zonedToEpoch(wall, zone).epochMs;

describe('calendarDiff', () => {
  it('counts years, months and days', () => {
    expect(calendarDiff(at(w(2020, 1, 15)), at(w(2024, 3, 20, 5, 30)), 'UTC')).toMatchObject({
      sign: 1,
      years: 4,
      months: 2,
      days: 5,
      hours: 5,
      minutes: 30,
    });
  });
  it('clamps month ends like Temporal', () => {
    expect(calendarDiff(at(w(2024, 1, 31)), at(w(2024, 2, 29)), 'UTC')).toMatchObject({ months: 1, days: 0 });
    expect(calendarDiff(at(w(2024, 1, 31)), at(w(2024, 3, 1)), 'UTC')).toMatchObject({ months: 1, days: 1 });
    expect(calendarDiff(at(w(2024, 2, 29)), at(w(2025, 2, 28)), 'UTC')).toMatchObject({ years: 1, months: 0, days: 0 });
  });
  it('reports negative differences as magnitudes with a sign', () => {
    const d = calendarDiff(at(w(2024, 3, 1)), at(w(2024, 1, 1)), 'UTC');
    expect(d).toMatchObject({ sign: -1, months: 2, days: 0 });
    expect(calendarDiff(0, 0, 'UTC').sign).toBe(0);
  });
  it('treats a DST day as one calendar day of 23 hours', () => {
    const start = at(w(2024, 3, 9, 12), NY);
    const end = at(w(2024, 3, 10, 12), NY);
    expect(end - start).toBe(23 * 3_600_000);
    expect(calendarDiff(start, end, NY)).toMatchObject({ days: 1, hours: 0 });
  });
});

describe('dateDifference', () => {
  it('computes totals and business days', () => {
    const r = dateDifference({ epochMs: at(w(2024, 5, 6)), zone: 'UTC' }, { epochMs: at(w(2024, 5, 20)), zone: 'UTC' });
    expect(r.calendarDays).toBe(14);
    expect(r.businessDays).toBe(10);
    expect(r.weekendDays).toBe(4);
    const inclusive = dateDifference(
      { epochMs: at(w(2024, 5, 6)), zone: 'UTC' },
      { epochMs: at(w(2024, 5, 10)), zone: 'UTC' },
      { includeEnd: true },
    );
    expect(inclusive.businessDays).toBe(5);
    expect(inclusive.calendarDays).toBe(5);
  });
  it('counts the same days in both directions', () => {
    const mon = { epochMs: at(w(2024, 5, 6)), zone: 'UTC' };
    const fri = { epochMs: at(w(2024, 5, 10)), zone: 'UTC' };
    expect(dateDifference(fri, mon, { includeEnd: true })).toMatchObject({ calendarDays: -5, businessDays: -5, weekendDays: 0 });
    expect(dateDifference(fri, mon)).toMatchObject({ calendarDays: -4, businessDays: -4 });
    const sun = { epochMs: at(w(2024, 5, 12)), zone: 'UTC' };
    expect(dateDifference(sun, mon, { includeEnd: true })).toMatchObject({ calendarDays: -7, businessDays: -5, weekendDays: -2 });
    const same = dateDifference(mon, mon, { includeEnd: true });
    expect(same).toMatchObject({ calendarDays: 1, businessDays: 1, totalMs: 0 });
  });
  it('reports the daylight-saving shift inside a span', () => {
    const spring = dateDifference(
      { epochMs: at(w(2024, 3, 9, 12), NY), zone: NY },
      { epochMs: at(w(2024, 3, 11, 12), NY), zone: NY },
    );
    expect(spring.offsetShiftMs).toBe(-3_600_000);
    expect(spring.totalMs).toBe(47 * 3_600_000);
    const utc = dateDifference({ epochMs: at(w(2024, 3, 9)), zone: 'UTC' }, { epochMs: at(w(2024, 3, 11)), zone: 'UTC' });
    expect(utc.offsetShiftMs).toBe(0);
  });
  it('compares instants across zones', () => {
    const r = dateDifference(
      { epochMs: at(w(2024, 1, 1, 9), 'Asia/Tokyo'), zone: 'Asia/Tokyo' },
      { epochMs: at(w(2024, 1, 1, 9), 'Europe/London'), zone: 'Europe/London' },
    );
    expect(r.totalMs).toBe(9 * 3_600_000);
    expect(r.diff).toMatchObject({ days: 0, hours: 9 });
  });
});

describe('formatting', () => {
  it('formats calendar differences', () => {
    const d = calendarDiff(at(w(2020, 1, 15)), at(w(2024, 3, 20, 5, 30)), 'UTC');
    expect(formatCalendarDiff(d)).toBe('4 years, 2 months and 5 days');
    expect(formatCalendarDiff(d, true)).toBe('4 years, 2 months, 5 days, 5 hours and 30 minutes');
    expect(formatCalendarDiff(calendarDiff(0, 0, 'UTC'))).toBe('0 days');
    expect(formatCalendarDiff(calendarDiff(0, 0, 'UTC'), true)).toBe('0 seconds');
    expect(formatCalendarDiff(calendarDiff(0, 86_400_000, 'UTC'))).toBe('1 day');
    expect(formatCalendarDiff(calendarDiff(0, 1_000, 'UTC'), true)).toBe('1 second');
  });
  it('formats weeks and days', () => {
    expect(formatWeeksAndDays(430)).toBe('61 weeks and 3 days');
    expect(formatWeeksAndDays(14)).toBe('2 weeks');
    expect(formatWeeksAndDays(6)).toBe('6 days');
    expect(formatWeeksAndDays(1)).toBe('1 day');
    expect(formatWeeksAndDays(7_000)).toBe('1,000 weeks');
  });
  it('joins words', () => {
    expect(joinAnd([])).toBe('');
    expect(joinAnd(['a'])).toBe('a');
    expect(joinAnd(['a', 'b'])).toBe('a and b');
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('addToDate', () => {
  it('clamps and explains month-end', () => {
    const r = addToDate(w(2024, 1, 31, 10), 'UTC', { ...ZERO_AMOUNTS, months: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(wallInZone(r.epochMs, 'UTC')).toMatchObject({ year: 2024, month: 2, day: 29, hour: 10 });
    expect(r.clamped).toBe(true);
    expect(r.steps[0].detail).toMatch(/clamped/);
  });
  it('subtracts', () => {
    const r = addToDate(w(2024, 3, 31), 'UTC', { ...ZERO_AMOUNTS, months: 1, days: 1 }, { direction: -1 });
    expect(r.ok && wallInZone(r.epochMs, 'UTC')).toMatchObject({ month: 2, day: 28 });
  });
  it('keeps wall time for days across DST but not for hours', () => {
    const days = addToDate(w(2024, 3, 9, 12), NY, { ...ZERO_AMOUNTS, days: 1 });
    expect(days.ok && wallInZone(days.epochMs, NY)).toMatchObject({ day: 10, hour: 12 });
    const hours = addToDate(w(2024, 3, 9, 12), NY, { ...ZERO_AMOUNTS, hours: 24 });
    expect(hours.ok && wallInZone(hours.epochMs, NY)).toMatchObject({ day: 10, hour: 13 });
  });
  it('reports a DST gap', () => {
    const r = addToDate(w(2024, 3, 9, 2, 30), NY, { ...ZERO_AMOUNTS, days: 1 });
    expect(r.ok && r.resolution.status).toBe('gap');
    expect(r.ok && wallInZone(r.epochMs, NY)).toMatchObject({ hour: 3, minute: 30 });
  });
  it('adds business days and weeks', () => {
    const r = addToDate(w(2024, 5, 3), 'UTC', { ...ZERO_AMOUNTS, days: 1, weeks: 1 }, { businessDays: true });
    expect(r.ok && wallInZone(r.epochMs, 'UTC')).toMatchObject({ month: 5, day: 13 });
  });
  it('applies fractional days as exact hours', () => {
    const r = addToDate(w(2024, 1, 1), 'UTC', { ...ZERO_AMOUNTS, days: 1.5 });
    expect(r.ok && wallInZone(r.epochMs, 'UTC')).toMatchObject({ day: 2, hour: 12 });
    const back = addToDate(w(2024, 1, 3), 'UTC', { ...ZERO_AMOUNTS, days: 1.5 }, { direction: -1 });
    expect(back.ok && wallInZone(back.epochMs, 'UTC')).toMatchObject({ day: 1, hour: 12 });
  });
  it('rejects invalid amounts and out-of-range results', () => {
    expect(addToDate(w(2024, 1, 1), 'UTC', { ...ZERO_AMOUNTS, months: 1.5 }).ok).toBe(false);
    expect(addToDate(w(2024, 1, 1), 'UTC', { ...ZERO_AMOUNTS, days: Number.NaN }).ok).toBe(false);
    expect(addToDate(w(2024, 1, 1), 'UTC', { ...ZERO_AMOUNTS, years: 300_000 }).ok).toBe(false);
    expect(addToDate(w(2024, 1, 1), 'UTC', { ...ZERO_AMOUNTS, days: 1.5 }, { businessDays: true }).ok).toBe(false);
    expect(addToDate(w(275_000, 1, 1), 'UTC', { ...ZERO_AMOUNTS, years: 1000 }).ok).toBe(false);
  });
  it('returns the start for zero amounts', () => {
    const r = addToDate(w(2024, 6, 1, 8), NY, ZERO_AMOUNTS);
    expect(r.ok && r.steps).toEqual([]);
    expect(r.ok && wallInZone(r.epochMs, NY)).toMatchObject({ hour: 8 });
  });
});
