import { describe, expect, it } from 'vitest';
import { daysBetween, formatLocalDateTime, humanizeDuration, isoFromSeconds, relativeTime } from './time';

describe('humanizeDuration', () => {
  it.each([
    [0, 'less than a second'],
    [0.4, 'less than a second'],
    [1, '1 second'],
    [45, '45 seconds'],
    [60, '1 minute'],
    [90, '1 minute 30 seconds'],
    [600, '10 minutes'],
    [3600, '1 hour'],
    [3600 + 5 * 60, '1 hour 5 minutes'],
    [3 * 86400, '3 days'],
    [3 * 86400 + 7200, '3 days 2 hours'],
    [12 * 86400 + 7200, '12 days'],
    [45 * 86400, '1 month 14 days'],
    [400 * 86400, '1 year 1 month'],
    [30 * 365.25 * 86400, '30 years'],
    [-120, '2 minutes'],
  ])('%s s → %s', (seconds, expected) => {
    expect(humanizeDuration(seconds)).toBe(expected);
  });

  it('handles infinity and large numbers', () => {
    expect(humanizeDuration(Infinity)).toBe('forever');
    expect(humanizeDuration(1e12)).toBe('31,688 years');
  });
});

describe('relativeTime', () => {
  it('describes past and future', () => {
    expect(relativeTime(-3 * 86400)).toBe('3 days ago');
    expect(relativeTime(7200)).toBe('in 2 hours');
    expect(relativeTime(0.2)).toBe('just now');
  });
});

describe('dates', () => {
  it('formats NumericDates as ISO without milliseconds', () => {
    expect(isoFromSeconds(0)).toBe('1970-01-01T00:00:00Z');
    expect(isoFromSeconds(1516239022)).toBe('2018-01-18T01:30:22Z');
    expect(isoFromSeconds(1.5)).toBe('1970-01-01T00:00:01.500Z');
    expect(isoFromSeconds(1e20)).toBeNull();
    expect(isoFromSeconds(NaN)).toBeNull();
  });

  it('formats local dates and rejects invalid ones', () => {
    expect(formatLocalDateTime(0)).toMatch(/19(69|70)/);
    expect(formatLocalDateTime(NaN)).toBe('Invalid date');
  });

  it('counts whole days', () => {
    expect(daysBetween(0, 86_400_000 * 2.9)).toBe(2);
    expect(daysBetween(86_400_000 * 2.9, 0)).toBe(-2);
  });
});
