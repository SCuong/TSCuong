import { diffWordsWithSpace } from 'diff';
import { toSplitRows, type DiffLine } from './diffParse';

export interface Segment {
  text: string;
  changed: boolean;
}

/** Map each removed line to the added line that replaces it (and back), using the side-by-side pairing. */
export function pairLines(lines: DiffLine[]): Map<DiffLine, DiffLine> {
  const pairs = new Map<DiffLine, DiffLine>();
  for (const row of toSplitRows(lines)) {
    if (row.left && row.right && row.left.type === 'del' && row.right.type === 'add') {
      pairs.set(row.left, row.right);
      pairs.set(row.right, row.left);
    }
  }
  return pairs;
}

const MAX_LENGTH = 500;

/**
 * Word-level differences between a removed and an added line. Returns null
 * when the lines are too long or too different for highlighting to help.
 */
export function intraline(oldText: string, newText: string): { old: Segment[]; new: Segment[] } | null {
  if (oldText === newText) return null;
  if (oldText.length > MAX_LENGTH || newText.length > MAX_LENGTH) return null;
  const changes = diffWordsWithSpace(oldText, newText);
  const oldSegs: Segment[] = [];
  const newSegs: Segment[] = [];
  let common = 0;
  for (const c of changes) {
    if (c.added) newSegs.push({ text: c.value, changed: true });
    else if (c.removed) oldSegs.push({ text: c.value, changed: true });
    else {
      common += c.value.length;
      oldSegs.push({ text: c.value, changed: false });
      newSegs.push({ text: c.value, changed: false });
    }
  }
  const longest = Math.max(oldText.length, newText.length);
  if (longest > 0 && common / longest < 0.3) return null;
  return { old: merge(oldSegs), new: merge(newSegs) };
}

function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.changed === s.changed) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}
