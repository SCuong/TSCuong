/** Data transfer time / bandwidth / size calculations. Sizes are bytes, rates are bits per second. */

export interface SizeUnit {
  id: string;
  label: string;
  bytes: number;
}

export interface RateUnit {
  id: string;
  label: string;
  bitsPerSecond: number;
}

export const SIZE_UNITS: SizeUnit[] = [
  { id: 'b', label: 'B', bytes: 1 },
  { id: 'kb', label: 'kB', bytes: 1e3 },
  { id: 'mb', label: 'MB', bytes: 1e6 },
  { id: 'gb', label: 'GB', bytes: 1e9 },
  { id: 'tb', label: 'TB', bytes: 1e12 },
  { id: 'pb', label: 'PB', bytes: 1e15 },
  { id: 'kib', label: 'KiB', bytes: 2 ** 10 },
  { id: 'mib', label: 'MiB', bytes: 2 ** 20 },
  { id: 'gib', label: 'GiB', bytes: 2 ** 30 },
  { id: 'tib', label: 'TiB', bytes: 2 ** 40 },
  { id: 'pib', label: 'PiB', bytes: 2 ** 50 },
  { id: 'gbit', label: 'Gbit', bytes: 1e9 / 8 },
];

export const RATE_UNITS: RateUnit[] = [
  { id: 'bps', label: 'bit/s', bitsPerSecond: 1 },
  { id: 'kbps', label: 'kbit/s', bitsPerSecond: 1e3 },
  { id: 'mbps', label: 'Mbit/s', bitsPerSecond: 1e6 },
  { id: 'gbps', label: 'Gbit/s', bitsPerSecond: 1e9 },
  { id: 'Bps', label: 'B/s', bitsPerSecond: 8 },
  { id: 'kBps', label: 'kB/s', bitsPerSecond: 8e3 },
  { id: 'MBps', label: 'MB/s', bitsPerSecond: 8e6 },
  { id: 'GBps', label: 'GB/s', bitsPerSecond: 8e9 },
  { id: 'KiBps', label: 'KiB/s', bitsPerSecond: 8 * 2 ** 10 },
  { id: 'MiBps', label: 'MiB/s', bitsPerSecond: 8 * 2 ** 20 },
  { id: 'GiBps', label: 'GiB/s', bitsPerSecond: 8 * 2 ** 30 },
];

export interface RatePreset {
  label: string;
  value: number;
  unit: string;
  note?: string;
}

/** Nominal link rates. Real-world throughput is lower; use the overhead field to account for it. */
export const RATE_PRESETS: RatePreset[] = [
  { label: '56k modem', value: 56, unit: 'kbps' },
  { label: '10 Mbit/s', value: 10, unit: 'mbps' },
  { label: '100 Mbit/s', value: 100, unit: 'mbps', note: 'Fast Ethernet' },
  { label: '1 Gbit/s', value: 1, unit: 'gbps', note: 'Gigabit Ethernet' },
  { label: '2.5 Gbit/s', value: 2.5, unit: 'gbps' },
  { label: '10 Gbit/s', value: 10, unit: 'gbps' },
  { label: 'USB 2.0', value: 480, unit: 'mbps', note: 'Hi-Speed, 480 Mbit/s' },
  { label: 'USB 3.2 Gen 1', value: 5, unit: 'gbps', note: 'a.k.a. USB 3.0, 5 Gbit/s' },
  { label: 'USB 3.2 Gen 2', value: 10, unit: 'gbps', note: '10 Gbit/s' },
  { label: 'Thunderbolt 4', value: 40, unit: 'gbps', note: '40 Gbit/s' },
  { label: 'SATA III', value: 6, unit: 'gbps', note: '6 Gbit/s' },
];

export interface SizePreset {
  label: string;
  value: number;
  unit: string;
}

