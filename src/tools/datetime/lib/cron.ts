/**
 * Cron expressions: validation with plain-language errors, compilation to
 * value sets, English descriptions (cronstrue) and a time-zone aware run
 * schedule computed on this device.
 *
 * Semantics follow Vixie/ISC cron, the `cron` daemon on Debian and Ubuntu
 * (and, as cronie, on Fedora and RHEL):
 * - 5 fields, or 6 with a leading seconds field; @yearly … @hourly macros.
 * - Day of month and day of week are combined with OR when both are
 *   restricted, and with AND when either field starts with "*" (or is "?").
 * - Daylight saving: a job whose minute and hour fields have no "*" (a
 *   "fixed-time" job) and that falls into skipped time runs right after the
 *   clocks jump forward (for jumps of up to 3 hours), and runs only once when
 *   clocks fall back. Jobs with "*" in the minute or hour field follow the new
 *   wall clock: skipped times never happen and repeated times run again.
 * Extensions: L (last day of the month), 5L (last Friday), 1#2 (second
 * Monday), ? (no specific value), JAN–DEC and SUN–SAT names, 7 = Sunday,
 * and "5/15" meaning "from 5 to the end of the range, every 15".
 */
import cronstrue from 'cronstrue';
import {
  MAX_EPOCH_MS,
  MONTH_NAMES,
  MS_PER_DAY,
  MS_PER_HOUR,
  WEEKDAY_NAMES,
  dayOfWeek,
  daysInMonth,
  wallFromUtc,
  type WallTime,
} from './civil';
import { nextTransition, tzOffsetMs } from './tz';

export type CronFieldKey = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

