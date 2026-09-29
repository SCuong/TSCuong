import { describe, expect, it } from 'vitest';
import {
  MS_PER_MONTH,
  MS_PER_YEAR,
  convertDuration,
  formatClockDuration,
  formatCompactDuration,
  formatDayClockDuration,
  formatGoDuration,
  formatHumanDuration,
  formatIsoDuration,
  formatUnitValue,
  durationNanos,
  parseDuration,
  splitDuration,
} from './duration';

const ms = (text: string, unit?: Parameters<typeof parseDuration>[1]) => {
  const r = parseDuration(text, unit);
  if (!r.ok) throw new Error(r.error);
  return r.value.ms;
};

describe('ISO 8601 durations', () => {
  it('parses date and time parts', () => {
    expect(ms('P1DT2H')).toBe(93_600_000);
    expect(ms('PT1H30M')).toBe(5_400_000);
    expect(ms('PT0.5S')).toBe(500);
    expect(ms('PT1,5S')).toBe(1500);
    expect(ms('P2W')).toBe(14 * 86_400_000);
    expect(ms('-P1D')).toBe(-86_400_000);
    expect(ms('pt10m')).toBe(600_000);
  });
  it('treats years and months as nominal averages', () => {
    const r = parseDuration('P1Y2M');
    expect(r.ok && r.value.nominal).toBe(true);
    expect(ms('P1Y2M')).toBeCloseTo(MS_PER_YEAR + 2 * MS_PER_MONTH);
  });
  it('rejects malformed values', () => {
    for (const bad of ['P', 'PT', 'P1DT', 'P1H', 'PT1D', 'P1.5DT2H', 'P1X']) expect(parseDuration(bad).ok).toBe(false);
  });
  it('formats normalized ISO', () => {
    expect(formatIsoDuration(93_600_000)).toBe('P1DT2H');
    expect(formatIsoDuration(0)).toBe('PT0S');
    expect(formatIsoDuration(1500)).toBe('PT1.5S');
    expect(formatIsoDuration(-90_000)).toBe('-PT1M30S');
    expect(formatIsoDuration(0.001)).toBe('PT0.000001S');
  });
});

describe('human and clock notation', () => {
  it('parses unit lists', () => {
    expect(ms('1h 30m')).toBe(5_400_000);
    expect(ms('1h30m')).toBe(5_400_000);
    expect(ms('2 days, 4 hours and 5 minutes')).toBe(2 * 86_400_000 + 4 * 3_600_000 + 300_000);
    expect(ms('1.5h')).toBe(5_400_000);
    expect(ms('-90s')).toBe(-90_000);
    expect(ms('250ms')).toBe(250);
    expect(ms('3 µs')).toBeCloseTo(0.003);
    expect(ms('1 week')).toBe(7 * 86_400_000);
  });
  it('explains mistakes', () => {
    const unknown = parseDuration('5 parsecs');
    expect(!unknown.ok && unknown.error).toMatch(/Unknown unit/);
    const twice = parseDuration('1h 2h');
    expect(!twice.ok && twice.error).toMatch(/twice/);
    expect(parseDuration('').ok).toBe(false);
    expect(parseDuration('🙂').ok).toBe(false);
  });
  it('parses clock notation', () => {
    expect(ms('01:30:00')).toBe(5_400_000);
    expect(ms('90:00')).toBe(5_400_000);
    expect(ms('26:00:00')).toBe(26 * 3_600_000);
    expect(ms('1:02:03:04')).toBe(86_400_000 + 2 * 3_600_000 + 3 * 60_000 + 4000);
    expect(ms('00:00:01.25')).toBe(1250);
    expect(parseDuration('1:75:00').ok).toBe(false);
  });
  it('parses .NET TimeSpan notation', () => {
    const r = parseDuration('1.02:03:04');
    expect(r.ok && r.value).toMatchObject({ ms: 93_784_000, format: 'timespan' });
    expect(ms('-1.02:03:04.5')).toBe(-93_784_500);
    expect(formatDayClockDuration(ms('3.00:00:00'))).toBe('3.00:00:00');
    expect(parseDuration('1.25:00:00').ok).toBe(false);
  });
  it('reads bare numbers in the chosen unit', () => {
    expect(ms('90')).toBe(90_000);
    expect(ms('90', 'min')).toBe(5_400_000);
    expect(ms('1e3', 'ms')).toBe(1000);
  });
});

