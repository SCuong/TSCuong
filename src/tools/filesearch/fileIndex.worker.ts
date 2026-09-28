/// <reference lib="webworker" />
/**
 * Local File Search worker: walks a folder (File System Access handle or a
 * list of File objects), extracts text, builds a MiniSearch full-text index
 * and answers searches. Nothing ever leaves the device.
 */
import MiniSearch, { type SearchResult } from 'minisearch';
import {
  CONTENT_BUDGET_CHARS,
  type IndexOptions,
  type IndexProgress,
  type IndexSource,
  type IndexSummary,
  type PreviewResponse,
  type ResultItem,
  type SearchRequest,
  type SearchResponse,
  type Snapshot,
  type WorkerRequest,
  type WorkerResponse,
} from './lib/protocol';
import { extractText } from './lib/extract';
import { isIgnored, parseIgnoreList } from './lib/ignore';
import { extensionCounts, makeFilter, scorePathMatch, sortItems, type FileMeta } from './lib/query';
import { camelParts, compileUserRegex, highlightSegments, matchLines, substringsPattern, termsPattern } from './lib/snippets';
import { extensionOf } from './lib/textFormats';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const SPLIT = /[\n\r\p{Z}\p{P}]+/u;
const CAMEL_HINT = /\p{Ll}\p{Lu}|\p{Lu}\p{Lu}\p{Ll}/u;

let metas: FileMeta[] = [];
let contents: Array<string | null> = [];
let index: MiniSearch<FileMeta> | null = null;
let cancelRequested = false;
let searchSeq = 0;

function tokenize(text: string): string[] {
  const tokens = text.split(SPLIT);
  const out: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    out.push(t);
    if (t.length > 3 && CAMEL_HINT.test(t)) for (const p of camelParts(t)) out.push(p);
  }
  return out;
}

function createIndex(): MiniSearch<FileMeta> {
  return new MiniSearch<FileMeta>({
    idField: 'id',
    fields: ['name', 'path', 'content'],
    storeFields: [],
    extractField: (doc, field) => (field === 'content' ? (contents[doc.id] ?? '') : String(doc[field as keyof FileMeta] ?? '')),
    tokenize,
  });
}

const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class Cancelled extends Error {
  constructor() {
    super('Indexing was cancelled.');
  }
}

function checkCancelled() {
  if (cancelRequested) throw new Cancelled();
}

interface DirLike {
  values(): AsyncIterable<FileSystemHandle>;
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Permission denied';
    if (error.name === 'NotFoundError') return 'File no longer exists';
    if (error.name === 'NotReadableError') return 'The file could not be read (it may be locked or in use)';
  }
  return error instanceof Error ? error.message : String(error);
}

