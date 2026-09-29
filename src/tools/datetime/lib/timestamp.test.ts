import { describe, expect, it } from 'vitest';
import {
  detectEpochUnit,
  formatAltEpoch,
  formatEpoch,
  formatEpochFloor,
  formatHttpDate,
  formatHuman,
  formatIsoInZone,
  formatIsoUtc,
  formatRfc2822,
  formatRfc9557,
  interpretNumber,
  looksNumeric,
  parseAltEpoch,
  parseDateInput,
  parseEpoch,
  preciseRelative,
  relativeTime,
} from './timestamp';

const NY = 'America/New_York';

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('epoch unit detection', () => {
  it('uses magnitude boundaries', () => {
    expect(detectEpochUnit(0)).toBe('s');
    expect(detectEpochUnit(1_700_000_000)).toBe('s');
    expect(detectEpochUnit(99_999_999_999)).toBe('s');
    expect(detectEpochUnit(100_000_000_000)).toBe('ms');
    expect(detectEpochUnit(1_700_000_000_000)).toBe('ms');
    expect(detectEpochUnit(1_700_000_000_000_000)).toBe('us');
    expect(detectEpochUnit(1.7e18)).toBe('ns');
    expect(detectEpochUnit(-1_700_000_000_000)).toBe('ms');
  });
});

describe('parseEpoch', () => {
  it('parses each unit exactly', () => {
    expect(ok(parseEpoch('1700000000')).instant).toEqual({ epochMs: 1_700_000_000_000, nanos: 0 });
    expect(ok(parseEpoch('1700000000123')).instant).toEqual({ epochMs: 1_700_000_000_123, nanos: 0 });
    expect(ok(parseEpoch('1700000000123456')).instant).toEqual({ epochMs: 1_700_000_000_123, nanos: 456_000 });
    // Beyond Number precision: kept exactly via BigInt.
    expect(ok(parseEpoch('1700000000123456789')).instant).toEqual({ epochMs: 1_700_000_000_123, nanos: 456_789 });
  });
  it('honours an explicit unit', () => {
    expect(ok(parseEpoch('1700000000', 'ms')).instant.epochMs).toBe(1_700_000_000);
    expect(ok(parseEpoch('1.5', 's')).instant).toEqual({ epochMs: 1500, nanos: 0 });
    expect(ok(parseEpoch('5', 'ns')).instant).toEqual({ epochMs: 0, nanos: 5 });
  });
  it('handles negative and fractional values with floor semantics', () => {
    expect(ok(parseEpoch('-1')).instant).toEqual({ epochMs: -1000, nanos: 0 });
    expect(ok(parseEpoch('-1.5', 's')).instant).toEqual({ epochMs: -1500, nanos: 0 });
    expect(ok(parseEpoch('-1', 'ns')).instant).toEqual({ epochMs: -1, nanos: 999_999 });
  });
  it('accepts separators and exponents', () => {
    expect(ok(parseEpoch('1_700_000_000')).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseEpoch('1,700,000,000')).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseEpoch('1.7e9')).instant.epochMs).toBe(1_700_000_000_000);
    expect(looksNumeric('1 700 000 000')).toBe(true);
    expect(looksNumeric('12abc')).toBe(false);
  });
  it('flags truncated sub-nanosecond digits', () => {
    expect(ok(parseEpoch('1.0000000001', 's')).truncated).toBe(true);
  });
  it('rejects out-of-range and invalid input', () => {
    expect(parseEpoch('8640000000000001', 'ms').ok).toBe(false);
    expect(parseEpoch('8640000000000000', 'ms').ok).toBe(true);
    expect(parseEpoch('abc').ok).toBe(false);
    expect(parseEpoch('').ok).toBe(false);
    expect(parseEpoch('1e400').ok).toBe(false);
  });
});

