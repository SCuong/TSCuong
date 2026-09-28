import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowDownUp,
  Copy,
  FilePlus,
  LayoutGrid,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Square,
  Trash,
  Undo2,
} from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Panel';
import { toast } from '@/components/ui/Toast';
import { modKey, pluralize } from '@/lib/utils';
import { readPdfFile } from './lib/bytes';
import { toPdfError } from './lib/errors';
import { openPdf, type OpenedPdf } from './lib/pdfjs';
import { docId, releaseThumbnails } from './lib/thumbnails';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import {
  deleteItems,
  duplicateItems,
  idsByPosition,
  initialItems,
  insertAfterSelection,
  isUnchanged,
  newId,
  reverseItems,
  rotateItems,
  toOrganizeItems,
  type PageItem,
} from './lib/organize';
import { PDF_ACCEPT, PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { CardButton, PageGrid, arrayMove, type GridItem } from './components/PageGrid';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useHistory } from './components/useHistory';

interface ExtraSource {
  name: string;
  bytes: Uint8Array;
  opened: OpenedPdf;
}

export default function OrganizePages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to organize">
        {(pdf) => <OrganizeWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function OrganizeWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const history = useHistory<PageItem[]>(useMemo(() => initialItems(pdf.pageCount), [pdf.pageCount]));
  const items = history.value;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [extras, setExtras] = useState<ExtraSource[]>([]);
  const [blankSize, setBlankSize] = useState<[number, number]>([595.28, 841.89]);
  const [result, setResult] = useState<OutputFile | null>(null);
  const [inserting, setInserting] = useState(false);
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf);
  const insertInput = useRef<HTMLInputElement>(null);
  const extrasRef = useRef<ExtraSource[]>([]);

  useEffect(() => {
    extrasRef.current = extras;
  }, [extras]);

  useEffect(
    () => () => {
      for (const x of extrasRef.current) {
        releaseThumbnails(x.opened.doc);
        x.opened.destroy();
      }
    },
    [],
  );

  // Blank pages default to the size of the first page.
  useEffect(() => {
    let alive = true;
    pdf.doc
      .getPage(1)
      .then((page) => {
        const vp = page.getViewport({ scale: 1 });
        if (alive) setBlankSize([vp.width, vp.height]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pdf.doc]);

  const docs = useMemo(() => [pdf.doc, ...extras.map((x) => x.opened.doc)], [pdf.doc, extras]);

  const gridItems = useMemo<GridItem[]>(
    () =>
      items.map((it) =>
        it.kind === 'blank'
          ? { id: it.id, doc: null, pageIndex: 0, label: 'Blank page', sublabel: `${Math.round(it.width)} × ${Math.round(it.height)} pt` }
          : {
              id: it.id,
              doc: docs[it.source],
              pageIndex: it.index,
              rotation: it.rotate,
              label: it.source === 0 ? `Page ${it.index + 1}` : `p. ${it.index + 1}`,
              sublabel: it.source === 0 ? undefined : extras[it.source - 1]?.name,
            },
      ),
    [items, docs, extras],
  );

  function change(next: PageItem[] | ((prev: PageItem[]) => PageItem[])) {
    setResult(null);
    history.set(next);
  }

  const target = (id?: string) => (id ? new Set([id]) : selected);
  const rotate = (delta: number, id?: string) => change((list) => rotateItems(list, target(id), delta));
  const remove = (id?: string) => {
    const ids = target(id);
    change((list) => deleteItems(list, ids));
    setSelected((s) => new Set([...s].filter((x) => !ids.has(x))));
  };
  const duplicate = (id?: string) => change((list) => duplicateItems(list, target(id)).items);

  function addBlank() {
    change((list) => insertAfterSelection(list, selected, [{ id: newId(), kind: 'blank', width: blankSize[0], height: blankSize[1] }]));
  }

  async function insertPdf(file: File) {
    setInserting(true);
    try {
      const bytes = await readPdfFile(file);
      const opened = await openPdf(bytes, { fileName: file.name });
      const sourceIndex = extras.length + 1;
      setExtras((list) => [...list, { name: file.name, bytes, opened }]);
      const inserted: PageItem[] = Array.from({ length: opened.doc.numPages }, (_, index) => ({
        id: newId(),
        kind: 'page',
        source: sourceIndex,
        index,
        rotate: 0,
      }));
      change((list) => insertAfterSelection(list, selected, inserted));
      toast(`Inserted ${pluralize(inserted.length, 'page')} from ${file.name}`);
    } catch (error) {
      const e = toPdfError(error, file.name);
      toast(e.kind === 'password' ? `"${file.name}" is password-protected and cannot be inserted.` : e.message, 'error', 5000);
    } finally {
      setInserting(false);
    }
  }

  async function save() {
    setResult(null);
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp(
        'organize',
        { sources: [pdf.bytes, ...extras.map((x) => x.bytes)], items: toOrganizeItems(items), ignoreEncryption: gate.ignoreEncryption },
        { signal, onProgress: progress },
      ),
    );
    if (bytes) setResult({ name: outputName(pdf.file.name, 'organized'), data: pdfBlob(bytes), type: 'application/pdf' });
  }

  function onWorkspaceKey(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      history.undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      history.redo();
    }
  }

  function onCardKey(event: KeyboardEvent, item: GridItem): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(selected.has(item.id) && selected.size > 1 ? undefined : item.id);
      return true;
    }
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      rotate(event.shiftKey ? -90 : 90, selected.has(item.id) && selected.size > 1 ? undefined : item.id);
      return true;
    }
    return false;
  }

  const hasSel = selected.size > 0;
  const unchanged = isUnchanged(items, pdf.pageCount) && extras.length === 0;

  return (
    <div className="flex flex-col gap-4" onKeyDown={onWorkspaceKey}>
      {gate.notice}
      <div className="z-20 flex flex-col sm:sticky sm:top-16 gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2.5 shadow-raised backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={Undo2} disabled={!history.canUndo} onClick={history.undo} title={`Undo (${modKey}+Z)`}>
            Undo
          </Button>
          <Button size="sm" variant="ghost" icon={Redo2} disabled={!history.canRedo} onClick={history.redo} title={`Redo (${modKey}+Shift+Z)`}>
            Redo
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!hasSel} onClick={() => rotate(-90)}>
            Left
          </Button>
          <Button size="sm" variant="ghost" icon={RotateCw} disabled={!hasSel} onClick={() => rotate(90)}>
            Right
          </Button>
          <Button size="sm" variant="ghost" icon={Copy} disabled={!hasSel} onClick={() => duplicate()}>
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" icon={Trash} disabled={!hasSel || selected.size >= items.length} onClick={() => remove()}>
            Delete
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Button size="sm" variant="ghost" icon={Square} onClick={addBlank} title={hasSel ? 'Insert after the selection' : 'Insert at the end'}>
            Blank page
          </Button>
          <Button size="sm" variant="ghost" icon={FilePlus} loading={inserting} onClick={() => insertInput.current?.click()}>
            Insert PDF
          </Button>
          <input
            ref={insertInput}
            type="file"
            accept={PDF_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void insertPdf(file);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={ArrowDownUp}
            onClick={() => change((list) => reverseItems(list, selected))}
            title={selected.size > 1 ? 'Reverse the selected pages' : 'Reverse all pages'}
          >
            Reverse
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-2">
          <span className="mr-1 text-[12.5px] text-fg-muted">
            Select{hasSel ? ` (${selected.size})` : ''}:
          </span>
          {(['all', 'odd', 'even'] as const).map((w) => (
            <Button key={w} size="sm" variant="ghost" onClick={() => setSelected(idsByPosition(items, w))}>
              {w[0].toUpperCase() + w.slice(1)}
            </Button>
          ))}
          <Button size="sm" variant="ghost" disabled={!hasSel} onClick={() => setSelected(new Set())}>
            None
          </Button>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[12.5px] text-fg-muted">{pluralize(items.length, 'page')}</span>
            <Button
              size="sm"
              variant="primary"
              icon={Save}
              disabled={!gate.ok || items.length === 0 || job.running || unchanged}
              loading={job.running}
              onClick={() => void save()}
            >
              Save PDF
            </Button>
          </span>
        </div>
      </div>

      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Could not save" />
      {result && <ResultFiles files={[result]} title={`Organized PDF with ${pluralize(items.length, 'page')}`} />}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
          <LayoutGrid size={20} className="text-fg-muted" aria-hidden />
          <p className="text-sm text-fg">All pages were deleted.</p>
          <Button size="sm" icon={Undo2} onClick={history.undo} disabled={!history.canUndo}>
            Undo
          </Button>
        </div>
      ) : (
        <PageGrid
          items={gridItems}
          ariaLabel="Pages in the new document"
          selected={selected}
          onSelectionChange={setSelected}
          onMove={(from, to) => change((list) => arrayMove(list, from, to))}
          onCardKey={onCardKey}
          renderActions={(item) => (
            <>
              {item.doc && (
                <>
                  <CardButton label={`Rotate ${item.label} left`} onClick={() => rotate(-90, item.id)}>
                    <RotateCcw size={14} aria-hidden />
                  </CardButton>
                  <CardButton label={`Rotate ${item.label} right`} onClick={() => rotate(90, item.id)}>
                    <RotateCw size={14} aria-hidden />
                  </CardButton>
                </>
              )}
              <CardButton label={`Duplicate ${item.label}`} onClick={() => duplicate(item.id)}>
                <Copy size={14} aria-hidden />
              </CardButton>
              <CardButton label={`Delete ${item.label}`} danger disabled={items.length <= 1} onClick={() => remove(item.id)}>
                <Trash size={14} aria-hidden />
              </CardButton>
            </>
          )}
        />
      )}
      <p className="text-[12.5px] text-fg-muted">
        Tips: drag pages to reorder (on touch screens use the grip). With a page focused: <Kbd>Space</Kbd> selects,{' '}
        <Kbd>R</Kbd> rotates, <Kbd>Del</Kbd> deletes, <Kbd>Alt</Kbd>+<Kbd>←</Kbd>/<Kbd>→</Kbd> moves. <Kbd>{modKey}</Kbd>+<Kbd>Z</Kbd>{' '}
        undoes.
      </p>
    </div>
  );
}
