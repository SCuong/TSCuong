import MiniSearch from 'minisearch';
import { frontMatterLength, taskLines, toggleTaskAtLine } from './render';

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

// ---------------------------------------------------------------------------
// Line scanning
// ---------------------------------------------------------------------------

/**
 * The lines of a note body (BOM and CR removed), produced lazily so callers that
 * only need the first few lines stay fast on multi-megabyte notes.
 */
function* bodyLines(content: string): Generator<string> {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  let pos = frontMatterLength(text);
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    yield text.slice(pos, end).replace(/\r$/, '');
    if (nl === -1) return;
    pos = nl + 1;
  }
}

/**
 * Title for a note from its content: the first heading, otherwise the first
 * non-empty line (list/quote markers removed), skipping front matter and code fences.
 */
export function deriveTitle(content: string): string {
  let inFence = false;
  for (const raw of bodyLines(content)) {
    const line = raw.trim();
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
    if (!/^([-*_=])\1{2,}$/.test(line)) {
      const text = stripInlineMarkdown(line.replace(/^(>\s*)+/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''));
      if (text) return truncate(text, MAX_TITLE);
    }
  }
  return UNTITLED;
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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface NoteIndex {
  /** Ids of matching notes, best match first. Empty query returns null (no filtering). */
  search(query: string): string[] | null;
}

type Indexable = Pick<Note, 'id' | 'title' | 'content' | 'tags'> & { updatedAt?: number };

/** Only the start of very long notes goes into the word index; the substring fallback still searches all text. */
export const MAX_INDEXED_CHARS = 100_000;

function versionOf(note: Indexable): string {
  return `${note.updatedAt ?? ''}\u0000${note.title}\u0000${note.tags.join(' ')}\u0000${note.content.length}`;
}

/**
 * Full-text index over titles, tags and content (prefix + light fuzzy matching).
 * {@link sync} only re-indexes notes that changed, so typing in one note does not
 * re-index the whole library on every autosave.
 */
export class NoteSearchIndex implements NoteIndex {
  private readonly mini = new MiniSearch<{ id: string; title: string; content: string; tags: string }>({
    fields: ['title', 'tags', 'content'],
    storeFields: [],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: 'AND',
    },
  });
  private readonly versions = new Map<string, string>();
  private byId = new Map<string, Indexable>();

  sync(notes: Indexable[]): this {
    const byId = new Map<string, Indexable>();
    for (const note of notes) {
      byId.set(note.id, note);
      const version = versionOf(note);
      if (this.versions.get(note.id) === version) continue;
      const doc = { id: note.id, title: note.title, content: note.content.slice(0, MAX_INDEXED_CHARS), tags: note.tags.join(' ') };
      if (this.mini.has(note.id)) this.mini.replace(doc);
      else this.mini.add(doc);
      this.versions.set(note.id, version);
    }
    for (const id of this.versions.keys()) {
      if (byId.has(id)) continue;
      this.mini.discard(id);
      this.versions.delete(id);
    }
    this.byId = byId;
    return this;
  }

  search(query: string): string[] | null {
    const q = query.trim();
    if (!q) return null;
    const ids = this.mini.search(q).map((r) => String(r.id));
    // Exact substring matches (punctuation or code MiniSearch tokenizes away, text past the indexed part) come after ranked hits.
    const needle = q.toLowerCase();
    const seen = new Set(ids);
    for (const [id, n] of this.byId) {
      if (seen.has(id)) continue;
      if (n.title.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle)) ids.push(id);
    }
    return ids;
  }
}

/** Full-text index over titles, tags and content (prefix + light fuzzy matching). */
export function createNoteIndex(notes: Indexable[]): NoteIndex {
  return new NoteSearchIndex().sync(notes);
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
/** Above this size stats use fast regular expressions instead of Intl.Segmenter (which takes about a second per 5 MB). */
const FAST_STATS_CHARS = 100_000;
type Segmenter = { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };

function segmenter(granularity: 'word' | 'grapheme'): Segmenter | null {
  const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => Segmenter }).Segmenter;
  return Ctor ? new Ctor(undefined, { granularity }) : null;
}