describe('formatting', () => {
  const instant = { epochMs: 1_700_000_000_123, nanos: 456_000 };
  it('formats epochs losslessly', () => {
    expect(formatEpoch(instant, 's')).toBe('1700000000.123456');
    expect(formatEpoch(instant, 'ms')).toBe('1700000000123.456');
    expect(formatEpoch(instant, 'us')).toBe('1700000000123456');
    expect(formatEpoch(instant, 'ns')).toBe('1700000000123456000');
    expect(formatEpochFloor(instant, 's')).toBe('1700000000');
    expect(formatEpoch({ epochMs: -1500, nanos: 0 }, 's')).toBe('-1.5');
    expect(formatEpochFloor({ epochMs: -1500, nanos: 0 }, 's')).toBe('-2');
  });
  it('formats ISO 8601', () => {
    expect(formatIsoUtc({ epochMs: 1_700_000_000_000, nanos: 0 })).toBe('2023-11-14T22:13:20.000Z');
    expect(formatIsoUtc(instant)).toBe('2023-11-14T22:13:20.123456Z');
    expect(formatIsoInZone({ epochMs: 1_700_000_000_000, nanos: 0 }, NY)).toBe('2023-11-14T17:13:20.000-05:00');
    expect(formatIsoInZone({ epochMs: 1_700_000_000_000, nanos: 0 }, 'Asia/Kolkata')).toBe('2023-11-15T03:43:20.000+05:30');
    expect(formatIsoUtc({ epochMs: -62_198_755_200_000, nanos: 0 })).toBe('-000001-01-01T00:00:00.000Z');
    expect(formatIsoUtc({ epochMs: 8.64e15, nanos: 0 })).toBe('+275760-09-13T00:00:00.000Z');
  });
  it('formats RFC 2822 and HTTP dates', () => {
    expect(formatRfc2822(1_700_000_000_000)).toBe('Tue, 14 Nov 2023 22:13:20 +0000');
    expect(formatRfc2822(1_700_000_000_000, NY)).toBe('Tue, 14 Nov 2023 17:13:20 -0500');
    expect(formatHttpDate(1_700_000_000_000)).toBe('Tue, 14 Nov 2023 22:13:20 GMT');
    expect(formatRfc2822(8.64e15)).toBeNull();
  });
  it('formats human and relative forms', () => {
    expect(formatHuman(1_700_000_000_000, 'UTC', 'en-US')).toContain('November 14, 2023');
    const now = 1_700_000_000_000;
    const D = 86_400_000;
    expect(relativeTime(now, now)).toBe('now');
    expect(relativeTime(now + 400, now)).toBe('now');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now + 2 * D, now)).toBe('in 2 days');
    expect(relativeTime(now - D, now)).toBe('1 day ago');
    expect(relativeTime(now - 45 * 60_000, now)).toBe('45 minutes ago');
    expect(relativeTime(now - 59.6 * 60_000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 10 * D, now)).toBe('1 week ago');
    expect(relativeTime(now - 35 * D, now)).toBe('1 month ago');
    expect(relativeTime(now - 400 * D, now)).toBe('1 year ago');
    expect(relativeTime(now + 50 * 365 * D, now)).toBe('in 50 years');
  });
  it('formats precise relative time with calendar units', () => {
    const now = 1_700_000_000_000; // 2023-11-14T22:13:20Z
    expect(preciseRelative(Date.UTC(2021, 7, 10, 22, 13, 20), now, 'UTC')).toBe('2 years, 3 months and 4 days ago');
    expect(preciseRelative(now + 90_061_000, now, 'UTC')).toBe('in 1 day, 1 hour and 1 minute');
    expect(preciseRelative(now + 5_000, now, 'UTC')).toBe('in 5 seconds');
    expect(preciseRelative(now, now, 'UTC')).toBe('now');
    expect(preciseRelative(now - 3_600_000, now, 'UTC', 1)).toBe('1 hour ago');
  });
  it('handles relative times at the ends of the date range', () => {
    const now = 1_700_000_000_000;
    expect(relativeTime(-8.64e15, now)).toMatch(/^27\d,\d{3} years ago$/);
    expect(relativeTime(8.64e15, now)).toMatch(/^in 27\d,\d{3} years$/);
    expect(preciseRelative(-8.64e15, now, 'UTC')).toMatch(/years, \d+ months? and \d+ days? ago$/);
    expect(preciseRelative(8.64e15, now, 'America/New_York')).toMatch(/^in 27\d,\d{3} years/);
  });
  it('formats RFC 9557 with the zone name', () => {
    expect(formatRfc9557({ epochMs: 1_700_000_000_000, nanos: 0 }, NY)).toBe('2023-11-14T17:13:20.000-05:00[America/New_York]');
  });
});

