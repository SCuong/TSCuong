export interface MimeRecord {
  source?: string;
  charset?: string;
  compressible?: boolean;
  extensions?: string[];
}

export type MimeDb = Record<string, MimeRecord>;

export interface MimeEntry {
  type: string;
  source: string | null;
  charset: string | null;
  compressible: boolean | null;
  extensions: string[];
}

export function toEntries(db: MimeDb): MimeEntry[] {
  return Object.entries(db)
    .map(([type, r]) => ({
      type,
      source: r.source ?? null,
      charset: r.charset ?? null,
      compressible: r.compressible ?? null,
      extensions: r.extensions ?? [],
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

const SOURCE_SCORE: Record<string, number> = { iana: 40, apache: 20, nginx: 10 };
const TOP_LEVEL_SCORE: Record<string, number> = { video: 2, audio: 2, image: 2, font: 2, model: 2, application: 1 };

/**
 * Ranks candidate types for an extension. Standard subtypes beat vendor (vnd.),
 * experimental (x-) and personal (prs.) ones; IANA registrations beat types that
 * mime-db added itself, which beat the Apache and nginx lists; remaining ties
 * prefer a media-specific top-level type (so .mp4 is video/mp4) over application/,
 * and application/ over text/.
 */
export function mimeScore(entry: Pick<MimeEntry, 'type' | 'source'>): number {
  const [top, sub = ''] = entry.type.split('/');
  const facet = sub.startsWith('vnd.') ? 400 : sub.startsWith('x-') || sub.startsWith('x.') ? 200 : sub.startsWith('prs.') ? 100 : 900;
  const source = entry.source ? (SOURCE_SCORE[entry.source] ?? 30) : 30;
  return facet + source + (TOP_LEVEL_SCORE[top] ?? 0);
}

/** Normalizes ".PNG", "png", "photo.PNG" or "archive.tar.gz" to a bare lower-case extension. */
export function normalizeExtension(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  const base = s.split(/[\\/]/).pop() ?? s;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : base;
}

export interface ExtensionLookup {
  extension: string;
  preferred: MimeEntry | null;
  candidates: MimeEntry[];
}

export function lookupExtension(entries: MimeEntry[], input: string): ExtensionLookup {
  const extension = normalizeExtension(input);
  const candidates = extension
    ? entries
        .filter((e) => e.extensions.includes(extension))
        .sort((a, b) => mimeScore(b) - mimeScore(a) || a.type.localeCompare(b.type))
    : [];
  return { extension, preferred: candidates[0] ?? null, candidates };
}

/** Finds a type, ignoring case and parameters such as "; charset=utf-8". */
export function lookupType(entries: MimeEntry[], input: string): MimeEntry | null {
  const t = input.split(';')[0].trim().toLowerCase();
  if (!t) return null;
  return entries.find((e) => e.type === t) ?? null;
}

export type QueryKind = 'type' | 'extension' | 'text';

export function classifyQuery(input: string): QueryKind {
  const s = input.trim();
  if (!s) return 'text';
  if (/^[a-z0-9.+-]+\/[a-z0-9.+*-]*$/i.test(s.split(';')[0].trim())) return 'type';
  if (/^\.?[a-z0-9_+-]{1,15}$/i.test(s) || /^[^\s/\\]+\.[a-z0-9_+-]{1,15}$/i.test(s)) return 'extension';
  return 'text';
}

/** Substring search over types and extensions. Exact matches rank first. */
export function searchMime(entries: MimeEntry[], input: string): MimeEntry[] {
  const q = input.trim().toLowerCase().replace(/^\./, '');
  if (!q) return entries;
  const ext = normalizeExtension(input);
  const scored: Array<[MimeEntry, number]> = [];
  for (const e of entries) {
    let score = 0;
    if (e.type === q) score = 100;
    else if (e.extensions.includes(ext)) score = 90;
    else if (e.type.split('/')[1] === q) score = 80;
    else if (e.type.includes(q)) score = 50;
    else if (e.extensions.some((x) => x.includes(q))) score = 30;
    if (score) scored.push([e, score]);
  }
  return scored.sort((a, b) => b[1] - a[1] || mimeScore(b[0]) - mimeScore(a[0]) || a[0].type.localeCompare(b[0].type)).map(([e]) => e);
}
