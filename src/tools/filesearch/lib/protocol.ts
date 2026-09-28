/** Typed protocol between Local File Search and its indexing worker. */
import type { FileMeta, SearchFilters, SortKey } from './query';
import type { Segment, Snippet } from './snippets';

export interface IndexOptions {
  /** Ignore list text (one pattern per line). */
  ignore: string;
  /** Files larger than this are indexed by name/path only. */
  maxTextBytes: number;
  skipHidden: boolean;
}

export type IndexSource =
  | { kind: 'handle'; handle: FileSystemDirectoryHandle }
  | { kind: 'files'; files: File[]; paths: string[] };

export interface IndexProgress {
  phase: 'scanning' | 'indexing' | 'loading' | 'searching';
  files: number;
  folders: number;
  bytes: number;
  textFiles: number;
  textBytes: number;
  ignored: number;
  errors: number;
  current: string;
  /** 0–1 when known. */
  fraction: number | null;
}

export interface IndexSummary {
  rootName: string;
  fileCount: number;
  folderCount: number;
  totalBytes: number;
  textFiles: number;
  /** Characters of text held in the content index. */
  textChars: number;
  ignored: number;
  tooLarge: number;
  binary: number;
  /** Text files whose content was skipped because the content budget was full. */
  overBudget: number;
  errorCount: number;
  errors: Array<{ path: string; message: string }>;
  tookMs: number;
  indexedAt: number;
  maxTextBytes: number;
  extensions: Array<{ ext: string; count: number }>;
}

export interface Snapshot {
  meta: Blob;
  content: Blob;
}

export type SearchMode = 'fulltext' | 'name' | 'regex';

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  caseSensitive: boolean;
  filters: SearchFilters;
  sort: SortKey;
  limit: number;
}

export interface ResultItem {
  meta: FileMeta;
  score: number;
  nameSegments: Segment[];
  pathSegments: Segment[];
  snippets: Snippet[];
  matchingLines: number;
}

export interface SearchResponse {
  total: number;
  items: ResultItem[];
  tookMs: number;
  /** Pattern to highlight matches in the preview. */
  highlight: { source: string; flags: string } | null;
  /** Full-text search found nothing with all words, so any-word results are shown. */
  relaxed: boolean;
  /** Regex search stopped early (time budget), results are partial. */
  partial: boolean;
  error: string | null;
}

export interface PreviewResponse {
  meta: FileMeta;
  content: string | null;
}

export interface RequestMap {
  index: { req: { source: IndexSource; options: IndexOptions; rootName: string }; res: { summary: IndexSummary; snapshot: Snapshot } };
  load: { req: { snapshot: Snapshot; summary: IndexSummary }; res: { summary: IndexSummary } };
  search: { req: SearchRequest; res: SearchResponse };
  preview: { req: { id: number }; res: PreviewResponse };
  cancel: { req: null; res: null };
}

export type RequestType = keyof RequestMap;

export type WorkerRequest = {
  [K in RequestType]: { id: number; type: K; payload: RequestMap[K]['req'] };
}[RequestType];

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; cancelled?: boolean }
  | { id: number; progress: IndexProgress };

/** Content budget for the whole index, in characters. */
export const CONTENT_BUDGET_CHARS = 64 * 1024 * 1024;
