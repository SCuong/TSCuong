import { useState, type ReactNode } from 'react';
import { CircleAlert, Download, FileArchive, ImageOff, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { cn, downloadBlob, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { zipBlobs } from '../lib/zip';
import type { BatchItem } from './useImageBatch';

export function savingsPercent(before: number, after: number): number {
  if (!before) return 0;
  return ((before - after) / before) * 100;
}

function Thumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="lk-checker flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line">
      {failed ? (
        <ImageOff size={18} className="text-fg-muted" aria-hidden />
      ) : (
        <img src={src} alt={alt} className="size-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/**
 * Batch results: thumbnail, name, sizes, savings, status, per-file download
 * and "Download all as ZIP".
 */
export function BatchFileList({
  items,
  onRemove,
  onClear,
  onCancel,
  onRetry,
  running,
  progress,
  zipName = 'images.zip',
  showSavings = true,
  extra,
  actions,
}: {
  items: BatchItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  running: boolean;
  progress: number;
  zipName?: string;
  showSavings?: boolean;
  /** Extra per-item content under the name. */
  extra?: (item: BatchItem) => ReactNode;
  actions?: ReactNode;
}) {
  const [zipping, setZipping] = useState(false);
  const done = items.filter((it) => it.status === 'done' && it.output);
  const failed = items.filter((it) => it.status === 'error');
  const totalBefore = done.reduce((n, it) => n + it.file.size, 0);
  const totalAfter = done.reduce((n, it) => n + (it.output?.blob.size ?? 0), 0);
  const totalSavings = savingsPercent(totalBefore, totalAfter);

  async function downloadAll() {
    setZipping(true);
    try {
      const blob = await zipBlobs(done.map((it) => ({ name: it.output!.name, data: it.output!.blob })));
      downloadBlob(blob, zipName);
    } catch (error) {
      toast(errorMessage(error, 'Could not create the ZIP file.'), 'error');
    } finally {
      setZipping(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card" aria-label="Files">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 text-[13px]">
          <span className="font-semibold text-fg">{pluralize(items.length, 'file')}</span>
          {done.length > 0 && showSavings && (
            <span className="ml-2 text-fg-muted">
              {formatBytes(totalBefore)} → {formatBytes(totalAfter)}{' '}
              <span className={cn('font-medium', totalSavings >= 0 ? 'text-success' : 'text-warning')}>
                ({totalSavings >= 0 ? '−' : '+'}
                {Math.abs(totalSavings).toFixed(1)}%)
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          {failed.length > 0 && onRetry && !running && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetry}>
              Retry failed
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear all
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={FileArchive}
            disabled={done.length === 0 || running}
            loading={zipping}
            onClick={downloadAll}
          >
            Download all as ZIP
          </Button>
        </div>
      </header>
      {running && (
        <div className="border-b border-line px-4 py-2.5">
          <ProgressBar value={progress} label="Processing…" onCancel={onCancel} />
        </div>
      )}
      <ul className="divide-y divide-line">
        {items.map((it) => {
          const out = it.output;
          const pct = out ? savingsPercent(it.file.size, out.blob.size) : 0;
          return (
            <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
              <Thumb src={it.thumbUrl} alt="" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg" title={it.file.name}>
                  {it.file.name}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-muted">
                  <span className="tabular-nums">{formatBytes(it.file.size)}</span>
                  {out && (
                    <>
                      <span aria-hidden>→</span>
                      <span className="font-medium tabular-nums text-fg">{formatBytes(out.blob.size)}</span>
                      {showSavings && (
                        <Badge tone={pct > 0.05 ? 'success' : pct < -0.05 ? 'warning' : 'neutral'}>
                          {pct > 0.05 ? `−${pct.toFixed(1)}%` : pct < -0.05 ? `+${Math.abs(pct).toFixed(1)}%` : '±0%'}
                        </Badge>
                      )}
                      {out.width && out.height && (
                        <span className="tabular-nums">
                          {out.sourceWidth && out.sourceHeight && (out.sourceWidth !== out.width || out.sourceHeight !== out.height)
                            ? `${out.sourceWidth}×${out.sourceHeight} → `
                            : ''}
                          {out.width}×{out.height}
                        </span>
                      )}
                    </>
                  )}
                  {it.status === 'working' && (
                    <span className="inline-flex items-center gap-1">
                      <LoaderCircle size={12} className="animate-spin" aria-hidden /> Processing
                    </span>
                  )}
                  {it.status === 'pending' && <span>Queued</span>}
                </div>
                {out?.note && (
                  <p className={cn('mt-0.5 text-[12px]', out.warning ? 'text-warning' : 'text-fg-muted')}>{out.note}</p>
                )}
                {it.status === 'error' && (
                  <p className="mt-0.5 flex items-start gap-1 text-[12px] text-danger" role="alert">
                    <CircleAlert size={13} className="mt-px shrink-0" aria-hidden />
                    {it.error}
                  </p>
                )}
                {extra?.(it)}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {out && (
                  <IconButton
                    icon={Download}
                    label={`Download ${out.name}`}
                    variant="secondary"
                    size="sm"
                    onClick={() => downloadBlob(out.blob, out.name)}
                  />
                )}
                <IconButton icon={X} label={`Remove ${it.file.name}`} size="sm" onClick={() => onRemove(it.id)} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
