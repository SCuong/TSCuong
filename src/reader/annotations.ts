/** Points use PDF user space, so crop boxes and page rotation do not move saved marks. */
export type MarkKind = 'highlight' | 'underline' | 'strike' | 'ink' | 'note' | 'signature';
export interface PdfMark {
  id: string;
  page: number;
  kind: MarkKind;
  points: [number, number][];
  color: string;
  text?: string;
  /** A note's visual label is rendered locally to support Unicode without external fonts. */
  image?: Uint8Array;
}
export interface PdfDraft {
  id: string;
  marks: PdfMark[];
  forms: Record<string, string | string[] | boolean>;
  updated: number;
}
export function markBounds(points: [number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function clampPoint(x: number, y: number, width: number, height: number): [number, number] {
  return [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))];
}
/** Measured wrapping keeps Unicode notes legible at their actual page dimensions. */
export function wrapNoteLines(text: string, width: number, measure: (text: string) => number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const char of paragraph) {
      if (line && measure(line + char) > Math.max(1, width)) { lines.push(line); line = ''; }
      line += char;
    }
    return [...lines, line];
  });
}
