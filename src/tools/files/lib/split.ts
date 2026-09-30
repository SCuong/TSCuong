/** File splitting math, part naming and ordering parts for joining. Pure. */

export const MAX_PARTS = 10000;

export interface PartRange {
  index: number;
  start: number;
  end: number;
}

export type SplitSpec = { mode: 'parts'; parts: number } | { mode: 'size'; partSize: number };

export type PlanResult = { ok: true; parts: PartRange[] } | { ok: false; error: string };

/** Byte ranges for splitting a file of `size` bytes. Sizes are as equal as possible in "parts" mode. */
export function planSplit(size: number, spec: SplitSpec): PlanResult {
  if (!Number.isSafeInteger(size) || size < 0) return { ok: false, error: 'Invalid file size.' };
  if (size === 0)
    return {
      ok: false,
      error: 'The file is empty, so there is nothing to split.',
    };
  if (spec.mode === 'parts') {
    const n = spec.parts;
    if (!Number.isInteger(n) || n < 2) return { ok: false, error: 'Choose at least 2 parts.' };
    if (n > MAX_PARTS)
      return {
        ok: false,
        error: `At most ${MAX_PARTS.toLocaleString()} parts are supported.`,
      };
    if (n > size)
      return {
        ok: false,
        error: `A ${size.toLocaleString()}-byte file can be split into at most ${size.toLocaleString()} parts.`,
      };
    const base = Math.floor(size / n);
    const extra = size % n;
    const parts: PartRange[] = [];
    let start = 0;
    for (let i = 0; i < n; i++) {
      const len = base + (i < extra ? 1 : 0);
      parts.push({ index: i, start, end: start + len });
      start += len;
    }
    return { ok: true, parts };
  }
  const s = spec.partSize;
  if (!Number.isFinite(s) || s < 1) return { ok: false, error: 'The part size must be at least 1 byte.' };
  const partSize = Math.floor(s);
  if (partSize >= size)
    return {
      ok: false,
      error: 'The part size is not smaller than the file, so it would produce a single part.',
    };
  const count = Math.ceil(size / partSize);
  if (count > MAX_PARTS)
    return {
      ok: false,
      error: `That would create ${count.toLocaleString()} parts; the limit is ${MAX_PARTS.toLocaleString()}. Use a larger part size.`,
    };
  const parts: PartRange[] = [];
  for (let i = 0; i < count; i++)
    parts.push({
      index: i,
      start: i * partSize,
      end: Math.min(size, (i + 1) * partSize),
    });
  return { ok: true, parts };
}

/** "video.mp4.001" style names; at least 3 digits, more when there are over 999 parts. */
export function partName(fileName: string, index: number, total: number): string {
  const width = Math.max(3, String(total).length);
  return `${fileName}.${String(index + 1).padStart(width, '0')}`;
}

/** Binary multiples (the keys are kept for saved settings; the UI shows KiB, MiB and GiB). */
export const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;
export type Unit = keyof typeof UNITS;
export const UNIT_LABELS: Record<Unit, string> = { B: 'bytes', KB: 'KiB', MB: 'MiB', GB: 'GiB' };

/**
 * Presets that really fit common limits. Email attachments are Base64-encoded (about 4/3 larger) and the
 * limit counts the encoded message, so a part must stay well below the advertised size.
 */
export const SIZE_PRESETS: Array<{ label: string; bytes: number }> = [
  { label: '7 MiB (fits 10 MB email limits)', bytes: 7 * UNITS.MB },
  { label: '17 MiB (fits 25 MB email limits)', bytes: 17 * UNITS.MB },
  { label: '100 MiB', bytes: 100 * UNITS.MB },
  { label: '700 MiB (CD)', bytes: 700 * UNITS.MB },
  { label: '4 GiB − 1 byte (FAT32 maximum)', bytes: 4 * UNITS.GB - 1 },
];

export interface PartInfo<T> {
  item: T;
  name: string;
  /** Parsed part number, or null if the name carries none. */
  number: number | null;
  /** Name of the original file, derived from the part name. */
  original: string | null;
}

const NUMBERED = /^(.*?)[._-]?(?:part)?(\d{1,6})$/i;

/** Parse "file.zip.001", "file.zip.part3", "file.zip_002" → { original, number }. */
export function parsePartName(name: string): {
  original: string | null;
  number: number | null;
} {
  const dotted = /^(.+)\.(?:part)?(\d{1,6})$/i.exec(name);
  if (dotted) return { original: dotted[1], number: Number(dotted[2]) };
  const loose = NUMBERED.exec(name);
  if (loose && loose[1])
    return {
      original: loose[1].replace(/[._-]$/, ''),
      number: Number(loose[2]),
    };
  return { original: null, number: null };
}

export interface OrderResult<T> {
  parts: Array<PartInfo<T>>;
  /** Missing part numbers between the lowest and highest. */
  missing: number[];
  duplicates: number[];
  /** Suggested output name. */
  outputName: string;
  /** True when parts were ordered by their numbers (false: by name). */
  numbered: boolean;
}

/** Sort parts for joining: by part number when every name has one, else by natural name order (e.g. split's xaa, xab). */
export function orderParts<T>(items: T[], nameOf: (item: T) => string): OrderResult<T> {
  const infos: Array<PartInfo<T>> = items.map((item) => {
    const name = nameOf(item);
    return { item, name, ...parsePartName(name) };
  });
  const numbered = infos.length > 0 && infos.every((p) => p.number !== null);
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  const parts = [...infos].sort((a, b) => (numbered ? a.number! - b.number! : 0) || collator.compare(a.name, b.name));
  const missing: number[] = [];
  const duplicates: number[] = [];
  if (numbered && parts.length) {
    const seen = new Set<number>();
    for (const p of parts) {
      if (seen.has(p.number!)) {
        if (!duplicates.includes(p.number!)) duplicates.push(p.number!);
      }
      seen.add(p.number!);
    }
    const lo = parts[0].number!;
    const hi = parts[parts.length - 1].number!;
    // Numbering starts at 1 (or 0, when a part 0 exists).
    for (let n = Math.min(lo, 1); n <= hi && missing.length < 50; n++) if (!seen.has(n)) missing.push(n);
  }
  const originals = [...new Set(parts.map((p) => p.original).filter((o): o is string => Boolean(o)))];
  const outputName =
    originals.length === 1 ? originals[0] : parts.length ? `${parts[0].name.replace(/\.[^.]*$/, '') || 'joined'}.joined` : 'joined';
  return { parts, missing, duplicates, outputName, numbered };
}

/** Move an item within a list (for manual reordering). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}