export interface CronFieldSpec {
  key: CronFieldKey;
  label: string;
  min: number;
  max: number;
  names?: readonly string[];
  /** Offset of `names[0]` (months start at 1). */
  nameBase?: number;
  hint: string;
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export const CRON_FIELDS: Record<CronFieldKey, CronFieldSpec> = {
  second: { key: 'second', label: 'Second', min: 0, max: 59, hint: '0–59' },
  minute: { key: 'minute', label: 'Minute', min: 0, max: 59, hint: '0–59' },
  hour: { key: 'hour', label: 'Hour', min: 0, max: 23, hint: '0–23' },
  dayOfMonth: { key: 'dayOfMonth', label: 'Day of month', min: 1, max: 31, hint: '1–31, L, ?' },
  month: { key: 'month', label: 'Month', min: 1, max: 12, names: MONTH_ABBR, nameBase: 1, hint: '1–12 or JAN–DEC' },
  dayOfWeek: {
    key: 'dayOfWeek',
    label: 'Day of week',
    min: 0,
    max: 7,
    names: DAY_ABBR,
    nameBase: 0,
    hint: '0–7 or SUN–SAT (0 and 7 = Sunday), 5L, 1#2, ?',
  },
};

export const FIELDS_5: CronFieldKey[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];
export const FIELDS_6: CronFieldKey[] = ['second', ...FIELDS_5];

export const CRON_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronPreset {
  label: string;
  expression: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 5 minutes', expression: '*/5 * * * *' },
  { label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { label: 'Every hour', expression: '0 * * * *' },
  { label: 'Every 6 hours', expression: '0 */6 * * *' },
  { label: 'Every day at midnight', expression: '0 0 * * *' },
  { label: 'Every day at 9:00', expression: '0 9 * * *' },
  { label: 'Weekdays at 9:00', expression: '0 9 * * 1-5' },
  { label: 'Every 30 min, 9–17 on weekdays', expression: '*/30 9-17 * * 1-5' },
  { label: 'Every Monday at 8:30', expression: '30 8 * * 1' },
  { label: 'Weekends at 10:00', expression: '0 10 * * 6,0' },
  { label: 'First day of every month', expression: '0 0 1 * *' },
  { label: 'Last day of every month', expression: '0 18 L * *' },
  { label: 'Second Tuesday of the month', expression: '0 10 * * 2#2' },
  { label: 'Every quarter', expression: '0 0 1 1,4,7,10 *' },
  { label: 'Every year on January 1', expression: '@yearly' },
  { label: 'Every 30 seconds', expression: '*/30 * * * * *' },
];

export interface CronFieldPart {
  key: CronFieldKey;
  raw: string;
}

/** The expression compiled to value sets. */
export interface CronSchedule {
  hasSeconds: boolean;
  /** Sorted allowed values; `[0]` for 5-field expressions. */
  seconds: number[];
  minutes: number[];
  hours: number[];
  /** Indexed 1–12. */
  months: boolean[];
  /** Indexed 1–31. */
  days: boolean[];
  /** `L` in the day-of-month field. */
  lastDay: boolean;
  /** Indexed 0–6 (Sunday = 0). */
  weekdays: boolean[];
  /** `5L`: the last such weekday of the month, indexed 0–6. */
  lastWeekdays: boolean[];
  /** `1#2`: `nthWeekdays[weekday][n]` with n = 1–5. */
  nthWeekdays: boolean[][];
  /** The field starts with "*" or is "?" (Vixie cron's DOM_STAR / DOW_STAR flags). */
  dayOfMonthStar: boolean;
  dayOfWeekStar: boolean;
  /** The minute or hour field starts with "*" (Vixie cron's MIN_STAR / HR_STAR flags). */
  wildcardTime: boolean;
}

export type CronParse =
  | { ok: true; fields: CronFieldPart[]; hasSeconds: boolean; normalized: string; macro?: string; schedule: CronSchedule }
  | { ok: false; error: string; field?: CronFieldKey };

// ---------------------------------------------------------------------------
// Parsing and compiling
// ---------------------------------------------------------------------------

interface FieldValues {
  values: Set<number>;
  lastDay: boolean;
  lastWeekdays: Set<number>;
  nth: Array<[weekday: number, n: number]>;
}

function parseValue(text: string, spec: CronFieldSpec): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  if (spec.names) {
    const i = spec.names.indexOf(text.toUpperCase() as never);
    if (i >= 0) return i + (spec.nameBase ?? 0);
  }
  return null;
}

function describeRange(spec: CronFieldSpec): string {
  const names = spec.names ? ` or ${spec.names[0]}–${spec.names[spec.names.length - 1]}` : '';
  return `${spec.min}–${spec.max}${names}`;
}

function addRange(acc: FieldValues, spec: CronFieldSpec, from: number, to: number, step: number) {
  for (let v = from; v <= to; v += step) acc.values.add(spec.key === 'dayOfWeek' ? v % 7 : v);
}

/** Apply one comma-separated element to `acc`. Returns an error message or null. */
function applyElement(el: string, spec: CronFieldSpec, acc: FieldValues): string | null {
  if (el === '') return 'has an empty item (check for a doubled or trailing comma).';
  if (/^[Hh]/.test(el)) return '“H” (hashed values) is a Jenkins extension that standard cron does not support.';
  if (el === '?') {
    if (spec.key !== 'dayOfMonth' && spec.key !== 'dayOfWeek') {
      return '“?” is only allowed in the day-of-month and day-of-week fields.';
    }
    addRange(acc, spec, spec.min, spec.key === 'dayOfWeek' ? 6 : spec.max, 1);
    return null;
  }
  if (spec.key === 'dayOfMonth') {
    if (/W/i.test(el)) return `“${el}” uses W (nearest weekday), which this scheduler cannot compute. Use a plain day or L instead.`;
    if (/^L$/i.test(el)) {
      acc.lastDay = true;
      return null;
    }
    if (/^L-\d+$/i.test(el)) return `“${el}” (days before the last day) is not supported; use L for the last day of the month.`;
  }
  if (spec.key === 'dayOfWeek') {
    const last = /^(\w+)L$/i.exec(el);
    if (last) {
      const v = parseValue(last[1], spec);
      if (v === null || v > 7) return `“${el}” should be a weekday followed by L, e.g. 5L for the last Friday.`;
      acc.lastWeekdays.add(v % 7);
      return null;
    }
    const nth = /^(\w+)#(\d+)$/.exec(el);
    if (nth) {
      const v = parseValue(nth[1], spec);
      if (v === null || v > 7) return `“${nth[1]}” is not a weekday (${describeRange(spec)}).`;
      const n = Number(nth[2]);
      if (n < 1 || n > 5) return `in “${el}” the occurrence after # must be 1–5.`;
      acc.nth.push([v % 7, n]);
      return null;
    }
    if (/^L$/i.test(el)) return '“L” alone is not valid here; use 0L–6L (e.g. 5L = last Friday).';
  }
  const [base, stepText, ...extra] = el.split('/');
  if (extra.length) return `“${el}” has more than one “/”.`;
  let step = 1;
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText) || Number(stepText) === 0) return `the step in “${el}” must be a positive whole number.`;
    step = Number(stepText);
    if (step > spec.max - spec.min + 1) {
      return `the step ${stepText} in “${el}” is larger than the field’s range (${spec.min}–${spec.max}).`;
    }
  }
  if (base === '*') {
    addRange(acc, spec, spec.min, spec.key === 'dayOfWeek' ? 6 : spec.max, step);
    return null;
  }
  const [from, to, ...more] = base.split('-');
  if (more.length) return `“${base}” is not a valid range.`;
  const a = parseValue(from, spec);
  if (a === null) return `“${from}” is not a valid value (${describeRange(spec)}).`;
  if (a < spec.min || a > spec.max) return `${from} is out of range (${describeRange(spec)}).`;
  let b = a;
  if (to !== undefined) {
    const parsed = parseValue(to, spec);
    if (parsed === null) return `“${to}” is not a valid value (${describeRange(spec)}).`;
    if (parsed < spec.min || parsed > spec.max) return `${to} is out of range (${describeRange(spec)}).`;
    if (parsed < a) {
      if (spec.key === 'dayOfWeek' && parsed === 0) {
        return `the range “${base}” goes backwards; Sunday can also be written as 7, so use ${from}-7.`;
      }
      return `the range “${base}” goes backwards; write the smaller value first (${to}-${from}).`;
    }
    b = parsed;
  } else if (stepText !== undefined) {
    b = spec.max; // "5/15" = from 5 to the end of the range, every 15
  }
  addRange(acc, spec, a, b, step);
  return null;
}

