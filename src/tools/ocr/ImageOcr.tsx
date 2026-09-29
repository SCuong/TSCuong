import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ScanText, X } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { FileDrop } from '@/components/ui/FileDrop';
import { Switch } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { useObjectUrl } from '@/lib/hooks';
import { errorMessage, formatBytes, formatNumber, withExtension } from '@/lib/utils';
import { createOcrEngine, type OcrEngine } from './lib/engine';
import { imageFileToCanvas } from './lib/canvas';
import { confidenceLevel, type OcrPageResult } from './lib/result';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif';

export default function ImageOcr() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrPageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ value: number | null; label: string }>({ value: null, label: '' });
  const [showBoxes, setShowBoxes] = useState(true);
  const engine = useRef<OcrEngine | null>(null);
  const runId = useRef(0);
  const url = useObjectUrl(file);

  useEffect(
    () => () => {
      runId.current++;
      void engine.current?.terminate();
    },
    [],
  );

  async function recognize(target: File) {
    const id = ++runId.current;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ value: null, label: 'Preparing the image' });
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await imageFileToCanvas(target);
      if (id !== runId.current) return;
      if (!engine.current) {
        const created = await createOcrEngine((v, label) => id === runId.current && setProgress({ value: v * 0.3, label }));
        // Cancelled (or replaced by a newer run) while the engine was loading: do not keep an orphan worker.
        if (id !== runId.current) {
          void created.terminate();
          return;
        }
        engine.current = created;
      }
      const out = await engine.current.recognize(canvas, (v, label) =>
        id === runId.current && setProgress({ value: label === 'Recognizing text' ? 0.3 + v * 0.7 : null, label }),
      );
      if (id !== runId.current) return;
      setResult(out);
    } catch (e) {
      if (id !== runId.current) return;
      setError(errorMessage(e, 'Text recognition failed.'));
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (id === runId.current) setRunning(false);
    }
  }

  function cancel() {
    runId.current++;
    const e = engine.current;
    engine.current = null;
    void e?.terminate();
    setRunning(false);
  }

  function choose(next: File) {
    setFile(next);
    void recognize(next);
  }

  const level = result ? confidenceLevel(result.confidence) : null;

  return (
    <ToolStack>
      <Alert tone="info">
        Recognition runs on this device with Tesseract. Only <strong>English</strong> language data is included, so other languages
        and scripts will be recognized poorly or not at all.
      </Alert>
      {!file ? (
        <FileDrop
          accept={ACCEPT}
          onFiles={(files) => choose(files[0])}
          title="Drop an image with text"
          icon={ScanText}
          hint="Screenshots, photos of documents, scans. You can also paste an image. Nothing is uploaded."
        />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Panel
            title="Image"
            description={`${file.name} · ${formatBytes(file.size)}`}
            actions={
              <>
                <Switch label="Word boxes" checked={showBoxes} onChange={setShowBoxes} />
                <IconButton icon={RefreshCw} label="Run again" size="sm" disabled={running} onClick={() => void recognize(file)} />
                <IconButton
                  icon={X}
                  label="Close image"
                  size="sm"
                  onClick={() => {
                    cancel();
                    setFile(null);
                    setResult(null);
                    setError(null);
                  }}
                />
              </>
            }
          >
            <div className="relative mx-auto w-fit max-w-full">
              {url && <img src={url} alt="Image being recognized" className="block max-h-[560px] max-w-full rounded-md" />}
              {showBoxes && result && result.width > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${result.width} ${result.height}`}
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  {result.lines.flatMap((line) =>
                    line.words.map((w, i) => {
                      const c = confidenceLevel(w.confidence);
                      const color = c === 'high' ? 'var(--lk-success)' : c === 'medium' ? 'var(--lk-warning)' : 'var(--lk-danger)';
                      return (
                        <rect
                          key={`${line.bbox.y0}-${i}-${w.bbox.x0}`}
                          x={w.bbox.x0}
                          y={w.bbox.y0}
                          width={Math.max(1, w.bbox.x1 - w.bbox.x0)}
                          height={Math.max(1, w.bbox.y1 - w.bbox.y0)}
                          style={{ fill: color, stroke: color }}
                          fillOpacity={0.12}
                          strokeWidth={Math.max(1, result.width / 600)}
                        >
                          <title>{`${w.text} (${Math.round(w.confidence)}%)`}</title>
                        </rect>
                      );
                    }),
                  )}
                </svg>
              )}
            </div>
            {showBoxes && result && (
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-success" /> 85%+
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-warning" /> 60–85%
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-danger" /> below 60% confidence
                </span>
              </p>
            )}
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            {running && (
              <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
                <ProgressBar value={progress.value} label={progress.label || 'Working…'} onCancel={cancel} />
              </div>
            )}
            <ErrorMessage error={error} title="Recognition failed" />
            {!running && !result && !error && (
              <Button variant="primary" icon={ScanText} onClick={() => void recognize(file)}>
                Recognize text
              </Button>
            )}
            {result && (
              <EditorPanel
                title={
                  <span className="inline-flex items-center gap-2">
                    Recognized text
                    <Badge tone={level === 'high' ? 'success' : level === 'medium' ? 'warning' : 'danger'}>
                      {Math.round(result.confidence)}% confidence
                    </Badge>
                  </span>
                }
                ariaLabel="Recognized text"
                value={result.text}
                readOnly
                height="440px"
                downloadName={withExtension(file.name, 'txt')}
                placeholder="No text was found in this image."
                footer={
                  <>
                    <span>{formatNumber(result.lines.length, 0)} lines</span>
                    <span>{formatNumber(result.lines.reduce((n, l) => n + l.words.length, 0), 0)} words</span>
                    <span>{formatNumber(result.text.length, 0)} characters</span>
                  </>
                }
              />
            )}
            {result && level === 'low' && result.text && (
              <Alert tone="warning">
                Confidence is low. Results improve with sharp, well-lit, straight images of printed English text at a decent resolution.
              </Alert>
            )}
          </div>
        </div>
      )}
    </ToolStack>
  );
}
