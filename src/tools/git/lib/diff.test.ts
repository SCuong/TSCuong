import { describe, expect, it } from 'vitest';
import formatPatch from './fixtures/format-patch.patch?raw';
import samplePatch from './fixtures/sample.patch?raw';
import cartOrig from './fixtures/cart.orig.ts.txt?raw';
import {
  collapseContext,
  decodeMimeHeader,
  diffTotals,
  displayPath,
  parseDiff,
  parseGitDiffPaths,
  toSplitRows,
  unquoteGitPath,
} from './diffParse';
import { applyFilePatch, toStructuredPatch } from './applyPatch';

describe('parseDiff: git format-patch mbox', () => {
  const parsed = parseDiff(formatPatch);

  it('reads the commit header', () => {
    expect(parsed.commits).toHaveLength(1);
    expect(parsed.commits[0]).toMatchObject({
      hash: '09e116fb19413c170cac8c6616409ab6d9e67e1d',
      author: 'Ada Lovelace <ada@example.com>',
      subject: 'feat(core): change many things',
      body: 'Body line explaining why.\n\nRefs: #12',
    });
  });

  it('finds every file with the right status', () => {
    expect(parsed.files.map((f) => [displayPath(f), f.status])).toEqual([
      ['a.txt', 'modified'],
      ['café.txt', 'added'],
      ['img.bin', 'modified'],
      ['old name.md → new name.md', 'renamed'],
      ['nums.txt', 'modified'],
      ['run.sh', 'mode'],
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('parses hunks, counts and line numbers', () => {
    const a = parsed.files[0];
    expect(a.additions).toBe(2);
    expect(a.deletions).toBe(1);
    expect(a.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
    const lines = a.hunks[0].lines;
    expect(lines.map((l) => `${l.type}:${l.oldNo ?? '-'}:${l.newNo ?? '-'}:${l.content}`)).toEqual([
      'context:1:1:line1',
      'del:2:-:line2',
      'add:-:2:line2 changed',
      'context:3:3:line3',
      'add:-:4:line4',
    ]);
    expect(lines[4].noNewline).toBe(true);
    const nums = parsed.files[4];
    expect(nums.hunks).toHaveLength(2);
    expect(nums.hunks[1].lines.find((l) => l.type === 'add')).toMatchObject({ content: 'thirty', newNo: 30 });
  });

  it('marks binary patches and mode changes, and ignores the signature', () => {
    const img = parsed.files[2];
    expect(img).toMatchObject({ binary: true, binaryPatch: true, hunks: [] });
    const run = parsed.files[5];
    expect(run).toMatchObject({ oldMode: '100644', newMode: '100755', hunks: [] });
    const renamed = parsed.files[3];
    expect(renamed).toMatchObject({ similarity: 85, oldPath: 'old name.md', newPath: 'new name.md', additions: 1 });
    expect(renamed.hunks[0].section).toBe('old name content');
    expect(diffTotals(parsed.files)).toEqual({ files: 6, additions: 6, deletions: 3 });
  });
});

describe('parseDiff: other formats', () => {
  it('parses plain diff -u output with timestamps', () => {
    const d = parseDiff(
      '--- o.txt\t2026-09-29 01:51:39.469483000 +0700\n+++ n.txt\t2026-09-29 01:51:39.469483000 +0700\n@@ -1,2 +1,2 @@\n x\n-y\n+z\n',
    );
    expect(d.files).toHaveLength(1);
    expect(d.files[0]).toMatchObject({ oldPath: 'o.txt', newPath: 'n.txt', isGit: false, additions: 1, deletions: 1 });
  });

  it('strips a/ b/ prefixes in non-git diffs only when both sides have them', () => {
    const d = parseDiff('--- a/src/x.js\n+++ b/src/x.js\n@@ -1 +1 @@\n-a\n+b\n');
    expect(d.files[0].newPath).toBe('src/x.js');
    const e = parseDiff('--- alpha/x\n+++ beta/x\n@@ -1 +1 @@\n-a\n+b\n');
    expect(e.files[0].newPath).toBe('beta/x');
  });

  it('handles multiple files, deletions and new files in plain diffs', () => {
    const d = parseDiff(
      [
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-bye',
      ].join('\n'),
    );
    expect(d.files.map((f) => [f.status, displayPath(f)])).toEqual([
      ['added', 'new.txt'],
      ['deleted', 'gone.txt'],
    ]);
    expect(d.files[0].hunks[0].lines.map((l) => l.newNo)).toEqual([1, 2]);
  });

  it('parses git deleted files and "Binary files differ"', () => {
    const d = parseDiff(
      [
        'diff --git a/old.txt b/old.txt',
        'deleted file mode 100644',
        'index 3b18e51..0000000',
        '--- a/old.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-hello world',
        'diff --git a/logo.png b/logo.png',
        'new file mode 100644',
        'index 0000000..1111111',
        'Binary files /dev/null and b/logo.png differ',
      ].join('\n'),
    );
    expect(d.files[0]).toMatchObject({ status: 'deleted', oldPath: 'old.txt', deletions: 1 });
    expect(d.files[1]).toMatchObject({ status: 'added', binary: true, binaryPatch: false, newPath: 'logo.png' });
  });

  it('handles CRLF input, BOM and blank context lines', () => {
    const d = parseDiff('\uFEFF--- a\r\n+++ b\r\n@@ -1,3 +1,3 @@\r\n x\r\n\r\n-y\r\n+z\r\n');
    expect(d.files[0].hunks[0].lines.map((l) => l.type)).toEqual(['context', 'context', 'del', 'add']);
    expect(d.warnings).toEqual([]);
  });

  it('reports truncated hunks and malformed headers without throwing', () => {
    const d = parseDiff('--- a\n+++ b\n@@ -1,5 +1,5 @@\n x\n-y\n+z\n@@ nonsense @@\n');
    expect(d.files).toHaveLength(1);
    expect(d.warnings.some((w) => /incomplete/.test(w))).toBe(true);
    expect(d.warnings.some((w) => /Malformed hunk header/.test(w))).toBe(true);
  });

  it('accepts a bare hunk without file headers', () => {
    const d = parseDiff('@@ -1 +1 @@\n-a\n+b\n');
    expect(d.files).toHaveLength(1);
    expect(d.warnings[0]).toMatch(/without file headers/);
  });

  it('explains when nothing looks like a diff', () => {
    expect(parseDiff('hello there').warnings[0]).toMatch(/No file changes found/);
    expect(parseDiff('').warnings).toEqual([]);
    expect(parseDiff('').files).toEqual([]);
  });

  it('skips combined merge diffs with a warning', () => {
    const d = parseDiff('diff --cc file.txt\nindex 1,2..3\n@@@ -1,1 -1,1 +1,1 @@@\n- a\n -b\n++c\n');
    expect(d.files).toEqual([]);
    expect(d.warnings[0]).toMatch(/combined/);
  });

  it('parses several commits in one mbox', () => {
    const one = formatPatch;
    const two = one.replace('09e116fb19413c170cac8c6616409ab6d9e67e1d', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').replace('change many things', 'second');
    const d = parseDiff(one + two);
    expect(d.commits.map((c) => c.subject)).toEqual(['feat(core): change many things', 'feat(core): second']);
    expect(d.files).toHaveLength(12);
  });

  it('handles emoji and unicode content', () => {
    const d = parseDiff('--- a/e.txt\n+++ b/e.txt\n@@ -1 +1 @@\n-héllo 👋\n+héllo 🚀\n');
    expect(d.files[0].hunks[0].lines[1].content).toBe('héllo 🚀');
  });

  it('parses large diffs quickly', () => {
    const body = Array.from({ length: 20000 }, (_, i) => `+line ${i}`).join('\n');
    const start = performance.now();
    const d = parseDiff(`--- a/big\n+++ b/big\n@@ -0,0 +1,20000 @@\n${body}\n`);
    expect(d.files[0].additions).toBe(20000);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('paths', () => {
  it('unquotes C-style git paths', () => {
    expect(unquoteGitPath('"caf\\303\\251.txt"')).toBe('café.txt');
    expect(unquoteGitPath('"tab\\there \\"q\\""')).toBe('tab\there "q"');
    expect(unquoteGitPath('plain')).toBe('plain');
  });
  it('splits diff --git paths', () => {
    expect(parseGitDiffPaths('a/x y.txt b/x y.txt')).toEqual(['x y.txt', 'x y.txt']);
    expect(parseGitDiffPaths('a/old b/new')).toEqual(['old', 'new']);
    expect(parseGitDiffPaths('"a/caf\\303\\251" "b/caf\\303\\251"')).toEqual(['café', 'café']);
    expect(parseGitDiffPaths('a/plain "b/caf\\303\\251"')).toEqual(['plain', 'café']);
  });
  it('decodes MIME encoded subjects', () => {
    expect(decodeMimeHeader('=?UTF-8?q?caf=C3=A9_fix?=')).toBe('café fix');
    expect(decodeMimeHeader('=?UTF-8?b?8J+agA==?=')).toBe('🚀');
    expect(decodeMimeHeader('plain')).toBe('plain');
  });
});

describe('view helpers', () => {
  it('pairs deletions and additions for side-by-side rows', () => {
    const d = parseDiff('--- a\n+++ b\n@@ -1,4 +1,3 @@\n a\n-b\n-c\n+B\n d\n');
    const rows = toSplitRows(d.files[0].hunks[0].lines);
    expect(rows.map((r) => [r.left?.content ?? null, r.right?.content ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', null],
      ['d', 'd'],
    ]);
  });
  it('collapses long context runs but keeps context near changes', () => {
    const rows = [...'cccccccccccc'.split(''), 'X', ...'cccccccccccc'.split(''), 'Y', 'c', 'c'];
    const segs = collapseContext(rows, (r) => r === 'c', 3, 8);
    expect(segs.map((s) => `${s.kind}:${s.items.length}`)).toEqual([
      'collapsed:9',
      'lines:7',
      'collapsed:6',
      'lines:6',
    ]);
    expect(collapseContext(['c', 'X', 'c'], (r) => r === 'c')).toEqual([{ kind: 'lines', items: ['c', 'X', 'c'] }]);
  });
});

describe('applyFilePatch', () => {
  const parsed = parseDiff(formatPatch);
  const nums = Array.from({ length: 40 }, (_, i) => String(i + 1)).join('\n') + '\n';

  it('applies a patch to matching text', () => {
    const r = applyFilePatch('line1\nline2\nline3\n', parsed.files[0]);
    expect(r).toEqual({ ok: true, text: 'line1\nline2 changed\nline3\nline4' });
    const n = applyFilePatch(nums, parsed.files[4]);
    expect(n.ok && n.text.split('\n')[9]).toBe('ten');
    expect(n.ok && n.text.split('\n')[29]).toBe('thirty');
  });

  it('applies to shifted text and CRLF text', () => {
    const shifted = applyFilePatch('header\nextra\n' + nums, parsed.files[4]);
    expect(shifted.ok).toBe(true);
    const crlf = applyFilePatch('line1\r\nline2\r\nline3\r\n', parsed.files[0]);
    expect(crlf.ok && crlf.text.includes('line2 changed')).toBe(true);
  });

  it('reports which hunk conflicts and why', () => {
    const broken = nums.replace('29\n30\n', '29\nTHIRTY?\n');
    const r = applyFilePatch(broken, parsed.files[4]);
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'conflict') throw new Error('expected conflict');
    expect(r.conflict.hunkIndex).toBe(1);
    expect(r.message).toMatch(/Hunk 2 of 2/);
    expect(r.message).toMatch(/Line 30 should be “30” but is “THIRTY\?”/);
    expect(r.alreadyApplied).toBe(false);
  });

  it('detects an already applied patch', () => {
    const r = applyFilePatch('line1\nline2 changed\nline3\nline4', parsed.files[0]);
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'conflict') throw new Error('expected conflict');
    expect(r.alreadyApplied).toBe(true);
  });

  it('allows fuzzy application', () => {
    const fuzzy = nums.replace('\n8\n', '\neight\n');
    expect(applyFilePatch(fuzzy, parsed.files[4], 0).ok).toBe(false);
    expect(applyFilePatch(fuzzy, parsed.files[4], 1).ok).toBe(true);
  });

  it('refuses binary and hunkless sections', () => {
    expect(applyFilePatch('x', parsed.files[2])).toMatchObject({ ok: false, reason: 'binary' });
    expect(applyFilePatch('x', parsed.files[5])).toMatchObject({ ok: false, reason: 'no-hunks' });
  });

  it('creates a new file from an empty source', () => {
    expect(applyFilePatch('', parsed.files[1])).toEqual({ ok: true, text: 'brand new\n' });
  });

  it('builds structured patches with no-newline markers', () => {
    const sp = toStructuredPatch(parsed.files[0]);
    expect(sp.hunks[0].lines).toContain('\\ No newline at end of file');
  });
});

describe('real git format-patch sample (two commits)', () => {
  const parsed = parseDiff(samplePatch);
  it('reads both commits with folded subjects', () => {
    expect(parsed.commits.map((c) => c.subject)).toEqual([
      'refactor(cart): simplify subtotal and format prices with Intl',
      'docs: rename guide and make check script executable',
    ]);
    expect(parsed.commits[0].body).toMatch(/^Use Array\.reduce/);
    expect(parsed.commits[0].date).toBe('Sun, 27 Sep 2026 14:12:00 +0700');
    expect(parsed.commits[1].body).toBe('');
  });
  it('lists every file with statuses', () => {
    expect(parsed.files.map((f) => [displayPath(f), f.status])).toEqual([
      ['src/cart.test.ts', 'added'],
      ['src/cart.ts', 'modified'],
      ['check.sh', 'mode'],
      ['docs/guide.md → docs/getting-started.md', 'renamed'],
      ['logo.png', 'modified'],
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(diffTotals(parsed.files)).toEqual({ files: 5, additions: 12, deletions: 7 });
  });
  it('applies the cart.ts change to the original file', () => {
    const r = applyFilePatch(cartOrig, parsed.files[1]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('items.reduce((sum, item)');
      expect(r.text).toContain('Intl.NumberFormat');
      expect(r.text).not.toContain('let total = 0;');
    }
  });
});

describe('file to commit mapping', () => {
  it('assigns files to the commit that precedes them', () => {
    const parsed = parseDiff(samplePatch);
    expect(parsed.files.map((f) => f.commit)).toEqual([0, 0, 1, 1, 1]);
    expect(parseDiff('--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n').files[0].commit).toBeNull();
  });
});