/** Each CJK/Thai character counts as a word; other runs of letters and digits (with inner apostrophes) are one word. */
const FAST_WORD =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}])[\p{L}\p{N}\p{M}])+(?:['’](?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}])[\p{L}\p{N}\p{M}])+)*/gu;

/** Word, character (grapheme) count and reading time of Markdown text, ignoring Markdown syntax characters. */
export function textStats(markdown: string): TextStats {
  const text = markdown
    .replace(/^(```|~~~).*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|[\]-]+/g, ' ');
  const large = markdown.length > FAST_STATS_CHARS;
  let words = 0;
  const wordSeg = large ? null : segmenter('word');
  if (wordSeg) {
    for (const s of wordSeg.segment(text)) if (s.isWordLike) words++;
  } else {
    FAST_WORD.lastIndex = 0;
    while (FAST_WORD.exec(text)) words++;
  }
  const graphemes = large ? null : segmenter('grapheme');
  let characters = 0;
  if (graphemes) for (const _ of graphemes.segment(markdown)) characters++;
  else {
    // Code points (surrogate pairs count once); combining marks count separately in this fast path.
    for (let i = 0; i < markdown.length; i++) {
      const c = markdown.charCodeAt(i);
      if (c < 0xdc00 || c > 0xdfff) characters++;
    }
  }
  return { words, characters, readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)) };
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

/**
 * Toggle the `index`-th GFM task list checkbox (0-based, in the order the
 * preview renders them). Returns the unchanged text when there is no such task.
 */
export function toggleTask(markdown: string, index: number): string {
  const line = taskLines(markdown)[index];
  return line === undefined || line < 0 ? markdown : toggleTaskAtLine(markdown, line);
}

/** A title for a copy: "Plan" → "Plan (copy)", "Plan (copy)" → "Plan (copy 2)". */
export function copyTitle(title: string, existing: string[]): string {
  const base = title.replace(/\s*\(copy(?: \d+)?\)$/, '');
  const taken = new Set(existing);
  let candidate = `${base} (copy)`;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base} (copy ${i})`;
  return candidate;
}

/** Title for the other tab's version kept after a simultaneous edit: "Plan (conflicted copy)", "(conflicted copy 2)", … */
export function conflictTitle(title: string, existing: string[]): string {
  const base = title.replace(/\s*\(conflicted copy(?: \d+)?\)$/, '');
  const taken = new Set(existing);
  let candidate = `${base} (conflicted copy)`;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base} (conflicted copy ${i})`;
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

const FRONT_MATTER_BLOCK = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
const KEY_LINE = /^(\w[\w-]*)\s*:\s*(.*)$/;

interface FrontMatter {
  title: string | null;
  tags: string[] | null;
  /** Lines of every other key, kept verbatim. */
  rest: string[];
  /** Length of the whole block in the source. */
  length: number;
}

/** Reads `title` and `tags`/`keywords` from leading front matter; other keys are kept as they are. */
function readFrontMatter(content: string): FrontMatter | null {
  const fm = FRONT_MATTER_BLOCK.exec(content);
  if (!fm) return null;
  const lines = fm[1].split('\n');
  const result: FrontMatter = { title: null, tags: null, rest: [], length: fm[0].length };
  for (let i = 0; i < lines.length; i++) {
    const m = KEY_LINE.exec(lines[i]);
    const key = m?.[1].toLowerCase();
    if (!m || (key !== 'title' && key !== 'tags' && key !== 'keywords')) {
      result.rest.push(lines[i]);
      continue;
    }
    const value = m[2].trim();
    if (key === 'title') {
      if (value) result.title = unquote(value);
      else result.rest.push(lines[i]);
      continue;
    }
    if (value.startsWith('[')) result.tags = tagsFromItems(value.replace(/^\[|\]$/g, '').split(','));
    else if (value.includes(',')) result.tags = tagsFromItems(value.split(','));
    else if (value) result.tags = parseTags(unquote(value));
    else {
      const list: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) list.push(lines[++i].replace(/^\s*-\s+/, ''));
      result.tags = tagsFromItems(list);
    }
  }
  return result;
}

function frontMatterBlock(lines: string[]): string {
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * Parse an imported Markdown file. Normalizes line endings and BOM, and reads
 * `title` and `tags` from YAML front matter; those keys move into the note's
 * fields while any other keys (date, author, …) stay in the text.
 * The title falls back to the first heading, then the file name.
 */
export function parseImportedMarkdown(fileName: string, raw: string): ImportedNote {
  let content = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let title: string | null = null;
  let tags: string[] = [];
  const fm = readFrontMatter(content);
  if (fm && (fm.title !== null || fm.tags !== null)) {
    title = fm.title;
    tags = fm.tags ?? [];
    const body = content.slice(fm.length).replace(/^\n+/, '');
    const rest = fm.rest.some((line) => line.trim()) ? frontMatterBlock(fm.rest) : '';
    content = rest ? `${rest}\n${body}` : body;
  }
  const fromFile = fileName.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '').trim();
  const derived = deriveTitle(content);
  if (title) return { title: truncate(title, MAX_TITLE), autoTitle: false, content, tags };
  if (derived !== UNTITLED) return { title: derived, autoTitle: true, content, tags };
  return { title: truncate(fromFile || UNTITLED, MAX_TITLE), autoTitle: false, content, tags };
}

/**
 * Markdown export. Adds `title` (when it is not simply the first heading) and
 * `tags` as front matter, merged into the note's own front matter if it has
 * one, so re-importing the file restores them.
 */
export function exportMarkdown(note: Pick<Note, 'title' | 'content' | 'tags'> & { autoTitle?: boolean }): string {
  const customTitle = note.autoTitle === false && note.title !== deriveTitle(note.content);
  if (note.tags.length === 0 && !customTitle) return note.content;
  const ours = [`title: ${JSON.stringify(note.title)}`];
  if (note.tags.length) ours.push(`tags: [${note.tags.join(', ')}]`);
  const content = note.content.replace(/^\uFEFF/, '');
  const existing = readFrontMatter(content.replace(/\r\n?/g, '\n'));
  if (existing) {
    const body = content.replace(/\r\n?/g, '\n').slice(existing.length);
    return `${frontMatterBlock([...ours, ...existing.rest.filter((line) => !/^title\s*:\s*$/i.test(line))])}${body}`;
  }
  return `${frontMatterBlock(ours)}\n${content}`;
}

// ---------------------------------------------------------------------------
// List display helpers
// ---------------------------------------------------------------------------

/** A one-line plain-text preview of a note body, skipping the line used as the title, fences and front matter. */
export function noteSnippet(content: string, max = 120): string {
  const parts: string[] = [];
  let inFence = false;
  let skippedTitle = false;
  let length = 0;
  for (const raw of bodyLines(content)) {
    if (length >= max) break;
    const line = raw.trim();
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
