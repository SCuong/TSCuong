import { describe, expect, it } from 'vitest';
import {
  RATE_PRESETS,
  SIZE_PRESETS,
  describeRate,
  describeSize,
  formatClock,
  formatHumanDuration,
  parseDuration,
  rateUnit,
  requiredRate,
  sizeUnit,
  transferTime,
  transferableSize,
  type Calc,
} from './transfer';

const val = (c: Calc) => {
  if (!c.ok) throw new Error(c.error);
  return c.value;
};

describe('transfer calculations', () => {
  it('time from size and bandwidth', () => {
    // 1 GB over 100 Mbit/s = 8e9 / 1e8 = 80 s
    expect(val(transferTime(1e9, 100e6))).toBe(80);
    // 1 GiB over 1 Gbit/s
    expect(val(transferTime(2 ** 30, 1e9))).toBeCloseTo(8.589934592, 9);
    // 10% overhead: 80 / 0.9
    expect(val(transferTime(1e9, 100e6, 10))).toBeCloseTo(88.8888889, 6);
    expect(val(transferTime(0, 1e6))).toBe(0);
    expect(transferTime(1, 0).ok).toBe(false);
    expect(transferTime(-1, 1).ok).toBe(false);
    expect(transferTime(1, 1, 100).ok).toBe(false);
    expect(transferTime(1, 1, -5).ok).toBe(false);
  });

  it('bandwidth from size and time', () => {
    expect(val(requiredRate(1e9, 80))).toBe(100e6);
    expect(val(requiredRate(1e9, 80, 20))).toBe(125e6);
    expect(requiredRate(1, 0).ok).toBe(false);
  });

  it('size from bandwidth and time', () => {
    expect(val(transferableSize(100e6, 80))).toBe(1e9);
    expect(val(transferableSize(1e9, 3600))).toBe(450e9);
    expect(val(transferableSize(100e6, 80, 50))).toBe(0.5e9);
    expect(transferableSize(-1, 1).ok).toBe(false);
  });

  it('round-trips between the three modes', () => {
    const bytes = 4.7e9;
    const rate = 480e6;
    const t = val(transferTime(bytes, rate, 12));
    expect(val(requiredRate(bytes, t, 12))).toBeCloseTo(rate, 3);
    expect(val(transferableSize(rate, t, 12))).toBeCloseTo(bytes, 3);
  });

  it('units and presets resolve', () => {
    expect(sizeUnit('mib').bytes).toBe(1048576);
    expect(sizeUnit('nope').label).toBe('GB');
    expect(rateUnit('MBps').bitsPerSecond).toBe(8e6);
    expect(rateUnit('nope').label).toBe('Mbit/s');
    for (const p of RATE_PRESETS) expect(rateUnit(p.unit).id).toBe(p.unit);
    for (const p of SIZE_PRESETS) expect(sizeUnit(p.unit).id).toBe(p.unit);
    // USB 2.0: 480 Mbit/s = 60 MB/s nominal
    const usb2 = RATE_PRESETS.find((p) => p.label === 'USB 2.0')!;
    expect((usb2.value * rateUnit(usb2.unit).bitsPerSecond) / 8e6).toBe(60);
  });
});

describe('durations', () => {
  it('parses many formats', () => {
    expect(val(parseDuration('90'))).toBe(90);
    expect(val(parseDuration('1.5'))).toBe(1.5);
    expect(val(parseDuration('1:30'))).toBe(90);
    expect(val(parseDuration('01:02:03'))).toBe(3723);
    expect(val(parseDuration('100:00:00'))).toBe(360000);
    expect(val(parseDuration('1.5h'))).toBe(5400);
    expect(val(parseDuration('2h 30m'))).toBe(9000);
    expect(val(parseDuration('1d 4h 5m 6s'))).toBe(86400 + 4 * 3600 + 5 * 60 + 6);
    expect(val(parseDuration('2 hours and 5 minutes'))).toBe(7500);
    expect(val(parseDuration('1 day, 2 hours'))).toBe(93600);
    expect(val(parseDuration('500ms'))).toBe(0.5);
    expect(val(parseDuration('1 week'))).toBe(604800);
  });

  it('rejects bad durations', () => {
    expect(parseDuration('').ok).toBe(false);
    expect(parseDuration('abc').ok).toBe(false);
    expect(parseDuration('5 parsecs')).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown time unit "parsecs"/) });
    expect(parseDuration('1:60').ok).toBe(false);
    expect(parseDuration('1:60:00').ok).toBe(false);
    expect(parseDuration('-5').ok).toBe(false);
    expect(parseDuration('5h garbage').ok).toBe(false);
  });

  it('formats clock time', () => {
    expect(formatClock(80)).toBe('00:01:20');
    expect(formatClock(3723)).toBe('01:02:03');
    expect(formatClock(90061)).toBe('25:01:01');
    expect(formatClock(8.589934592)).toBe('00:00:08.590');
    expect(formatClock(0)).toBe('00:00:00.000');
    expect(formatClock(59.6)).toBe('00:01:00');
    expect(formatClock(Infinity)).toBe('∞');
  });

  it('formats human durations', () => {
    expect(formatHumanDuration(0)).toBe('0 seconds');
    expect(formatHumanDuration(0.25)).toBe('250 ms');
    expect(formatHumanDuration(0.0000005)).toBe('0.5 µs');
    expect(formatHumanDuration(1)).toBe('1 second');
    expect(formatHumanDuration(8.59)).toBe('8.59 seconds');
    expect(formatHumanDuration(80)).toBe('1 minute 20 seconds');
    expect(formatHumanDuration(3600)).toBe('1 hour');
    expect(formatHumanDuration(3723)).toBe('1 hour 2 minutes 3 seconds');
    expect(formatHumanDuration(2 * 86400 + 3 * 3600 + 4 * 60 + 5)).toBe('2 days 3 hours 4 minutes');
    expect(formatHumanDuration(31_556_952 * 2 + 86400)).toBe('2 years 1 day');
    expect(formatHumanDuration(31_556_952 * 1000)).toBe('1.00e3 years');
    expect(formatHumanDuration(Infinity)).toBe('forever');
  });
});

describe('describeRate / describeSize', () => {
  it('picks readable units', () => {
    expect(describeRate(100e6)).toEqual({
      bits: { value: 100, unit: 'Mbit/s' },
      si: { value: 12.5, unit: 'MB/s' },
      iec: { value: 12.5e6 / 2 ** 20, unit: 'MiB/s' },
    });
    expect(describeRate(500).bits).toEqual({ value: 500, unit: 'bit/s' });
    expect(describeRate(4).si).toEqual({ value: 0.5, unit: 'B/s' });
    expect(describeRate(1e12).bits).toEqual({ value: 1000, unit: 'Gbit/s' });
    expect(describeSize(1e9)).toEqual({ si: { value: 1, unit: 'GB' }, iec: { value: 1e9 / 2 ** 20, unit: 'MiB' } });
    expect(describeSize(0).si.unit).toBe('B');
    expect(describeSize(2 ** 50).iec).toEqual({ value: 1, unit: 'PiB' });
  });
});
