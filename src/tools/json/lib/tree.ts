import { pathSegment } from './jsonScan';

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface TreeRow {
  /** Normalized JSONPath of the node; unique, used as the row id. */
  path: string;
  depth: number;
  /** Property name, array index, or null for the root. */
  key: string | number | null;
  value: unknown;
  type: JsonType;
  /** Number of children for objects/arrays. */
  size: number;
  expanded: boolean;
  /** True when the node itself matched the search. */
  match: boolean;
}

export function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'null';
}

function childrenOf(value: unknown): Array<[string | number, unknown]> {
  if (Array.isArray(value)) return value.map((v, i) => [i, v]);
  if (value && typeof value === 'object') return Object.entries(value);
  return [];
}

function sizeOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

export interface ExpansionState {
  /** Nodes shallower than this depth are expanded unless toggled. */
  depth: number;
  /** Paths whose expansion is inverted relative to `depth`. */
  toggled: ReadonlySet<string>;
}

export function isExpanded(state: ExpansionState, path: string, depth: number): boolean {
  return depth < state.depth !== state.toggled.has(path);
}

export interface SearchResult {
  /** Paths that matched the query. */
  matches: Set<string>;
  /** Ancestors of matches (always shown expanded). */
  ancestors: Set<string>;
  /** Total matches (may exceed `matches.size` when capped). */
  count: number;
}

/** Case-insensitive search over keys and primitive values. */
export function searchTree(root: unknown, query: string): SearchResult {
  const q = query.trim().toLowerCase();
  const matches = new Set<string>();
  const ancestors = new Set<string>();
  let count = 0;
  if (!q) return { matches, ancestors, count };
  const stack: Array<{ value: unknown; path: string; key: string | number | null; parentPath: string | null }> = [
    { value: root, path: '$', key: null, parentPath: null },
  ];
  const parentOf = new Map<string, string>();
  while (stack.length) {
    const node = stack.pop()!;
    if (node.parentPath !== null) parentOf.set(node.path, node.parentPath);
    const t = typeOf(node.value);
    const keyHit = node.key !== null && String(node.key).toLowerCase().includes(q);
    const valueHit = t !== 'object' && t !== 'array' && String(node.value).toLowerCase().includes(q);
    if (keyHit || valueHit) {
      count++;
      matches.add(node.path);
      let p = parentOf.get(node.path);
      while (p !== undefined && !ancestors.has(p)) {
        ancestors.add(p);
        p = parentOf.get(p);
      }
    }
    if (t === 'object' || t === 'array') {
      const kids = childrenOf(node.value);
      for (let i = kids.length - 1; i >= 0; i--) {
        const [k, v] = kids[i];
        stack.push({ value: v, path: node.path + pathSegment(k), key: k, parentPath: node.path });
      }
    }
  }
  return { matches, ancestors, count };
}

/**
 * Flatten the visible part of the tree into rows (depth-first, document order).
 * Only expanded containers contribute children, so huge collapsed arrays cost nothing.
 */
export function flattenTree(root: unknown, state: ExpansionState, search?: SearchResult | null): TreeRow[] {
  const rows: TreeRow[] = [];
  const filtering = Boolean(search && (search.matches.size > 0 || search.ancestors.size > 0));
  const stack: Array<{ value: unknown; path: string; key: string | number | null; depth: number; inMatch: boolean }> = [
    { value: root, path: '$', key: null, depth: 0, inMatch: false },
  ];
  while (stack.length) {
    const node = stack.pop()!;
    const match = Boolean(search?.matches.has(node.path));
    const isAncestor = Boolean(search?.ancestors.has(node.path));
    if (filtering && !match && !isAncestor && !node.inMatch) continue;
    const type = typeOf(node.value);
    const container = type === 'object' || type === 'array';
    // While filtering, ancestors of matches are always open so every match is visible.
    const expanded = container && ((filtering && isAncestor) || isExpanded(state, node.path, node.depth));
    rows.push({ path: node.path, depth: node.depth, key: node.key, value: node.value, type, size: sizeOf(node.value), expanded, match });
    if (expanded) {
      const kids = childrenOf(node.value);
      for (let i = kids.length - 1; i >= 0; i--) {
        const [k, v] = kids[i];
        stack.push({ value: v, path: node.path + pathSegment(k), key: k, depth: node.depth + 1, inMatch: node.inMatch || match });
      }
    }
  }
  return rows;
}

/** One-line preview of a value for the tree. */
export function previewValue(value: unknown, max = 160): string {
  const t = typeOf(value);
  if (t === 'string') {
    const s = value as string;
    return JSON.stringify(s.length > max ? `${s.slice(0, max)}…` : s);
  }
  if (t === 'array') return `[${(value as unknown[]).length}]`;
  if (t === 'object') return `{${Object.keys(value as object).length}}`;
  return String(value);
}

/** Count all nodes (for the footer). */
export function countNodes(root: unknown): number {
  let n = 0;
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    n++;
    if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) stack.push(x);
  }
  return n;
}
