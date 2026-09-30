import { createTwoFilesPatch, diffChars, diffLines, diffWordsWithSpace, diffWords, type Change, type DiffLinesOptionsAbortable } from 'diff';

export type DiffMode = 'line' | 'word' | 'char';

export interface DiffOptions {
  mode: DiffMode;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  /** Milliseconds before giving up on very different inputs. */
  timeout?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  /** What the counts refer to. */
  unit: 'lines' | 'words' | 'characters';
}

export type DiffResult = { ok: true; changes: Change[]; stats: DiffStats } | { ok: false; error: string };

const TIMEOUT_MS = 8000;

/** Split into lines keeping their line terminators, like the diff library does. */
export function splitKeepingEol(text: string): string[] {
  if (!text) return [];
  const parts = text.split(/(\r\n|\n)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] + (parts[i + 1] ?? '');
    if (line) out.push(line);
  }
  return out;
}

function countWords(value: string): number {
  return value.match(/[^\s]+/g)?.length ?? 0;
}

function countChars(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

/**
 * Line comparison that ignores every whitespace difference, like `git diff -w` ("a  b" = "a b",
 * CRLF = LF, indentation and trailing spaces ignored). The diff library's own option only trims
 * the ends of lines.
 */
function whitespaceInsensitiveComparator(ignoreCase: boolean): (left: string, right: string) => boolean {
  const cache = new Map<string, string>();
  const key = (s: string) => {
    let k = cache.get(s);
    if (k === undefined) {
      k = s.replace(/\s+/g, '');
      if (ignoreCase) k = k.toLowerCase();
      if (cache.size < 100_000) cache.set(s, k);
    }
    return k;
  };
  return (left, right) => left === right || key(left) === key(right);
}

/** Collapse whitespace for a whitespace-insensitive character diff, keeping line breaks visible. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? '\n' : ' '));
}

export function computeDiff(a: string, b: string, o: DiffOptions): DiffResult {
  const timeout = o.timeout ?? TIMEOUT_MS;
  let changes: Change[] | undefined;
  if (o.mode === 'line') {
    // jsdiff's Diff#equals honours `comparator` and `ignoreCase` for every diff type (the typings
    // only list them for arrays and characters); tests in diff.test.ts pin this behaviour.
    const opts = (
      o.ignoreWhitespace ? { comparator: whitespaceInsensitiveComparator(o.ignoreCase), timeout } : { ignoreCase: o.ignoreCase, timeout }
    ) as unknown as DiffLinesOptionsAbortable;
    changes = diffLines(a, b, opts);
  } else if (o.mode === 'word') {
    changes = o.ignoreWhitespace
      ? diffWords(a, b, { ignoreCase: o.ignoreCase, timeout })
      : diffWordsWithSpace(a, b, { ignoreCase: o.ignoreCase, timeout });
  } else {
    const left = o.ignoreWhitespace ? collapseWhitespace(a) : a;
    const right = o.ignoreWhitespace ? collapseWhitespace(b) : b;
    changes = diffChars(left, right, { ignoreCase: o.ignoreCase, timeout });
  }
  if (!changes) {
    return {
      ok: false,
      error: 'The texts are too different to compare in reasonable time. Try line mode or compare smaller sections.',
    };
  }
  const unit = o.mode === 'line' ? 'lines' : o.mode === 'word' ? 'words' : 'characters';
  const measure = o.mode === 'line' ? (c: Change) => c.count : o.mode === 'word' ? (c: Change) => countWords(c.value) : (c: Change) => countChars(c.value);
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0, unit };
  for (const c of changes) {
    const n = measure(c);
    if (c.added) stats.added += n;
    else if (c.removed) stats.removed += n;
    else stats.unchanged += n;
  }
  return { ok: true, changes, stats };
}

export type RowKind = 'equal' | 'removed' | 'added' | 'changed';

export interface DiffRow {
  kind: RowKind;
  left?: { no: number; text: string };
  right?: { no: number; text: string };
}

function stripEol(line: string): string {
  return line.replace(/\r?\n$/, '');
}

/**
 * Turn a line diff into rows for display. Uses the original lines from both
 * inputs (so ignore-case/whitespace comparisons still show real text), and
 * pairs removed/added runs into "changed" rows.
 */
export function buildLineRows(a: string, b: string, changes: Change[]): DiffRow[] {
  const oldLines = splitKeepingEol(a);
  const newLines = splitKeepingEol(b);
  let oi = 0;
  let ni = 0;
  const rows: DiffRow[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      for (let k = 0; k < c.count; k++) {
        rows.push({
          kind: 'equal',
          left: { no: oi + 1, text: stripEol(oldLines[oi] ?? '') },
          right: { no: ni + 1, text: stripEol(newLines[ni] ?? '') },
        });
        oi++;
        ni++;
      }
      continue;
    }
    let removed = 0;
    let added = 0;
    if (c.removed) {
      removed = c.count;
      const next = changes[i + 1];
      if (next?.added) {
        added = next.count;
        i++;
      }
    } else {
      added = c.count;
    }
    const paired = Math.min(removed, added);
    for (let k = 0; k < Math.max(removed, added); k++) {
      const row: DiffRow = { kind: k < paired ? 'changed' : k < removed ? 'removed' : 'added' };
      if (k < removed) row.left = { no: oi + k + 1, text: stripEol(oldLines[oi + k] ?? '') };
      if (k < added) row.right = { no: ni + k + 1, text: stripEol(newLines[ni + k] ?? '') };
      rows.push(row);
    }
    oi += removed;
    ni += added;
  }
  return rows;
}

export interface InlinePart {
  text: string;
  changed: boolean;
}

/** Word-level highlight inside a changed line pair. */
export function inlineLineDiff(left: string, right: string, ignoreCase = false): { left: InlinePart[]; right: InlinePart[] } {
  if (left.length + right.length > 4000) {
    return { left: [{ text: left, changed: true }], right: [{ text: right, changed: true }] };
  }
  const parts = diffWordsWithSpace(left, right, { ignoreCase });
  const l: InlinePart[] = [];
  const r: InlinePart[] = [];
  for (const p of parts) {
    if (p.removed) l.push({ text: p.value, changed: true });
    else if (p.added) r.push({ text: p.value, changed: true });
    else {
      l.push({ text: p.value, changed: false });
      r.push({ text: p.value, changed: false });
    }
  }
  return { left: l, right: r };
}

/** Collapse long runs of unchanged rows, keeping `context` rows around changes. */
export type DisplayRow = DiffRow | { kind: 'skip'; count: number; from: number };

export function collapseRows(rows: DiffRow[], context: number): DisplayRow[] {
  if (context < 0) return rows;
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind !== 'equal') {
      for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
    }
  });
  const out: DisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i]);
      i++;
      continue;
    }
    const from = i;
    while (i < rows.length && !keep[i]) i++;
    out.push({ kind: 'skip', count: i - from, from });
  }
  return out;
}

/** A unified .patch (always an exact line diff, so it applies cleanly). */
export function createPatch(a: string, b: string, oldName = 'original.txt', newName = 'modified.txt'): string {
  return createTwoFilesPatch(oldName, newName, a, b, undefined, undefined, { context: 3 });
}
