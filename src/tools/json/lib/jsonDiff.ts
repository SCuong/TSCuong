import { diffLines } from 'diff';
import { pathSegment } from './jsonScan';
import { typeOf } from './tree';

export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

export interface DiffOptions {
  /** Compare arrays as multisets: reordering is not a change. */
  ignoreArrayOrder?: boolean;
}

/** Deterministic serialization with sorted keys (and optionally sorted arrays) for equality checks. */
export function canonical(value: unknown, sortArrays = false): string {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v, sortArrays));
    if (sortArrays) items.sort();
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], sortArrays)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function diffJson(a: unknown, b: unknown, options: DiffOptions = {}): DiffEntry[] {
  const out: DiffEntry[] = [];
  const sortArrays = Boolean(options.ignoreArrayOrder);

  function walk(x: unknown, y: unknown, path: string) {
    const tx = typeOf(x);
    const ty = typeOf(y);
    if (tx !== ty) {
      out.push({ path, kind: 'changed', before: x, after: y });
      return;
    }
    if (tx === 'object') {
      const ox = x as Record<string, unknown>;
      const oy = y as Record<string, unknown>;
      for (const key of Object.keys(ox)) {
        const p = path + pathSegment(key);
        if (!Object.prototype.hasOwnProperty.call(oy, key)) out.push({ path: p, kind: 'removed', before: ox[key] });
        else walk(ox[key], oy[key], p);
      }
      for (const key of Object.keys(oy)) {
        if (!Object.prototype.hasOwnProperty.call(ox, key)) out.push({ path: path + pathSegment(key), kind: 'added', after: oy[key] });
      }
      return;
    }
    if (tx === 'array') {
      const ax = x as unknown[];
      const ay = y as unknown[];
      if (sortArrays) {
        // Multiset matching by canonical form; leftovers are removed/added.
        const pool = new Map<string, number[]>();
        ay.forEach((v, i) => {
          const k = canonical(v, true);
          const list = pool.get(k);
          if (list) list.push(i);
          else pool.set(k, [i]);
        });
        const unmatchedA: number[] = [];
        ax.forEach((v, i) => {
          const list = pool.get(canonical(v, true));
          if (list && list.length) list.shift();
          else unmatchedA.push(i);
        });
        const unmatchedB = [...pool.values()].flat().sort((m, n) => m - n);
        for (const i of unmatchedA) out.push({ path: `${path}[${i}]`, kind: 'removed', before: ax[i] });
        for (const i of unmatchedB) out.push({ path: `${path}[${i}]`, kind: 'added', after: ay[i] });
        return;
      }
      const common = Math.min(ax.length, ay.length);
      for (let i = 0; i < common; i++) walk(ax[i], ay[i], `${path}[${i}]`);
      for (let i = common; i < ax.length; i++) out.push({ path: `${path}[${i}]`, kind: 'removed', before: ax[i] });
      for (let i = common; i < ay.length; i++) out.push({ path: `${path}[${i}]`, kind: 'added', after: ay[i] });
      return;
    }
    if (!Object.is(x, y) && !(tx === 'number' && x === y)) out.push({ path, kind: 'changed', before: x, after: y });
  }

  walk(a, b, '$');
  return out;
}

/** Recursively sort keys (and optionally array items) so equivalent documents print identically. */
export function normalizeForText(value: unknown, sortArrays: boolean): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => normalizeForText(v, sortArrays));
    if (sortArrays) {
      return items
        .map((v) => [canonical(v, true), v] as const)
        .sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0))
        .map((p) => p[1]);
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = normalizeForText((value as Record<string, unknown>)[k], sortArrays);
    return out;
  }
  return value;
}

export interface SideLine {
  n: number;
  text: string;
}

export interface AlignedRow {
  kind: 'same' | 'removed' | 'added' | 'modified';
  left?: SideLine;
  right?: SideLine;
}

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Line diff of two texts laid out as side-by-side rows (removed/added blocks are paired up).
 * Returns null when the diff takes longer than `timeout` ms (pathologically different inputs).
 */
export function sideBySide(before: string, after: string, timeout = 4000): AlignedRow[] | null {
  const changes = diffLines(before, after, { timeout });
  if (!changes) return null;
  const rows: AlignedRow[] = [];
  let ln = 1;
  let rn = 1;
  for (let c = 0; c < changes.length; c++) {
    const change = changes[c];
    const lines = splitLines(change.value);
    if (!change.added && !change.removed) {
      for (const text of lines) rows.push({ kind: 'same', left: { n: ln++, text }, right: { n: rn++, text } });
      continue;
    }
    if (change.removed) {
      const next = changes[c + 1];
      const added = next?.added ? splitLines(next.value) : [];
      if (next?.added) c++;
      const count = Math.max(lines.length, added.length);
      for (let k = 0; k < count; k++) {
        const l = k < lines.length ? { n: ln++, text: lines[k] } : undefined;
        const r = k < added.length ? { n: rn++, text: added[k] } : undefined;
        rows.push({ kind: l && r ? 'modified' : l ? 'removed' : 'added', left: l, right: r });
      }
      continue;
    }
    for (const text of lines) rows.push({ kind: 'added', right: { n: rn++, text } });
  }
  return rows;
}

export function summarize(entries: DiffEntry[]) {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const e of entries) {
    if (e.kind === 'added') added++;
    else if (e.kind === 'removed') removed++;
    else changed++;
  }
  return { added, removed, changed, total: entries.length };
}
