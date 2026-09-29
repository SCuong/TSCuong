/** Human-friendly durations and relative times ("3 days ago", "in 2 hours 5 minutes"). */

const UNITS: Array<{ name: string; seconds: number }> = [
  { name: 'year', seconds: 365.25 * 86400 },
  { name: 'month', seconds: 30.4375 * 86400 },
  { name: 'day', seconds: 86400 },
  { name: 'hour', seconds: 3600 },
  { name: 'minute', seconds: 60 },
  { name: 'second', seconds: 1 },
];

const plural = (n: number, unit: string) => `${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Formats a duration using its largest unit, adding the next unit when the first is small
 * (e.g. "2 hours 5 minutes", "3 days", "45 seconds"). Sign is ignored.
 */
export function humanizeDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return 'forever';
  const s = Math.abs(totalSeconds);
  if (s < 1) return 'less than a second';
  for (let i = 0; i < UNITS.length; i++) {
    const unit = UNITS[i];
    if (s >= unit.seconds) {
      const whole = Math.floor(s / unit.seconds);
      const next = UNITS[i + 1];
      if (next && whole < 10 && unit.name !== 'year') {
        const rest = Math.floor((s - whole * unit.seconds) / next.seconds);
        if (rest > 0) return `${plural(whole, unit.name)} ${plural(rest, next.name)}`;
      }
      if (unit.name === 'year' && whole < 10) {
        const months = Math.floor((s - whole * unit.seconds) / UNITS[1].seconds);
        if (months > 0) return `${plural(whole, 'year')} ${plural(months, 'month')}`;
      }
      return plural(whole, unit.name);
    }
  }
  return plural(Math.floor(s), 'second');
}

/** "in 5 minutes" for positive deltas, "5 minutes ago" for negative ones. */
export function relativeTime(deltaSeconds: number): string {
  if (Math.abs(deltaSeconds) < 1) return 'just now';
  const text = humanizeDuration(deltaSeconds);
  return deltaSeconds > 0 ? `in ${text}` : `${text} ago`;
}

/** ISO-8601 UTC representation of a NumericDate (seconds), or null when out of range. */
export function isoFromSeconds(seconds: number): string | null {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/** Local date/time, e.g. "Sep 29, 2026, 14:03:12 GMT+2" (locale dependent). */
export function formatLocalDateTime(ms: number): string {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms));
}

/** Whole days between two instants, rounded towards zero. */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.trunc((toMs - fromMs) / 86_400_000);
}
