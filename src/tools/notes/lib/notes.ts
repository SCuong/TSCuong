import MiniSearch from 'minisearch';

export interface Note {
  id: string;
  title: string;
  /** When true the title follows the note's first heading/line; renaming turns it off. */
  autoTitle: boolean;
  content: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export const UNTITLED = 'Untitled note';
const MAX_TITLE = 80;

/** Strip inline Markdown so a line reads as plain text. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

/**
 * Title for a note from its content: the first heading, otherwise the first
 * non-empty line (list/quote markers removed), skipping front matter and code fences.
 */
export function deriveTitle(content: string): string {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  let firstLine: string | null = null;
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line) continue;
    // ATX heading; a bare "#" (or "## ##") is an empty heading in CommonMark.
    const heading = /^#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const text = stripInlineMarkdown(heading[1] ?? '');
      if (text) return truncate(text, MAX_TITLE);
      continue;
    }
    if (firstLine === null && !/^([-*_=])\1{2,}$/.test(line)) {
      const text = stripInlineMarkdown(line.replace(/^(>\s*)+/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''));
      if (text) {
        firstLine = text;
        break;
      }
    }
  }
  return firstLine ? truncate(firstLine, MAX_TITLE) : UNTITLED;
}

/** Normalize a user-typed tag: lowercase, no leading '#', spaces to dashes, max 32 chars. Empty string if nothing is left. */
export function normalizeTag(raw: string): string {
  return [
    ...raw
      .normalize('NFKC')
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .replace(/[\s,]+/g, '-')
      .replace(/[^\p{L}\p{N}\-_/.]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, ''),
  ]
    .slice(0, 32)
    .join('');
}

/** Parse a comma/space separated list of tags into unique normalized tags. */
export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const tag = normalizeTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** All tags used across notes with their counts, sorted by name. */
export function collectTags(notes: Pick<Note, 'tags'>[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const note of notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

export type NoteSort = 'updated' | 'created' | 'title';
export type NoteFilter = { kind: 'all' } | { kind: 'favorites' } | { kind: 'tag'; tag: string };

export function filterNotes<T extends Pick<Note, 'favorite' | 'tags'>>(notes: T[], filter: NoteFilter): T[] {
  if (filter.kind === 'favorites') return notes.filter((n) => n.favorite);
  if (filter.kind === 'tag') return notes.filter((n) => n.tags.includes(filter.tag));
  return notes;
}

export function sortNotes<T extends Pick<Note, 'title' | 'createdAt' | 'updatedAt'>>(notes: T[], sort: NoteSort): T[] {
  const copy = [...notes];
  if (sort === 'title') copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || b.updatedAt - a.updatedAt);
  else if (sort === 'created') copy.sort((a, b) => b.createdAt - a.createdAt);
  else copy.sort((a, b) => b.updatedAt - a.updatedAt);
  return copy;
}

export interface NoteIndex {
  /** Ids of matching notes, best match first. Empty query returns null (no filtering). */
  search(query: string): string[] | null;
}

/** Full-text index over titles, tags and content (prefix + light fuzzy matching). */
export function createNoteIndex(notes: Pick<Note, 'id' | 'title' | 'content' | 'tags'>[]): NoteIndex {
  const mini = new MiniSearch<{ id: string; title: string; content: string; tags: string }>({
    fields: ['title', 'tags', 'content'],
    storeFields: [],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: 'AND',
    },
  });
  mini.addAll(notes.map((n) => ({ id: n.id, title: n.title, content: n.content, tags: n.tags.join(' ') })));
  const byId = new Map(notes.map((n) => [n.id, n]));
  return {
    search(query) {
      const q = query.trim();
      if (!q) return null;
      const ids = mini.search(q).map((r) => String(r.id));
      // Exact substring matches (e.g. punctuation or code MiniSearch tokenizes away) come after ranked hits.
      const needle = q.toLowerCase();
      const seen = new Set(ids);
      for (const [id, n] of byId) {
        if (seen.has(id)) continue;
        if (n.title.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle)) ids.push(id);
      }
      return ids;
    },
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface TextStats {
  words: number;
  characters: number;
  /** Whole minutes, at least 1 when there is any text. */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 220;
type Segmenter = { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };

function segmenter(granularity: 'word' | 'grapheme'): Segmenter | null {
  const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => Segmenter }).Segmenter;
  return Ctor ? new Ctor(undefined, { granularity }) : null;
}