describe('formatting', () => {
  it('splits without float noise', () => {
    expect(splitDuration(0.1 + 0.2)).toMatchObject({ milliseconds: 0, nanoseconds: 300_000 });
    expect(splitDuration(90_061_001)).toMatchObject({ days: 1, hours: 1, minutes: 1, seconds: 1, milliseconds: 1 });
  });
  it('formats in several styles', () => {
    const d = 93_784_250;
    expect(formatHumanDuration(d)).toBe('1 day, 2 hours, 3 minutes, 4 seconds, 250 milliseconds');
    expect(formatCompactDuration(d)).toBe('1d 2h 3m 4s 250ms');
    expect(formatClockDuration(d)).toBe('26:03:04.250');
    expect(formatDayClockDuration(d)).toBe('1.02:03:04.250');
    expect(formatHumanDuration(0)).toBe('0 seconds');
    expect(formatCompactDuration(-60_000)).toBe('-1m');
  });
  it('converts between units', () => {
    expect(convertDuration(5_400_000, 'h')).toBe(1.5);
    expect(convertDuration(86_400_000, 'w')).toBeCloseTo(1 / 7);
    expect(formatUnitValue(1 / 3)).toBe('0.333333');
    expect(formatUnitValue(1e-9)).toBe('1.0000e-9');
    expect(formatUnitValue(1234567)).toBe('1234567');
  });
  it('handles very large durations without floating-point crumbs', () => {
    const big = ms('100000 y');
    expect(formatIsoDuration(big)).toBe('P36524250D');
    expect(splitDuration(3.15e15)).toMatchObject({ days: 36_458_333, hours: 8, minutes: 0, seconds: 0, milliseconds: 0, nanoseconds: 0 });
    expect(formatIsoDuration(1e17)).toBe('P1157407407DT9H46M40S');
    expect(formatClockDuration(1e17)).toBe('27777777777:46:40');
    expect(splitDuration(-1e17).negative).toBe(true);
    expect(durationNanos(1.5)).toBe(1_500_000n);
    expect(durationNanos(-2e10)).toBe(-20_000_000_000_000_000n);
  });
  it('rejects absurdly large durations', () => {
    const r = parseDuration('P99999999999999999999Y');
    expect(!r.ok && r.error).toMatch(/too large/);
    expect(parseDuration('1e30', 'y').ok).toBe(false);
    expect(parseDuration('1e400').ok).toBe(false);
  });
});

describe('Go durations', () => {
  it('formats like time.Duration.String()', () => {
    expect(formatGoDuration(0)).toBe('0s');
    expect(formatGoDuration(5_400_000)).toBe('1h30m0s');
    expect(formatGoDuration(1500)).toBe('1.5s');
    expect(formatGoDuration(60_000)).toBe('1m0s');
    expect(formatGoDuration(300)).toBe('300ms');
    expect(formatGoDuration(1.5)).toBe('1.5ms');
    expect(formatGoDuration(0.002)).toBe('2µs');
    expect(formatGoDuration(0.000001)).toBe('1ns');
    expect(formatGoDuration(0.000123)).toBe('123ns');
    expect(formatGoDuration(-90_061_001)).toBe('-25h1m1.001s');
    expect(formatGoDuration(ms('300 y'))).toBeNull();
  });
  it('round-trips through the parser', () => {
    for (const text of ['1h30m0s', '1.5s', '300ms', '2µs', '72h3m0.5s']) {
      expect(formatGoDuration(ms(text))).toBe(text);
    }
  });
});

describe('ambiguity notes', () => {
  it('explains two-part clock values', () => {
    const r = parseDuration('01:30');
    expect(r.ok && r.value.ms).toBe(90_000);
    expect(r.ok && r.value.note).toMatch(/minutes:seconds.*01:30:00/);
    const three = parseDuration('01:30:00');
    expect(three.ok && three.value.note).toBeUndefined();
  });
});
