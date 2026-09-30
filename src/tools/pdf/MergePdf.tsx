import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Combine, FilePlus, Lock, Trash, TriangleAlert } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Input, Label } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { formatBytes, pluralize } from '@/lib/utils';
import { readPdfFile, looksEncrypted } from './lib/bytes';
import { toPdfError } from './lib/errors';
import { openPdf, type OpenedPdf } from './lib/pdfjs';
import { releaseThumbnails } from './lib/thumbnails';
import { parsePageRange } from './lib/ranges';
import { ensureExtension, pdfBlob } from './lib/files';
import { runPdfOp } from './lib/runner';
import { PDF_ACCEPT } from './components/PdfInput';
import { Thumbnail } from './components/Thumbnail';
import { SortableList, GripIcon } from './components/SortableList';
import { arrayMove } from './components/PageGrid';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { t } from '@/lib/i18n';

interface Entry {
  id: string;
  file: File;
  status: 'loading' | 'ready' | 'error';
  bytes?: Uint8Array;
  opened?: OpenedPdf;
  pageCount?: number;
  encrypted?: boolean;
  error?: string;
  range: string;
}

let seq = 0;

export default function MergePdf() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [outputName, setOutputName] = useState('merged.pdf');
  const [allowEncrypted, setAllowEncrypted] = useState(false);
  const job = usePdfJob();
  const nameId = useId();
  const live = useRef<Entry[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    live.current = entries;
  }, [entries]);

  // Destroy every pdf.js document on unmount (files still loading are destroyed when they finish).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const e of live.current) dispose(e);
    };
  }, []);

  function dispose(entry: Entry) {
    if (entry.opened) {
      releaseThumbnails(entry.opened.doc);
      entry.opened.destroy();
    }
  }

  function update(id: string, patch: Partial<Entry>) {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function addFiles(files: File[]) {
    const added: Entry[] = files.map((file) => ({ id: `f${++seq}`, file, status: 'loading', range: '' }));
    setEntries((list) => [...list, ...added]);
    for (const entry of added) {
      if (!mounted.current) return;
      try {
        const bytes = await readPdfFile(entry.file);
        const opened = await openPdf(bytes, { fileName: entry.file.name });
        // Removed from the list (or the tool was closed) while it was loading.
        if (!mounted.current || !live.current.some((e) => e.id === entry.id)) {
          opened.destroy();
          continue;
        }
        update(entry.id, {
          status: 'ready',
          bytes,
          opened,
          pageCount: opened.doc.numPages,
          encrypted: looksEncrypted(bytes),
        });
      } catch (error) {
        const e = toPdfError(error, entry.file.name);
        update(entry.id, {
          status: 'error',
          error:
            e.kind === 'password' || e.kind === 'wrong-password'
              ? t('"{name}" is password-protected. Remove the password in your PDF app, then add it again.', { name: entry.file.name })
              : e.message,
        });
      }
    }
  }

  function remove(id: string) {
    setEntries((list) => {
      const entry = list.find((e) => e.id === id);
      if (entry) dispose(entry);
      return list.filter((e) => e.id !== id);
    });
  }

  function clearAll() {
    for (const e of entries) dispose(e);
    setEntries([]);
  }

  const ready = entries.filter((e) => e.status === 'ready');
  const loading = entries.some((e) => e.status === 'loading');
  const hasEncrypted = ready.some((e) => e.encrypted);

  const plan = useMemo(() => {
    const errors: string[] = [];
    let pages = 0;
    const files = ready.map((e) => {
      if (!e.range.trim()) {
        pages += e.pageCount!;
        return { entry: e, pages: undefined as number[] | undefined };
      }
      const r = parsePageRange(e.range, e.pageCount!, { unique: false });
      if (!r.ok) {
        errors.push(`${e.file.name}: ${r.error}`);
        return { entry: e, pages: [] };
      }
      pages += r.pages.length;
      return { entry: e, pages: r.pages.map((p) => p - 1) };
    });
    return { files, errors, pages };
  }, [ready]);

  const canMerge =
    ready.length > 0 && !loading && plan.errors.length === 0 && plan.pages > 0 && (!hasEncrypted || allowEncrypted) && !job.running;
  // Order, files and page ranges: a merged file is only offered while it matches the list.
  const inputKey = JSON.stringify(plan.files.map((f) => [f.entry.id, f.pages ?? null]));
  const result = useKeyedResult<{ data: Blob; pages: number; files: number }>(inputKey);

  async function merge() {
    const key = inputKey;
    const summary = { pages: plan.pages, files: plan.files.length };
    result.clear();
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp(
        'merge',
        {
          files: plan.files.map((f) => ({ bytes: f.entry.bytes!, name: f.entry.file.name, pages: f.pages })),
          ignoreEncryption: allowEncrypted,
        },
        { signal, onProgress: progress },
      ),
    );
    if (bytes) result.set(key, { data: pdfBlob(bytes), ...summary });
  }

  if (entries.length === 0) {
    return (
      <ToolStack>
        <FileDrop
          accept={PDF_ACCEPT}
          multiple
          onFiles={(files) => void addFiles(files)}
          title={t('Drop PDFs to merge')}
          icon={Combine}
          hint={t('Add two or more PDFs. You can reorder them and pick pages next. Nothing is uploaded.')}
        />
      </ToolStack>
    );
  }

  return (
    <ToolStack>
      <Panel
        title={t('Files to merge ({count})', { count: entries.length })}
        description={t('Drag the handle or use the arrows to set the order. Leave pages empty to include every page.')}
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
          ariaLabel={t('Files to merge, in order')}
          onMove={(from, to) => setEntries((list) => arrayMove(list, from, to))}
          className="divide-y divide-line"
          renderItem={(entry, index, sortable) => (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap">
              <span {...sortable.handleProps}>
                <GripIcon />
              </span>
              <span className="w-5 shrink-0 text-center font-mono text-[12px] text-fg-muted tabular-nums">{index + 1}</span>
              <div className="w-12 shrink-0 rounded-md bg-surface-sunken p-0.5">
                {entry.status === 'ready' ? (
                  <Thumbnail doc={entry.opened!.doc} pageIndex={0} width={60} alt="" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-fg-muted">
                    {entry.status === 'loading' ? <Spinner size={14} /> : <TriangleAlert size={16} className="text-danger" aria-hidden />}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-[13.5px] font-medium text-fg" title={entry.file.name}>
                  {entry.file.name}
                </p>
                {entry.status === 'error' ? (
                  <p className="text-[12.5px] text-danger">{entry.error}</p>
                ) : (
                  <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-muted">
                    <span>{entry.status === 'ready' ? pluralize(entry.pageCount!, t('page'), t('pages')) : t('Reading…')}</span>
                    <span aria-hidden>·</span>
                    <span>{formatBytes(entry.file.size)}</span>
                    {entry.encrypted && (
                      <Badge tone="warning">
                        <Lock size={11} aria-hidden />{' '}{t('Encrypted')}
                      </Badge>
                    )}
                  </p>
                )}
              </div>
              {entry.status === 'ready' && (
                <RangeInput entry={entry} onChange={(range) => update(entry.id, { range })} />
              )}
              <div className="ml-auto flex shrink-0 items-center">
                {sortable.moveUp}
                {sortable.moveDown}
                <IconButton icon={Trash} label={t('Remove {name}', { name: entry.file.name })} size="sm" onClick={() => remove(entry.id)} />
              </div>
            </div>
          )}
        />
        <div className="border-t border-line p-3">
          <FileDrop
            compact
            multiple
            accept={PDF_ACCEPT}
            onFiles={(files) => void addFiles(files)}
            icon={FilePlus}
            title={t('Add more PDFs')}
            hint={t('They are added to the end of the list.')}
          />
        </div>
      </Panel>

      {hasEncrypted && (
        <Alert tone="warning" title={t('Some files are encrypted')}>
          {t('Pages copied out of an encrypted PDF come out blank or unreadable, because the in-browser PDF editor cannot decrypt them. Remove the protection in your PDF app first (for example by printing to a new PDF), then add that copy here.')}
          <Checkbox className="mt-2" label={t('Merge them anyway')} checked={allowEncrypted} onChange={setAllowEncrypted} />
        </Alert>
      )}

      {plan.errors.map((e) => (
        <ErrorMessage key={e} error={e} />
      ))}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <div className="min-w-0 flex-1 basis-56">
          <Label htmlFor={nameId}>{t('Output file name')}</Label>
          <Input id={nameId} value={outputName} onChange={(e) => setOutputName(e.target.value)} spellCheck={false} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-fg-muted">
            {pluralize(ready.length, t('file'), t('files'))}, {pluralize(plan.pages, t('page'), t('pages'))}
          </span>
          <Button variant="primary" icon={Combine} disabled={!canMerge || ready.length < 1} loading={job.running} onClick={() => void merge()}>
            {t('Merge PDFs')}
          </Button>
        </div>
      </div>
      {ready.length === 1 && !loading && (
        <p className="-mt-2 text-[12.5px] text-fg-muted">{t('Add at least one more PDF to combine files (a single file can still be re-saved with a page selection).')}</p>
      )}

      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Merge failed')} />
      {result.value && (
        <ResultFiles
          files={[{ name: ensureExtension(outputName || 'merged', 'pdf'), data: result.value.data, type: 'application/pdf' }]}
          title={t('Merged {count} from {count2}', { count: pluralize(result.value.pages, t('page'), t('pages')), count2: pluralize(result.value.files, t('file'), t('files')) })}
        />
      )}
      {!result.value && !job.running && ready.length === 0 && !loading && (
        <EmptyState icon={Combine} title={t('No readable PDFs yet')}>
          {t('Remove the files with errors or add other PDFs.')}
        </EmptyState>
      )}
    </ToolStack>
  );
}

function RangeInput({ entry, onChange }: { entry: Entry; onChange: (range: string) => void }) {
  const id = useId();
  const r = entry.range.trim() ? parsePageRange(entry.range, entry.pageCount!, { unique: false }) : null;
  return (
    <div className="w-full sm:w-44">
      <label htmlFor={id} className="sr-only">
        {t('Pages of {name} to include', { name: entry.file.name })}
      </label>
      <Input
        id={id}
        value={entry.range}
        placeholder={t('All pages (1-{pageCount})', { pageCount: entry.pageCount })}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={r && !r.ok ? true : undefined}
        title={r && !r.ok ? r.error : t('Pages to include, e.g. 1-3, 5, odd')}
        className="h-8 py-1 text-[13px]"
        mono
      />
    </div>
  );
}
