import { describe, expect, it } from 'vitest';
import { utcFromWall, type WallTime } from './civil';
import {
  dayShift,
  formatOffset,
  formatUtcLabel,
  isDst,
  isValidTimeZone,
  listTimeZones,
  nextTransition,
  observesDst,
  searchZones,
  tzOffsetMs,
  wallInZone,
  zoneAbbreviation,
  zoneCity,
  zonedToEpoch,
} from './tz';

const w = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): WallTime => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
  millisecond: 0,
});
const H = 3_600_000;

describe('zone list', () => {
  it('lists IANA zones with UTC first', () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('America/New_York');
    expect(zones.length).toBeGreaterThan(100);
  });
  it('validates zones', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('offsets', () => {
  it('reads standard and daylight offsets', () => {
    expect(tzOffsetMs(Date.UTC(2024, 0, 15), 'America/New_York')).toBe(-5 * H);
    expect(tzOffsetMs(Date.UTC(2024, 6, 15), 'America/New_York')).toBe(-4 * H);
    expect(tzOffsetMs(Date.UTC(2024, 6, 15), 'Asia/Kolkata')).toBe(5.5 * H);
    expect(tzOffsetMs(Date.UTC(2024, 6, 15), 'Asia/Kathmandu')).toBe(5.75 * H);
    expect(tzOffsetMs(Date.UTC(2024, 0, 15), 'Australia/Sydney')).toBe(11 * H);
    expect(tzOffsetMs(Date.UTC(2024, 0, 15), 'UTC')).toBe(0);
  });
  it('works for pre-1970 instants', () => {
    expect(wallInZone(-1, 'UTC')).toEqual({ ...w(1969, 12, 31, 23, 59, 59), millisecond: 999 });
    expect(tzOffsetMs(Date.UTC(1960, 0, 1), 'Europe/London')).toBe(0);
  });
  it('never throws at or beyond the ends of the Date range', () => {
    expect(tzOffsetMs(8.64e15, 'Pacific/Kiritimati')).toBe(14 * H);
    expect(tzOffsetMs(8.64e15 + 5 * H, 'Pacific/Kiritimati')).toBe(14 * H);
    expect(Number.isFinite(tzOffsetMs(-8.64e15, 'America/New_York'))).toBe(true);
    expect(tzOffsetMs(Number.NaN, 'Asia/Tokyo')).toBe(0);
    expect(wallInZone(8.64e15, 'America/New_York')).toMatchObject({ year: 275760, month: 9, day: 12 });
    expect(Number.isNaN(wallInZone(8.64e15 + H, 'Asia/Tokyo').year)).toBe(true);
    expect(Number.isNaN(wallInZone(Number.NaN, 'Asia/Tokyo').hour)).toBe(true);
    expect(() => zonedToEpoch(w(275760, 9, 13, 5), 'Asia/Tokyo')).not.toThrow();
    expect(() => zonedToEpoch(w(-271821, 4, 20), 'America/Los_Angeles')).not.toThrow();
    expect(zonedToEpoch(w(275760, 9, 12, 20), 'America/New_York').epochMs).toBeLessThanOrEqual(8.64e15);
  });
  it('formats offsets', () => {
    expect(formatOffset(5.5 * H)).toBe('+05:30');
    expect(formatOffset(-8 * H)).toBe('-08:00');
    expect(formatOffset(0, '')).toBe('+0000');
    expect(formatUtcLabel(0)).toBe('UTC');
    expect(formatUtcLabel(5.75 * H)).toBe('UTC+5:45');
    expect(formatUtcLabel(-3 * H)).toBe('UTC−3');
  });
  it('detects DST in both hemispheres', () => {
    expect(isDst(Date.UTC(2024, 6, 1), 'Europe/Berlin')).toBe(true);
    expect(isDst(Date.UTC(2024, 0, 1), 'Europe/Berlin')).toBe(false);
    expect(isDst(Date.UTC(2024, 0, 1), 'Australia/Sydney')).toBe(true);
    expect(isDst(Date.UTC(2024, 6, 1), 'Australia/Sydney')).toBe(false);
    expect(observesDst(Date.UTC(2024, 6, 1), 'Asia/Tokyo')).toBe(false);
    expect(isDst(Date.UTC(2024, 6, 1), 'UTC')).toBe(false);
  });
  it('names zones', () => {
    expect(zoneAbbreviation(Date.UTC(2024, 0, 15), 'America/New_York')).toBe('EST');
    expect(zoneAbbreviation(Date.UTC(2024, 6, 15), 'America/New_York')).toBe('EDT');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });
});

describe('wall time to instant', () => {
  it('resolves normal times', () => {
    const r = zonedToEpoch(w(2024, 1, 15, 9), 'America/New_York');
    expect(r.status).toBe('ok');
    expect(r.epochMs).toBe(Date.UTC(2024, 0, 15, 14));
  });
  it('moves skipped times forward (spring forward gap)', () => {
    const r = zonedToEpoch(w(2024, 3, 10, 2, 30), 'America/New_York');
    expect(r.status).toBe('gap');
    expect(r.shiftMs).toBe(H);
    expect(wallInZone(r.epochMs, 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
    const earlier = zonedToEpoch(w(2024, 3, 10, 2, 30), 'America/New_York', 'earlier');
    expect(wallInZone(earlier.epochMs, 'America/New_York')).toMatchObject({ hour: 1, minute: 30 });
  });
  it('picks the earlier of repeated times (fall back)', () => {
    const r = zonedToEpoch(w(2024, 11, 3, 1, 30), 'America/New_York');
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toEqual([Date.UTC(2024, 10, 3, 5, 30), Date.UTC(2024, 10, 3, 6, 30)]);
    expect(r.epochMs).toBe(Date.UTC(2024, 10, 3, 5, 30));
    expect(zonedToEpoch(w(2024, 11, 3, 1, 30), 'America/New_York', 'later').epochMs).toBe(Date.UTC(2024, 10, 3, 6, 30));
  });
  it('round-trips many instants in zones with odd offsets', () => {
    for (const zone of ['Asia/Kolkata', 'Australia/Lord_Howe', 'Europe/London', 'Pacific/Chatham', 'America/St_Johns']) {
      for (let t = Date.UTC(2023, 0, 1); t < Date.UTC(2024, 0, 1); t += 97 * 3_600_000 + 13_000) {
        const wall = wallInZone(t, zone);
        const r = zonedToEpoch(wall, zone);
        expect(r.status).not.toBe('gap');
        expect(r.candidates).toContain(t);
      }
    }
  });
  it('treats UTC as fixed', () => {
    expect(zonedToEpoch(w(1900, 1, 1), 'UTC').epochMs).toBe(utcFromWall(w(1900, 1, 1)));
  });
});

describe('transitions and helpers', () => {
  it('finds the next DST change to the second', () => {
    const t = nextTransition('America/New_York', Date.UTC(2024, 0, 1));
    expect(t).toEqual({ epochMs: Date.UTC(2024, 2, 10, 7), fromOffset: -5 * H, toOffset: -4 * H });
    expect(nextTransition('Asia/Tokyo', Date.UTC(2024, 0, 1))).toBeNull();
    expect(nextTransition('UTC', 0)).toBeNull();
  });
  it('computes day shifts', () => {
    expect(dayShift(w(2024, 1, 1, 23), w(2024, 1, 2, 1))).toBe(1);
    expect(dayShift(w(2024, 1, 1), w(2023, 12, 31))).toBe(-1);
  });
  it('searches zones by city, id, abbreviation and offset', () => {
    const zones = listTimeZones();
    const at = Date.UTC(2024, 0, 15);
    expect(searchZones('new york', zones, at)[0]).toBe('America/New_York');
    expect(searchZones('tokyo', zones, at)).toContain('Asia/Tokyo');
    expect(searchZones('+5:30', zones, at)).toContain('Asia/Kolkata');
    expect(searchZones('', zones, at, 5)).toHaveLength(5);
    expect(searchZones('zzzz-nothing', zones, at)).toEqual([]);
  });
  it('ranks abbreviations and offsets above substrings', () => {
    const zones = listTimeZones();
    const at = Date.UTC(2024, 0, 15);
    const est = searchZones('est', zones, at);
    expect(est.indexOf('America/New_York')).toBeGreaterThanOrEqual(0);
    expect(est.indexOf('America/New_York')).toBeLessThan(est.indexOf('Europe/Budapest'));
    expect(searchZones('gmt+9', zones, at)).toContain('Asia/Tokyo');
    expect(searchZones('UTC−8', zones, at)).toContain('America/Los_Angeles');
  });
  it('finds zones by country, region and long name', () => {
    const zones = listTimeZones();
    const at = Date.UTC(2024, 0, 15);
    expect(searchZones('india', zones, at)[0]).toBe('Asia/Kolkata');
    expect(searchZones('Pacific time', zones, at)[0]).toBe('America/Los_Angeles');
    expect(searchZones('vietnam', zones, at)[0]).toBe('Asia/Ho_Chi_Minh');
    expect(searchZones('san fran', zones, at)[0]).toBe('America/Los_Angeles');
    expect(searchZones('central european', zones, at)).toContain('Europe/Paris');
  });
});
