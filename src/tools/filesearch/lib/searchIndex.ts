/**
 * The full-text index used by Local File Search: tokenization, term folding
 * and search options. Shared by the worker and the tests.
 */
import MiniSearch, { type SearchOptions } from 'minisearch';
import type { FileMeta } from './query';
import { camelParts, foldTerm } from './snippets';

// Whitespace (tabs included), control characters, punctuation and symbols separate terms,
// so `x=getValue()`, `a+b` and tab-separated columns index "getValue", "b" and each cell.
const SPLIT = /[\p{Cc}\p{Z}\p{P}\p{S}]+/u;
const CAMEL_HINT = /\p{Ll}\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;

/** Split text into terms; camelCase identifiers also yield their parts ("parseHTTPResponse" → parse, HTTP, Response). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(SPLIT)) {
    if (!t) continue;
    out.push(t);
    if (t.length > 3 && CAMEL_HINT.test(t)) for (const p of camelParts(t)) out.push(p);
  }
  return out;
}

/** A MiniSearch index over file names, paths and (via `contentOf`) text contents. */
export function createSearchIndex(contentOf: (id: number) => string | null | undefined): MiniSearch<FileMeta> {
  return new MiniSearch<FileMeta>({
    idField: 'id',
    fields: ['name', 'path', 'content'],
    storeFields: [],
    extractField: (doc, field) => (field === 'content' ? (contentOf(doc.id) ?? '') : String(doc[field as keyof FileMeta] ?? '')),
    tokenize,
    // Case- and accent-insensitive terms, for indexing and searching alike ("cafe" finds "café").
    processTerm: (term) => foldTerm(term),
  });
}

/** Prefix matching from 2 characters, typo tolerance from 4, and names/paths ranked above contents. */
export const FULLTEXT_OPTIONS: SearchOptions = {
  prefix: (term: string) => term.length >= 2,
  fuzzy: (term: string) => (term.length >= 4 ? 0.2 : false),
  boost: { name: 4, path: 2, content: 1 },
};
