import { describe, expect, it } from 'vitest';
import { wallInZone } from './tz';
import { ZERO_AMOUNTS } from './datemath';
import { calculateDate, describeAmounts } from './datecalc';

const NY = 'America/New_York';

function ok(r: ReturnType<typeof calculateDate>) {
  if (!r || !r.ok) throw new Error(r ? r.error : 'empty');
  return r.value;
}

describe('calculateDate', () => {
  it('returns null for an empty start and explains invalid input', () => {
    expect(calculateDate('date', '', { ...ZERO_AMOUNTS, days: 1 })).toBeNull();
    expect(calculateDate('date', '2023-02-30', { ...ZERO_AMOUNTS, days: 1 })?.ok).toBe(false);
    expect(calculateDate('date', 'next tuesday', { ...ZERO_AMOUNTS, days: 1 })?.ok).toBe(false);
  });
  it('clamps month ends and says so', () => {
    const r = ok(calculateDate('date', '2024-01-31', { ...ZERO_AMOUNTS, months: 1 }));
    expect(wallInZone(r.epochMs, 'UTC')).toMatchObject({ year: 2024, month: 2, day: 29 });
    expect(r.clamped).toBe(true);
    expect(r.amountText).toBe('1 month');
    const back = ok(calculateDate('date', '2024-03-31', { ...ZERO_AMOUNTS, months: 1 }, { direction: 'subtract' }));
    expect(wallInZone(back.epochMs, 'UTC')).toMatchObject({ month: 2, day: 29 });
  });
  it('adds business days', () => {
    const r = ok(calculateDate('date', '2024-05-03', { ...ZERO_AMOUNTS, days: 10 }, { businessDays: true }));
    expect(wallInZone(r.epochMs, 'UTC')).toMatchObject({ month: 5, day: 17 });
    expect(r.amountText).toBe('10 business days');
  });
  it('needs whole numbers in date mode only', () => {
    const r = calculateDate('date', '2024-01-01', { ...ZERO_AMOUNTS, days: 1.5 });
    expect(r?.ok === false && r.error).toMatch(/whole numbers/);
    const dt = ok(calculateDate('datetime', '2024-01-01T00:00', { ...ZERO_AMOUNTS, days: 1.5 }, { zone: 'UTC' }));
    expect(wallInZone(dt.epochMs, 'UTC')).toMatchObject({ day: 2, hour: 12 });
  });
  it('keeps wall time for days across DST but not for hours', () => {
    const day = ok(calculateDate('datetime', '2024-03-09T12:00', { ...ZERO_AMOUNTS, days: 1 }, { zone: NY }));
    expect(wallInZone(day.epochMs, NY)).toMatchObject({ day: 10, hour: 12 });
    const hours = ok(calculateDate('datetime', '2024-03-09T12:00', { ...ZERO_AMOUNTS, hours: 24 }, { zone: NY }));
    expect(wallInZone(hours.epochMs, NY)).toMatchObject({ day: 10, hour: 13 });
  });
  it('asks for positive amounts instead of mixing signs with the direction', () => {
    const r = calculateDate('date', '2024-06-01', { ...ZERO_AMOUNTS, days: -5 });
    expect(r?.ok === false && r.error).toMatch(/positive amounts/);
  });
  it('reports no steps for zero amounts', () => {
    const r = ok(calculateDate('date', '2024-06-01', ZERO_AMOUNTS));
    expect(r.steps).toEqual([]);
    expect(r.amountText).toBe('nothing');
  });
  it('rejects results outside the supported range', () => {
    expect(calculateDate('date', '9999-12-31', { ...ZERO_AMOUNTS, years: 300_000 })?.ok).toBe(false);
  });
});

describe('describeAmounts', () => {
  it('lists non-zero amounts', () => {
    expect(describeAmounts({ ...ZERO_AMOUNTS, years: 1, months: 2, days: 30 })).toBe('1 year, 2 months and 30 days');
    expect(describeAmounts({ ...ZERO_AMOUNTS, weeks: 2, days: 3 }, true)).toBe('2 weeks and 3 business days');
    expect(describeAmounts({ ...ZERO_AMOUNTS, hours: 1.5, seconds: 1 })).toBe('1.5 hours and 1 second');
    expect(describeAmounts({ ...ZERO_AMOUNTS, days: 10_000 })).toBe('10,000 days');
    expect(describeAmounts(ZERO_AMOUNTS)).toBe('nothing');
  });
});
