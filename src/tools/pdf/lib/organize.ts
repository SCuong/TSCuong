/** Pure editing operations for the Organize Pages workspace. */
import { normalizeRotation } from './geometry';
import type { OrganizeItem } from './ops';

export type PageItem =
  | { id: string; kind: 'page'; source: number; index: number; rotate: number }
  | { id: string; kind: 'blank'; width: number; height: number };

let counter = 0;
export const newId = () => `i${++counter}`;

export function initialItems(pageCount: number, source = 0): PageItem[] {
  return Array.from({ length: pageCount }, (_, index) => ({ id: newId(), kind: 'page' as const, source, index, rotate: 0 }));
}

export function rotateItems(items: PageItem[], ids: ReadonlySet<string>, delta: number): PageItem[] {
  return items.map((it) => (ids.has(it.id) && it.kind === 'page' ? { ...it, rotate: normalizeRotation(it.rotate + delta) } : it));
}

export function deleteItems(items: PageItem[], ids: ReadonlySet<string>): PageItem[] {
  return items.filter((it) => !ids.has(it.id));
}

/** Insert a copy right after each selected item. Returns the list and the ids of the copies. */
export function duplicateItems(items: PageItem[], ids: ReadonlySet<string>): { items: PageItem[]; created: string[] } {
  const out: PageItem[] = [];
  const created: string[] = [];
  for (const it of items) {
    out.push(it);
    if (ids.has(it.id)) {
      const copy = { ...it, id: newId() };
      created.push(copy.id);
      out.push(copy);
    }
  }
  return { items: out, created };
}

/** Insert new items after the last selected item (or at the end when nothing is selected). */
export function insertAfterSelection(items: PageItem[], ids: ReadonlySet<string>, inserted: PageItem[]): PageItem[] {
  let at = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    if (ids.has(items[i].id)) {
      at = i + 1;
      break;
    }
  }
  return [...items.slice(0, at), ...inserted, ...items.slice(at)];
}

/** Reverse the whole list, or only the selected items among their own positions. */
export function reverseItems(items: PageItem[], ids?: ReadonlySet<string>): PageItem[] {
  if (!ids || ids.size < 2) return [...items].reverse();
  const positions = items.map((it, i) => (ids.has(it.id) ? i : -1)).filter((i) => i >= 0);
  const reversed = positions.map((i) => items[i]).reverse();
  const out = [...items];
  positions.forEach((pos, k) => (out[pos] = reversed[k]));
  return out;
}

/** Select items by their current position (1-based odd/even). */
export function idsByPosition(items: PageItem[], which: 'all' | 'odd' | 'even'): Set<string> {
  return new Set(items.filter((_, i) => which === 'all' || (which === 'odd' ? i % 2 === 0 : i % 2 === 1)).map((it) => it.id));
}

export function toOrganizeItems(items: PageItem[]): OrganizeItem[] {
  return items.map((it) =>
    it.kind === 'blank'
      ? { kind: 'blank', width: it.width, height: it.height }
      : { kind: 'page', source: it.source, index: it.index, rotate: it.rotate },
  );
}

/** True when the list equals the untouched original document. */
export function isUnchanged(items: PageItem[], pageCount: number): boolean {
  return (
    items.length === pageCount &&
    items.every((it, i) => it.kind === 'page' && it.source === 0 && it.index === i && it.rotate === 0)
  );
}
