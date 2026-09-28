import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Prec } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import {
  ArrowLeft,
  Check,
  Columns2,
  CopyPlus,
  Eye,
  FileCode,
  FileDown,
  LoaderCircle,
  PencilLine,
  Printer,
  Star,
  Trash,
} from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { cn, downloadBlob, errorMessage, formatNumber, pluralize } from '@/lib/utils';
import { buildNoteHtml, type DiagramRenderer, type DiagramTheme } from '../lib/enhance';
import {
  deriveTitle,
  exportMarkdown,
  noteFileName,
  textStats,
  toggleInlineMarker,
  toggleTask,
  UNTITLED,
  type Note,
} from '../lib/notes';
import { NotePreview } from './NotePreview';
import { TagEditor } from './TagEditor';

export type ViewMode = 'edit' | 'split' | 'preview';
type Draft = Pick<Note, 'title' | 'autoTitle' | 'content' | 'tags'>;
type SaveState = 'saved' | 'pending' | 'saving' | 'error';

const SAVE_DELAY = 500;

function markerCommand(marker: string) {
  return (view: EditorView) => {
    const doc = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    const edit = toggleInlineMarker(doc, from, to, marker);
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.anchor, head: edit.head },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return true;
  };
}

/** Bold/italic shortcuts; highest precedence so they beat CodeMirror's Mod-i (select parent syntax). */
const formattingKeymap = Prec.highest(
  keymap.of([
    { key: 'Mod-b', run: markerCommand('**') },
    { key: 'Mod-i', run: markerCommand('*') },
  ]),
);
const EDITOR_EXTENSIONS = [formattingKeymap];