function compileField(raw: string, spec: CronFieldSpec): FieldValues | { error: string } {
  const acc: FieldValues = { values: new Set(), lastDay: false, lastWeekdays: new Set(), nth: [] };
  for (const el of raw.split(',')) {
    const problem = applyElement(el, spec, acc);
    if (problem) return { error: problem };
  }
  return acc;
}

const sortedValues = (set: Set<number>) => [...set].sort((a, b) => a - b);
const flags = (size: number, set: Set<number>) => Array.from({ length: size }, (_, i) => set.has(i));

/** Split, validate and compile an expression, explaining problems in plain language. */
export function parseCron(expression: string): CronParse {
  const text = expression.trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, error: 'Enter a cron expression, e.g. */15 * * * *.' };
  if (text.startsWith('@')) {
    const lower = text.toLowerCase();
    if (lower === '@reboot') return { ok: false, error: '@reboot runs once at startup and has no time schedule to show.' };
    if (lower.startsWith('@every')) {
      return {
        ok: false,
        error: '@every is an extension of Go schedulers (robfig/cron), not standard cron. Use a step instead, e.g. */5 * * * * for every 5 minutes.',
      };
    }
    const expanded = CRON_MACROS[lower];
    if (!expanded) {
      return { ok: false, error: `Unknown macro “${text}”. Supported: ${Object.keys(CRON_MACROS).join(', ')}.` };
    }
    const inner = parseCron(expanded);
    return inner.ok ? { ...inner, macro: lower } : inner;
  }
  const parts = text.split(' ');
  if (parts.length < 5) {
    return {
      ok: false,
      error: `Expected 5 fields (minute hour day-of-month month day-of-week) or 6 with seconds first, but found ${parts.length}.`,
    };
  }
  if (parts.length === 7) {
    return { ok: false, error: 'Found 7 fields. The Quartz year field is not supported; remove the last field.' };
  }
  if (parts.length > 7) return { ok: false, error: `Found ${parts.length} fields; a cron expression has 5 (or 6 with seconds).` };
  const hasSeconds = parts.length === 6;
  const keys = hasSeconds ? FIELDS_6 : FIELDS_5;
  const fields: CronFieldPart[] = [];
  const compiled = {} as Record<CronFieldKey, FieldValues>;
  for (let i = 0; i < keys.length; i++) {
    const spec = CRON_FIELDS[keys[i]];
    const result = compileField(parts[i], spec);
    if ('error' in result) return { ok: false, error: `${spec.label} field: ${result.error}`, field: spec.key };
    compiled[keys[i]] = result;
    fields.push({ key: keys[i], raw: parts[i] });
  }
  const raw = (key: CronFieldKey) => fields.find((f) => f.key === key)?.raw ?? '*';
  const dom = raw('dayOfMonth');
  const dow = raw('dayOfWeek');
  if (dom === '?' && dow === '?') return { ok: false, error: 'Day of month and day of week cannot both be “?”.' };
  const dowValues = compiled.dayOfWeek;
  const schedule: CronSchedule = {
    hasSeconds,
    seconds: hasSeconds ? sortedValues(compiled.second.values) : [0],
    minutes: sortedValues(compiled.minute.values),
    hours: sortedValues(compiled.hour.values),
    months: flags(13, compiled.month.values),
    days: flags(32, compiled.dayOfMonth.values),
    lastDay: compiled.dayOfMonth.lastDay,
    weekdays: flags(7, dowValues.values),
    lastWeekdays: flags(7, dowValues.lastWeekdays),
    nthWeekdays: Array.from({ length: 7 }, (_, wd) =>
      Array.from({ length: 6 }, (_, n) => dowValues.nth.some(([w, k]) => w === wd && k === n)),
    ),
    dayOfMonthStar: dom.startsWith('*') || dom === '?',
    dayOfWeekStar: dow.startsWith('*') || dow === '?',
    wildcardTime: raw('minute').startsWith('*') || raw('hour').startsWith('*'),
  };
  return { ok: true, fields, hasSeconds, normalized: parts.join(' '), schedule };
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

