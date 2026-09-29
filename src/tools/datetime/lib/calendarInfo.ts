/** Calendar facts about a single date: ISO week, day of year, quarter, leap year and a month grid. */
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  addDays,
  dayOfWeek,
  dayOfYear,
  daysInMonth,
  daysInYear,
  fromIsoWeek,
  isLeapYear,
  isoWeek,
  isoWeeksInYear,
  mod,
  quarter,
  simpleWeekNumber,
  type PlainDate,
} from './civil';

export interface CalendarInfo {
  date: PlainDate;
  weekdayName: string;
  /** 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
  isoWeek: number;
  isoWeekYear: number;
  isoWeeksInYear: 52 | 53;
  isoWeekStart: PlainDate;
  isoWeekEnd: PlainDate;
  /** Week number with weeks starting on `weekStart` and week 1 containing January 1. */
  localWeek: number;
  dayOfYear: number;
  daysInYear: number;
  daysLeftInYear: number;
  quarter: number;
  dayOfQuarter: number;
  daysInQuarter: number;
  leapYear: boolean;
  daysInMonth: number;
  monthName: string;
  /** Which occurrence of this weekday within the month (e.g. 2 = second Tuesday). */
  weekdayOccurrence: number;
  isLastWeekdayOccurrence: boolean;
  /** Percentage of the year elapsed at the start of this day. */
  yearProgress: number;
}

export function calendarInfo(date: PlainDate, weekStart = 1): CalendarInfo {
  const iso = isoWeek(date);
  const doy = dayOfYear(date);
  const diy = daysInYear(date.year);
  const q = quarter(date.month);
  const quarterStart: PlainDate = { year: date.year, month: (q - 1) * 3 + 1, day: 1 };
  const dayOfQuarter = doy - dayOfYear(quarterStart) + 1;
  const daysInQuarter = [0, 1, 2].reduce((sum, i) => sum + daysInMonth(date.year, quarterStart.month + i), 0);
  const dim = daysInMonth(date.year, date.month);
  const occurrence = Math.floor((date.day - 1) / 7) + 1;
  return {
    date,
    weekdayName: WEEKDAY_NAMES[dayOfWeek(date)],
    isoWeekday: iso.weekday,
    isoWeek: iso.week,
    isoWeekYear: iso.weekYear,
    isoWeeksInYear: isoWeeksInYear(iso.weekYear),
    isoWeekStart: fromIsoWeek(iso.weekYear, iso.week, 1),
    isoWeekEnd: fromIsoWeek(iso.weekYear, iso.week, 7),
    localWeek: simpleWeekNumber(date, mod(weekStart, 7)),
    dayOfYear: doy,
    daysInYear: diy,
    daysLeftInYear: diy - doy,
    quarter: q,
    dayOfQuarter,
    daysInQuarter,
    leapYear: isLeapYear(date.year),
    daysInMonth: dim,
    monthName: MONTH_NAMES[date.month - 1],
    weekdayOccurrence: occurrence,
    isLastWeekdayOccurrence: date.day + 7 > dim,
    yearProgress: ((doy - 1) / diy) * 100,
  };
}

export interface MonthGridWeek {
  /**
   * Week number of the row: the ISO week (by its Thursday) when weeks start on Monday; otherwise
   * the "week containing January 1 is week 1" number of its last day (the US convention).
   */
  week: number;
  days: Array<{ date: PlainDate; inMonth: boolean }>;
}

/** Rows of 7 days covering the month, starting on `weekStart` (0 = Sunday, 1 = Monday …). */
export function monthGrid(year: number, month: number, weekStart = 1): MonthGridWeek[] {
  const first: PlainDate = { year, month, day: 1 };
  const lead = mod(dayOfWeek(first) - weekStart, 7);
  let cursor = addDays(first, -lead);
  const weeks: MonthGridWeek[] = [];
  const dim = daysInMonth(year, month);
  const cells = lead + dim;
  const rows = Math.ceil(cells / 7);
  for (let r = 0; r < rows; r++) {
    const days: MonthGridWeek['days'] = [];
    for (let i = 0; i < 7; i++) {
      days.push({ date: cursor, inMonth: cursor.month === month && cursor.year === year });
      cursor = addDays(cursor, 1);
    }
    const week =
      mod(weekStart, 7) === 1
        ? isoWeek(days.find((d) => dayOfWeek(d.date) === 4)!.date).week
        : simpleWeekNumber(days[6].date, mod(weekStart, 7));
    weeks.push({ week, days });
  }
  return weeks;
}

/** Locale week preferences (first day of week, weekend) with a Monday/Sat–Sun fallback. */
export function localeWeekInfo(locale?: string): { firstDay: number; weekend: number[] } {
  try {
    const loc = new Intl.Locale(locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US'));
    const withInfo = loc as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number; weekend: number[] };
      weekInfo?: { firstDay: number; weekend: number[] };
    };
    const info = withInfo.getWeekInfo?.() ?? withInfo.weekInfo;
    if (info && typeof info.firstDay === 'number') {
      // Intl uses 1 = Monday … 7 = Sunday; convert to 0 = Sunday … 6 = Saturday.
      return { firstDay: info.firstDay % 7, weekend: info.weekend.map((d) => d % 7) };
    }
  } catch {
    // fall through
  }
  return { firstDay: 1, weekend: [6, 0] };
}

/** Parse "2024-W05", "2024W05" or "2024-W05-3" to the dates of that ISO week (null when invalid). */
export function parseIsoWeek(text: string): { weekYear: number; week: number; weekday?: number } | null {
  const m = /^(\d{4})-?W(\d{2})(?:-?([1-7]))?$/i.exec(text.trim());
  if (!m) return null;
  const weekYear = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > isoWeeksInYear(weekYear)) return null;
  return { weekYear, week, weekday: m[3] ? Number(m[3]) : undefined };
}
