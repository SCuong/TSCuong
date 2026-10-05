import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Download, ExternalLink, FileArchive, FileCheck, Share2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { downloadBlob, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { zipFiles, type OutputFile } from '../lib/files';
import { t } from '@/lib/i18n';
import { usePdfWorkspace } from './PdfWorkspaceContext';
import { outputToFile, shareOutputs, supportsFileSharing } from '../lib/share';

function toBlob(file: OutputFile): Blob {
  return file.data instanceof Blob ? file.data : new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.type });
}

function sizeOf(file: OutputFile): number {
  return file.data instanceof Blob ? file.data.size : file.data.byteLength;
}

/** Native sharing for text/editor outputs inside the mobile workspace. */
export function ShareResult({ files }: { files: OutputFile[] }) {
  const workspace = usePdfWorkspace();
  const [sharing, setSharing] = useState(false);
  if (!workspace || !files.length || !supportsFileSharing(files[0].type)) return null;
  return <Button variant="ghost" icon={Share2} loading={sharing} onClick={() => {
    setSharing(true);
    void shareOutputs(files).then((shared) => { if (!shared) toast(t('This browser cannot share these files. Use Download instead.'), 'info'); })
      .catch((error: unknown) => { if ((error as Error).name !== 'AbortError') toast(t('Sharing failed. You can still download your files.'), 'error'); })
      .finally(() => setSharing(false));
  }}>{t('Share file')}</Button>;
}

export function downloadOutput(file: OutputFile) {
  downloadBlob(toBlob(file), file.name);
}

/** Open a PDF/image result in a new tab (the URL is revoked after a minute). */
function openInTab(file: OutputFile) {
  const url = URL.createObjectURL(toBlob(file));
  const win = window.open(url, '_blank');
  if (win) win.opener = null;
  else toast(t('Your browser blocked the new tab. Use Download instead.'), 'info');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Result card: one file gets a prominent download; several files get a ZIP
 * download plus individual downloads.
 */
export function ResultFiles({
  files,
  title,
  zipName,
  children,
  showList = true,
  tone = 'success',
}: {
  files: OutputFile[];
  title?: ReactNode;
  zipName?: string;
  children?: ReactNode;
  /** Hide the per-file list when the caller renders its own previews. */
  showList?: boolean;
  /** 'neutral' for results that are valid but not an improvement (e.g. no size reduction). */
  tone?: 'success' | 'neutral';
}) {
  const workspace = usePdfWorkspace();
  const [zipping, setZipping] = useState(false);
  const [sharing, setSharing] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // Bring a fresh result into view (it may appear below a long page grid).
  const first = files[0]?.data;
  useEffect(() => {
    const el = ref.current;
    if (!first || !el) return;
    // Scroll the window only (scrollIntoView can also shift clipped app containers).
    const r = el.getBoundingClientRect();
    const overflow = Math.min(r.bottom + 16 - window.innerHeight, r.top - 72);
    if (overflow > 0) window.scrollBy({ top: overflow, behavior: 'smooth' });
  }, [first]);
  if (files.length === 0) return null;
  const total = files.reduce((n, f) => n + sizeOf(f), 0);

  async function downloadZip() {
    setZipping(true);
    try {
      const blob = await zipFiles(files);
      downloadBlob(blob, zipName ?? 'files.zip');
    } catch (error) {
      toast(errorMessage(error, t('Could not create the ZIP file.')), 'error');
    } finally {
      setZipping(false);
    }
  }

  async function share(list: OutputFile[]) {
    setSharing(true);
    try {
      if (!await shareOutputs(list)) toast(t('This browser cannot share these files. Use Download instead.'), 'info');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast(t('Sharing failed. You can still download your files.'), 'error');
    } finally { setSharing(false); }
  }

  if (files.length === 1) {
    const file = files[0];
    const canOpen = file.type === 'application/pdf' || file.type.startsWith('image/');
    return (
      <section
        ref={ref}
        className={`flex flex-col gap-3 rounded-xl border p-3 sm:p-4 ${tone === 'success' ? 'border-success/30 bg-success-soft' : 'border-line bg-surface shadow-card'}`}
        aria-live="polite"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised shadow-card ${tone === 'success' ? 'text-success' : 'text-fg-secondary'}`}
          >
            <FileCheck size={18} aria-hidden />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-[13px] font-medium text-fg">{title ?? t('Your file is ready')}</p>
            <p className="truncate text-[12.5px] text-fg-secondary" title={file.name}>
              {file.name} · {formatBytes(sizeOf(file))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workspace && file.type === 'application/pdf' ? (
              <Button variant="secondary" icon={BookOpen} onClick={() => workspace.openResult(outputToFile(file))}>{t('Read exported PDF')}</Button>
            ) : canOpen && (
              <Button variant="secondary" icon={ExternalLink} onClick={() => openInTab(file)}>
                {t('Open')}
              </Button>
            )}
            <Button variant="primary" icon={Download} onClick={() => downloadOutput(file)}>
              {t('Download')}
            </Button>
            {workspace && supportsFileSharing(file.type) && <Button icon={Share2} loading={sharing} onClick={() => void share([file])}>{t('Share file')}</Button>}
          </div>
        </div>
        {children}
      </section>
    );
  }

  return (
    <section ref={ref} className="flex flex-col rounded-xl border border-line bg-surface shadow-card" aria-live="polite">
      <header className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${showList || children ? 'border-b border-line' : ''}`}>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-fg">{title ?? t('{count} ready', { count: pluralize(files.length, t('file'), t('files')) })}</p>
          <p className="text-[12.5px] text-fg-muted">
            {t('{count} · {size} total', { count: pluralize(files.length, t('file'), t('files')), size: formatBytes(total) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={FileArchive} loading={zipping} onClick={() => void downloadZip()}>
          {t('Download all (ZIP)')}
        </Button>
        {workspace && supportsFileSharing(files[0].type) && <Button icon={Share2} loading={sharing} onClick={() => void share(files)}>{t('Share files')}</Button>}
        </div>
      </header>
      {children && <div className="border-b border-line px-4 py-3">{children}</div>}
      {showList && (
      <ul className="max-h-80 divide-y divide-line overflow-y-auto" aria-label={t('Output files')}>
        {files.map((file, i) => (
          <li key={`${file.name}-${i}`} className="flex min-w-0 items-center gap-3 px-4 py-2">
            <span className="w-7 shrink-0 text-right font-mono text-[11.5px] text-fg-muted tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={file.name}>
              {file.name}
            </span>
            <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">{formatBytes(sizeOf(file))}</span>
            <IconButton icon={Download} label={t('Download {name}', { name: file.name })} size="sm" onClick={() => downloadOutput(file)} />
            {workspace && file.type === 'application/pdf' && <IconButton icon={BookOpen} label={t('Read {name}', { name: file.name })} size="sm" onClick={() => workspace.openResult(outputToFile(file))} />}
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}

/** Progress with cancel for a running job. */
export function JobProgress({
  running,
  progress,
  label,
  onCancel,
}: {
  running: boolean;
  progress: number | null;
  label: string;
  onCancel: () => void;
}) {
  if (!running) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <ProgressBar value={progress} label={label || t('Working…')} onCancel={onCancel} />
    </div>
  );
}