/** cronstrue reads "0,7" as "Sunday and Sunday"; give it one spelling of Sunday. */
function forDescription(parsed: Extract<CronParse, { ok: true }>): string {
  return parsed.fields
    .map((f) => {
      if (f.key !== 'dayOfWeek') return f.raw;
      const items = f.raw.split(',').map((el) => (el === '7' || el.toUpperCase() === 'SUN' ? '0' : el));
      return [...new Set(items)].join(',');
    })
    .join(' ');
}

/** English description, e.g. "At 09:00, Monday through Friday". Throws for invalid expressions. */
export function describeCron(expression: string, use24Hour = true): string {
  const parsed = parseCron(expression);
  if (!parsed.ok) throw new Error(parsed.error);
  try {
    return cronstrue.toString(forDescription(parsed), {
      throwExceptionOnParseError: true,
      use24HourTimeFormat: use24Hour,
      dayOfWeekStartIndexZero: true,
      verbose: false,
    });
  } catch {
    // cronstrue rejects a few forms this parser accepts; fall back to a field-by-field summary.
    return parsed.fields.map((f) => `${CRON_FIELDS[f.key].label}: ${explainField(f.key, f.raw).toLowerCase()}`).join('; ');
  }
}

/** How the two day fields combine, in words (null when only one of them restricts the days). */
export function dayFieldsRule(parsed: Extract<CronParse, { ok: true }>): { mode: 'or' | 'and'; text: string } | null {
  const dom = parsed.fields.find((f) => f.key === 'dayOfMonth')!.raw;
  const dow = parsed.fields.find((f) => f.key === 'dayOfWeek')!.raw;
  const domAll = dom === '*' || dom === '?';
  const dowAll = dow === '*' || dow === '?';
  if (domAll || dowAll) return null;
  const { dayOfMonthStar, dayOfWeekStar } = parsed.schedule;
  if (!dayOfMonthStar && !dayOfWeekStar) {
    return {
      mode: 'or',
      text: 'Both day fields are set, so cron runs on days that match either one: the day of the month OR the day of the week.',
    };
  }
  const which = dayOfMonthStar ? `day-of-month field (${dom})` : `day-of-week field (${dow})`;
  return {
    mode: 'and',
    text: `Because the ${which} starts with “*”, classic cron (Vixie, cronie) runs only on days that match both fields. Some schedulers, such as Go’s robfig/cron and Kubernetes, treat it as a restriction and match either field instead.`,
  };
}

function nameFor(spec: CronFieldSpec, value: number): string {
  if (spec.key === 'month') return MONTH_NAMES[value - 1] ?? String(value);
  if (spec.key === 'dayOfWeek') return WEEKDAY_NAMES[value % 7] ?? String(value);
  return String(value);
}

function compress(values: number[], spec: CronFieldSpec): string {
  const out: string[] = [];
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    if (j - i >= 2) out.push(`${nameFor(spec, values[i])}–${nameFor(spec, values[j])}`);
    else for (let k = i; k <= j; k++) out.push(nameFor(spec, values[k]));
    i = j + 1;
  }
  return out.join(', ');
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

