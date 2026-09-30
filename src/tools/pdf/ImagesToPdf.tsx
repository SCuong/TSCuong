import { useEffect, useId, useRef, useState } from 'react';
import { FileImage, ImagePlus, Trash, TriangleAlert } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Feedback';
import { formatBytes, pluralize } from '@/lib/utils';
import { throwIfAborted } from '@/lib/hooks';
import { toPdfError } from './lib/errors';
import { probeImage, prepareImage } from './lib/imagePrep';
import { ensureExtension, pdfBlob } from './lib/files';
import type { ImageLayout, ImagePageInput } from './lib/ops';
import { runPdfOp } from './lib/runner';
import { SortableList, GripIcon } from './components/SortableList';
import { arrayMove } from './components/PageGrid';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { t } from '@/lib/i18n';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp';

interface Entry {
  id: string;
  file: File;
  url: string;
  status: 'loading' | 'ready' | 'error';
  width?: number;
  height?: number;
  error?: string;
}

const MARGINS = { none: 0, small: 18, medium: 36, large: 72 } as const;
type MarginKey = keyof typeof MARGINS;

let seq = 0;

export default function ImagesToPdf() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pageSize, setPageSize] = useState<ImageLayout['pageSize']>('a4');
  const [orientation, setOrientation] = useState<ImageLayout['orientation']>('auto');
  const [margin, setMargin] = useState<MarginKey>('small');
  const [name, setName] = useState('images.pdf');
  const job = usePdfJob();
  const nameId = useId();
  const live = useRef<Entry[]>([]);

  useEffect(() => {
    live.current = entries;
  }, [entries]);
  useEffect(() => () => live.current.forEach((e) => URL.revokeObjectURL(e.url)), []);

  function update(id: string, patch: Partial<Entry>) {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function addFiles(files: File[]) {
    const added: Entry[] = files.map((file) => ({ id: `img${++seq}`, file, url: URL.createObjectURL(file), status: 'loading' }));
    setEntries((list) => [...list, ...added]);
    for (const entry of added) {
      try {
        const probe = await probeImage(entry.file);
        update(entry.id, { status: 'ready', width: probe.width, height: probe.height });
      } catch (error) {
        update(entry.id, { status: 'error', error: toPdfError(error).message });
      }
    }
  }

  function remove(id: string) {
    setEntries((list) => {
      const e = list.find((x) => x.id === id);
      if (e) URL.revokeObjectURL(e.url);
      return list.filter((x) => x.id !== id);
    });
  }

  function clearAll() {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    setEntries([]);
  }

  const ready = entries.filter((e) => e.status === 'ready');
  const loading = entries.some((e) => e.status === 'loading');
  // Images, their order and the page setup: a PDF is only offered while it matches them.
  const inputKey = JSON.stringify([ready.map((e) => e.id), pageSize, orientation, margin]);
  const result = useKeyedResult<Blob>(inputKey);

  async function convert() {
    const key = inputKey;
    result.clear();
    const layout: ImageLayout = { pageSize, orientation, margin: MARGINS[margin] };
    const bytes = await job.run(async ({ signal, progress }) => {
      const images: ImagePageInput[] = [];
      for (let i = 0; i < ready.length; i++) {
        throwIfAborted(signal);
        progress((i / ready.length) * 0.6, `Preparing image ${i + 1} of ${ready.length}`);
        try {
          images.push(await prepareImage(ready[i].file));
        } catch (error) {
          throw new Error(`${ready[i].file.name}: ${toPdfError(error).message}`, { cause: error });
        }
      }
      return runPdfOp(
        'imagesToPdf',
        { images, layout },
        { signal, onProgress: (v, label) => progress(0.6 + v * 0.4, label) },
      );
    });
    if (bytes) result.set(key, pdfBlob(bytes));
  }

  if (entries.length === 0) {
    return (
      <ToolStack>
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          onFiles={(files) => void addFiles(files)}
          title={t('Drop images to turn into a PDF')}
          icon={FileImage}
          hint={t('JPG, PNG, WebP, GIF (first frame), BMP and AVIF where your browser can decode it. Nothing is uploaded.')}
        />
      </ToolStack>
    );
  }

  return (
    <ToolStack>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title={t('Images ({count})', { count: entries.length })}
          description={t('One page per image, in this order.')}
          actions={
            <Button size="sm" variant="ghost" icon={Trash} onClick={clearAll}>
              {t('Clear all')}
            </Button>
          }
          bodyClassName="p-0"
        >
          <SortableList
            items={entries}
            getKey={(e) => e.id}
            getLabel={(e) => e.file.name}
            ariaLabel={t('Images in page order')}
            className="divide-y divide-line"
            onMove={(from, to) => setEntries((list) => arrayMove(list, from, to))}
            renderItem={(entry, index, sortable) => (
              <div className="flex min-w-0 items-center gap-3 px-3 py-2">
                <span {...sortable.handleProps}>
                  <GripIcon />
                </span>
                <span className="w-5 shrink-0 text-center font-mono text-[12px] text-fg-muted tabular-nums">{index + 1}</span>
                <div className="lk-checker flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line">
                  {entry.status === 'error' ? (
                    <TriangleAlert size={16} className="text-danger" aria-hidden />
                  ) : (
                    <img src={entry.url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-fg" title={entry.file.name}>
                    {entry.file.name}
                  </p>
                  {entry.status === 'error' ? (
                    <p className="text-[12.5px] text-danger">{entry.error}</p>
                  ) : (
                    <p className="text-[12.5px] text-fg-muted">
                      {entry.status === 'loading' ? (
                        <Spinner size={12} label={t('Reading…')} />
                      ) : (
                        t('{width} × {height} px · {size}', { width: entry.width, height: entry.height, size: formatBytes(entry.file.size) })
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <span className="hidden sm:contents">
                    {sortable.moveUp}
                    {sortable.moveDown}
                  </span>
                  <IconButton icon={Trash} label={t('Remove {name}', { name: entry.file.name })} size="sm" onClick={() => remove(entry.id)} />
                </div>
              </div>
            )}
          />
          <div className="border-t border-line p-3">
            <FileDrop
              compact
              multiple
              accept={IMAGE_ACCEPT}
              onFiles={(files) => void addFiles(files)}
              icon={ImagePlus}
              title={t('Add more images')}
              hint={t('Added to the end of the list.')}
            />
          </div>
        </Panel>

        <Panel title={t('Page setup')} className="h-fit lg:sticky lg:top-16">
          <div className="flex flex-col gap-4">
            <div>
              <Label>{t('Page size')}</Label>
              <Segmented
                label={t('Page size')}
                value={pageSize}
                onChange={setPageSize}
                options={[
                  { value: 'fit', label: t('Fit image') },
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: t('Letter') },
                ]}
              />
            </div>
            {pageSize === 'fit' ? (
              <p className="-mt-2 text-[12.5px] text-fg-muted">{t('Each page takes the size of its image (at 96 DPI).')}</p>
            ) : (
              <div>
                <Label>{t('Orientation')}</Label>
                <Segmented
                  label={t('Orientation')}
                  value={orientation}
                  onChange={setOrientation}
                  options={[
                    { value: 'auto', label: t('Auto') },
                    { value: 'portrait', label: t('Portrait') },
                    { value: 'landscape', label: t('Landscape') },
                  ]}
                />
              </div>
            )}
            <div>
              <Label>{t('Margin')}</Label>
              <Segmented
                label={t('Margin')}
                value={margin}
                onChange={setMargin}
                options={[
                  { value: 'none', label: t('None') },
                  { value: 'small', label: t('Small') },
                  { value: 'medium', label: t('Medium') },
                  { value: 'large', label: t('Large') },
                ]}
              />
            </div>
            <div>
              <Label htmlFor={nameId}>{t('Output file name')}</Label>
              <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            </div>
            <Button
              variant="primary"
              icon={FileImage}
              disabled={ready.length === 0 || loading || job.running}
              loading={job.running}
              onClick={() => void convert()}
            >
              {t('Create PDF ({count})', { count: pluralize(ready.length, t('page'), t('pages')) })}
            </Button>
            {entries.some((e) => e.status === 'error') && (
              <p className="text-[12.5px] text-fg-muted">{t('Images that could not be read are skipped.')}</p>
            )}
          </div>
        </Panel>
      </div>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Could not create the PDF')} />
      {result.value && (
        <ResultFiles files={[{ name: ensureExtension(name || 'images', 'pdf'), data: result.value, type: 'application/pdf' }]} />
      )}
    </ToolStack>
  );
}