export const SIZE_PRESETS: SizePreset[] = [
  { label: 'CD (700 MiB)', value: 700, unit: 'mib' },
  { label: 'DVD (4.7 GB)', value: 4.7, unit: 'gb' },
  { label: 'Blu-ray (25 GB)', value: 25, unit: 'gb' },
  { label: '1 GB', value: 1, unit: 'gb' },
  { label: '100 GB', value: 100, unit: 'gb' },
  { label: '1 TB', value: 1, unit: 'tb' },
];

export function sizeUnit(id: string): SizeUnit {
  return SIZE_UNITS.find((u) => u.id === id) ?? SIZE_UNITS[3];
}

export function rateUnit(id: string): RateUnit {
  return RATE_UNITS.find((u) => u.id === id) ?? RATE_UNITS[2];
}

export type Calc = { ok: true; value: number } | { ok: false; error: string };

function checkOverhead(overheadPct: number): string | null {
  if (!Number.isFinite(overheadPct) || overheadPct < 0 || overheadPct >= 100) return 'Overhead must be from 0 up to (but not including) 100%.';
  return null;
}

/** Seconds to move `bytes` over a link of `bitsPerSecond`, of which `overheadPct`% is lost to protocol overhead. */
export function transferTime(bytes: number, bitsPerSecond: number, overheadPct = 0): Calc {
  const oh = checkOverhead(overheadPct);
  if (oh) return { ok: false, error: oh };
  if (bytes < 0) return { ok: false, error: 'The size cannot be negative.' };
  if (bitsPerSecond <= 0) return { ok: false, error: 'The bandwidth must be greater than 0.' };
  return { ok: true, value: (bytes * 8) / (bitsPerSecond * (1 - overheadPct / 100)) };
}

/** Link rate (bit/s) needed to move `bytes` in `seconds`, including overhead. */
export function requiredRate(bytes: number, seconds: number, overheadPct = 0): Calc {
  const oh = checkOverhead(overheadPct);
  if (oh) return { ok: false, error: oh };
  if (bytes < 0) return { ok: false, error: 'The size cannot be negative.' };
  if (seconds <= 0) return { ok: false, error: 'The time must be greater than 0.' };
  return { ok: true, value: (bytes * 8) / seconds / (1 - overheadPct / 100) };
}

/** Bytes moved in `seconds` over `bitsPerSecond` after overhead. */
export function transferableSize(bitsPerSecond: number, seconds: number, overheadPct = 0): Calc {
  const oh = checkOverhead(overheadPct);
  if (oh) return { ok: false, error: oh };
  if (bitsPerSecond < 0) return { ok: false, error: 'The bandwidth cannot be negative.' };
  if (seconds < 0) return { ok: false, error: 'The time cannot be negative.' };
  return { ok: true, value: (bitsPerSecond * (1 - overheadPct / 100) * seconds) / 8 };
}

const DURATION_UNITS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86_400,
  day: 86_400,
  days: 86_400,
  w: 604_800,
  wk: 604_800,
  week: 604_800,
  weeks: 604_800,
};

/**
 * Parse a duration: "90" (seconds), "1:30" (MM:SS), "1:02:03" (HH:MM:SS), "1.5h", "2h 30m", "1d 4h 5m 6s".
 * Returns seconds, or an error sentence.
 */
export function parseDuration(input: string): Calc {
  const text = input.trim().toLowerCase();
  if (!text) return { ok: false, error: 'Enter a time.' };
  if (/^\d+(\.\d+)?$/.test(text)) return { ok: true, value: Number(text) };
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    const parts = text.split(':').map(Number);
    const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    if (m >= 60 && parts.length === 3) return { ok: false, error: 'Minutes must be below 60 in HH:MM:SS.' };
    if (s >= 60) return { ok: false, error: 'Seconds must be below 60.' };
    return { ok: true, value: h * 3600 + m * 60 + s };
  }
  const cleaned = text.replace(/,|\band\b/g, ' ');
  if (!/^(\s*\d+(\.\d+)?\s*[a-zµ]+\s*)+$/.test(cleaned)) {
    return { ok: false, error: 'Could not read that time. Try 90, 1:30:00, 1.5h or 2h 30m.' };
  }
  const re = /(\d+(?:\.\d+)?)\s*([a-zµ]+)/g;
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const factor = DURATION_UNITS[match[2]];
    if (factor === undefined) return { ok: false, error: `Unknown time unit "${match[2]}". Use s, min, h, d or HH:MM:SS.` };
    total += Number(match[1]) * factor;
  }
  return { ok: true, value: total };
}