export function NoteEditor({
  note,
  theme,
  renderDiagram,
  isDesktop,
  mode,
  onMode,
  onBack,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  onSave,
  tagSuggestions,
  autoFocus,
}: {
  note: Note;
  theme: DiagramTheme;
  renderDiagram: DiagramRenderer;
  isDesktop: boolean;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  onBack: () => void;
  onDuplicate: (draft: Draft) => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  /** Persists the changed fields; must merge with the stored record. */
  onSave: (patch: Partial<Draft>) => Promise<void>;
  tagSuggestions: string[];
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    title: note.title,
    autoTitle: note.autoTitle,
    content: note.content,
    tags: note.tags,
  }));
  const draftRef = useRef(draft);
  const dirty = useRef(new Set<keyof Draft>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [save, setSave] = useState<SaveState>('saved');
  const [titleText, setTitleText] = useState(note.autoTitle ? '' : note.title);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (dirty.current.size === 0) return;
    const current = draftRef.current;
    const patch: Partial<Draft> = {};
    for (const key of dirty.current) (patch as Record<string, unknown>)[key] = current[key];
    dirty.current.clear();
    setSave('saving');
    try {
      await onSaveRef.current(patch);
      setSave(dirty.current.size === 0 ? 'saved' : 'pending');
    } catch {
      setSave('error');
      for (const key of Object.keys(patch) as Array<keyof Draft>) dirty.current.add(key);
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Draft>, delay = SAVE_DELAY) => {
      const next = { ...draftRef.current, ...patch };
      if (next.autoTitle) next.title = deriveTitle(next.content);
      for (const key of Object.keys(patch) as Array<keyof Draft>) dirty.current.add(key);
      if (next.title !== draftRef.current.title) dirty.current.add('title');
      draftRef.current = next;
      setDraft(next);
      setSave('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  // Save outstanding edits when switching notes, hiding the tab or leaving the page.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void flush();
    };
  }, [flush]);

  const [printing, setPrinting] = useState(false);

  const print = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const html = await buildNoteHtml(draftRef.current.title, draftRef.current.content, renderDiagram);
      await printHtml(html);
    } catch (err) {
      toast(errorMessage(err, 'Could not prepare the note for printing.'), 'error');
    } finally {
      setPrinting(false);
    }
  }, [printing, renderDiagram]);

  // Ctrl/Cmd+S saves immediately, Ctrl/Cmd+P prints just the rendered note.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void flush().then(() => setSave((s) => (s === 'error' ? s : 'saved')));
      } else if (key === 'p') {
        event.preventDefault();
        void print();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flush, print]);

  const stats = useMemo(() => textStats(draft.content), [draft.content]);
  const effectiveMode: ViewMode = !isDesktop && mode === 'split' ? 'edit' : mode;
  const showEditor = effectiveMode !== 'preview';
  const showPreview = effectiveMode !== 'edit';
  const fileBase = noteFileName(draft.title === UNTITLED ? 'note' : draft.title);

  async function exportHtml() {
    try {
      const html = await buildNoteHtml(draft.title, draft.content, renderDiagram);
      downloadBlob(html, `${fileBase}.html`, 'text/html;charset=utf-8');
    } catch (err) {
      toast(errorMessage(err, 'Could not export the note as HTML.'), 'error');
    }
  }

  return (
    <section aria-label="Note editor" className="flex min-h-0 min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
      <header className="lk-notes-noprint flex flex-col gap-2 border-b border-line px-3 pt-2.5 pb-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          {!isDesktop && <IconButton icon={ArrowLeft} label="Back to notes" size="sm" onClick={onBack} className="-ml-1" />}
          <input
            value={draft.autoTitle ? (draft.title === UNTITLED ? '' : draft.title) : titleText}
            placeholder={UNTITLED}
            onChange={(e) => {
              const value = e.target.value;
              if (value.trim()) {
                setTitleText(value);
                update({ title: value.trim().slice(0, 120), autoTitle: false });
              } else {
                setTitleText('');
                update({ autoTitle: true });
              }
            }}
            maxLength={120}
            aria-label="Note title"
            title={draft.autoTitle ? 'The title follows the first heading. Type to set your own.' : 'Clear the title to use the first heading again.'}
            className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[16px] font-semibold tracking-tight text-fg outline-none placeholder:text-fg-muted hover:bg-surface-hover focus-visible:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent-line"
          />
          <SaveIndicator state={save} />
          <IconButton
            icon={Star}
            size="sm"
            label={note.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={note.favorite}
            onClick={onToggleFavorite}
            className={note.favorite ? 'text-warm hover:text-warm [&_svg]:fill-current' : undefined}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
            <TagEditor tags={draft.tags} onChange={(tags) => update({ tags }, 150)} suggestions={tagSuggestions} />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Segmented
              label="View"
              size="sm"
              value={effectiveMode}
              onChange={onMode}
              options={
                isDesktop
                  ? [
                      { value: 'edit', label: 'Edit', icon: PencilLine },
                      { value: 'split', label: 'Split', icon: Columns2 },
                      { value: 'preview', label: 'Preview', icon: Eye },
                    ]
                  : [
                      { value: 'edit', label: 'Edit', icon: PencilLine },
                      { value: 'preview', label: 'Preview', icon: Eye },
                    ]
              }
            />
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <IconButton icon={CopyPlus} label="Duplicate note" size="sm" onClick={() => onDuplicate(draftRef.current)} />
            <IconButton
              icon={FileDown}
              label="Export Markdown (.md)"
              size="sm"
              onClick={() => downloadBlob(exportMarkdown(draft), `${fileBase}.md`, 'text/markdown;charset=utf-8')}
            />
            <IconButton icon={FileCode} label="Export standalone HTML" size="sm" onClick={() => void exportHtml()} />
            <IconButton
              icon={printing ? LoaderCircle : Printer}
              label="Print or save as PDF (Ctrl+P)"
              size="sm"
              disabled={printing}
              onClick={() => void print()}
              className={printing ? '[&_svg]:animate-spin' : undefined}
            />
            <IconButton icon={Trash} label="Delete note" size="sm" onClick={onDelete} className="hover:text-danger" />
          </div>
        </div>
      </header>

      <div className={cn('grid min-h-0 flex-1 grid-cols-1', showEditor && showPreview && 'grid-cols-2')}>
        {showEditor && (
          <div className={cn('lk-notes-noprint min-h-0 p-2', showPreview && 'border-r border-line', !isDesktop && 'h-[62dvh] min-h-[360px]')}>
            <CodeEditor
              value={draft.content}
              onChange={(content) => update({ content })}
              language="markdown"
              ariaLabel="Note content (Markdown)"
              placeholder="Start writing Markdown…"
              lineNumbers={false}
              extensions={EDITOR_EXTENSIONS}
              autoFocus={autoFocus}
              className="h-full"
            />
          </div>
        )}
        {showPreview && (
          <NotePreview
            content={draft.content}
            theme={theme}
            renderDiagram={renderDiagram}
            onToggleTask={(index) => update({ content: toggleTask(draftRef.current.content, index) }, 150)}
            className={cn('px-5 py-4 sm:px-6', !isDesktop && 'min-h-[360px]')}
          />
        )}
      </div>

      <footer className="lk-notes-noprint flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12px] text-fg-muted" aria-label="Statistics">
        <span>{pluralize(stats.words, 'word')}</span>
        <span>{pluralize(stats.characters, 'character')}</span>
        <span>{stats.readingMinutes === 0 ? 'No reading time' : `${formatNumber(stats.readingMinutes, 0)} min read`}</span>
      </footer>
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'error') {
    return (
      <span role="alert" className="shrink-0 px-1 text-[12px] font-medium text-danger">
        Not saved
      </span>
    );
  }
  const saved = state === 'saved';
  return (
    <span className="inline-flex shrink-0 items-center gap-1 px-1 text-[12px] text-fg-muted" aria-live="polite">
      {saved ? <Check size={13} className="text-success" aria-hidden /> : <LoaderCircle size={13} className="animate-spin" aria-hidden />}
      <span className="hidden sm:inline">{saved ? 'Saved' : 'Saving…'}</span>
      <span className="sr-only sm:hidden">{saved ? 'Saved' : 'Saving'}</span>
    </span>
  );
}

/** Prints a standalone HTML document from a hidden, script-less iframe so only the note is printed. */
function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    const cleanup = () => setTimeout(() => frame.remove(), 500);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new Error('Printing is not available in this browser.'));
        return;
      }
      win.addEventListener('afterprint', cleanup, { once: true });
      // Fallback for browsers that do not fire afterprint in frames.
      setTimeout(() => frame.remove(), 60_000);
      try {
        win.focus();
        win.print();
        resolve();
      } catch (error) {
        frame.remove();
        reject(error instanceof Error ? error : new Error('Printing failed.'));
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
