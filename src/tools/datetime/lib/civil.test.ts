import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addDays,
  addMonths,
  countBusinessDays,
  dayOfWeek,
  dayOfYear,
  daysInMonth,
  epochDay,
  formatIsoDate,
  formatIsoYear,
  formatWallIso,
  fromEpochDay,
  fromIsoWeek,
  isLeapYear,
  isValidDate,
  isoWeek,
  isoWeeksInYear,
  parseWall,
  quarter,
  simpleWeekNumber,
  utcFromWall,
  wallFromUtc,
} from './civil';

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe('leap years and month lengths', () => {
  it('follows the Gregorian rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(0)).toBe(true);
    expect(isLeapYear(-4)).toBe(true);
  });
  it('knows days in month', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2023, 4)).toBe(30);
    expect(daysInMonth(2023, 12)).toBe(31);
  });
  it('validates dates', () => {
    expect(isValidDate(d(2023, 2, 29))).toBe(false);
    expect(isValidDate(d(2024, 2, 29))).toBe(true);
    expect(isValidDate(d(2024, 13, 1))).toBe(false);
    expect(isValidDate(d(2024, 1, 0))).toBe(false);
  });
});

describe('epoch days and weekdays', () => {
  it('round-trips', () => {
    expect(epochDay(d(1970, 1, 1))).toBe(0);
    expect(epochDay(d(1969, 12, 31))).toBe(-1);
    expect(fromEpochDay(19_723)).toEqual(d(2024, 1, 1));
    for (const day of [-800_000, -1, 0, 1, 20_000, 2_000_000]) expect(epochDay(fromEpochDay(day))).toBe(day);
  });
  it('handles years 0–99 without the 1900 mapping', () => {
    const w = { year: 50, month: 6, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 };
    expect(wallFromUtc(utcFromWall(w)).year).toBe(50);
  });
  it('computes weekdays', () => {
    expect(dayOfWeek(d(1970, 1, 1))).toBe(4);
    expect(dayOfWeek(d(2024, 2, 29))).toBe(4);
    expect(dayOfWeek(d(1969, 12, 28))).toBe(0);
  });
});

describe('month arithmetic', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths(d(2024, 1, 31), 1)).toEqual({ date: d(2024, 2, 29), clamped: true });
    expect(addMonths(d(2023, 1, 31), 1)).toEqual({ date: d(2023, 2, 28), clamped: true });
    expect(addMonths(d(2024, 3, 31), -1)).toEqual({ date: d(2024, 2, 29), clamped: true });
    expect(addMonths(d(2024, 2, 29), 12)).toEqual({ date: d(2025, 2, 28), clamped: true });
    expect(addMonths(d(2024, 1, 15), 1)).toEqual({ date: d(2024, 2, 15), clamped: false });
  });
  it('crosses year boundaries in both directions', () => {
    expect(addMonths(d(2024, 11, 5), 3).date).toEqual(d(2025, 2, 5));
    expect(addMonths(d(2024, 1, 5), -1).date).toEqual(d(2023, 12, 5));
    expect(addMonths(d(2024, 1, 5), -25).date).toEqual(d(2021, 12, 5));
  });
});

