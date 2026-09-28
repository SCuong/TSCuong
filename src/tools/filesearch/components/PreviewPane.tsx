import { useEffect, useMemo, useState } from 'react';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Download, FolderOpen, TriangleAlert } from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { Alert } from '@/components/ui/Alert';
import { CopyButton } from '@/components/ui/Actions';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Feedback';
import { Badge, KeyValueList } from '@/components/ui/Panel';
import { useObjectUrl } from '@/lib/hooks';
import { downloadBlob, errorMessage, formatBytes, formatNumber } from '@/lib/utils';
import { decodeText, isBinary } from '../lib/extract';
import type { FileMeta } from '../lib/query';
import { isImageFile, languageFor } from '../lib/textFormats';

const OPEN_LIMIT = 20 * 1024 * 1024;

function matchHighlighter(regex: RegExp) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const decorator = new MatchDecorator({
    regexp: new RegExp(regex.source, flags),
    decoration: Decoration.mark({ class: 'lk-hl-match' }),
    maxLength: 2000,
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const STATUS_TEXT: Record<FileMeta['status'], string> = {
  text: 'Indexed text',
  empty: 'Empty file',
  binary: 'Binary file (not indexed)',
  'too-large': 'Too large for content indexing',
  'not-text': 'Not a text format (name only)',
  error: 'Could not be read',
  budget: 'Content skipped (index budget full)',
};

export interface FileAccess {
  /** Whether the file can be read again (FS Access handle or a File from this session). */
  available: boolean;
  /** Explains why the file cannot be opened. */
  reason?: string;
  /** Reading needs no permission prompt, so images can be previewed automatically. */
  autoRead: boolean;
  read: (meta: FileMeta) => Promise<File>;
}

export function PreviewPane({
  meta,
  content,
  loading,
  highlight,
  access,
}: {
  meta: FileMeta;
  content: string | null;
  loading: boolean;
  highlight: RegExp | null;
  access: FileAccess;
}) {
  const [opened, setOpened] = useState<{ text: string | null; file: File; truncated: boolean; binary: boolean } | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const isImage = isImageFile(meta.name);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imageUrl = useObjectUrl(imageFile);

  // Images from this session's files can be shown right away.
  useEffect(() => {
    let cancelled = false;
    if (isImage && access.available && access.autoRead) {
      access
        .read(meta)
        .then((f) => !cancelled && setImageFile(f))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [access, isImage, meta]);

  async function openFile() {
    setOpening(true);
    setOpenError(null);
    try {
      const file = await access.read(meta);
      if (isImage) {
        setImageFile(file);
        setOpened({ text: null, file, truncated: false, binary: true });
        return;
      }
      const bytes = new Uint8Array(await file.slice(0, OPEN_LIMIT).arrayBuffer());
      const binary = isBinary(bytes);
      setOpened({ text: binary ? null : decodeText(bytes), file, truncated: file.size > OPEN_LIMIT, binary });
    } catch (error) {
      setOpenError(errorMessage(error, 'The file could not be read.'));
    } finally {
      setOpening(false);
    }
  }

  const text = opened ? opened.text : content;
  const extensions = useMemo(() => (highlight ? [matchHighlighter(highlight)] : []), [highlight]);
  const firstMatch = useMemo(() => {
    if (!highlight || !text) return -1;
    const re = new RegExp(highlight.source, highlight.flags.replace('g', ''));
    const m = re.exec(text);
    return m ? m.index : -1;
  }, [highlight, text]);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-[14px] font-semibold text-fg" title={meta.name}>
            {meta.name}
          </h3>
          <Badge tone={meta.status === 'text' ? 'success' : meta.status === 'error' ? 'danger' : 'neutral'}>{STATUS_TEXT[meta.status]}</Badge>
        </div>
        <p className="font-mono text-[12px] break-all text-fg-muted">{meta.path}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" icon={FolderOpen} onClick={() => void openFile()} loading={opening} disabled={!access.available}>
          Open file
        </Button>
        <Button
          size="sm"
          icon={Download}
          disabled={!access.available}
          onClick={async () => {
            try {
              const file = opened?.file ?? (await access.read(meta));
              downloadBlob(file, meta.name);
            } catch (error) {
              setOpenError(errorMessage(error, 'The file could not be read.'));
            }
          }}
        >
          Download a copy
        </Button>
        <CopyButton value={meta.path} label="Copy path" />
      </div>
      {!access.available && access.reason && <p className="text-[12.5px] text-fg-muted">{access.reason}</p>}
      {openError && (
        <Alert tone="danger" title="Could not open the file">
          {openError}
        </Alert>
      )}

      <KeyValueList
        mono={false}
        items={[
          { label: 'Size', value: `${formatBytes(meta.size)} (${formatNumber(meta.size, 0)} bytes)` },
          { label: 'Modified', value: meta.lastModified ? new Date(meta.lastModified).toLocaleString() : 'Unknown' },
          { label: 'Type', value: meta.ext ? `.${meta.ext}` : 'No extension' },
        ]}
      />

      {isImage && imageUrl ? (
        <div className="lk-checker flex max-h-[420px] justify-center overflow-auto rounded-lg border border-line p-2">
          <img src={imageUrl} alt={meta.name} className="max-h-[400px] max-w-full object-contain" />
        </div>
      ) : loading ? (
        <Spinner label="Loading preview…" />
      ) : text !== null && text !== undefined ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {opened?.truncated && (
            <Alert tone="warning">Only the first {formatBytes(OPEN_LIMIT)} of this file are shown.</Alert>
          )}
          {!opened && meta.status === 'text' && (
            <p className="text-[12px] text-fg-muted">Showing the indexed text. “Open file” reads the current version from disk.</p>
          )}
          <div className="h-[420px] min-w-0 lg:h-[calc(100dvh-420px)] lg:min-h-[320px]">
            <CodeEditor
              key={`${meta.id}-${opened ? 'open' : 'index'}`}
              value={text}
              readOnly
              language={languageFor(meta.name)}
              ariaLabel={`Contents of ${meta.name}`}
              lineWrapping={false}
              className="h-full"
              extensions={extensions}
              onReady={(view) => {
                if (firstMatch >= 0) {
                  requestAnimationFrame(() => view.dispatch({ effects: EditorView.scrollIntoView(firstMatch, { y: 'center' }) }));
                }
              }}
            />
          </div>
        </div>
      ) : opened?.binary ? (
        <Alert tone="info">This is a binary file, so there is no text to show. Use “Download a copy” to open it in another app.</Alert>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken p-3 text-[13px] text-fg-secondary">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
          <span>
            {meta.status === 'too-large'
              ? 'This file is larger than the text size limit, so only its name and path were indexed. Use “Open file” to read it.'
              : meta.status === 'budget'
                ? 'The content index was full, so this file’s text was not stored. Use “Open file” to read it.'
                : meta.status === 'binary'
                  ? 'This is a binary file (it contains NUL bytes), so its content is not searchable.'
                  : meta.status === 'error'
                    ? 'This file could not be read while indexing.'
                    : isImage
                      ? 'Use “Open file” to preview this image.'
                      : 'Only the name and path of this file type are indexed.'}
          </span>
        </div>
      )}
    </div>
  );
}
