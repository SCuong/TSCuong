/** The Date Calculator's computation: parse the start, validate amounts, add or subtract, describe. */
import { parseWall, type WallTime } from './civil';
import { addToDate, joinAnd, type AddStep, type DateAmounts } from './datemath';
import type { ZonedResolution } from './tz';

export type CalcMode = 'date' | 'datetime';
export type CalcAmounts = DateAmounts;

export interface CalcResult {
  epochMs: number;
  start: WallTime;
  clamped: boolean;
  steps: AddStep[];
  /** "1 year, 2 months and 30 days" */
  amountText: string;
  resolution: ZonedResolution;
}

export type CalcOutcome = { ok: true; value: CalcResult } | { ok: false; error: string } | null;

function unit(n: number, word: string): string {
  const text = Number.isInteger(n) ? n.toLocaleString('en-US') : String(Number(n.toFixed(6)));
  return `${text} ${word}${n === 1 ? '' : 's'}`;
}

/** Plain-language list of the amounts, e.g. "2 weeks and 10 business days". */
export function describeAmounts(a: CalcAmounts, businessDays = false): string {
  const parts: Array<[number, string]> = [
    [a.years, 'year'],
    [a.months, 'month'],
    [a.weeks, 'week'],
    [a.days, businessDays ? 'business day' : 'day'],
    [a.hours, 'hour'],
    [a.minutes, 'minute'],
    [a.seconds, 'second'],
  ];
  return joinAnd(parts.filter(([n]) => n !== 0).map(([n, word]) => unit(Math.abs(n), word))) || 'nothing';
}

/**
 * Add (or subtract) amounts to a start value ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM[:SS]").
 * `date` mode is pure calendar arithmetic and needs whole numbers; `datetime` mode
 * works in `zone`, keeping the wall-clock time for calendar units and adding exact
 * time for hours, minutes and seconds. Returns null while the start is empty.
 */
export function calculateDate(
  mode: CalcMode,
  startText: string,
  amounts: CalcAmounts,
  options: { zone?: string; direction?: 'add' | 'subtract'; businessDays?: boolean } = {},
): CalcOutcome {
  if (!startText.trim()) return null;
  const start = parseWall(startText);
  if (!start) return { ok: false, error: 'Enter a complete, valid start date (for example, February 30 does not exist).' };
  if (Object.values(amounts).some((v) => v < 0)) {
    return { ok: false, error: 'Use positive amounts, and choose Add or Subtract for the direction.' };
  }
  const dateUnits = [amounts.years, amounts.months, amounts.weeks, amounts.days];
  if (mode === 'date' && dateUnits.some((v) => !Number.isInteger(v))) {
    return { ok: false, error: 'Dates move in whole days here. Use whole numbers, or switch to “Dates and times” for fractions of a day.' };
  }
  const r = addToDate(start, mode === 'date' ? 'UTC' : (options.zone ?? 'UTC'), amounts, {
    direction: options.direction === 'subtract' ? -1 : 1,
    businessDays: options.businessDays,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      epochMs: r.epochMs,
      start,
      clamped: r.clamped,
      steps: r.steps,
      amountText: describeAmounts(amounts, options.businessDays),
      resolution: r.resolution,
    },
  };
}