async function buildIndex(
  source: IndexSource,
  options: IndexOptions,
  rootName: string,
  report: (p: IndexProgress) => void,
): Promise<{ summary: IndexSummary; snapshot: Snapshot }> {
  const started = performance.now();
  cancelRequested = false;
  index = null;
  metas = [];
  contents = [];
  const rules = parseIgnoreList(options.ignore);
  const progress: IndexProgress = {
    phase: 'scanning',
    files: 0,
    folders: 0,
    bytes: 0,
    textFiles: 0,
    textBytes: 0,
    ignored: 0,
    errors: 0,
    current: '',
    fraction: null,
  };
  const s: IndexSummary = {
    rootName,
    fileCount: 0,
    folderCount: 0,
    totalBytes: 0,
    textFiles: 0,
    textChars: 0,
    ignored: 0,
    tooLarge: 0,
    binary: 0,
    overBudget: 0,
    errorCount: 0,
    errors: [],
    tookMs: 0,
    indexedAt: Date.now(),
    maxTextBytes: options.maxTextBytes,
    extensions: [],
  };
  let lastReport = 0;
  const maybeReport = (force = false) => {
    const now = performance.now();
    if (force || now - lastReport > 120) {
      lastReport = now;
      report({ ...progress });
    }
  };
  const addError = (path: string, error: unknown) => {
    s.errorCount++;
    progress.errors++;
    if (s.errors.length < 100) s.errors.push({ path, message: describeError(error) });
  };

  const addFile = async (path: string, file: File) => {
    const id = metas.length;
    const name = file.name || path.slice(path.lastIndexOf('/') + 1);
    const meta: FileMeta = { id, path, name, ext: extensionOf(name), size: file.size, lastModified: file.lastModified, status: 'not-text' };
    let content: string | null = null;
    try {
      const res = await extractText(file, options.maxTextBytes);
      meta.status = res.status;
      if (res.status === 'text' || res.status === 'empty') {
        const text = res.text ?? '';
        if (s.textChars + text.length > CONTENT_BUDGET_CHARS) {
          meta.status = 'budget';
          s.overBudget++;
        } else {
          content = text;
          s.textChars += text.length;
          s.textFiles++;
          progress.textFiles++;
          progress.textBytes += file.size;
        }
      } else if (res.status === 'too-large') s.tooLarge++;
      else if (res.status === 'binary') s.binary++;
    } catch (error) {
      meta.status = 'error';
      addError(path, error);
    }
    metas.push(meta);
    contents.push(content);
    s.fileCount++;
    s.totalBytes += file.size;
    progress.files++;
    progress.bytes += file.size;
    progress.current = path;
    maybeReport();
  };

  if (source.kind === 'handle') {
    const stack: Array<{ dir: FileSystemDirectoryHandle; prefix: string }> = [{ dir: source.handle, prefix: '' }];
    while (stack.length) {
      const { dir, prefix } = stack.pop()!;
      const subdirs: Array<{ dir: FileSystemDirectoryHandle; prefix: string }> = [];
      try {
        for await (const handle of (dir as unknown as DirLike).values()) {
          checkCancelled();
          const path = prefix ? `${prefix}/${handle.name}` : handle.name;
          if (isIgnored(path, rules, options.skipHidden)) {
            s.ignored++;
            progress.ignored++;
            continue;
          }
          if (handle.kind === 'directory') {
            subdirs.push({ dir: handle as FileSystemDirectoryHandle, prefix: path });
            s.folderCount++;
            progress.folders++;
          } else {
            try {
              const file = await (handle as FileSystemFileHandle).getFile();
              await addFile(path, file);
            } catch (error) {
              if (error instanceof Cancelled) throw error;
              addError(path, error);
            }
          }
        }
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        addError(prefix || '/', error);
      }
      // Reverse so folders are visited in listing order.
      for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
    }
  } else {
    const folders = new Set<string>();
    for (let i = 0; i < source.files.length; i++) {
      if ((i & 31) === 0) {
        await yieldToEvents();
        checkCancelled();
      }
      const path = source.paths[i];
      if (isIgnored(path, rules, options.skipHidden)) {
        s.ignored++;
        progress.ignored++;
        continue;
      }
      const slash = path.lastIndexOf('/');
      for (let dir = slash === -1 ? '' : path.slice(0, slash); dir && !folders.has(dir); ) {
        folders.add(dir);
        const up = dir.lastIndexOf('/');
        dir = up === -1 ? '' : dir.slice(0, up);
      }
      progress.folders = folders.size;
      await addFile(path, source.files[i]);
    }
    s.folderCount = folders.size;
  }

  maybeReport(true);
  const built = await addToIndex(report, progress);
  index = built;
  s.tookMs = performance.now() - started;
  s.extensions = extensionCounts(metas);
  const snapshot: Snapshot = {
    meta: new Blob([JSON.stringify(metas)], { type: 'application/json' }),
    content: new Blob([JSON.stringify(contents)], { type: 'application/json' }),
  };
  return { summary: s, snapshot };
}

async function addToIndex(report: (p: IndexProgress) => void, base: IndexProgress, phase: IndexProgress['phase'] = 'indexing') {
  const ms = createIndex();
  const chunk = 400;
  let lastReport = 0;
  for (let i = 0; i < metas.length; i += chunk) {
    checkCancelled();
    ms.addAll(metas.slice(i, i + chunk));
    const now = performance.now();
    if (now - lastReport > 120) {
      lastReport = now;
      report({ ...base, phase, fraction: metas.length ? Math.min(1, (i + chunk) / metas.length) : 1, current: '' });
      await yieldToEvents();
    }
  }
  return ms;
}

