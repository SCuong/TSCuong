import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export interface EditorProblem {
  /** 1-based line. */
  line: number;
  /** 1-based column; omitted to mark the whole line. */
  column?: number;
  /** Length of the marked range (defaults to 1 character). */
  length?: number;
  severity?: 'error' | 'warning';
  message?: string;
}

const theme = EditorView.baseTheme({
  '.cm-lk-problemLine-error': { backgroundColor: 'var(--lk-danger-soft) !important' },
  '.cm-lk-problemLine-warning': { backgroundColor: 'var(--lk-warning-soft) !important' },
  '.cm-lk-problemMark-error': { textDecoration: 'underline wavy var(--lk-danger)', textUnderlineOffset: '3px' },
  '.cm-lk-problemMark-warning': { textDecoration: 'underline wavy var(--lk-warning)', textUnderlineOffset: '3px' },
});

function build(state: EditorState, problems: EditorProblem[]): DecorationSet {
  const doc = state.doc;
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
  const seenLines = new Set<number>();
  for (const p of problems) {
    if (p.line < 1 || doc.lines === 0) continue;
    const line = doc.line(Math.min(p.line, doc.lines));
    const severity = p.severity ?? 'error';
    if (!seenLines.has(line.number)) {
      seenLines.add(line.number);
      entries.push({
        from: line.from,
        to: line.from,
        deco: Decoration.line({ class: `cm-lk-problemLine-${severity}`, attributes: p.message ? { title: p.message } : {} }),
      });
    }
    if (p.column !== undefined && line.length > 0) {
      const from = Math.min(line.from + Math.max(0, p.column - 1), line.to - 1);
      const to = Math.min(line.to, from + Math.max(1, p.length ?? 1));
      if (to > from) entries.push({ from, to, deco: Decoration.mark({ class: `cm-lk-problemMark-${severity}` }) });
    }
  }
  entries.sort((a, b) => a.from - b.from || (a.to === a.from ? -1 : 0) - (b.to === b.from ? -1 : 0));
  const builder = new RangeSetBuilder<Decoration>();
  for (const e of entries) builder.add(e.from, e.to, e.deco);
  return builder.finish();
}

/**
 * Highlights problem lines (and the offending characters) in a CodeMirror editor.
 * Create a new extension whenever the problem list changes; in between, the
 * markers follow edits.
 */
export function problemMarkers(problems: EditorProblem[]): Extension {
  if (problems.length === 0) return [];
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, problems),
    update: (deco, tr) => (tr.docChanged ? deco.map(tr.changes) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, theme];
}

/** Scroll an editor to a 1-based line/column and place the cursor there. */
export function revealPosition(view: EditorView | null, line: number, column = 1) {
  if (!view) return;
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const pos = Math.min(l.to, l.from + Math.max(0, column - 1));
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}
