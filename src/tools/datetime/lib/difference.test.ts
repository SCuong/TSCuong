import { describe, expect, it } from 'vitest';
import { computeDifference, longDate } from './difference';

function ok(r: ReturnType<typeof computeDifference>) {
  if (!r || !r.ok) throw new Error(r ? r.error : 'empty');
  return r.value;
}

const NY = 'America/New_York';

describe('computeDifference (dates)', () => {
  it('returns null while an input is empty', () => {
    expect(computeDifference('date', '', '2024-01-01')).toBeNull();
    expect(computeDifference('date', '2024-01-01', '  ')).toBeNull();
  });
  it('explains invalid input', () => {
    const r = computeDifference('date', '2023-02-30', '2024-01-01');
    expect(r?.ok).toBe(false);
    expect(computeDifference('date', 'garbage', '2024-01-01')?.ok).toBe(false);
  });
  it('counts calendar days, business days and the Y/M/D breakdown', () => {
    const r = ok(computeDifference('date', '2024-01-15', '2025-03-20'));
    expect(r.d.diff).toMatchObject({ years: 1, months: 2, days: 5 });
    expect(r.d.calendarDays).toBe(430);
    expect(r.d.businessDays + r.d.weekendDays).toBe(430);
    expect(r.notes).toEqual([]);
  });
  it('includes the end date consistently in both directions', () => {
    // Monday 6 May to Friday 10 May 2024.
    const forward = ok(computeDifference('date', '2024-05-06', '2024-05-10', { includeEnd: true }));
    expect(forward.d).toMatchObject({ calendarDays: 5, businessDays: 5, weekendDays: 0 });
    expect(forward.d.diff.days).toBe(5);
    const backward = ok(computeDifference('date', '2024-05-10', '2024-05-06', { includeEnd: true }));
    expect(backward.d).toMatchObject({ calendarDays: -5, businessDays: -5, weekendDays: 0 });
    expect(backward.d.diff).toMatchObject({ sign: -1, days: 5 });
    expect(backward.d.totalMs).toBe(-5 * 86_400_000);
    // Saturday to the following Sunday, inclusive: 9 days, 5 of them weekdays.
    const weekend = ok(computeDifference('date', '2024-05-04', '2024-05-12', { includeEnd: true }));
    expect(weekend.d).toMatchObject({ calendarDays: 9, businessDays: 5, weekendDays: 4 });
    const reversedWeekend = ok(computeDifference('date', '2024-05-12', '2024-05-04', { includeEnd: true }));
    expect(reversedWeekend.d).toMatchObject({ calendarDays: -9, businessDays: -5, weekendDays: -4 });
  });
  it('treats the same day as zero, or one day when inclusive', () => {
    expect(ok(computeDifference('date', '2024-02-29', '2024-02-29')).d.calendarDays).toBe(0);
    expect(ok(computeDifference('date', '2024-02-29', '2024-02-29', { includeEnd: true })).d.calendarDays).toBe(1);
  });
  it('ignores time zones and DST in date mode', () => {
    const r = ok(computeDifference('date', '2024-03-09', '2024-03-11', { startZone: NY }));
    expect(r.d.totalMs).toBe(2 * 86_400_000);
    expect(r.d.offsetShiftMs).toBe(0);
  });
  it('handles leap days and far-apart dates', () => {
    expect(ok(computeDifference('date', '2024-02-29', '2028-02-29')).d.diff).toMatchObject({ years: 4, months: 0, days: 0 });
    expect(ok(computeDifference('date', '0001-01-01', '9999-12-31')).d.calendarDays).toBe(3_652_058);
  });
});

describe('computeDifference (dates and times)', () => {
  it('measures exact elapsed time across DST and says so', () => {
    const r = ok(computeDifference('datetime', '2024-03-09T12:00', '2024-03-10T12:00', { startZone: NY }));
    expect(r.d.totalMs).toBe(23 * 3_600_000);
    expect(r.d.diff).toMatchObject({ days: 1, hours: 0 });
    expect(r.notes.join(' ')).toMatch(/1 hour shorter/);
  });
  it('explains skipped and repeated wall times', () => {
    const gap = ok(computeDifference('datetime', '2024-03-10T02:30', '2024-03-11T00:00', { startZone: NY }));
    expect(gap.notes[0]).toMatch(/start time does not exist in New York.*1 hour later/);
    const repeat = ok(computeDifference('datetime', '2024-11-01T00:00', '2024-11-03T01:30', { startZone: NY }));
    expect(repeat.notes[0]).toMatch(/end time happens twice/);
  });
  it('compares times in different zones', () => {
    const r = ok(
      computeDifference('datetime', '2024-01-01T09:00', '2024-01-01T09:00', { startZone: 'Asia/Tokyo', endZone: 'Europe/London' }),
    );
    expect(r.d.totalMs).toBe(9 * 3_600_000);
    expect(r.notes[0]).toMatch(/counted on the clock in Tokyo/);
  });
  it('supports seconds', () => {
    const r = ok(computeDifference('datetime', '2024-01-01T00:00:00', '2024-01-01T00:01:30', { startZone: 'UTC' }));
    expect(r.d.totalMs).toBe(90_000);
    expect(r.d.diff).toMatchObject({ minutes: 1, seconds: 30 });
  });
});

describe('longDate', () => {
  it('formats dates with and without times', () => {
    const w = { year: 2024, month: 1, day: 15, hour: 9, minute: 5, second: 0, millisecond: 0 };
    expect(longDate(w, false)).toBe('Monday, January 15, 2024');
    expect(longDate(w, true)).toBe('Monday, January 15, 2024, 09:05');
    expect(longDate({ ...w, second: 7 }, true)).toBe('Monday, January 15, 2024, 09:05:07');
  });
});
