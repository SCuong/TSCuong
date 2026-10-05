import type { PDFPageProxy } from '@/tools/pdf/lib/pdfjs';
import { markBounds, type PdfMark } from './annotations';
type Viewport = ReturnType<PDFPageProxy['getViewport']>;
/** The same coordinate mapping paints editable drafts and the reader's saved overlays. */
export function PdfMarks({ marks, viewport }: { marks: PdfMark[]; viewport: Viewport }) {
  return <>{marks.map((mark) => {
    const points = mark.points.map(([x, y]) => viewport.convertToViewportPoint(x, y) as [number, number]);
    const bounds = markBounds(points);
    return mark.kind === 'highlight' ? <rect key={mark.id} {...bounds} fill={mark.color} opacity={0.28} /> : mark.kind === 'note' ? <foreignObject key={mark.id} {...bounds}><div className="pdf-edit-note-label" style={{ fontSize: 13 * viewport.scale, padding: `${5 * viewport.scale}px ${8 * viewport.scale}px` }}>{mark.text}</div></foreignObject> : <polyline key={mark.id} points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke={mark.color} strokeWidth={1.7 * viewport.scale} strokeLinecap="round" strokeLinejoin="round" />;
  })}</>;
}