/** Word, character (grapheme) count and reading time of Markdown text, ignoring Markdown syntax characters. */
export function textStats(markdown: string): TextStats {
  const text = markdown
    .replace(/^(```|~~~).*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|[\]-]+/g, ' ');
  let words = 0;
  const wordSeg = segmenter('word');
  if (wordSeg) {
    for (const s of wordSeg.segment(text)) if (s.isWordLike) words++;
  } else {
    words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  const graphemes = segmenter('grapheme');
  let characters = 0;
  if (graphemes) for (const _ of graphemes.segment(markdown)) characters++;
  else characters = [...markdown].length;
  return { words, characters, readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)) };
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

/**
 * Toggle the `index`-th GFM task list checkbox (0-based, in document order,
 * ignoring fenced code). Returns the unchanged text when there is no such task.
 */
export function toggleTask(markdown: string, index: number): string {
  const lines = markdown.split('\n');
  let inFence = false;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(lines[i]);
    if (!m) continue;
    if (count === index) {
      const next = m[2] === ' ' ? 'x' : ' ';
      lines[i] = m[1] + next + lines[i].slice(m[1].length + 1);
      return lines.join('\n');
    }
    count++;
  }
  return markdown;
}

/** A title for a copy: "Plan" → "Plan (copy)", "Plan (copy)" → "Plan (copy 2)". */
export function copyTitle(title: string, existing: string[]): string {
  const base = title.replace(/\s*\(copy(?: \d+)?\)$/, '');
  const taken = new Set(existing);
  let candidate = `${base} (copy)`;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base} (copy ${i})`;
  return candidate;
}

/** Replace C0 control characters (not allowed in file names) with spaces. */
export function stripControlChars(text: string): string {
  let out = '';
  for (const ch of text) out += ch.charCodeAt(0) < 0x20 ? ' ' : ch;
  return out;
}

/** Safe file name (without extension) for a note title. */
export function noteFileName(title: string): string {
  const base = stripControlChars(title.normalize('NFKC'))
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return base || 'note';
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export interface ImportedNote {
  title: string;
  autoTitle: boolean;
  content: string;
  tags: string[];
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    // YAML double-quoted scalars use JSON-compatible escapes (\" \\ \n é ...).
    try {
      const parsed: unknown = JSON.parse(v);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not valid JSON escapes: fall back to stripping the quotes.
    }
    return v.slice(1, -1);
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Normalize each list item into one tag (so "two words" stays a single tag), dropping empties and duplicates. */
function tagsFromItems(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const tag = normalizeTag(unquote(item));
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Parse an imported Markdown file. Normalizes line endings and BOM, and reads
 * `title` and `tags` from simple YAML front matter (which is then removed).
 * The title falls back to the first heading, then the file name.
 */
export function parseImportedMarkdown(fileName: string, raw: string): ImportedNote {
  let content = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let title: string | null = null;
  let tags: string[] = [];
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(content);
  if (fm) {
    const lines = fm[1].split('\n');
    let recognized = false;
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'title' && value) {
        title = unquote(value);
        recognized = true;
      } else if (key === 'tags' || key === 'keywords') {
        recognized = true;
        if (value.startsWith('[')) tags = tagsFromItems(value.replace(/^\[|\]$/g, '').split(','));
        else if (value.includes(',')) tags = tagsFromItems(value.split(','));
        else if (value) tags = parseTags(unquote(value));
        else {
          const list: string[] = [];
          while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) list.push(lines[++i].replace(/^\s*-\s+/, ''));
          tags = tagsFromItems(list);
        }
      }
    }
    if (recognized) content = content.slice(fm[0].length).replace(/^\n+/, '');
  }
  const fromFile = fileName.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '').trim();
  const derived = deriveTitle(content);
  if (title) return { title: truncate(title, MAX_TITLE), autoTitle: false, content, tags };
  if (derived !== UNTITLED) return { title: derived, autoTitle: true, content, tags };
  return { title: truncate(fromFile || UNTITLED, MAX_TITLE), autoTitle: false, content, tags };
}

/** Markdown export; adds front matter with title and tags when the note has tags so re-importing keeps them. */
export function exportMarkdown(note: Pick<Note, 'title' | 'content' | 'tags'>): string {
  if (note.tags.length === 0) return note.content;
  const title = JSON.stringify(note.title);
  return `---\ntitle: ${title}\ntags: [${note.tags.join(', ')}]\n---\n\n${note.content}`;
}

// ---------------------------------------------------------------------------
// List display helpers
// ---------------------------------------------------------------------------

/** A one-line plain-text preview of a note body, skipping the line used as the title, fences and front matter. */
export function noteSnippet(content: string, max = 120): string {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  const parts: string[] = [];
  let inFence = false;
  let skippedTitle = false;
  let length = 0;
  for (; i < lines.length && length < max; i++) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || /^([-*_=])\1{2,}$/.test(line) || /^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue;
    const text = stripInlineMarkdown(
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^(>\s*)+/, '')
        .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
        .replace(/\|/g, ' '),
    );
    if (!text) continue;
    if (!skippedTitle) {
      skippedTitle = true;
      continue;
    }
    parts.push(text);
    length += text.length + 1;
  }
  return truncate(parts.join(' '), max);
}

/** "just now", "5 min ago", "yesterday", "3 days ago", or a short date for older timestamps. */
export function formatRelativeTime(timestamp: number, now = Date.now(), locale?: string): string {
  const diff = Math.round((now - timestamp) / 1000);
  if (diff < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), 'minute');
  if (diff < 86_400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 7 * 86_400) return rtf.format(-Math.round(diff / 86_400), 'day');
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  /** Selection after the edit. */
  anchor: number;
  head: number;
}

/**
 * Toggle an inline Markdown marker ("**" bold, "*" italic) around the selection
 * [from, to) of `doc`. Unwraps when the selection is already wrapped (inside or
 * just outside the markers); with an empty selection inserts a marker pair and
 * places the cursor between them.
 */
export function toggleInlineMarker(doc: string, from: number, to: number, marker: string): TextEdit {
  const n = marker.length;
  const selected = doc.slice(from, to);
  // Markers just outside the selection: **|text|**
  if (from >= n && doc.slice(from - n, from) === marker && doc.slice(to, to + n) === marker) {
    const isBoldAroundItalic = marker === '*' && doc.slice(from - 2, from) === '**' && doc.slice(from - 3, from) !== '***';
    if (!isBoldAroundItalic) {
      return { from: from - n, to: to + n, insert: selected, anchor: from - n, head: to - n };
    }
  }
  // Markers inside the selection: |**text**|
  if (selected.length >= 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, selected.length - n);
    const italicOnlyInsideBold = marker === '*' && selected.startsWith('**') && !selected.startsWith('***');
    if (!italicOnlyInsideBold) return { from, to, insert: inner, anchor: from, head: from + inner.length };
  }
  return { from, to, insert: marker + selected + marker, anchor: from + n, head: to + n };
}
