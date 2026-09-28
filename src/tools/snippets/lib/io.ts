import { PLAIN_LANGUAGE_ID, resolveLanguageId } from './languages';
import { MAX_TITLE_LENGTH, fallbackTitle, normalizeTags, type Snippet } from './model';

export const EXPORT_FORMAT = 'localkit-snippets';
export const EXPORT_VERSION = 1;
/** Refuse absurd imports that would freeze the tab. */
export const MAX_IMPORT_SNIPPETS = 50_000;
export const MAX_CODE_LENGTH = 2_000_000;

export interface SnippetExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  count: number;
  snippets: Snippet[];
}

export function exportSnippets(snippets: readonly Snippet[], now = new Date()): string {
  const payload: SnippetExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    count: snippets.length,
    snippets: snippets.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      language: s.language,
      code: s.code,
      tags: [...s.tags],
      favorite: s.favorite,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      copyCount: s.copyCount,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export interface ParsedImport {
  snippets: Snippet[];
  /** Per-item problems that caused an item to be skipped. */
  errors: string[];
  /** Non-fatal adjustments (unknown language, bad timestamps, …). */
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Parse and validate an import file. Accepts this app's export format, a bare
 * array of snippet objects, or a single snippet object. Throws an Error with a
 * human readable message when the file as a whole is unusable.
 */
export function parseImport(text: string, makeId: () => string, now = Date.now()): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  let items: unknown[];
  if (Array.isArray(data)) items = data;
  else if (isRecord(data) && Array.isArray(data.snippets)) {
    if (data.format !== undefined && data.format !== EXPORT_FORMAT) {
      throw new Error(`Unrecognized format "${String(data.format)}". Expected a LocalKit snippets export.`);
    }
    if (typeof data.version === 'number' && data.version > EXPORT_VERSION) {
      throw new Error(`This export was made by a newer version (format v${data.version}). Update LocalKit and try again.`);
    }
    items = data.snippets;
  } else if (isRecord(data) && typeof data.code === 'string') items = [data];
  else throw new Error('No snippets found. Expected a LocalKit snippets export or an array of snippets.');

  if (items.length > MAX_IMPORT_SNIPPETS) {
    throw new Error(`This file has ${items.length} snippets; the limit per import is ${MAX_IMPORT_SNIPPETS}.`);
  }

  const result: ParsedImport = { snippets: [], errors: [], warnings: [] };
  const unknownLanguages = new Set<string>();
  const seenIds = new Set<string>();
  let fixedDates = 0;
  let duplicateIds = 0;

  items.forEach((item, i) => {
    const label = `Item ${i + 1}`;
    if (!isRecord(item)) {
      result.errors.push(`${label}: not an object.`);
      return;
    }
    const code = typeof item.code === 'string' ? item.code : typeof item.content === 'string' ? item.content : null;
    if (code === null) {
      result.errors.push(`${label}: missing "code" text.`);
      return;
    }
    if (code.length > MAX_CODE_LENGTH) {
      result.errors.push(`${label}: code is larger than 2 MB.`);
      return;
    }
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : typeof item.name === 'string' ? item.name.trim() : '';
    if (!rawTitle && !code.trim()) {
      result.errors.push(`${label}: both title and code are empty.`);
      return;
    }
    let language = PLAIN_LANGUAGE_ID;
    if (item.language !== undefined && item.language !== null && item.language !== '') {
      const resolved = resolveLanguageId(item.language);
      if (resolved) language = resolved;
      else unknownLanguages.add(String(item.language));
    }
    let tags: string[] = [];
    if (Array.isArray(item.tags)) tags = normalizeTags(item.tags.filter((t): t is string => typeof t === 'string'));
    else if (typeof item.tags === 'string') tags = normalizeTags(item.tags.split(','));

    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 100) : makeId();
    if (seenIds.has(id)) {
      duplicateIds++;
      id = makeId();
    }
    seenIds.add(id);

    let createdAt = toTimestamp(item.createdAt);
    let updatedAt = toTimestamp(item.updatedAt);
    if (createdAt === null || updatedAt === null) fixedDates++;
    createdAt ??= updatedAt ?? now;
    updatedAt ??= createdAt;

    const copyCount =
      typeof item.copyCount === 'number' && Number.isFinite(item.copyCount) && item.copyCount >= 0
        ? Math.floor(item.copyCount)
        : 0;

    result.snippets.push({
      id,
      title: (rawTitle || fallbackTitle(code)).slice(0, MAX_TITLE_LENGTH),
      description: typeof item.description === 'string' ? item.description : '',
      language,
      code,
      tags,
      favorite: item.favorite === true,
      createdAt,
      updatedAt,
      copyCount,
    });
  });

  if (unknownLanguages.size) {
    result.warnings.push(
      `Unknown language${unknownLanguages.size > 1 ? 's' : ''} ${[...unknownLanguages].slice(0, 5).map((l) => `"${l}"`).join(', ')} imported as plain text.`,
    );
  }
  if (fixedDates) result.warnings.push(`${fixedDates} snippet${fixedDates > 1 ? 's' : ''} had missing or invalid dates.`);
  if (duplicateIds) result.warnings.push(`${duplicateIds} duplicate id${duplicateIds > 1 ? 's' : ''} inside the file got new ids.`);
  return result;
}

export type ConflictStrategy = 'keep-both' | 'replace' | 'skip';

export interface ImportPlan {
  toPut: Snippet[];
  added: number;
  replaced: number;
  /** Conflicting snippets imported as new copies with new ids. */
  copied: number;
  skipped: number;
  /** Identical to an existing snippet (same id and content) — ignored. */
  unchanged: number;
  conflicts: number;
}

function sameContent(a: Snippet, b: Snippet): boolean {
  return (
    a.title === b.title &&
    a.code === b.code &&
    a.language === b.language &&
    a.description === b.description &&
    a.tags.join('\u0000') === b.tags.join('\u0000')
  );
}

/** Decide what to write for an import given the existing library and a conflict strategy. */
export function planImport(
  existing: readonly Snippet[],
  incoming: readonly Snippet[],
  strategy: ConflictStrategy,
  makeId: () => string,
): ImportPlan {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const plan: ImportPlan = { toPut: [], added: 0, replaced: 0, copied: 0, skipped: 0, unchanged: 0, conflicts: 0 };
  for (const snippet of incoming) {
    const current = byId.get(snippet.id);
    if (!current) {
      plan.toPut.push(snippet);
      plan.added++;
      continue;
    }
    if (sameContent(current, snippet)) {
      plan.unchanged++;
      continue;
    }
    plan.conflicts++;
    if (strategy === 'skip') plan.skipped++;
    else if (strategy === 'replace') {
      plan.toPut.push(snippet);
      plan.replaced++;
    } else {
      plan.toPut.push({ ...snippet, id: makeId() });
      plan.copied++;
    }
  }
  return plan;
}

export function countConflicts(existing: readonly Snippet[], incoming: readonly Snippet[]): number {
  return planImport(existing, incoming, 'skip', () => '').conflicts;
}
