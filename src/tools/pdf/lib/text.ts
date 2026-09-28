/**
 * Rebuild readable lines from pdf.js text items. pdf.js returns text runs in
 * content-stream order with a transform per run; we group runs into lines by
 * their baseline, order runs left-to-right inside a line, insert spaces for
 * visible gaps and blank lines for paragraph gaps.
 */

export interface TextRun {
  str: string;
  /** [a, b, c, d, e, f] text-space → page transform. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface Placed {
  str: string;
  x: number;
  y: number;
  end: number;
  size: number;
}

function place(run: TextRun): Placed {
  const [a, b, c, d, e, f] = run.transform;
  const size = Math.hypot(c, d) || Math.hypot(a, b) || run.height || 10;
  const vertical = Math.abs(b) > Math.abs(a) && Math.abs(c) > Math.abs(d);
  // For rotated (vertical) text use the other axis so lines still group correctly.
  const x = vertical ? f : e;
  const y = vertical ? -e : f;
  return { str: run.str, x, y, end: x + (run.width || 0), size };
}

/** Convert the runs of one page into text lines. */
export function runsToLines(runs: readonly TextRun[]): string[] {
  const lines: Array<{ y: number; size: number; items: Placed[] }> = [];
  let current: { y: number; size: number; items: Placed[] } | null = null;
  let forceBreak = false;

  for (const run of runs) {
    if (!run.str) {
      if (run.hasEOL) forceBreak = true;
      continue;
    }
    const p = place(run);
    const sameLine = current && !forceBreak && Math.abs(p.y - current.y) <= Math.max(current.size, p.size) * 0.5;
    if (!sameLine) {
      current = { y: p.y, size: p.size, items: [] };
      lines.push(current);
    }
    current!.items.push(p);
    current!.size = Math.max(current!.size, p.size);
    forceBreak = Boolean(run.hasEOL);
  }

  const out: string[] = [];
  let prev: { y: number; size: number } | null = null;
  for (const line of lines) {
    const items = [...line.items].sort((a, b) => a.x - b.x);
    let text = '';
    let lastEnd = -Infinity;
    for (const item of items) {
      if (text) {
        const gap = item.x - lastEnd;
        const needsSpace = gap > item.size * 0.18 && !/\s$/.test(text) && !/^\s/.test(item.str);
        if (needsSpace) text += gap > item.size * 3 ? '    ' : ' ';
      }
      text += item.str;
      lastEnd = Math.max(lastEnd, item.end);
    }
    text = text.replace(/\s+$/, '');
    if (prev && prev.y - line.y > Math.max(prev.size, line.size) * 1.9 && out.length && out[out.length - 1] !== '') {
      out.push('');
    }
    out.push(text);
    prev = line;
  }
  // Trim leading/trailing blank lines.
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

export interface PageText {
  page: number;
  text: string;
}

export function joinPages(pages: readonly PageText[], separators: boolean): string {
  if (!separators) return pages.map((p) => p.text).join('\n\n');
  return pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join('\n\n');
}