/** "HH:MM:SS" (hours may exceed 24); sub-10-second values show milliseconds. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞';
  const neg = seconds < 0;
  let s = Math.abs(seconds);
  const showMs = s < 10;
  if (!showMs) s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const secText = showMs ? sec.toFixed(3).padStart(6, '0') : pad(Math.round(sec));
  return `${neg ? '-' : ''}${pad(h)}:${pad(m)}:${secText}`;
}

/** Human text like "2 days 3 hours 4 minutes", "1.5 seconds", "250 ms" (at most 3 parts). */
export function formatHumanDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'forever';
  if (seconds === 0) return '0 seconds';
  if (seconds < 1e-3) return `${+(seconds * 1e6).toPrecision(3)} µs`;
  if (seconds < 1) return `${+(seconds * 1000).toPrecision(3)} ms`;
  if (seconds < 60) return `${+seconds.toPrecision(3)} second${seconds === 1 ? '' : 's'}`;
  const YEAR = 31_556_952;
  if (seconds >= 100 * YEAR) return `${(seconds / YEAR).toExponential(2).replace('e+', 'e')} years`;
  const units: Array<[string, number]> = [
    ['year', YEAR],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  let rest = Math.round(seconds);
  const parts: string[] = [];
  for (const [name, size] of units) {
    if (parts.length === 3) break;
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${name}${n === 1 ? '' : 's'}`);
      rest -= n * size;
    }
  }
  return parts.join(' ');
}

/** Choose the largest unit whose size is ≤ |value| (falls back to the smallest). Units must be in ascending order. */
export function pickUnit<T>(value: number, units: T[], size: (unit: T) => number): T {
  const abs = Math.abs(value);
  let best = units[0];
  for (const unit of units) if (abs >= size(unit)) best = unit;
  return best;
}

const BIT_RATES = ['bps', 'kbps', 'mbps', 'gbps'].map(rateUnit);
const SI_BYTE_RATES = ['Bps', 'kBps', 'MBps', 'GBps'].map(rateUnit);
const IEC_BYTE_RATES = ['Bps', 'KiBps', 'MiBps', 'GiBps'].map(rateUnit);
const SI_SIZES = ['b', 'kb', 'mb', 'gb', 'tb', 'pb'].map(sizeUnit);
const IEC_SIZES = ['b', 'kib', 'mib', 'gib', 'tib', 'pib'].map(sizeUnit);

export interface Scaled {
  value: number;
  unit: string;
}

/** A rate in bit/s expressed in the best decimal-bit, SI-byte and IEC-byte units. */
export function describeRate(bitsPerSecond: number): { bits: Scaled; si: Scaled; iec: Scaled } {
  const scale = (units: RateUnit[]): Scaled => {
    const u = pickUnit(bitsPerSecond, units, (x) => x.bitsPerSecond);
    return { value: bitsPerSecond / u.bitsPerSecond, unit: u.label };
  };
  return { bits: scale(BIT_RATES), si: scale(SI_BYTE_RATES), iec: scale(IEC_BYTE_RATES) };
}

/** A size in bytes expressed in the best SI and IEC units. */
export function describeSize(bytes: number): { si: Scaled; iec: Scaled } {
  const scale = (units: SizeUnit[]): Scaled => {
    const u = pickUnit(bytes, units, (x) => x.bytes);
    return { value: bytes / u.bytes, unit: u.label };
  };
  return { si: scale(SI_SIZES), iec: scale(IEC_SIZES) };
}
