import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileDown, FileUp, X } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Textarea } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { FileDrop } from '@/components/ui/FileDrop';
import { ProgressBar } from '@/components/ui/Feedback';
import { Badge, KeyValueList, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { nextFrame, useAsyncJob, useObjectUrl, useToolState } from '@/lib/hooks';
import { baseName, downloadBlob, errorMessage, formatBytes, formatNumber } from '@/lib/utils';
import { base64ToBytes, blobToBase64, parseBase64Payload, toDataUrl } from './lib/base64File';
import { canonicalMime, detectFileType, extensionForMime, type DetectedType } from './lib/magic';
import { Opt } from '../text/components/shared';

const ID = 'base64-file';
const MAX_FILE = 100 * 1024 * 1024;
const WARN_FILE = 10 * 1024 * 1024;
const PREVIEW_CHARS = 200_000;
// A 16×16 PNG (a blue dot), used as the sample for decoding.
const SAMPLE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR42mP4//8/AyWYgWYGqCa//o+MiTYAXSMhg0jSjM0Q6hlArGZ0Q4aTAQMfC1RJSFRJynTPjQDjssBPddPW0AAAAABJRU5ErkJggg==';

type Tab = 'encode' | 'decode';
type OutputFormat = 'base64' | 'dataUrl';

export default function Base64File() {
  const [tab, setTab] = useToolState<Tab>(ID, 'tab', 'encode');
  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Direction">
          <Segmented
            label="Direction"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'encode', label: 'File → Base64', icon: FileUp },
              { value: 'decode', label: 'Base64 → File', icon: FileDown },
            ]}
          />
        </Opt>
        <p className="pb-2 text-[12.5px] text-fg-muted">Files are read in chunks on this device and never uploaded.</p>
      </ToolBar>
      {tab === 'encode' ? <EncodeFile /> : <DecodeToFile />}
    </ToolStack>
  );
}

/* ------------------------------------------------------------------------ */

function EncodeFile() {
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState('');
  const [detected, setDetected] = useState<DetectedType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useToolState<OutputFormat>(ID, 'format', 'dataUrl');
  const job = useAsyncJob();
  const previewUrl = useObjectUrl(file && (file.type.startsWith('image/') || detected?.mime.startsWith('image/')) ? file : null);
  // The file being encoded; results of an abandoned file are ignored.
  const currentFile = useRef<File | null>(null);

  async function onFile(next: File) {
    currentFile.current = next;
    setFile(next);
    setBase64('');
    setError(null);
    setDetected(null);
    try {
      const head = detectFileType(new Uint8Array(await next.slice(0, 4100).arrayBuffer()));
      if (currentFile.current !== next) return;
      setDetected(head);
      const encoded = await job.run(({ signal, progress }) =>
        blobToBase64(next, { signal, progress: (f) => progress(f, 'Encoding…'), yieldFn: nextFrame }),
      );
      if (currentFile.current === next) setBase64(encoded);
    } catch (e) {
      if (currentFile.current !== next) return;
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Cancelled by the user: back to the drop zone, no error.
        currentFile.current = null;
        setFile(null);
        return;
      }
      setError(errorMessage(e, 'Could not read the file.'));
    }
  }

  function reset() {
    currentFile.current = null;
    job.cancel();
    setFile(null);
    setBase64('');
    setError(null);
  }

  const mime = file?.type || detected?.mime || 'application/octet-stream';
  const output = useMemo(() => (base64 ? (format === 'dataUrl' ? toDataUrl(base64, mime) : base64) : ''), [base64, format, mime]);
  const preview = output.length > PREVIEW_CHARS ? `${output.slice(0, PREVIEW_CHARS)}…` : output;

  return (
    <>
      {!file ? (
        <FileDrop
          onFiles={(files) => void onFile(files[0])}
          maxSize={MAX_FILE}
          title="Drop any file to encode"
          hint={`Images, PDFs, fonts, anything up to ${formatBytes(MAX_FILE)}. Processed locally.`}
          onReject={(reason) => setError(reason)}
        />
      ) : (
        <Panel
          title={<span className="break-all">{file.name}</span>}
          description={`${formatBytes(file.size)} · ${detected?.label ?? (file.type || 'Unknown type')}`}
          actions={<IconButton icon={X} label="Choose another file" size="sm" onClick={reset} />}
        >
          <div className="flex flex-col gap-4 sm:flex-row">
            {previewUrl && (
              <div className="lk-checker flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line sm:w-40">
                <img src={previewUrl} alt={`Preview of ${file.name}`} className="max-h-full max-w-full object-contain" />
              </div>
            )}
            <KeyValueList
              className="min-w-0 flex-1"
              items={[
                { label: 'MIME type', value: mime },
                { label: 'Detected from content', value: detected ? `${detected.label} (${detected.mime})` : 'Unknown' },
                { label: 'Base64 length', value: base64 ? `${formatNumber(base64.length, 0)} characters (${formatBytes(output.length)})` : '—' },
              ]}
            />
          </div>
        </Panel>
      )}
      {job.running && <ProgressBar value={job.progress} label={job.label || 'Reading file…'} onCancel={job.cancel} />}
      <ErrorMessage error={error} />
      {file && file.size > WARN_FILE && (
        <Alert tone="warning" title="Large file">
          Base64 is about 33% larger than the file. Very long strings can make pasting and copying slow; downloading the result as a
          file is the most reliable option.
        </Alert>
      )}
      {output && (
        <Panel
          title={format === 'dataUrl' ? 'Data URL' : 'Base64'}
          description={`${formatNumber(output.length, 0)} characters`}
          actions={
            <>
              <Segmented
                label="Output format"
                size="sm"
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'dataUrl', label: 'Data URL' },
                  { value: 'base64', label: 'Base64' },
                ]}
              />
              <CopyButton value={() => output} />
              <DownloadButton data={() => output} filename={`${baseName(file?.name ?? 'file')}.b64.txt`} label="Save" />
            </>
          }
          bodyClassName="p-2"
        >
          <Textarea value={preview} readOnly aria-label="Encoded output" className="h-64 resize-none break-all" />
          {output.length > PREVIEW_CHARS && (
            <p className="px-2 pt-2 text-[12.5px] text-fg-muted">
              Showing the first {formatNumber(PREVIEW_CHARS, 0)} characters. Copy and Save include the full output.
            </p>
          )}
        </Panel>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ */

function DecodeToFile() {
  const [input, setInput] = useToolState(ID, 'decodeInput', '');
  const [name, setName] = useState('');
  const job = useAsyncJob();
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (input.trim() ? parseBase64Payload(input) : null), [input]);
  const head = useMemo(() => {
    if (!parsed?.ok) return null;
    const bin = atob(parsed.base64.slice(0, 5472)); // 4104 bytes, enough for magic numbers
    return detectFileType(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }, [parsed]);

  const size = parsed?.ok ? Math.floor((parsed.base64.replace(/=+$/, '').length * 3) / 4) : 0;
  const declared = parsed?.ok ? parsed.declaredMime : null;
  // A declared type beats a guess made from text content alone (data:text/csv is CSV, not "plain text").
  const useDeclared = Boolean(declared && (!head || head.weak));
  const mime = (useDeclared ? declared : head?.mime) ?? declared ?? 'application/octet-stream';
  const declaredExt = declared ? extensionForMime(declared) : 'bin';
  const ext = useDeclared ? (declaredExt !== 'bin' ? declaredExt : (head?.ext ?? 'bin')) : (head?.ext ?? declaredExt);
  const filename = name.trim() || `decoded.${ext}`;
  const mismatch = Boolean(declared && head && !head.weak && canonicalMime(declared) !== canonicalMime(head.mime));

  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const previewUrl = useObjectUrl(previewBlob);
  useEffect(() => {
    let cancelled = false;
    if (parsed?.ok && head?.mime.startsWith('image/') && size < 10 * 1024 * 1024) {
      void base64ToBytes(parsed.base64).then((bytes) => {
        if (!cancelled) setPreviewBlob(new Blob([bytes.slice()], { type: head.mime }));
      });
    } else setPreviewBlob(null);
    return () => {
      cancelled = true;
    };
  }, [parsed, head, size]);

  async function download() {
    if (!parsed?.ok) return;
    setError(null);
    try {
      const bytes = await job.run(({ signal, progress }) =>
        base64ToBytes(parsed.base64, { signal, progress: (f) => progress(f, 'Decoding…'), yieldFn: nextFrame }),
      );
      downloadBlob(new Blob([bytes.slice()], { type: mime }), filename);
      toast(`Saved ${filename}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(errorMessage(e, 'Could not decode the data.'));
    }
  }

  return (
    <>
      <EditorPanel
        title="Base64 or data URL"
        value={input}
        onChange={setInput}
        placeholder="Paste Base64 text or a data:…;base64,… URL"
        sample={SAMPLE_DATA_URL}
        fileAccept=".txt,.b64,.base64,text/plain"
        invalid={Boolean(parsed && !parsed.ok)}
        height="220px"
        footer={input ? <span>{formatNumber(input.length, 0)} characters</span> : undefined}
      />
      <ErrorMessage error={parsed && !parsed.ok ? parsed.error : error} title={parsed && !parsed.ok ? 'Invalid Base64' : undefined} />
      {parsed?.ok && (
        <Panel title="Decoded file" description={`${formatBytes(size)} · ${head?.label ?? 'Unknown binary data'}`}>
          <div className="flex flex-col gap-4 sm:flex-row">
            {previewUrl && (
              <div className="lk-checker flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line sm:w-40">
                <img src={previewUrl} alt="Decoded image preview" className="max-h-full max-w-full object-contain" />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <KeyValueList
                items={[
                  {
                    label: 'Detected type',
                    value: head ? `${head.label} (${head.mime})` : declared ? 'Not recognized from the content' : 'Not recognized, saved as binary',
                  },
                  ...(declared ? [{ label: 'Declared in data URL', value: declared }] : []),
                  { label: 'Saved as', value: mime },
                ]}
              />
              {mismatch && (
                <Badge tone="warning" className="self-start">
                  The data URL says {declared}, but the content looks like {head?.mime}
                </Badge>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <Opt label="File name" className="min-w-48 flex-1">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={filename} aria-label="File name" />
                </Opt>
                <Button variant="primary" icon={Download} onClick={() => void download()} loading={job.running}>
                  Download file
                </Button>
              </div>
            </div>
          </div>
          {job.running && <ProgressBar className="mt-4" value={job.progress} label={job.label} onCancel={job.cancel} />}
        </Panel>
      )}
    </>
  );
}
