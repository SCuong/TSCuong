import { describe, expect, it } from 'vitest';
import { calendarInfo, localeWeekInfo, monthGrid, parseIsoWeek } from './calendarInfo';

describe('calendarInfo', () => {
  it('describes a leap day', () => {
    const info = calendarInfo({ year: 2024, month: 2, day: 29 });
    expect(info).toMatchObject({
      weekdayName: 'Thursday',
      isoWeek: 9,
      isoWeekYear: 2024,
      dayOfYear: 60,
      daysInYear: 366,
      daysLeftInYear: 306,
      quarter: 1,
      dayOfQuarter: 60,
      daysInQuarter: 91,
      leapYear: true,
      daysInMonth: 29,
      weekdayOccurrence: 5,
      isLastWeekdayOccurrence: true,
    });
    expect(info.isoWeekStart).toEqual({ year: 2024, month: 2, day: 26 });
    expect(info.isoWeekEnd).toEqual({ year: 2024, month: 3, day: 3 });
  });
  it('handles ISO week-year boundaries', () => {
    const info = calendarInfo({ year: 2027, month: 1, day: 1 });
    expect(info.isoWeekYear).toBe(2026);
    expect(info.isoWeek).toBe(53);
    expect(info.isoWeeksInYear).toBe(53);
  });
  it('computes local week numbers for Sunday-start weeks', () => {
    expect(calendarInfo({ year: 2024, month: 1, day: 7 }, 0).localWeek).toBe(2);
    expect(calendarInfo({ year: 2024, month: 1, day: 7 }, 1).localWeek).toBe(1);
    expect(calendarInfo({ year: 2024, month: 1, day: 7 }, 7).localWeek).toBe(2);
  });
  it('reports quarter and progress', () => {
    const info = calendarInfo({ year: 2023, month: 12, day: 31 });
    expect(info.quarter).toBe(4);
    expect(info.daysInQuarter).toBe(92);
    expect(info.dayOfQuarter).toBe(92);
    expect(info.yearProgress).toBeCloseTo((364 / 365) * 100);
    expect(calendarInfo({ year: 1900, month: 3, day: 1 }).leapYear).toBe(false);
  });
});

describe('monthGrid', () => {
  it('starts rows on the chosen weekday', () => {
    const monday = monthGrid(2024, 2, 1);
    expect(monday[0].days[0].date).toEqual({ year: 2024, month: 1, day: 29 });
    expect(monday[0].week).toBe(5);
    expect(monday.flatMap((r) => r.days).filter((d) => d.inMonth)).toHaveLength(29);
    const sunday = monthGrid(2024, 2, 0);
    expect(sunday[0].days[0].date).toEqual({ year: 2024, month: 1, day: 28 });
    expect(sunday[0].week).toBe(5); // Jan 28 – Feb 3, 2024 is US week 5
  });
  it('numbers Sunday-start rows across the new year as week 1', () => {
    const january = monthGrid(2027, 1, 0);
    expect(january[0].days[0].date).toEqual({ year: 2026, month: 12, day: 27 });
    expect(january[0].week).toBe(1);
    const december = monthGrid(2026, 12, 0);
    expect(december[december.length - 1].week).toBe(1);
    expect(december[december.length - 2].week).toBe(52);
    // ISO rows keep ISO numbers: 2026 has 53 ISO weeks.
    expect(monthGrid(2026, 12, 1).at(-1)?.week).toBe(53);
  });
  it('covers every month with whole weeks', () => {
    for (let m = 1; m <= 12; m++) {
      const grid = monthGrid(2026, m, 1);
      expect(grid.length).toBeGreaterThanOrEqual(4);
      expect(grid.length).toBeLessThanOrEqual(6);
      for (const row of grid) expect(row.days).toHaveLength(7);
    }
  });
});

describe('helpers', () => {
  it('parses ISO week strings', () => {
    expect(parseIsoWeek('2024-W05')).toEqual({ weekYear: 2024, week: 5, weekday: undefined });
    expect(parseIsoWeek('2020W533')).toEqual({ weekYear: 2020, week: 53, weekday: 3 });
    expect(parseIsoWeek('2024-W53')).toBeNull();
    expect(parseIsoWeek('2024-W00')).toBeNull();
    expect(parseIsoWeek('nope')).toBeNull();
  });
  it('reads locale week info with sane values', () => {
    const us = localeWeekInfo('en-US');
    expect(us.firstDay).toBe(0);
    const de = localeWeekInfo('de-DE');
    expect(de.firstDay).toBe(1);
    expect(localeWeekInfo('not a locale!!').firstDay).toBe(1);
  });
});