describe('other epochs', () => {
  const instant = { epochMs: 1_700_000_000_000, nanos: 0 };
  it('formats every epoch exactly', () => {
    expect(formatAltEpoch(instant, 'filetime')).toBe('133444736000000000');
    expect(formatAltEpoch(instant, 'dotnet')).toBe('638355968000000000');
    expect(formatAltEpoch(instant, 'webkit')).toBe('13344473600000000');
    expect(formatAltEpoch(instant, 'cocoa')).toBe('721692800');
    expect(formatAltEpoch({ epochMs: 1_700_000_000_500, nanos: 250 }, 'cocoa')).toBe('721692800.50000025');
    expect(formatAltEpoch(instant, 'jd')).toBe('2460263.42592593');
    expect(formatAltEpoch(instant, 'mjd')).toBe('60262.92592593');
    expect(formatAltEpoch(instant, 'excel')).toBe('45244.92592593');
    expect(formatAltEpoch(instant, 'excel', NY)).toBe('45244.71759259');
    expect(formatAltEpoch({ epochMs: 0, nanos: 0 }, 'jd')).toBe('2440587.5');
    expect(formatAltEpoch({ epochMs: 0, nanos: 0 }, 'mjd')).toBe('40587');
  });
  it('knows which instants a format cannot hold', () => {
    const before1601 = { epochMs: Date.UTC(1600, 0, 1), nanos: 0 };
    expect(formatAltEpoch(before1601, 'filetime')).toBeNull();
    expect(formatAltEpoch(before1601, 'webkit')).toBeNull();
    expect(formatAltEpoch(before1601, 'dotnet')).not.toBeNull();
    expect(formatAltEpoch({ epochMs: 8.64e15, nanos: 0 }, 'dotnet')).toBeNull();
    expect(formatAltEpoch({ epochMs: Date.UTC(1899, 11, 30), nanos: 0 }, 'excel')).toBeNull();
    expect(formatAltEpoch({ epochMs: -8.64e15, nanos: 0 }, 'jd')).toMatch(/^-/);
    // At the very ends of the range the wall time in a zone can fall outside it; never throw.
    for (const zone of ['UTC', NY, 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      for (const epochMs of [-8.64e15, 8.64e15]) {
        for (const spec of ['filetime', 'dotnet', 'webkit', 'cocoa', 'excel', 'jd', 'mjd'] as const) {
          expect(() => formatAltEpoch({ epochMs, nanos: 0 }, spec, zone)).not.toThrow();
        }
        expect(() => formatIsoInZone({ epochMs, nanos: 0 }, zone)).not.toThrow();
        expect(() => formatHuman(epochMs, zone)).not.toThrow();
        expect(() => preciseRelative(epochMs, 1_700_000_000_000, zone)).not.toThrow();
      }
    }
  });
  it('follows Excel’s 1900 leap-year quirk', () => {
    const excel = (y: number, m: number, d: number) => formatAltEpoch({ epochMs: Date.UTC(y, m - 1, d), nanos: 0 }, 'excel');
    expect(excel(1900, 1, 1)).toBe('1');
    expect(excel(1900, 2, 28)).toBe('59');
    expect(excel(1900, 3, 1)).toBe('61');
    expect(excel(9999, 12, 31)).toBe('2958465');
  });
  it('parses every epoch', () => {
    const at = (text: string, epoch: Parameters<typeof parseAltEpoch>[1], zone = 'UTC') => ok(parseAltEpoch(text, epoch, zone)).instant;
    expect(at('133444736000000000', 'filetime')).toEqual(instant);
    expect(at('638355968000000000', 'dotnet')).toEqual(instant);
    expect(at('0', 'dotnet').epochMs).toBe(-62_135_596_800_000);
    expect(at('13344473600000000', 'webkit')).toEqual(instant);
    expect(at('721692800.5', 'cocoa')).toEqual({ epochMs: 1_700_000_000_500, nanos: 0 });
    expect(at('2451545', 'jd').epochMs).toBe(Date.UTC(2000, 0, 1, 12));
    expect(at('51544.5', 'mjd').epochMs).toBe(Date.UTC(2000, 0, 1, 12));
    expect(at('1', 'excel').epochMs).toBe(Date.UTC(1900, 0, 1));
    expect(at('59', 'excel').epochMs).toBe(Date.UTC(1900, 1, 28));
    expect(at('61', 'excel').epochMs).toBe(Date.UTC(1900, 2, 1));
    expect(at('45244.5', 'excel').epochMs).toBe(Date.UTC(2023, 10, 14, 12));
    expect(at('45244.5', 'excel', NY).epochMs).toBe(Date.UTC(2023, 10, 14, 17));
    expect(at('2958465', 'excel').epochMs).toBe(Date.UTC(9999, 11, 31));
  });
  it('rejects values outside each format', () => {
    expect(parseAltEpoch('60', 'excel').ok).toBe(false);
    expect(parseAltEpoch('60.5', 'excel').ok).toBe(false);
    expect(parseAltEpoch('-1', 'excel').ok).toBe(false);
    expect(parseAltEpoch('2958466', 'excel').ok).toBe(false);
    expect(parseAltEpoch('-5', 'filetime').ok).toBe(false);
    expect(parseAltEpoch('abc', 'cocoa').ok).toBe(false);
    expect(parseAltEpoch('1e30', 'jd').ok).toBe(false);
  });
  it('suggests other readings of a number', () => {
    expect(interpretNumber('1700000000', 'UTC', 's').map((i) => i.unit)).toEqual(['cocoa']);
    expect(interpretNumber('1700000000000', 'UTC').map((i) => i.unit)).toEqual(['ms']);
    expect(interpretNumber('133444736000000000', 'UTC', 'ns').map((i) => i.unit)).toEqual(['filetime']);
    expect(interpretNumber('721692800', 'UTC', 's').map((i) => i.unit)).toContain('cocoa');
    const excel = interpretNumber('45244.5', 'UTC', 's').map((i) => i.unit);
    expect(excel).toContain('excel');
    expect(excel).not.toContain('ms');
    expect(interpretNumber('not a number', 'UTC')).toEqual([]);
  });
});

describe('parseDateInput', () => {
  const opts = { zone: NY, now: 1_700_000_000_000 };
  it('handles now and numbers', () => {
    expect(ok(parseDateInput('now', opts)).instant.epochMs).toBe(1_700_000_000_000);
    const n = ok(parseDateInput(' 1700000000 ', opts));
    expect(n.kind).toBe('epoch');
    expect(n.unit).toBe('s');
    expect(n.unitDetected).toBe(true);
  });
  it('parses ISO with and without offsets', () => {
    expect(ok(parseDateInput('2023-11-14T22:13:20Z', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14T17:13:20-05:00', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14T17:13:20-0500', opts)).instant.epochMs).toBe(1_700_000_000_000);
    const local = ok(parseDateInput('2023-11-14 17:13:20', opts));
    expect(local.usedZone).toBe(true);
    expect(local.instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14T22:13:20.123456789Z', opts)).instant).toEqual({
      epochMs: 1_700_000_000_123,
      nanos: 456_789,
    });
    expect(ok(parseDateInput('2023-11-14T17:13:20[America/New_York]', opts)).instant.epochMs).toBe(1_700_000_000_000);
  });
  it('explains DST gaps and 24:00', () => {
    const gap = ok(parseDateInput('2024-03-10T02:30', opts));
    expect(gap.notes[0]).toMatch(/does not exist/);
    const endOfDay = ok(parseDateInput('2024-01-01T24:00Z', opts));
    expect(endOfDay.instant.epochMs).toBe(Date.UTC(2024, 0, 2));
  });
  it('parses RFC 2822', () => {
    expect(ok(parseDateInput('Tue, 14 Nov 2023 22:13:20 +0000', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('14 Nov 2023 17:13:20 EST', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('Tue, 14 Nov 2023 22:13:20 GMT', opts)).kind).toBe('rfc2822');
    expect(ok(parseDateInput('Mon, 14 Nov 2023 22:13:20 +0000', opts)).notes[0]).toMatch(/weekday does not match/);
  });
  it('rejects invalid dates with a human message', () => {
    const bad = parseDateInput('2023-02-30', opts);
    expect(bad.ok).toBe(false);
    expect(parseDateInput('2023-11-14T23:59:60Z', opts).ok).toBe(false);
    expect(parseDateInput('hello 🙂', opts).ok).toBe(false);
    expect(parseDateInput('', opts).ok).toBe(false);
    expect(parseDateInput('2023-11-14T10:00+25:00', opts).ok).toBe(false);
    expect(parseDateInput('2023-11-14T10:00[Nowhere/City]', opts).ok).toBe(false);
  });
  it('falls back to the browser only for month-named text', () => {
    const r = ok(parseDateInput('November 14, 2023 22:13:20 UTC', opts));
    expect(r.kind).toBe('browser');
    expect(r.instant.epochMs).toBe(1_700_000_000_000);
  });
  it('accepts trailing zone names and Go’s time format', () => {
    expect(ok(parseDateInput('2023-11-14 22:13:20 UTC', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14T22:13:20 GMT', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14T17:13:20 America/New_York', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14 22:13:20.123 +0000 UTC', opts)).instant.epochMs).toBe(1_700_000_000_123);
    expect(ok(parseDateInput('2023-11-14 23:13:20 +0100 CET', opts)).instant.epochMs).toBe(1_700_000_000_000);
    const pst = ok(parseDateInput('2023-11-14 14:13:20 PST', opts));
    expect(pst.instant.epochMs).toBe(1_700_000_000_000);
    expect(pst.notes[0]).toMatch(/PST was read as UTC−8/);
    const ist = parseDateInput('2023-11-14 22:13:20 IST', opts);
    expect(!ist.ok && ist.error).toMatch(/ambiguous/);
    // Browsers resolve "BST" to Asia/Dhaka; people mean British Summer Time, so refuse to guess.
    expect(parseDateInput('2023-07-01 12:00 BST', opts).ok).toBe(false);
    expect(ok(parseDateInput('2023-11-14 17:13:20 EST5EDT', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('2023-11-14 22:13:20 Etc/UTC', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(parseDateInput('2023-11-14T10:00 Mars/Olympus', opts).ok).toBe(false);
    const z = ok(parseDateInput('2023-11-14T22:13:20Z[America/New_York]', opts));
    expect(z.instant.epochMs).toBe(1_700_000_000_000);
    expect(z.notes).toEqual([]);
    const mismatch = ok(parseDateInput('2023-11-14T22:13:20+01:00[America/New_York]', opts));
    expect(mismatch.notes[0]).toMatch(/does not match/);
  });
  it('accepts ISO 8601 basic format', () => {
    expect(ok(parseDateInput('20231114T221320Z', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('20231114T171320-0500', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('20231114T2213Z', opts)).instant.epochMs).toBe(1_699_999_980_000);
    expect(ok(parseDateInput('20231114T221320.5Z', opts)).instant.epochMs).toBe(1_700_000_000_500);
  });
  it('accepts all three HTTP date formats and Unix date output', () => {
    expect(ok(parseDateInput('Tuesday, 14-Nov-23 22:13:20 GMT', opts))).toMatchObject({ kind: 'http', instant: { epochMs: 1_700_000_000_000 } });
    expect(ok(parseDateInput('Sun Nov  6 08:49:37 1994', opts))).toMatchObject({ kind: 'ctime', instant: { epochMs: 784_111_777_000 } });
    expect(ok(parseDateInput('Tue Nov 14 22:13:20 UTC 2023', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('Tue Nov 14 17:13:20 EST 2023', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(ok(parseDateInput('Tue Nov 14 23:13:20 +0100 2023', opts)).instant.epochMs).toBe(1_700_000_000_000);
    expect(parseDateInput('Tue Nov 31 22:13:20 2023', opts).ok).toBe(false);
    expect(parseDateInput('Tue Nov 14 22:13:20 XYZ 2023', opts).ok).toBe(false);
  });
  it('reads numbers in other epochs and explains look-alikes', () => {
    const lead = ok(parseDateInput('@1700000000', opts));
    expect(lead.instant.epochMs).toBe(1_700_000_000_000);
    const ldap = ok(parseDateInput('133444736000000000', { ...opts, unit: 'filetime' }));
    expect(ldap).toMatchObject({ kind: 'alt', unit: 'filetime', instant: { epochMs: 1_700_000_000_000 } });
    const excel = ok(parseDateInput('45244.5', { ...opts, unit: 'excel' }));
    expect(excel.instant.epochMs).toBe(Date.UTC(2023, 10, 14, 17));
    expect(excel.usedZone).toBe(true);
    expect(parseDateInput('60', { ...opts, unit: 'excel' }).ok).toBe(false);
    const ymd = ok(parseDateInput('20231114', opts));
    expect(ymd.kind).toBe('epoch');
    expect(ymd.notes.join(' ')).toMatch(/2023-11-14 \(YYYYMMDD\)/);
    expect(ok(parseDateInput('12345678', opts)).notes).toEqual([]);
  });
  it('handles far future and pre-1970 dates', () => {
    expect(ok(parseDateInput('+275760-09-13T00:00:00Z', opts)).instant.epochMs).toBe(8.64e15);
    expect(parseDateInput('+275760-09-13T00:00:01Z', opts).ok).toBe(false);
    expect(ok(parseDateInput('1900-01-01T00:00:00Z', opts)).instant.epochMs).toBe(-2_208_988_800_000);
  });
});
