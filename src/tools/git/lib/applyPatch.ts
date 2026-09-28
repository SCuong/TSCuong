import { applyPatch, reversePatch, type StructuredPatch } from 'diff';
import type { DiffFile, DiffHunk } from './diffParse';

/** Convert a parsed file section into the structure the `diff` package applies. */
export function toStructuredPatch(file: DiffFile, hunks: DiffHunk[] = file.hunks): StructuredPatch {
  return {
    oldFileName: file.oldPath ?? '/dev/null',
    newFileName: file.newPath ?? '/dev/null',
    oldHeader: undefined,
    newHeader: undefined,
    hunks: hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: h.lines.flatMap((l) => {
        const prefix = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
        const out = [prefix + l.content];
        if (l.noNewline) out.push('\\ No newline at end of file');
        return out;
      }),
    })),
  };
}

export interface HunkConflict {
  hunkIndex: number;
  header: string;
  /** Lines the hunk expects in the original (context and removed lines). */
  expected: string[];
  /** The lines found at the hunk's position in the provided text. */
  actual: string[];
  /** 1-based line number where `actual` starts. */
  actualStart: number;
  /** Index in `expected` of the first mismatching line, or -1 when the text is too short. */
  firstMismatch: number;
}

export type ApplyOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: 'binary' | 'no-hunks'; message: string }
  | { ok: false; reason: 'conflict'; message: string; conflict: HunkConflict; alreadyApplied: boolean };

/**
 * Apply one file's hunks to `source`. On failure, finds the first hunk that
 * does not fit and describes the mismatch.
 */
export function applyFilePatch(source: string, file: DiffFile, fuzzFactor = 0): ApplyOutcome {
  if (file.binary) {
    return { ok: false, reason: 'binary', message: 'This is a binary change. Binary patches cannot be applied to text.' };
  }
  if (!file.hunks.length) {
    return { ok: false, reason: 'no-hunks', message: 'This file section has no hunks (it only renames the file or changes its mode).' };
  }
  const options = { fuzzFactor, autoConvertLineEndings: true };
  // Creating a file: the diff package treats '' as one empty line, so build the result directly.
  if (source === '' && file.hunks.every((h) => h.oldStart === 0 && h.oldLines === 0)) {
    const added = file.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'));
    const last = added[added.length - 1];
    return { ok: true, text: added.map((l) => l.content).join('\n') + (last && !last.noNewline ? '\n' : '') };
  }
  const full = applyPatch(source, toStructuredPatch(file), options);
  if (full !== false) return { ok: true, text: full };

  // Find the first failing hunk by applying growing prefixes of the hunk list.
  let failing = file.hunks.length - 1;
  for (let k = 1; k <= file.hunks.length; k++) {
    if (applyPatch(source, toStructuredPatch(file, file.hunks.slice(0, k)), options) === false) {
      failing = k - 1;
      break;
    }
  }
  const hunk = file.hunks[failing];
  const expected = hunk.lines.filter((l) => l.type !== 'add').map((l) => l.content);
  const sourceLines = source.split(/\r?\n/);
  const startIdx = Math.max(0, hunk.oldStart - 1);
  const actual = sourceLines.slice(startIdx, startIdx + Math.max(expected.length, 1));
  let firstMismatch = expected.findIndex((line, j) => actual[j] !== line);
  if (firstMismatch === -1 && actual.length < expected.length) firstMismatch = actual.length;

  const alreadyApplied = applyPatch(source, reversePatch(toStructuredPatch(file)), options) !== false;
  const where =
    firstMismatch >= 0 && firstMismatch < expected.length
      ? ` Line ${startIdx + firstMismatch + 1} should be “${truncate(expected[firstMismatch])}” but is ${
          actual[firstMismatch] === undefined ? 'past the end of the text' : `“${truncate(actual[firstMismatch])}”`
        }.`
      : '';
  const message = alreadyApplied
    ? 'The text already contains these changes: the patch appears to be applied already.'
    : `Hunk ${failing + 1} of ${file.hunks.length} (${hunk.header.split(' @@')[0]} @@) does not match the text, and no nearby position fits${
        fuzzFactor ? ` even with fuzz ${fuzzFactor}` : ''
      }.${where}`;
  return {
    ok: false,
    reason: 'conflict',
    message,
    alreadyApplied,
    conflict: { hunkIndex: failing, header: hunk.header, expected, actual, actualStart: startIdx + 1, firstMismatch },
  };
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