/** Human summary of which values a single field selects. */
export function explainField(key: CronFieldKey, raw: string): string {
  const spec = CRON_FIELDS[key];
  const unit = spec.label.toLowerCase();
  if (raw === '*') return `Every ${unit}`;
  if (raw === '?') return 'No specific value (any)';
  const compiled = compileField(raw, spec);
  if ('error' in compiled) return compiled.error;
  const values = sortedValues(compiled.values);
  const step = /^\*\/(\d+)$/.exec(raw);
  if (step && spec.min === 0 && key !== 'dayOfWeek' && (spec.max + 1) % Number(step[1]) === 0) {
    const n = Number(step[1]);
    return values.length <= 6 ? `Every ${n} ${unit}s (${values.join(', ')})` : `Every ${n} ${unit}s`;
  }
  const pieces: string[] = [];
  if (values.length) pieces.push(compress(values, spec));
  if (compiled.lastDay) pieces.push('the last day of the month');
  for (const wd of sortedValues(compiled.lastWeekdays)) pieces.push(`the last ${WEEKDAY_NAMES[wd]} of the month`);
  for (const [wd, n] of compiled.nth) pieces.push(`the ${ORDINALS[n]} ${WEEKDAY_NAMES[wd]} of the month`);
  const text = pieces.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface FieldInspection {
  key: CronFieldKey;
  raw: string;
  ok: boolean;
  /** The field's meaning, or what is wrong with it. */
  text: string;
}

/**
 * Explain each field on its own (so one bad field does not hide the others).
 * Macros are expanded. Null unless the expression has 5 or 6 fields.
 */
export function inspectFields(expression: string): FieldInspection[] | null {
  const text = expression.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.startsWith('@')) {
    const expanded = CRON_MACROS[text.toLowerCase()];
    return expanded ? inspectFields(expanded) : null;
  }
  const parts = text.split(' ');
  if (parts.length !== 5 && parts.length !== 6) return null;
  const keys = parts.length === 6 ? FIELDS_6 : FIELDS_5;
  return parts.map((raw, i) => {
    const key = keys[i];
    const compiled = compileField(raw, CRON_FIELDS[key]);
    if ('error' in compiled) return { key, raw, ok: false, text: compiled.error.charAt(0).toUpperCase() + compiled.error.slice(1) };
    return { key, raw, ok: true, text: explainField(key, raw) };
  });
}

/** Replace one field and return the new expression (used by the per-field editor). */
export function setField(expression: string, key: CronFieldKey, value: string): string {
  const parts = expression.trim().split(/\s+/);
  const keys = parts.length === 6 ? FIELDS_6 : FIELDS_5;
  const index = keys.indexOf(key);
  if (index < 0 || parts.length < 5) return expression;
  parts[index] = value.trim() || '*';
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Whether cron would run on this calendar day (month and both day fields). */
export function cronDayMatches(s: CronSchedule, year: number, month: number, day: number): boolean {
  if (!s.months[month]) return false;
  const dim = daysInMonth(year, month);
  const domMatch = s.days[day] || (s.lastDay && day === dim);
  const wd = dayOfWeek({ year, month, day });
  const dowMatch = s.weekdays[wd] || (s.lastWeekdays[wd] && day + 7 > dim) || s.nthWeekdays[wd][Math.ceil(day / 7)];
  return s.dayOfMonthStar || s.dayOfWeekStar ? domMatch && dowMatch : domMatch || dowMatch;
}

/** Whether the wall-clock time matches every field. */
export function cronMatches(s: CronSchedule, w: WallTime): boolean {
  return (
    s.seconds.includes(w.second) &&
    s.minutes.includes(w.minute) &&
    s.hours.includes(w.hour) &&
    cronDayMatches(s, w.year, w.month, w.day)
  );
}

function wallMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}

function ceilIn(list: number[], v: number): number {
  for (const x of list) if (x >= v) return x;
  return -1;
}

/**
 * The first matching wall-clock time strictly after `after`, or null if there
 * is none before `limit`. Wall times are plain calendar values stored as UTC
 * time values, so this knows nothing about time zones.
 */
