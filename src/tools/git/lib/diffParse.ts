/**
 * Parser for unified diffs, `git diff` output, and `git format-patch` mbox
 * files. It is deliberately tolerant: malformed input produces warnings and a
 * best-effort result instead of throwing.
 */

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldNo: number | null;
  newNo: number | null;
  /** The line is followed by "\ No newline at end of file". */
  noNewline?: boolean;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second @@ (usually the enclosing function). */
  section: string;
  lines: DiffLine[];
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'mode';

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  status: FileStatus;
  binary: boolean;
  /** `GIT binary patch` data was included (it is not decoded). */
  binaryPatch: boolean;
  similarity: number | null;
  oldMode: string | null;
  newMode: string | null;
  /** Abbreviated blob ids from the `index` line. */
  oldHash: string | null;
  newHash: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isGit: boolean;
  /** Index into `ParsedDiff.commits` of the commit this file belongs to (format-patch input), else null. */
  commit: number | null;
}

export interface PatchCommit {
  hash: string | null;
  author: string | null;
  date: string | null;
  subject: string;
  body: string;
}

export interface ParsedDiff {
  files: DiffFile[];
  commits: PatchCommit[];
  warnings: string[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const MBOX_FROM_RE = /^From ([0-9a-f]{7,64}) (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /;

/** Decode a C-style quoted git path ("a/caf\303\251.txt"). Returns the input unchanged when not quoted. */
export function unquoteGitPath(raw: string): string {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const pushText = (s: string) => bytes.push(...new TextEncoder().encode(s));
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      pushText(ch);
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    if (/[0-7]/.test(next)) {
      let oct = next;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v' };
      pushText(map[next] ?? next);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Strip the a/ b/ (or other single-letter git) prefix. */
function stripPrefix(path: string): string {
  return path.replace(/^[a-z]\//, '');
}

/** Path from a ---/+++ line: drops the tab-separated timestamp, unquotes, strips a/ b/. */
function headerPath(rest: string, isGit: boolean): string | null {
  let p = rest;
  if (!p.startsWith('"')) {
    const tab = p.indexOf('\t');
    if (tab >= 0) p = p.slice(0, tab);
    p = p.replace(/\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?( [+-]\d{4})?$/, '');
  }
  p = unquoteGitPath(p.trim());
  if (p === '/dev/null') return null;
  return isGit ? stripPrefix(p) : p;
}

/** Split the two paths of a `diff --git` line. */
export function parseGitDiffPaths(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    const end = findQuoteEnd(rest, 0);
    if (end < 0) return null;
    const first = rest.slice(0, end + 1);
    const second = rest.slice(end + 1).trim();
    return [stripPrefix(unquoteGitPath(first)), stripPrefix(unquoteGitPath(second))];
  }
  if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "');
    if (start < 0) return null;
    return [stripPrefix(rest.slice(0, start)), stripPrefix(unquoteGitPath(rest.slice(start + 1)))];
  }
  // Unquoted: if both halves are equal (the common case), split in the middle; this handles spaces.
  if (rest.length % 2 === 1) {
    const mid = (rest.length - 1) / 2;
    const a = rest.slice(0, mid);
    const b = rest.slice(mid + 1);
    if (rest[mid] === ' ' && stripPrefix(a) === stripPrefix(b)) return [stripPrefix(a), stripPrefix(b)];
  }
  const idx = rest.indexOf(' b/');
  if (idx > 0) return [stripPrefix(rest.slice(0, idx)), stripPrefix(rest.slice(idx + 1))];
  const space = rest.indexOf(' ');
  if (space > 0) return [stripPrefix(rest.slice(0, space)), stripPrefix(rest.slice(space + 1))];
  return null;
}

function findQuoteEnd(s: string, start: number): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

function newFile(isGit: boolean): DiffFile {
  return {
    oldPath: null,
    newPath: null,
    status: 'modified',
    binary: false,
    binaryPatch: false,
    similarity: null,
    oldMode: null,
    newMode: null,
    oldHash: null,
    newHash: null,
    hunks: [],
    additions: 0,
    deletions: 0,
    isGit,
    commit: null,
  };
}

/** Decode RFC 2047 encoded-words in mail headers (=?UTF-8?q?...?= / =?UTF-8?b?...?=). */
export function decodeMimeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_, charset: string, enc: string, text: string) => {
    try {
      let bytes: Uint8Array;
      if (enc.toLowerCase() === 'b') {
        const bin = atob(text);
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      } else {
        const out: number[] = [];
        const t = text.replace(/_/g, ' ');
        for (let i = 0; i < t.length; i++) {
          if (t[i] === '=' && /^[0-9a-f]{2}$/i.test(t.slice(i + 1, i + 3))) {
            out.push(parseInt(t.slice(i + 1, i + 3), 16));
            i += 2;
          } else out.push(t.charCodeAt(i));
        }
        bytes = new Uint8Array(out);
      }
      return new TextDecoder(charset.toLowerCase() === 'utf-8' ? 'utf-8' : charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

export function parseDiff(input: string): ParsedDiff {
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const files: DiffFile[] = [];
  const commits: PatchCommit[] = [];
  const warnings: string[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let skippedCombined = 0;
  let unexpected = 0;

  const fileLabel = (f: DiffFile) => f.newPath ?? f.oldPath ?? 'unknown file';

  function closeHunk() {
    if (hunk && file && (oldLeft > 0 || newLeft > 0)) {
      warnings.push(
        `Hunk ${hunk.header.split(' @@')[0]} @@ in ${fileLabel(file)} is incomplete: ${oldLeft} old and ${newLeft} new line(s) missing.`,
      );
    }
    hunk = null;
    oldLeft = 0;
    newLeft = 0;
  }

  function closeFile() {
    closeHunk();
    file = null;
  }

  function startFile(isGit: boolean): DiffFile {
    closeFile();
    const f = newFile(isGit);
    f.commit = commits.length ? commits.length - 1 : null;
    files.push(f);
    file = f;
    return f;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Inside a hunk: consume body lines while the header's counts say more are expected.
    if (hunk && file && (oldLeft > 0 || newLeft > 0)) {
      const h: DiffHunk = hunk;
      const f: DiffFile = file;
      const c = line[0];
      if (c === ' ' || (line === '' && oldLeft > 0 && newLeft > 0)) {
        h.lines.push({ type: 'context', content: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
        i++;
        continue;
      }
      if (c === '-' && oldLeft > 0) {
        h.lines.push({ type: 'del', content: line.slice(1), oldNo: oldNo++, newNo: null });
        f.deletions++;
        oldLeft--;
        i++;
        continue;
      }
      if (c === '+' && newLeft > 0) {
        h.lines.push({ type: 'add', content: line.slice(1), oldNo: null, newNo: newNo++ });
        f.additions++;
        newLeft--;
        i++;
        continue;
      }
      if (c === '\\') {
        const last = h.lines[h.lines.length - 1];
        if (last) last.noNewline = true;
        i++;
        continue;
      }
      closeHunk();
      // fall through: re-examine this line as a header
    }

    if (line.startsWith('\\') && file) {
      const f: DiffFile = file;
      const lastHunk = f.hunks[f.hunks.length - 1];
      const last = lastHunk?.lines[lastHunk.lines.length - 1];
      if (last) last.noNewline = true;
      i++;
      continue;
    }

    if (MBOX_FROM_RE.test(line)) {
      closeFile();
      i = parseMailHeader(lines, i, commits);
      continue;
    }

    if (line.startsWith('diff --git ')) {
      const f = startFile(true);
      const paths = parseGitDiffPaths(line.slice('diff --git '.length));
      if (paths) [f.oldPath, f.newPath] = paths;
      else warnings.push(`Could not read the file names in: ${line.slice(0, 120)}`);
      i++;
      continue;
    }

    if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      closeFile();
      skippedCombined++;
      i++;
      // Skip the combined diff body until the next file header.
      while (i < lines.length && !lines[i].startsWith('diff --') && !MBOX_FROM_RE.test(lines[i])) i++;
      continue;
    }

    if (file && !hunk) {
      const f: DiffFile = file;
      const ext = parseExtendedHeader(f, line);
      if (ext) {
        i++;
        continue;
      }
      if (line === 'GIT binary patch') {
        f.binary = true;
        f.binaryPatch = true;
        i++;
        // literal/delta blocks: base85 lines separated by blank lines, two blocks in total.
        let blocks = 0;
        while (i < lines.length && blocks < 2) {
          if (/^(literal|delta) \d+$/.test(lines[i])) {
            i++;
            while (i < lines.length && lines[i] !== '') i++;
            blocks++;
          }
          if (lines[i] === '') i++;
          else break;
        }
        continue;
      }
    }

    if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      // A new file section for plain unified diffs, or the ---/+++ pair of a git section.
      let f: DiffFile;
      const current = file as DiffFile | null;
      if (current && current.isGit && current.hunks.length === 0 && !current.binary) f = current;
      else f = startFile(false);
      const oldP = headerPath(line.slice(4), f.isGit);
      const newP = headerPath(lines[i + 1].slice(4), f.isGit);
      if (!f.isGit) {
        [f.oldPath, f.newPath] = stripAB(oldP, newP);
      } else {
        if (oldP !== null) f.oldPath = oldP;
        if (newP !== null) f.newPath = newP;
      }
      if (oldP === null) {
        f.status = 'added';
        if (!f.isGit) f.oldPath = null;
      }
      if (newP === null) {
        f.status = 'deleted';
        if (!f.isGit) f.newPath = null;
      }
      i += 2;
      continue;
    }

    const m = HUNK_RE.exec(line);
    if (m) {
      if (!file) {
        startFile(false);
        warnings.push('The patch has a hunk without file headers; showing it as an unnamed file.');
      }
      closeHunk();
      const f: DiffFile = file!;
      const h: DiffHunk = {
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        section: m[5].trim(),
        lines: [],
      };
      f.hunks.push(h);
      hunk = h;
      oldLeft = h.oldLines;
      newLeft = h.newLines;
      oldNo = h.oldStart === 0 && h.oldLines === 0 ? 0 : h.oldStart;
      newNo = h.newStart === 0 && h.newLines === 0 ? 0 : h.newStart;
      i++;
      continue;
    }

    if (line.startsWith('@@')) {
      warnings.push(`Malformed hunk header ignored: ${line.slice(0, 80)}`);
    } else if (file && (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('-- ') && line !== '--') {
      unexpected++;
    }
    i++;
  }
  closeFile();

  // Final bookkeeping: statuses and paths.
  for (const f of files) {
    if (f.status === 'modified' && f.oldMode && f.newMode && f.oldMode !== f.newMode && f.hunks.length === 0 && !f.binary) {
      f.status = 'mode';
    }
    if (f.status === 'added') f.oldPath = f.isGit ? f.oldPath : null;
    if (f.status === 'modified' && f.oldPath && f.newPath && f.oldPath !== f.newPath && f.isGit) f.status = 'renamed';
  }
  if (skippedCombined) {
    warnings.push(`${skippedCombined} combined (merge) diff section(s) were skipped: only two-way diffs are supported.`);
  }
  if (unexpected) warnings.push(`${unexpected} line(s) outside any hunk looked like changes and were ignored.`);
  if (!files.length && input.trim()) {
    warnings.push('No file changes found. Paste a unified diff (diff -u), git diff output or a git format-patch file.');
  }
  return { files, commits, warnings };
}

/** For non-git diffs, strip a/ b/ prefixes only when both sides use them. */
function stripAB(oldP: string | null, newP: string | null): [string | null, string | null] {
  const aOk = oldP === null || oldP.startsWith('a/');
  const bOk = newP === null || newP.startsWith('b/');
  if (aOk && bOk && (oldP !== null || newP !== null)) return [oldP?.slice(2) ?? null, newP?.slice(2) ?? null];
  return [oldP, newP];
}

function parseExtendedHeader(f: DiffFile, line: string): boolean {
  let m: RegExpExecArray | null;
  if ((m = /^old mode (\d+)$/.exec(line))) f.oldMode = m[1];
  else if ((m = /^new mode (\d+)$/.exec(line))) f.newMode = m[1];
  else if ((m = /^deleted file mode (\d+)$/.exec(line))) {
    f.oldMode = m[1];
    f.status = 'deleted';
  } else if ((m = /^new file mode (\d+)$/.exec(line))) {
    f.newMode = m[1];
    f.status = 'added';
  } else if ((m = /^(?:dis)?similarity index (\d+)%$/.exec(line))) f.similarity = Number(m[1]);
  else if ((m = /^rename from (.+)$/.exec(line))) {
    f.oldPath = unquoteGitPath(m[1]);
    f.status = 'renamed';
  } else if ((m = /^rename to (.+)$/.exec(line))) {
    f.newPath = unquoteGitPath(m[1]);
    f.status = 'renamed';
  } else if ((m = /^copy from (.+)$/.exec(line))) {
    f.oldPath = unquoteGitPath(m[1]);
    f.status = 'copied';
  } else if ((m = /^copy to (.+)$/.exec(line))) {
    f.newPath = unquoteGitPath(m[1]);
    f.status = 'copied';
  } else if ((m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/.exec(line))) {
    f.oldHash = m[1];
    f.newHash = m[2];
    if (m[3]) {
      f.oldMode ??= m[3];
      f.newMode ??= m[3];
    }
  } else if (/^Binary files .* differ$/.test(line)) {
    f.binary = true;
  } else return false;
  return true;
}

/** Parse a `git format-patch` mail header starting at `start`; returns the index of the first line after the commit message. */
function parseMailHeader(lines: string[], start: number, commits: PatchCommit[]): number {
  const commit: PatchCommit = { hash: MBOX_FROM_RE.exec(lines[start])?.[1] ?? null, author: null, date: null, subject: '', body: '' };
  let i = start + 1;
  let lastHeader: 'from' | 'date' | 'subject' | null = null;
  for (; i < lines.length && lines[i] !== ''; i++) {
    const line = lines[i];
    if (/^\s/.test(line) && lastHeader) {
      const cont = line.trim();
      if (lastHeader === 'subject') commit.subject += ` ${cont}`;
      else if (lastHeader === 'from') commit.author = `${commit.author ?? ''} ${cont}`;
      continue;
    }
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) break;
    const key = m[1].toLowerCase();
    lastHeader = key === 'from' ? 'from' : key === 'date' ? 'date' : key === 'subject' ? 'subject' : null;
    if (key === 'from') commit.author = m[2];
    else if (key === 'date') commit.date = m[2];
    else if (key === 'subject') commit.subject = m[2];
  }
  commit.subject = decodeMimeHeader(commit.subject)
    .replace(/^\[PATCH[^\]]*\]\s*/i, '')
    .trim();
  if (commit.author) commit.author = decodeMimeHeader(commit.author).trim();
  // Body: until the "---" separator or the first diff.
  const body: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---' || line.startsWith('diff --git ') || MBOX_FROM_RE.test(line)) break;
    body.push(line);
  }
  commit.body = body.join('\n').trim();
  // Skip the diffstat after "---".
  if (lines[i] === '---') {
    i++;
    while (i < lines.length && !lines[i].startsWith('diff --') && !MBOX_FROM_RE.test(lines[i]) && !lines[i].startsWith('--- ')) i++;
  }
  commits.push(commit);
  return i;
}

export function displayPath(f: DiffFile): string {
  if ((f.status === 'renamed' || f.status === 'copied') && f.oldPath && f.newPath && f.oldPath !== f.newPath) {
    return `${f.oldPath} → ${f.newPath}`;
  }
  return f.newPath ?? f.oldPath ?? '(unnamed)';
}

export function diffTotals(files: DiffFile[]): { files: number; additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({ files: acc.files + 1, additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

/** One row of the side-by-side view. */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pair deletions with following additions so modified lines sit side by side. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}

export type ContextSegment<T> = { kind: 'lines'; items: T[] } | { kind: 'collapsed'; items: T[]; id: string };

/**
 * Collapse long runs of unchanged rows inside a hunk, keeping `keep` rows of
 * context next to each change. `isContext` decides which rows are unchanged.
 */
export function collapseContext<T>(rows: T[], isContext: (row: T) => boolean, keep = 3, minRun = 8, idPrefix = ''): ContextSegment<T>[] {
  const segments: ContextSegment<T>[] = [];
  let buffer: T[] = [];
  const flush = () => {
    if (buffer.length) segments.push({ kind: 'lines', items: buffer });
    buffer = [];
  };
  let i = 0;
  while (i < rows.length) {
    if (!isContext(rows[i])) {
      buffer.push(rows[i++]);
      continue;
    }
    let j = i;
    while (j < rows.length && isContext(rows[j])) j++;
    const run = rows.slice(i, j);
    const atStart = i === 0;
    const atEnd = j === rows.length;
    const head = atStart ? 0 : keep;
    const tail = atEnd ? 0 : keep;
    if (run.length - head - tail >= minRun - keep) {
      buffer.push(...run.slice(0, head));
      flush();
      segments.push({ kind: 'collapsed', items: run.slice(head, run.length - tail), id: `${idPrefix}${i}` });
      buffer.push(...run.slice(run.length - tail));
    } else buffer.push(...run);
    i = j;
  }
  flush();
  return segments;
}
