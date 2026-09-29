import { useRef, type ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Eraser, FileUp, FlaskConical } from 'lucide-react';
import { cn, errorMessage } from '@/lib/utils';
import { CodeEditor } from '@/components/editor/CodeEditor';
import type { EditorLanguage } from '@/components/editor/languages';
import { Textarea } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/Button';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { toast } from '@/components/ui/Toast';

const MAX_TEXT_FILE = 50 * 1024 * 1024;

export interface EditorPanelProps {
  title: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  /** `plain` textarea is used unless a language is given (or `code` is set). */
  language?: EditorLanguage;
  code?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  /** Extra toolbar content rendered before the built-in actions. */
  actions?: ReactNode;
  /** Status line under the editor (e.g. counts, validation). */
  footer?: ReactNode;
  /** Sample input: adds a "Load sample" action for editable panels. */
  sample?: string;
  /** Allow opening a local text file into an editable panel. */
  fileAccept?: string;
  /** Enables a download action on read-only panels. */
  downloadName?: string;
  downloadType?: string;
  className?: string;
  /** CSS height of the editing area, e.g. "320px" or "100%". */
  height?: string;
  lineWrapping?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  /** Extra CodeMirror extensions (e.g. error markers). Keep the array reference stable. Implies `code`. */
  extensions?: Extension[];
  /** Receives the CodeMirror view (e.g. to move the cursor to an error). Implies `code`. */
  onReady?: (view: EditorView) => void;
}

/** A titled input or output area with the standard copy/clear/open/download actions. */
export function EditorPanel({
  title,
  value,
  onChange,
  language,
  code,
  placeholder,
  readOnly = !onChange,
  actions,
  footer,
  sample,
  fileAccept,
  downloadName,
  downloadType,
  className,
  height = '360px',
  lineWrapping = true,
  invalid,
  ariaLabel,
  extensions,
  onReady,
}: EditorPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const useCode = code || extensions !== undefined || onReady !== undefined || (language !== undefined && language !== 'plain');
  const label = ariaLabel ?? (typeof title === 'string' ? title : 'Editor');

  async function openFile(file: File) {
    if (file.size > MAX_TEXT_FILE) {
      toast('That file is too large to open as text (limit 50 MB).', 'error');
      return;
    }
    try {
      const text = await file.text();
      // Drop a UTF-8 byte-order mark so parsers (JSON, CSV, YAML…) see the real first character.
      onChange?.(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (error) {
      toast(errorMessage(error, 'Could not read the file.'), 'error');
    }
  }

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-surface shadow-card',
        invalid ? 'border-danger/60' : 'border-line',
        className,
      )}
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        <div className="flex flex-wrap items-center gap-1">
          {actions}
          {!readOnly && sample !== undefined && (
            <IconButton icon={FlaskConical} label="Load sample" size="sm" onClick={() => onChange?.(sample)} />
          )}
          {!readOnly && fileAccept !== undefined && (
            <>
              <IconButton icon={FileUp} label="Open file" size="sm" onClick={() => fileInput.current?.click()} />
              <input
                ref={fileInput}
                type="file"
                accept={fileAccept}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void openFile(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
          {!readOnly && (
            <IconButton icon={Eraser} label="Clear" size="sm" disabled={!value} onClick={() => onChange?.('')} />
          )}
          {readOnly && downloadName && (
            <DownloadButton data={value} filename={downloadName} type={downloadType} label="Save" variant="ghost" />
          )}
          <CopyButton value={value} iconOnly />
        </div>
      </header>
      <div className={cn('min-h-0 p-2', height === '100%' && 'flex-1')} style={height === '100%' ? undefined : { height }}>
        {useCode ? (
          <CodeEditor
            value={value}
            onChange={onChange}
            language={language}
            readOnly={readOnly}
            placeholder={placeholder}
            lineWrapping={lineWrapping}
            ariaLabel={label}
            className="h-full"
            extensions={extensions}
            onReady={onReady}
          />
        ) : (
          <Textarea
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            readOnly={readOnly}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={invalid || undefined}
            className={cn('h-full resize-none', !lineWrapping && 'whitespace-pre')}
            wrap={lineWrapping ? 'soft' : 'off'}
          />
        )}
      </div>
      {footer && (
        <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Two panes side by side on wide screens, stacked on narrow ones. */
export function SplitPanes({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2', className)}>{children}</div>;
}

/** Horizontal row of tool options above the panes. */
export function ToolBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Vertical stack with consistent spacing for tool content. */
export function ToolStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-4', className)}>{children}</div>;
}