export function nextWallMatch(s: CronSchedule, after: number, limit: number): number | null {
  const step = s.hasSeconds ? 1000 : 60_000;
  let t = Math.floor(after / step) * step + step;
  while (t < limit) {
    const w = wallFromUtc(t);
    if (!s.months[w.month]) {
      t = wallMs(w.year, w.month + 1, 1);
      continue;
    }
    if (!cronDayMatches(s, w.year, w.month, w.day)) {
      t = wallMs(w.year, w.month, w.day + 1);
      continue;
    }
    const h = ceilIn(s.hours, w.hour);
    if (h < 0) {
      t = wallMs(w.year, w.month, w.day + 1);
      continue;
    }
    if (h > w.hour) {
      t = wallMs(w.year, w.month, w.day, h);
      continue;
    }
    const m = ceilIn(s.minutes, w.minute);
    if (m < 0) {
      t = wallMs(w.year, w.month, w.day, w.hour + 1);
      continue;
    }
    if (m > w.minute) {
      t = wallMs(w.year, w.month, w.day, w.hour, m);
      continue;
    }
    const sec = ceilIn(s.seconds, w.second);
    if (sec < 0) {
      t = wallMs(w.year, w.month, w.day, w.hour, w.minute + 1);
      continue;
    }
    if (sec > w.second) {
      t = wallMs(w.year, w.month, w.day, w.hour, w.minute, sec);
      continue;
    }
    return t;
  }
  return null;
}

const MAX_DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** A plain-language reason when the day fields can never match (e.g. February 30), else null. */
export function neverRunsReason(s: CronSchedule): string | null {
  // Only a day-of-month restriction combined (AND) with "every weekday" can be impossible outright.
  if (!s.dayOfWeekStar || s.lastDay || !s.weekdays.every(Boolean)) return null;
  const days = s.days.map((on, d) => (on ? d : 0)).filter(Boolean);
  const months = s.months.map((on, m) => (on ? m : 0)).filter(Boolean);
  if (days.length === 0 || months.length === 0) return null;
  const smallest = days[0];
  if (months.some((m) => smallest <= MAX_DAYS[m])) return null;
  const dayText = days.length === 1 ? `Day ${smallest}` : `Days ${joinOr(days.map(String)).replace(' or ', ' and ')}`;
  return `${dayText} never ${days.length === 1 ? 'occurs' : 'occur'} in ${joinOr(months.map((m) => MONTH_NAMES[m - 1]))}, so this schedule never runs.`;
}

// ---------------------------------------------------------------------------
// Run times in a time zone
// ---------------------------------------------------------------------------

export type CronDstEffect =
  /** Scheduled inside skipped time; runs at the instant the clocks jump forward. */
  | 'moved'
  /** Scheduled inside time that will repeat; a fixed-time job runs only this once. */
  | 'once'
  /** Second run of a wildcard job during repeated time after clocks fall back. */
  | 'repeated';

export interface CronRun {
  epochMs: number;
  /** The matching wall-clock time in the zone (for `moved` runs, the skipped time it was scheduled for). */
  scheduled: WallTime;
  dst?: CronDstEffect;
}

export interface CronSkip {
  /** When the clocks jump forward. */
  epochMs: number;
  /** The wall-clock range [from, to) that does not exist that day. */
  from: WallTime;
  to: WallTime;
  /** Matching times inside that range that do not run (capped at 10,000). */
  count: number;
  /** `wildcard`: wildcard jobs follow the new clock; `long-gap`: jumps over 3 hours are not caught up. */
  reason: 'wildcard' | 'long-gap';
}

export interface CronPreview {
  runs: CronRun[];
  skipped: CronSkip[];
  /** Fewer than the requested runs exist within the search horizon. */
  exhausted: boolean;
}

const CATCH_UP_LIMIT = 3 * MS_PER_HOUR;

/**
 * The next `count` run times strictly after `from`, for a cron daemon whose
 * clock is set to `zone`, with Vixie/ISC cron's daylight-saving rules.
 */
