import { describe, expect, it } from 'vitest';
import { formatPercent, sizeChange } from './sizeChange';

describe('sizeChange', () => {
  it('classifies real savings, marginal savings, no change and growth', () => {
    expect(sizeChange(1000, 400)).toMatchObject({ verdict: 'smaller', percent: '-60.0%' });
    expect(sizeChange(1000, 990)).toMatchObject({ verdict: 'smaller', percent: '-1.0%' });
    // A few bytes saved on a big file is not a success worth a "Reduced by 0%" banner.
    expect(sizeChange(52_431_008, 52_430_900)).toMatchObject({ verdict: 'marginal' });
    expect(sizeChange(1000, 1000)).toMatchObject({ verdict: 'same', percent: '0%' });
    expect(sizeChange(2150, 32_100)).toMatchObject({ verdict: 'larger', percent: '+1393.0%' });
  });

  it('never rounds a real change to 0', () => {
    expect(formatPercent(-0.00004)).toBe('-0.004%');
    expect(formatPercent(0.0000002)).toBe('+<0.001%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('handles an empty original without dividing by zero', () => {
    expect(sizeChange(0, 10)).toMatchObject({ fraction: 0, verdict: 'larger' });
  });
});
