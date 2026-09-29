import { describe, expect, it } from 'vitest';
import { dayOfWeek, wallFromUtc } from './civil';
import {
  CRON_PRESETS,
  cronDayMatches,
  cronMatches,
  cronRuns,
  dayFieldsRule,
  describeCron,
  explainField,
  inspectFields,
  neverRunsReason,
  nextRuns,
  nextWallMatch,
  parseCron,
  setField,
  type CronSchedule,
} from './cron';
import { wallInZone } from './tz';

const from = new Date('2024-01-01T00:00:00Z');
const NY = 'America/New_York';

function schedule(expr: string): CronSchedule {
  const p = parseCron(expr);
  if (!p.ok) throw new Error(p.error);
  return p.schedule;
}

function preview(expr: string, start: string | Date, zone = 'UTC', count = 3) {
  const r = nextRuns(expr, { from: typeof start === 'string' ? new Date(start) : start, zone, count });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function runs(expr: string, zone = 'UTC', count = 3, start: string | Date = from) {
  return preview(expr, start, zone, count).runs.map((r) => new Date(r.epochMs).toISOString());
}

describe('parseCron', () => {
  it('accepts 5 and 6 field expressions and macros', () => {
    expect(parseCron('*/15 * * * *')).toMatchObject({ ok: true, hasSeconds: false });
    expect(parseCron('0 */5 * * * *')).toMatchObject({ ok: true, hasSeconds: true });
    expect(parseCron('  0   9 * *   MON-FRI ')).toMatchObject({ ok: true, normalized: '0 9 * * MON-FRI' });
    expect(parseCron('@daily')).toMatchObject({ ok: true, macro: '@daily', normalized: '0 0 * * *' });
    expect(parseCron('@HOURLY')).toMatchObject({ ok: true, macro: '@hourly' });
  });
  it('explains errors in plain language', () => {
    const cases: Array<[string, RegExp]> = [
      ['', /Enter a cron expression/],
      ['* * *', /found 3/],
      ['0 0 12 * * ? 2024', /Quartz year/],
      ['* * * * * * * *', /Found 8 fields/],
      ['61 * * * *', /Minute field: 61 is out of range \(0–59\)/],
      ['* 24 * * *', /Hour field: 24 is out of range/],
      ['* * 0 * *', /Day of month field: 0 is out of range/],
      ['* * 32 * *', /Day of month field: 32 is out of range/],
      ['* * * 13 *', /Month field: 13 is out of range/],
      ['* * * FOO *', /“FOO” is not a valid value/],
      ['* * * * 8', /Day of week field: 8 is out of range/],
      ['*/0 * * * *', /step .* positive/],
      ['*/61 * * * *', /larger than the field’s range/],
      ['*/x * * * *', /step .* positive/],
      ['1/2/3 * * * *', /more than one/],
      ['1-2-3 * * * *', /not a valid range/],
      ['5-1 * * * *', /goes backwards; write the smaller value first \(1-5\)/],
      ['* * * * FRI-SUN', /use FRI-7/],
      ['1,,2 * * * *', /empty item/],
      ['1, * * * *', /empty item/],
      ['? * * * *', /only allowed in the day/],
      ['* * 15W * *', /W \(nearest weekday\)/],
      ['* * LW * *', /W \(nearest weekday\)/],
      ['* * L-3 * *', /days before the last day/],
      ['* * * * L', /“L” alone/],
      ['* * * * 9L', /weekday followed by L/],
      ['* * * * 9#2', /not a weekday/],
      ['H * * * *', /Jenkins/],
      ['* * * * 1#6', /1–5/],
      ['* * ? * ?', /cannot both/],
      ['@reboot', /no time schedule/],
      ['@every 5m', /robfig/],
      ['@often', /Unknown macro/],
      ['🙂 * * * *', /not a valid value/],
    ];
    for (const [expr, message] of cases) {
      const r = parseCron(expr);
      expect(r.ok, expr).toBe(false);
      if (!r.ok) expect(r.error, expr).toMatch(message);
    }
  });
  it('points at the failing field', () => {
    const r = parseCron('0 25 * * *');
    expect(!r.ok && r.field).toBe('hour');
  });
  it('compiles value sets', () => {
    const s = schedule('5/15 */6 1,15,L JAN-MAR 0,7');
    expect(s.minutes).toEqual([5, 20, 35, 50]);
    expect(s.hours).toEqual([0, 6, 12, 18]);
    expect(s.days[1] && s.days[15] && s.lastDay).toBe(true);
    expect(s.months.slice(1, 5)).toEqual([true, true, true, false]);
    expect(s.weekdays).toEqual([true, false, false, false, false, false, false]);
    expect(s.seconds).toEqual([0]);
    expect(schedule('* * * * 5-7').weekdays).toEqual([true, false, false, false, false, true, true]);
    expect(schedule('* * * * mon-fri').weekdays).toEqual([false, true, true, true, true, true, false]);
    expect(schedule('*/20 * * * * *').seconds).toEqual([0, 20, 40]);
  });
  it('sets the Vixie star flags', () => {
    expect(schedule('0 0 * * 1')).toMatchObject({ dayOfMonthStar: true, dayOfWeekStar: false, wildcardTime: false });
    expect(schedule('0 0 */2 * 1')).toMatchObject({ dayOfMonthStar: true });
    expect(schedule('0 0 ? * 1')).toMatchObject({ dayOfMonthStar: true });
    expect(schedule('*/5 1 * * *').wildcardTime).toBe(true);
    expect(schedule('0 * * * *').wildcardTime).toBe(true);
    expect(schedule('0,30 1-3 * * *').wildcardTime).toBe(false);
  });
});

describe('describeCron', () => {
  it('describes common schedules', () => {
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 9 * * 1-5')).toBe('At 09:00, Monday through Friday');
    expect(describeCron('0 9 * * 1-5', false)).toBe('At 09:00 AM, Monday through Friday');
    expect(describeCron('@weekly')).toMatch(/Sunday/);
    expect(describeCron('0 0 * * 0,7')).toBe('At 00:00, only on Sunday');
    expect(describeCron('0 0 * * SUN,7')).toBe('At 00:00, only on Sunday');
    expect(() => describeCron('bad')).toThrow();
  });
  it('describes every preset', () => {
    for (const preset of CRON_PRESETS) expect(describeCron(preset.expression).length).toBeGreaterThan(3);
  });
  it('explains how the day fields combine', () => {
    const rule = (expr: string) => {
      const p = parseCron(expr);
      if (!p.ok) throw new Error(p.error);
      return dayFieldsRule(p);
    };
    expect(rule('0 0 13 * 5')?.mode).toBe('or');
    expect(rule('0 0 */2 * 1')?.mode).toBe('and');
    expect(rule('0 0 * * 1')).toBeNull();
    expect(rule('0 0 ? * 1')).toBeNull();
  });
});

describe('matching', () => {
  it('matches L, nL and n#k', () => {
    const last = schedule('0 0 L * *');
    expect(cronDayMatches(last, 2024, 2, 29)).toBe(true);
    expect(cronDayMatches(last, 2023, 2, 28)).toBe(true);
    expect(cronDayMatches(last, 2024, 2, 28)).toBe(false);
    const lastFriday = schedule('0 0 * * 5L');
    expect(cronDayMatches(lastFriday, 2024, 1, 26)).toBe(true);
    expect(cronDayMatches(lastFriday, 2024, 1, 19)).toBe(false);
    const secondTuesday = schedule('0 0 * * 2#2');
    expect(cronDayMatches(secondTuesday, 2024, 1, 9)).toBe(true);
    expect(cronDayMatches(secondTuesday, 2024, 1, 2)).toBe(false);
  });
  it('uses OR when both day fields are restricted and AND with a leading star', () => {
    const or = schedule('0 0 13 * 5');
    expect(cronDayMatches(or, 2024, 1, 13)).toBe(true); // Saturday the 13th
    expect(cronDayMatches(or, 2024, 1, 5)).toBe(true); // a Friday
    expect(cronDayMatches(or, 2024, 1, 6)).toBe(false);
    const and = schedule('0 0 */2 * 1');
    expect(cronDayMatches(and, 2024, 1, 1)).toBe(true); // Monday the 1st (odd)
    expect(cronDayMatches(and, 2024, 1, 8)).toBe(false); // Monday the 8th (even)
    expect(cronDayMatches(and, 2024, 1, 3)).toBe(false); // odd, but Wednesday
  });
  it('finds the next wall-clock match', () => {
    const s = schedule('30 9 * * 1-5');
    const after = Date.UTC(2024, 0, 5, 10); // Friday 10:00
    expect(new Date(nextWallMatch(s, after, Infinity)!).toISOString()).toBe('2024-01-08T09:30:00.000Z');
    expect(nextWallMatch(s, after, Date.UTC(2024, 0, 8))).toBeNull();
  });
  it('agrees with a brute-force minute scan in UTC', () => {
    const exprs = [
      '*/7 * * * *',
      '15,45 3-5 * * *',
      '0 12 * * 1,3',
      '0 0 13 * 5',
      '0 0 */2 * 1',
      '5/20 */5 * * *',
      '0 0 L * *',
      '30 6 * 2 1#1,5L',
      '0 18 * * 6,0',
      '10 10 10 * *',
      '0 0 1-7 * 1',
    ];
    const start = Date.UTC(2024, 0, 27, 13, 17);
    const end = start + 40 * 86_400_000;
    for (const expr of exprs) {
      const s = schedule(expr);
      const expected: number[] = [];
      for (let t = start + 60_000 - (start % 60_000); t < end && expected.length < 25; t += 60_000) {
        if (cronMatches(s, wallFromUtc(t))) expected.push(t);
      }
      const got = cronRuns(s, { from: start, zone: 'UTC', count: expected.length }).runs.map((r) => r.epochMs);
      expect(got, expr).toEqual(expected);
    }
  });
  it('agrees with a brute-force scan in a zone away from DST changes', () => {
    const s = schedule('*/20 8-10 * * 1-5');
    const start = Date.UTC(2024, 5, 3); // June: no transitions for months
    const expected: number[] = [];
    for (let t = start + 60_000; expected.length < 30; t += 60_000) {
      if (cronMatches(s, wallInZone(t, 'Asia/Kolkata'))) expected.push(t);
    }
    expect(cronRuns(s, { from: start, zone: 'Asia/Kolkata', count: 30 }).runs.map((r) => r.epochMs)).toEqual(expected);
  });
});

describe('nextRuns', () => {
  it('is deterministic with a fixed start', () => {
    expect(runs('*/15 * * * *')).toEqual(['2024-01-01T00:15:00.000Z', '2024-01-01T00:30:00.000Z', '2024-01-01T00:45:00.000Z']);
    expect(runs('*/20 * * * * *', 'UTC', 2)).toEqual(['2024-01-01T00:00:20.000Z', '2024-01-01T00:00:40.000Z']);
    expect(runs('* * * * * *', 'UTC', 3)).toEqual(['2024-01-01T00:00:01.000Z', '2024-01-01T00:00:02.000Z', '2024-01-01T00:00:03.000Z']);
  });
  it('starts strictly after the given moment', () => {
    expect(runs('* * * * *', 'UTC', 1, '2024-01-01T12:00:00.500Z')).toEqual(['2024-01-01T12:01:00.000Z']);
    expect(runs('0 12 * * *', 'UTC', 1, '2024-01-01T12:00:00.000Z')).toEqual(['2024-01-02T12:00:00.000Z']);
    expect(runs('0 0 1 1 *', 'UTC', 1, '2024-12-31T23:59:59Z')).toEqual(['2025-01-01T00:00:00.000Z']);
  });
  it('evaluates in the chosen time zone', () => {
    expect(runs('0 9 * * 1-5', NY, 2)).toEqual(['2024-01-01T14:00:00.000Z', '2024-01-02T14:00:00.000Z']);
    expect(runs('0 9 * * *', 'Asia/Tokyo', 1)).toEqual(['2024-01-02T00:00:00.000Z']);
    expect(runs('0 9 * * *', 'Asia/Kathmandu', 1)).toEqual(['2024-01-01T03:15:00.000Z']);
  });
  it('handles the last day and nth weekday', () => {
    expect(runs('0 0 L * *', 'UTC', 2)).toEqual(['2024-01-31T00:00:00.000Z', '2024-02-29T00:00:00.000Z']);
    expect(runs('0 10 * * 2#2', 'UTC', 1)).toEqual(['2024-01-09T10:00:00.000Z']);
    expect(runs('0 0 * * 5L', 'UTC', 1)).toEqual(['2024-01-26T00:00:00.000Z']);
  });
  it('uses OR semantics when both day fields are set', () => {
    expect(runs('0 12 15 * 1', 'UTC', 3)).toEqual([
      '2024-01-01T12:00:00.000Z',
      '2024-01-08T12:00:00.000Z',
      '2024-01-15T12:00:00.000Z',
    ]);
  });
  it('finds rare schedules', () => {
    expect(runs('0 0 29 2 *', 'UTC', 2)).toEqual(['2024-02-29T00:00:00.000Z', '2028-02-29T00:00:00.000Z']);
    const fifthMondayOfFebruary = preview('0 0 * 2 1#5', from, 'UTC', 1).runs[0];
    const wall = wallFromUtc(fifthMondayOfFebruary.epochMs);
    expect(wall).toMatchObject({ month: 2, day: 29 });
    expect(dayOfWeek(wall)).toBe(1);
  });
  it('explains schedules that never run', () => {
    const cases: Array<[string, RegExp]> = [
      ['0 0 30 2 *', /Day 30 never occurs in February/],
      ['0 0 31 4,6,9,11 *', /Day 31 never occurs in April, June, September or November/],
      ['0 0 30,31 2 *', /Days 30 and 31 never occur in February/],
    ];
    for (const [expr, message] of cases) {
      const r = nextRuns(expr, { from, zone: 'UTC', count: 3 });
      expect(r.ok, expr).toBe(false);
      if (!r.ok) expect(r.error).toMatch(message);
    }
    expect(neverRunsReason(schedule('0 0 30 1,2 *'))).toBeNull();
    expect(neverRunsReason(schedule('0 0 L 2 *'))).toBeNull();
    // Impossible only through the nth-weekday rule: found by searching, not statically.
    const r = nextRuns('0 0 */20 * 1#2', { from, zone: 'UTC', count: 1 });
    expect(r.ok).toBe(false);
    expect(nextRuns('61 * * * *', { from, zone: 'UTC', count: 1 }).ok).toBe(false);
  });
  it('reports running out of time near the end of the date range', () => {
    const r = cronRuns(schedule('0 0 1 1 *'), { from: 8.64e15 - 400 * 86_400_000, zone: 'UTC', count: 5 });
    expect(r.exhausted).toBe(true);
    expect(r.runs.length).toBeLessThan(5);
  });
  it('caps the number of runs', () => {
    expect(preview('* * * * *', from, 'UTC', 10_000).runs).toHaveLength(500);
  });
});

describe('daylight saving (Vixie/ISC cron rules)', () => {
  it('runs a fixed-time job in skipped time right after clocks spring forward', () => {
    const p = preview('30 2 * * *', '2024-03-09T12:00:00Z', NY, 2);
    expect(p.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual([
      '2024-03-10T07:00:00.000Z', // 03:00 EDT, the moment the clocks jump
      '2024-03-11T06:30:00.000Z',
    ]);
    expect(p.runs[0].dst).toBe('moved');
    expect(p.runs[0].scheduled).toMatchObject({ day: 10, hour: 2, minute: 30 });
    expect(p.runs[1].dst).toBeUndefined();
  });
  it('merges a moved run with a run at the new time', () => {
    expect(runs('0 2,3 * * *', NY, 3, '2024-03-09T12:00:00Z')).toEqual([
      '2024-03-10T07:00:00.000Z',
      '2024-03-11T06:00:00.000Z',
      '2024-03-11T07:00:00.000Z',
    ]);
  });
  it('skips wildcard runs in skipped time', () => {
    const p = preview('*/30 2 * * *', '2024-03-09T12:00:00Z', NY, 2);
    expect(p.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual(['2024-03-11T06:00:00.000Z', '2024-03-11T06:30:00.000Z']);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0]).toMatchObject({ reason: 'wildcard', count: 2, from: { day: 10, hour: 2 }, to: { day: 10, hour: 3 } });
    expect(runs('0 * * * *', NY, 3, '2024-03-10T05:30:00Z')).toEqual([
      '2024-03-10T06:00:00.000Z', // 01:00 EST
      '2024-03-10T07:00:00.000Z', // 03:00 EDT (02:00 never happens)
      '2024-03-10T08:00:00.000Z',
    ]);
  });
  it('runs a fixed-time job once when clocks fall back', () => {
    const p = preview('30 1 * * *', '2024-11-02T12:00:00Z', NY, 2);
    expect(p.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual(['2024-11-03T05:30:00.000Z', '2024-11-04T06:30:00.000Z']);
    expect(p.runs[0].dst).toBe('once');
  });
  it('repeats wildcard runs when clocks fall back', () => {
    const p = preview('*/30 1 * * *', '2024-11-02T12:00:00Z', NY, 5);
    expect(p.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual([
      '2024-11-03T05:00:00.000Z',
      '2024-11-03T05:30:00.000Z',
      '2024-11-03T06:00:00.000Z',
      '2024-11-03T06:30:00.000Z',
      '2024-11-04T06:00:00.000Z',
    ]);
    expect(p.runs.map((r) => r.dst)).toEqual([undefined, undefined, 'repeated', 'repeated', undefined]);
    expect(runs('0 * * * *', NY, 4, '2024-11-03T03:30:00Z')).toEqual([
      '2024-11-03T04:00:00.000Z',
      '2024-11-03T05:00:00.000Z',
      '2024-11-03T06:00:00.000Z',
      '2024-11-03T07:00:00.000Z',
    ]);
  });
  it('knows when the start is already inside the repeated hour', () => {
    const start = '2024-11-03T06:10:00Z'; // 01:10 EST, second pass
    expect(runs('30 1 * * *', NY, 1, start)).toEqual(['2024-11-04T06:30:00.000Z']);
    const p = preview('*/30 1 * * *', start, NY, 1);
    expect(new Date(p.runs[0].epochMs).toISOString()).toBe('2024-11-03T06:30:00.000Z');
    expect(p.runs[0].dst).toBe('repeated');
  });
  it('handles Europe and 30-minute shifts', () => {
    expect(runs('30 2 * * *', 'Europe/Berlin', 2, '2024-03-30T12:00:00Z')).toEqual([
      '2024-03-31T01:00:00.000Z',
      '2024-04-01T00:30:00.000Z',
    ]);
    expect(preview('*/15 2 * * *', '2024-03-30T12:00:00Z', 'Europe/Berlin', 1).skipped[0]).toMatchObject({ count: 4 });
    // Lord Howe Island: +10:30 → +11 on 6 Oct 2024 at 02:00.
    expect(runs('15 2 * * *', 'Australia/Lord_Howe', 2, '2024-10-05T00:00:00Z')).toEqual([
      '2024-10-05T15:30:00.000Z',
      '2024-10-06T15:15:00.000Z',
    ]);
    // Back to +10:30 on 7 Apr 2024 at 02:00: 01:30–01:59 happens twice.
    expect(runs('15 1 * * *', 'Australia/Lord_Howe', 2, '2024-04-06T00:00:00Z')).toEqual([
      '2024-04-06T14:15:00.000Z',
      '2024-04-07T14:45:00.000Z',
    ]);
    const once = preview('45 1 * * *', '2024-04-06T00:00:00Z', 'Australia/Lord_Howe', 2);
    expect(once.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual(['2024-04-06T14:45:00.000Z', '2024-04-07T15:15:00.000Z']);
    expect(once.runs[0].dst).toBe('once');
  });
  it('handles a skipped midnight', () => {
    // Chile moves 00:00 → 01:00 on 8 Sep 2024.
    const p = preview('0 0 * * *', '2024-09-06T00:00:00Z', 'America/Santiago', 4);
    expect(p.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual([
      '2024-09-06T04:00:00.000Z',
      '2024-09-07T04:00:00.000Z',
      '2024-09-08T04:00:00.000Z',
      '2024-09-09T03:00:00.000Z',
    ]);
    expect(p.runs[2].dst).toBe('moved');
    expect(wallInZone(p.runs[2].epochMs, 'America/Santiago')).toMatchObject({ day: 8, hour: 1 });
  });
  it('does not catch up a skipped calendar day', () => {
    // Samoa skipped 30 December 2011 when it crossed the date line.
    const p = preview('0 12 * * *', '2011-12-28T00:00:00Z', 'Pacific/Apia', 4);
    expect(p.runs.map((r) => new Date(r.epochMs).toISOString())).toEqual([
      '2011-12-28T22:00:00.000Z',
      '2011-12-29T22:00:00.000Z',
      '2011-12-30T22:00:00.000Z',
      '2011-12-31T22:00:00.000Z',
    ]);
    expect(p.skipped[0]).toMatchObject({ reason: 'long-gap', count: 1, from: { day: 30 } });
  });
});

describe('field helpers', () => {
  it('explains individual fields', () => {
    expect(explainField('minute', '*')).toBe('Every minute');
    expect(explainField('minute', '*/15')).toBe('Every 15 minutes (0, 15, 30, 45)');
    expect(explainField('minute', '*/5')).toBe('Every 5 minutes');
    expect(explainField('minute', '*/7')).toBe('0, 7, 14, 21, 28, 35, 42, 49, 56');
    expect(explainField('hour', '9-17')).toBe('9–17');
    expect(explainField('dayOfWeek', '1-5')).toBe('Monday–Friday');
    expect(explainField('dayOfWeek', '0,7')).toBe('Sunday');
    expect(explainField('dayOfWeek', '*/2')).toBe('Sunday, Tuesday, Thursday, Saturday');
    expect(explainField('month', 'JAN,APR,JUL,OCT')).toBe('January, April, July, October');
    expect(explainField('month', '*/3')).toBe('January, April, July, October');
    expect(explainField('dayOfMonth', 'L')).toBe('The last day of the month');
    expect(explainField('dayOfMonth', '1,L')).toBe('1; the last day of the month');
    expect(explainField('dayOfWeek', '2#2')).toBe('The second Tuesday of the month');
    expect(explainField('dayOfWeek', '5L')).toBe('The last Friday of the month');
    expect(explainField('dayOfWeek', '?')).toBe('No specific value (any)');
    expect(explainField('hour', '*/5')).toBe('0, 5, 10, 15, 20');
    expect(explainField('hour', '*/6')).toBe('Every 6 hours (0, 6, 12, 18)');
  });
  it('inspects every field independently', () => {
    const fields = inspectFields('*/15 25 * JAN mon-fri');
    expect(fields?.map((f) => [f.key, f.ok])).toEqual([
      ['minute', true],
      ['hour', false],
      ['dayOfMonth', true],
      ['month', true],
      ['dayOfWeek', true],
    ]);
    expect(fields?.[1].text).toMatch(/^25 is out of range/);
    expect(fields?.[4].text).toBe('Monday–Friday');
    expect(inspectFields('@daily')?.map((f) => f.raw)).toEqual(['0', '0', '*', '*', '*']);
    expect(inspectFields('0 */5 * * * *')?.[0]).toMatchObject({ key: 'second', ok: true });
    expect(inspectFields('* * *')).toBeNull();
    expect(inspectFields('@nope')).toBeNull();
    expect(inspectFields('')).toBeNull();
  });
  it('replaces single fields', () => {
    expect(setField('* * * * *', 'hour', '9')).toBe('* 9 * * *');
    expect(setField('0 * * * * *', 'second', '30')).toBe('30 * * * * *');
    expect(setField('* * * * *', 'minute', '')).toBe('* * * * *');
    expect(setField('* *', 'minute', '5')).toBe('* *');
  });
});