describe('business days', () => {
  it('adds weekdays only', () => {
    expect(addBusinessDays(d(2024, 5, 3), 1)).toEqual(d(2024, 5, 6)); // Fri → Mon
    expect(addBusinessDays(d(2024, 5, 4), 1)).toEqual(d(2024, 5, 6)); // Sat → Mon
    expect(addBusinessDays(d(2024, 5, 6), 5)).toEqual(d(2024, 5, 13));
    expect(addBusinessDays(d(2024, 5, 3), 10)).toEqual(d(2024, 5, 17));
    expect(addBusinessDays(d(2024, 5, 6), -1)).toEqual(d(2024, 5, 3));
    expect(addBusinessDays(d(2024, 5, 6), 0)).toEqual(d(2024, 5, 6));
  });
  it('matches a naive loop for many starts and lengths', () => {
    for (let start = 0; start < 14; start++) {
      for (const n of [1, 2, 4, 5, 6, 9, 10, 11, 23, 64, -1, -6, -17]) {
        const from = addDays(d(2024, 1, 1), start);
        let cur = epochDay(from);
        let left = Math.abs(n);
        while (left > 0) {
          cur += Math.sign(n);
          const w = ((cur + 4) % 7 + 7) % 7;
          if (w !== 0 && w !== 6) left--;
        }
        expect(addBusinessDays(from, n)).toEqual(fromEpochDay(cur));
      }
    }
  });
  it('rejects fractional business days', () => {
    expect(() => addBusinessDays(d(2024, 1, 1), 1.5)).toThrow(RangeError);
  });
  it('counts weekdays in half-open ranges', () => {
    expect(countBusinessDays(d(2024, 5, 6), d(2024, 5, 13))).toBe(5);
    expect(countBusinessDays(d(2024, 5, 4), d(2024, 5, 6))).toBe(0);
    expect(countBusinessDays(d(2024, 5, 13), d(2024, 5, 6))).toBe(-5);
    expect(countBusinessDays(d(2024, 1, 1), d(2025, 1, 1))).toBe(262);
  });
});

describe('ISO weeks', () => {
  it('handles year boundaries', () => {
    expect(isoWeek(d(2021, 1, 3))).toEqual({ weekYear: 2020, week: 53, weekday: 7 });
    expect(isoWeek(d(2024, 12, 30))).toEqual({ weekYear: 2025, week: 1, weekday: 1 });
    expect(isoWeek(d(2026, 9, 29)).week).toBe(40);
  });
  it('counts weeks per year', () => {
    expect(isoWeeksInYear(2020)).toBe(53);
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2024)).toBe(52);
  });
  it('maps weeks back to dates', () => {
    expect(fromIsoWeek(2025, 1, 1)).toEqual(d(2024, 12, 30));
    expect(fromIsoWeek(2020, 53, 7)).toEqual(d(2021, 1, 3));
  });
  it('computes simple week numbers and day of year', () => {
    expect(simpleWeekNumber(d(2024, 1, 1), 0)).toBe(1);
    expect(simpleWeekNumber(d(2024, 1, 7), 0)).toBe(2); // Sunday starts week 2
    expect(dayOfYear(d(2024, 12, 31))).toBe(366);
    expect(dayOfYear(d(2023, 3, 1))).toBe(60);
    expect(quarter(1)).toBe(1);
    expect(quarter(12)).toBe(4);
  });
});

describe('formatting and parsing', () => {
  it('formats expanded years', () => {
    expect(formatIsoYear(2024)).toBe('2024');
    expect(formatIsoYear(12)).toBe('0012');
    expect(formatIsoYear(-1)).toBe('-000001');
    expect(formatIsoYear(12345)).toBe('+012345');
    expect(formatIsoDate(d(5, 1, 2))).toBe('0005-01-02');
  });
  it('parses plain date-times', () => {
    expect(parseWall('2024-03-10T02:30')).toMatchObject({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 });
    expect(parseWall('2024-03-10 02:30:15.25')).toMatchObject({ second: 15, millisecond: 250 });
    expect(parseWall('+012345-01-01')).toMatchObject({ year: 12345 });
    expect(parseWall('2023-02-30')).toBeNull();
    expect(parseWall('2024-01-01T24:00')).toBeNull();
    expect(parseWall('garbage')).toBeNull();
    expect(parseWall('')).toBeNull();
    expect(parseWall('-000000-01-01')).toBeNull();
  });
  it('formats wall ISO', () => {
    expect(formatWallIso({ year: 2024, month: 1, day: 2, hour: 3, minute: 4, second: 5, millisecond: 0 })).toBe('2024-01-02T03:04:05');
    expect(formatWallIso({ year: 2024, month: 1, day: 2, hour: 3, minute: 4, second: 5, millisecond: 7 })).toBe('2024-01-02T03:04:05.007');
  });
});