export function cronRuns(
  s: CronSchedule,
  options: { from: number; zone: string; count: number; horizonYears?: number },
): CronPreview {
  const { from, zone, count } = options;
  const limit = Math.min(from + (options.horizonYears ?? 100) * 365.25 * MS_PER_DAY, MAX_EPOCH_MS - 2 * MS_PER_DAY);
  const runs: CronRun[] = [];
  const skipped: CronSkip[] = [];
  const push = (run: CronRun) => {
    const last = runs[runs.length - 1];
    if (!last || run.epochMs > last.epochMs) runs.push(run);
  };

  let offset = tzOffsetMs(from, zone);
  let segStart = from;
  let cursor = from + offset; // wall time; search strictly after it
  // Starting inside the second pass of a fall-back hour: fixed-time jobs must not run again.
  let repeated: { start: number; end: number } | null = null;
  const previous = nextTransition(zone, from - MS_PER_DAY, 1);
  if (previous && previous.epochMs <= from && previous.toOffset < previous.fromOffset) {
    const end = previous.epochMs + previous.fromOffset;
    if (cursor < end) repeated = { start: previous.epochMs + previous.toOffset, end };
  }

  while (runs.length < count && segStart < limit) {
    const transition = nextTransition(zone, segStart, 400);
    const segEnd = transition ? Math.min(transition.epochMs, limit) : Math.min(segStart + 400 * MS_PER_DAY, limit);
    const segEndWall = segEnd + offset;
    // A later fall back repeats [T + new offset, T + old offset): fixed-time jobs there run only once.
    const willRepeat =
      transition && transition.epochMs <= limit && transition.toOffset < transition.fromOffset
        ? transition.epochMs + transition.toOffset
        : Infinity;

    for (let w = nextWallMatch(s, cursor, segEndWall); w !== null && runs.length < count; w = nextWallMatch(s, w, segEndWall)) {
      const inRepeat = repeated !== null && w >= repeated.start && w < repeated.end;
      if (inRepeat && !s.wildcardTime) continue; // already ran before the clocks fell back
      push({
        epochMs: w - offset,
        scheduled: wallFromUtc(w),
        dst: inRepeat ? 'repeated' : !s.wildcardTime && w >= willRepeat ? 'once' : undefined,
      });
    }
    if (runs.length >= count || !transition || transition.epochMs > limit) {
      segStart = segEnd;
      cursor = segEndWall - 1;
      repeated = null;
      continue;
    }

    const T = transition.epochMs;
    const { fromOffset, toOffset } = transition;
    repeated = null;
    if (toOffset > fromOffset) {
      // Clocks jump forward: wall times [T + fromOffset, T + toOffset) never happen.
      const gapStart = T + fromOffset;
      const gapEnd = T + toOffset;
      const first = nextWallMatch(s, gapStart - 1, gapEnd);
      if (first !== null) {
        if (!s.wildcardTime && gapEnd - gapStart <= CATCH_UP_LIMIT) {
          push({ epochMs: T, scheduled: wallFromUtc(first), dst: 'moved' });
        } else {
          let n = 0;
          for (let x: number | null = first; x !== null && n < 10_000; x = nextWallMatch(s, x, gapEnd)) n++;
          skipped.push({
            epochMs: T,
            from: wallFromUtc(gapStart),
            to: wallFromUtc(gapEnd),
            count: n,
            reason: s.wildcardTime ? 'wildcard' : 'long-gap',
          });
        }
      }
    } else if (toOffset < fromOffset) {
      // Clocks fall back: wall times [T + toOffset, T + fromOffset) happen a second time.
      repeated = { start: T + toOffset, end: T + fromOffset };
    }
    segStart = T;
    offset = toOffset;
    cursor = T + toOffset - 1;
  }

  const shown = runs.slice(0, count);
  const lastShown = shown.length === count ? shown[count - 1].epochMs : Infinity;
  return {
    runs: shown,
    skipped: skipped.filter((sk) => sk.epochMs <= lastShown),
    exhausted: shown.length < count,
  };
}

export type CronRunsResult = { ok: true; value: CronPreview } | { ok: false; error: string };

/** Parse `expression` and list its next runs in `zone`. */
export function nextRuns(expression: string, options: { from: number | Date; zone: string; count: number }): CronRunsResult {
  const parsed = parseCron(expression);
  if (!parsed.ok) return parsed;
  const never = neverRunsReason(parsed.schedule);
  if (never) return { ok: false, error: never };
  const from = typeof options.from === 'number' ? options.from : options.from.getTime();
  const count = Math.max(1, Math.min(Math.floor(options.count), 500));
  const preview = cronRuns(parsed.schedule, { from, zone: options.zone, count });
  if (preview.runs.length === 0 && preview.skipped.length === 0) {
    return { ok: false, error: 'This schedule does not run at any time in the next 100 years.' };
  }
  return { ok: true, value: preview };
}
