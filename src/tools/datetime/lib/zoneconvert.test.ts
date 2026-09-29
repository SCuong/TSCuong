import { describe, expect, it } from 'vitest';
import type { WallTime } from './civil';
import { namedAbbreviation, wallInZone } from './tz';
import {
  clockText,
  describeTransition,
  formatOffsetDiff,
  formatSpan,
  periodOf,
  plannerStrip,
  resolveSource,
  shortDate,
  startOfZonedDay,
  zoneView,
} from './zoneconvert';

const H = 3_600_000;
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

describe('zoneView', () => {
  it('describes a zone relative to the source', () => {
    const at = Date.UTC(2024, 0, 15, 23); // 18:00 in New York
    const ref = { wall: wallInZone(at, NY), offsetMs: -5 * H };
    const tokyo = zoneView(at, 'Asia/Tokyo', ref);
    expect(tokyo.wall).toMatchObject({ day: 16, hour: 8 });
    expect(tokyo.dayShift).toBe(1);
    expect(tokyo.offsetDiffMs).toBe(14 * H);
    expect(tokyo.abbreviation).toBeNull(); // en-US says "GMT+9"
    expect(tokyo.dst).toBe(false);
    expect(tokyo.next).toBeNull();
    const la = zoneView(at, 'America/Los_Angeles', ref);
    expect(la).toMatchObject({ dayShift: 0, offsetDiffMs: -3 * H, abbreviation: 'PST', dst: false });
    expect(la.next?.toOffset).toBe(-7 * H);
    const sydney = zoneView(at, 'Australia/Sydney', ref);
    expect(sydney.dst).toBe(true);
    expect(sydney.longName).toMatch(/Australian Eastern Daylight/);
  });
  it('names only real abbreviations', () => {
    expect(namedAbbreviation(Date.UTC(2024, 6, 1), NY)).toBe('EDT');
    expect(namedAbbreviation(Date.UTC(2024, 6, 1), 'UTC')).toBeNull();
    expect(namedAbbreviation(Date.UTC(2024, 6, 1), 'Asia/Ho_Chi_Minh')).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('formats spans and offset differences', () => {
    expect(formatSpan(H)).toBe('1 hour');
    expect(formatSpan(-30 * 60_000)).toBe('30 minutes');
    expect(formatSpan(5.5 * H)).toBe('5 hours 30 minutes');
    expect(formatSpan(24 * H)).toBe('1 day');
    expect(formatOffsetDiff(0)).toBe('same offset');
    expect(formatOffsetDiff(5 * H)).toBe('+5 h');
    expect(formatOffsetDiff(-3.5 * H)).toBe('−3 h 30 min');
    expect(formatOffsetDiff(45 * 60_000)).toBe('+45 min');
  });
  it('formats clocks and dates', () => {
    expect(clockText({ hour: 0, minute: 5 }, true)).toBe('12:05 AM');
    expect(clockText({ hour: 13, minute: 0 }, true)).toBe('1:00 PM');
    expect(clockText({ hour: 13, minute: 0 }, false)).toBe('13:00');
    expect(shortDate(w(2024, 3, 10))).toBe('Sun, Mar 10, 2024');
  });
  it('describes transitions as clocks show them', () => {
    const spring = describeTransition({ epochMs: Date.UTC(2024, 2, 10, 7), fromOffset: -5 * H, toOffset: -4 * H });
    expect(spring).toEqual({ summary: 'Clocks go forward 1 hour', when: 'Sun, Mar 10, 2024 at 02:00, to 03:00' });
    const fall = describeTransition({ epochMs: Date.UTC(2024, 10, 3, 6), fromOffset: -4 * H, toOffset: -5 * H }, true);
    expect(fall).toEqual({ summary: 'Clocks go back 1 hour', when: 'Sun, Nov 3, 2024 at 2:00 AM, to 1:00 AM' });
    // Samoa skipped a whole day in 2011.
    const apia = describeTransition({ epochMs: Date.UTC(2011, 11, 30, 10), fromOffset: -10 * H, toOffset: 14 * H });
    expect(apia.summary).toBe('Clocks go forward 1 day');
    expect(apia.when).toBe('Fri, Dec 30, 2011 at 00:00, to Sat, Dec 31, 2011 00:00');
  });
});

describe('resolveSource', () => {
  it('passes normal times through', () => {
    const r = resolveSource(w(2024, 1, 15, 9), NY, 'default');
    expect(r.status).toBe('ok');
    expect(r.options).toEqual([]);
    expect(r.epochMs).toBe(Date.UTC(2024, 0, 15, 14));
  });
  it('offers both sides of a skipped time', () => {
    const r = resolveSource(w(2024, 3, 10, 2, 30), NY, 'default');
    expect(r.status).toBe('gap');
    expect(wallInZone(r.epochMs, NY)).toMatchObject({ hour: 3, minute: 30 });
    expect(r.transition?.epochMs).toBe(Date.UTC(2024, 2, 10, 7));
    const alt = resolveSource(w(2024, 3, 10, 2, 30), NY, 'alternative');
    expect(wallInZone(alt.epochMs, NY)).toMatchObject({ hour: 1, minute: 30 });
    expect(alt.options.map((o) => o.epochMs)).toEqual([r.epochMs, alt.epochMs]);
  });
  it('offers both occurrences of a repeated time', () => {
    const first = resolveSource(w(2024, 11, 3, 1, 30), NY, 'default');
    const second = resolveSource(w(2024, 11, 3, 1, 30), NY, 'alternative');
    expect(first.status).toBe('ambiguous');
    expect(first.epochMs).toBe(Date.UTC(2024, 10, 3, 5, 30));
    expect(second.epochMs).toBe(Date.UTC(2024, 10, 3, 6, 30));
    expect(second.transition?.epochMs).toBe(Date.UTC(2024, 10, 3, 6));
  });
});

describe('planner strip', () => {
  it('classifies hours', () => {
    expect(periodOf(3)).toBe('night');
    expect(periodOf(7)).toBe('day');
    expect(periodOf(9)).toBe('work');
    expect(periodOf(17)).toBe('work');
    expect(periodOf(18)).toBe('day');
    expect(periodOf(22)).toBe('night');
  });
  it('lays out 24 hours with day breaks', () => {
    const start = startOfZonedDay(Date.UTC(2024, 0, 15, 12), NY);
    expect(start).toBe(Date.UTC(2024, 0, 15, 5));
    const tokyo = plannerStrip(start, 'Asia/Tokyo');
    expect(tokyo).toHaveLength(24);
    expect(tokyo[0].wall).toMatchObject({ day: 15, hour: 14 });
    expect(tokyo.filter((c) => c.newDay).map((c) => c.wall.day)).toEqual([15, 16]);
    const kolkata = plannerStrip(start, 'Asia/Kolkata', 3);
    expect(kolkata.map((c) => [c.wall.hour, c.wall.minute])).toEqual([
      [10, 30],
      [11, 30],
      [12, 30],
    ]);
  });
  it('starts a skipped midnight at the first existing instant', () => {
    // Santiago: 8 Sep 2024 starts at 01:00.
    const start = startOfZonedDay(Date.UTC(2024, 8, 8, 15), 'America/Santiago');
    expect(wallInZone(start, 'America/Santiago')).toMatchObject({ day: 8, hour: 1 });
  });
});
