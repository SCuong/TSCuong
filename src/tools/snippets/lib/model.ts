import { PLAIN_LANGUAGE_ID } from './languages';

export interface Snippet {
  id: string;
  title: string;
  description: string;
  language: string;
  code: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  /** How many times the code was copied from the manager. */
  copyCount: number;
}

export interface SnippetDraft {
  title: string;
  description: string;
  language: string;
  code: string;
  tags: string[];
}

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_TITLE_LENGTH = 200;

export function emptyDraft(language = PLAIN_LANGUAGE_ID): SnippetDraft {
  return { title: '', description: '', language, code: '', tags: [] };
}

export function draftFromSnippet(s: Snippet): SnippetDraft {
  return { title: s.title, description: s.description, language: s.language, code: s.code, tags: [...s.tags] };
}

/** Normalize a tag: trimmed, lowercase, inner whitespace collapsed to '-', leading '#' removed. */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, MAX_TAG_LENGTH);
}

export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Split free text like "react, hooks #state" into tags. */
export function parseTagInput(text: string): string[] {
  return normalizeTags(text.split(/[,\s]+/));
}

export function draftsEqual(a: SnippetDraft, b: SnippetDraft): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.language === b.language &&
    a.code === b.code &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i])
  );
}

/** Title shown when the user left it blank: the first non-empty code line, shortened. */
export function fallbackTitle(code: string): string {
  const line = code
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return 'Untitled snippet';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export function validateDraft(draft: SnippetDraft): string | null {
  if (!draft.code.trim() && !draft.title.trim()) return 'Add a title or some code before saving.';
  if (draft.title.length > MAX_TITLE_LENGTH) return `The title is too long (max ${MAX_TITLE_LENGTH} characters).`;
  return null;
}

export function createSnippet(draft: SnippetDraft, id: string, now = Date.now()): Snippet {
  return {
    id,
    title: draft.title.trim() || fallbackTitle(draft.code),
    description: draft.description.trim(),
    language: draft.language,
    code: draft.code,
    tags: normalizeTags(draft.tags),
    favorite: false,
    createdAt: now,
    updatedAt: now,
    copyCount: 0,
  };
}

export function applyDraft(snippet: Snippet, draft: SnippetDraft, now = Date.now()): Snippet {
  return {
    ...snippet,
    title: draft.title.trim() || fallbackTitle(draft.code),
    description: draft.description.trim(),
    language: draft.language,
    code: draft.code,
    tags: normalizeTags(draft.tags),
    updatedAt: now,
  };
}

/** Title for a duplicate: "Name (copy)", "Name (copy 2)", … avoiding existing titles. */
export function duplicateTitle(title: string, existingTitles: Iterable<string>): string {
  const taken = new Set(existingTitles);
  const base = title.replace(/ \(copy(?: \d+)?\)$/, '');
  let candidate = `${base} (copy)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}

export function duplicateSnippet(s: Snippet, id: string, existingTitles: Iterable<string>, now = Date.now()): Snippet {
  return {
    ...s,
    tags: [...s.tags],
    id,
    title: duplicateTitle(s.title, existingTitles),
    favorite: false,
    createdAt: now,
    updatedAt: now,
    copyCount: 0,
  };
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 30 * day) {
    const d = Math.floor(diff / day);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
