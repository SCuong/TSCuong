import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Undo2, Redo2, Trash2, Bookmark, Pencil } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';
import { PdfInput } from '@/tools/pdf/components/PdfInput';
import { usePdfFile, type LoadedPdf } from '@/tools/pdf/components/usePdfFile';
import { useHistory } from '@/tools/pdf/components/useHistory';
import { JobProgress, ResultFiles } from '@/tools/pdf/components/Results';
import { usePdfJob } from '@/tools/pdf/components/usePdfJob';
import { runPdfOp } from '@/tools/pdf/lib/runner';
import { outputName, pdfBlob, type OutputFile } from '@/tools/pdf/lib/files';
import type { PDFPageProxy } from '@/tools/pdf/lib/pdfjs';
import { docId } from '@/tools/pdf/lib/thumbnails';
import { PageSurface } from './PageSurface';
import { PdfMarks } from './PdfMarks';
import { fingerprint, pdfDrafts, readerRepository } from './storage';
import { clampPoint, markBounds, wrapNoteLines, type MarkKind, type PdfMark } from './annotations';
import { t } from '@/lib/i18n';
import './editing.css';
import { Link } from 'react-router';

export default function PdfAnnotate() {
  const controller = usePdfFile();
  return <PdfInput controller={controller} title={t('Choose a PDF to annotate')}>{(pdf) => <LoadDraft key={docId(pdf.doc)} pdf={pdf} />}</PdfInput>;
}
function LoadDraft({ pdf }: { pdf: LoadedPdf }) {
  const [loaded, setLoaded] = useState<{ id: string; marks: PdfMark[]; page: number; bookmarks: number[]; warning: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void fingerprint(pdf.bytes).then(async (id) => {
      let warning = false;
      const draft = await pdfDrafts.get(id).catch(() => { warning = true; return undefined; });
      const record = (await readerRepository.list().catch(() => [])).find((r) => r.id === id);
      if (!record) await readerRepository.remember({ id, name: pdf.file.name, size: pdf.file.size, pages: pdf.pageCount, page: 1, offset: 0, favorite: false, bookmarks: [], cached: false, lastOpened: Date.now() }, pdf.file).catch(() => { warning = true; });
      if (alive) setLoaded({ id, marks: draft?.marks ?? [], page: record?.page ?? 1, bookmarks: record?.bookmarks ?? [], warning });
    });
    return () => { alive = false; };
  }, [pdf]);
  return loaded ? <AnnotateWorkspace pdf={pdf} initial={loaded} /> : <Spinner label={t('Loading saved edits…')} />;
}
type Initial = { id: string; marks: PdfMark[]; page: number; bookmarks: number[]; warning: boolean };
const TOOLS: { kind: MarkKind | 'select'; label: string }[] = [
  { kind: 'select', label: 'Select text / scroll' }, { kind: 'highlight', label: 'Highlight' },
  { kind: 'underline', label: 'Underline' }, { kind: 'strike', label: 'Strike-through' },
  { kind: 'ink', label: 'Draw' }, { kind: 'note', label: 'Text note' }, { kind: 'signature', label: 'Signature' },
];
function AnnotateWorkspace({ pdf, initial }: { pdf: LoadedPdf; initial: Initial }) {
  const history = useHistory(initial.marks);
  const [pageNumber, setPage] = useState(initial.page);
  const [page, setPdfPage] = useState<{ number: number; value: PDFPageProxy } | null>(null);
  const [width, setWidth] = useState(320);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<MarkKind | 'select'>('select');
  const [color, setColor] = useState('#2563eb');
  const [highlightColor, setHighlightColor] = useState('#facc15');
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: string; text: string } | null>(null);
  const [stroke, setStroke] = useState<[number, number][]>([]);
  const [bookmarks, setBookmarks] = useState(initial.bookmarks);
  const [storageError, setStorageError] = useState(initial.warning);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState(false);
  const [result, setResult] = useState<{ marks: PdfMark[]; file: OutputFile } | null>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const job = usePdfJob();
  const { setError } = job;
  const marks = history.value;
  const current = page?.number === pageNumber ? page.value : null;
  const viewport = current?.getViewport({ scale: 1 });
  const scale = viewport ? width * zoom / viewport.width : 1;
  const blocked = pdf.encrypted;
  useEffect(() => {
    let alive = true;
    void pdf.doc.getPage(pageNumber).then((value) => { if (alive) setPdfPage({ number: pageNumber, value }); }).catch(() => { if (alive) setError(t('Could not load this page.')); });
    return () => { alive = false; };
  }, [pdf.doc, pageNumber, setError]);
  useEffect(() => {
    const el = host.current!;
    const observer = new ResizeObserver(() => setWidth(Math.min(760, el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    setSaving(true);
    // Start immediately: a navigation must not discard a debounce's pending edits.
    void pdfDrafts.patch(initial.id, { marks })
      .then(() => { if (alive) { setSaving(false); setStorageError(false); } })
      .catch(() => { if (alive) { setSaving(false); setStorageError(true); } });
    return () => { alive = false; };
  }, [marks, initial.id]);
  useEffect(() => {
    const update = () => setSelection(Boolean(getSelection()?.toString() && host.current?.contains(getSelection()?.anchorNode ?? null)));
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  function pointsForRect(x: number, y: number, w: number, h: number): [number, number][] {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([vx, vy]) => viewport!.convertToPdfPoint(vx, vy) as [number, number]);
  }
  function add(kind: MarkKind, points: [number, number][], text?: string) {
    if (blocked || !points.length) return;
    const mark: PdfMark = { id: crypto.randomUUID(), page: pageNumber, kind, points, color: kind === 'highlight' ? highlightColor : color, text };
    history.set((old) => [...old, mark]);
  }
  function position(event: PointerEvent<SVGSVGElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampPoint((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale, viewport!.width, viewport!.height);
  }
  function notePoints(text: string, x: number, y: number, width = 240) {
    const w = Math.min(width, viewport!.width - 16);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '13px "Geist Variable", sans-serif';
    const lines = wrapNoteLines(text, w - 16, (line) => context.measureText(line).width);
    const h = Math.min(viewport!.height - 16, Math.ceil(10 + lines.length * 18.2));
    return pointsForRect(Math.max(0, Math.min(x, viewport!.width - w)), Math.max(0, Math.min(y, viewport!.height - h)), w, h);
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    const path = drawing.current;
    drawing.current = null;
    setStroke([]);
    if (!path || !viewport || tool === 'select') return;
    const last = position(event);
    if (tool === 'note') {
      if (!note.trim()) return;
      add('note', notePoints(note.trim(), last[0], last[1]), note.trim());
      return;
    }
    if (tool === 'highlight') {
      const x = Math.min(path[0][0], last[0]), y = Math.min(path[0][1], last[1]);
      if (Math.abs(last[0] - path[0][0]) < 2 || Math.abs(last[1] - path[0][1]) < 2) return;
      add(tool, pointsForRect(x, y, Math.abs(last[0] - path[0][0]), Math.abs(last[1] - path[0][1])));
    } else {
      const points = (tool === 'underline' || tool === 'strike' ? [path[0], last] : [...path, last]).map(([x, y]) => viewport.convertToPdfPoint(x, y) as [number, number]);
      if (points.length > 1) add(tool, points);
    }
  }
  function markSelection(kind: 'highlight' | 'underline' | 'strike') {
    const selected = getSelection();
    if (!selected?.rangeCount || !viewport || !host.current?.contains(selected.anchorNode)) return;
    const paper = host.current.querySelector('.reader-paper')!.getBoundingClientRect();
    const newMarks: PdfMark[] = [];
    for (const rect of selected.getRangeAt(0).getClientRects()) {
      if (rect.width < 1 || rect.height < 1 || rect.left < paper.left - 1 || rect.right > paper.right + 1) continue;
      const x = (rect.left - paper.left) / scale, y = (rect.top - paper.top) / scale, w = rect.width / scale, h = rect.height / scale;
      const points = kind === 'highlight' ? pointsForRect(x, y, w, h) : [viewport.convertToPdfPoint(x, y + h * (kind === 'underline' ? 0.92 : 0.5)), viewport.convertToPdfPoint(x + w, y + h * (kind === 'underline' ? 0.92 : 0.5))] as [number, number][];
      newMarks.push({ id: crypto.randomUUID(), page: pageNumber, kind, points, color: kind === 'highlight' ? highlightColor : color });
    }
    if (newMarks.length && !blocked) history.set((old) => [...old, ...newMarks]);
    selected.removeAllRanges();
  }
  async function exportPdf() {
    const snapshot = marks;
    const bytes = await job.run(async ({ signal, progress }) => {
      await document.fonts.ready;
      const prepared: PdfMark[] = [];
      for (const mark of snapshot) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (mark.kind !== 'note') { prepared.push(mark); continue; }
        const canvas = document.createElement('canvas');
        const [tl, tr, , bl] = mark.points;
        const noteWidth = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
        const noteHeight = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
        // Equal resolution on both axes preserves font proportions when embedded in the PDF.
        canvas.width = Math.max(1, Math.round(noteWidth * 3));
        canvas.height = Math.max(1, Math.round(noteHeight * 3));
        const context = canvas.getContext('2d')!;
        context.scale(3, 3);
        context.fillStyle = '#fff7ce'; context.fillRect(0, 0, noteWidth, noteHeight);
        context.fillStyle = '#17212f'; context.font = '13px "Geist Variable", sans-serif';
        context.textBaseline = 'top';
        const lines = wrapNoteLines(mark.text ?? '', noteWidth - 16, (line) => context.measureText(line).width);
        lines.forEach((line, i) => context.fillText(line, 8, 5 + i * 18.2));
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
        prepared.push({ ...mark, image: new Uint8Array(await blob.arrayBuffer()) });
        canvas.width = canvas.height = 0;
      }
      return runPdfOp('annotate', { bytes: pdf.bytes, marks: prepared }, { signal, onProgress: progress });
    });
    if (bytes) setResult({ marks: snapshot, file: { name: outputName(pdf.file.name, 'annotated'), data: pdfBlob(bytes), type: 'application/pdf' } });
  }
  const pageMarks = marks.filter((mark) => mark.page === pageNumber);
  return <div className="pdf-edit-workspace">
    {blocked && <p role="alert">{t('Unlock a copy in PDF passwords before adding annotations. Text and forms will be preserved.')} <Link className="text-accent underline" to="/read/tools/pdf-protection">{t('PDF passwords')}</Link></p>}
    <div className="pdf-edit-navigation">
      <IconButton icon={ChevronLeft} label={t('Previous page')} disabled={pageNumber === 1 || job.running} onClick={() => setPage((n) => n - 1)} />
      <label>{t('Page')} <input type="number" min={1} max={pdf.pageCount} aria-label={t('Edit page number')} value={pageNumber} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= pdf.pageCount) setPage(n); }} /> / {pdf.pageCount}</label>
      <IconButton icon={ChevronRight} label={t('Next page')} disabled={pageNumber === pdf.pageCount || job.running} onClick={() => setPage((n) => n + 1)} />
      <IconButton icon={Bookmark} label={bookmarks.includes(pageNumber) ? t('Remove page bookmark') : t('Bookmark this page')} onClick={() => { const next = bookmarks.includes(pageNumber) ? bookmarks.filter((n) => n !== pageNumber) : [...bookmarks, pageNumber].sort((a, b) => a - b); setBookmarks(next); void readerRepository.patch(initial.id, { bookmarks: next }).catch(() => setStorageError(true)); }} />
      <label>{t('Zoom')}<select aria-label={t('Annotation zoom')} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}><option value={1}>{t('Fit width')}</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option></select></label>
    </div>
    <div className="pdf-edit-toolbar pdf-annotate-toolbar" role="group" aria-label={t('Annotation tools')}>
      {TOOLS.map(({ kind, label }) => <button key={kind} aria-pressed={tool === kind} disabled={blocked && kind !== 'select' || job.running} onClick={() => setTool(kind)}>{t(label)}</button>)}
      {tool !== 'select' && tool !== 'note' && <label className="pdf-edit-color">{t('Color')} <input type="color" value={tool === 'highlight' ? highlightColor : color} disabled={blocked || job.running} onChange={(e) => tool === 'highlight' ? setHighlightColor(e.target.value) : setColor(e.target.value)} /></label>}
      <IconButton icon={Undo2} label={t('Undo')} onClick={history.undo} disabled={!history.canUndo || job.running} />
      <IconButton icon={Redo2} label={t('Redo')} onClick={history.redo} disabled={!history.canRedo || job.running} />
    </div>
    {tool === 'note' && <label className="pdf-edit-note">{t('Text note')}<textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Write a note, then tap the page to place it.')} /><Button disabled={!note.trim() || blocked || !viewport} onClick={() => add('note', notePoints(note.trim(), viewport!.width / 4, viewport!.height / 3), note.trim())}>{t('Place note in center')}</Button></label>}
    <p className="pdf-edit-hint">{tool === 'select' ? t('Select PDF text to mark it, or choose a drawing tool. Use Select text / scroll to scroll the page.') : tool === 'signature' ? t('Draw your signature on the page. This is a visual signature, not a cryptographic digital signature.') : t('Drag on the page to add a mark. Choose Select text / scroll when you want to scroll.')}</p>
    {selection && !blocked && <div className="pdf-edit-toolbar" role="group" aria-label={t('Mark selected text')}>
      <button onClick={() => markSelection('highlight')}>{t('Highlight selection')}</button><button onClick={() => markSelection('underline')}>{t('Underline selection')}</button><button onClick={() => markSelection('strike')}>{t('Strike selection')}</button>
    </div>}
    <div ref={host} className="pdf-edit-paper-host">
      {current && viewport ? <div className="pdf-edit-paper" style={{ width: width * zoom, height: viewport.height * scale }}>
        <PageSurface doc={pdf.doc} pageNumber={pageNumber} scale={scale} query="" activeMatch={-1} />
        <svg className="pdf-edit-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`} style={{ pointerEvents: tool === 'select' ? 'none' : 'auto', touchAction: tool === 'select' ? 'auto' : 'none' }} aria-label={t('Page drawing area')} role="img"
          onPointerDown={(e) => { if (blocked || job.running || !e.isPrimary) return; e.currentTarget.setPointerCapture(e.pointerId); drawing.current = [position(e)]; setStroke(drawing.current); }}
          onPointerMove={(e) => { if (!drawing.current) return; const point = position(e); if (drawing.current.length < 4000) { drawing.current = [...drawing.current, point]; setStroke(drawing.current); } }}
          onPointerUp={finish} onPointerCancel={() => { drawing.current = null; setStroke([]); }}>
          <PdfMarks marks={pageMarks} viewport={viewport} />
          {stroke.length > 0 && (tool === 'highlight' ? <rect {...markBounds([stroke[0], stroke[stroke.length - 1]])} fill="#facc15" opacity={0.3} /> : <polyline points={stroke.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={1.7} />)}
        </svg>
      </div> : <Spinner label={t('Loading page…')} />}
    </div>
    <p role="status" className="pdf-edit-hint">{storageError ? t('Edits could not be saved on this device. Export a copy before closing.') : saving ? t('Saving edits on this device…') : t('Edits saved on this device. Export a copy to keep your markup in the PDF.')}</p>
    {!!pageMarks.length && <ul className="pdf-edit-marks" aria-label={t('Annotations on this page')}>{pageMarks.map((mark, i) => <li key={mark.id}><span>{t(TOOLS.find((entry) => entry.kind === mark.kind)!.label)} {i + 1}{mark.text ? ': ' + mark.text : ''}</span>{mark.kind === 'note' && <IconButton icon={Pencil} label={t('Edit annotation {index}', { index: i + 1 })} disabled={job.running || !viewport} onClick={() => setEditingNote({ id: mark.id, text: mark.text ?? '' })} />}<IconButton icon={Trash2} label={t('Delete annotation {index}', { index: i + 1 })} disabled={job.running} onClick={() => history.set((old) => old.filter((item) => item.id !== mark.id))} /></li>)}</ul>}
    <Dialog open={!!editingNote} onClose={() => setEditingNote(null)} title={t('Text note')}>
      <label className="pdf-edit-note">{t('Text note')}<textarea maxLength={500} value={editingNote?.text ?? ''} onChange={(e) => setEditingNote((old) => old && ({ ...old, text: e.target.value }))} /></label>
      <Button disabled={!editingNote?.text.trim() || !viewport} onClick={() => { history.set((old) => old.map((mark) => { if (mark.id !== editingNote!.id) return mark; const bounds = markBounds(mark.points.map(([x, y]) => viewport!.convertToViewportPoint(x, y) as [number, number])); return { ...mark, text: editingNote!.text.trim(), points: notePoints(editingNote!.text.trim(), bounds.x, bounds.y, bounds.width) }; })); setEditingNote(null); }}>{t('Save note')}</Button>
    </Dialog>
    <p className="pdf-edit-hint">{t('Exported marks become part of the page; notes also remain PDF comments. Your saved draft stays editable here. Editing can invalidate existing digital signatures.')}</p>
    <Button variant="primary" disabled={!marks.length || blocked || job.running} onClick={() => void exportPdf()}>{t('Export annotated copy')}</Button>
    <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} /><ErrorMessage error={job.error} />
    {result?.marks === marks && <ResultFiles files={[result.file]} />}
  </div>;
}