async function loadSnapshot(snapshot: Snapshot, stored: IndexSummary, report: (p: IndexProgress) => void) {
  cancelRequested = false;
  index = null;
  const base: IndexProgress = {
    phase: 'loading',
    files: stored.fileCount,
    folders: stored.folderCount,
    bytes: stored.totalBytes,
    textFiles: stored.textFiles,
    textBytes: 0,
    ignored: stored.ignored,
    errors: stored.errorCount,
    current: '',
    fraction: null,
  };
  report(base);
  const [metaText, contentText] = await Promise.all([snapshot.meta.text(), snapshot.content.text()]);
  const nextMetas = JSON.parse(metaText) as FileMeta[];
  const nextContents = JSON.parse(contentText) as Array<string | null>;
  if (!Array.isArray(nextMetas) || !Array.isArray(nextContents) || nextMetas.length !== nextContents.length) {
    throw new Error('The saved index is damaged. Remove it and index the folder again.');
  }
  metas = nextMetas;
  contents = nextContents;
  index = await addToIndex(report, base, 'loading');
  return { summary: stored };
}

function segmentsFor(text: string, pattern: RegExp | null) {
  return highlightSegments(text, pattern, 50);
}

async function search(req: SearchRequest, seq: number, report: (p: IndexProgress) => void): Promise<SearchResponse> {
  const t0 = performance.now();
  const empty: SearchResponse = { total: 0, items: [], tookMs: 0, highlight: null, relaxed: false, partial: false, error: null };
  if (!index) return { ...empty, error: 'No folder is indexed yet.' };
  const filter = makeFilter(req.filters);
  const query = req.query.trim();
  const limit = Math.max(1, Math.min(2000, req.limit));

  // Browse (no query): every file that passes the filters.
  if (!query) {
    const matched = metas.filter(filter).map((meta) => ({ meta, score: 0 }));
    const sorted = sortItems(matched, req.sort === 'relevance' ? 'path' : req.sort).slice(0, limit);
    return {
      ...empty,
      total: matched.length,
      items: sorted.map(({ meta, score }) => ({
        meta,
        score,
        nameSegments: [{ text: meta.name, hit: false }],
        pathSegments: [{ text: meta.path, hit: false }],
        snippets: [],
        matchingLines: 0,
      })),
      tookMs: performance.now() - t0,
    };
  }

  if (req.mode === 'name') {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matched: Array<{ meta: FileMeta; score: number }> = [];
    for (const meta of metas) {
      if (!filter(meta)) continue;
      const score = scorePathMatch(meta, words);
      if (score > 0) matched.push({ meta, score });
    }
    const pattern = substringsPattern(words);
    const items = sortItems(matched, req.sort)
      .slice(0, limit)
      .map(({ meta, score }) => ({
        meta,
        score,
        nameSegments: segmentsFor(meta.name, pattern),
        pathSegments: segmentsFor(meta.path, pattern),
        snippets: [],
        matchingLines: 0,
      }));
    return {
      ...empty,
      total: matched.length,
      items,
      tookMs: performance.now() - t0,
      highlight: pattern ? { source: pattern.source, flags: pattern.flags } : null,
    };
  }

  if (req.mode === 'regex') {
    const compiled = compileUserRegex(query, req.caseSensitive);
    if (!compiled.ok) return { ...empty, error: compiled.error };
    const regex = compiled.regex;
    const matched: Array<{ meta: FileMeta; score: number; lines: ReturnType<typeof matchLines> }> = [];
    const total = metas.length;
    let lastYield = performance.now();
    const hardDeadline = t0 + 30_000;
    let partial = false;
    for (let i = 0; i < total; i++) {
      const meta = metas[i];
      const text = contents[i];
      if (text && filter(meta)) {
        const lines = matchLines(text, regex, { maxSnippets: 3, countLimit: 10_000 });
        if (lines.matchingLines > 0) matched.push({ meta, score: lines.matchingLines, lines });
      }
      const now = performance.now();
      if (now - lastYield > 60) {
        lastYield = now;
        report({
          phase: 'searching',
          files: i,
          folders: 0,
          bytes: 0,
          textFiles: matched.length,
          textBytes: 0,
          ignored: 0,
          errors: 0,
          current: meta.path,
          fraction: i / total,
        });
        await yieldToEvents();
        if (seq !== searchSeq) return { ...empty, error: null, partial: true };
        if (now > hardDeadline) {
          partial = true;
          break;
        }
      }
    }
    const items = sortItems(matched, req.sort)
      .slice(0, limit)
      .map(({ meta, score, lines }) => ({
        meta,
        score,
        nameSegments: [{ text: meta.name, hit: false }],
        pathSegments: [{ text: meta.path, hit: false }],
        snippets: lines.snippets,
        matchingLines: lines.matchingLines,
      }));
    return {
      ...empty,
      total: matched.length,
      items,
      partial,
      tookMs: performance.now() - t0,
      highlight: { source: regex.source, flags: regex.flags },
    };
  }

  // Full-text search.
  const options = {
    prefix: (term: string) => term.length >= 2,
    fuzzy: (term: string) => (term.length >= 4 ? 0.2 : false),
    boost: { name: 4, path: 2, content: 1 },
    filter: (r: SearchResult) => filter(metas[r.id as number]),
  };
  let results = index.search(query, { ...options, combineWith: 'AND' });
  let relaxed = false;
  if (!results.length && /\s/.test(query)) {
    results = index.search(query, { ...options, combineWith: 'OR' });
    relaxed = results.length > 0;
  }
  const scored = results.map((r) => ({ meta: metas[r.id as number], score: r.score, terms: r.terms }));
  const sorted = sortItems(scored, req.sort).slice(0, limit);
  const allTerms = new Set<string>();
  const items: ResultItem[] = sorted.map(({ meta, score, terms }) => {
    terms.forEach((t) => allTerms.add(t));
    const pattern = termsPattern(terms);
    const text = contents[meta.id];
    const lines = pattern && text ? matchLines(text, pattern, { maxSnippets: 3, countLimit: 10_000, deadline: performance.now() + 250 }) : null;
    return {
      meta,
      score,
      nameSegments: segmentsFor(meta.name, pattern),
      pathSegments: segmentsFor(meta.path, pattern),
      snippets: lines?.snippets ?? [],
      matchingLines: lines?.matchingLines ?? 0,
    };
  });
  const highlight = termsPattern([...allTerms].slice(0, 200));
  return {
    ...empty,
    total: results.length,
    items,
    relaxed,
    tookMs: performance.now() - t0,
    highlight: highlight ? { source: highlight.source, flags: highlight.flags } : null,
  };
}

