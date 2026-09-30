import { useId, useRef, useState, type PointerEvent } from 'react';
import { Crop } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Label, NumberInput } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { mmToPt, ptToMm, type Margins } from './lib/geometry';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { PreviewPage, type PageGeometry } from './components/PreviewPage';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { verifyEncryptedEdit } from './components/verifyEdit';
import { t } from '@/lib/i18n';

type Unit = 'mm' | 'pt';
const SIDES: Array<keyof Margins> = ['top', 'right', 'bottom', 'left'];
const ZERO: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

export default function CropPages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title={t('Drop a PDF to crop')}>
        {(pdf) => <CropWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

function CropWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [unit, setUnit] = useState<Unit>('mm');
  /** Margins are stored in points. */
  const [margins, setMargins] = useState<Margins>({ top: mmToPt(10), right: mmToPt(10), bottom: mmToPt(10), left: mmToPt(10) });
  const [permanent, setPermanent] = useState(false);
  const inputKey = JSON.stringify([margins, scope.pages, permanent]);
  const result = useKeyedResult<OutputFile>(inputKey);
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'structure');
  const baseId = useId();
  const previewPage = scope.pages[0];

  const toUnit = (pt: number) => round(unit === 'mm' ? ptToMm(pt) : pt);
  const fromUnit = (v: number) => (unit === 'mm' ? mmToPt(v) : v);

  const invalid = SIDES.some((s) => !Number.isFinite(margins[s]) || margins[s] < 0);
  const nothing = SIDES.every((s) => margins[s] === 0);

  async function run() {
    const key = inputKey;
    result.clear();
    const bytes = await job.run(async ({ signal, progress }) => {
      const out = await runPdfOp(
        'crop',
        { bytes: pdf.bytes, pages: scope.pages, margins, setMediaBox: permanent, ignoreEncryption: gate.ignoreEncryption },
        { signal, onProgress: progress },
      );
      await verifyEncryptedEdit(pdf, out);
      return out;
    });
    if (bytes) result.set(key, { name: outputName(pdf.file.name, 'cropped'), data: pdfBlob(bytes), type: 'application/pdf' });
  }

  return (
    <>
      {gate.notice}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title={t('Crop margins')} description={t('Measured from the edges of the page as you see it. Or draw a rectangle on the preview.')}>
          <div className="flex flex-col gap-4">
            <Segmented
              className="self-start"
              label={t('Unit')}
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'mm', label: t('Millimetres') },
                { value: 'pt', label: t('Points') },
              ]}
            />
            <div className="grid max-w-md grid-cols-2 gap-3">
              {SIDES.map((side) => (
                <div key={side}>
                  <Label htmlFor={`${baseId}-${side}`}>
                    <span className="capitalize">{side}</span> ({unit})
                  </Label>
                  <NumberInput
                    id={`${baseId}-${side}`}
                    min={0}
                    step={unit === 'mm' ? 1 : 5}
                    value={toUnit(margins[side])}
                    onChange={(v) => setMargins((m) => ({ ...m, [side]: v === '' ? 0 : Math.max(0, fromUnit(v)) }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setMargins(ZERO)}>
                {t('Reset')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMargins((m) => ({ top: m.top, right: m.top, bottom: m.top, left: m.top }))}
              >
                {t('Use top margin on all sides')}
              </Button>
            </div>
            <PageScopeControl scope={scope} modes={['all', 'range']} label={t('Pages to crop')} />
            <Checkbox
              label={t('Permanent crop')}
              description={t('Also shrinks the page itself (the MediaBox), so apps cannot simply show the trimmed margins again. Without it, only the visible area (the CropBox) changes. Either way the trimmed content stays inside the file, so do not rely on cropping to hide sensitive information.')}
              checked={permanent}
              onChange={setPermanent}
            />
            <ErrorMessage error={invalid ? t('Margins must be positive numbers.') : null} />
            <div className="border-t border-line pt-4">
              <Button
                variant="primary"
                icon={Crop}
                disabled={!gate.ok || invalid || nothing || scope.pages.length === 0 || Boolean(scope.error) || job.running}
                loading={job.running}
                onClick={() => void run()}
              >
                {t('Crop pages')}
              </Button>
            </div>
          </div>
        </Panel>
        <Panel title={t('Preview')} description={previewPage !== undefined ? t('Page {previewPage} · drag to draw the area to keep', { previewPage: previewPage + 1 }) : undefined} className="h-fit">
          {previewPage !== undefined ? (
            <div className="flex justify-center">
              <PreviewPage doc={pdf.doc} pageIndex={previewPage} width={320} overlayInteractive>
                {(g) => (
                  <CropOverlay
                    geometry={g}
                    margins={margins}
                    onChange={setMargins}
                  />
                )}
              </PreviewPage>
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">{t('Select pages to see a preview.')}</p>
          )}
        </Panel>
      </div>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Could not crop')} />
      {result.value && <ResultFiles files={[result.value]} />}
    </>
  );
}

function CropOverlay({ geometry, margins, onChange }: { geometry: PageGeometry; margins: Margins; onChange: (m: Margins) => void }) {
  const { width: W, height: H, scale } = geometry;
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Margins | null>(null);
  const m = draft ?? margins;
  const tooBig = m.left + m.right >= W - 1 || m.top + m.bottom >= H - 1;

  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(W, Math.max(0, (e.clientX - rect.left) / scale)),
      y: Math.min(H, Math.max(0, (e.clientY - rect.top) / scale)),
    };
  }

  function fromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Margins {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return { left: x0, top: y0, right: W - x1, bottom: H - y1 };
  }

  const left = m.left * scale;
  const top = m.top * scale;
  const w = Math.max(0, (W - m.left - m.right) * scale);
  const h = Math.max(0, (H - m.top - m.bottom) * scale);

  return (
    <div
      className="absolute inset-0 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        setDraft(fromPoints(start.current, point(e)));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const next = fromPoints(start.current, point(e));
        start.current = null;
        setDraft(null);
        // Ignore clicks without a real drag.
        if (W - next.left - next.right > 4 && H - next.top - next.bottom > 4) onChange(next);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDraft(null);
      }}
    >
      {!tooBig && (
        <div
          className="pointer-events-none absolute border-2 border-accent"
          style={{ left, top, width: w, height: h, boxShadow: '0 0 0 9999px rgb(15 20 30 / 0.45)' }}
        />
      )}
      {tooBig && <div className="pointer-events-none absolute inset-0 bg-danger/40" />}
    </div>
  );
}
