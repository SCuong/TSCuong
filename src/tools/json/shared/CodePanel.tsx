import { useRef, type ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Eraser, FileUp, FlaskConical } from 'lucide-react';
import { cn, errorMessage } from '@/lib/utils';
import { CodeEditor } from '@/components/editor/CodeEditor';
import type { EditorLanguage } from '@/components/editor/languages';
import { IconButton } from '@/components/ui/Button';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { toast } from '@/components/ui/Toast';

const MAX_TEXT_FILE = 50 * 1024 * 1024;

export interface CodePanelProps {
  title: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  placeholder?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  sample?: string;
  fileAccept?: string;
  downloadName?: string;
  downloadType?: string;
  className?: string;
  height?: string;
  lineWrapping?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  /** Extra CodeMirror extensions (e.g. error-line highlighting). Keep the array reference stable. */
  extensions?: Extension[];
  onReady?: (view: EditorView) => void;
}

/**
 * Same look and actions as the shared EditorPanel, but always CodeMirror and
 * accepts extra extensions (error markers) plus access to the EditorView.
 */
export function CodePanel({
  title,
  value,
  onChange,
  language = 'plain',
  placeholder,
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
}: CodePanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const readOnly = !onChange;
  const label = ariaLabel ?? (typeof title === 'string' ? title : 'Editor');

  async function openFile(file: File) {
    if (file.size > MAX_TEXT_FILE) {
      toast('That file is too large to open as text (limit 50 MB).', 'error');
      return;
    }
    try {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      onChange?.(text);
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
      </div>
      {footer && (
        <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
          {footer}
        </footer>
      )}
    </section>
  );
}
