import { getSnippetLanguage, resolveLanguageId } from './languages';
import type { Snippet } from './model';

/** Precomputed lowercase fields so each keystroke only does indexOf scans. */
export interface SearchEntry {
  snippet: Snippet;
  title: string;
  titleWords: string[];
  description: string;
  tags: string[];
  code: string;
  languageName: string;
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

export function indexSnippet(snippet: Snippet): SearchEntry {
  const title = snippet.title.toLowerCase();
  return {
    snippet,
    title,
    titleWords: title.split(WORD_SPLIT).filter(Boolean),
    description: snippet.description.toLowerCase(),
    tags: snippet.tags.map((t) => t.toLowerCase()),
    code: snippet.code.toLowerCase(),
    languageName: getSnippetLanguage(snippet.language).name.toLowerCase(),
  };
}

const entryCache = new Map<string, { updatedAt: number; ref: Snippet; entry: SearchEntry }>();

/**
 * Build the search index, reusing entries for snippets that did not change
 * (same id and updatedAt), so re-indexing 5 000 snippets after one edit is cheap.
 */
export function buildSearchIndex(snippets: readonly Snippet[]): SearchEntry[] {
  const seen = new Set<string>();
  const out = snippets.map((snippet) => {
    seen.add(snippet.id);
    const cached = entryCache.get(snippet.id);
    if (cached && cached.updatedAt === snippet.updatedAt && cached.ref.code === snippet.code) {
      // Keep counters/favorite fresh without re-lowercasing the text.
      if (cached.ref !== snippet) {
        cached.entry = { ...cached.entry, snippet };
        cached.ref = snippet;
      }
      return cached.entry;
    }
    const entry = indexSnippet(snippet);
    entryCache.set(snippet.id, { updatedAt: snippet.updatedAt, ref: snippet, entry });
    return entry;
  });
  if (entryCache.size > seen.size * 2 + 100) {
    for (const id of entryCache.keys()) if (!seen.has(id)) entryCache.delete(id);
  }
  return out;
}

export interface ParsedQuery {
  terms: string[];
  languages: string[];
  tags: string[];
  favorite: boolean;
}

/** Supports free terms plus `lang:py`, `tag:react` and `is:fav` qualifiers. Quoted phrases stay together. */
export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], languages: [], tags: [], favorite: false };
  const re = /(\w+:)?"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query.toLowerCase()))) {
    const raw = m[3] ?? `${m[1] ?? ''}${m[2]}`;
    const colon = raw.indexOf(':');
    const key = colon > 0 ? raw.slice(0, colon) : '';
    const value = colon > 0 ? raw.slice(colon + 1) : raw;
    if ((key === 'lang' || key === 'language') && value) {
      parsed.languages.push(resolveLanguageId(value) ?? value);
    } else if (key === 'tag' && value) {
      parsed.tags.push(value.replace(/^#/, ''));
    } else if (key === 'is' && (value === 'fav' || value === 'favorite' || value === 'starred')) {
      parsed.favorite = true;
    } else if (raw.trim()) {
      parsed.terms.push(raw.trim());
    }
  }
  return parsed;
}

/** Characters of `needle` appear in order in `hay`; returns a compactness score (0 = no match). */
export function subsequenceScore(hay: string, needle: string): number {
  if (!needle) return 0;
  let hi = 0;
  let first = -1;
  let last = -1;
  for (const ch of needle) {
    const found = hay.indexOf(ch, hi);
    if (found === -1) return 0;
    if (first === -1) first = found;
    last = found;
    hi = found + ch.length;
  }
  const span = last - first + 1;
  return needle.length / span; // 1 = contiguous
}

/** Score one search term against an entry. 0 means the term does not match. */
export function scoreTerm(entry: SearchEntry, term: string): number {
  let score = 0;
  if (entry.title === term) score = Math.max(score, 100);
  else if (entry.title.startsWith(term)) score = Math.max(score, 70);
  else if (entry.titleWords.some((w) => w.startsWith(term))) score = Math.max(score, 50);
  else if (entry.title.includes(term)) score = Math.max(score, 35);

  for (const tag of entry.tags) {
    if (tag === term) score = Math.max(score, 45);
    else if (tag.startsWith(term)) score = Math.max(score, 30);
    else if (tag.includes(term)) score = Math.max(score, 15);
  }
  if (entry.languageName === term || entry.snippet.language === term) score = Math.max(score, 30);
  if (score < 20 && entry.description.includes(term)) score = Math.max(score, 18);
  if (score < 10 && entry.code.includes(term)) score = Math.max(score, 8);
  if (score === 0 && term.length >= 3) {
    const fuzzy = subsequenceScore(entry.title, term);
    if (fuzzy >= 0.5) score = 3 + fuzzy * 7;
  }
  return score;
}

export type SortKey = 'updated' | 'created' | 'title' | 'copied';

export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Recently updated',
  created: 'Recently created',
  title: 'Title (A–Z)',
  copied: 'Most copied',
};

export interface SnippetFilters {
  language: string | null;
  tag: string | null;
  favorites: boolean;
}

export interface SearchHit {
  snippet: Snippet;
  score: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function compareSnippets(a: Snippet, b: Snippet, sort: SortKey): number {
  switch (sort) {
    case 'created':
      return b.createdAt - a.createdAt || collator.compare(a.title, b.title);
    case 'title':
      return collator.compare(a.title, b.title) || b.updatedAt - a.updatedAt;
    case 'copied':
      return b.copyCount - a.copyCount || b.updatedAt - a.updatedAt;
    case 'updated':
    default:
      return b.updatedAt - a.updatedAt || collator.compare(a.title, b.title);
  }
}

/**
 * Filter and rank. Every free term must match somewhere (AND). With a query,
 * results are ordered by relevance (favorites get a small boost) and ties fall
 * back to the chosen sort; without one, the chosen sort decides.
 */
export function searchSnippets(
  index: readonly SearchEntry[],
  query: string,
  filters: SnippetFilters,
  sort: SortKey,
): SearchHit[] {
  const q = parseQuery(query);
  const hits: SearchHit[] = [];
  for (const entry of index) {
    const s = entry.snippet;
    if (filters.language && s.language !== filters.language) continue;
    if (filters.tag && !entry.tags.includes(filters.tag)) continue;
    if ((filters.favorites || q.favorite) && !s.favorite) continue;
    if (q.languages.length && !q.languages.includes(s.language)) continue;
    if (q.tags.length && !q.tags.every((t) => entry.tags.some((tag) => tag === t || tag.startsWith(t)))) continue;
    let score = 0;
    let ok = true;
    for (const term of q.terms) {
      const t = scoreTerm(entry, term);
      if (!t) {
        ok = false;
        break;
      }
      score += t;
    }
    if (!ok) continue;
    if (q.terms.length && s.favorite) score += 2;
    hits.push({ snippet: s, score });
  }
  if (q.terms.length) hits.sort((a, b) => b.score - a.score || compareSnippets(a.snippet, b.snippet, sort));
  else hits.sort((a, b) => compareSnippets(a.snippet, b.snippet, sort));
  return hits;
}

/** Tag → count, sorted by count then name. */
export function tagCounts(snippets: readonly Snippet[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of snippets) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function languageCounts(snippets: readonly Snippet[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of snippets) counts.set(s.language, (counts.get(s.language) ?? 0) + 1);
  return [...counts].sort(
    (a, b) => b[1] - a[1] || getSnippetLanguage(a[0]).name.localeCompare(getSnippetLanguage(b[0]).name),
  );
}