function preview(id: number): PreviewResponse {
  const meta = metas[id];
  if (!meta) throw new Error('That file is not in the index any more.');
  return { meta, content: contents[id] ?? null };
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const post = (message: WorkerResponse) => scope.postMessage(message);
  const report = (progress: IndexProgress) => post({ id: request.id, progress });
  try {
    let result: unknown;
    switch (request.type) {
      case 'cancel':
        cancelRequested = true;
        searchSeq++;
        result = null;
        break;
      case 'index':
        result = await buildIndex(request.payload.source, request.payload.options, request.payload.rootName, report);
        break;
      case 'load':
        result = await loadSnapshot(request.payload.snapshot, request.payload.summary, report);
        break;
      case 'search': {
        const seq = ++searchSeq;
        result = await search(request.payload, seq, report);
        break;
      }
      case 'preview':
        result = preview(request.payload.id);
        break;
    }
    post({ id: request.id, ok: true, result });
  } catch (error) {
    if (error instanceof Cancelled) {
      metas = [];
      contents = [];
      index = null;
      post({ id: request.id, ok: false, error: error.message, cancelled: true });
      return;
    }
    const message =
      error instanceof RangeError || (error instanceof Error && /memory|allocation/i.test(error.message))
        ? 'The browser ran out of memory while indexing. Lower the text size limit or add more folders to the ignore list.'
        : describeError(error);
    post({ id: request.id, ok: false, error: message });
  }
};

