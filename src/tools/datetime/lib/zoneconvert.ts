/** Helpers for the Time Zone Converter: per-zone rows, transition descriptions and a 24-hour planner strip. */
import { MONTH_SHORT, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, WEEKDAY_SHORT, dayOfWeek, wallFromUtc, type WallTime } from './civil';
import {
  dayShift,
  isDst,
  namedAbbreviation,
  nextTransition,
  tzOffsetMs,
  wallInZone,
  zoneAbbreviation,
  zonedToEpoch,
  type OffsetTransition,
  type ZonedResolution,
} from './tz';

export interface ZoneView {
  zone: string;
  wall: WallTime;
  offsetMs: number;
  /** A real abbreviation ("EST", "CEST"); null when the browser only knows "GMT+7". */
  abbreviation: string | null;
  longName: string;
  dst: boolean;
  /** Calendar-day difference from the reference wall date (−1, 0, +1 …). */
  dayShift: number;
  /** This zone's offset minus the reference zone's offset. */
  offsetDiffMs: number;
  /** The next offset change after the instant (searched up to 400 days ahead). */
  next: OffsetTransition | null;
}

export function zoneView(epochMs: number, zone: string, reference: { wall: WallTime; offsetMs: number }): ZoneView {
  const wall = wallInZone(epochMs, zone);
  const offsetMs = tzOffsetMs(epochMs, zone);
  return {
    zone,
    wall,
    offsetMs,
    abbreviation: namedAbbreviation(epochMs, zone),
    longName: zoneAbbreviation(epochMs, zone, 'long'),
    dst: isDst(epochMs, zone),
    dayShift: dayShift(reference.wall, wall),
    offsetDiffMs: offsetMs - reference.offsetMs,
    next: nextTransition(zone, epochMs, 400),
  };
}

/** "1 hour", "30 minutes", "1 hour 30 minutes", "1 day". */
export function formatSpan(ms: number): string {
  const abs = Math.abs(ms);
  if (abs % MS_PER_DAY === 0 && abs >= MS_PER_DAY) {
    const d = abs / MS_PER_DAY;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  const totalMinutes = Math.round(abs / MS_PER_MINUTE);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const parts = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' ') || '0 minutes';
}

/** "+5 h", "−3 h 30 min", "same offset". */
export function formatOffsetDiff(ms: number): string {
  if (ms === 0) return 'same offset';
  const sign = ms > 0 ? '+' : '−';
  const totalMinutes = Math.round(Math.abs(ms) / MS_PER_MINUTE);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${sign}${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Sun, Mar 10, 2024". */
export function shortDate(w: WallTime): string {
  return `${WEEKDAY_SHORT[dayOfWeek(w)]}, ${MONTH_SHORT[w.month - 1]} ${w.day}, ${w.year}`;
}

/** "14:05" or "2:05 PM". */
export function clockText(w: Pick<WallTime, 'hour' | 'minute'>, hour12: boolean): string {
  if (!hour12) return `${pad(w.hour)}:${pad(w.minute)}`;
  const h = w.hour % 12 || 12;
  return `${h}:${pad(w.minute)} ${w.hour < 12 ? 'AM' : 'PM'}`;
}

export interface TransitionText {
  /** "Clocks go back 1 hour" */
  summary: string;
  /** "Sun, Nov 3, 2024 at 02:00, to 01:00" */
  when: string;
}

/** Plain-language description of an offset change as seen on the zone's clocks. */
export function describeTransition(t: OffsetTransition, hour12 = false): TransitionText {
  const delta = t.toOffset - t.fromOffset;
  const from = wallFromUtc(t.epochMs + t.fromOffset); // what the clock would have shown
  const to = wallFromUtc(t.epochMs + t.toOffset); // what it shows instead
  const summary = `Clocks go ${delta > 0 ? 'forward' : 'back'} ${formatSpan(delta)}`;
  const sameDay = from.year === to.year && from.month === to.month && from.day === to.day;
  const when = sameDay
    ? `${shortDate(from)} at ${clockText(from, hour12)}, to ${clockText(to, hour12)}`
    : `${shortDate(from)} at ${clockText(from, hour12)}, to ${shortDate(to)} ${clockText(to, hour12)}`;
  return { summary, when };
}

export type SourceChoice = 'default' | 'alternative';

export interface SourceResolution extends ZonedResolution {
  /** For gaps and overlaps: both possible instants, the default first. */
  options: Array<{ choice: SourceChoice; epochMs: number }>;
  /** The transition that caused a gap or overlap. */
  transition: OffsetTransition | null;
}

/**
 * Resolve a wall-clock source time. `default` follows Temporal's "compatible" rule
 * (a repeated time takes its first occurrence, a skipped time moves forward);
 * `alternative` picks the other occurrence, or moves a skipped time backward.
 */
export function resolveSource(wall: WallTime, zone: string, choice: SourceChoice): SourceResolution {
  const base = zonedToEpoch(wall, zone, 'compatible');
  if (base.status === 'ok') return { ...base, options: [], transition: null };
  const alternative = zonedToEpoch(wall, zone, base.status === 'gap' ? 'earlier' : 'later');
  const options: SourceResolution['options'] = [
    { choice: 'default', epochMs: base.epochMs },
    { choice: 'alternative', epochMs: alternative.epochMs },
  ];
  const lo = Math.min(base.epochMs, alternative.epochMs);
  const transition = nextTransition(zone, lo - 2 * MS_PER_DAY, 4);
  const picked = choice === 'alternative' ? alternative : base;
  return { ...picked, status: base.status, candidates: base.candidates, shiftMs: base.shiftMs, options, transition };
}

export interface PlannerCell {
  epochMs: number;
  wall: WallTime;
  /** 'night' 0–5 and 22–23, 'work' 9–17, otherwise 'day'. */
  period: 'night' | 'day' | 'work';
  /** First cell of a new local date (or the first cell of the strip). */
  newDay: boolean;
}

export function periodOf(hour: number): PlannerCell['period'] {
  if (hour < 6 || hour >= 22) return 'night';
  if (hour >= 9 && hour < 18) return 'work';
  return 'day';
}

/** The start of the source zone's calendar day containing `epochMs` (its first existing instant). */
export function startOfZonedDay(epochMs: number, zone: string): number {
  const w = wallInZone(epochMs, zone);
  return zonedToEpoch({ ...w, hour: 0, minute: 0, second: 0, millisecond: 0 }, zone).epochMs;
}

/** `hours` consecutive hours from `startMs`, as seen in `zone`. */
export function plannerStrip(startMs: number, zone: string, hours = 24): PlannerCell[] {
  const cells: PlannerCell[] = [];
  for (let i = 0; i < hours; i++) {
    const epochMs = startMs + i * MS_PER_HOUR;
    const wall = wallInZone(epochMs, zone);
    const prev = cells[i - 1]?.wall;
    const newDay = !prev || prev.day !== wall.day || prev.month !== wall.month || prev.year !== wall.year;
    cells.push({ epochMs, wall, period: periodOf(wall.hour), newDay });
  }
  return cells;
}
